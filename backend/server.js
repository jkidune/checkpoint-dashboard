require('dotenv').config();
const express = require('express');
const cors = require('cors');

const connectDB = require('./db/mongoose');

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure MongoDB is connected before every request.
// In serverless (Vercel) the cached connection is reused across warm invocations.
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    res.status(503).json({ error: 'Database unavailable. Please try again shortly.' });
  }
});

// CORS: allow localhost in dev; on Vercel the function and frontend share the same
// origin so the browser sends no cross-origin request — but allow *.vercel.app and
// any explicit CORS_ORIGIN overrides just in case.
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) : []),
];

app.use(cors({
  origin: (origin, cb) => {
    if (
      !origin ||                                              // server-to-server / curl
      process.env.VERCEL === '1' ||                          // same-origin on Vercel
      ALLOWED_ORIGINS.includes(origin) ||                    // explicit whitelist
      /\.vercel\.app$/.test(origin) ||                       // any Vercel preview URL
      /\.pages\.dev$/.test(origin)                           // any Cloudflare Pages preview URL
    ) {
      cb(null, true);
    } else {
      cb(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/admin',         require('./routes/admin'));

// Contribution/FY rule corrections are mounted before the legacy routers so
// these exact endpoints use the one-time-per-contribution-month fine policy.
// Other legacy endpoints continue to fall through unchanged.
app.use('/api/rules',         require('./routes/rulesHotfix'));
app.use('/api/contributions', require('./routes/contributionsHotfix'));

app.use('/api/rules',         require('./routes/rules').router);
app.use('/api/expenses',      require('./routes/expenses'));
app.use('/api/investments',   require('./routes/investments'));
app.use('/api/reconciliation',require('./routes/reconciliation'));
app.use('/api/members',       require('./routes/members'));
app.use('/api/contributions', require('./routes/contributions'));
app.use('/api/loans',         require('./routes/loans'));
app.use('/api/transactions',  require('./routes/transactions'));
app.use('/api/summary',       require('./routes/summary'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/import',        require('./routes/import'));
app.use('/api/mailer',        require('./routes/mailer'));
app.use('/api/forms',         require('./routes/forms'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Only bind a port when running locally (not inside Vercel serverless).
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`\n🚀 Checkpoint API running on http://localhost:${PORT}`);
  });

  // In-process cron needs a long-lived process — not available on Vercel
  // serverless. There, wire a Vercel Cron trigger to POST /api/notifications/scan
  // (requireAdmin) instead, which runs the same scan function on demand.
  require('./jobs/deadlineScan').startDeadlineScanJob();
}

// Export for Vercel serverless functions (api/index.js)
module.exports = app;
