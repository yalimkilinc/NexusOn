// Telegram bildirim ayarlari - yalnizca admin.

const express = require('express');
const { requireAuth, requireFullAdmin } = require('../middleware');
const telegram = require('../telegram');

const router = express.Router();

router.get('/admin/telegram-settings', requireAuth, requireFullAdmin, (_req, res) => {
  const s = telegram.getSettings();
  if (!s) return res.json(null);
  // Token'i oldugu gibi geri gondermiyoruz, sadece "ayarlanmis mi" bilgisini veriyoruz.
  res.json({
    hasToken: !!s.bot_token,
    chatId: s.chat_id,
    updatedAt: s.updated_at,
  });
});

router.post('/admin/telegram-settings', requireAuth, requireFullAdmin, (req, res) => {
  const { botToken, chatId } = req.body || {};
  if (!chatId) {
    return res.status(400).json({ error: 'Chat ID gerekli.' });
  }
  const saved = telegram.saveSettings({ botToken, chatId });
  res.json({ ok: true, updatedAt: saved.updated_at });
});

router.post('/admin/telegram-settings/test', requireAuth, requireFullAdmin, async (_req, res) => {
  try {
    await telegram.sendMessage('NexusOn admin panelinden gönderilen bir test mesajıdır. Telegram ayarlarınız çalışıyor.');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
