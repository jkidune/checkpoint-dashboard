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

// Lets the request through if the caller is an admin, or if the resource's
// member_id (resolved per-route via getMemberId) matches the caller's own.
function requireSelfOrAdmin(getMemberId) {
  return (req, res, next) => {
    if (req.user?.role === 'admin') return next();
    if (req.user?.member_id != null && req.user.member_id === getMemberId(req)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  };
}

module.exports = { authenticate, requireAdmin, requireSelfOrAdmin, JWT_SECRET };
