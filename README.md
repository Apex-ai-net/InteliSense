# 🏢 IntelliSense Real Estate Intelligence Platform

**AI-Powered Commercial Real Estate Lead Generation Platform**

## 🎯 Overview

IntelliSense Real Estate Intelligence Platform is a sophisticated AI-powered system designed to identify high-value commercial real estate opportunities across major metropolitan markets. The system monitors building permits, job postings, and corporate expansion signals to generate actionable leads for commercial real estate teams.

## 🚀 Key Features

### **Professional Lead Generation**
- **Verified Corporate Entities**: Identifies real companies, not generic placeholders
- **High-Value Permits**: Monitors $1M+ office, $2M+ industrial projects
- **Multi-City Coverage**: Major metropolitan areas and business districts
- **Property Type Classification**: Office, Industrial, Warehouse, Data Center, Research Lab, Medical Office
- **Consolidated Alerts**: Professional email reports with actionable recommendations

### **Target Markets**
- **Tech Companies**: Apple, Amazon, Google, Meta, Microsoft, NVIDIA, Intel
- **Biotech/Pharma**: Allergan, Edwards Lifesciences, Masimo, Alcon
- **Manufacturing/Industrial**: Boeing, Northrop Grumman, Raytheon, Lockheed Martin
- **Automotive**: Tesla, Rivian, Lucid Motors, Kia, Hyundai, Toyota
- **Logistics/Distribution**: Amazon, UPS, FedEx, DHL, Walmart, Target
- **Healthcare**: Kaiser Permanente, UCI Health, Hoag Hospital
- **Financial Services**: Pacific Life, First American, Experian, CoreLogic

### **Market Coverage**
- Major metropolitan business districts and commercial centers
- Tech corridors, biotech hubs, and industrial zones
- Financial districts and mixed-use developments
- Suburban office parks and research campuses

## 🏗️ System Architecture

### **Data Sources**
- **Building Permits**: Real-time monitoring of high-value construction projects
- **Job Postings**: Corporate hiring signals and expansion indicators
- **Corporate Filings**: SEC announcements and executive movements
- **Market Intelligence**: Local commercial real estate trends

### **AI Analysis**
- **Corporate Entity Verification**: Cross-references permit applicants with known companies
- **Property Type Classification**: Automatically categorizes project types
- **Lead Scoring**: Confidence-based prioritization of opportunities
- **Timeline Prediction**: 30-90 day windows for proactive outreach

### **Alert System**
- **Consolidated Reports**: Professional email summaries with all leads
- **Actionable Recommendations**: Industry-specific guidance for each opportunity
- **Priority Scoring**: High-confidence leads flagged for immediate action
- **Market Context**: Regional commercial real estate insights

## 📊 Lead Generation Criteria

### **Minimum Thresholds**
- **Office Projects**: $1M+ permit value
- **Industrial Projects**: $2M+ permit value
- **Job Postings**: 25+ positions in same location/company
- **Timeline**: 30-90 days for immediate opportunities
- **Location**: Major metropolitan areas with strong commercial real estate markets

### **Evidence Requirements**
1. **Permits**: Specific corporate entity, property type, value, location
2. **Jobs**: Company name, position count, location, timeline
3. **SEC Filings**: Corporate expansion announcements, facility investments
4. **Executive Movements**: Leadership changes, regional office announcements
5. **Real Estate Activity**: Leasing announcements, property acquisitions

## 🛠️ Technical Stack

- **Backend**: Node.js with Express
- **Database**: Supabase (PostgreSQL)
- **AI**: OpenAI GPT-4 for analysis
- **Scraping**: Puppeteer for data collection
- **Email**: Nodemailer for professional alerts
- **Deployment**: Railway for production hosting

## 📈 Business Impact

### **For Commercial Real Estate Teams**
- **Proactive Lead Generation**: Identify opportunities before competitors
- **Verified Corporate Entities**: Only real companies, no false positives
- **High-Value Projects**: Focus on significant commercial real estate deals
- **Local Market Expertise**: Leverage regional market knowledge
- **Professional Reporting**: Executive-ready intelligence summaries

### **Lead Quality Metrics**
- **Corporate Verification**: 100% real company identification
- **High-Value Focus**: $1M+ office, $2M+ industrial minimums
- **Market Coverage**: All major commercial real estate markets
- **Immediate Timeline**: 30-90 day windows for proactive outreach
- **Property Type Specificity**: Office, Industrial, Warehouse, Data Center, Research Lab, Medical Office

## 🚀 Getting Started

### **Prerequisites**
- Node.js 18+
- Supabase account
- OpenAI API key
- Email service (Gmail, SendGrid, etc.)

### **Installation**
```bash
git clone <repository>
cd intellisense
npm install
```

### **Environment Setup**
```bash
cp .env.example .env
# Configure your environment variables
```

### **Database Setup**
```bash
npm run db:generate
npm run db:push
```

### **Start the System**
```bash
npm start
```

## 📧 Alert System

The system sends professional consolidated email alerts with:
- **Lead Summary**: Total opportunities and confidence scores
- **Detailed Analysis**: Company, property type, location, timeline
- **Evidence**: Specific permit details and job posting data
- **Action Items**: Customized recommendations for each lead
- **Market Context**: Regional commercial real estate insights

## 🎯 Success Metrics

- **Lead Quality**: 100% verified corporate entities
- **Market Coverage**: All major commercial real estate markets
- **Project Value**: $1M+ office, $2M+ industrial minimums
- **Timeline**: 30-90 day windows for immediate opportunities
- **Professional Standards**: Executive-ready intelligence reports

---

**IntelliSense Real Estate Intelligence Platform**  
*AI-Powered Commercial Real Estate Intelligence Solution* 

## 🚨 Alert System Configuration

### **90% Confidence Threshold**
The system is configured to send email alerts **only for predictions with 90% confidence or higher**. This ensures clients receive only the highest-quality expansion leads.

### **Required Environment Variables (Railway)**
For email alerts to work in production, set these variables in Railway:

```bash
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password  # Gmail App Password (not your regular password)
ALERT_EMAIL=your-team@yourcompany.com
```

### **Alert Testing**
- **Manual Test**: Use the dashboard "TEST 90%" button or `/manual/test-alert` endpoint
- **Email Test**: Use `/manual/test-email` to verify email configuration
- **Confidence Test**: Send `{"confidence": 85}` to verify filtering works

### **Alert Triggers**
Alerts are automatically sent when:
1. **AI Analysis** generates predictions ≥90% confidence
2. **Verified corporate entities** are detected in permits/jobs
3. **High-value projects** ($1M+ office, $2M+ industrial) are identified
4. **Target companies** show expansion signals
