const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const cacheManager = require('../utils/cache');
const browserPool = require('../utils/browser-pool');

class OptimizedIrvinePermitsScraper {
  constructor() {
    this.prisma = new PrismaClient();
    this.baseUrl = 'https://aca-prod.accela.com/IRVINE/';
    this.minValue = 1000000; // $1M minimum
    this.maxRetries = 3;
    this.timeout = 60000; // 60 seconds
  }

  async scrape() {
    const startTime = Date.now();
    logger.scraping('permits', 'started', 0);
    
    try {
      // Log scraping attempt
      await this.logScrapingAttempt('started');
      
      // Use browser pool for better resource management
      const permits = await browserPool.executeWithBrowser(async (browser) => {
        return await this.scrapeWithBrowser(browser);
      });
      
      // Filter permits by value
      const highValuePermits = permits.filter(permit => 
        permit.value && permit.value >= this.minValue
      );
      
      // Save to database in batches
      await this.savePermitsToDatabase(highValuePermits);
      
      // Log successful scraping
      await this.logScrapingAttempt('success', highValuePermits.length);
      
      const duration = Date.now() - startTime;
      logger.performance('Permits scraping', duration, {
        total: permits.length,
        highValue: highValuePermits.length
      });
      
      // Cache the results
      cacheManager.getScrapingCache('permits_recent', () => Promise.resolve(highValuePermits), 900);
      
      return highValuePermits;
      
    } catch (error) {
      logger.scraping('permits', 'error', 0, error);
      await this.logScrapingAttempt('error', 0, error.message);
      throw error;
    }
  }

  async scrapeWithBrowser(browser) {
    const page = await browserPool.createPage(browser);
    
    try {
      // Navigate to Irvine permits portal
      await page.goto(this.baseUrl, { 
        waitUntil: 'networkidle2', 
        timeout: this.timeout 
      });
      
      // Look for permits search or recent permits
      const permits = await this.scrapePermitsFromPage(page);
      
      return permits;
      
    } finally {
      await page.close();
    }
  }

  async scrapePermitsFromPage(page) {
    try {
      // Wait for page to load
      await this.sleep(3000);
      
      // Try to find and click on "Building Permits" or similar link
      const buildingLink = await page.$('a[href*="building"], a[href*="permit"], .building-permits, .permits');
      if (buildingLink) {
        await buildingLink.click();
        await this.sleep(2000);
      }
      
      // Look for search functionality or recent permits
      const searchButton = await page.$('input[type="submit"][value*="Search"], button[type="submit"], .search-button');
      if (searchButton) {
        await searchButton.click();
        await this.sleep(3000);
      }
      
      // Try to find permit records table or list
      const permitTable = await page.$('table, .records-table, .permits-table, .data-table');
      if (!permitTable) {
        logger.warn('No permit table found, trying alternative selectors...');
      }
      
      // Extract permit data from the page with improved parsing
      const permits = await page.evaluate(() => {
        // Try multiple selectors for permit records
        const selectors = [
          'tr[data-permit]',
          '.permit-row',
          '.record-row', 
          'tr:has(td)',
          '.permit-item',
          '.record-item'
        ];
        
        let permitElements = [];
        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            permitElements = Array.from(elements);
            break;
          }
        }
        
        const permits = [];
        
        permitElements.forEach((element, index) => {
          const text = element.innerText || element.textContent || '';
          
          // Enhanced permit value extraction
          const valuePatterns = [
            /\$?([\d,]+(?:\.\d{2})?)/g,
            /value[:\s]*\$?([\d,]+(?:\.\d{2})?)/i,
            /amount[:\s]*\$?([\d,]+(?:\.\d{2})?)/i
          ];
          
          let value = null;
          for (const pattern of valuePatterns) {
            const matches = text.match(pattern);
            if (matches && matches.length > 0) {
              // Get the largest value found
              const values = matches.map(m => parseFloat(m.replace(/[$,]/g, ''))).filter(v => !isNaN(v));
              if (values.length > 0) {
                value = Math.max(...values);
                break;
              }
            }
          }
          
          // Enhanced address extraction
          const addressPatterns = [
            /(\d+\s+[A-Za-z\s]+(?:St|Ave|Blvd|Dr|Rd|Way|Ct|Ln))/i,
            /address[:\s]*([A-Za-z\s\d,]+(?:St|Ave|Blvd|Dr|Rd|Way|Ct|Ln))/i,
            /location[:\s]*([A-Za-z\s\d,]+(?:St|Ave|Blvd|Dr|Rd|Way|Ct|Ln))/i
          ];
          
          let address = null;
          for (const pattern of addressPatterns) {
            const match = text.match(pattern);
            if (match) {
              address = match[1].trim();
              break;
            }
          }
          
          // Enhanced applicant name extraction
          const applicantPatterns = [
            /applicant[:\s]+([A-Za-z\s,\.&]+?)(?:\s|$)/i,
            /owner[:\s]+([A-Za-z\s,\.&]+?)(?:\s|$)/i,
            /company[:\s]+([A-Za-z\s,\.&]+?)(?:\s|$)/i,
            /contractor[:\s]+([A-Za-z\s,\.&]+?)(?:\s|$)/i,
            /([A-Za-z\s,\.&]+(?:LLC|Inc|Corp|Corporation|Company|Co\.|Ltd|LP|LLP))/i,
            /([A-Za-z\s,\.&]+(?:Real Estate|Development|Properties|Investments))/i
          ];
          
          let applicant = null;
          for (const pattern of applicantPatterns) {
            const match = text.match(pattern);
            if (match) {
              applicant = match[1].trim();
              // Clean up the applicant name
              applicant = applicant.replace(/^[:\s]+/, '').replace(/[:\s]+$/, '');
              break;
            }
          }
          
          // Only create permit if we have meaningful data
          if (value && value >= 1000000) { // Only high-value permits
            const permit = {
              id: `permit_${Date.now()}_${index}`,
              value: value,
              address: address || 'Address not specified',
              description: text.substring(0, 200),
              applicant: applicant || 'Applicant not specified',
              date_filed: new Date()
            };
            
            permits.push(permit);
          }
        });
        
        return permits;
      });
      
      return permits;
      
    } catch (error) {
      logger.error('Error parsing permits page', { error: error.message });
      return [];
    }
  }

  async savePermitsToDatabase(permits) {
    if (permits.length === 0) {
      logger.info('No permits to save');
      return;
    }

    const batchSize = 10;
    const batches = [];
    
    for (let i = 0; i < permits.length; i += batchSize) {
      batches.push(permits.slice(i, i + batchSize));
    }
    
    let savedCount = 0;
    let errorCount = 0;
    
    for (const batch of batches) {
      try {
        const batchPromises = batch.map(permit => 
          this.prisma.permit.upsert({
            where: { permit_id: permit.permit_id || permit.id },
            update: {
              value: permit.value,
              address: permit.address,
              description: permit.description,
              applicant: permit.applicant,
              date_filed: permit.date_filed
            },
            create: {
              permit_id: permit.permit_id || permit.id,
              value: permit.value,
              address: permit.address,
              description: permit.description,
              applicant: permit.applicant,
              date_filed: permit.date_filed
            }
          })
        );
        
        await Promise.all(batchPromises);
        savedCount += batch.length;
        
      } catch (error) {
        errorCount += batch.length;
        logger.error('Error saving permit batch', { 
          error: error.message,
          batchSize: batch.length 
        });
      }
    }
    
    logger.info('Permits saved to database', {
      total: permits.length,
      saved: savedCount,
      errors: errorCount
    });
  }

  async logScrapingAttempt(status, itemsFound = 0, errorMsg = null) {
    try {
      await this.prisma.scrapingLog.create({
        data: {
          source: 'permits',
          status: status,
          items_found: itemsFound,
          error_msg: errorMsg
        }
      });
    } catch (error) {
      logger.error('Failed to log scraping attempt', { error: error.message });
    }
  }

  async getRecentPermits(limit = 50) {
    return await cacheManager.getDBCache(
      `recent_permits_${limit}`,
      async () => {
        const startTime = Date.now();
        const permits = await this.prisma.permit.findMany({
          orderBy: { created_at: 'desc' },
          take: limit
        });
        const duration = Date.now() - startTime;
        
        logger.db('fetch_recent_permits', duration, null, { limit, count: permits.length });
        return permits;
      },
      1800 // 30 minutes cache
    );
  }

  async getHighValuePermits(minValue = 1000000) {
    return await cacheManager.getDBCache(
      `high_value_permits_${minValue}`,
      async () => {
        const startTime = Date.now();
        const permits = await this.prisma.permit.findMany({
          where: {
            value: {
              gte: minValue
            }
          },
          orderBy: { created_at: 'desc' },
          take: 100
        });
        const duration = Date.now() - startTime;
        
        logger.db('fetch_high_value_permits', duration, null, { minValue, count: permits.length });
        return permits;
      },
      3600 // 1 hour cache
    );
  }

  async getPermitStats() {
    return await cacheManager.getDBCache(
      'permit_stats',
      async () => {
        const startTime = Date.now();
        
        const [totalPermits, highValuePermits, todayPermits] = await Promise.all([
          this.prisma.permit.count(),
          this.prisma.permit.count({
            where: {
              value: {
                gte: this.minValue
              }
            }
          }),
          this.prisma.permit.count({
            where: {
              created_at: {
                gte: new Date(new Date().setHours(0, 0, 0, 0))
              }
            }
          })
        ]);
        
        const duration = Date.now() - startTime;
        logger.db('fetch_permit_stats', duration);
        
        return {
          totalPermits,
          highValuePermits,
          todayPermits,
          averageValue: highValuePermits > 0 ? totalPermits / highValuePermits : 0
        };
      },
      1800 // 30 minutes cache
    );
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async shutdown() {
    try {
      await this.prisma.$disconnect();
      logger.info('Irvine permits scraper shutdown completed');
    } catch (error) {
      logger.error('Error during scraper shutdown', { error: error.message });
    }
  }
}

module.exports = OptimizedIrvinePermitsScraper; 