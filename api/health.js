module.exports = (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: { message: 'Method not allowed, use GET.' } });
  }

  return res.status(200).json({
    status: 'ok',
    service: 'researcher-app',
    uptime: process.uptime ? process.uptime() : null,
    timestamp: new Date().toISOString()
  });
};
