// Destek personeli (ajan) girisi ve yonetimi.
// Ajanlar admin panelden eklenir; NexusOn uygulamasinda (Destek Ekibi ekraninda)
// bu kullanici adi/sifre ile giris yaparlar.

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAgentToken } = require('../middleware');
const { createToken, revokeToken } = require('../agentTokens');
const { createRateLimiter } = require('../rateLimiter');

const router = express.Router();

// Kaba kuvvet (brute-force) sifre denemesine karsi: IP basina 15 dakikada
// en fazla 10 giris denemesi.
const agentLoginRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

// --------------------------- Ajan girisi (NexusOn uygulamasi cagirir) ---------------------------

router.post('/agent-login', agentLoginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli.' });
  }

  const agent = db.prepare('SELECT * FROM agents WHERE username = ?').get(username);
  if (!agent || !bcrypt.compareSync(password, agent.password_hash)) {
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
  }

  const token = createToken(agent.id, agent.username);
  res.json({ ok: true, username: agent.username, token });
});

router.post('/agent-logout', requireAgentToken, (req, res) => {
  revokeToken(req.agentToken);
  res.json({ ok: true });
});

// Personel giris ekranindaki secim listesi icin (herkese acik - NexusOn
// uygulamasi henuz giris yapmamis haldeyken cagirir). Sadece kimlik bilgisi
// (kullanici kodu + ad) doner - sifre/telefon/e-posta ASLA donmez.
router.get('/public/agents', (_req, res) => {
  const agents = db
    .prepare('SELECT username, full_name FROM agents ORDER BY COALESCE(full_name, username) ASC')
    .all();
  res.json(agents.map((a) => ({ username: a.username, fullName: a.full_name || a.username })));
});

// Destek personeli kendi sifresini kendisi degistirir (admin panele
// gitmesine gerek kalmadan) - mevcut sifre dogrulanarak.
router.post('/agent/change-password', requireAgentToken, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Mevcut ve yeni şifre gerekli.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalı.' });
  }

  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.agent.agentId);
  if (!agent || !bcrypt.compareSync(currentPassword, agent.password_hash)) {
    return res.status(401).json({ error: 'Mevcut şifre hatalı.' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE agents SET password_hash = ? WHERE id = ?').run(hash, agent.id);
  res.json({ ok: true });
});

// --------------------------- Admin: ajan yonetimi ---------------------------

router.get('/admin/agents', requireAuth, (_req, res) => {
  const agents = db
    .prepare('SELECT id, username, full_name, phone, email, created_at FROM agents ORDER BY username ASC')
    .all();
  res.json(agents);
});

router.post('/admin/agents', requireAuth, (req, res) => {
  const { username, fullName, phone, email, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Kullanıcı kodu ve şifre gerekli.' });
  }

  const existing = db.prepare('SELECT id FROM agents WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Bu kullanıcı kodu zaten kullanımda.' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO agents (username, full_name, phone, email, password_hash) VALUES (?, ?, ?, ?, ?)')
    .run(username, fullName || null, phone || null, email || null, hash);
  res.json({ id: info.lastInsertRowid, username, fullName, phone, email });
});

router.put('/admin/agents/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Bulunamadı.' });

  const { username, fullName, phone, email, password } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Kullanıcı kodu gerekli.' });

  const dup = db.prepare('SELECT id FROM agents WHERE username = ? AND id != ?').get(username, req.params.id);
  if (dup) return res.status(409).json({ error: 'Bu kullanıcı kodu başka bir personelde kullanımda.' });

  const passwordHash = password ? bcrypt.hashSync(password, 10) : existing.password_hash;

  db.prepare(
    'UPDATE agents SET username = ?, full_name = ?, phone = ?, email = ?, password_hash = ? WHERE id = ?'
  ).run(username, fullName || null, phone || null, email || null, passwordHash, req.params.id);

  res.json({ ok: true });
});

router.delete('/admin/agents/:id', requireAuth, (req, res) => {
  const info = db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Bulunamadı.' });
  res.json({ ok: true });
});

module.exports = { router };
