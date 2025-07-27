#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

console.log('🚀 IntelliSense Supabase Migration Helper');
console.log('=========================================\n');

async function checkSupabaseConnection() {
  console.log('🔍 Checking Supabase connection...');
  
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('[YOUR-PASSWORD]')) {
    console.log('❌ Please update your DATABASE_URL in .env with your Supabase credentials');
    console.log('📝 Format: postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres');
    console.log('\n🔧 To get your connection string:');
    console.log('   1. Go to your Supabase project dashboard');
    console.log('   2. Settings → Database');
    console.log('   3. Copy the "Connection string" under "Connection pooling"');
    console.log('   4. Replace [YOUR-PASSWORD] with your database password');
    return false;
  }

  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Supabase connection successful!');
    await prisma.$disconnect();
    return true;
  } catch (error) {
    console.log('❌ Connection failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('   - Check your DATABASE_URL format');
    console.log('   - Verify your password is correct');
    console.log('   - Ensure your Supabase project is active');
    return false;
  }
}

async function migrateSchema() {
  console.log('\n📋 Migrating database schema to Supabase...');
  
  try {
    // Generate Prisma client
    console.log('🔧 Generating Prisma client...');
    execSync('npx prisma generate', { stdio: 'inherit' });
    
    // Push schema to Supabase
    console.log('🚀 Pushing schema to Supabase...');
    execSync('npx prisma db push', { stdio: 'inherit' });
    
    console.log('✅ Schema migration completed!');
    return true;
  } catch (error) {
    console.log('❌ Schema migration failed:', error.message);
    return false;
  }
}

async function enableRealtime() {
  console.log('\n📡 Enabling Supabase Realtime (optional)...');
  console.log('💡 You can enable realtime for tables in your Supabase dashboard:');
  console.log('   1. Go to Database → Replication');
  console.log('   2. Enable realtime for: predictions, permits, jobs');
  console.log('   3. This allows real-time updates in your dashboard');
}

async function showNextSteps() {
  console.log('\n🎉 Migration Complete! Next steps:');
  console.log('================================');
  console.log('');
  console.log('🔧 Test your server:');
  console.log('   npm run dev');
  console.log('');
  console.log('📊 Verify database access:');
  console.log('   curl http://localhost:3000/health');
  console.log('');
  console.log('🌟 Supabase Benefits:');
  console.log('   - Hosted PostgreSQL database');
  console.log('   - Real-time subscriptions');
  console.log('   - Built-in authentication');
  console.log('   - Auto-generated REST/GraphQL APIs');
  console.log('   - Dashboard for data management');
  console.log('');
  console.log('🔗 Useful Supabase Features:');
  console.log('   - Database: https://app.supabase.com/project/[PROJECT]/editor');
  console.log('   - Auth: https://app.supabase.com/project/[PROJECT]/auth');
  console.log('   - Storage: https://app.supabase.com/project/[PROJECT]/storage');
  console.log('   - API Docs: https://app.supabase.com/project/[PROJECT]/api');
}

async function main() {
  // Step 1: Check connection
  const connected = await checkSupabaseConnection();
  if (!connected) {
    process.exit(1);
  }

  // Step 2: Migrate schema
  const migrated = await migrateSchema();
  if (!migrated) {
    process.exit(1);
  }

  // Step 3: Show realtime info
  await enableRealtime();

  // Step 4: Show next steps
  await showNextSteps();
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { checkSupabaseConnection, migrateSchema }; 