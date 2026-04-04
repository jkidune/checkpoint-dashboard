const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Member } = require('../db/models');
const { JWT_SECRET, authenticate } = require('../middleware/auth');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = await User.findOne({ username });
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  let member = null;
  if (user.member_id) {
    member = await Member.findOne({ id: user.member_id });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, member_id: user.member_id, name: member ? member.name : 'Admin' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token, user: { id: user.id, username: user.username, role: user.role, name: member ? member.name : 'Admin' } });
});

router.get('/me', authenticate, (req, res) => {
  res.json(req.user);
});

router.post('/change-password', authenticate, async (req, res) => {
  const { current_password, new_password } = req.body;
  const user = await User.findOne({ id: req.user.id });
  
  if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password incorrect' });
  }
  const hash = bcrypt.hashSync(new_password, 10);
  user.password_hash = hash;
  await user.save();
  
  res.json({ success: true });
});

module.exports = router;
