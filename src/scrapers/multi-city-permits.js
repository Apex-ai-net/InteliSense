const puppeteer = require('puppeteer');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const cacheManager = require('../utils/cache');
const browserPool = require('../utils/browser-pool');

class MultiCityPermitsScraper {
  constructor() {
    this.prisma = new PrismaClient();
    this.minValue = 1000000; // $1M minimum
    this.maxRetries = 3;
    this.timeout = 60000; // 60 seconds
    
    // Configure different city permit systems
    this.cities = {
      'irvine': {
        name: 'Irvine',
        baseUrl: 'https://aca-prod.accela.com/IRVINE/',
        type: 'accela',
        enabled: true
      },
      'newport-beach': {
        name: 'Newport Beach',
        baseUrl: 'https://nbgis.newportbeachca.gov/gispub/NeighborhoodMap/default.aspx',
        type: 'gis',
        enabled: true
      },
      'tustin': {
        name: 'Tustin',
        baseUrl: 'https://tustin.getapermit.net/',
        type: 'getapermit',
        enabled: true
      },
      'anaheim': {
        name: 'Anaheim',
        baseUrl: 'https://www.anaheim.net/6015/Online-Permit-Center',
        type: 'custom',
        enabled: true
      },
      'costa-mesa': {
        name: 'Costa Mesa',
        baseUrl: 'https://www.costamesaca.gov/',
        type: 'custom',
        enabled: false // Enable after testing
      }
    };
  }

  async scrapeAllCities() {
    const startTime = Date.now();
    logger.info('Starting multi-city permits scrape', { service: 'intellisense' });
    const results = [];

    try {
      await this.logScrapingAttempt('started');

      for (const [cityKey, cityConfig] of Object.entries(this.cities)) {
        if (!cityConfig.enabled) {
          logger.info(`Skipping ${cityConfig.name} - disabled`, { service: 'intellisense' });
          continue;
        }

        try {
          logger.info(`Starting permit scrape for ${cityConfig.name}`, { service: 'intellisense' });
          const cityPermits = await this.scrapeCityPermits(cityKey, cityConfig);
          results.push(...cityPermits);
          
          logger.info(`Found ${cityPermits.length} high-value permits in ${cityConfig.name}`, { service: 'intellisense' });
        } catch (error) {
          logger.error(`Error scraping ${cityConfig.name} permits:`, error);
          // Continue with other cities even if one fails
        }
      }

      // Save all permits to database
      await this.savePermitsToDatabase(results);

      // Log successful scraping
      await this.logScrapingAttempt('success', results.length);

      const duration = Date.now() - startTime;
      logger.performance('Multi-city permits scraping', duration, {
        total: results.length,
        cities: Object.keys(this.cities).filter(k => this.cities[k].enabled).length
      });

      // Cache the results
      cacheManager.getScrapingCache('permits_multi_city', () => Promise.resolve(results), 900);

      return results;

    } catch (error) {
      logger.error('❌ Error scraping multi-city permits:', error);
      await this.logScrapingAttempt('error', 0, error.message);
      throw error;
    }
  }

  async scrapeCityPermits(cityKey, cityConfig) {
    return await browserPool.executeWithBrowser(async (browser) => {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

      try {
        // Route to appropriate scraper based on system type
        switch (cityConfig.type) {
          case 'accela':
            return await this.scrapeAccelaSystem(page, cityConfig);
          case 'gis':
            return await this.scrapeGISSystem(page, cityConfig);
          case 'getapermit':
            return await this.scrapeGetPermitSystem(page, cityConfig);
          case 'custom':
            return await this.scrapeCustomSystem(page, cityConfig, cityKey);
          default:
            logger.warn(`Unknown permit system type: ${cityConfig.type} for ${cityConfig.name}`);
            return [];
        }
      } catch (error) {
        logger.error(`Error scraping ${cityConfig.name}:`, error);
        return [];
      } finally {
        await page.close();
      }
    });
  }

  async scrapeAccelaSystem(page, cityConfig) {
    logger.info(`Scraping Accela system for ${cityConfig.name}`, { service: 'intellisense' });
    
    await page.goto(cityConfig.baseUrl, { waitUntil: 'networkidle2', timeout: this.timeout });
    
    // Similar to existing Irvine scraper logic but adapted for multi-city
    const permits = await this.scrapePermitsFromAccelaPage(page);
    
    return permits.filter(permit => 
      permit.value && permit.value >= this.minValue
    ).map(permit => ({
      ...permit,
      city: cityConfig.name,
      source_url: cityConfig.baseUrl
    }));
  }

  async scrapeGISSystem(page, cityConfig) {
    logger.info(`Scraping GIS system for ${cityConfig.name}`, { service: 'intellisense' });
    
    try {
      await page.goto(cityConfig.baseUrl, { waitUntil: 'networkidle2', timeout: this.timeout });
      await page.waitFor(3000);
      
      // Extract permit data from GIS interface
      const permits = await page.evaluate(() => {
        const permitElements = document.querySelectorAll('[class*="permit"], [class*="building"], tr, .record, div');
        const permits = [];
        
        permitElements.forEach((element, index) => {
          const text = element.innerText || element.textContent || '';
          
          // Look for permit values in various formats
          const valueMatch = text.match(/\$?([\d,]+(?:\.\d{2})?)/g);
          if (valueMatch) {
            const values = valueMatch.map(m => parseFloat(m.replace(/[$,]/g, ''))).filter(v => !isNaN(v) && v >= 1000000);
            
            if (values.length > 0) {
              const value = Math.max(...values);
              
              // Extract address
              const addressMatch = text.match(/(\d+\s+[A-Za-z\s]+(?:St|Ave|Blvd|Dr|Rd|Way|Ct|Ln))/i);
              
              // Extract applicant/company name
              const companyMatch = text.match(/([A-Za-z\s,\.&]+(?:LLC|Inc|Corp|Corporation|Company|Co\.|Ltd|LP|LLP))/i);
              
              permits.push({
                id: `newport_permit_${Date.now()}_${index}`,
                permit_id: `NB-${Date.now()}-${index}`,
                value: value,
                address: addressMatch ? addressMatch[1] : 'Newport Beach, CA',
                description: text.substring(0, 200),
                applicant: companyMatch ? companyMatch[1] : 'Applicant not specified',
                date_filed: new Date()
              });
            }
          }
        });
        
        return permits;
      });
      
      return permits.map(permit => ({
        ...permit,
        city: cityConfig.name,
        source_url: cityConfig.baseUrl
      }));
      
    } catch (error) {
      logger.error(`Error with GIS system for ${cityConfig.name}:`, error);
      return [];
    }
  }

  async scrapeGetPermitSystem(page, cityConfig) {
    logger.info(`Scraping GetPermit system for ${cityConfig.name}`, { service: 'intellisense' });
    
    try {
      await page.goto(cityConfig.baseUrl, { waitUntil: 'networkidle2', timeout: this.timeout });
      await page.waitFor(3000);
      
      // Extract permit data
      const permits = await page.evaluate(() => {
        const permitElements = document.querySelectorAll('tr, .permit-item, .record, div');
        const permits = [];
        
        permitElements.forEach((element, index) => {
          const text = element.innerText || element.textContent || '';
          
          // Look for high-value permits
          const valueMatch = text.match(/\$?([\d,]+(?:\.\d{2})?)/g);
          if (valueMatch) {
            const values = valueMatch.map(m => parseFloat(m.replace(/[$,]/g, ''))).filter(v => !isNaN(v) && v >= 1000000);
            
            if (values.length > 0) {
              const value = Math.max(...values);
              
              permits.push({
                id: `tustin_permit_${Date.now()}_${index}`,
                permit_id: `TU-${Date.now()}-${index}`,
                value: value,
                address: 'Tustin, CA',
                description: text.substring(0, 200),
                applicant: 'Applicant not specified',
                date_filed: new Date()
              });
            }
          }
        });
        
        return permits;
      });
      
      return permits.map(permit => ({
        ...permit,
        city: cityConfig.name,
        source_url: cityConfig.baseUrl
      }));
      
    } catch (error) {
      logger.error(`Error with GetPermit system for ${cityConfig.name}:`, error);
      return [];
    }
  }

  async scrapeCustomSystem(page, cityConfig, cityKey) {
    logger.info(`Scraping custom system for ${cityConfig.name}`, { service: 'intellisense' });
    
    if (cityKey === 'anaheim') {
      return await this.scrapeAnaheimSystem(page, cityConfig);
    } else if (cityKey === 'costa-mesa') {
      return await this.scrapeCostaMesaSystem(page, cityConfig);
    }
    
    return [];
  }

  async scrapeAnaheimSystem(page, cityConfig) {
    try {
      await page.goto(cityConfig.baseUrl, { waitUntil: 'networkidle2', timeout: this.timeout });
      await page.waitFor(3000);
      
      // Extract available permit data
      const permits = await page.evaluate(() => {
        const permitElements = document.querySelectorAll('tr, .permit-row, .record, div, a');
        const permits = [];
        
        permitElements.forEach((element, index) => {
          const text = element.innerText || element.textContent || '';
          
          // Look for high-value permits
          const valueMatch = text.match(/\$?([\d,]+(?:\.\d{2})?)/g);
          if (valueMatch) {
            const values = valueMatch.map(m => parseFloat(m.replace(/[$,]/g, ''))).filter(v => !isNaN(v) && v >= 1000000);
            
            if (values.length > 0) {
              const value = Math.max(...values);
              
              permits.push({
                id: `anaheim_permit_${Date.now()}_${index}`,
                permit_id: `AN-${Date.now()}-${index}`,
                value: value,
                address: 'Anaheim, CA',
                description: text.substring(0, 200),
                applicant: 'Applicant not specified',
                date_filed: new Date()
              });
            }
          }
        });
        
        return permits;
      });
      
      return permits.map(permit => ({
        ...permit,
        city: cityConfig.name,
        source_url: cityConfig.baseUrl
      }));
      
    } catch (error) {
      logger.error(`Error with Anaheim system:`, error);
      return [];
    }
  }

  async scrapeCostaMesaSystem(page, cityConfig) {
    // Placeholder for Costa Mesa implementation
    logger.info(`Costa Mesa permit scraping not yet implemented`, { service: 'intellisense' });
    return [];
  }

  async scrapePermitsFromAccelaPage(page) {
    try {
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const buildingLink = await page.$('a[href*="building"], a[href*="permit"], .building-permits, .permits');
      if (buildingLink) {
        await buildingLink.click();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      const searchButton = await page.$('input[type="submit"][value*="Search"], button[type="submit"], .search-button');
      if (searchButton) {
        await searchButton.click();
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      const permits = await page.evaluate(() => {
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
              applicant = applicant.replace(/^[:\s]+/, '').replace(/[:\s]+$/, '');
              break;
            }
          }
          
          if (value && value >= 1000000) {
            const permit = {
              id: `permit_${Date.now()}_${index}`,
              permit_id: `${Date.now()}_${index}`,
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
      logger.error('Error parsing Accela permits page:', error);
      return [];
    }
  }

  async savePermitsToDatabase(permits) {
    for (const permit of permits) {
      try {
        await this.prisma.permit.upsert({
          where: { permit_id: permit.permit_id || permit.id },
          update: {
            value: permit.value,
            address: permit.address,
            description: permit.description,
            applicant: permit.applicant,
            date_filed: permit.date_filed,
            city: permit.city,
            source_url: permit.source_url
          },
          create: {
            permit_id: permit.permit_id || permit.id,
            value: permit.value,
            address: permit.address,
            description: permit.description,
            applicant: permit.applicant,
            date_filed: permit.date_filed,
            city: permit.city,
            source_url: permit.source_url
          }
        });
      } catch (error) {
        logger.error('Error saving permit:', error);
      }
    }
  }

  async logScrapingAttempt(status, itemsFound = 0, errorMsg = null) {
    try {
      await this.prisma.scrapingLog.create({
        data: {
          source: 'multi-city-permits',
          status: status,
          items_found: itemsFound,
          error_msg: errorMsg
        }
      });
    } catch (error) {
      logger.error('Error logging scraping attempt:', error);
    }
  }
}

module.exports = MultiCityPermitsScraper; 