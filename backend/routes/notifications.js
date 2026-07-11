const express = require('express');
const router = express.Router();
const { Member, Notification, getNextId } = require('../db/models');
const { authenticate, requireAdmin, requireSelfOrAdmin } = require('../middleware/auth');
const { notifyByEmail } = require('../utils/notifyByEmail');
const { runDeadlineScan } = require('../jobs/deadlineScan');

// ─── GET / ────────────────────────────────────────────────────────────────────
// Members always get only their own notifications. Admins can pass ?member_id=
// to filter to one member, or omit it to get every notification.
router.get('/', authenticate, async (req, res) => {
  const query = {};
  if (req.user.role !== 'admin') {
    query.member_id = req.user.member_id;
  } else if (req.query.member_id) {
    query.member_id = parseInt(req.query.member_id);
  }

  const list = await Notification.find(query).lean();
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(list);
});

// ─── GET /attention ───────────────────────────────────────────────────────────
// Admin-only. Groups unread notifications by member — never exposed to member
// tokens (mounted before the /:id routes below so it can't be shadowed).
router.get('/attention', authenticate, requireAdmin, async (req, res) => {
  const unread  = await Notification.find({ read: false }).lean();
  const members = await Member.find().lean();
  const memberMap = new Map(members.map(m => [m.id, m.name]));

  const byMember = new Map();
  for (const n of unread) {
    if (!byMember.has(n.member_id)) byMember.set(n.member_id, []);
    byMember.get(n.member_id).push({ type: n.type, message: n.message, due_date: n.due_date });
  }

  const result = [...byMember.entries()].map(([member_id, issues]) => ({
    member_id,
    name: memberMap.get(member_id) || '?',
    issues,
  }));

  res.json(result);
});

// ─── POST /scan ───────────────────────────────────────────────────────────────
// Admin-triggered on-demand run of the same scan the daily cron performs.
// On Vercel there's no in-process timer (see backend/jobs/deadlineScan.js), so
// this is the endpoint a Vercel Cron trigger (or an admin) hits instead.
router.post('/scan', authenticate, requireAdmin, async (req, res) => {
  const result = await runDeadlineScan();
  res.json(result);
});

// ─── POST / ───────────────────────────────────────────────────────────────────
// Admin creates a targeted alert for one member.
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { member_id, type, message, due_date } = req.body;
  if (!member_id || !type || !message) {
    return res.status(400).json({ error: 'member_id, type, message required' });
  }

  const notification = await Notification.create({
    id:         await getNextId('notification_id'),
    member_id:  parseInt(member_id),
    type,
    message,
    due_date:   due_date || null,
    created_by: req.user.name || req.user.username,
  });

  await notifyByEmail(notification);

  res.status(201).json(notification);
});

// ─── PATCH /:id/read ──────────────────────────────────────────────────────────
router.patch('/:id/read', authenticate, async (req, res, next) => {
  const notification = await Notification.findOne({ id: parseInt(req.params.id) }).lean();
  if (!notification) return res.status(404).json({ error: 'Notification not found' });
  req._notification = notification;
  next();
}, requireSelfOrAdmin(req => req._notification.member_id), async (req, res) => {
  const updated = await Notification.findOneAndUpdate(
    { id: req._notification.id },
    { $set: { read: true } },
    { new: true }
  ).lean();
  res.json(updated);
});

module.exports = router;
