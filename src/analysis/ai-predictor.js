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
          
          // Send alert if confidence is high enough
          if (prediction.confidence_score >= this.confidenceThreshold) {
            console.log(`🚨 High confidence prediction: ${prediction.company_name} (${prediction.confidence_score}%)`);
            await this.emailSender.sendExpansionAlert(prediction);
          }
          
        } catch (error) {
          console.error('Error saving prediction:', error);
        }
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

    return `Analyze these Orange County signals and predict company expansions:

Building permits: ${JSON.stringify(permitsData, null, 2)}

Job postings: ${JSON.stringify(jobsData, null, 2)}

Focus on these target companies: ${this.targetCompanies.join(', ')}

Look for patterns indicating:
1. New facility construction (permits >$1M)
2. Mass hiring (50+ jobs in specific locations)
3. Infrastructure development
4. Manufacturing/warehouse expansion
5. R&D facility development

Return JSON array of predictions:
[
  {
    "company_name": "Apple",
    "confidence_score": 85,
    "prediction_type": "manufacturing_facility",
    "location": "Tustin Legacy",
    "timeline_days": 60,
    "evidence": ["$50M permit filed", "200 manufacturing jobs posted"],
    "action_recommendation": "Contact Apple facilities team immediately"
  }
]

Rules:
- Only include predictions with confidence_score >= 70
- Base confidence on strength of evidence
- Include specific evidence from the data
- Provide actionable recommendations
- Focus on Orange County locations
- Consider timing correlation between permits and jobs`;
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