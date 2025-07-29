#!/bin/bash
# Railway Deployment Verification Script

echo "🚀 Starting Railway deployment verification..."
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "Environment: $NODE_ENV"

# Check if required files exist
if [ -f "package.json" ]; then
  echo "✅ package.json found"
else
  echo "❌ package.json missing"
  exit 1
fi

if [ -f "server.js" ]; then
  echo "✅ server.js found"
else
  echo "❌ server.js missing"
  exit 1
fi

# Check database URL
if [ -n "$DATABASE_URL" ]; then
  echo "✅ DATABASE_URL configured"
else
  echo "⚠️ DATABASE_URL not set - demo mode"
fi

echo "🎯 Mid-market strategy configuration:"
echo "ALERT_CONFIDENCE_THRESHOLD: ${ALERT_CONFIDENCE_THRESHOLD:-85}"
echo "MIN_OFFICE_PERMIT_VALUE: ${MIN_OFFICE_PERMIT_VALUE:-300000}"
echo "MIN_INDUSTRIAL_PERMIT_VALUE: ${MIN_INDUSTRIAL_PERMIT_VALUE:-500000}"

echo "✅ Railway deployment verification complete"
