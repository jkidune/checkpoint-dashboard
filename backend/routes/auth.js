const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Member } = require('../db/models');
const { JWT_SECRET, authenticate } = require('../middleware/auth');

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
// Accepts email (for members) or username (admin fallback).
router.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const credential = (email || username || '').trim();

    if (!credential || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    let user = null;
    let member = null;

    const isEmail = credential.includes('@');

    if (isEmail) {
      // Use .lean() so we get a plain JS object — avoids Mongoose virtual 'id' conflict
      // and guarantees member.id is the real auto-increment integer.
      const memberDoc = await Member.findOne({ email: credential.toLowerCase() }).lean();
      if (memberDoc) {
        user = await User.findOne({ member_id: memberDoc.id }).lean();
        if (user) member = memberDoc;
      }
    }

    // Fallback: try username directly (handles admin + legacy accounts)
    if (!user) {
      user = await User.findOne({ username: credential }).lean();
      if (user && user.member_id) {
        member = await Member.findOne({ id: user.member_id }).lean();
      }
    }

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const displayName = member ? member.name : 'Admin';

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

    const user = await User.findOne({ id: req.user.id });
    if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    user.password_hash = bcrypt.hashSync(new_password, 10);
    await user.save();

    res.json({ success: true });
  } catch (err) {
    console.error('[auth] change-password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
