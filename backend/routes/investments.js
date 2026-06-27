const express = require('express');
const router = express.Router();
const { Investment } = require('../db/models');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  const investments = await Investment.find().sort({ created_at: -1 }).lean();
  res.json(investments);
});

module.exports = router;
