const puppeteer = require('puppeteer');
const logger = require('./logger');

class BrowserPool {
  constructor(options = {}) {
    this.maxBrowsers = options.maxBrowsers || 3;
    this.maxConcurrency = options.maxConcurrency || 2;
    this.browserTimeout = options.browserTimeout || 30000;
    this.idleTimeout = options.idleTimeout || 300000; // 5 minutes
    
    this.browsers = [];
    this.activeBrowsers = 0;
    this.queue = [];
    this.isShuttingDown = false;
    
    // Browser configuration
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
        '--disable-ipc-flooding-protection'
      ],
      defaultViewport: {
        width: 1920,
        height: 1080
      }
    };
  }

  async initialize() {
    logger.info('Initializing browser pool', { 
      maxBrowsers: this.maxBrowsers, 
      maxConcurrency: this.maxConcurrency 
    });
    
    // Pre-warm browser pool
    for (let i = 0; i < Math.min(2, this.maxBrowsers); i++) {
      await this.createBrowser();
    }
  }

  async createBrowser() {
    try {
      const startTime = Date.now();
      const browser = await puppeteer.launch(this.browserOptions);
      const duration = Date.now() - startTime;
      
      // Set up browser event listeners
      browser.on('disconnected', () => {
        logger.warn('Browser disconnected', { browserId: browser.process()?.pid });
        this.removeBrowser(browser);
      });

      browser.on('targetcreated', (target) => {
        logger.debug('Browser target created', { browserId: browser.process()?.pid });
      });

      browser.on('targetdestroyed', (target) => {
        logger.debug('Browser target destroyed', { browserId: browser.process()?.pid });
      });

      this.browsers.push({
        browser,
        lastUsed: Date.now(),
        isActive: false
      });

      logger.performance('Browser created', duration, { 
        browserId: browser.process()?.pid,
        totalBrowsers: this.browsers.length 
      });

      return browser;
    } catch (error) {
      logger.error('Failed to create browser', { error: error.message });
      throw error;
    }
  }

  async getBrowser() {
    if (this.isShuttingDown) {
      throw new Error('Browser pool is shutting down');
    }

    // Check if we have an available browser
    const availableBrowser = this.browsers.find(b => !b.isActive);
    
    if (availableBrowser) {
      availableBrowser.isActive = true;
      availableBrowser.lastUsed = Date.now();
      this.activeBrowsers++;
      
      logger.debug('Browser acquired from pool', { 
        browserId: availableBrowser.browser.process()?.pid,
        activeBrowsers: this.activeBrowsers 
      });
      
      return availableBrowser.browser;
    }

    // Check if we can create a new browser
    if (this.browsers.length < this.maxBrowsers) {
      const browser = await this.createBrowser();
      const browserObj = this.browsers.find(b => b.browser === browser);
      if (browserObj) {
        browserObj.isActive = true;
        this.activeBrowsers++;
      }
      return browser;
    }

    // Wait for a browser to become available
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Browser pool timeout'));
      }, this.browserTimeout);

      this.queue.push({ resolve, reject, timeout });
    });
  }

  async releaseBrowser(browser) {
    const browserObj = this.browsers.find(b => b.browser === browser);
    
    if (browserObj) {
      browserObj.isActive = false;
      browserObj.lastUsed = Date.now();
      this.activeBrowsers--;
      
      logger.debug('Browser released to pool', { 
        browserId: browser.process()?.pid,
        activeBrowsers: this.activeBrowsers 
      });

      // Process queue if there are waiting requests
      if (this.queue.length > 0) {
        const { resolve, reject, timeout } = this.queue.shift();
        clearTimeout(timeout);
        resolve(browser);
      }
    }
  }

  async executeWithBrowser(operation) {
    let browser = null;
    const startTime = Date.now();
    
    try {
      browser = await this.getBrowser();
      const result = await operation(browser);
      const duration = Date.now() - startTime;
      
      logger.performance('Browser operation', duration, { 
        browserId: browser.process()?.pid 
      });
      
      return result;
    } catch (error) {
      logger.error('Browser operation failed', { 
        browserId: browser?.process()?.pid,
        error: error.message 
      });
      throw error;
    } finally {
      if (browser) {
        await this.releaseBrowser(browser);
      }
    }
  }

  async createPage(browser) {
    try {
      const page = await browser.newPage();
      
      // Set up page event listeners
      page.on('error', (error) => {
        logger.error('Page error', { error: error.message });
      });

      page.on('pageerror', (error) => {
        logger.error('Page JavaScript error', { error: error.message });
      });

      // Set user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      // Set viewport
      await page.setViewport({ width: 1920, height: 1080 });
      
      // Enable request interception for performance
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        // Block unnecessary resources
        const resourceType = request.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });

      return page;
    } catch (error) {
      logger.error('Failed to create page', { error: error.message });
      throw error;
    }
  }

  removeBrowser(browser) {
    const index = this.browsers.findIndex(b => b.browser === browser);
    if (index !== -1) {
      this.browsers.splice(index, 1);
      if (browser.isActive) {
        this.activeBrowsers--;
      }
    }
  }

  async cleanup() {
    logger.info('Cleaning up browser pool');
    
    // Close all browsers
    const closePromises = this.browsers.map(async (browserObj) => {
      try {
        await browserObj.browser.close();
        logger.debug('Browser closed', { browserId: browserObj.browser.process()?.pid });
      } catch (error) {
        logger.error('Error closing browser', { 
          browserId: browserObj.browser.process()?.pid,
          error: error.message 
        });
      }
    });

    await Promise.all(closePromises);
    this.browsers = [];
    this.activeBrowsers = 0;
    
    // Clear queue
    this.queue.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('Browser pool shutdown'));
    });
    this.queue = [];
  }

  async healthCheck() {
    const stats = {
      totalBrowsers: this.browsers.length,
      activeBrowsers: this.activeBrowsers,
      queueLength: this.queue.length,
      memoryUsage: process.memoryUsage()
    };

    // Clean up idle browsers
    const now = Date.now();
    const idleBrowsers = this.browsers.filter(b => 
      !b.isActive && (now - b.lastUsed) > this.idleTimeout
    );

    for (const browserObj of idleBrowsers) {
      try {
        await browserObj.browser.close();
        this.removeBrowser(browserObj.browser);
        logger.info('Closed idle browser', { browserId: browserObj.browser.process()?.pid });
      } catch (error) {
        logger.error('Error closing idle browser', { error: error.message });
      }
    }

    logger.info('Browser pool health check', stats);
    return stats;
  }

  getStats() {
    return {
      totalBrowsers: this.browsers.length,
      activeBrowsers: this.activeBrowsers,
      queueLength: this.queue.length,
      maxBrowsers: this.maxBrowsers,
      maxConcurrency: this.maxConcurrency,
      memoryUsage: process.memoryUsage()
    };
  }

  async shutdown() {
    logger.info('Shutting down browser pool');
    this.isShuttingDown = true;
    await this.cleanup();
  }
}

// Create singleton instance
const browserPool = new BrowserPool();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await browserPool.shutdown();
});

process.on('SIGINT', async () => {
  await browserPool.shutdown();
});

module.exports = browserPool; 