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
    
    // Corporate entity mappings for permit applicant analysis
    this.corporateEntityMap = {
      'Apple': ['Apple Inc', 'Apple Computer', 'Apple Operations', 'Apple Real Estate', 'Apple Facilities'],
      'Amazon': ['Amazon.com Inc', 'Amazon Web Services', 'Amazon Development', 'Amazon Logistics', 'Amazon Fulfillment'],
      'Google': ['Google LLC', 'Alphabet Inc', 'Google Real Estate', 'Google Facilities', 'Alphabet Real Estate'],
      'Meta': ['Meta Platforms', 'Facebook Inc', 'Meta Reality Labs', 'Meta Facilities', 'Facebook Real Estate'],
      'Tesla': ['Tesla Inc', 'Tesla Motors', 'Tesla Manufacturing', 'Tesla Energy', 'Tesla Facilities'],
      'Microsoft': ['Microsoft Corporation', 'Microsoft Real Estate', 'Microsoft Development', 'Microsoft Facilities'],
      'Netflix': ['Netflix Inc', 'Netflix Studios', 'Netflix Real Estate', 'Netflix Facilities'],
      'SpaceX': ['Space Exploration Technologies', 'SpaceX', 'Space X Corp', 'SpaceX Facilities'],
      'NVIDIA': ['NVIDIA Corporation', 'NVIDIA Corp', 'NVIDIA Real Estate', 'NVIDIA Facilities'],
      'Intel': ['Intel Corporation', 'Intel Corp', 'Intel Real Estate', 'Intel Facilities'],
      'Oracle': ['Oracle Corporation', 'Oracle Corp', 'Oracle Real Estate', 'Oracle America'],
      'Adobe': ['Adobe Inc', 'Adobe Systems', 'Adobe Real Estate', 'Adobe Facilities'],
      'Salesforce': ['Salesforce Inc', 'Salesforce.com', 'Salesforce Real Estate', 'Salesforce Facilities']
    };
  }

  async analyzeAndPredict() {
    try {
      console.log('🤖 Starting AI analysis and prediction...');
      
      // Get recent permits and jobs
      const permits = await prisma.permit.findMany({
        where: {
          date_filed: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
          }
        },
        orderBy: { date_filed: 'desc' },
        take: 50
      });
      
      const jobs = await prisma.job.findMany({
        where: {
          date_posted: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
          }
        },
        orderBy: { date_posted: 'desc' },
        take: 50
      });
      
      console.log(`📊 Found ${permits.length} permits and ${jobs.length} jobs for analysis`);
      
      // If no real data found, don't generate predictions
      if (permits.length === 0 && jobs.length === 0) {
        console.log('⚠️  No recent permits or jobs found for analysis');
        return { success: true, count: 0, predictions: [] };
      }
      
      // Filter out test data and vague applicants
      const realPermits = permits.filter(permit => 
        permit.applicant && 
        permit.applicant !== 'Tech Company LLC' &&
        permit.applicant !== 'Applicant not specified' &&
        permit.applicant !== 'Unknown Applicant'
      );
      
      console.log(`🏗️  Found ${realPermits.length} real permits with identifiable applicants`);
      
      // Create analysis prompt
      const prompt = this.createAnalysisPrompt(realPermits, jobs);
      
      // Get AI prediction
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are an expert business intelligence analyst specializing in corporate expansion signals in Orange County, California. Analyze building permits and job postings to identify potential corporate facility expansions.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      });
      
      const analysis = completion.choices[0].message.content;
      console.log('📝 AI Analysis completed');
      
      // Parse predictions from analysis
      const predictions = this.parsePredictions(analysis);
      
      // Save predictions to database
      const savedPredictions = [];
      const highConfidencePredictions = [];
      
      for (const prediction of predictions) {
        try {
          const savedPrediction = await prisma.prediction.create({
            data: {
              company: prediction.company,
              confidence_score: prediction.confidence_score,
              prediction_type: prediction.prediction_type,
              location: prediction.location,
              timeline_days: prediction.timeline_days,
              evidence: prediction.evidence,
              action_recommendation: prediction.action_recommendation
            }
          });
          
          savedPredictions.push(savedPrediction);
          
          if (prediction.confidence_score >= this.confidenceThreshold) {
            highConfidencePredictions.push(savedPrediction);
          }
          
        } catch (error) {
          console.error('Error saving prediction:', error);
        }
      }
      
      // Send consolidated alert if high-confidence predictions found
      if (highConfidencePredictions.length > 0) {
        console.log(`🚨 Sending consolidated alert for ${highConfidencePredictions.length} high-confidence predictions`);
        await this.emailSender.sendConsolidatedExpansionAlert(highConfidencePredictions);
      }
      
      console.log(`✅ Analysis complete: ${savedPredictions.length} predictions generated, ${highConfidencePredictions.length} high-confidence`);
      
      return {
        success: true,
        count: savedPredictions.length,
        predictions: savedPredictions
      };
      
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

CORPORATE ENTITY ANALYSIS:
Carefully analyze permit applicants and correlate them with target companies. Look for:
- Direct company names: "Apple Inc", "Amazon.com Inc", "Google LLC"
- Subsidiary entities: "Apple Operations LLC", "Amazon Development Corp", "Google Real Estate"
- Real estate entities: "Microsoft Real Estate", "Tesla Facilities LLC"
- Regional entities: "Apple Operations California", "Amazon West Coast"

Corporate Entity Reference:
${Object.entries(this.corporateEntityMap).map(([company, entities]) => 
  `${company}: ${entities.join(', ')}`
).join('\n')}

EVIDENCE REQUIREMENTS - Base predictions on specific, actionable evidence:
1. BUILDING PERMITS: Analyze actual permit applicant names and correlate with target companies
2. JOB POSTINGS: Cross-reference job locations with permit addresses
3. MASS HIRING: 50+ jobs in same location/department within 30 days
4. CORPORATE CORRELATION: Match permit applicants to known corporate entities
5. LOCATION INTELLIGENCE: Verify addresses and proximity between permits and job postings

ANALYSIS INSTRUCTIONS:
1. For each permit applicant, determine if it matches any target company or subsidiary
2. If "Tech Company LLC" or similar generic names appear, analyze the address and description to infer the actual company
3. Cross-reference permit locations with job posting locations
4. Only make predictions for confirmed corporate matches - never use generic placeholder names
5. If no clear corporate match exists, do not create a prediction

Return JSON array of predictions with VERIFIED corporate connections:
[
  {
    "company_name": "Apple",
    "confidence_score": 85,
    "prediction_type": "manufacturing_facility",
    "location": "Costa Mesa Industrial District",
    "timeline_days": 60,
    "evidence": [
      "Building permit #2024-0156: $15.2M manufacturing facility filed by Apple Operations LLC",
      "Permit address: 1234 Industrial Blvd matches 85 Manufacturing Engineer job postings for Costa Mesa",
      "62 Production Supervisor positions posted within 14 days of permit filing",
      "Corporate entity verification: Apple Operations LLC confirmed subsidiary of Apple Inc"
    ],
    "action_recommendation": "Contact Apple facilities team within 48 hours - verified $15.2M facility expansion"
  }
]

CRITICAL REQUIREMENTS:
- Only include predictions with verified corporate entity matches
- Never use generic names like "Tech Company LLC" - identify the actual company
- Evidence must include specific permit applicant analysis
- Cross-reference permit addresses with job posting locations
- Base confidence on strength of corporate entity correlation
- Include actionable recommendations with verified company contacts
- Focus on Orange County cities: ${this.targetCities.join(', ')}
- Minimum confidence score: 70% (only for verified corporate matches)`;
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

  parsePredictions(analysis) {
    try {
      // Extract predictions from AI analysis
      const predictions = [];
      
      // Look for prediction patterns in the analysis
      const predictionBlocks = analysis.split(/PREDICTION|prediction/i);
      
      for (const block of predictionBlocks) {
        if (block.trim().length < 50) continue; // Skip short blocks
        
        // Extract company name
        const companyMatch = block.match(/company[:\s]+([A-Za-z\s,\.&]+)/i) ||
                           block.match(/([A-Za-z\s,\.&]+(?:LLC|Inc|Corp|Corporation|Company|Co\.|Ltd))/i);
        
        // Extract confidence score
        const confidenceMatch = block.match(/confidence[:\s]*(\d+)/i) ||
                              block.match(/(\d+)%?\s*confidence/i);
        
        // Extract location
        const locationMatch = block.match(/location[:\s]+([A-Za-z\s\d,]+(?:St|Ave|Blvd|Dr|Rd|Way|Ct|Ln))/i) ||
                            block.match(/([A-Za-z\s\d,]+(?:St|Ave|Blvd|Dr|Rd|Way|Ct|Ln))/i);
        
        // Extract timeline
        const timelineMatch = block.match(/timeline[:\s]*(\d+)\s*days/i) ||
                            block.match(/(\d+)\s*days/i);
        
        // Extract evidence
        const evidenceMatches = block.match(/evidence[:\s]*([^]*?)(?=action|recommendation|$)/i);
        
        if (companyMatch) {
          const prediction = {
            company: companyMatch[1].trim(),
            confidence_score: confidenceMatch ? parseInt(confidenceMatch[1]) : 75,
            prediction_type: 'commercial_facility',
            location: locationMatch ? locationMatch[1].trim() : 'Orange County, CA',
            timeline_days: timelineMatch ? parseInt(timelineMatch[1]) : 30,
            evidence: evidenceMatches ? [evidenceMatches[1].trim()] : ['Analysis based on permit and job data'],
            action_recommendation: 'Monitor for additional expansion signals and verify with local authorities'
          };
          
          predictions.push(prediction);
        }
      }
      
      // If no structured predictions found, create one based on analysis
      if (predictions.length === 0) {
        const defaultPrediction = {
          company: 'Corporate Entity (Analysis Required)',
          confidence_score: 60,
          prediction_type: 'commercial_facility',
          location: 'Orange County, CA',
          timeline_days: 30,
          evidence: [analysis.substring(0, 500)],
          action_recommendation: 'Further investigation needed to identify specific corporate entities'
        };
        
        predictions.push(defaultPrediction);
      }
      
      return predictions;
      
    } catch (error) {
      console.error('Error parsing predictions:', error);
      return [{
        company: 'Analysis Error',
        confidence_score: 50,
        prediction_type: 'commercial_facility',
        location: 'Orange County, CA',
        timeline_days: 30,
        evidence: ['Error parsing AI analysis'],
        action_recommendation: 'Review analysis manually'
      }];
    }
  }
}

module.exports = AIPredictor; 