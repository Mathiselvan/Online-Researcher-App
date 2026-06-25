// Test script to run the proxy in MOCK_MODE and send a request to it.
// Usage: `MOCK_MODE=true node test_mock_run.js`

const axios = require('axios');
const child_process = require('child_process');
const path = require('path');

async function runTest() {
  console.log('Starting test against proxy (MOCK_MODE)...');
  const API_BASE_URL = process.env.API_BASE_URL;
  if (!API_BASE_URL) {
    throw new Error('API_BASE_URL is required. Set it before running this script.');
  }
  const url = `${API_BASE_URL}/api/generate`;
  const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-pro'];
  const prompt = 'Test prompt for mock run';
  const attempts = [];

  for (const model of models) {
    try {
      console.log(`Requesting model: ${model}`);
      const resp = await axios.post(url, { model, prompt }, { timeout: 10000 });
      console.log('Status:', resp.status);
      console.log('Data:', JSON.stringify(resp.data));
      attempts.push({ model, status: resp.status, data: resp.data });
      if (resp.status === 200) break; // stop on success
    } catch (err) {
      if (err.response) {
        console.log('Error status:', err.response.status);
        console.log('Error data:', JSON.stringify(err.response.data));
        attempts.push({ model, status: err.response.status, data: err.response.data });
      } else {
        console.log('Network/Error:', err.message);
        attempts.push({ model, status: null, data: err.message });
      }
    }
  }

  console.log('\n=== Consolidated Attempts ===');
  console.log(JSON.stringify(attempts, null, 2));
}

runTest().catch(e => console.error(e));
