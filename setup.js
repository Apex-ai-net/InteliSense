#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🧠 IntelliSense Setup Script');
console.log('============================\n');

// Check if .env file exists
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.log('❌ .env file not found!');
  console.log('📝 Please create a .env file with the following variables:');
  console.log('');
  console.log('OPENAI_API_KEY=your-openai-api-key-here');
  console.log('EMAIL_USER=your-gmail@gmail.com');
  console.log('EMAIL_PASS=your-gmail-app-password');
  console.log('ALERT_EMAIL=admin@thefiredev.com');
  console.log('DATABASE_URL=postgresql://localhost:5432/intellisense');
  console.log('PORT=3000');
  console.log('NODE_ENV=development');
  console.log('');
  console.log('🔧 Copy the above into a new .env file and run this script again.');
  process.exit(1);
}

console.log('✅ .env file found');

// Load environment variables
require('dotenv').config();

// Check required environment variables
const requiredEnvVars = [
  'OPENAI_API_KEY',
  'EMAIL_USER', 
  'EMAIL_PASS',
  'ALERT_EMAIL',
  'DATABASE_URL'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.log('❌ Missing required environment variables:');
  missingVars.forEach(varName => {
    console.log(`   - ${varName}`);
  });
  console.log('\n🔧 Please add these to your .env file and run setup again.');
  process.exit(1);
}

console.log('✅ All required environment variables found');

// Test database connection
console.log('\n🗄️  Testing database connection...');
try {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  
  // Test connection
  prisma.$queryRaw`SELECT 1`.then(async () => {
    console.log('✅ Database connection successful');
    
    // Push schema
    console.log('📋 Pushing database schema...');
    try {
      execSync('npx prisma db push', { stdio: 'inherit' });
      console.log('✅ Database schema created successfully');
    } catch (error) {
      console.log('❌ Failed to create database schema:', error.message);
      console.log('🔧 Try running: npx prisma db push');
    }
    
    await prisma.$disconnect();
    
    // Test email configuration
    console.log('\n📧 Testing email configuration...');
    try {
      const EmailSender = require('./src/alerts/email-sender');
      const emailSender = new EmailSender();
      
      const isEmailWorking = await emailSender.testConnection();
      if (isEmailWorking) {
        console.log('✅ Email configuration successful');
      } else {
        console.log('❌ Email configuration failed');
        console.log('🔧 Check your EMAIL_USER and EMAIL_PASS in .env');
      }
    } catch (error) {
      console.log('❌ Email test failed:', error.message);
    }
    
    console.log('\n🎉 Setup Complete!');
    console.log('==================');
    console.log('');
    console.log('🚀 Start the system with: npm start');
    console.log('📊 Health check: http://localhost:3000/health');
    console.log('🏠 Dashboard: http://localhost:3000');
    console.log('');
    console.log('🔧 Manual triggers for testing:');
    console.log('   curl -X POST http://localhost:3000/manual/scrape-permits');
    console.log('   curl -X POST http://localhost:3000/manual/test-email');
    console.log('   curl -X POST http://localhost:3000/manual/analyze');
    console.log('');
    console.log('📚 See README.md for detailed documentation');
    
  }).catch(async (error) => {
    console.log('❌ Database connection failed:', error.message);
    console.log('');
    console.log('🔧 Troubleshooting steps:');
    console.log('1. Make sure PostgreSQL is running');
    console.log('2. Create the database: createdb intellisense');
    console.log('3. Check your DATABASE_URL in .env');
    console.log('4. Run: npx prisma db push');
    
    await prisma.$disconnect();
    process.exit(1);
  });
  
} catch (error) {
  console.log('❌ Setup failed:', error.message);
  process.exit(1);
} 