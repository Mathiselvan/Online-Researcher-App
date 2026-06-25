const axios = require('axios');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed. Use POST.' } });
  }

  let payload = req.body;
  if (!payload && req.rawBody) {
    try {
      payload = JSON.parse(req.rawBody);
    } catch (parseErr) {
      return res.status(400).json({ error: { message: 'Invalid JSON body.' } });
    }
  }

  const { model, prompt } = payload || {};
  if (!model || !prompt) {
    return res.status(400).json({ error: { message: 'Request must include "model" and "prompt" in JSON body.' } });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'Missing environment variable GEMINI_API_KEY.' } });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: 'application/json'
    }
  };

  try {
    const response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }
    return res.status(500).json({ error: { message: error.message || 'Unknown error while contacting Gemini API.' } });
  }
};
