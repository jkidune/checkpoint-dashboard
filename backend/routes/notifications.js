const express = require('express');
const router = express.Router();
const { Member, Notification, getNextId } = require('../db/models');
const { authenticate, requireAdmin, requireSelfOrAdmin } = require('../middleware/auth');
const { notifyByEmail } = require('../utils/notifyByEmail');
const { runDeadlineScan } = require('../jobs/deadlineScan');

router.get('/', authenticate, async (req, res) => {
  const query = {};
  if (req.user.role !== 'admin') query.member_id = req.user.member_id;
  else if (req.query.member_id) query.member_id = parseInt(req.query.member_id, 10);

  const list = await Notification.find(query).lean();
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(list);
});

router.get('/attention', authenticate, requireAdmin, async (req, res) => {
  const unread = await Notification.find({ read: false }).lean();
  const members = await Member.find().lean();
  const memberMap = new Map(members.map((m) => [m.id, m.name]));
  const byMember = new Map();
  for (const n of unread) {
    if (!byMember.has(n.member_id)) byMember.set(n.member_id, []);
    byMember.get(n.member_id).push({ type: n.type, message: n.message, due_date: n.due_date });
  }
  res.json([...byMember.entries()].map(([member_id, issues]) => ({ member_id, name: memberMap.get(member_id) || '?', issues })));
});

router.post('/scan', authenticate, requireAdmin, async (req, res) => {
  const result = await runDeadlineScan();
  res.json(result);
});

router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { member_id, type, message, due_date } = req.body;
  if (!member_id || !type || !message) return res.status(400).json({ error: 'member_id, type, message required' });

  const notification = await Notification.create({
    id: await getNextId('notification_id'),
    member_id: parseInt(member_id, 10),
    type,
    message,
    due_date: due_date || null,
    created_by: req.user.name || req.user.username,
  });

  await notifyByEmail(notification);
  res.status(201).json(notification);
});

router.patch('/read-all', authenticate, async (req, res) => {
  const query = req.user.role === 'admin' && req.body.member_id
    ? { member_id: parseInt(req.body.member_id, 10), read: false }
    : { member_id: req.user.member_id, read: false };

  if (req.user.role !== 'admin' && req.user.member_id == null) {
    return res.status(400).json({ error: 'This account has no linked member record' });
  }

  const result = await Notification.updateMany(query, { $set: { read: true } });
  res.json({ success: true, updated: result.modifiedCount || 0 });
});

router.patch('/:id/read', authenticate, async (req, res, next) => {
  const notification = await Notification.findOne({ id: parseInt(req.params.id, 10) }).lean();
  if (!notification) return res.status(404).json({ error: 'Notification not found' });
  req._notification = notification;
  next();
}, requireSelfOrAdmin((req) => req._notification.member_id), async (req, res) => {
  const updated = await Notification.findOneAndUpdate(
    { id: req._notification.id },
    { $set: { read: true } },
    { new: true }
  ).lean();
  res.json(updated);
});

module.exports = router;
