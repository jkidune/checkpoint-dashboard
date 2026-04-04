require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Initialize MongoDB Connection on startup
const connectDB = require('./db/mongoose');
connectDB();

const app = express();
const PORT = process.env.PORT || 3001;

// Allow local dev + any Vercel deployment. Set CORS_ORIGIN on Railway for production.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    // allow server-to-server / curl (no origin) and whitelisted origins
    if (!origin || ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
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

app.listen(PORT, () => {
  console.log(`\n🚀 Checkpoint API running on http://localhost:${PORT}`);
});
