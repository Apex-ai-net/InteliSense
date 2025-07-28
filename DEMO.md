# 🚀 IntelliSense Demo Guide

## Quick Demo Without Full Setup

### 1. Test the Server (Without Database)
```bash
# Start server in demo mode (will use mock data)
npm start
```

### 2. Test Endpoints
```bash
# Check system status
curl http://localhost:3000

# Health check (will show database errors until configured)
curl http://localhost:3000/health

# Test manual triggers (will use fallback mock data)
curl -X POST http://localhost:3000/manual/scrape-permits
curl -X POST http://localhost:3000/manual/analyze
```

### 3. Expected Output (Mock Data)
The system includes fallback mock data when services aren't configured:

**Mock Permit:**
```json
{
  "id": "test_permit_123",
  "value": 2500000,
  "address": "123 Innovation Drive, Irvine, CA",
  "description": "New commercial facility construction",
  "applicant": "Tech Company LLC"
}
```

**Mock Prediction:**
```json
{
  "company_name": "Test Company",
  "confidence_score": 85,
  "prediction_type": "facility_expansion",
  "location": "Irvine, CA",
  "timeline_days": 45,
  "evidence": ["High-value permit detected", "Increased hiring activity"],
  "action_recommendation": "Monitor for official announcements"
}
```

## Full Setup Demo

### 1. Environment Setup
Create `.env` file:
```bash
OPENAI_API_KEY=sk-your-key-here
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
ALERT_EMAIL=admin@thefiredev.com
DATABASE_URL=postgresql://localhost:5432/intellisense
```

### 2. Database Setup
```bash
# Create database
createdb intellisense

# Run setup script
node setup.js

# Or manual setup
npm run db:push
```

### 3. Test Full System
```bash
# Start system
npm start

# Test permit scraping
curl -X POST http://localhost:3000/manual/scrape-permits

# Test email alerts
curl -X POST http://localhost:3000/manual/test-email

# Run AI analysis
curl -X POST http://localhost:3000/manual/analyze

# View results
curl http://localhost:3000/predictions
curl http://localhost:3000/permits
```

## Demo Scenarios

### Scenario 1: High-Value Permit Detection
The system will:
1. Scrape Irvine permits
2. Filter for >$1M permits
3. Store in database
4. Trigger AI analysis

### Scenario 2: Mass Hiring Detection
The system will:
1. Monitor Indeed job postings
2. Track 50+ job clusters
3. Correlate with permit data
4. Generate expansion predictions

### Scenario 3: Email Alert Flow
When confidence >80%:
1. AI generates prediction
2. Email alert sent automatically
3. Beautiful HTML format
4. Actionable recommendations

## Performance Expectations

- **Startup Time**: ~5 seconds
- **Permit Scraping**: 30-60 seconds
- **Job Monitoring**: 2-5 minutes (18 companies)
- **AI Analysis**: 10-30 seconds
- **Email Delivery**: 1-3 seconds

## Mock Data vs Real Data

The system gracefully handles missing services:

| Component | Mock Fallback | Real Data Source |
|-----------|---------------|------------------|
| Permits | Sample construction permit | Irvine portal scraping |
| Jobs | Sample tech job listings | Indeed API/scraping |
| AI Analysis | Test prediction | OpenAI GPT-4 |
| Email | Console log | Gmail SMTP |

## Demo Commands Cheat Sheet

```bash
# Setup
node setup.js

# Start system  
npm start

# Manual testing
curl -X POST http://localhost:3000/manual/scrape-permits
curl -X POST http://localhost:3000/manual/monitor-jobs
curl -X POST http://localhost:3000/manual/analyze
curl -X POST http://localhost:3000/manual/test-email

# View data
curl http://localhost:3000/health
curl http://localhost:3000/predictions
curl http://localhost:3000/permits
curl http://localhost:3000/jobs

# Database management
npm run db:studio
npm run db:push
```

## Expected Demo Flow

1. **Setup Check** - Run `node setup.js`
2. **Start System** - Run `npm start`  
3. **Test Scraping** - Trigger permit scraping
4. **View Results** - Check health endpoint
5. **Test AI** - Trigger analysis
6. **Test Alerts** - Send test email
7. **Monitor System** - Check scheduler logs

## Demo Success Criteria

✅ Server starts without errors  
✅ Health check returns system info  
✅ Manual triggers work  
✅ Database stores data  
✅ AI generates predictions  
✅ Email alerts send  
✅ Scheduler runs automatically  

---

**🎯 Ready to detect the next big Orange County expansion!** 