#!/usr/bin/env node
/**
 * INTELLISENSE SECURITY AUDIT TOOL
 * 
 * Comprehensive security check for the IntelliSense Real Estate Intelligence Platform
 * Identifies potential vulnerabilities and security misconfigurations.
 * 
 * Usage: node scripts/security-audit.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SecurityAudit {
  constructor() {
    this.findings = {
      high: [],
      medium: [],
      low: [],
      info: []
    };
    this.passed = [];
  }

  log(severity, title, description, recommendation = null) {
    const finding = {
      severity,
      title,
      description,
      recommendation,
      timestamp: new Date().toISOString()
    };

    if (severity === 'PASS') {
      this.passed.push(finding);
      console.log(`✅ ${title}`);
    } else {
      this.findings[severity.toLowerCase()].push(finding);
      const icon = {
        'HIGH': '🚨',
        'MEDIUM': '⚠️',
        'LOW': '💡',
        'INFO': 'ℹ️'
      };
      console.log(`${icon[severity]} ${severity}: ${title}`);
      if (description) console.log(`   ${description}`);
      if (recommendation) console.log(`   → ${recommendation}`);
    }
  }

  async checkEnvironmentSecurity() {
    console.log('\n🔐 CHECKING ENVIRONMENT SECURITY...\n');

    // Check for .env file in repository
    if (fs.existsSync('.env')) {
      this.log('HIGH', 
        '.env file found in repository',
        'Environment file should not be committed to version control',
        'Add .env to .gitignore and remove from repository history'
      );
    } else {
      this.log('PASS', 'No .env file in repository');
    }

    // Check .gitignore for sensitive files
    if (fs.existsSync('.gitignore')) {
      const gitignore = fs.readFileSync('.gitignore', 'utf8');
      const requiredEntries = ['.env', 'node_modules', '*.log', 'dist', '.DS_Store'];
      
      for (const entry of requiredEntries) {
        if (gitignore.includes(entry)) {
          this.log('PASS', `${entry} properly ignored`);
        } else {
          this.log('MEDIUM', 
            `${entry} not in .gitignore`,
            'Sensitive files might be accidentally committed',
            `Add '${entry}' to .gitignore`
          );
        }
      }
    } else {
      this.log('HIGH', 
        '.gitignore file missing',
        'No protection against committing sensitive files',
        'Create .gitignore with proper exclusions'
      );
    }

    // Check for hardcoded secrets in source files
    await this.scanForHardcodedSecrets();
  }

  async scanForHardcodedSecrets() {
    console.log('\n🕵️ SCANNING FOR HARDCODED SECRETS...\n');

    const suspiciousPatterns = [
      { pattern: /sk-[a-zA-Z0-9]{48}/, name: 'OpenAI API Key' },
      { pattern: /AKIA[0-9A-Z]{16}/, name: 'AWS Access Key' },
      { pattern: /password\s*=\s*["'][^"']*["']/i, name: 'Hardcoded Password' },
      { pattern: /api[_-]?key\s*=\s*["'][^"']*["']/i, name: 'API Key' },
      { pattern: /secret\s*=\s*["'][^"']*["']/i, name: 'Secret' },
      { pattern: /token\s*=\s*["'][^"']*["']/i, name: 'Token' }
    ];

    const filesToScan = this.getSourceFiles();
    let secretsFound = 0;

    for (const filePath of filesToScan) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        
        for (const { pattern, name } of suspiciousPatterns) {
          const matches = content.match(pattern);
          if (matches) {
            secretsFound++;
            this.log('HIGH', 
              `Potential ${name} found in ${filePath}`,
              `Hardcoded secret detected: ${matches[0].substring(0, 20)}...`,
              'Move secrets to environment variables'
            );
          }
        }
      } catch (error) {
        this.log('INFO', `Could not scan ${filePath}: ${error.message}`);
      }
    }

    if (secretsFound === 0) {
      this.log('PASS', 'No hardcoded secrets detected');
    }
  }

  getSourceFiles() {
    const extensions = ['.js', '.json', '.md', '.yml', '.yaml'];
    const files = [];
    
    const scanDir = (dir) => {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && !['node_modules', '.git', 'logs'].includes(item)) {
          scanDir(fullPath);
        } else if (stat.isFile() && extensions.some(ext => item.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    };

    scanDir('.');
    return files;
  }

  async checkServerSecurity() {
    console.log('\n🛡️ CHECKING SERVER SECURITY...\n');

    try {
      const serverContent = fs.readFileSync('server.js', 'utf8');

      // Check for security middleware
      const securityChecks = [
        { name: 'Helmet', pattern: /helmet\(\)/, description: 'Security headers middleware' },
        { name: 'CORS', pattern: /cors\(/, description: 'Cross-origin request handling' },
        { name: 'Rate Limiting', pattern: /rateLimit\(/, description: 'Request rate limiting' },
        { name: 'Input Validation', pattern: /express-validator/, description: 'Input validation middleware' },
        { name: 'Body Parser Limits', pattern: /limit:\s*['"]\d+[a-zA-Z]*['"]/, description: 'Request size limits' }
      ];

      for (const check of securityChecks) {
        if (serverContent.match(check.pattern)) {
          this.log('PASS', `${check.name} implemented - ${check.description}`);
        } else {
          this.log('MEDIUM', 
            `${check.name} not found`,
            `Missing ${check.description}`,
            `Implement ${check.name} middleware`
          );
        }
      }

      // Check for secure cookie settings
      if (serverContent.includes('secure: true') || serverContent.includes('httpOnly: true')) {
        this.log('PASS', 'Secure cookie settings found');
      } else {
        this.log('MEDIUM', 
          'Secure cookie settings not found',
          'Cookies may not be properly secured',
          'Add secure: true, httpOnly: true to cookie settings'
        );
      }

      // Check for HTTPS enforcement
      if (serverContent.includes('https') || serverContent.includes('redirect')) {
        this.log('PASS', 'HTTPS configuration present');
      } else {
        this.log('LOW', 
          'No explicit HTTPS enforcement',
          'Consider enforcing HTTPS in production',
          'Add HTTPS redirect middleware'
        );
      }

    } catch (error) {
      this.log('HIGH', 
        'Cannot read server.js',
        'Unable to perform server security analysis',
        'Ensure server.js exists and is readable'
      );
    }
  }

  async checkDependencySecurity() {
    console.log('\n📦 CHECKING DEPENDENCY SECURITY...\n');

    try {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

      // Check for known vulnerable packages
      const vulnerablePackages = [
        'lodash', 'moment', 'request', 'debug', 'marked', 'serialize-javascript'
      ];

      let vulnerableFound = 0;

      for (const [pkg, version] of Object.entries(dependencies)) {
        if (vulnerablePackages.includes(pkg)) {
          vulnerableFound++;
          this.log('MEDIUM', 
            `Potentially vulnerable package: ${pkg}@${version}`,
            'Package has known security issues in some versions',
            'Run npm audit and update to latest secure version'
          );
        }
      }

      if (vulnerableFound === 0) {
        this.log('PASS', 'No obviously vulnerable packages detected');
      }

      // Check for package-lock.json
      if (fs.existsSync('package-lock.json')) {
        this.log('PASS', 'package-lock.json present - ensures reproducible builds');
      } else {
        this.log('MEDIUM', 
          'package-lock.json missing',
          'Dependencies may have version inconsistencies',
          'Run npm install to generate package-lock.json'
        );
      }

      this.log('INFO', 
        'Run dependency audit',
        'Regularly check for dependency vulnerabilities',
        'Execute: npm audit && npm audit fix'
      );

    } catch (error) {
      this.log('HIGH', 
        'Cannot read package.json',
        'Unable to perform dependency security analysis'
      );
    }
  }

  async checkDatabaseSecurity() {
    console.log('\n🗄️ CHECKING DATABASE SECURITY...\n');

    try {
      const prismaSchema = fs.readFileSync('prisma/schema.prisma', 'utf8');

      // Check for sensitive data fields
      const sensitiveFields = ['password', 'secret', 'token', 'key', 'ssn', 'credit'];
      
      for (const field of sensitiveFields) {
        if (prismaSchema.toLowerCase().includes(field)) {
          this.log('MEDIUM', 
            `Potentially sensitive field detected: ${field}`,
            'Sensitive data should be properly encrypted',
            'Ensure sensitive fields are encrypted at rest'
          );
        }
      }

      // Check for proper indexing on sensitive queries
      if (prismaSchema.includes('@@index') || prismaSchema.includes('@@unique')) {
        this.log('PASS', 'Database indexes configured');
      } else {
        this.log('LOW', 
          'No database indexes found',
          'Queries may be slow and vulnerable to timing attacks',
          'Add appropriate indexes to frequently queried fields'
        );
      }

      // Check DATABASE_URL security
      if (process.env.DATABASE_URL) {
        const dbUrl = process.env.DATABASE_URL;
        
        if (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')) {
          this.log('INFO', 'Using local database - ensure production uses secure connection');
        } else if (dbUrl.includes('ssl=') || dbUrl.includes('sslmode=')) {
          this.log('PASS', 'SSL database connection configured');
        } else {
          this.log('MEDIUM', 
            'Database connection may not use SSL',
            'Unencrypted database connections are vulnerable',
            'Add SSL parameters to DATABASE_URL'
          );
        }
      }

    } catch (error) {
      this.log('MEDIUM', 'Cannot read Prisma schema for security analysis');
    }
  }

  async checkFileSecurity() {
    console.log('\n📁 CHECKING FILE SECURITY...\n');

    // Check file permissions (Unix/Linux systems)
    if (process.platform !== 'win32') {
      const criticalFiles = ['server.js', 'package.json', '.env.example'];
      
      for (const file of criticalFiles) {
        if (fs.existsSync(file)) {
          const stats = fs.statSync(file);
          const mode = stats.mode & parseInt('777', 8);
          
          if (mode & parseInt('002', 8)) { // World writable
            this.log('HIGH', 
              `${file} is world-writable`,
              'File can be modified by any user',
              `chmod 644 ${file}`
            );
          } else {
            this.log('PASS', `${file} has secure permissions`);
          }
        }
      }
    }

    // Check for backup files that might contain sensitive data
    const backupPatterns = ['*.bak', '*.backup', '*.old', '*.tmp', '*~'];
    const allFiles = fs.readdirSync('.', { recursive: true });
    
    let backupsFound = 0;
    for (const file of allFiles) {
      if (typeof file === 'string') {
        for (const pattern of backupPatterns) {
          const regex = new RegExp(pattern.replace('*', '.*'));
          if (regex.test(file)) {
            backupsFound++;
            this.log('LOW', 
              `Backup file found: ${file}`,
              'Backup files may contain sensitive information',
              'Remove backup files or add to .gitignore'
            );
          }
        }
      }
    }

    if (backupsFound === 0) {
      this.log('PASS', 'No backup files found');
    }
  }

  async checkAPIEndpointSecurity() {
    console.log('\n🔌 CHECKING API ENDPOINT SECURITY...\n');

    try {
      const serverContent = fs.readFileSync('server.js', 'utf8');

      // Check for authentication on sensitive endpoints
      const sensitiveEndpoints = ['/manual/', '/admin', '/config', '/env'];
      
      for (const endpoint of sensitiveEndpoints) {
        if (serverContent.includes(endpoint)) {
          // Look for authentication middleware
          const endpointSection = serverContent.split(endpoint)[1]?.split('\n')[0];
          if (endpointSection && !endpointSection.includes('auth')) {
            this.log('HIGH', 
              `Sensitive endpoint ${endpoint} may lack authentication`,
              'Endpoint could be accessed without proper authorization',
              'Add authentication middleware to sensitive endpoints'
            );
          } else {
            this.log('PASS', `${endpoint} appears to have authentication`);
          }
        }
      }

      // Check for error information disclosure
      if (serverContent.includes('error.stack') || serverContent.includes('error.message')) {
        this.log('MEDIUM', 
          'Error details exposed in responses',
          'Stack traces can reveal sensitive system information',
          'Only expose error details in development mode'
        );
      } else {
        this.log('PASS', 'Error handling appears secure');
      }

    } catch (error) {
      this.log('MEDIUM', 'Cannot analyze API endpoint security');
    }
  }

  generateSecurityReport() {
    console.log('\n📊 GENERATING SECURITY REPORT...\n');

    const totalFindings = Object.values(this.findings).reduce((sum, arr) => sum + arr.length, 0);
    const riskScore = (this.findings.high.length * 3) + (this.findings.medium.length * 2) + this.findings.low.length;

    let riskLevel = 'LOW';
    if (riskScore > 10) riskLevel = 'HIGH';
    else if (riskScore > 5) riskLevel = 'MEDIUM';

    console.log('═'.repeat(80));
    console.log('🔒 INTELLISENSE SECURITY AUDIT REPORT');
    console.log('═'.repeat(80));
    console.log(`Overall Risk Level: ${this.getRiskIcon(riskLevel)} ${riskLevel}`);
    console.log(`Total Findings: ${totalFindings}`);
    console.log(`Checks Passed: ${this.passed.length}`);
    console.log(`Risk Score: ${riskScore}/30`);
    console.log(`Timestamp: ${new Date().toISOString()}\n`);

    // Summary by severity
    for (const [severity, findings] of Object.entries(this.findings)) {
      if (findings.length > 0) {
        console.log(`${severity.toUpperCase()} (${findings.length}):`);
        findings.forEach((finding, i) => {
          console.log(`  ${i + 1}. ${finding.title}`);
          if (finding.recommendation) {
            console.log(`     → ${finding.recommendation}`);
          }
        });
        console.log('');
      }
    }

    // Recommendations
    if (totalFindings > 0) {
      console.log('🔧 IMMEDIATE ACTIONS REQUIRED:');
      const highPriority = [...this.findings.high, ...this.findings.medium];
      highPriority.forEach((finding, i) => {
        console.log(`${i + 1}. ${finding.title}`);
        if (finding.recommendation) {
          console.log(`   → ${finding.recommendation}`);
        }
      });
    } else {
      console.log('✅ No critical security issues found!');
    }

    // Save detailed report
    const report = {
      timestamp: new Date().toISOString(),
      riskLevel,
      riskScore,
      totalFindings,
      checksPassed: this.passed.length,
      findings: this.findings,
      passed: this.passed
    };

    fs.writeFileSync('security-audit-report.json', JSON.stringify(report, null, 2));
    console.log('\n📄 Detailed report saved to: security-audit-report.json');
    console.log('═'.repeat(80));

    return riskLevel;
  }

  getRiskIcon(level) {
    const icons = {
      'LOW': '🟢',
      'MEDIUM': '🟡',
      'HIGH': '🔴'
    };
    return icons[level] || '⚪';
  }

  async run() {
    console.log('🔍 STARTING INTELLISENSE SECURITY AUDIT...');
    console.log('═'.repeat(80));

    try {
      await this.checkEnvironmentSecurity();
      await this.checkServerSecurity();
      await this.checkDependencySecurity();
      await this.checkDatabaseSecurity();
      await this.checkFileSecurity();
      await this.checkAPIEndpointSecurity();

      const riskLevel = this.generateSecurityReport();
      
      // Exit with appropriate code
      process.exit(riskLevel === 'HIGH' ? 1 : 0);

    } catch (error) {
      console.error('❌ Security audit failed with unexpected error:', error);
      process.exit(1);
    }
  }
}

// Run security audit if called directly
if (require.main === module) {
  const audit = new SecurityAudit();
  audit.run();
}

module.exports = SecurityAudit;
