const express = require('express');
const router = express.Router();
const { Member, Notification, getNextId } = require('../db/models');
const { FormIntakeSubmission } = require('../db/formIntakeModels');
const { AdminNotificationState } = require('../db/adminNotificationModels');
const { authenticate, requireAdmin, requireSelfOrAdmin } = require('../middleware/auth');
const { notifyByEmail } = require('../utils/notifyByEmail');
const { runDeadlineScan } = require('../jobs/deadlineScan');

function adminKey(req) {
  return String(req.user.id || req.user.email || req.user.username || req.user.name || 'admin');
}

function formatType(type) {
  return String(type || '').replace(/_/g, ' ');
}

function intakeTypeLabel(type) {
  return ({
    monthly: 'Monthly contribution',
    loan_repayment: 'Loan repayment',
    fine: 'Fine payment',
  }[type] || formatType(type) || 'Payment');
}

function stateKey(admin, source, sourceId) {
  return `${admin}:${source}:${sourceId}`;
}

async function buildAdminFeed(req) {
  const admin = adminKey(req);
  const [notifications, intakeRows, members] = await Promise.all([
    Notification.find().sort({ created_at: -1 }).limit(60).lean(),
    FormIntakeSubmission.find().sort({ created_at: -1 }).limit(40).lean(),
    Member.find().select('id name').lean(),
  ]);

  const memberMap = new Map(members.map((member) => [member.id, member.name]));
  const sourceKeys = [
    ...notifications.map((item) => stateKey(admin, 'member_notification', String(item.id))),
    ...intakeRows.map((item) => stateKey(admin, 'form_intake', String(item._id))),
  ];
  const states = sourceKeys.length
    ? await AdminNotificationState.find({ key: { $in: sourceKeys } }).lean()
    : [];
  const readKeys = new Set(states.map((row) => row.key));

  const items = [
    ...intakeRows.map((row) => {
      const id = String(row._id);
      const months = Array.isArray(row.months) && row.months.length
        ? ` · ${(row.months || []).join(', ')}`
        : '';
      const amount = Number(row.amount || 0).toLocaleString('en-US');
      const isResolved = row.posted || ['posted', 'rejected'].includes(row.review_status);
      return {
        source: 'form_intake',
        id,
        key: stateKey(admin, 'form_intake', id),
        title: row.member_name || 'Payment submission',
        message: `Submitted TZS ${amount} · ${intakeTypeLabel(row.type)}${months}`,
        detail: row.notes || null,
        created_at: row.created_at || row.submitted_at,
        read: readKeys.has(stateKey(admin, 'form_intake', id)),
        resolved: isResolved,
        status: row.review_status,
        route: `/form-intake?intake=${id}`,
        tone: isResolved ? 'neutral' : 'payment',
      };
    }),
    ...notifications.map((row) => {
      const id = String(row.id);
      return {
        source: 'member_notification',
        id,
        key: stateKey(admin, 'member_notification', id),
        title: memberMap.get(row.member_id) || 'Member notification',
        message: row.message || formatType(row.type),
        detail: row.due_date ? `Due ${row.due_date}` : null,
        created_at: row.created_at,
        read: readKeys.has(stateKey(admin, 'member_notification', id)),
        resolved: Boolean(row.read),
        status: row.type,
        route: `/members?member=${row.member_id}`,
        tone: row.type === 'fine_issued' || row.type === 'fine_overdue' ? 'warning' : 'member',
      };
    }),
  ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  return {
    admin,
    items: items.slice(0, 80),
  };
}

router.get('/', authenticate, async (req, res) => {
  const query = {};
  if (req.user.role !== 'admin') query.member_id = req.user.member_id;
  else if (req.query.member_id) query.member_id = parseInt(req.query.member_id, 10);

  const list = await Notification.find(query).lean();
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(list);
});

router.get('/admin-feed', authenticate, requireAdmin, async (req, res) => {
  const feed = await buildAdminFeed(req);
  const filter = String(req.query.filter || 'all');
  const unreadCount = feed.items.filter((item) => !item.read).length;
  const visible = filter === 'unread'
    ? feed.items.filter((item) => !item.read)
    : feed.items;

  res.json({
    items: visible,
    unread_count: unreadCount,
    total_count: feed.items.length,
  });
});

router.patch('/admin-feed/read-all', authenticate, requireAdmin, async (req, res) => {
  const feed = await buildAdminFeed(req);
  const unread = feed.items.filter((item) => !item.read);
  if (!unread.length) return res.json({ success: true, updated: 0 });

  const now = new Date();
  await AdminNotificationState.bulkWrite(unread.map((item) => ({
    updateOne: {
      filter: { key: item.key },
      update: {
        $set: {
          key: item.key,
          admin_key: feed.admin,
          source: item.source,
          source_id: item.id,
          read_at: now,
        },
      },
      upsert: true,
    },
  })));

  res.json({ success: true, updated: unread.length });
});

router.patch('/admin-feed/:source/:id/read', authenticate, requireAdmin, async (req, res) => {
  const source = String(req.params.source || '');
  const sourceId = String(req.params.id || '');
  if (!['form_intake', 'member_notification'].includes(source) || !sourceId) {
    return res.status(400).json({ error: 'Unknown notification item.' });
  }

  const admin = adminKey(req);
  const key = stateKey(admin, source, sourceId);
  await AdminNotificationState.findOneAndUpdate(
    { key },
    {
      $set: {
        key,
        admin_key: admin,
        source,
        source_id: sourceId,
        read_at: new Date(),
      },
    },
    { upsert: true, new: true },
  );
  res.json({ success: true });
});

router.get('/attention', authenticate, requireAdmin, async (req, res) => {
  const [unread, members, intakeRows] = await Promise.all([
    Notification.find({ read: false }).lean(),
    Member.find().lean(),
    FormIntakeSubmission.find({
      posted: false,
      review_status: { $nin: ['rejected', 'posted'] },
    }).sort({ created_at: -1 }).limit(20).lean(),
  ]);

  const memberMap = new Map(members.map((m) => [m.id, m.name]));
  const byMember = new Map();
  for (const n of unread) {
    if (!byMember.has(n.member_id)) byMember.set(n.member_id, []);
    byMember.get(n.member_id).push({ type: n.type, message: n.message, due_date: n.due_date });
  }

  const items = [...byMember.entries()].map(([member_id, issues]) => ({
    member_id,
    name: memberMap.get(member_id) || '?',
    issues,
    route: `/members?member=${member_id}`,
  }));

  if (intakeRows.length) {
    const newest = intakeRows[0];
    items.unshift({
      member_id: null,
      attention_id: 'form-intake',
      name: 'Form Intake',
      route: '/form-intake',
      count: intakeRows.length,
      created_at: newest.created_at,
      issues: [{
        type: 'form_intake',
        message: `${intakeRows.length} payment submission${intakeRows.length === 1 ? '' : 's'} awaiting verification`,
        due_date: null,
      }],
    });
  }

  res.json(items);
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
