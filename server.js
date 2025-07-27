const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

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
const prisma = new PrismaClient();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Initialize services
const scheduler = new Scheduler();
const permitsScraper = new IrvinePermitsScraper();
const jobMonitor = new JobMonitor();
const aiPredictor = new AIPredictor();
const emailSender = new EmailSender();

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
    endpoints: {
      health: '/health',
      predictions: '/predictions',
      permits: '/permits',
      jobs: '/jobs',
      manual: {
        scrapePermits: '/manual/scrape-permits',
        monitorJobs: '/manual/monitor-jobs',
        analyze: '/manual/analyze',
        testEmail: '/manual/test-email'
      }
    }
  });
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    let dbStatus = 'connected';
    let stats = null;
    
    // Check database connection (Supabase or local)
    try {
      await prisma.$queryRaw`SELECT 1`;
      stats = await getSystemStats();
    } catch (dbError) {
      dbStatus = `error: ${dbError.message}`;
    }
    
    const isSupabase = process.env.DATABASE_URL?.includes('supabase.co');
    const mode = isSupabase ? 'production (supabase)' : 'demo (local)';
    
    res.json({
      status: dbStatus === 'connected' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      scheduler: isSupabase ? 'enabled' : 'disabled (demo mode)',
      database: dbStatus,
      database_type: isSupabase ? 'supabase' : 'local/demo',
      openai: 'connected',
      mode,
      stats
    });
    
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get recent predictions
app.get('/predictions', async (req, res) => {
  try {
    const predictions = await prisma.prediction.findMany({
      orderBy: { created_at: 'desc' },
      take: 50
    });
    
    res.json({
      count: predictions.length,
      predictions
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get recent permits
app.get('/permits', async (req, res) => {
  try {
    const permits = await prisma.permit.findMany({
      orderBy: { created_at: 'desc' },
      take: 50
    });
    
    res.json({
      count: permits.length,
      permits
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get recent jobs
app.get('/jobs', async (req, res) => {
  try {
    const jobs = await prisma.job.findMany({
      orderBy: { created_at: 'desc' },
      take: 50
    });
    
    res.json({
      count: jobs.length,
      jobs
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger endpoints for testing
app.post('/manual/scrape-permits', async (req, res) => {
  try {
    console.log('🔧 Manual permits scrape triggered');
    const permits = await scheduler.triggerPermitsScrape();
    res.json({
      success: true,
      message: 'Permits scrape completed',
      count: permits.length,
      permits
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/manual/monitor-jobs', async (req, res) => {
  try {
    console.log('🔧 Manual job monitoring triggered');
    const jobs = await scheduler.triggerJobMonitor();
    res.json({
      success: true,
      message: 'Job monitoring completed',
      count: jobs.length,
      jobs
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/manual/analyze', async (req, res) => {
  try {
    console.log('🔧 Manual analysis triggered');
    const predictions = await scheduler.triggerAnalysis();
    res.json({
      success: true,
      message: 'Analysis completed',
      count: predictions.length,
      predictions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/manual/test-email', async (req, res) => {
  try {
    console.log('🔧 Manual email test triggered');
    
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
      
      res.json({
        success: true,
        message: 'Test email sent successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Email connection failed'
      });
    }
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
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
    console.error('Error getting system stats:', error);
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
        console.log('✅ Supabase database connected');
      } catch (dbError) {
        console.log('⚠️ Supabase connection failed, running in demo mode:', dbError.message);
      }
    } else {
      console.log('⚠️ Local/demo mode - database features limited');
    }
    
    // Start the scheduler (only for Supabase)
    if (isSupabase) {
      scheduler.start();
      console.log('✅ Scheduler enabled (Supabase mode)');
    } else {
      console.log('⚠️ Scheduler disabled (demo mode)');
    }
    
    // Start Express server
    app.listen(PORT, () => {
      console.log(`🚀 IntelliSense server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🏠 Dashboard: http://localhost:${PORT}`);
      console.log(`🗄️ Database: ${isSupabase ? 'Supabase (Production)' : 'Demo Mode'}`);
      console.log('');
      console.log('🔧 Manual triggers available:');
      console.log(`  📋 Scrape permits: POST http://localhost:${PORT}/manual/scrape-permits`);
      console.log(`  💼 Monitor jobs: POST http://localhost:${PORT}/manual/monitor-jobs`);
      console.log(`  🧠 Run analysis: POST http://localhost:${PORT}/manual/analyze`);
      console.log(`  📧 Test email: POST http://localhost:${PORT}/manual/test-email`);
      
      if (isSupabase) {
        console.log('');
        console.log('🌟 Supabase Features Available:');
        console.log('  🔄 Real-time data updates');
        console.log('  📊 Database dashboard access');
        console.log('  🔐 Built-in authentication (if needed)');
        console.log('  📡 Auto-generated APIs');
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

// Start the application
if (require.main === module) {
  startServer();
}

module.exports = app; 