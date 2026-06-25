// Test script with full structured prompt (like the real app)
const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL;
if (!API_BASE_URL) {
  throw new Error('API_BASE_URL is required. Set it before running this script.');
}

async function runComprehensiveTest() {
  console.log('Starting comprehensive test with full structured prompt...\n');
  
  const url = `${API_BASE_URL}/api/generate`;
  const models = ['gemini-2.5-flash'];
  const topic = 'Artificial Intelligence';
  const context = 'Recent advances in machine learning';
  
  const promptText = `
You are an expert Topic Research Assistant.
Topic: ${topic}
Context/Source: ${context || 'None provided'}

Provide a structured analysis with the following sections EXACTLY:
1. "keyPoints": Array of 5 strings (bullet points summarizing the topic).
2. "analysis": { "type": "string", "positive": ["string"], "negative": ["string"] }
3. "recommendation": "string"

Output ONLY valid JSON without any markdown formatting. The JSON should match the structure above.`;

  const attempts = [];

  for (const model of models) {
    try {
      console.log(`\n>>> Requesting model: ${model}`);
      console.log(`>>> Prompt length: ${promptText.length} chars`);
      
      const resp = await axios.post(url, { model, prompt: promptText }, { timeout: 30000 });
      
      console.log(`<<< Status: ${resp.status}`);
      console.log(`<<< Response keys:`, Object.keys(resp.data));
      
      if (resp.status === 200) {
        console.log(`<<< SUCCESS! Got valid response.`);
        attempts.push({ model, status: resp.status, success: true });
        // Don't break - try all models to see results
      }
    } catch (err) {
      if (err.response) {
        console.log(`<<< Error status: ${err.response.status}`);
        console.log(`<<< Error:`, err.response.data?.error || err.response.data);
        attempts.push({ model, status: err.response.status, success: false, error: err.response.data });
      } else {
        console.log(`<<< Network Error: ${err.message}`);
        attempts.push({ model, status: null, success: false, error: err.message });
      }
    }
  }

  console.log('\n\n=== COMPREHENSIVE TEST RESULTS ===');
  console.log(JSON.stringify(attempts, null, 2));
}

runComprehensiveTest().catch(e => console.error('Test error:', e));
