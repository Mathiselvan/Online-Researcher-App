const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY || process.env.GENERATIVE_API_KEY;

if (!API_KEY) {
  console.warn('Warning: GEMINI_API_KEY not set. The proxy will return auth errors until you set it.');
}

app.get('/api/health', (req, res) => {
  return res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.post('/api/generate', async (req, res) => {
  const { model, prompt } = req.body || {};
  if (!model || !prompt) return res.status(400).json({ error: { message: 'Request must include "model" and "prompt" in JSON body.' } });
  // If MOCK_MODE=true, return simulated responses for testing
  if (process.env.MOCK_MODE === 'true') {
    console.log('MOCK_MODE: incoming request', { model, prompt });
    // Simulate failures for first model and success for second
    if (model.includes('2.5-flash') && !model.includes('exp')) {
      const status = 503;
      const body = { error: { message: 'Service Unavailable (mock)', code: status } };
      console.log('MOCK response', status, body);
      return res.status(status).json(body);
    }
    // Simulate success for supported models
    if (model.includes('exp') || model.includes('2.0')) {
      const structured = {
        keyPoints: ['Key insight 1', 'Key insight 2', 'Key insight 3', 'Key insight 4', 'Key insight 5'],
        analysis: { type: 'Pros/Cons', positive: ['Advantage 1', 'Advantage 2'], negative: ['Limitation 1'] },
        recommendation: 'Recommended action based on analysis.'
      };
      const modelResp = {
        candidates: [
          { content: { parts: [{ text: JSON.stringify(structured) }] } }
        ]
      };
      console.log('MOCK response 200 - success with supported model');
      return res.status(200).json(modelResp);
    }
    // default mock - model not recognized
    return res.status(404).json({ error: { message: 'Model not recognized in mock mode', code: 404 } });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, responseMimeType: 'application/json' }
  };

  // Log the outbound request
  console.log('--- Forwarding request to Gemini ---');
  console.log('Model:', model);
  console.log('URL:', url);
  console.log('Payload:', JSON.stringify(body));

  try {
    const resp = await axios.post(url, body, { headers: { 'Content-Type': 'application/json' }, timeout: 20000 });

    // Log the full response
    console.log('--- Gemini response ---');
    console.log('Status:', resp.status);
    console.log('Data:', JSON.stringify(resp.data));

    // Forward the exact response back to the client
    return res.status(resp.status).json(resp.data);
  } catch (err) {
    if (err.response) {
      console.error('--- Gemini error response ---');
      console.error('Status:', err.response.status);
      console.error('Data:', JSON.stringify(err.response.data));
      return res.status(err.response.status).json(err.response.data);
    }
    console.error('--- Gemini proxy error ---');
    console.error(err.message);
    return res.status(500).json({ error: { message: err.message } });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server listening on port ${PORT}`);
});
