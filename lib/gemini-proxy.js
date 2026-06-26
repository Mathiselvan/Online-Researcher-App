const axios = require('axios');

const GEMINI_TIMEOUT_MS = 55000;

const ANALYSIS_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    keyPoints: {
      type: 'array',
      items: { type: 'string' }
    },
    analysis: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        positive: {
          type: 'array',
          items: { type: 'string' }
        },
        negative: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      required: ['type', 'positive', 'negative']
    },
    recommendation: { type: 'string' }
  },
  required: ['keyPoints', 'analysis', 'recommendation']
};

function getApiKey() {
  return process.env.GEMINI_API_KEY || process.env.GENERATIVE_API_KEY;
}

function normalizeGeminiError(err) {
  const status = err.response?.status || 500;

  if (err.response?.data?.error) {
    const googleError = err.response.data.error;
    return {
      status,
      data: {
        error: {
          message: googleError.message || 'Gemini API error',
          code: googleError.code || googleError.status || status
        }
      }
    };
  }

  if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '')) {
    return {
      status: 503,
      data: {
        error: {
          message: 'Request to Gemini API timed out. Please try again.',
          code: 503
        }
      }
    };
  }

  if (err.response) {
    return {
      status,
      data: {
        error: {
          message: `Gemini API returned status ${status}.`,
          code: status
        }
      }
    };
  }

  return {
    status: 500,
    data: {
      error: {
        message: err.message || 'Unknown error while contacting Gemini API.',
        code: 500
      }
    }
  };
}

async function generateWithGemini(model, prompt) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      status: 500,
      data: {
        error: {
          message: 'Missing environment variable GEMINI_API_KEY. Set it in .env locally or in Vercel project settings.'
        }
      }
    };
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.75,
      topP: 0.95,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: ANALYSIS_RESPONSE_SCHEMA
    }
  };

  try {
    const resp = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: GEMINI_TIMEOUT_MS
    });
    return { status: resp.status, data: resp.data };
  } catch (err) {
    const normalized = normalizeGeminiError(err);
    return { status: normalized.status, data: normalized.data };
  }
}

async function handleGenerateRequest(model, prompt) {
  if (!model || !prompt) {
    return {
      status: 400,
      data: {
        error: {
          message: 'Request must include "model" and "prompt" in JSON body.'
        }
      }
    };
  }

  const ALLOWED_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro'];
  if (!ALLOWED_MODELS.includes(model)) {
    return {
      status: 400,
      data: {
        error: {
          message: `Unsupported or deprecated model: "${model}". Only gemini-2.5-flash and gemini-2.5-pro are supported.`
        }
      }
    };
  }

  return generateWithGemini(model, prompt);
}

function parseRequestBody(req) {
  let payload = req.body;
  if (!payload && req.rawBody) {
    try {
      payload = JSON.parse(req.rawBody);
    } catch (parseErr) {
      return { error: { status: 400, data: { error: { message: 'Invalid JSON body.' } } } };
    }
  }
  if (!payload || typeof payload !== 'object') {
    return { error: { status: 400, data: { error: { message: 'Invalid JSON body.' } } } };
  }
  return { payload };
}

module.exports = {
  GEMINI_TIMEOUT_MS,
  handleGenerateRequest,
  parseRequestBody
};
