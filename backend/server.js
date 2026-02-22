const express = require('express');
const cors = require('cors');

// Initialize DB on startup
require('./db/database');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/members',       require('./routes/members'));
app.use('/api/contributions', require('./routes/contributions'));
app.use('/api/loans',         require('./routes/loans'));
app.use('/api/transactions',  require('./routes/transactions'));
app.use('/api/summary',       require('./routes/summary'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Checkpoint API running on http://localhost:${PORT}`);
  console.log(`📂 DB: backend/db/checkpoint.json\n`);
});
