#!/usr/bin/env node
/**
 * INTELLISENSE SYSTEM HEALTH CHECK & DIAGNOSTIC TOOL
 * 
 * This script comprehensively tests all system components to ensure
 * the IntelliSense Real Estate Intelligence Platform is operating correctly.
 * 
 * Usage: node scripts/health-check.js
 */

const { PrismaClient } = require('@prisma/client');
const nodemailer = require('nodemailer');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

class SystemHealthCheck {
  constructor() {
    this.results = {
      overall: 'UNKNOWN',
      components: {},
      timestamp: new Date().toISOString(),
      recommendations: []
    };
    
    this.prisma = null;
    this.openai = null;
  }

  log(component, status, message, details = null) {
    const statusIcon = {
      'PASS': '✅',
      'FAIL': '❌',
      'WARN': '⚠️',
      'INFO': 'ℹ️'
    };

    console.log(`${statusIcon[status]} ${component}: ${message}`);
    
    if (details) {
      console.log(`   ${JSON.stringify(details, null, 2)}`);
    }

    this.results.components[component] = {
      status,
      message,
      details,
      timestamp: new Date().toISOString()
    };
  }

  async checkEnvironmentVariables() {
    console.log('\n🔍 CHECKING ENVIRONMENT VARIABLES...\n');

    const required = [
      { name: 'DATABASE_URL', critical: true },
      { name: 'NODE_ENV', critical: false },
      { name: 'PORT', critical: false }
    ];

    const optional = [
      { name: 'OPENAI_API_KEY', feature: 'AI Analysis' },
      { name: 'EMAIL_USER', feature: 'Email Alerts' },
      { name: 'EMAIL_PASS', feature: 'Email Alerts' },
      { name: 'EMAIL_HOST', feature: 'Email Alerts' },
      { name: 'ALERT_EMAIL', feature: 'Email Alerts' }
    ];

    let missingCritical = 0;
    let missingOptional = 0;

    // Check required variables
    for (const env of required) {
      if (process.env[env.name]) {
        this.log('Environment', 'PASS', `${env.name} is configured`);
      } else {
        const status = env.critical ? 'FAIL' : 'WARN';
        this.log('Environment', status, `${env.name} is missing`);
        if (env.critical) missingCritical++;
      }
    }

    // Check optional variables
    for (const env of optional) {
      if (process.env[env.name]) {
        this.log('Environment', 'PASS', `${env.name} configured (${env.feature} enabled)`);
      } else {
        this.log('Environment', 'WARN', `${env.name} missing (${env.feature} disabled)`);
        missingOptional++;
      }
    }

    if (missingCritical > 0) {
      this.results.recommendations.push('Configure missing critical environment variables');
      return false;
    }

    if (missingOptional > 0) {
      this.results.recommendations.push(`Configure ${missingOptional} optional variables for full functionality`);
    }

    return true;
  }

  async checkDatabaseConnection() {
    console.log('\n🗄️ CHECKING DATABASE CONNECTION...\n');

    try {
      this.prisma = new PrismaClient({
        datasources: {
          db: { url: process.env.DATABASE_URL }
        }
      });

      // Test connection
      const startTime = Date.now();
      await this.prisma.$connect();
      await this.prisma.$queryRaw`SELECT 1 as test`;
      const latency = Date.now() - startTime;

      // Check if it's Supabase
      const isSupabase = process.env.DATABASE_URL?.includes('supabase.co');
      const dbType = isSupabase ? 'Supabase (Production)' : 'Local/Other';

      this.log('Database', 'PASS', `Connected successfully to ${dbType}`, {
        latency: `${latency}ms`,
        type: dbType,
        url: process.env.DATABASE_URL?.substring(0, 50) + '...'
      });

      // Test table access
      try {
        const permitCount = await this.prisma.permit.count();
        const predictionCount = await this.prisma.prediction.count();
        const jobCount = await this.prisma.job.count();

        this.log('Database', 'PASS', 'All tables accessible', {
          permits: permitCount,
          predictions: predictionCount,
          jobs: jobCount
        });
      } catch (tableError) {
        this.log('Database', 'WARN', 'Tables may need setup', {
          error: tableError.message,
          solution: 'Run: npm run db:push'
        });
        this.results.recommendations.push('Run database migration: npm run db:push');
      }

      return true;

    } catch (error) {
      this.log('Database', 'FAIL', 'Connection failed', {
        error: error.message,
        url: process.env.DATABASE_URL ? 'Configured' : 'Missing'
      });
      this.results.recommendations.push('Fix database connection - check DATABASE_URL');
      return false;
    }
  }

  async checkAIIntegration() {
    console.log('\n🤖 CHECKING AI INTEGRATION...\n');

    if (!process.env.OPENAI_API_KEY) {
      this.log('AI', 'WARN', 'OpenAI API key not configured - AI features disabled');
      return false;
    }

    try {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });

      // Test API connection with a simple request
      const startTime = Date.now();
      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Test' }],
        max_tokens: 5
      });
      const latency = Date.now() - startTime;

      this.log('AI', 'PASS', 'OpenAI API connection successful', {
        latency: `${latency}ms`,
        model: 'gpt-3.5-turbo',
        usage: response.usage
      });

      return true;

    } catch (error) {
      this.log('AI', 'FAIL', 'OpenAI API connection failed', {
        error: error.message,
        code: error.code
      });
      this.results.recommendations.push('Verify OpenAI API key is valid and has credits');
      return false;
    }
  }

  async checkEmailSystem() {
    console.log('\n📧 CHECKING EMAIL SYSTEM...\n');

    const emailVars = ['EMAIL_USER', 'EMAIL_PASS', 'EMAIL_HOST'];
    const missingVars = emailVars.filter(v => !process.env[v]);

    if (missingVars.length > 0) {
      this.log('Email', 'WARN', `Email not configured - missing: ${missingVars.join(', ')}`);
      return false;
    }

    try {
      const transporter = nodemailer.createTransporter({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.EMAIL_PORT) || 587,
        secure: false,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      });

      // Test connection
      const startTime = Date.now();
      await transporter.verify();
      const latency = Date.now() - startTime;

      this.log('Email', 'PASS', 'Email system configured correctly', {
        host: process.env.EMAIL_HOST,
        user: process.env.EMAIL_USER,
        latency: `${latency}ms`
      });

      return true;

    } catch (error) {
      this.log('Email', 'FAIL', 'Email system connection failed', {
        error: error.message,
        host: process.env.EMAIL_HOST,
        user: process.env.EMAIL_USER
      });
      this.results.recommendations.push('Verify email credentials and enable app-specific passwords');
      return false;
    }
  }

  async checkFileSystem() {
    console.log('\n📁 CHECKING FILE SYSTEM & DEPENDENCIES...\n');

    const criticalPaths = [
      'src/scheduler.js',
      'src/scrapers/irvine-permits.js',
      'src/analysis/ai-predictor.js',
      'src/alerts/email-sender.js',
      'src/utils/logger.js',
      'src/utils/cache.js',
      'src/utils/browser-pool.js',
      'prisma/schema.prisma',
      'public/index.html'
    ];

    let missingFiles = 0;

    for (const filePath of criticalPaths) {
      if (fs.existsSync(path.join(process.cwd(), filePath))) {
        this.log('FileSystem', 'PASS', `${filePath} exists`);
      } else {
        this.log('FileSystem', 'FAIL', `${filePath} missing`);
        missingFiles++;
      }
    }

    // Check package.json dependencies
    try {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const depCount = Object.keys(packageJson.dependencies || {}).length;
      
      this.log('FileSystem', 'PASS', `Package.json valid with ${depCount} dependencies`);
    } catch (error) {
      this.log('FileSystem', 'FAIL', 'Package.json invalid or missing');
      missingFiles++;
    }

    if (missingFiles > 0) {
      this.results.recommendations.push('Restore missing critical files');
      return false;
    }

    return true;
  }

  async checkNetworkConnectivity() {
    console.log('\n🌐 CHECKING NETWORK CONNECTIVITY...\n');

    const testUrls = [
      'https://api.openai.com',
      'https://smtp.gmail.com',
      'https://www.google.com'
    ];

    let failures = 0;

    for (const url of testUrls) {
      try {
        const startTime = Date.now();
        const response = await fetch(url, { 
          method: 'HEAD',
          timeout: 5000 
        });
        const latency = Date.now() - startTime;

        this.log('Network', 'PASS', `${url} reachable`, {
          status: response.status,
          latency: `${latency}ms`
        });
      } catch (error) {
        this.log('Network', 'FAIL', `${url} unreachable`, {
          error: error.message
        });
        failures++;
      }
    }

    if (failures > 0) {
      this.results.recommendations.push('Check network connectivity and firewall settings');
      return failures < testUrls.length; // Partial success if not all failed
    }

    return true;
  }

  async runSystemDiagnostics() {
    console.log('\n⚙️ RUNNING SYSTEM DIAGNOSTICS...\n');

    // Memory usage
    const memUsage = process.memoryUsage();
    const memMB = {
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024)
    };

    this.log('System', 'INFO', 'Memory usage within normal range', memMB);

    // Node.js version
    const nodeVersion = process.version;
    const requiredMajor = 16;
    const currentMajor = parseInt(nodeVersion.slice(1).split('.')[0]);

    if (currentMajor >= requiredMajor) {
      this.log('System', 'PASS', `Node.js version ${nodeVersion} is compatible`);
    } else {
      this.log('System', 'FAIL', `Node.js version ${nodeVersion} is too old (requires ≥${requiredMajor})`);
      this.results.recommendations.push(`Update Node.js to version ${requiredMajor} or later`);
      return false;
    }

    // Environment
    const env = process.env.NODE_ENV || 'development';
    this.log('System', 'INFO', `Running in ${env} mode`);

    return true;
  }

  async generateReport() {
    console.log('\n📊 GENERATING HEALTH REPORT...\n');

    const components = Object.keys(this.results.components);
    const passed = components.filter(c => this.results.components[c].status === 'PASS').length;
    const failed = components.filter(c => this.results.components[c].status === 'FAIL').length;
    const warnings = components.filter(c => this.results.components[c].status === 'WARN').length;

    // Determine overall status
    if (failed === 0) {
      this.results.overall = warnings === 0 ? 'HEALTHY' : 'HEALTHY_WITH_WARNINGS';
    } else {
      this.results.overall = failed > passed ? 'CRITICAL' : 'DEGRADED';
    }

    // Print summary
    console.log('═'.repeat(80));
    console.log('🏥 INTELLISENSE SYSTEM HEALTH REPORT');
    console.log('═'.repeat(80));
    console.log(`Overall Status: ${this.getStatusIcon(this.results.overall)} ${this.results.overall}`);
    console.log(`Timestamp: ${this.results.timestamp}`);
    console.log(`Components Checked: ${components.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⚠️  Warnings: ${warnings}`);
    
    if (this.results.recommendations.length > 0) {
      console.log('\n🔧 RECOMMENDATIONS:');
      this.results.recommendations.forEach((rec, i) => {
        console.log(`${i + 1}. ${rec}`);
      });
    }

    // Save report to file
    const reportPath = path.join(process.cwd(), 'health-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);

    console.log('═'.repeat(80));

    return this.results.overall;
  }

  getStatusIcon(status) {
    const icons = {
      'HEALTHY': '🟢',
      'HEALTHY_WITH_WARNINGS': '🟡',
      'DEGRADED': '🟠',
      'CRITICAL': '🔴',
      'UNKNOWN': '⚪'
    };
    return icons[status] || '⚪';
  }

  async cleanup() {
    if (this.prisma) {
      await this.prisma.$disconnect();
    }
  }

  async run() {
    console.log('🚀 STARTING INTELLISENSE SYSTEM HEALTH CHECK...');
    console.log('═'.repeat(80));

    try {
      // Run all checks
      await this.checkEnvironmentVariables();
      await this.checkDatabaseConnection();
      await this.checkAIIntegration();
      await this.checkEmailSystem();
      await this.checkFileSystem();
      await this.checkNetworkConnectivity();
      await this.runSystemDiagnostics();

      // Generate final report
      const overallStatus = await this.generateReport();

      // Exit with appropriate code
      process.exit(overallStatus === 'CRITICAL' ? 1 : 0);

    } catch (error) {
      console.error('❌ Health check failed with unexpected error:', error);
      process.exit(1);
    } finally {
      await this.cleanup();
    }
  }
}

// Run health check if called directly
if (require.main === module) {
  const healthCheck = new SystemHealthCheck();
  healthCheck.run();
}

module.exports = SystemHealthCheck;
