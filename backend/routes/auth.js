const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db/database');
const { JWT_SECRET, authenticate } = require('../middleware/auth');

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = db.get('users').find(u => u.username === username).value();
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const member = user.member_id
    ? db.get('members').find(m => m.id === user.member_id).value()
    : null;

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

router.post('/change-password', authenticate, (req, res) => {
  const { current_password, new_password } = req.body;
  const user = db.get('users').find(u => u.id === req.user.id).value();
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password incorrect' });
  }
  const hash = bcrypt.hashSync(new_password, 10);
  db.get('users').find(u => u.id === req.user.id).assign({ password_hash: hash }).write();
  res.json({ success: true });
});

module.exports = router;
