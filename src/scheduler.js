const cron = require('node-cron');
const IrvinePermitsScraper = require('./scrapers/irvine-permits');
const MultiCityPermitsScraper = require('./scrapers/multi-city-permits'); // NEW
const JobMonitor = require('./scrapers/job-monitor');
const AIPredictor = require('./analysis/ai-predictor');
const EmailSender = require('./alerts/email-sender');

class Scheduler {
  constructor() {
    this.permitsScraper = new IrvinePermitsScraper(); // Keep for backward compatibility
    this.multiCityPermitsScraper = new MultiCityPermitsScraper(); // NEW
    this.jobMonitor = new JobMonitor();
    this.aiPredictor = new AIPredictor();
    this.emailSender = new EmailSender();
    
    this.isRunning = {
      permits: false,
      multiCityPermits: false, // NEW
      jobs: false,
      analysis: false
    };
  }

  start() {
    console.log('⏰ Starting IntelliSense scheduler...');
    
    // Every 2 hours: Scrape permits and jobs from ALL cities
    cron.schedule('0 */2 * * *', async () => {
      await this.runMultiCityDataCollection(); // UPDATED
    });
    
    // Every 4 hours: Run AI analysis
    cron.schedule('0 */4 * * *', async () => {
      await this.runAnalysis();
    });
    
    // Daily at 9 AM: Send daily report
    cron.schedule('0 9 * * *', async () => {
      await this.sendDailyReport();
    });
    
    // Every 30 minutes: Health check
    cron.schedule('*/30 * * * *', async () => {
      await this.healthCheck();
    });
    
    console.log('✅ Scheduler started with the following schedule:');
    console.log('  📋 Multi-City Permits & Jobs: Every 2 hours');
    console.log('  🧠 AI Analysis: Every 4 hours');
    console.log('  📊 Daily Report: 9:00 AM daily');
    console.log('  💓 Health Check: Every 30 minutes');
    console.log('  🏙️  Cities: Irvine, Newport Beach, Tustin, Anaheim');
    
    // Run initial data collection
    setTimeout(() => {
      this.runMultiCityDataCollection(); // UPDATED
    }, 5000);
  }

  async runMultiCityDataCollection() { // NEW METHOD
    console.log('🏙️  Starting multi-city data collection...');
    
    try {
      // Run permits and jobs in parallel for better performance
      const [permitsResult, jobsResult] = await Promise.allSettled([
        this.runMultiCityPermitsCollection(),
        this.runJobsCollection()
      ]);
      
      if (permitsResult.status === 'fulfilled') {
        console.log(`✅ Multi-city permits: ${permitsResult.value} permits collected`);
      } else {
        console.error('❌ Multi-city permits collection failed:', permitsResult.reason);
      }
      
      if (jobsResult.status === 'fulfilled') {
        console.log(`✅ Jobs: ${jobsResult.value} jobs collected`);
      } else {
        console.error('❌ Jobs collection failed:', jobsResult.reason);
      }
      
      // Trigger analysis if we have new data
      const totalItems = (permitsResult.status === 'fulfilled' ? permitsResult.value : 0) + 
                        (jobsResult.status === 'fulfilled' ? jobsResult.value : 0);
      
      if (totalItems > 0) {
        setTimeout(() => {
          this.runAnalysis();
        }, 2000);
      }
      
    } catch (error) {
      console.error('❌ Multi-city data collection failed:', error);
    }
  }

  async runMultiCityPermitsCollection() { // NEW METHOD
    if (this.isRunning.multiCityPermits) {
      console.log('⏭️  Multi-city permits collection already running, skipping...');
      return 0;
    }
    
    this.isRunning.multiCityPermits = true;
    
    try {
      console.log('📋 Scraping permits from multiple cities...');
      const permits = await this.multiCityPermitsScraper.scrapeAllCities();
      
      console.log(`📊 Multi-city permits summary:`);
      
      // Group permits by city for reporting
      const citySummary = {};
      permits.forEach(permit => {
        const city = permit.city || 'Unknown';
        if (!citySummary[city]) {
          citySummary[city] = 0;
        }
        citySummary[city]++;
      });
      
      Object.entries(citySummary).forEach(([city, count]) => {
        console.log(`   🏛️  ${city}: ${count} high-value permits`);
      });
      
      return permits.length;
      
    } catch (error) {
      console.error('❌ Multi-city permits collection error:', error);
      throw error;
    } finally {
      this.isRunning.multiCityPermits = false;
    }
  }

  async runJobsCollection() { // NEW METHOD - extracted for reuse
    if (this.isRunning.jobs) {
      console.log('⏭️  Jobs collection already running, skipping...');
      return 0;
    }
    
    this.isRunning.jobs = true;
    
    try {
      console.log('💼 Monitoring job postings...');
      const jobs = await this.jobMonitor.monitorJobs();
      
      return jobs.length;
      
    } catch (error) {
      console.error('❌ Jobs collection error:', error);
      throw error;
    } finally {
      this.isRunning.jobs = false;
    }
  }

  // Keep the original method for backward compatibility
  async runDataCollection() {
    if (this.isRunning.permits || this.isRunning.jobs) {
      console.log('⏸️  Data collection already running, skipping...');
      return;
    }
    
    console.log('🚀 Starting scheduled data collection...');
    const startTime = Date.now();
    
    try {
      // Run permits and jobs scraping in parallel
      this.isRunning.permits = true;
      this.isRunning.jobs = true;
      
      const [permits, jobs] = await Promise.allSettled([
        this.permitsScraper.scrape(),
        this.jobMonitor.monitorJobs()
      ]);
      
      const permitResults = permits.status === 'fulfilled' ? permits.value : [];
      const jobResults = jobs.status === 'fulfilled' ? jobs.value : [];
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ Data collection complete in ${duration}s:`);
      console.log(`  📋 Permits: ${permitResults.length}`);
      console.log(`  💼 Jobs: ${jobResults.length}`);
      
      // Trigger analysis if we have new data
      if (permitResults.length > 0 || jobResults.length > 0) {
        setTimeout(() => {
          this.runAnalysis();
        }, 2000);
      }
      
    } catch (error) {
      console.error('❌ Error in data collection:', error);
    } finally {
      this.isRunning.permits = false;
      this.isRunning.jobs = false;
    }
  }

  async runAnalysis() {
    if (this.isRunning.analysis) {
      console.log('⏸️  Analysis already running, skipping...');
      return;
    }
    
    console.log('🧠 Starting AI analysis...');
    const startTime = Date.now();
    
    try {
      this.isRunning.analysis = true;
      
      const predictions = await this.aiPredictor.analyzeAndPredict();
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ Analysis complete in ${duration}s: ${predictions.count} predictions`);
      
      const highConfidence = predictions.filter(p => p.confidence_score >= 80);
      if (highConfidence.length > 0) {
        console.log(`🚨 ${highConfidence.length} high-confidence predictions generated!`);
      }
      
    } catch (error) {
      console.error('❌ Error in analysis:', error);
    } finally {
      this.isRunning.analysis = false;
    }
  }

  async sendDailyReport() {
    try {
      console.log('📊 Generating daily report...');
      
      const stats = await this.getDailyStats();
      await this.emailSender.sendDailyReport(stats);
      
      console.log('📧 Daily report sent successfully');
      
    } catch (error) {
      console.error('❌ Error sending daily report:', error);
    }
  }

  async getDailyStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    try {
      const [permits, predictions, scrapingLogs] = await Promise.all([
        prisma.permit.count({
          where: {
            created_at: {
              gte: today
            }
          }
        }),
        prisma.prediction.count({
          where: {
            created_at: {
              gte: today
            }
          }
        }),
        prisma.scrapingLog.findMany({
          where: {
            created_at: {
              gte: today
            }
          },
          orderBy: { created_at: 'desc' }
        })
      ]);
      
      return {
        permits,
        predictions,
        lastScrapeTimestamps: {
          permits: scrapingLogs.find(log => log.source === 'permits')?.created_at,
          jobs: scrapingLogs.find(log => log.source === 'jobs')?.created_at
        },
        systemStatus: 'operational'
      };
      
    } finally {
      await prisma.$disconnect();
    }
  }

  async healthCheck() {
    try {
      const { PrismaClient } = require('@prisma/client');
      const prisma = new PrismaClient();
      
      // Check database connection
      await prisma.$queryRaw`SELECT 1`;
      
      // Check recent activity
      const recentLogs = await prisma.scrapingLog.findMany({
        where: {
          created_at: {
            gte: new Date(Date.now() - 6 * 60 * 60 * 1000) // Last 6 hours
          }
        },
        take: 5
      });
      
      if (recentLogs.length === 0) {
        console.log('⚠️  Warning: No recent scraping activity');
      }
      
      await prisma.$disconnect();
      
    } catch (error) {
      console.error('❌ Health check failed:', error);
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }

  // Manual trigger methods for testing
  async triggerPermitsScrape() {
    return await this.permitsScraper.scrape();
  }

  async triggerJobMonitor() {
    return await this.jobMonitor.monitorJobs();
  }

  async triggerAnalysis() {
    try {
      console.log('🧠 Triggering AI analysis...');
      const predictions = await this.aiPredictor.analyzeAndPredict();
      console.log(`✅ Analysis complete: ${predictions.count} predictions generated`);
      return predictions;
    } catch (error) {
      console.error('❌ Error in analysis:', error);
      throw error;
    }
  }
}

module.exports = Scheduler; 