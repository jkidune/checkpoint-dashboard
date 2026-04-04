const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'checkpoint_secret_2026';

function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

module.exports = { authenticate, requireAdmin, JWT_SECRET };
