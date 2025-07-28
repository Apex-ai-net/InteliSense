const puppeteer = require('puppeteer');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class JobMonitor {
  constructor() {
    this.baseUrl = 'https://www.indeed.com/jobs';
    this.locations = [
      'Irvine, CA',
      'Newport Beach, CA', 
      'Costa Mesa, CA',
      'Santa Ana, CA',
      'Anaheim, CA',
      'Orange, CA',
      'Tustin, CA',
      'Garden Grove, CA',
      'Huntington Beach, CA',
      'Fountain Valley, CA',
      'Westminster, CA',
      'Cypress, CA',
      'Los Alamitos, CA',
      'Seal Beach, CA',
      'La Habra, CA'
    ];
    this.minJobs = 25; // Lowered for more leads
    
    // Enhanced browser options for production
    this.browserOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-images',
        '--disable-javascript', // Disable JS for faster loading
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      ],
      defaultViewport: {
        width: 1280,
        height: 720
      }
    };
    
    // Increased timeouts for production
    this.timeout = 60000; // 60 seconds
    this.maxRetries = 2;
    
    // Target companies for Voit Commercial Real Estate
    this.targetCompanies = [
      // Tech Companies (prioritized - most likely to expand)
      'Apple', 'Amazon', 'Google', 'Meta', 'Microsoft', 'Netflix', 'Adobe', 'Salesforce', 'Oracle',
      'NVIDIA', 'Intel', 'AMD', 'Qualcomm', 'Broadcom', 'Western Digital', 'Seagate',
      // Biotech/Pharma
      'Irvine Company', 'Allergan', 'Edwards Lifesciences', 'Masimo', 'Alcon', 'Bausch Health',
      // Manufacturing/Industrial
      'Boeing', 'Northrop Grumman', 'Raytheon', 'Lockheed Martin', 'General Dynamics',
      // Automotive
      'Tesla', 'Rivian', 'Lucid Motors', 'Kia', 'Hyundai', 'Toyota', 'Honda',
      // Logistics/Distribution
      'UPS', 'FedEx', 'DHL', 'Walmart', 'Target', 'Costco',
      // Healthcare
      'Kaiser Permanente', 'UCI Health', 'Hoag Hospital', 'Providence Health',
      // Financial Services
      'Pacific Life', 'First American', 'Experian', 'CoreLogic', 'Allstate'
    ];
    
    // Job categories relevant to commercial real estate
    this.relevantJobCategories = [
      'facilities', 'real estate', 'operations', 'manufacturing', 'engineering',
      'logistics', 'distribution', 'warehouse', 'office', 'management',
      'executive', 'director', 'manager', 'coordinator', 'specialist'
    ];
  }

  async monitorJobs() {
    console.log('💼 Starting job monitoring...');
    let browser;
    const allJobs = [];
    const errors = [];
    
    try {
      // Log scraping attempt
      await prisma.scrapingLog.create({
        data: {
          source: 'jobs',
          status: 'started',
          items_found: 0
        }
      });

      browser = await puppeteer.launch(this.browserOptions);
      
      // Limit concurrent searches to prevent overwhelming
      const batchSize = 3;
      const companies = this.targetCompanies.slice(0, 15); // Limit to top 15 companies
      const locations = this.locations.slice(0, 5); // Limit to top 5 locations
      
      console.log(`🔍 Monitoring ${companies.length} companies across ${locations.length} locations...`);
      
      // Process in batches to prevent timeouts
      for (let i = 0; i < companies.length; i += batchSize) {
        const batch = companies.slice(i, i + batchSize);
        
        await Promise.allSettled(
          batch.map(async (company) => {
            for (const location of locations) {
              try {
                const jobs = await this.searchCompanyJobsWithRetry(browser, company, location);
                if (jobs && jobs.length > 0) {
                  allJobs.push(...jobs);
                  console.log(`✅ ${company} in ${location}: ${jobs.length} jobs`);
                }
              } catch (error) {
                console.error(`❌ Error searching ${company} in ${location}:`, error.message);
                errors.push({ company, location, error: error.message });
              }
            }
          })
        );
        
        // Rate limiting between batches
        if (i + batchSize < companies.length) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      console.log(`📊 Total jobs found: ${allJobs.length}`);
      
      // Filter by minimum job count
      const validJobs = allJobs.filter(job => job.count >= this.minJobs);
      
      // Save valid jobs to database
      for (const job of validJobs) {
        try {
          await prisma.job.upsert({
            where: {
              company_location_unique: {
                company: job.company,
                location: job.location
              }
            },
            update: {
              count: job.count,
              description: job.description,
              date_posted: job.date_posted
            },
            create: {
              company: job.company,
              title: job.title,
              location: job.location,
              description: job.description,
              count: job.count,
              date_posted: job.date_posted
            }
          });
        } catch (error) {
          console.error('Error saving job:', error);
          errors.push({ error: `Database save failed: ${error.message}` });
        }
      }
      
      // Log successful monitoring
      await prisma.scrapingLog.create({
        data: {
          source: 'jobs',
          status: errors.length > 0 ? 'partial_success' : 'success',
          items_found: validJobs.length,
          error_msg: errors.length > 0 ? `${errors.length} errors occurred` : null
        }
      });
      
      console.log(`✅ Job monitoring complete: ${validJobs.length} valid jobs, ${errors.length} errors`);
      return validJobs;
      
    } catch (error) {
      console.error('❌ Critical error in job monitoring:', error);
      
      // Log error
      await prisma.scrapingLog.create({
        data: {
          source: 'jobs',
          status: 'error',
          items_found: 0,
          error_msg: error.message
        }
      });
      
      throw error;
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error('Error closing browser:', closeError);
        }
      }
    }
  }

  async searchCompanyJobsWithRetry(browser, company, location) {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.searchCompanyJobs(browser, company, location);
      } catch (error) {
        console.error(`Attempt ${attempt}/${this.maxRetries} failed for ${company} in ${location}:`, error.message);
        
        if (attempt === this.maxRetries) {
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  async searchCompanyJobs(browser, company, location) {
    const page = await browser.newPage();
    
    try {
      // Enhanced page configuration
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      });
      
      // Build search URL
      const searchUrl = `${this.baseUrl}?q=${encodeURIComponent(company)}&l=${encodeURIComponent(location)}&sort=date`;
      
      // Navigate with extended timeout and better error handling
      await page.goto(searchUrl, { 
        waitUntil: 'domcontentloaded', // Faster than networkidle2
        timeout: this.timeout 
      });
      
      // Wait for results with timeout
      try {
        await page.waitForSelector('.jobsearch-SerpJobCard, [data-jk], .job_seen_beacon, .result', { timeout: 10000 });
      } catch (waitError) {
        // Page might have loaded but no jobs found
        console.log(`No job results found for ${company} in ${location}`);
        return [];
      }
      
      // Additional wait for dynamic content
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract job data with better error handling
      const jobs = await page.evaluate((companyName, jobLocation) => {
        try {
          const jobElements = document.querySelectorAll('[data-jk], .job_seen_beacon, .jobsearch-SerpJobCard, .result');
          const jobs = [];
          
          // Count total job results
          const resultStats = document.querySelector('.pn, #searchCountPages, .np:last-child');
          let totalJobs = 0;
          
          if (resultStats) {
            const text = resultStats.textContent;
            const match = text.match(/(\d+)/);
            if (match) {
              totalJobs = parseInt(match[1]);
            }
          }
          
          // If no specific count found, use element count as estimate
          if (totalJobs === 0) {
            totalJobs = jobElements.length;
          }
          
          // Only return meaningful job counts
          if (totalJobs > 0) {
            jobs.push({
              id: `${companyName}_${jobLocation}_${Date.now()}`,
              company: companyName,
              title: `${companyName} Jobs`,
              location: jobLocation,
              description: `${totalJobs} job openings at ${companyName} in ${jobLocation}`,
              count: totalJobs,
              date_posted: new Date()
            });
          }
          
          return jobs;
        } catch (evalError) {
          console.error('Error in page evaluation:', evalError);
          return [];
        }
      }, company, location);
      
      return jobs || [];
      
    } catch (error) {
      if (error.name === 'TimeoutError') {
        throw new Error(`Navigation timeout for ${company} in ${location}`);
      }
      throw error;
    } finally {
      try {
        await page.close();
      } catch (closeError) {
        console.error('Error closing page:', closeError);
      }
    }
  }

  // Enhanced method to check if jobs indicate expansion
  async analyzeJobTrends(jobs) {
    const expansionIndicators = [];
    
    for (const job of jobs) {
      const indicators = this.identifyExpansionSignals(job);
      if (indicators.length > 0) {
        expansionIndicators.push({
          company: job.company,
          location: job.location,
          jobCount: job.count,
          indicators: indicators,
          confidence: this.calculateExpansionConfidence(job, indicators)
        });
      }
    }
    
    return expansionIndicators;
  }

  identifyExpansionSignals(job) {
    const indicators = [];
    const description = job.description.toLowerCase();
    const title = job.title.toLowerCase();
    
    // High job count indicates scaling
    if (job.count >= 50) {
      indicators.push('high_volume_hiring');
    }
    
    // Facility-related positions
    if (this.relevantJobCategories.some(category => 
      description.includes(category) || title.includes(category)
    )) {
      indicators.push('facility_related_roles');
    }
    
    // Leadership positions suggest new operations
    if (description.includes('director') || description.includes('manager') || 
        description.includes('head of') || description.includes('vp')) {
      indicators.push('leadership_hiring');
    }
    
    return indicators;
  }

  calculateExpansionConfidence(job, indicators) {
    let confidence = 0;
    
    // Base confidence from job count
    if (job.count >= 100) confidence += 30;
    else if (job.count >= 50) confidence += 20;
    else if (job.count >= 25) confidence += 10;
    
    // Indicator bonuses
    if (indicators.includes('high_volume_hiring')) confidence += 25;
    if (indicators.includes('facility_related_roles')) confidence += 20;
    if (indicators.includes('leadership_hiring')) confidence += 15;
    
    return Math.min(confidence, 85); // Cap at 85%
  }
}

module.exports = JobMonitor; 