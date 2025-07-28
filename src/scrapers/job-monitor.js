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
    this.minJobs = 5; // Lowered since we're looking for specific facility roles
    
    // Enhanced browser options for real data scraping
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
    
    // Facility-expansion specific job titles (Updated for better real-world results)
    this.facilityExpansionJobs = [
      // Broader facility roles that companies actually post
      'Facility Manager', 'Facilities Manager', 'Operations Manager',
      'Site Manager', 'Plant Manager', 'Warehouse Manager',
      'Distribution Manager', 'General Manager', 'Branch Manager',
      'Regional Manager', 'Area Manager', 'District Manager',
      
      // Construction & Project Management (common postings)
      'Construction Manager', 'Project Manager', 'Program Manager',
      'Construction Coordinator', 'Site Supervisor',
      
      // Operations roles indicating expansion
      'Operations Director', 'Operations Supervisor',
      'Production Manager', 'Manufacturing Manager',
      'Logistics Manager', 'Supply Chain Manager',
      
      // Real Estate & Property (broader terms)
      'Real Estate', 'Property Management', 'Leasing Manager',
      'Space Planning', 'Tenant Coordinator'
    ];

    // Expansion indicator keywords to look for in job descriptions
    this.expansionKeywords = [
      'new facility', 'new location', 'opening', 'expansion', 'startup',
      'build-out', 'construction', 'relocation', 'establish', 'launch'
    ];

    // Cache results (including negative results) to improve hit rate
    this.searchCache = new Map();
    this.cacheTimeout = 60 * 60 * 1000; // 1 hour cache
    
    // Target companies for cross-referencing (when found in facility roles)
    this.targetCompanies = [
      // Tech Companies
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
  }

  async monitorJobs() {
    console.log('💼 Starting facility-expansion job monitoring...');
    let browser;
    const allJobs = [];
    const errors = [];
    
    try {
      // Clean up old cache entries
      this.cleanupCache();
      
      // Log scraping attempt
      await prisma.scrapingLog.create({
        data: {
          source: 'jobs',
          status: 'started',
          items_found: 0
        }
      });

      browser = await puppeteer.launch(this.browserOptions);
      
      // Search for facility-expansion jobs by title + location instead of company + location
      const batchSize = 2; // Reduced from 3 to limit concurrent requests
      const jobTitles = this.facilityExpansionJobs.slice(0, 12); // Reduced from 20 to top 12 most promising titles
      const locations = this.locations.slice(0, 6); // Reduced from 8 to top 6 OC locations
      
      console.log(`🔍 Monitoring ${jobTitles.length} facility job titles across ${locations.length} locations...`);
      
      // Process in batches to prevent timeouts
      for (let i = 0; i < jobTitles.length; i += batchSize) {
        const batch = jobTitles.slice(i, i + batchSize);
        
        await Promise.allSettled(
          batch.map(async (jobTitle) => {
            for (const location of locations) {
              try {
                const jobs = await this.searchFacilityJobsWithRetry(browser, jobTitle, location);
                if (jobs && jobs.length > 0) {
                  allJobs.push(...jobs);
                  console.log(`✅ ${jobTitle} in ${location}: ${jobs.length} jobs`);
                }
              } catch (error) {
                console.error(`❌ Error searching ${jobTitle} in ${location}:`, error.message);
                errors.push({ jobTitle, location, error: error.message });
              }
            }
          })
        );
        
        // Rate limiting between batches
        if (i + batchSize < jobTitles.length) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      console.log(`📊 Total facility jobs found: ${allJobs.length}`);
      
      // Filter and enhance jobs with company detection
      const validJobs = await this.processAndFilterJobs(allJobs);
      
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
              date_posted: job.date_posted,
              title: job.title
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
      
      console.log(`✅ Facility job monitoring complete: ${validJobs.length} valid jobs, ${errors.length} errors`);
      return validJobs;
      
    } catch (error) {
      console.error('❌ Critical error in facility job monitoring:', error);
      
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

  async searchFacilityJobsWithRetry(browser, jobTitle, location) {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.searchFacilityJobs(browser, jobTitle, location);
      } catch (error) {
        console.error(`Attempt ${attempt}/${this.maxRetries} failed for ${jobTitle} in ${location}:`, error.message);
        
        if (attempt === this.maxRetries) {
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  async searchFacilityJobs(browser, jobTitle, location) {
    const page = await browser.newPage();
    
    try {
      // Check cache first (including negative results)
      const cacheKey = `${jobTitle}_${location}`;
      const cached = this.searchCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        console.log(`📄 Cache hit for ${jobTitle} in ${location}`);
        return cached.results;
      }

      // Enhanced page configuration
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      });
      
      // Use broader search terms for better results
      const searchTerm = this.optimizeSearchTerm(jobTitle, location);
      const searchUrl = `${this.baseUrl}?q=${encodeURIComponent(searchTerm)}&l=${encodeURIComponent(location)}&sort=date`;
      
      // Navigate with extended timeout and better error handling
      await page.goto(searchUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: this.timeout 
      });
      
      // Wait for results with timeout
      try {
        await page.waitForSelector('.jobsearch-SerpJobCard, [data-jk], .job_seen_beacon, .result', { timeout: 10000 });
      } catch (waitError) {
        console.log(`📭 No job results found for ${jobTitle} in ${location}`);
        // Cache negative result to prevent repeated searches
        this.searchCache.set(cacheKey, {
          results: [],
          timestamp: Date.now()
        });
        return [];
      }
      
      // Additional wait for dynamic content
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract job data with improved filtering
      const jobs = await page.evaluate((searchJobTitle, jobLocation, expansionKeywords) => {
        try {
          const jobElements = document.querySelectorAll('[data-jk], .job_seen_beacon, .jobsearch-SerpJobCard, .result');
          const jobs = [];
          
          jobElements.forEach((element, index) => {
            const titleElement = element.querySelector('h2 a, .jobTitle a, [data-testid="job-title"] a, .jobTitle-color-purple a');
            const companyElement = element.querySelector('.companyName, [data-testid="company-name"], .company');
            const locationElement = element.querySelector('[data-testid="job-location"], .companyLocation');
            const descriptionElement = element.querySelector('.job-snippet, .summary, [data-testid="job-snippet"]');
            
            if (titleElement && companyElement) {
              const title = titleElement.textContent.trim();
              const company = companyElement.textContent.trim();
              const location = locationElement ? locationElement.textContent.trim() : jobLocation;
              const description = descriptionElement ? descriptionElement.textContent.trim() : '';
              
              // More flexible filtering - look for facility/operations keywords
              const combinedText = (title + ' ' + description).toLowerCase();
              const facilityKeywords = [
                'facility', 'facilities', 'site', 'operations', 'manager', 'director',
                'warehouse', 'distribution', 'manufacturing', 'plant', 'construction',
                'project', 'regional', 'branch', 'location', 'real estate', 'property'
              ];
              
              // Check for expansion indicators
              const hasExpansionKeywords = expansionKeywords.some(keyword => 
                combinedText.includes(keyword.toLowerCase())
              );
              
              // Include if it has facility keywords OR expansion keywords
              if (facilityKeywords.some(keyword => combinedText.includes(keyword)) || hasExpansionKeywords) {
                jobs.push({
                  id: `${company}_${location}_${Date.now()}_${index}`,
                  company: company,
                  title: title,
                  location: location,
                  description: description,
                  count: 1,
                  date_posted: new Date(),
                  searchTitle: searchJobTitle,
                  hasExpansionKeywords: hasExpansionKeywords
                });
              }
            }
          });
          
          return jobs;
        } catch (evalError) {
          console.error('Error in page evaluation:', evalError);
          return [];
        }
      }, jobTitle, location, this.expansionKeywords);
      
      // Cache results (positive or negative)
      this.searchCache.set(cacheKey, {
        results: jobs || [],
        timestamp: Date.now()
      });
      
      return jobs || [];
      
    } catch (error) {
      if (error.name === 'TimeoutError') {
        // Cache timeout errors to prevent repeated failures
        const cacheKey = `${jobTitle}_${location}`;
        this.searchCache.set(cacheKey, {
          results: [],
          timestamp: Date.now()
        });
        throw new Error(`Navigation timeout for ${jobTitle} in ${location}`);
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

  // Optimize search terms for better results
  optimizeSearchTerm(jobTitle, location) {
    // Use broader terms that are more likely to return results
    const broaderTerms = {
      'Facility Manager': 'facilities OR operations manager',
      'Site Manager': 'site OR location manager', 
      'Plant Manager': 'plant OR manufacturing manager',
      'Warehouse Manager': 'warehouse OR distribution manager',
      'Construction Manager': 'construction OR project manager',
      'Regional Manager': 'regional OR area manager',
      'Real Estate': 'real estate OR property manager',
      'Property Management': 'property OR facilities management'
    };
    
    return broaderTerms[jobTitle] || jobTitle;
  }

  // Process and filter jobs, grouping by company and detecting target companies
  async processAndFilterJobs(allJobs) {
    const companyJobMap = new Map();
    
    // Group jobs by company and location
    allJobs.forEach(job => {
      const key = `${job.company}|${job.location}`;
      if (!companyJobMap.has(key)) {
        companyJobMap.set(key, {
          company: job.company,
          location: job.location,
          jobs: [],
          titles: new Set(),
          totalCount: 0
        });
      }
      
      const companyData = companyJobMap.get(key);
      companyData.jobs.push(job);
      companyData.titles.add(job.title);
      companyData.totalCount += 1;
    });
    
    // Filter and format results
    const validJobs = [];
    
    companyJobMap.forEach((companyData, key) => {
      // Only include if company has minimum facility jobs or is a target company
      const isTargetCompany = this.targetCompanies.some(target => 
        companyData.company.toLowerCase().includes(target.toLowerCase())
      );
      
      if (companyData.totalCount >= this.minJobs || isTargetCompany) {
        const representativeJob = companyData.jobs[0];
        const allTitles = Array.from(companyData.titles).join(', ');
        const allDescriptions = companyData.jobs.map(j => j.description).join(' ');
        
        validJobs.push({
          company: companyData.company,
          title: `Facility Expansion Roles: ${allTitles}`,
          location: companyData.location,
          description: `${companyData.totalCount} facility-related positions: ${allDescriptions.substring(0, 300)}...`,
          count: companyData.totalCount,
          date_posted: new Date(),
          isTargetCompany: isTargetCompany
        });
      }
    });
    
    return validJobs;
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
    
    // Multiple facility roles indicates significant expansion
    if (job.count >= 3) {
      indicators.push('multiple_facility_roles');
    }
    
    // Facility-related positions (now all jobs should be facility-related)
    indicators.push('facility_related_roles');
    
    // Leadership positions suggest new operations
    if (title.includes('director') || title.includes('manager') || 
        title.includes('head of') || description.includes('startup') ||
        description.includes('new facility') || description.includes('opening')) {
      indicators.push('leadership_and_expansion');
    }
    
    // Target company bonus
    if (job.isTargetCompany) {
      indicators.push('target_company');
    }
    
    // Construction/build-out roles are highest confidence
    if (title.includes('construction') || title.includes('build') || 
        title.includes('tenant improvement') || title.includes('project manager')) {
      indicators.push('construction_buildout');
    }
    
    return indicators;
  }

  calculateExpansionConfidence(job, indicators) {
    let confidence = 30; // Base confidence for facility roles
    
    // Indicator bonuses
    if (indicators.includes('multiple_facility_roles')) confidence += 25;
    if (indicators.includes('leadership_and_expansion')) confidence += 20;
    if (indicators.includes('target_company')) confidence += 15;
    if (indicators.includes('construction_buildout')) confidence += 30;
    
    return Math.min(confidence, 95); // Cap at 95%
  }

  // Method to clean up old cache entries
  cleanupCache() {
    const now = Date.now();
    const keysToDelete = [];

    this.searchCache.forEach((value, key) => {
      if (now - value.timestamp > this.cacheTimeout) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => {
      this.searchCache.delete(key);
      console.log(`Cleaned up old cache entry for key: ${key}`);
    });
  }
}

module.exports = JobMonitor; 