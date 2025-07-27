# 🧠 IntelliSense Real Estate Intelligence

> Orange County business expansion monitoring system that analyzes building permits and job postings to predict corporate expansions.

## 🚀 Features

- **Automated Scraping**: Monitors Irvine building permits every 2 hours
- **Job Intelligence**: Tracks Indeed job postings for 18+ major tech companies
- **AI Analysis**: Uses OpenAI GPT-4 to correlate data and predict expansions
- **Email Alerts**: Sends beautiful HTML alerts for high-confidence predictions (>80%)
- **PostgreSQL Storage**: Tracks permits, jobs, predictions, and system logs
- **Health Monitoring**: Built-in health checks and daily reports

## 🏗️ Architecture

```
intellisense/
├── src/
│   ├── scrapers/
│   │   ├── irvine-permits.js      # Building permits scraper
│   │   └── job-monitor.js         # Indeed job monitoring
│   ├── analysis/
│   │   └── ai-predictor.js        # OpenAI-powered prediction engine
│   ├── alerts/
│   │   └── email-sender.js        # Email notification system
│   ├── database/
│   │   └── schema.prisma          # Database schema
│   └── scheduler.js               # Cron job scheduler
├── server.js                      # Express API server
├── package.json
└── README.md
```

## 📋 Prerequisites

- Node.js 16+ 
- PostgreSQL database
- OpenAI API key
- Gmail account (for email alerts)

## ⚡ Quick Start

### 1. Clone and Install
```bash
cd intellisense
npm install
```

### 2. Environment Setup
Create a `.env` file with:
```bash
# OpenAI Configuration
OPENAI_API_KEY=your-openai-api-key-here

# Email Configuration (Gmail)
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASS=your-gmail-app-password
ALERT_EMAIL=rosterkamp@voitco.com

# Database Configuration
DATABASE_URL=postgresql://localhost:5432/intellisense

# Server Configuration
PORT=3000
NODE_ENV=development
```

### 3. Database Setup
```bash
# Create database
createdb intellisense

# Generate Prisma client
npm run db:generate

# Push schema to database
npm run db:push
```

### 4. Start the System
```bash
npm start
```

The system will start and automatically begin:
- ✅ Scraping permits every 2 hours
- ✅ Monitoring jobs every 2 hours
- ✅ Running AI analysis every 4 hours
- ✅ Sending daily reports at 9 AM

## 🎯 API Endpoints

### Core Endpoints
- `GET /` - System information and available endpoints
- `GET /health` - Health check with system stats
- `GET /predictions` - Recent AI predictions
- `GET /permits` - Recent building permits
- `GET /jobs` - Recent job postings

### Manual Triggers (for testing)
- `POST /manual/scrape-permits` - Trigger permit scraping
- `POST /manual/monitor-jobs` - Trigger job monitoring
- `POST /manual/analyze` - Trigger AI analysis
- `POST /manual/test-email` - Send test email alert

## 🎛️ Usage Examples

### Check System Health
```bash
curl http://localhost:3000/health
```

### View Recent Predictions
```bash
curl http://localhost:3000/predictions
```

### Manually Trigger Analysis
```bash
curl -X POST http://localhost:3000/manual/analyze
```

### Test Email Alerts
```bash
curl -X POST http://localhost:3000/manual/test-email
```

## 🤖 AI Analysis

The system uses OpenAI GPT-4 to analyze patterns in:

1. **Building Permits** (>$1M value)
   - Commercial construction
   - Infrastructure development
   - R&D facilities

2. **Job Postings** (50+ positions)
   - Mass hiring events
   - New facility staffing
   - Expansion indicators

3. **Target Companies**
   - Apple, Amazon, Google, Meta
   - Tesla, Rivian, SpaceX
   - Microsoft, Netflix, NVIDIA
   - And 10+ more tech giants

## 📧 Email Alerts

Automatic alerts are sent when predictions have >80% confidence:

**Alert Format:**
```
🚨 EXPANSION DETECTED: Apple - Tustin Legacy

Company: Apple
Confidence: 95%
Location: Tustin Legacy, CA
Timeline: 60 days

Evidence:
• $50M permit filed for new facility
• 200 manufacturing jobs posted
• Infrastructure permits detected

Action: Contact Apple facilities team immediately
```

## 📊 Scheduling

- **Permits & Jobs**: Every 2 hours
- **AI Analysis**: Every 4 hours  
- **Daily Report**: 9:00 AM daily
- **Health Check**: Every 30 minutes

## 🛠️ Development

### Run in Development Mode
```bash
npm run dev
```

### Database Management
```bash
# View data in Prisma Studio
npm run db:studio

# Apply database migrations
npm run db:migrate

# Manual scraping test
npm run scrape

# Manual analysis test
npm run analyze
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key for GPT-4 | ✅ |
| `EMAIL_USER` | Gmail address for sending alerts | ✅ |
| `EMAIL_PASS` | Gmail app password | ✅ |
| `ALERT_EMAIL` | Email to receive alerts | ✅ |
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `PORT` | Server port (default: 3000) | ❌ |
| `NODE_ENV` | Environment (development/production) | ❌ |

## 🗃️ Database Schema

### Tables
- **predictions** - AI predictions with confidence scores
- **permits** - Building permit data from Irvine
- **jobs** - Job posting data from Indeed
- **scraping_logs** - System activity logs

### Key Relationships
- Predictions link to evidence from permits and jobs
- Logs track scraping success/failure rates
- Historical data enables trend analysis

## 🚨 Monitoring

### Health Check Response
```json
{
  "status": "healthy",
  "uptime": 3600,
  "stats": {
    "totalPermits": 156,
    "todayPermits": 12,
    "totalPredictions": 45,
    "todayPredictions": 3
  },
  "lastScrapes": {
    "permits": "2025-01-20T10:00:00Z",
    "jobs": "2025-01-20T10:00:00Z"
  }
}
```

## 🔧 Troubleshooting

### Common Issues

**Database Connection Failed**
```bash
# Check PostgreSQL is running
pg_ctl status

# Verify database exists
psql -l | grep intellisense
```

**Email Alerts Not Working**
- Ensure Gmail 2FA is enabled
- Use App Password, not regular password
- Check Gmail security settings

**Scraping Errors**
- Websites may change structure
- Check console logs for specific errors
- Puppeteer may need updated selectors

### Error Logs
Monitor system logs via:
```bash
# View recent scraping activity
curl http://localhost:3000/health | jq '.lastScrapes'

# Check manual triggers for debugging
curl -X POST http://localhost:3000/manual/scrape-permits
```

## 📈 Performance

- **Memory Usage**: ~200MB typical
- **CPU Usage**: Low except during scraping bursts
- **Database Size**: ~100MB per year of data
- **Email Rate**: Up to 10 alerts per day

## 🔐 Security

- Environment variables for sensitive data
- No API keys in code
- Database connection encryption
- Email authentication via app passwords

## 🚀 Deployment

### Production Checklist
- [ ] Set `NODE_ENV=production`
- [ ] Configure production database
- [ ] Set up email monitoring
- [ ] Enable database backups
- [ ] Monitor system health
- [ ] Set up log rotation

### Docker Deployment (Optional)
```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## 📄 License

ISC License - See LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Test thoroughly
4. Submit pull request

---

**🎯 Goal**: Detect Orange County business expansions before they're announced publicly, giving you the first-mover advantage in commercial real estate opportunities. 