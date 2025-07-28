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
    this.confidenceThreshold = 90; // Raised to 90% for high-quality alerts only
    
    // Target companies for Voit Commercial Real Estate
    this.targetCompanies = [
      // Tech Companies
      'Apple', 'Amazon', 'Google', 'Meta', 'Microsoft', 'Netflix', 'Adobe', 'Salesforce', 'Oracle',
      'NVIDIA', 'Intel', 'AMD', 'Qualcomm', 'Broadcom', 'Western Digital', 'Seagate',
      // Biotech/Pharma
      'Irvine Company', 'Allergan', 'Edwards Lifesciences', 'Masimo', 'Alcon', 'Bausch Health',
      // Manufacturing/Industrial
      'Boeing', 'Northrop Grumman', 'Raytheon', 'Lockheed Martin', 'General Dynamics',
      // Automotive
      'Tesla', 'Rivian', 'Lucid Motors', 'Kia', 'Hyundai', 'Toyota', 'Honda',
      // Logistics/Distribution
      'Amazon', 'UPS', 'FedEx', 'DHL', 'Walmart', 'Target', 'Costco',
      // Healthcare
      'Kaiser Permanente', 'UCI Health', 'Hoag Hospital', 'Providence Health',
      // Financial Services
      'Pacific Life', 'First American', 'Experian', 'CoreLogic', 'Allstate'
    ];
    
    this.targetCities = [
      'Irvine', 'Newport Beach', 'Costa Mesa', 'Santa Ana', 'Anaheim', 'Orange',
      'Tustin', 'Fullerton', 'Garden Grove', 'Huntington Beach', 'Fountain Valley',
      'Westminster', 'Cypress', 'Los Alamitos', 'Seal Beach', 'La Habra'
    ];
    
    // Professional corporate entity mappings for Voit
    this.corporateEntityMap = {
      'Apple': ['Apple Inc', 'Apple Computer', 'Apple Operations', 'Apple Real Estate', 'Apple Facilities', 'Apple Development'],
      'Amazon': ['Amazon.com Inc', 'Amazon Development Corp', 'Amazon Real Estate', 'Amazon Operations', 'Amazon Web Services'],
      'Google': ['Google LLC', 'Alphabet Inc', 'Google Real Estate', 'Google Development', 'Google Operations'],
      'Meta': ['Meta Platforms Inc', 'Facebook Inc', 'Meta Real Estate', 'Meta Development'],
      'Microsoft': ['Microsoft Corporation', 'Microsoft Real Estate', 'Microsoft Development', 'Microsoft Operations'],
      'Tesla': ['Tesla Inc', 'Tesla Motors', 'Tesla Real Estate', 'Tesla Development', 'Tesla Manufacturing'],
      'Rivian': ['Rivian Automotive', 'Rivian Real Estate', 'Rivian Development'],
      'Irvine Company': ['Irvine Company LLC', 'Irvine Company Real Estate', 'Irvine Company Development'],
      'Allergan': ['Allergan Inc', 'Allergan Real Estate', 'Allergan Development'],
      'Edwards Lifesciences': ['Edwards Lifesciences Corp', 'Edwards Real Estate', 'Edwards Development'],
      'Boeing': ['Boeing Company', 'Boeing Real Estate', 'Boeing Development', 'Boeing Operations'],
      'Northrop Grumman': ['Northrop Grumman Corp', 'Northrop Real Estate', 'Northrop Development'],
      'Kaiser Permanente': ['Kaiser Foundation', 'Kaiser Real Estate', 'Kaiser Development'],
      'Pacific Life': ['Pacific Life Insurance', 'Pacific Life Real Estate', 'Pacific Life Development']
    };
    
    // Property types for Voit Commercial Real Estate
    this.propertyTypes = [
      'office', 'industrial', 'warehouse', 'distribution', 'manufacturing', 'data_center',
      'research_lab', 'medical_office', 'retail', 'mixed_use', 'flex_space', 'logistics'
    ];
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
        console.log(`🚨 HIGH-CONFIDENCE ALERT TRIGGERED: ${highConfidencePredictions.length} predictions ≥90% confidence`);
        console.log('Alert details:', highConfidencePredictions.map(p => `${p.company}: ${p.confidence_score}%`));
        
        try {
          await this.emailSender.sendConsolidatedExpansionAlert(highConfidencePredictions);
          console.log('✅ Alert email sent successfully');
        } catch (emailError) {
          console.error('❌ Failed to send alert email:', emailError.message);
        }
      } else {
        console.log('📊 No high-confidence predictions (≥90%) generated - no alerts sent');
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

    return `Analyze these Orange County business expansion signals for Voit Commercial Real Estate lead generation:

Building Permits: ${JSON.stringify(permitsData, null, 2)}

Job Postings: ${JSON.stringify(jobsData, null, 2)}

Target Companies: ${this.targetCompanies.join(', ')}
Target Cities: ${this.targetCities.join(', ')}

VOIT COMMERCIAL REAL ESTATE ANALYSIS REQUIREMENTS:

CORPORATE ENTITY ANALYSIS:
- Identify real corporate entities from permit applicants
- Cross-reference with target companies and their subsidiaries
- Look for direct company names: "Apple Inc", "Amazon.com Inc", "Google LLC"
- Identify subsidiary entities: "Apple Operations LLC", "Amazon Development Corp", "Google Real Estate"
- Verify real estate entities: "Microsoft Real Estate", "Tesla Facilities LLC"
- Check regional entities: "Apple Operations California", "Amazon West Coast"

PROPERTY TYPE CLASSIFICATION:
- Office: Corporate headquarters, regional offices, satellite offices
- Industrial: Manufacturing facilities, assembly plants, R&D centers
- Warehouse: Distribution centers, fulfillment centers, storage facilities
- Data Center: Server farms, cloud infrastructure, tech facilities
- Research Lab: Biotech labs, pharmaceutical research, medical facilities
- Medical Office: Healthcare facilities, medical centers, clinics
- Mixed Use: Office/retail combinations, corporate campuses

LEAD GENERATION CRITERIA:
- Minimum permit value: $1M+ for office, $2M+ for industrial
- Job postings: 50+ positions in same location/company
- Timeline: 30-90 days for immediate opportunities
- Location: Orange County cities with strong commercial real estate market
- Company size: Fortune 500 or major regional employers

EVIDENCE REQUIREMENTS:
1. PERMITS: Specific corporate entity, property type, value, location
2. JOBS: Company name, position count, location, timeline
3. SEC FILINGS: Corporate expansion announcements, facility investments
4. EXECUTIVE MOVEMENTS: Leadership changes, regional office announcements
5. REAL ESTATE ACTIVITY: Leasing announcements, property acquisitions

ONLY generate predictions for:
- Verified corporate entities (not generic "Tech Company LLC")
- High-value permits ($1M+ office, $2M+ industrial)
- Companies with significant job postings (50+ positions)
- Orange County locations with strong commercial real estate demand
- Property types suitable for Voit's expertise

Format predictions as:
COMPANY: [Real corporate entity name]
CONFIDENCE: [75-95% based on evidence strength]
PROPERTY TYPE: [office/industrial/warehouse/data_center/research_lab/medical_office]
LOCATION: [Specific Orange County address or area]
TIMELINE: [30-90 days]
EVIDENCE: [Specific permit details, job counts, corporate entity verification]
ACTION: [Voit-specific recommendation for lead generation]`;
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
      
      // Return empty array - no fake data
      return [];
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