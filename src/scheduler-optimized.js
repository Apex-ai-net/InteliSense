const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const logger = require('./utils/logger');
const cacheManager = require('./utils/cache');

class OptimizedScheduler {
  constructor() {
    this.prisma = new PrismaClient();
    this.isRunning = {
      permits: false,
      jobs: false,
      analysis: false,
      report: false
    };
    
    this.jobQueue = [];
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds
    
    // Job statistics
    this.stats = {
      totalJobs: 0,
      successfulJobs: 0,
      failedJobs: 0,
      averageJobTime: 0,
      lastRun: null
    };
    
    // Initialize services lazily
    this.services = {};
  }

  async initializeServices() {
    try {
      const IrvinePermitsScraper = require('./scrapers/irvine-permits');
      const JobMonitor = require('./scrapers/job-monitor');
      const AIPredictor = require('./analysis/ai-predictor');
      const EmailSender = require('./alerts/email-sender');

      this.services = {
        permitsScraper: new IrvinePermitsScraper(),
        jobMonitor: new JobMonitor(),
        aiPredictor: new AIPredictor(),
        emailSender: new EmailSender()
      };

      logger.info('Scheduler services initialized');
    } catch (error) {
      logger.error('Failed to initialize scheduler services', { error: error.message });
      throw error;
    }
  }

  start() {
    logger.info('Starting optimized IntelliSense scheduler...');
    
    // Initialize services
    this.initializeServices();
    
    // Schedule jobs with better error handling
    this.scheduleJobs();
    
    // Start monitoring
    this.startMonitoring();
    
    logger.info('Optimized scheduler started successfully');
  }

  scheduleJobs() {
    // Every 2 hours: Scrape permits and jobs
    cron.schedule('0 */2 * * *', async () => {
      await this.runDataCollectionWithRetry();
    }, {
      scheduled: true,
      timezone: "America/Los_Angeles"
    });
    
    // Every 4 hours: Run AI analysis
    cron.schedule('0 */4 * * *', async () => {
      await this.runAnalysisWithRetry();
    }, {
      scheduled: true,
      timezone: "America/Los_Angeles"
    });
    
    // Daily at 9 AM: Send daily report
    cron.schedule('0 9 * * *', async () => {
      await this.sendDailyReportWithRetry();
    }, {
      scheduled: true,
      timezone: "America/Los_Angeles"
    });
    
    // Every 30 minutes: Health check
    cron.schedule('*/30 * * * *', async () => {
      await this.healthCheck();
    }, {
      scheduled: true,
      timezone: "America/Los_Angeles"
    });
    
    // Every 15 minutes: Cleanup and maintenance
    cron.schedule('*/15 * * * *', async () => {
      await this.performMaintenance();
    }, {
      scheduled: true,
      timezone: "America/Los_Angeles"
    });
    
    logger.info('Scheduled jobs configured', {
      dataCollection: 'Every 2 hours',
      analysis: 'Every 4 hours',
      dailyReport: '9:00 AM daily',
      healthCheck: 'Every 30 minutes',
      maintenance: 'Every 15 minutes'
    });
    
    // Run initial data collection after a delay
    setTimeout(() => {
      this.runDataCollectionWithRetry();
    }, 10000); // 10 seconds delay
  }

  async runDataCollectionWithRetry() {
    return this.executeWithRetry('data_collection', async () => {
      return await this.runDataCollection();
    });
  }

  async runAnalysisWithRetry() {
    return this.executeWithRetry('analysis', async () => {
      return await this.runAnalysis();
    });
  }

  async sendDailyReportWithRetry() {
    return this.executeWithRetry('daily_report', async () => {
      return await this.sendDailyReport();
    });
  }

  async executeWithRetry(jobType, operation, retries = this.maxRetries) {
    const startTime = Date.now();
    let lastError = null;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        logger.scheduler(jobType, 'started', null, null, { attempt });
        
        const result = await operation();
        const duration = Date.now() - startTime;
        
        this.updateStats(true, duration);
        logger.scheduler(jobType, 'completed', duration, null, { attempt });
        
        return result;
        
      } catch (error) {
        lastError = error;
        logger.scheduler(jobType, 'failed', null, error, { attempt, retries });
        
        if (attempt < retries) {
          const delay = this.retryDelay * attempt; // Exponential backoff
          logger.info(`Retrying ${jobType} in ${delay}ms`, { attempt, retries });
          await this.sleep(delay);
        }
      }
    }
    
    this.updateStats(false, Date.now() - startTime);
    throw lastError;
  }

  async runDataCollection() {
    if (this.isRunning.permits || this.isRunning.jobs) {
      logger.warn('Data collection already running, skipping...');
      return { permits: [], jobs: [] };
    }
    
    const startTime = Date.now();
    
    try {
      // Run permits and jobs scraping in parallel with timeout
      this.isRunning.permits = true;
      this.isRunning.jobs = true;
      
      const timeout = 300000; // 5 minutes timeout
      const permitsPromise = this.services.permitsScraper.scrape();
      const jobsPromise = this.services.jobMonitor.monitorJobs();
      
      const [permits, jobs] = await Promise.allSettled([
        this.timeoutPromise(permitsPromise, timeout),
        this.timeoutPromise(jobsPromise, timeout)
      ]);
      
      const permitResults = permits.status === 'fulfilled' ? permits.value : [];
      const jobResults = jobs.status === 'fulfilled' ? jobs.value : [];
      
      const duration = Date.now() - startTime;
      logger.performance('Data collection', duration, {
        permits: permitResults.length,
        jobs: jobResults.length
      });
      
      // Trigger analysis if we have new data
      if (permitResults.length > 0 || jobResults.length > 0) {
        setTimeout(() => {
          this.runAnalysisWithRetry();
        }, 5000); // 5 second delay
      }
      
      return {
        permits: permitResults,
        jobs: jobResults,
        duration: `${duration}ms`
      };
      
    } catch (error) {
      logger.error('Error in data collection', { error: error.message });
      throw error;
    } finally {
      this.isRunning.permits = false;
      this.isRunning.jobs = false;
    }
  }

  async runAnalysis() {
    if (this.isRunning.analysis) {
      logger.warn('Analysis already running, skipping...');
      return { predictions: [] };
    }
    
    const startTime = Date.now();
    
    try {
      this.isRunning.analysis = true;
      
      const predictions = await this.services.aiPredictor.analyzeAndPredict();
      
      const duration = Date.now() - startTime;
      logger.performance('AI Analysis', duration, {
        predictions: predictions.count || 0
      });
      
      const highConfidence = predictions.filter(p => p.confidence_score >= 80);
      if (highConfidence.length > 0) {
        logger.info(`${highConfidence.length} high-confidence predictions generated`);
      }
      
      return {
        predictions: predictions.predictions || [],
        count: predictions.count || 0,
        duration: `${duration}ms`
      };
      
    } catch (error) {
      logger.error('Error in analysis', { error: error.message });
      throw error;
    } finally {
      this.isRunning.analysis = false;
    }
  }

  async sendDailyReport() {
    const startTime = Date.now();
    
    try {
      logger.scheduler('daily_report', 'started');
      
      const stats = await this.getDailyStats();
      await this.services.emailSender.sendDailyReport(stats);
      
      const duration = Date.now() - startTime;
      logger.scheduler('daily_report', 'completed', duration);
      
      return { success: true, duration: `${duration}ms` };
      
    } catch (error) {
      logger.error('Error sending daily report', { error: error.message });
      throw error;
    }
  }

  async getDailyStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    try {
      const [permits, predictions, scrapingLogs] = await Promise.all([
        this.prisma.permit.count({
          where: {
            created_at: {
              gte: today
            }
          }
        }),
        this.prisma.prediction.count({
          where: {
            created_at: {
              gte: today
            }
          }
        }),
        this.prisma.scrapingLog.findMany({
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
        systemStatus: 'operational',
        schedulerStats: this.stats
      };
      
    } catch (error) {
      logger.error('Error getting daily stats', { error: error.message });
      return {
        permits: 0,
        predictions: 0,
        lastScrapeTimestamps: {},
        systemStatus: 'error',
        error: error.message
      };
    }
  }

  async healthCheck() {
    try {
      // Check database connection
      await this.prisma.$queryRaw`SELECT 1`;
      
      // Check recent activity
      const recentLogs = await this.prisma.scrapingLog.findMany({
        where: {
          created_at: {
            gte: new Date(Date.now() - 6 * 60 * 60 * 1000) // Last 6 hours
          }
        },
        take: 5
      });
      
      if (recentLogs.length === 0) {
        logger.warn('No recent scraping activity detected');
      }
      
      // Check memory usage
      const memoryUsage = process.memoryUsage();
      if (memoryUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
        logger.warn('High memory usage detected', { memoryUsage });
      }
      
      logger.info('Health check completed', {
        recentLogs: recentLogs.length,
        memoryUsage: {
          heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`
        }
      });
      
    } catch (error) {
      logger.error('Health check failed', { error: error.message });
    }
  }

  async performMaintenance() {
    try {
      // Clean up old logs
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const deletedLogs = await this.prisma.scrapingLog.deleteMany({
        where: {
          created_at: {
            lt: thirtyDaysAgo
          }
        }
      });
      
      if (deletedLogs.count > 0) {
        logger.info(`Cleaned up ${deletedLogs.count} old log entries`);
      }
      
      // Clear expired cache entries
      const cacheStats = cacheManager.getStats();
      logger.debug('Cache maintenance completed', cacheStats);
      
    } catch (error) {
      logger.error('Maintenance failed', { error: error.message });
    }
  }

  updateStats(success, duration) {
    this.stats.totalJobs++;
    this.stats.lastRun = new Date();
    
    if (success) {
      this.stats.successfulJobs++;
    } else {
      this.stats.failedJobs++;
    }
    
    // Update average job time
    const totalTime = this.stats.averageJobTime * (this.stats.totalJobs - 1) + duration;
    this.stats.averageJobTime = totalTime / this.stats.totalJobs;
  }

  startMonitoring() {
    // Log scheduler stats every hour
    setInterval(() => {
      logger.info('Scheduler statistics', this.stats);
    }, 60 * 60 * 1000); // Every hour
  }

  async timeoutPromise(promise, timeout) {
    return Promise.race([
      promise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Operation timeout')), timeout)
      )
    ]);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      stats: this.stats,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }

  // Manual trigger methods for testing
  async triggerPermitsScrape() {
    return await this.services.permitsScraper.scrape();
  }

  async triggerJobMonitor() {
    return await this.services.jobMonitor.monitorJobs();
  }

  async triggerAnalysis() {
    try {
      logger.scheduler('manual_analysis', 'started');
      const startTime = Date.now();
      
      const predictions = await this.services.aiPredictor.analyzeAndPredict();
      const duration = Date.now() - startTime;
      
      logger.scheduler('manual_analysis', 'completed', duration, null, {
        count: predictions.count || 0
      });
      
      return predictions;
    } catch (error) {
      logger.scheduler('manual_analysis', 'failed', null, error);
      throw error;
    }
  }

  async shutdown() {
    logger.info('Shutting down scheduler...');
    
    try {
      await this.prisma.$disconnect();
      logger.info('Scheduler shutdown completed');
    } catch (error) {
      logger.error('Error during scheduler shutdown', { error: error.message });
    }
  }
}

module.exports = OptimizedScheduler; 