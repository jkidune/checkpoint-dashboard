require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Initialize MongoDB Connection on startup
const connectDB = require('./db/mongoose');
connectDB();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS: allow localhost in dev; on Vercel the function and frontend share the same
// origin so the browser sends no cross-origin request — but allow *.vercel.app and
// any explicit CORS_ORIGIN overrides just in case.
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) : []),
];

app.use(cors({
  origin: (origin, cb) => {
    if (
      !origin ||                                              // server-to-server / curl
      process.env.VERCEL === '1' ||                          // same-origin on Vercel
      ALLOWED_ORIGINS.includes(origin) ||                    // explicit whitelist
      /\.vercel\.app$/.test(origin)                          // any Vercel preview URL
    ) {
      cb(null, true);
    } else {
      cb(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
}));
app.use(express.json());

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/members',       require('./routes/members'));
app.use('/api/contributions', require('./routes/contributions'));
app.use('/api/loans',         require('./routes/loans'));
app.use('/api/transactions',  require('./routes/transactions'));
app.use('/api/summary',       require('./routes/summary'));
app.use('/api/import',        require('./routes/import'));
app.use('/api/mailer',        require('./routes/mailer'));

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
}

// Export for Vercel serverless functions (api/index.js)
module.exports = app;
