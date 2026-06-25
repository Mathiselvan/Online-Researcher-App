const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Serve static files
app.use(express.static(path.join(__dirname)));

// Explicit routes for CSS and JS
app.get('/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'style.css'));
});

app.get('/script.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'script.js'));
});

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY || process.env.GENERATIVE_API_KEY;

if (!API_KEY) {
console.warn('Warning: GEMINI_API_KEY not set. The proxy will return auth errors until you set it.');
}

// Health Check
app.get('/api/health', (req, res) => {
return res.status(200).json({
status: 'ok',
uptime: process.uptime(),
timestamp: new Date().toISOString()
});
});

// Gemini Generate Endpoint
app.post('/api/generate', async (req, res) => {
const { model, prompt } = req.body || {};

if (!model || !prompt) {
return res.status(400).json({
error: {
message: 'Request must include "model" and "prompt" in JSON body.'
}
});
}

if (process.env.MOCK_MODE === 'true') {
console.log('MOCK_MODE: incoming request', { model, prompt });

```
if (model.includes('2.5-flash') && !model.includes('exp')) {
  return res.status(503).json({
    error: {
      message: 'Service Unavailable (mock)',
      code: 503
    }
  });
}

if (model.includes('exp') || model.includes('2.0')) {
  return res.status(200).json({
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                keyPoints: [
                  'Key insight 1',
                  'Key insight 2',
                  'Key insight 3',
                  'Key insight 4',
                  'Key insight 5'
                ],
                analysis: {
                  type: 'Pros/Cons',
                  positive: ['Advantage 1', 'Advantage 2'],
                  negative: ['Limitation 1']
                },
                recommendation: 'Recommended action based on analysis.'
              })
            }
          ]
        }
      }
    ]
  });
}

return res.status(404).json({
  error: {
    message: 'Model not recognized in mock mode',
    code: 404
  }
});
```

}

const url =
`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

const body = {
contents: [
{
parts: [
{
text: prompt
}
]
}
],
generationConfig: {
temperature: 0.7,
responseMimeType: 'application/json'
}
};

try {
const resp = await axios.post(url, body, {
headers: {
'Content-Type': 'application/json'
},
timeout: 20000
});

```
return res.status(resp.status).json(resp.data);
```

} catch (err) {
if (err.response) {
return res.status(err.response.status).json(err.response.data);
}

```
return res.status(500).json({
  error: {
    message: err.message
  }
});
```

}
});

// Homepage Route Fix
app.get('/', (req, res) => {
res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
console.log(`Proxy server listening on port ${PORT}`);
});
