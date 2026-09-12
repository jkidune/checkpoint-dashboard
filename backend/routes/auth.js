const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendPasswordReset } = require('../utils/memberMailer');
const { JWT_SECRET, authenticate, requireAdmin } = require('../middleware/auth');
const { resolveApprovedRuntimeTenant, TenantResolutionError } = require('../tenancy/resolveRuntimeTenant');

// Phase 3: authentication is now tenant-model aware. Every route below
// resolves its tenant's models rather than importing the default/legacy
// User/Member/etc. directly:
//   - Unauthenticated flows (login, signup, forgot-password,
//     reset-password) have no JWT yet to read an organization_id from, so
//     they explicitly resolve the sole Phase 3 runtime organization
//     server-side via resolveApprovedRuntimeTenant(). Nothing in req.body,
//     req.query, or req.headers is ever consulted for tenant selection —
//     a request body containing organization_id: "org_beta" has no effect
//     here, because this code never reads that field.
//   - Authenticated flows (change-password, set-email, me) use
//     req.tenantModels, already resolved by the authenticate middleware
//     from the verified JWT's organization_id.
// This is safe today because Phase 3 permits exactly one runtime
// organization (org_checkpoint_investors — see
// ../tenancy/runtimeOrganization.js), whose tenant connection resolves to
// the exact same physical database the pre-Phase-3 default/legacy models
// already used.

function publicUser(user, displayName, tenant) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || null,
    role: user.role,
    member_id: user.member_id ?? null,
    name: displayName,
    organization_id: tenant.organization_id,
    organization_name: tenant.name,
    organization_slug: tenant.slug,
  };
}

function signToken(user, displayName, organizationId) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      member_id: user.member_id,
      name: displayName,
      organization_id: organizationId,
    },
    JWT_SECRET,
    { expiresIn: '7d' },
  );
}

function portalUrl(req) {
  return process.env.PORTAL_URL || process.env.WEB_ORIGIN || `${req.protocol}://${req.get('host')}`;
}

function handleTenantResolutionError(res, err, fallbackMessage) {
  if (err instanceof TenantResolutionError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  console.error('[auth] tenant resolution error:', err);
  return res.status(503).json({ error: fallbackMessage });
}

router.post('/login', async (req, res) => {
  let tenant;
  let tenantModels;
  try {
    ({ tenant, tenantModels } = await resolveApprovedRuntimeTenant());
  } catch (err) {
    return handleTenantResolutionError(res, err, 'Unable to sign in right now. Please try again shortly.');
  }

  try {
    const { email, username, password } = req.body;
    const credential = (email || username || '').trim().toLowerCase();

    if (!credential || !password) {
      return res.status(400).json({ error: 'Email or username and password are required' });
    }

    const isEmail = credential.includes('@');
    const user = await tenantModels.User.findOne(
      isEmail
        ? { $or: [{ email: credential }, { username: credential }] }
        : { username: credential },
    ).lean();

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    let displayName = user.name || 'Admin';
    if (user.member_id != null) {
      const member = await tenantModels.Member.findOne({ id: user.member_id }).lean();
      if (member) displayName = member.name;
    }

    const token = signToken(user, displayName, tenant.organization_id);

    res.json({ token, user: publicUser(user, displayName, tenant) });
  } catch (err) {
    console.error('[auth] login error:', err);
    res.status(500).json({ error: err.message || 'Login failed. Please try again.' });
  }
});

router.post('/signup', async (req, res) => {
  let tenant;
  let tenantModels;
  try {
    ({ tenant, tenantModels } = await resolveApprovedRuntimeTenant());
  } catch (err) {
    return handleTenantResolutionError(res, err, 'Unable to activate your account right now. Please try again shortly.');
  }

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

    const member = await tenantModels.Member.findOne({
      $or: [{ email: identifierRe }, { phone: identifierRe }],
      status: 'active',
    }).lean();

    if (!member) return res.status(400).json({ error: GENERIC_ERROR });

    const existingUser = await tenantModels.User.findOne({ member_id: member.id }).lean();
    if (existingUser) return res.status(400).json({ error: GENERIC_ERROR });

    const existingUsername = await tenantModels.User.findOne({ username: uname }).lean();
    if (existingUsername) return res.status(400).json({ error: 'That username is taken. Please choose another.' });

    const newUser = await tenantModels.User.create({
      id: await tenantModels.getNextId('user_id'),
      member_id: member.id,
      username: uname,
      email: member.email ? member.email.trim().toLowerCase() : null,
      password_hash: bcrypt.hashSync(password, 10),
      role: 'member',
      name: member.name,
    });

    const token = signToken(newUser, member.name, tenant.organization_id);

    res.status(201).json({ token, user: publicUser(newUser, member.name, tenant) });
  } catch (err) {
    console.error('[auth] signup error:', err);
    res.status(500).json({ error: err.message || 'Signup failed. Please try again.' });
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ ...req.user, tenant: req.tenant });
});

router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const user = await req.tenantModels.User.findOne({ id: req.user.id }).lean();
    if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    await req.tenantModels.User.updateOne({ id: req.user.id }, { $set: { password_hash: bcrypt.hashSync(new_password, 10) } });
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

  let tenantModels;
  try {
    ({ tenantModels } = await resolveApprovedRuntimeTenant());
  } catch (err) {
    // Fail-closed on tenant resolution, but still return the same generic
    // response — this endpoint must not reveal anything about system
    // state (including "tenant resolution is broken") to an unauthenticated
    // caller.
    console.error('[auth] forgot-password tenant resolution error:', err);
    return res.json(generic);
  }

  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.json(generic);

    let user = await tenantModels.User.findOne({ email }).lean();
    let member = null;

    if (!user) {
      member = await tenantModels.Member.findOne({ email }).lean();
      if (member) user = await tenantModels.User.findOne({ member_id: member.id }).lean();
    } else if (user.member_id != null) {
      member = await tenantModels.Member.findOne({ id: user.member_id }).lean();
    }

    const recipientEmail = user?.email || member?.email;
    if (!user || !recipientEmail) return res.json(generic);

    await tenantModels.PasswordResetToken.deleteMany({ user_id: user.id, used_at: null });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await tenantModels.PasswordResetToken.create({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 45 * 60 * 1000),
    });

    const resetUrl = `${portalUrl(req).replace(/\/$/, '')}/?reset=${encodeURIComponent(rawToken)}`;
    try {
      const info = await sendPasswordReset({ email: recipientEmail }, { resetUrl });
      await tenantModels.CommunicationLog.create({
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
      await tenantModels.CommunicationLog.create({
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
  let tenantModels;
  try {
    ({ tenantModels } = await resolveApprovedRuntimeTenant());
  } catch (err) {
    return handleTenantResolutionError(res, err, 'Unable to reset password right now. Please try again shortly.');
  }

  try {
    const token = String(req.body.token || '');
    const newPassword = String(req.body.new_password || '');
    if (!token || newPassword.length < 8) {
      return res.status(400).json({ error: 'A valid reset link and password of at least 8 characters are required' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const reset = await tenantModels.PasswordResetToken.findOne({
      token_hash: tokenHash,
      used_at: null,
      expires_at: { $gt: new Date() },
    });
    if (!reset) return res.status(400).json({ error: 'This reset link is invalid or has expired' });

    const result = await tenantModels.User.updateOne({ id: reset.user_id }, { $set: { password_hash: bcrypt.hashSync(newPassword, 10) } });
    if (result.matchedCount === 0) return res.status(400).json({ error: 'This reset link is invalid or has expired' });

    reset.used_at = new Date();
    await reset.save();
    await tenantModels.PasswordResetToken.deleteMany({ user_id: reset.user_id, used_at: null });

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
    const result = await req.tenantModels.User.updateOne({ id: targetId }, { $set: { email: normalized } });
    if (result.matchedCount === 0) return res.status(404).json({ error: 'User not found' });

    const user = await req.tenantModels.User.findOne({ id: targetId }).lean();
    if (user?.member_id != null) await req.tenantModels.Member.updateOne({ id: user.member_id }, { $set: { email: normalized } });

    res.json({ success: true, updated: result.modifiedCount });
  } catch (err) {
    console.error('[auth] set-email error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
