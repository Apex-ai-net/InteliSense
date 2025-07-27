const NodeCache = require('node-cache');
const logger = require('./logger');

class CacheManager {
  constructor() {
    // Main cache for general data
    this.mainCache = new NodeCache({
      stdTTL: 3600, // 1 hour default
      checkperiod: 600, // Check for expired keys every 10 minutes
      useClones: false,
      deleteOnExpire: true
    });

    // AI response cache
    this.aiCache = new NodeCache({
      stdTTL: 7200, // 2 hours for AI responses
      checkperiod: 600,
      useClones: false,
      deleteOnExpire: true
    });

    // Database query cache
    this.dbCache = new NodeCache({
      stdTTL: 1800, // 30 minutes for DB queries
      checkperiod: 300,
      useClones: false,
      deleteOnExpire: true
    });

    // Scraping result cache
    this.scrapingCache = new NodeCache({
      stdTTL: 900, // 15 minutes for scraping results
      checkperiod: 300,
      useClones: false,
      deleteOnExpire: true
    });

    // Set up event listeners for monitoring
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Monitor cache performance
    this.mainCache.on('expired', (key, value) => {
      logger.info('Cache expired', { cache: 'main', key });
    });

    this.aiCache.on('expired', (key, value) => {
      logger.info('Cache expired', { cache: 'ai', key });
    });

    this.dbCache.on('expired', (key, value) => {
      logger.info('Cache expired', { cache: 'db', key });
    });

    this.scrapingCache.on('expired', (key, value) => {
      logger.info('Cache expired', { cache: 'scraping', key });
    });
  }

  // Generic cache wrapper with logging
  async getOrSet(cache, key, fetchFunction, ttl = null) {
    try {
      // Try to get from cache first
      const cached = cache.get(key);
      if (cached !== undefined) {
        logger.info('Cache hit', { cache: cache.constructor.name, key });
        return cached;
      }

      // Cache miss, fetch data
      logger.info('Cache miss', { cache: cache.constructor.name, key });
      const startTime = Date.now();
      const data = await fetchFunction();
      const duration = Date.now() - startTime;

      // Store in cache
      if (ttl) {
        cache.set(key, data, ttl);
      } else {
        cache.set(key, data);
      }

      logger.performance('Cache fetch', duration, { cache: cache.constructor.name, key });
      return data;

    } catch (error) {
      logger.error('Cache error', { cache: cache.constructor.name, key, error: error.message });
      throw error;
    }
  }

  // AI response caching
  async getAICache(key, fetchFunction, ttl = 7200) {
    return this.getOrSet(this.aiCache, key, fetchFunction, ttl);
  }

  // Database query caching
  async getDBCache(key, fetchFunction, ttl = 1800) {
    return this.getOrSet(this.dbCache, key, fetchFunction, ttl);
  }

  // Scraping result caching
  async getScrapingCache(key, fetchFunction, ttl = 900) {
    return this.getOrSet(this.scrapingCache, key, fetchFunction, ttl);
  }

  // Main cache operations
  async getMainCache(key, fetchFunction, ttl = 3600) {
    return this.getOrSet(this.mainCache, key, fetchFunction, ttl);
  }

  // Cache invalidation
  invalidateCache(cacheType, pattern) {
    const cache = this.getCacheByType(cacheType);
    if (!cache) {
      logger.error('Invalid cache type', { cacheType });
      return;
    }

    const keys = cache.keys();
    const matchingKeys = keys.filter(key => key.includes(pattern));
    
    matchingKeys.forEach(key => {
      cache.del(key);
      logger.info('Cache invalidated', { cacheType, key });
    });

    return matchingKeys.length;
  }

  getCacheByType(type) {
    switch (type) {
      case 'ai': return this.aiCache;
      case 'db': return this.dbCache;
      case 'scraping': return this.scrapingCache;
      case 'main': return this.mainCache;
      default: return null;
    }
  }

  // Get cache statistics
  getStats() {
    return {
      main: {
        keys: this.mainCache.keys().length,
        hits: this.mainCache.getStats().hits,
        misses: this.mainCache.getStats().misses,
        keyspace: this.mainCache.keys()
      },
      ai: {
        keys: this.aiCache.keys().length,
        hits: this.aiCache.getStats().hits,
        misses: this.aiCache.getStats().misses,
        keyspace: this.aiCache.keys()
      },
      db: {
        keys: this.dbCache.keys().length,
        hits: this.dbCache.getStats().hits,
        misses: this.dbCache.getStats().misses,
        keyspace: this.dbCache.keys()
      },
      scraping: {
        keys: this.scrapingCache.keys().length,
        hits: this.scrapingCache.getStats().hits,
        misses: this.scrapingCache.getStats().misses,
        keyspace: this.scrapingCache.keys()
      }
    };
  }

  // Clear all caches
  clearAll() {
    this.mainCache.flushAll();
    this.aiCache.flushAll();
    this.dbCache.flushAll();
    this.scrapingCache.flushAll();
    logger.info('All caches cleared');
  }

  // Graceful shutdown
  shutdown() {
    this.mainCache.close();
    this.aiCache.close();
    this.dbCache.close();
    this.scrapingCache.close();
    logger.info('Cache manager shutdown complete');
  }
}

// Create singleton instance
const cacheManager = new CacheManager();

// Graceful shutdown
process.on('SIGTERM', () => {
  cacheManager.shutdown();
});

process.on('SIGINT', () => {
  cacheManager.shutdown();
});

module.exports = cacheManager; 