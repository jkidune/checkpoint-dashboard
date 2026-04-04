const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Member } = require('../db/models');
const { JWT_SECRET, authenticate, requireAdmin } = require('../middleware/auth');

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
// Accepts email or username + password.
router.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const credential = (email || username || '').trim().toLowerCase();

    if (!credential || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const isEmail = credential.includes('@');

    // Single query — check email field OR username field on the User document
    const user = await User.findOne(
      isEmail
        ? { $or: [{ email: credential }, { username: credential }] }
        : { username: credential }
    ).lean();

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Resolve display name from linked member record
    let displayName = 'Admin';
    if (user.member_id) {
      const member = await Member.findOne({ id: user.member_id }).lean();
      if (member) displayName = member.name;
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, member_id: user.member_id, name: displayName },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role, name: displayName },
    });
  } catch (err) {
    console.error('[auth] login error:', err);
    res.status(500).json({ error: err.message || 'Login failed. Please try again.' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  res.json(req.user);
});

// ─── POST /api/auth/change-password ──────────────────────────────────────────
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const user = await User.findOne({ id: req.user.id }).lean();
    if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    await User.updateOne(
      { id: req.user.id },
      { $set: { password_hash: bcrypt.hashSync(new_password, 10) } }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[auth] change-password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ─── POST /api/auth/set-email ─────────────────────────────────────────────────
// Admin-only: set the email on a user account (used for initial setup).
// Body: { user_id?, email }  — omit user_id to update the calling admin's own account.
router.post('/set-email', authenticate, requireAdmin, async (req, res) => {
  try {
    const { user_id, email } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    const targetId = user_id || req.user.id;
    // Use updateOne to bypass mongoose-sequence pre-save hooks
    const result = await User.updateOne(
      { id: targetId },
      { $set: { email: email.trim().toLowerCase() } }
    );

    if (result.matchedCount === 0) return res.status(404).json({ error: 'User not found' });

    res.json({ success: true, updated: result.modifiedCount });
  } catch (err) {
    console.error('[auth] set-email error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
