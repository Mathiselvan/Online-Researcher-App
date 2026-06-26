const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { handleGenerateRequest } = require('./lib/gemini-proxy');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Serve style.css explicitly
app.get('/style.css', (req, res) => {
  res.setHeader('Content-Type', 'text/css');
  res.sendFile(path.join(__dirname, 'style.css'));
});

// Serve script.js explicitly
app.get('/script.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'script.js'));
});

// Serve index.html explicitly
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY || process.env.GENERATIVE_API_KEY;

if (!API_KEY) {
  console.warn('Warning: GEMINI_API_KEY not set. The proxy will return errors until you set it.');
}

app.get('/api/health', (req, res) => {
  return res.status(200).json({
    status: 'ok',
    service: 'researcher-app',
    hasApiKey: Boolean(API_KEY),
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.post('/api/generate', async (req, res) => {
  try {
    const { model, prompt } = req.body || {};
    if (!model || !prompt) {
      return res.status(400).json({
        error: { message: 'Request must include "model" and "prompt" in JSON body.' }
      });
    }
    const result = await handleGenerateRequest(model, prompt);
    return res.status(result.status).json(result.data);
  } catch (err) {
    console.error('POST /api/generate error:', err);
    return res.status(500).json({
      error: { message: 'Internal server error while processing the request.' }
    });
  }
});

// Catch-all API routes to prevent HTML 404 responses
app.all('/api/*', (req, res) => {
  return res.status(404).json({
    error: { message: `API endpoint ${req.method} ${req.url} not found.` }
  });
});

// Catch-all general routes for HTML static files
app.all('*', (req, res) => {
  return res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Express error:', err);
  if (res.headersSent) return next(err);
  
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({
      error: { message: 'Internal server error.' }
    });
  }
  return res.status(500).sendFile(path.join(__dirname, 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Proxy server listening on port ${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Set PORT to another value in .env.`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
