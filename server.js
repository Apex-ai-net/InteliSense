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
const systemMonitor = require('./src/utils/monitor');

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

// Mid-Market Configuration Constants
const CONFIDENCE_THRESHOLD = parseInt(process.env.ALERT_CONFIDENCE_THRESHOLD) || 85;
const MIN_OFFICE_VALUE = parseInt(process.env.MIN_OFFICE_PERMIT_VALUE) || 300000; // $300K
const MIN_INDUSTRIAL_VALUE = parseInt(process.env.MIN_INDUSTRIAL_PERMIT_VALUE) || 500000; // $500K
const MIN_JOB_POSTINGS = parseInt(process.env.MIN_JOB_POSTINGS) || 10;
const TARGET_TIMELINE_DAYS = parseInt(process.env.TARGET_TIMELINE_DAYS) || 45; // 15-60 day range

// Environment variable validation for Railway deployment
function validateEnvironment() {
  const requiredVars = ['DATABASE_URL'];
  const optionalVars = ['OPENAI_API_KEY', 'EMAIL_USER', 'EMAIL_PASS', 'EMAIL_HOST'];
  
  const missing = requiredVars.filter(varName => !process.env[varName]);
  const missingOptional = optionalVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    logger.warn('Missing required environment variables', { missing });
  }
  
  if (missingOptional.length > 0) {
    logger.info('Missing optional environment variables (some features may be limited)', { missingOptional });
  }
  
  logger.info('Environment validation completed', {
    requiredVars: requiredVars.length - missing.length + '/' + requiredVars.length,
    optionalVars: optionalVars.length - missingOptional.length + '/' + optionalVars.length,
    nodeEnv: NODE_ENV,
    port: PORT,
    midMarketConfig: {
      confidenceThreshold: CONFIDENCE_THRESHOLD + '%',
      minOfficeValue: '$' + (MIN_OFFICE_VALUE / 1000) + 'K',
      minIndustrialValue: '$' + (MIN_INDUSTRIAL_VALUE / 1000) + 'K',
      minJobPostings: MIN_JOB_POSTINGS,
      targetTimelineDays: TARGET_TIMELINE_DAYS
    }
  });
}

// Run environment validation
validateEnvironment();

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
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'"],
      scriptSrcAttr: ["'unsafe-inline'"],
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
    
    // Initialize browser pool with error resilience for Railway
    try {
      await browserPool.initialize();
      logger.info('Browser pool initialized successfully');
    } catch (browserError) {
      logger.warn('Browser pool initialization failed, continuing without browser functionality', { 
        error: browserError.message 
      });
      // Continue without browser pool - some features may be limited
    }
    
    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services', { error: error.message });
    // In Railway, we want to continue running even if some services fail
    const isRailwayDeployment = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';
    if (isRailwayDeployment) {
      logger.warn('Continuing with limited functionality due to service initialization failure');
      return; // Don't throw error in Railway
    }
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
    description: 'High-growth mid-market company expansion detection for Orange County',
    strategy: 'mid-market-focus',
    targetCompanies: '$10M-$500M revenue, high-growth, new to Orange County',
    status: 'operational',
    environment: NODE_ENV,
    configuration: {
      confidenceThreshold: CONFIDENCE_THRESHOLD + '%',
      minOfficeValue: '$' + (MIN_OFFICE_VALUE / 1000) + 'K',
      minIndustrialValue: '$' + (MIN_INDUSTRIAL_VALUE / 1000) + 'K',
      minJobPostings: MIN_JOB_POSTINGS,
      targetTimelineDays: TARGET_TIMELINE_DAYS
    },
    endpoints: {
      health: '/health',
      predictions: '/predictions',
      permits: '/permits',
      jobs: '/jobs',
      stats: '/stats',
      cache: '/cache',
      manual: {
        scrapePermits: '/manual/scrape-permits',
        scrapeMultiCityPermits: '/manual/scrape-multi-city-permits',
        monitorJobs: '/manual/monitor-jobs',
        analyze: '/manual/analyze',
        testEmail: '/manual/test-email',
        testAlert: '/manual/test-alert'
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
      strategy: 'mid-market-focus',
      configuration: {
        confidenceThreshold: CONFIDENCE_THRESHOLD + '%',
        minOfficeValue: '$' + (MIN_OFFICE_VALUE / 1000) + 'K',
        minIndustrialValue: '$' + (MIN_INDUSTRIAL_VALUE / 1000) + 'K',
        minJobPostings: MIN_JOB_POSTINGS,
        targetTimelineDays: TARGET_TIMELINE_DAYS
      },
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
      uptime: process.uptime(),
      configuration: {
        strategy: 'mid-market-focus',
        confidenceThreshold: CONFIDENCE_THRESHOLD + '%',
        minOfficeValue: '$' + (MIN_OFFICE_VALUE / 1000) + 'K',
        minIndustrialValue: '$' + (MIN_INDUSTRIAL_VALUE / 1000) + 'K',
        minJobPostings: MIN_JOB_POSTINGS,
        targetTimelineDays: TARGET_TIMELINE_DAYS
      }
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
        message: 'Mid-market permits scrape completed',
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
        message: 'High-growth company job monitoring completed',
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
        message: 'Mid-market expansion analysis completed',
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
        // Send test prediction alert for mid-market company
        const testPrediction = {
          company_name: 'GrowthTech Solutions',
          confidence_score: CONFIDENCE_THRESHOLD + 5,
          location: 'Irvine, CA',
          timeline_days: TARGET_TIMELINE_DAYS,
          evidence: ['$400K office permit filed', '15 job postings detected for Orange County'],
          action_recommendation: 'This is a test alert - IntelliSense mid-market detection is working!'
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

app.post('/manual/test-alert',
  [body('confidence').optional().isNumeric()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      logger.info('Testing mid-market confidence alert system', { service: 'intellisense' });
      const startTime = Date.now();
      
      // Create a test prediction with mid-market threshold
      const testConfidence = req.body.confidence || CONFIDENCE_THRESHOLD + 5;
      const testPrediction = {
        company: 'FastGrow Manufacturing',
        confidence_score: testConfidence,
        prediction_type: 'mid_market_expansion',
        location: 'Orange County, CA',
        timeline_days: TARGET_TIMELINE_DAYS,
        evidence: [
          `$${MIN_OFFICE_VALUE / 1000}K office permit approved`,
          `${MIN_JOB_POSTINGS}+ job postings for OC expansion`,
          'Series B funding completed'
        ],
        action_recommendation: `Test of ${CONFIDENCE_THRESHOLD}%+ confidence alert system for mid-market companies`
      };
      
      // Test the alert threshold and email system
      if (testConfidence >= CONFIDENCE_THRESHOLD) {
        console.log(`🚨 MID-MARKET ALERT: ${testConfidence}% confidence (≥${CONFIDENCE_THRESHOLD}% threshold)`);
        await emailSender.sendConsolidatedExpansionAlert([testPrediction]);
        
        const duration = Date.now() - startTime;
        
        res.json({
          success: true,
          message: `Test alert sent successfully for ${testConfidence}% confidence`,
          threshold: CONFIDENCE_THRESHOLD + '%',
          strategy: 'mid-market-focus',
          triggered: testConfidence >= CONFIDENCE_THRESHOLD,
          duration: `${duration}ms`
        });
      } else {
        res.json({
          success: true,
          message: `Test confidence ${testConfidence}% below ${CONFIDENCE_THRESHOLD}% threshold - no alert sent`,
          threshold: CONFIDENCE_THRESHOLD + '%',
          strategy: 'mid-market-focus',
          triggered: false
        });
      }
      
    } catch (error) {
      logger.error('Test alert failed', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  }
);

// Multi-city permits scraping endpoint
app.post('/manual/scrape-multi-city-permits', 
  [
    body('cities').optional().isArray().withMessage('Cities must be an array'),
    body('minValue').optional().isNumeric().withMessage('Min value must be numeric')
  ],
  async (req, res) => {
    const startTime = Date.now();
    
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      logger.info('Manual mid-market multi-city permits scraping triggered', { service: 'intellisense' });
      
      // Initialize multi-city scraper
      const MultiCityPermitsScraper = require('./src/scrapers/multi-city-permits');
      const scraper = new MultiCityPermitsScraper();
      
      // Set mid-market focused minimum values
      scraper.minOfficeValue = MIN_OFFICE_VALUE;
      scraper.minIndustrialValue = MIN_INDUSTRIAL_VALUE;
      
      // Optionally filter cities if specified
      if (req.body.cities) {
        const requestedCities = req.body.cities;
        Object.keys(scraper.cities).forEach(cityKey => {
          if (!requestedCities.includes(cityKey)) {
            scraper.cities[cityKey].enabled = false;
          }
        });
      }
      
      // Optionally adjust minimum value
      if (req.body.minValue) {
        scraper.minValue = parseInt(req.body.minValue);
      }
      
      const permits = await scraper.scrapeAllCities();
      
      const duration = Date.now() - startTime;
      
      // Group results by city
      const citySummary = {};
      permits.forEach(permit => {
        const city = permit.city || 'Unknown';
        if (!citySummary[city]) {
          citySummary[city] = { count: 0, totalValue: 0 };
        }
        citySummary[city].count++;
        citySummary[city].totalValue += permit.value || 0;
      });
      
      res.json({
        success: true,
        message: 'Mid-market multi-city permits scraping completed successfully',
        strategy: 'mid-market-focus',
        thresholds: {
          office: '$' + (MIN_OFFICE_VALUE / 1000) + 'K',
          industrial: '$' + (MIN_INDUSTRIAL_VALUE / 1000) + 'K'
        },
        duration: `${duration}ms`,
        results: {
          totalPermits: permits.length,
          citySummary: citySummary,
          permits: permits.slice(0, 10) // Show first 10 permits
        }
      });

    } catch (error) {
      logger.error('Manual multi-city permits scraping failed:', error);
      const duration = Date.now() - startTime;
      
      res.status(500).json({
        success: false,
        message: 'Multi-city permits scraping failed',
        error: error.message,
        duration: `${duration}ms`
      });
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
    const isRailwayDeployment = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';
    
    // Test database connection with Railway resilience
    if (isSupabase) {
      try {
        await prisma.$connect();
        await prisma.$queryRaw`SELECT 1`;
        logger.info('Supabase database connected');
      } catch (dbError) {
        logger.warn('Supabase connection failed, running in demo mode', { error: dbError.message });
        if (isRailwayDeployment) {
          logger.info('Railway deployment - continuing without database functionality');
        }
      }
    } else {
      logger.warn('Local/demo mode - database features limited');
    }
    
    // Initialize services with Railway error handling
    try {
      await initializeServices();
    } catch (servicesError) {
      if (isRailwayDeployment) {
        logger.warn('Services initialization failed in Railway, continuing with basic functionality', { 
          error: servicesError.message 
        });
      } else {
        throw servicesError;
      }
    }
    
    // Start the scheduler (only for Supabase and successful initialization)
    if (isSupabase && scheduler) {
      try {
        scheduler.start();
        logger.info('Scheduler enabled (Supabase mode)');
      } catch (schedulerError) {
        logger.warn('Scheduler failed to start', { error: schedulerError.message });
      }
    } else {
      logger.warn('Scheduler disabled (demo mode or failed initialization)');
    }
    
    // Start system monitor with error handling
    try {
      systemMonitor.start();
      logger.info('System monitor started');
    } catch (monitorError) {
      logger.warn('System monitor failed to start', { error: monitorError.message });
    }
    
    // Start Express server
    const server = app.listen(PORT, () => {
      logger.info(`IntelliSense Mid-Market Intelligence server running on port ${PORT}`, {
        port: PORT,
        environment: NODE_ENV,
        strategy: 'mid-market-focus',
        database: isSupabase ? 'supabase' : 'demo',
        deployment: isRailwayDeployment ? 'railway' : 'local',
        configuration: {
          confidenceThreshold: CONFIDENCE_THRESHOLD + '%',
          minOfficeValue: '$' + (MIN_OFFICE_VALUE / 1000) + 'K',
          minIndustrialValue: '$' + (MIN_INDUSTRIAL_VALUE / 1000) + 'K',
          minJobPostings: MIN_JOB_POSTINGS,
          targetTimelineDays: TARGET_TIMELINE_DAYS
        },
        healthCheck: `http://localhost:${PORT}/health`,
        dashboard: `http://localhost:${PORT}`,
        api: `http://localhost:${PORT}/api`
      });
    });

    // Handle server errors
    server.on('error', (error) => {
      logger.error('Server error', { error: error.message });
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use`);
        process.exit(1);
      }
    });
    
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    const isRailwayDeployment = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';
    if (isRailwayDeployment) {
      logger.error('Critical failure in Railway deployment, exiting');
    }
    process.exit(1);
  }
}

// Graceful shutdown
async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  
  try {
    // Stop system monitor
    systemMonitor.stop();
    
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