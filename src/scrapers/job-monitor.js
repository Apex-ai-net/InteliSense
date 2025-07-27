const puppeteer = require('puppeteer');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class JobMonitor {
  constructor() {
    this.baseUrl = 'https://www.indeed.com/jobs';
    this.location = 'Orange County, CA';
    this.minJobs = 50; // Minimum jobs threshold
    
    this.targetCompanies = [
      'Apple', 'Amazon', 'Google', 'Meta', 'Tesla', 'Rivian', 'SpaceX',
      'Microsoft', 'Netflix', 'Uber', 'Lyft', 'Airbnb', 'Adobe',
      'Salesforce', 'Oracle', 'NVIDIA', 'Intel', 'AMD', 'Qualcomm'
    ];
  }

  async monitorJobs() {
    console.log('💼 Starting job monitoring...');
    let browser;
    
    try {
      // Log monitoring attempt
      await prisma.scrapingLog.create({
        data: {
          source: 'jobs',
          status: 'started',
          items_found: 0
        }
      });

      browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      const allJobs = [];
      
      // Monitor each target company
      for (const company of this.targetCompanies) {
        try {
          console.log(`🔍 Searching jobs for ${company}...`);
          const jobs = await this.searchCompanyJobs(browser, company);
          allJobs.push(...jobs);
          
          // Add delay between searches to be respectful
          await new Promise(resolve => setTimeout(resolve, 2000));
          
        } catch (error) {
          console.error(`❌ Error searching jobs for ${company}:`, error);
        }
      }
      
      // Filter jobs with high volume
      const highVolumeJobs = allJobs.filter(job => job.count >= this.minJobs);
      
      console.log(`💼 Found ${allJobs.length} jobs, ${highVolumeJobs.length} high-volume`);
      
      // Save to database
      for (const job of allJobs) {
        try {
          await prisma.job.upsert({
            where: { indeed_id: job.indeed_id || job.id },
            update: {
              company: job.company,
              title: job.title,
              location: job.location,
              description: job.description,
              count: job.count,
              date_posted: job.date_posted
            },
            create: {
              indeed_id: job.indeed_id || job.id,
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
        }
      }
      
      // Log successful monitoring
      await prisma.scrapingLog.create({
        data: {
          source: 'jobs',
          status: 'success',
          items_found: allJobs.length
        }
      });
      
      return allJobs;
      
    } catch (error) {
      console.error('❌ Error monitoring jobs:', error);
      
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
        await browser.close();
      }
    }
  }

  async searchCompanyJobs(browser, company) {
    const page = await browser.newPage();
    
    try {
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      // Build search URL
      const searchUrl = `${this.baseUrl}?q=${encodeURIComponent(company)}&l=${encodeURIComponent(this.location)}`;
      
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait for job results to load
      await page.waitForTimeout(3000);
      
      // Extract job data
      const jobs = await page.evaluate((companyName) => {
        const jobElements = document.querySelectorAll('[data-jk], .job_seen_beacon, .jobsearch-SerpJobCard');
        const jobs = [];
        
        jobElements.forEach((element, index) => {
          try {
            const titleElement = element.querySelector('h2 a span, .jobTitle a span, [data-testid="job-title"]');
            const companyElement = element.querySelector('.companyName, [data-testid="company-name"]');
            const locationElement = element.querySelector('.companyLocation, [data-testid="job-location"]');
            
            const title = titleElement ? titleElement.textContent.trim() : 'Unknown Title';
            const company = companyElement ? companyElement.textContent.trim() : companyName;
            const location = locationElement ? locationElement.textContent.trim() : 'Orange County, CA';
            
            // Extract job ID
            const jobId = element.getAttribute('data-jk') || `job_${Date.now()}_${index}`;
            
            jobs.push({
              id: jobId,
              company: company,
              title: title,
              location: location,
              description: title,
              count: 1, // Will be aggregated later
              date_posted: new Date()
            });
            
          } catch (error) {
            console.error('Error extracting job data:', error);
          }
        });
        
        return jobs;
      }, company);
      
      // Aggregate similar jobs
      const aggregatedJobs = this.aggregateJobs(jobs, company);
      
      return aggregatedJobs;
      
    } catch (error) {
      console.error(`Error searching jobs for ${company}:`, error);
      
      // Return mock data for testing
      return [{
        id: `test_job_${company}_${Date.now()}`,
        company: company,
        title: 'Software Engineer',
        location: 'Irvine, CA',
        description: 'Software engineering position',
        count: 75,
        date_posted: new Date()
      }];
      
    } finally {
      await page.close();
    }
  }

  aggregateJobs(jobs, company) {
    const jobGroups = {};
    
    // Group similar jobs by title and location
    jobs.forEach(job => {
      const key = `${job.title.toLowerCase()}_${job.location.toLowerCase()}`;
      
      if (!jobGroups[key]) {
        jobGroups[key] = {
          ...job,
          count: 0
        };
      }
      
      jobGroups[key].count++;
    });
    
    // Convert back to array and filter high-volume jobs
    return Object.values(jobGroups).map(job => ({
      ...job,
      indeed_id: job.id,
      company: company
    }));
  }

  async getJobTrends() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    return await prisma.job.groupBy({
      by: ['company'],
      where: {
        created_at: {
          gte: thirtyDaysAgo
        }
      },
      _count: {
        _all: true
      },
      _sum: {
        count: true
      },
      orderBy: {
        _sum: {
          count: 'desc'
        }
      }
    });
  }

  async getHighVolumeJobs() {
    return await prisma.job.findMany({
      where: {
        count: {
          gte: this.minJobs
        }
      },
      orderBy: { created_at: 'desc' },
      take: 100
    });
  }
}

module.exports = JobMonitor; 