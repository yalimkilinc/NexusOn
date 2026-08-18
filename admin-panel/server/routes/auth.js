const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireFullAdmin } = require('../middleware');
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
  req.session.role = admin.role;
  res.json({ ok: true, username: admin.username, role: admin.role });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/session', (req, res) => {
  if (req.session && req.session.adminId) {
    res.json({ loggedIn: true, username: req.session.username, role: req.session.role });
  } else {
    res.json({ loggedIn: false });
  }
});

// --------------------------- Admin: panel hesaplari ---------------------------
// Sadece 'admin' rolundeki hesaplar diger panel hesaplarini yonetebilir.

router.get('/admin/admins', requireAuth, requireFullAdmin, (_req, res) => {
  const admins = db.prepare('SELECT id, username, role FROM admins ORDER BY username ASC').all();
  res.json(admins);
});

router.post('/admin/admins', requireAuth, requireFullAdmin, (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli.' });
  }
  if (role !== 'admin' && role !== 'destek') {
    return res.status(400).json({ error: 'Geçersiz rol.' });
  }

  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Bu kullanıcı adı zaten kullanımda.' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, hash, role);
  res.json({ id: info.lastInsertRowid, username, role });
});

router.put('/admin/admins/:id', requireAuth, requireFullAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Bulunamadı.' });

  const { username, password, role } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Kullanıcı adı gerekli.' });
  if (role !== 'admin' && role !== 'destek') {
    return res.status(400).json({ error: 'Geçersiz rol.' });
  }

  if (Number(req.params.id) === req.session.adminId && role !== 'admin') {
    return res.status(400).json({ error: 'Kendi hesabınızın yönetici yetkisini kaldıramazsınız.' });
  }

  const dup = db.prepare('SELECT id FROM admins WHERE username = ? AND id != ?').get(username, req.params.id);
  if (dup) return res.status(409).json({ error: 'Bu kullanıcı adı başka bir hesapta kullanımda.' });

  const passwordHash = password ? bcrypt.hashSync(password, 10) : existing.password_hash;

  db.prepare('UPDATE admins SET username = ?, password_hash = ?, role = ? WHERE id = ?').run(
    username,
    passwordHash,
    role,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/admin/admins/:id', requireAuth, requireFullAdmin, (req, res) => {
  if (Number(req.params.id) === req.session.adminId) {
    return res.status(400).json({ error: 'Kendi hesabınızı silemezsiniz.' });
  }

  const remainingAdmins = db.prepare("SELECT COUNT(*) AS c FROM admins WHERE role = 'admin' AND id != ?").get(req.params.id).c;
  const target = db.prepare('SELECT role FROM admins WHERE id = ?').get(req.params.id);
  if (target && target.role === 'admin' && remainingAdmins === 0) {
    return res.status(400).json({ error: 'Son yönetici hesabı silinemez.' });
  }

  const info = db.prepare('DELETE FROM admins WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Bulunamadı.' });
  res.json({ ok: true });
});

module.exports = router;
