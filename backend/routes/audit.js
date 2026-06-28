const express = require('express');
const router = express.Router();
const { AuditLog, FormSubmissionLog } = require('../db/models');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', authenticate, requireAdmin, async (req, res) => {
  const { record_type, limit = 100, offset = 0 } = req.query;
  const query = record_type ? { record_type } : {};
  const [records, total] = await Promise.all([
    AuditLog.find(query).sort({ created_at: -1 }).skip(Number(offset)).limit(Math.min(Number(limit), 500)).lean(),
    AuditLog.countDocuments(query),
  ]);
  res.json({ records, total });
});

router.get('/form-submissions', authenticate, requireAdmin, async (req, res) => {
  const { status, limit = 100, offset = 0 } = req.query;
  const query = status ? { validation_status: status } : {};
  const [records, total] = await Promise.all([
    FormSubmissionLog.find(query).sort({ received_at: -1 }).skip(Number(offset)).limit(Math.min(Number(limit), 500)).lean(),
    FormSubmissionLog.countDocuments(query),
  ]);
  res.json({ records, total });
});

module.exports = router;
