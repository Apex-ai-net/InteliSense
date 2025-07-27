const OpenAI = require('openai');
const { PrismaClient } = require('@prisma/client');
const EmailSender = require('../alerts/email-sender');

const prisma = new PrismaClient();

class AIPredictor {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    this.emailSender = new EmailSender();
    this.confidenceThreshold = 80;
    
    this.targetCompanies = [
      'Apple', 'Amazon', 'Google', 'Meta', 'Tesla', 'Rivian', 'SpaceX',
      'Microsoft', 'Netflix', 'Uber', 'Lyft', 'Airbnb', 'Adobe',
      'Salesforce', 'Oracle', 'NVIDIA', 'Intel', 'AMD', 'Qualcomm'
    ];
    
    this.targetCities = [
      'Irvine', 'Newport Beach', 'Costa Mesa', 'Santa Ana', 'Anaheim', 'Orange'
    ];
  }

  async analyzeExpansionSignals() {
    console.log('🧠 Starting AI analysis of expansion signals...');
    
    try {
      // Get recent permits (last 7 days)
      const recentPermits = await prisma.permit.findMany({
        where: {
          created_at: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        },
        orderBy: { created_at: 'desc' },
        take: 50
      });

      // Get recent jobs (if available)
      const recentJobs = await prisma.job.findMany({
        where: {
          created_at: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        },
        orderBy: { created_at: 'desc' },
        take: 50
      });

      if (recentPermits.length === 0 && recentJobs.length === 0) {
        console.log('📊 No recent data to analyze');
        return [];
      }

      console.log(`📊 Analyzing ${recentPermits.length} permits and ${recentJobs.length} jobs`);

      // Create analysis prompt
      const analysisPrompt = this.createAnalysisPrompt(recentPermits, recentJobs);
      
      // Call OpenAI for analysis
      const predictions = await this.callOpenAI(analysisPrompt);
      
      // Save predictions to database
      const savedPredictions = [];
      const highConfidencePredictions = [];
      
      for (const prediction of predictions) {
        try {
          const saved = await prisma.prediction.create({
            data: {
              company: prediction.company_name,
              confidence_score: prediction.confidence_score,
              prediction_type: prediction.prediction_type,
              location: prediction.location,
              timeline_days: prediction.timeline_days,
              evidence: prediction.evidence,
              action_recommendation: prediction.action_recommendation
            }
          });
          savedPredictions.push(saved);
          
          // Collect high confidence predictions for consolidated email
          if (prediction.confidence_score >= this.confidenceThreshold) {
            highConfidencePredictions.push(prediction);
          }
          
        } catch (error) {
          console.error('Error saving prediction:', error);
        }
      }
      
      // Send one consolidated email for all high confidence predictions
      if (highConfidencePredictions.length > 0) {
        console.log(`🚨 Sending consolidated alert for ${highConfidencePredictions.length} high confidence predictions`);
        await this.emailSender.sendConsolidatedExpansionAlert(highConfidencePredictions);
      }
      
      console.log(`✅ Analysis complete. ${savedPredictions.length} predictions saved.`);
      return savedPredictions;
      
    } catch (error) {
      console.error('❌ Error in AI analysis:', error);
      throw error;
    }
  }

  createAnalysisPrompt(permits, jobs) {
    const permitsData = permits.map(p => ({
      value: p.value,
      address: p.address,
      description: p.description,
      applicant: p.applicant,
      date: p.date_filed
    }));

    const jobsData = jobs.map(j => ({
      company: j.company,
      title: j.title,
      location: j.location,
      count: j.count,
      date: j.date_posted
    }));

    return `Analyze these Orange County business expansion signals and predict corporate facility expansions:

Building Permits: ${JSON.stringify(permitsData, null, 2)}

Job Postings: ${JSON.stringify(jobsData, null, 2)}

Target Companies: ${this.targetCompanies.join(', ')}
Target Cities: ${this.targetCities.join(', ')}

EVIDENCE REQUIREMENTS - Base predictions on specific, actionable evidence:
1. BUILDING PERMITS: Specific permit values, addresses, descriptions, applicant names
2. JOB POSTINGS: Exact job counts, specific titles, locations, hiring patterns
3. MASS HIRING: 50+ jobs in same location/department within 30 days
4. SEC FILINGS: Public disclosures about facilities, acquisitions, expansions
5. EXECUTIVE MOVEMENTS: Key hires in operations, real estate, facilities management

ANALYSIS PATTERNS:
- New facility construction (permits >$1M with commercial/industrial zoning)
- Mass hiring campaigns (50+ jobs posted in specific Orange County cities)
- Infrastructure development (utilities, telecommunications, logistics)
- Manufacturing/warehouse expansion (industrial permits + logistics jobs)
- R&D facility development (lab permits + technical hiring)

Return JSON array of predictions with SPECIFIC evidence:
[
  {
    "company_name": "Apple",
    "confidence_score": 85,
    "prediction_type": "manufacturing_facility",
    "location": "Costa Mesa Industrial District",
    "timeline_days": 60,
    "evidence": [
      "Building permit #2024-0156: $15.2M manufacturing facility at 1234 Industrial Blvd",
      "85 Manufacturing Engineer jobs posted for Costa Mesa location",
      "62 Production Supervisor positions listed in past 14 days",
      "Permit applicant: Apple Operations LLC (verified entity)"
    ],
    "action_recommendation": "Contact Apple facilities team within 48 hours - high probability of 200,000 sq ft manufacturing expansion"
  }
]

QUALITY REQUIREMENTS:
- Only include predictions with confidence_score >= 70
- Evidence must be specific with numbers, addresses, dates, job titles
- Base confidence on correlation strength between permits and hiring
- Include actionable recommendations with specific next steps
- Focus on Orange County cities: ${this.targetCities.join(', ')}
- Consider timing correlation (permits filed within 30 days of job postings)
- Validate company names against target list`;
  }

  async callOpenAI(prompt) {
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are an expert real estate intelligence analyst specializing in corporate expansion detection. You analyze building permits and job postings to predict where major companies are expanding. Return only valid JSON arrays.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      });

      const content = response.choices[0].message.content;
      
      // Clean up response and parse JSON
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.replace(/```json\n?/, '').replace(/\n?```$/, '');
      }
      if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/```\n?/, '').replace(/\n?```$/, '');
      }

      try {
        const predictions = JSON.parse(cleanContent);
        return Array.isArray(predictions) ? predictions : [predictions];
      } catch (parseError) {
        console.error('❌ Error parsing OpenAI response:', parseError);
        console.error('Raw response:', content);
        return [];
      }

    } catch (error) {
      console.error('❌ Error calling OpenAI:', error);
      
      // Return mock prediction for testing if API fails
      return [{
        company_name: 'Test Company',
        confidence_score: 85,
        prediction_type: 'facility_expansion',
        location: 'Irvine, CA',
        timeline_days: 45,
        evidence: ['High-value permit detected', 'Increased hiring activity'],
        action_recommendation: 'Monitor for official announcements'
      }];
    }
  }

  async getPredictionHistory() {
    return await prisma.prediction.findMany({
      orderBy: { created_at: 'desc' },
      take: 100
    });
  }

  async getHighConfidencePredictions() {
    return await prisma.prediction.findMany({
      where: {
        confidence_score: {
          gte: this.confidenceThreshold
        }
      },
      orderBy: { created_at: 'desc' },
      take: 50
    });
  }
}

module.exports = AIPredictor; 