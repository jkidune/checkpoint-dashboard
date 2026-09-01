require('dotenv').config();
const express = require('express');
const cors = require('cors');

const connectDB = require('./db/mongoose');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    res.status(503).json({ error: 'Database unavailable. Please try again shortly.' });
  }
});

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()) : []),
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || process.env.VERCEL === '1' || ALLOWED_ORIGINS.includes(origin) || /\.vercel\.app$/.test(origin) || /\.pages\.dev$/.test(origin)) cb(null, true);
    else cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/rules', require('./routes/rulesHotfix'));
app.use('/api/contributions', require('./routes/contributionsHotfix'));
app.use('/api/rules', require('./routes/rules').router);
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/investments', require('./routes/investments'));
app.use('/api/reconciliation', require('./routes/reconciliation'));
app.use('/api/members', require('./routes/members'));
app.use('/api/member/loan-eligibility', require('./routes/memberLoanEligibility'));
app.use('/api/contributions', require('./routes/contributions'));
app.use('/api/loans', require('./routes/loanActivationHotfix'));
app.use('/api/loans', require('./routes/loans'));
app.use('/api/transactions', require('./routes/transactions'));
// Repairs/normalizes paid-fine cash receipts before the main summary route
// calculates the post-reconciliation M-Koba movement bridge.
app.use('/api/summary', require('./routes/fineCashHotfix'));
app.use('/api/summary', require('./routes/summary'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/import', require('./routes/import'));
app.use('/api/communications', require('./routes/communications'));
app.use('/api/cron/member-reminders', require('./routes/memberAutomation'));

app.post('/api/mailer/broadcast-credentials', (req, res) => {
  res.status(410).json({ error: 'Credential broadcast has been retired. Use member account invitations instead.' });
});
app.use('/api/mailer', require('./routes/mailer'));

// Safe Form intakes: submissions are staged/reviewed before they affect records.
app.use('/api/forms/intake', require('./routes/formIntake'));
app.use('/api/forms/loan-request', require('./routes/loanRequests'));
// Legacy direct-write endpoint retained temporarily for backward compatibility.
app.use('/api/forms', require('./routes/forms'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => console.log(`\n🚀 Checkpoint API running on http://localhost:${PORT}`));
  require('./jobs/deadlineScan').startDeadlineScanJob();
}

module.exports = app;
