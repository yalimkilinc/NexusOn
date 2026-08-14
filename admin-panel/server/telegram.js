// "Bağlantı Talebi İlet" ile gelen musteri taleplerini destek ekibine
// Telegram uzerinden bildirmek icin kullanilir. Ayarlar admin panelde
// girilip SQLite'ta (telegram_settings tablosu) saklanir.

const db = require('./db');

function getSettings() {
  return db.prepare('SELECT * FROM telegram_settings WHERE id = 1').get() || null;
}

function saveSettings({ botToken, chatId }) {
  const existing = getSettings();
  db.prepare(
    `INSERT INTO telegram_settings (id, bot_token, chat_id, updated_at)
     VALUES (1, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       bot_token = CASE WHEN excluded.bot_token = '' THEN telegram_settings.bot_token ELSE excluded.bot_token END,
       chat_id = excluded.chat_id,
       updated_at = excluded.updated_at`
  ).run(botToken || '', chatId || '');
  return getSettings();
}

async function sendMessage(text, replyMarkup) {
  const s = getSettings();
  if (!s || !s.bot_token || !s.chat_id) {
    throw new Error('Telegram ayarları eksik. Önce admin panelden bot token ve chat ID girin.');
  }
  const body = { chat_id: s.chat_id, text };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const res = await fetch(`https://api.telegram.org/bot${s.bot_token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.description || 'Telegram mesajı gönderilemedi.');
  }
  return data;
}

async function editMessageText(chatId, messageId, text, replyMarkup) {
  const s = getSettings();
  if (!s || !s.bot_token) return; // ayarlar silinmis/degismis olabilir - sessizce vazgec
  const body = { chat_id: chatId, message_id: messageId, text };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const res = await fetch(`https://api.telegram.org/bot${s.bot_token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.description || 'Telegram mesajı güncellenemedi.');
  }
  return data;
}

module.exports = { getSettings, saveSettings, sendMessage, editMessageText };
