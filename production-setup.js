#!/usr/bin/env node

const fs = require('fs');
const readline = require('readline');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

console.log('🚀 IntelliSense Production Setup');
console.log('=================================');
console.log('');
console.log('This script will help you configure IntelliSense for production deployment.');
console.log('You\'ll need to set up real API keys and database connections.');
console.log('');

async function main() {
  console.log('📋 Production Checklist:');
  console.log('========================');
  console.log('1. ✅ Supabase database');
  console.log('2. ✅ OpenAI API key'); 
  console.log('3. ✅ Gmail credentials');
  console.log('4. ✅ Google Maps API');
  console.log('5. ✅ Production environment');
  console.log('6. ⚠️  Twilio SMS (optional)');
  console.log('');

  const proceed = await question('Ready to set up production? (y/n): ');
  if (proceed.toLowerCase() !== 'y') {
    console.log('❌ Setup cancelled');
    rl.close();
    return;
  }

  console.log('\n🗄️  Step 1: Supabase Database Setup');
  console.log('===================================');
  console.log('1. Go to https://supabase.com');
  console.log('2. Create a new project');
  console.log('3. Go to Settings → Database');
  console.log('4. Copy your connection string');
  console.log('');
  
  const hasSupabase = await question('Have you created your Supabase project? (y/n): ');
  if (hasSupabase.toLowerCase() !== 'y') {
    console.log('⚠️  Please set up Supabase first, then run this script again.');
    rl.close();
    return;
  }

  const databaseUrl = await question('Enter your Supabase DATABASE_URL: ');
  
  console.log('\n🤖 Step 2: OpenAI API Key');
  console.log('=========================');
  console.log('1. Go to https://platform.openai.com/api-keys');
  console.log('2. Create a new API key');
  console.log('3. Copy the key (starts with sk-...)');
  console.log('');
  
  const openaiKey = await question('Enter your OpenAI API key: ');

  console.log('\n📧 Step 3: Gmail Configuration');
  console.log('==============================');
  console.log('1. Enable 2-factor authentication on Gmail');
  console.log('2. Generate an App Password');
  console.log('3. Go to Google Account → Security → App passwords');
  console.log('');
  
  const emailUser = await question('Enter your Gmail address: ');
  const emailPass = await question('Enter your Gmail app password: ');
  const alertEmail = await question('Enter email address for alerts: ');

  console.log('\n🗺️  Step 4: Google Maps API');
  console.log('===========================');
  console.log('1. Go to https://console.cloud.google.com/');
  console.log('2. Enable Maps JavaScript API and Geocoding API');
  console.log('3. Create credentials');
  console.log('');
  
  const mapsKey = await question('Enter your Google Maps API key: ');

  console.log('\n📱 Step 5: Twilio SMS (Optional)');
  console.log('================================');
  console.log('For high-priority prediction alerts via SMS');
  console.log('');
  
  const wantsTwilio = await question('Set up Twilio SMS alerts? (y/n): ');
  let twilioSid = '', twilioToken = '', twilioPhone = '';
  
  if (wantsTwilio.toLowerCase() === 'y') {
    console.log('1. Go to https://www.twilio.com/');
    console.log('2. Create account and get phone number');
    console.log('3. Copy Account SID and Auth Token');
    console.log('');
    
    twilioSid = await question('Enter Twilio Account SID: ');
    twilioToken = await question('Enter Twilio Auth Token: ');
    twilioPhone = await question('Enter Twilio phone number: ');
  }

  // Generate production .env file
  let twilioConfig = '';
  if (wantsTwilio.toLowerCase() === 'y') {
    twilioConfig = `# Twilio MCP (for SMS alerts)
TWILIO_ACCOUNT_SID=${twilioSid}
TWILIO_AUTH_TOKEN=${twilioToken}
TWILIO_PHONE_NUMBER=${twilioPhone}`;
  } else {
    twilioConfig = `# Twilio MCP (SMS alerts disabled)
# TWILIO_ACCOUNT_SID=your-twilio-account-sid
# TWILIO_AUTH_TOKEN=your-twilio-auth-token  
# TWILIO_PHONE_NUMBER=your-twilio-phone-number`;
  }

  const productionEnv = `# IntelliSense Production Configuration
# Generated: ${new Date().toISOString()}

# =============================================================================
# CORE CONFIGURATION
# =============================================================================

# OpenAI API (Required for AI predictions)
OPENAI_API_KEY=${openaiKey}

# Email Configuration (Required for alerts)
EMAIL_USER=${emailUser}
EMAIL_PASS=${emailPass}
ALERT_EMAIL=${alertEmail}

# =============================================================================
# DATABASE CONFIGURATION  
# =============================================================================

# Supabase Production Database
DATABASE_URL=${databaseUrl}

# =============================================================================
# SERVER CONFIGURATION
# =============================================================================

PORT=3000
NODE_ENV=production

# =============================================================================
# MCP SERVER CONFIGURATIONS
# =============================================================================

# Google Maps MCP (for geocoding and location services)
GOOGLE_MAPS_API_KEY=${mapsKey}

${twilioConfig}

# Supabase Additional Keys (for direct Supabase MCP usage)
SUPABASE_URL=https://brapdomowgihbuzouauls.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# SMTP MCP (enhanced email capabilities)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=${emailUser}
SMTP_PASS=${emailPass}

# =============================================================================
# PRODUCTION FEATURES ENABLED
# =============================================================================

# Scheduler: Enabled (every 2 hours)
# Database: Supabase Production
# AI Analysis: Enabled
# Email Alerts: Enabled
# Real-time Updates: Enabled
# SMS Alerts: ${wantsTwilio.toLowerCase() === 'y' ? 'Enabled' : 'Disabled'}
`;

  // Create backup of current .env
  const envPath = '.env';
  const backupPath = `.env.backup.${Date.now()}`;
  
  if (fs.existsSync(envPath)) {
    fs.copyFileSync(envPath, backupPath);
    console.log(`\n💾 Backup created: ${backupPath}`);
  }

  // Write production .env
  fs.writeFileSync(envPath, productionEnv);
  console.log('✅ Production .env file created');

  console.log('\n🎉 Production Configuration Complete!');
  console.log('====================================');
  console.log('');
  console.log('✅ What\'s been configured:');
  console.log('  • Database: Supabase (production)');
  console.log('  • AI Engine: OpenAI GPT-4');
  console.log('  • Email Alerts: Gmail');
  console.log('  • Geocoding: Google Maps');
  console.log(`  • SMS Alerts: ${wantsTwilio.toLowerCase() === 'y' ? 'Twilio' : 'Disabled'}`);
  console.log('  • Environment: Production');
  console.log('');
  console.log('🚀 Next Steps:');
  console.log('==============');
  console.log('1. npm run migrate:supabase  # Set up database tables');
  console.log('2. npm run dev              # Test the configuration');
  console.log('3. Check http://localhost:3000/health  # Verify status');
  console.log('');
  console.log('📊 Production Features Now Enabled:');
  console.log('  ✅ Automated permit scraping (every 2 hours)');
  console.log('  ✅ Job posting monitoring (18+ companies)');
  console.log('  ✅ AI-powered expansion predictions');
  console.log('  ✅ Email alerts for >80% confidence predictions');
  console.log('  ✅ Real-time dashboard updates');
  console.log('  ✅ Geocoding for permit addresses');
  console.log('');
  console.log('🎯 Your IntelliSense system is production-ready!');

  rl.close();
}

main().catch(console.error); 