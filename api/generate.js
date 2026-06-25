const axios = require('axios');
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY || process.env.GENERATIVE_API_KEY;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed, use POST.' } });
  }

  const { model, prompt } = req.body || {};
  if (!model || !prompt) {
    return res.status(400).json({ error: { message: 'Request must include "model" and "prompt" in JSON body.' } });
  }

  if (!API_KEY) {
    console.warn('Warning: GEMINI_API_KEY not set. The proxy will return auth errors until you set it.');
  }

  if (process.env.MOCK_MODE === 'true') {
    console.log('MOCK_MODE: incoming request', { model, prompt });
    if (model.includes('2.5-flash') && !model.includes('exp')) {
      const status = 503;
      const body = { error: { message: 'Service Unavailable (mock)', code: status } };
      return res.status(status).json(body);
    }
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
      return res.status(200).json(modelResp);
    }
    return res.status(404).json({ error: { message: 'Model not recognized in mock mode', code: 404 } });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, responseMimeType: 'application/json' }
  };

  try {
    const resp = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000
    });
    return res.status(resp.status).json(resp.data);
  } catch (err) {
    if (err.response) {
      return res.status(err.response.status).json(err.response.data);
    }
    return res.status(500).json({ error: { message: err.message } });
  }
};
