const logger = require('./logger');
const cacheManager = require('./cache');
const browserPool = require('./browser-pool');
const { PrismaClient } = require('@prisma/client');

class SystemMonitor {
  constructor() {
    this.prisma = new PrismaClient();
    this.monitoringInterval = 5 * 60 * 1000; // 5 minutes
    this.alerts = [];
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      logger.warn('Monitor is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting system monitor');
    
    // Run initial health check
    this.performHealthCheck();
    
    // Set up monitoring interval
    this.monitoringTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.monitoringInterval);
  }

  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
    }
    
    logger.info('System monitor stopped');
  }

  async performHealthCheck() {
    const startTime = Date.now();
    const healthReport = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      checks: {}
    };

    try {
      // Database health check
      const dbHealth = await this.checkDatabaseHealth();
      healthReport.checks.database = dbHealth;

      // Browser pool health check
      const browserHealth = await this.checkBrowserPoolHealth();
      healthReport.checks.browserPool = browserHealth;

      // Cache health check
      const cacheHealth = await this.checkCacheHealth();
      healthReport.checks.cache = cacheHealth;

      // Memory health check
      const memoryHealth = await this.checkMemoryHealth();
      healthReport.checks.memory = memoryHealth;

      // Disk space check
      const diskHealth = await this.checkDiskHealth();
      healthReport.checks.disk = diskHealth;

      // Overall status determination
      const allChecks = Object.values(healthReport.checks);
      const failedChecks = allChecks.filter(check => check.status === 'error');
      
      if (failedChecks.length > 0) {
        healthReport.status = 'degraded';
        if (failedChecks.length > 2) {
          healthReport.status = 'critical';
        }
      }

      const duration = Date.now() - startTime;
      logger.info('Health check completed', {
        status: healthReport.status,
        duration: `${duration}ms`,
        failedChecks: failedChecks.length
      });

      // Store health report
      await this.storeHealthReport(healthReport);

      // Send alerts if needed
      await this.processAlerts(healthReport);

    } catch (error) {
      logger.error('Health check failed', { error: error.message });
      healthReport.status = 'error';
      healthReport.error = error.message;
    }

    return healthReport;
  }

  async checkDatabaseHealth() {
    try {
      const startTime = Date.now();
      
      // Test connection
      await this.prisma.$queryRaw`SELECT 1`;
      
      // Check recent activity
      const recentLogs = await this.prisma.scrapingLog.findMany({
        where: {
          created_at: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        },
        take: 1
      });

      const duration = Date.now() - startTime;
      
      return {
        status: 'healthy',
        responseTime: `${duration}ms`,
        recentActivity: recentLogs.length > 0,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async checkBrowserPoolHealth() {
    try {
      const stats = browserPool.getStats();
      
      // Check for memory leaks
      const memoryUsage = stats.memoryUsage;
      const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
      
      let status = 'healthy';
      if (heapUsedMB > 500) {
        status = 'warning';
      }
      if (heapUsedMB > 1000) {
        status = 'error';
      }

      return {
        status,
        totalBrowsers: stats.totalBrowsers,
        activeBrowsers: stats.activeBrowsers,
        queueLength: stats.queueLength,
        memoryUsageMB: Math.round(heapUsedMB),
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async checkCacheHealth() {
    try {
      const stats = cacheManager.getStats();
      
      // Calculate hit rates
      const totalRequests = Object.values(stats).reduce((sum, cache) => 
        sum + cache.hits + cache.misses, 0
      );
      
      const totalHits = Object.values(stats).reduce((sum, cache) => 
        sum + cache.hits, 0
      );
      
      const hitRate = totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0;
      
      // More realistic thresholds for job search scenarios
      let status = 'healthy';
      if (hitRate < 30) {  // Lowered from 50% - job searches naturally have lower hit rates
        status = 'warning';
      }
      if (hitRate < 10) {  // Lowered from 20% - only error if extremely low
        status = 'error';
      }
      
      // Special handling for low activity periods
      if (totalRequests < 10) {
        status = 'healthy'; // Don't warn during low activity
      }

      return {
        status,
        hitRate: `${hitRate.toFixed(1)}%`,
        totalKeys: Object.values(stats).reduce((sum, cache) => sum + cache.keys, 0),
        totalRequests,
        totalHits,
        note: totalRequests < 10 ? 'Low activity period' : null,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async checkMemoryHealth() {
    try {
      const memoryUsage = process.memoryUsage();
      const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
      const heapTotalMB = memoryUsage.heapTotal / 1024 / 1024;
      const rssMB = memoryUsage.rss / 1024 / 1024;
      
      const heapUsagePercent = (heapUsedMB / heapTotalMB) * 100;
      
      let status = 'healthy';
      if (heapUsagePercent > 80) {
        status = 'warning';
      }
      if (heapUsagePercent > 95) {
        status = 'error';
      }

      return {
        status,
        heapUsedMB: Math.round(heapUsedMB),
        heapTotalMB: Math.round(heapTotalMB),
        rssMB: Math.round(rssMB),
        heapUsagePercent: Math.round(heapUsagePercent),
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async checkDiskHealth() {
    try {
      const fs = require('fs');
      const path = require('path');
      
      // Railway deployment - skip file system checks
      const isRailwayDeployment = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';
      
      if (isRailwayDeployment) {
        return {
          status: 'healthy',
          note: 'Disk health checks disabled in Railway deployment',
          timestamp: new Date().toISOString()
        };
      }
      
      // Check logs directory (only in local/dev environments)
      const logsDir = path.join(__dirname, '../../logs');
      
      if (!fs.existsSync(logsDir)) {
        return {
          status: 'healthy',
          note: 'Logs directory not found - file logging disabled',
          timestamp: new Date().toISOString()
        };
      }
      
      const stats = fs.statSync(logsDir);
      
      // Calculate directory size (simplified)
      const files = fs.readdirSync(logsDir);
      let totalSize = 0;
      
      for (const file of files) {
        try {
          const filePath = path.join(logsDir, file);
          const fileStats = fs.statSync(filePath);
          totalSize += fileStats.size;
        } catch (error) {
          // Skip files that can't be accessed
        }
      }
      
      const totalSizeMB = totalSize / 1024 / 1024;
      
      let status = 'healthy';
      if (totalSizeMB > 100) {
        status = 'warning';
      }
      if (totalSizeMB > 500) {
        status = 'error';
      }

      return {
        status,
        totalSizeMB: Math.round(totalSizeMB),
        fileCount: files.length,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      return {
        status: 'healthy',
        note: 'Disk health check skipped due to file system access restrictions',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async storeHealthReport(report) {
    try {
      // Store in cache for quick access
      cacheManager.getMainCache('latest_health_report', () => Promise.resolve(report), 300);
      
      // Log the report
      logger.info('Health report stored', {
        status: report.status,
        checks: Object.keys(report.checks).length
      });
      
    } catch (error) {
      logger.error('Failed to store health report', { error: error.message });
    }
  }

  async processAlerts(healthReport) {
    const alerts = [];
    
    // Check for critical issues
    if (healthReport.status === 'critical') {
      alerts.push({
        level: 'critical',
        message: 'System is in critical state',
        details: healthReport
      });
    }
    
    // Check individual components
    for (const [component, check] of Object.entries(healthReport.checks)) {
      if (check.status === 'error') {
        alerts.push({
          level: 'error',
          component,
          message: `${component} is experiencing issues`,
          details: check
        });
      } else if (check.status === 'warning') {
        alerts.push({
          level: 'warning',
          component,
          message: `${component} is showing warning signs`,
          details: check
        });
      }
    }
    
    // Process alerts
    for (const alert of alerts) {
      await this.sendAlert(alert);
    }
    
    // Store alerts
    this.alerts.push(...alerts);
    
    // Keep only recent alerts
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.alerts = this.alerts.filter(alert => 
      new Date(alert.timestamp || Date.now()).getTime() > oneHourAgo
    );
  }

  async sendAlert(alert) {
    try {
      logger.warn('System alert', {
        level: alert.level,
        component: alert.component,
        message: alert.message
      });
      
      // Here you could send alerts via email, Slack, etc.
      // For now, just log them
      
    } catch (error) {
      logger.error('Failed to send alert', { error: error.message });
    }
  }

  getSystemStats() {
    return {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      nodeVersion: process.version,
      platform: process.platform,
      alerts: this.alerts.length,
      isRunning: this.isRunning
    };
  }

  async getPerformanceMetrics() {
    try {
      const [permits, predictions, jobs] = await Promise.all([
        this.prisma.permit.count(),
        this.prisma.prediction.count(),
        this.prisma.job.count()
      ]);
      
      const cacheStats = cacheManager.getStats();
      const browserStats = browserPool.getStats();
      
      return {
        database: {
          permits,
          predictions,
          jobs
        },
        cache: cacheStats,
        browserPool: browserStats,
        memory: process.memoryUsage(),
        uptime: process.uptime()
      };
      
    } catch (error) {
      logger.error('Failed to get performance metrics', { error: error.message });
      return { error: error.message };
    }
  }

  async shutdown() {
    this.stop();
    
    try {
      await this.prisma.$disconnect();
      logger.info('System monitor shutdown completed');
    } catch (error) {
      logger.error('Error during monitor shutdown', { error: error.message });
    }
  }
}

// Create singleton instance
const systemMonitor = new SystemMonitor();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await systemMonitor.shutdown();
});

process.on('SIGINT', async () => {
  await systemMonitor.shutdown();
});

module.exports = systemMonitor; 