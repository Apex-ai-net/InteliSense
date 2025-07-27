const puppeteer = require('puppeteer');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class IrvinePermitsScraper {
  constructor() {
    this.baseUrl = 'https://aca-prod.accela.com/IRVINE/';
    this.minValue = 1000000; // $1M minimum
  }

  async scrape() {
    console.log('🏗️  Starting Irvine permits scrape...');
    let browser;
    
    try {
      // Log scraping attempt
      await prisma.scrapingLog.create({
        data: {
          source: 'permits',
          status: 'started',
          items_found: 0
        }
      });

      browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      // Navigate to Irvine permits portal
      await page.goto(this.baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Look for permits search or recent permits
      // This is a basic implementation - may need adjustment based on actual site structure
      const permits = await this.scrapePermitsFromPage(page);
      
      // Filter permits by value
      const highValuePermits = permits.filter(permit => 
        permit.value && permit.value >= this.minValue
      );
      
      console.log(`📋 Found ${permits.length} permits, ${highValuePermits.length} high-value`);
      
      // Save to database
      for (const permit of highValuePermits) {
        try {
          await prisma.permit.upsert({
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
          });
        } catch (error) {
          console.error('Error saving permit:', error);
        }
      }
      
      // Log successful scraping
      await prisma.scrapingLog.create({
        data: {
          source: 'permits',
          status: 'success',
          items_found: highValuePermits.length
        }
      });
      
      return highValuePermits;
      
    } catch (error) {
      console.error('❌ Error scraping permits:', error);
      
      // Log error
      await prisma.scrapingLog.create({
        data: {
          source: 'permits',
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

  async scrapePermitsFromPage(page) {
    try {
      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Try to find and click on "Building Permits" or similar link
      const buildingLink = await page.$('a[href*="building"], a[href*="permit"], .building-permits, .permits');
      if (buildingLink) {
        await buildingLink.click();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Look for search functionality or recent permits
      const searchButton = await page.$('input[type="submit"][value*="Search"], button[type="submit"], .search-button');
      if (searchButton) {
        await searchButton.click();
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // Try to find permit records table or list
      const permitTable = await page.$('table, .records-table, .permits-table, .data-table');
      if (!permitTable) {
        console.log('⚠️  No permit table found, trying alternative selectors...');
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
      console.error('Error parsing permits page:', error);
      
      // Return empty array instead of test data
      return [];
    }
  }
}

module.exports = IrvinePermitsScraper; 