const jwt = require('jsonwebtoken');
const { User } = require('../db/models');
const JWT_SECRET = process.env.JWT_SECRET || 'checkpoint_secret_2026';

async function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const claims = jwt.verify(token, JWT_SECRET);
    const user = await User.findOne({ id: claims.id }).lean();
    if (!user || user.status === 'disabled') {
      return res.status(401).json({ error: 'Account disabled or unavailable' });
    }
    req.user = {
      ...claims,
      username: user.username,
      role: user.role,
      member_id: user.member_id,
    };
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
