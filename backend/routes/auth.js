const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User, Member, getNextId } = require('../db/models');
const { PasswordResetToken, CommunicationLog } = require('../db/communicationModels');
const { sendPasswordReset } = require('../utils/memberMailer');
const { JWT_SECRET, authenticate, requireAdmin } = require('../middleware/auth');

function publicUser(user, displayName) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || null,
    role: user.role,
    member_id: user.member_id ?? null,
    name: displayName,
  };
}

function portalUrl(req) {
  return process.env.PORTAL_URL || process.env.WEB_ORIGIN || `${req.protocol}://${req.get('host')}`;
}

router.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const credential = (email || username || '').trim().toLowerCase();

    if (!credential || !password) {
      return res.status(400).json({ error: 'Email or username and password are required' });
    }

    const isEmail = credential.includes('@');
    const user = await User.findOne(
      isEmail
        ? { $or: [{ email: credential }, { username: credential }] }
        : { username: credential },
    ).lean();

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    let displayName = user.name || 'Admin';
    if (user.member_id != null) {
      const member = await Member.findOne({ id: user.member_id }).lean();
      if (member) displayName = member.name;
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, member_id: user.member_id, name: displayName },
      JWT_SECRET,
      { expiresIn: '7d' },
    );

    res.json({ token, user: publicUser(user, displayName) });
  } catch (err) {
    console.error('[auth] login error:', err);
    res.status(500).json({ error: err.message || 'Login failed. Please try again.' });
  }
});

router.post('/signup', async (req, res) => {
  try {
    const { email_or_phone, username, password } = req.body;
    const identifier = (email_or_phone || '').trim().toLowerCase();
    const uname = (username || '').trim().toLowerCase();

    if (!identifier || !uname || !password) {
      return res.status(400).json({ error: 'email_or_phone, username, and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const GENERIC_ERROR = "We couldn't verify those details against an available member account. Contact the club administrator if you need help.";
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const identifierRe = new RegExp(`^${escaped}$`, 'i');

    const member = await Member.findOne({
      $or: [{ email: identifierRe }, { phone: identifierRe }],
      status: 'active',
    }).lean();

    if (!member) return res.status(400).json({ error: GENERIC_ERROR });

    const existingUser = await User.findOne({ member_id: member.id }).lean();
    if (existingUser) return res.status(400).json({ error: GENERIC_ERROR });

    const existingUsername = await User.findOne({ username: uname }).lean();
    if (existingUsername) return res.status(400).json({ error: 'That username is taken. Please choose another.' });

    const newUser = await User.create({
      id: await getNextId('user_id'),
      member_id: member.id,
      username: uname,
      email: member.email ? member.email.trim().toLowerCase() : null,
      password_hash: bcrypt.hashSync(password, 10),
      role: 'member',
      name: member.name,
    });

    const token = jwt.sign(
      { id: newUser.id, username: newUser.username, role: newUser.role, member_id: newUser.member_id, name: member.name },
      JWT_SECRET,
      { expiresIn: '7d' },
    );

    res.status(201).json({ token, user: publicUser(newUser, member.name) });
  } catch (err) {
    console.error('[auth] signup error:', err);
    res.status(500).json({ error: err.message || 'Signup failed. Please try again.' });
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json(req.user);
});

router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const user = await User.findOne({ id: req.user.id }).lean();
    if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    await User.updateOne({ id: req.user.id }, { $set: { password_hash: bcrypt.hashSync(new_password, 10) } });
    res.json({ success: true });
  } catch (err) {
    console.error('[auth] change-password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Generic response prevents account enumeration. If a matching account with an
// email exists, a single-use reset link is generated and emailed.
router.post('/forgot-password', async (req, res) => {
  const generic = { message: 'If an account matches that email, a password reset link will be sent.' };
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.json(generic);

    let user = await User.findOne({ email }).lean();
    let member = null;

    if (!user) {
      member = await Member.findOne({ email }).lean();
      if (member) user = await User.findOne({ member_id: member.id }).lean();
    } else if (user.member_id != null) {
      member = await Member.findOne({ id: user.member_id }).lean();
    }

    const recipientEmail = user?.email || member?.email;
    if (!user || !recipientEmail) return res.json(generic);

    await PasswordResetToken.deleteMany({ user_id: user.id, used_at: null });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await PasswordResetToken.create({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 45 * 60 * 1000),
    });

    const resetUrl = `${portalUrl(req).replace(/\/$/, '')}/?reset=${encodeURIComponent(rawToken)}`;
    try {
      const info = await sendPasswordReset({ email: recipientEmail }, { resetUrl });
      await CommunicationLog.create({
        member_id: user.member_id ?? null,
        recipient_email: recipientEmail,
        type: 'password_reset',
        period_key: `reset:${user.id}`,
        subject: 'Reset your Checkpoint password',
        status: info.mocked ? 'mocked' : 'sent',
        provider_message_id: info.messageId || null,
        sent_at: new Date(),
        created_by: 'self-service',
      });
    } catch (mailError) {
      console.error('[auth] reset email failed:', mailError.message);
      await CommunicationLog.create({
        member_id: user.member_id ?? null,
        recipient_email: recipientEmail,
        type: 'password_reset',
        period_key: `reset:${user.id}`,
        subject: 'Reset your Checkpoint password',
        status: 'failed',
        failure_reason: mailError.message,
        created_by: 'self-service',
      });
    }

    return res.json(generic);
  } catch (err) {
    console.error('[auth] forgot-password error:', err);
    return res.json(generic);
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const token = String(req.body.token || '');
    const newPassword = String(req.body.new_password || '');
    if (!token || newPassword.length < 8) {
      return res.status(400).json({ error: 'A valid reset link and password of at least 8 characters are required' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const reset = await PasswordResetToken.findOne({
      token_hash: tokenHash,
      used_at: null,
      expires_at: { $gt: new Date() },
    });
    if (!reset) return res.status(400).json({ error: 'This reset link is invalid or has expired' });

    const result = await User.updateOne({ id: reset.user_id }, { $set: { password_hash: bcrypt.hashSync(newPassword, 10) } });
    if (result.matchedCount === 0) return res.status(400).json({ error: 'This reset link is invalid or has expired' });

    reset.used_at = new Date();
    await reset.save();
    await PasswordResetToken.deleteMany({ user_id: reset.user_id, used_at: null });

    res.json({ success: true, message: 'Password updated. You can now sign in.' });
  } catch (err) {
    console.error('[auth] reset-password error:', err);
    res.status(500).json({ error: 'Unable to reset password. Please request a new link.' });
  }
});

router.post('/set-email', authenticate, requireAdmin, async (req, res) => {
  try {
    const { user_id, email } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    const targetId = user_id || req.user.id;
    const normalized = email.trim().toLowerCase();
    const result = await User.updateOne({ id: targetId }, { $set: { email: normalized } });
    if (result.matchedCount === 0) return res.status(404).json({ error: 'User not found' });

    const user = await User.findOne({ id: targetId }).lean();
    if (user?.member_id != null) await Member.updateOne({ id: user.member_id }, { $set: { email: normalized } });

    res.json({ success: true, updated: result.modifiedCount });
  } catch (err) {
    console.error('[auth] set-email error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
