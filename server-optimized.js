const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const { body, validationResult } = require('express-validator');

// Import utilities
const logger = require('./src/utils/logger');
const cacheManager = require('./src/utils/cache');
const browserPool = require('./src/utils/browser-pool');

// Import modules
const Scheduler = require('./src/scheduler');
const IrvinePermitsScraper = require('./src/scrapers/irvine-permits');
const JobMonitor = require('./src/scrapers/job-monitor');
const AIPredictor = require('./src/analysis/ai-predictor');
const EmailSender = require('./src/alerts/email-sender');

// Load environment variables
dotenv.config();

// Initialize
const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Enhanced Prisma client with connection pooling
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  },
  log: NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error']
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

// Compression middleware
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: {
    error: 'Too many API requests, please try again later.'
  }
});

app.use('/api/', apiLimiter);
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use(express.static('public'));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });
  });
  next();
});

// Initialize services
let scheduler, permitsScraper, jobMonitor, aiPredictor, emailSender;

async function initializeServices() {
  try {
    scheduler = new Scheduler();
    permitsScraper = new IrvinePermitsScraper();
    jobMonitor = new JobMonitor();
    aiPredictor = new AIPredictor();
    emailSender = new EmailSender();
    
    // Initialize browser pool
    await browserPool.initialize();
    
    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services', { error: error.message });
    throw error;
  }
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'IntelliSense Real Estate Intelligence',
    version: '1.0.0',
    description: 'Orange County business expansion monitoring system',
    status: 'operational',
    environment: NODE_ENV,
    endpoints: {
      health: '/health',
      predictions: '/predictions',
      permits: '/permits',
      jobs: '/jobs',
      stats: '/stats',
      cache: '/cache',
      manual: {
        scrapePermits: '/manual/scrape-permits',
        monitorJobs: '/manual/monitor-jobs',
        analyze: '/manual/analyze',
        testEmail: '/manual/test-email'
      }
    }
  });
});

// Enhanced health check endpoint
app.get('/health', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Check database connection
    let dbStatus = 'connected';
    let dbLatency = 0;
    
    try {
      const dbStart = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - dbStart;
    } catch (dbError) {
      dbStatus = `error: ${dbError.message}`;
    }
    
    // Check browser pool
    const browserStats = browserPool.getStats();
    
    // Check cache stats
    const cacheStats = cacheManager.getStats();
    
    // Get system stats
    const stats = await getSystemStats();
    
    const isSupabase = process.env.DATABASE_URL?.includes('supabase.co');
    const mode = isSupabase ? 'production (supabase)' : 'demo (local)';
    
    const healthData = {
      status: dbStatus === 'connected' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: NODE_ENV,
      database: {
        status: dbStatus,
        latency: `${dbLatency}ms`,
        type: isSupabase ? 'supabase' : 'local/demo'
      },
      browserPool: browserStats,
      cache: cacheStats,
      scheduler: isSupabase ? 'enabled' : 'disabled (demo mode)',
      mode,
      stats,
      responseTime: `${Date.now() - startTime}ms`
    };
    
    const statusCode = dbStatus === 'connected' ? 200 : 503;
    res.status(statusCode).json(healthData);
    
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get system statistics
app.get('/stats', async (req, res) => {
  try {
    const stats = await getSystemStats();
    const cacheStats = cacheManager.getStats();
    const browserStats = browserPool.getStats();
    
    res.json({
      system: stats,
      cache: cacheStats,
      browserPool: browserStats,
      memory: process.memoryUsage(),
      uptime: process.uptime()
    });
  } catch (error) {
    logger.error('Failed to get stats', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Cache management endpoint
app.get('/cache', (req, res) => {
  const stats = cacheManager.getStats();
  res.json(stats);
});

app.post('/cache/clear', (req, res) => {
  try {
    cacheManager.clearAll();
    res.json({ success: true, message: 'All caches cleared' });
  } catch (error) {
    logger.error('Failed to clear cache', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get recent predictions with caching
app.get('/predictions', async (req, res) => {
  try {
    const predictions = await cacheManager.getDBCache(
      'recent_predictions',
      async () => {
        const startTime = Date.now();
        const result = await prisma.prediction.findMany({
          orderBy: { created_at: 'desc' },
          take: 50
        });
        const duration = Date.now() - startTime;
        logger.db('fetch_predictions', duration, null, { count: result.length });
        return result;
      }
    );
    
    res.json({
      count: predictions.length,
      predictions,
      cached: true
    });
    
  } catch (error) {
    logger.error('Failed to get predictions', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get recent permits with caching
app.get('/permits', async (req, res) => {
  try {
    const permits = await cacheManager.getDBCache(
      'recent_permits',
      async () => {
        const startTime = Date.now();
        const result = await prisma.permit.findMany({
          orderBy: { created_at: 'desc' },
          take: 50
        });
        const duration = Date.now() - startTime;
        logger.db('fetch_permits', duration, null, { count: result.length });
        return result;
      }
    );
    
    res.json({
      count: permits.length,
      permits,
      cached: true
    });
    
  } catch (error) {
    logger.error('Failed to get permits', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get recent jobs with caching
app.get('/jobs', async (req, res) => {
  try {
    const jobs = await cacheManager.getDBCache(
      'recent_jobs',
      async () => {
        const startTime = Date.now();
        const result = await prisma.job.findMany({
          orderBy: { created_at: 'desc' },
          take: 50
        });
        const duration = Date.now() - startTime;
        logger.db('fetch_jobs', duration, null, { count: result.length });
        return result;
      }
    );
    
    res.json({
      count: jobs.length,
      jobs,
      cached: true
    });
    
  } catch (error) {
    logger.error('Failed to get jobs', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger endpoints with validation
app.post('/manual/scrape-permits', 
  [body('force').optional().isBoolean()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      logger.scheduler('manual_permits_scrape', 'started');
      const startTime = Date.now();
      
      const permits = await scheduler.triggerPermitsScrape();
      const duration = Date.now() - startTime;
      
      // Invalidate relevant caches
      cacheManager.invalidateCache('db', 'permits');
      cacheManager.invalidateCache('scraping', 'permits');
      
      logger.scheduler('manual_permits_scrape', 'completed', duration, null, { count: permits.length });
      
      res.json({
        success: true,
        message: 'Permits scrape completed',
        count: permits.length,
        duration: `${duration}ms`,
        permits
      });
    } catch (error) {
      logger.scheduler('manual_permits_scrape', 'failed', null, error);
      res.status(500).json({ error: error.message });
    }
  }
);

app.post('/manual/monitor-jobs',
  [body('force').optional().isBoolean()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      logger.scheduler('manual_job_monitor', 'started');
      const startTime = Date.now();
      
      const jobs = await scheduler.triggerJobMonitor();
      const duration = Date.now() - startTime;
      
      // Invalidate relevant caches
      cacheManager.invalidateCache('db', 'jobs');
      cacheManager.invalidateCache('scraping', 'jobs');
      
      logger.scheduler('manual_job_monitor', 'completed', duration, null, { count: jobs.length });
      
      res.json({
        success: true,
        message: 'Job monitoring completed',
        count: jobs.length,
        duration: `${duration}ms`,
        jobs
      });
    } catch (error) {
      logger.scheduler('manual_job_monitor', 'failed', null, error);
      res.status(500).json({ error: error.message });
    }
  }
);

app.post('/manual/analyze',
  [body('force').optional().isBoolean()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      logger.scheduler('manual_analysis', 'started');
      const startTime = Date.now();
      
      const predictions = await scheduler.triggerAnalysis();
      const duration = Date.now() - startTime;
      
      // Invalidate relevant caches
      cacheManager.invalidateCache('db', 'predictions');
      cacheManager.invalidateCache('ai', 'analysis');
      
      logger.scheduler('manual_analysis', 'completed', duration, null, { count: predictions.length });
      
      res.json({
        success: true,
        message: 'Analysis completed',
        count: predictions.length,
        duration: `${duration}ms`,
        predictions
      });
    } catch (error) {
      logger.scheduler('manual_analysis', 'failed', null, error);
      res.status(500).json({ error: error.message });
    }
  }
);

app.post('/manual/test-email',
  [body('recipient').optional().isEmail()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      logger.email('test', 'started', req.body.recipient);
      const startTime = Date.now();
      
      // Test email connection
      const connectionTest = await emailSender.testConnection();
      
      if (connectionTest) {
        // Send test prediction alert
        const testPrediction = {
          company_name: 'Test Company',
          confidence_score: 95,
          location: 'Irvine, CA',
          timeline_days: 30,
          evidence: ['Test permit filed', 'Test job postings detected'],
          action_recommendation: 'This is a test alert - IntelliSense is working!'
        };
        
        await emailSender.sendExpansionAlert(testPrediction);
        const duration = Date.now() - startTime;
        
        logger.email('test', 'completed', req.body.recipient, null, { duration });
        
        res.json({
          success: true,
          message: 'Test email sent successfully',
          duration: `${duration}ms`
        });
      } else {
        logger.email('test', 'failed', req.body.recipient, new Error('Email connection failed'));
        res.status(500).json({
          success: false,
          error: 'Email connection failed'
        });
      }
      
    } catch (error) {
      logger.email('test', 'failed', req.body.recipient, error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Server error', { 
    error: error.message, 
    stack: error.stack,
    url: req.url,
    method: req.method
  });
  
  res.status(500).json({
    error: 'Internal server error',
    message: NODE_ENV === 'development' ? error.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.url} not found`,
    timestamp: new Date().toISOString()
  });
});

// Helper function to get system stats
async function getSystemStats() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [
      totalPermits,
      todayPermits,
      totalPredictions,
      todayPredictions,
      recentLogs
    ] = await Promise.all([
      prisma.permit.count(),
      prisma.permit.count({
        where: { created_at: { gte: today } }
      }),
      prisma.prediction.count(),
      prisma.prediction.count({
        where: { created_at: { gte: today } }
      }),
      prisma.scrapingLog.findMany({
        orderBy: { created_at: 'desc' },
        take: 10
      })
    ]);
    
    return {
      stats: {
        totalPermits,
        todayPermits,
        totalPredictions,
        todayPredictions
      },
      lastScrapes: {
        permits: recentLogs.find(log => log.source === 'permits')?.created_at,
        jobs: recentLogs.find(log => log.source === 'jobs')?.created_at
      }
    };
    
  } catch (error) {
    logger.error('Error getting system stats', { error: error.message });
    return {
      stats: { error: 'Unable to fetch stats' },
      lastScrapes: {}
    };
  }
}

// Start server
async function startServer() {
  try {
    const isSupabase = process.env.DATABASE_URL?.includes('supabase.co');
    
    // Test database connection
    if (isSupabase) {
      try {
        await prisma.$connect();
        await prisma.$queryRaw`SELECT 1`;
        logger.info('Supabase database connected');
      } catch (dbError) {
        logger.warn('Supabase connection failed, running in demo mode', { error: dbError.message });
      }
    } else {
      logger.warn('Local/demo mode - database features limited');
    }
    
    // Initialize services
    await initializeServices();
    
    // Start the scheduler (only for Supabase)
    if (isSupabase) {
      scheduler.start();
      logger.info('Scheduler enabled (Supabase mode)');
    } else {
      logger.warn('Scheduler disabled (demo mode)');
    }
    
    // Start Express server
    app.listen(PORT, () => {
      logger.info(`IntelliSense server running on port ${PORT}`, {
        port: PORT,
        environment: NODE_ENV,
        database: isSupabase ? 'supabase' : 'demo',
        healthCheck: `http://localhost:${PORT}/health`,
        dashboard: `http://localhost:${PORT}`,
        api: `http://localhost:${PORT}/api`
      });
    });
    
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

// Graceful shutdown
async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  
  try {
    // Close database connection
    await prisma.$disconnect();
    
    // Shutdown browser pool
    await browserPool.shutdown();
    
    // Shutdown cache manager
    cacheManager.shutdown();
    
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown', { error: error.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the application
if (require.main === module) {
  startServer();
}

module.exports = app; 