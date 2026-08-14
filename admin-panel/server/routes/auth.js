const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { createRateLimiter } = require('../rateLimiter');

const router = express.Router();

// Kaba kuvvet (brute-force) sifre denemesine karsi: IP basina 15 dakikada
// en fazla 10 giris denemesi.
const loginRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

router.post('/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli.' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
  }

  req.session.adminId = admin.id;
  req.session.username = admin.username;
  res.json({ ok: true, username: admin.username });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/session', (req, res) => {
  if (req.session && req.session.adminId) {
    res.json({ loggedIn: true, username: req.session.username });
  } else {
    res.json({ loggedIn: false });
  }
});

module.exports = router;
