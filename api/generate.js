const { handleGenerateRequest, parseRequestBody } = require('../lib/gemini-proxy');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed, use POST.' } });
  }

  try {
    const parsed = parseRequestBody(req);
    if (parsed.error) {
      return res.status(parsed.error.status).json(parsed.error.data);
    }

    const { model, prompt } = parsed.payload;
    if (!model || !prompt) {
      return res.status(400).json({
        error: { message: 'Request must include "model" and "prompt" in JSON body.' }
      });
    }

    const result = await handleGenerateRequest(model, prompt);
    return res.status(result.status).json(result.data);
  } catch (err) {
    console.error('Vercel /api/generate error:', err);
    return res.status(500).json({
      error: { message: 'Internal server error while processing the request.' }
    });
  }
};
