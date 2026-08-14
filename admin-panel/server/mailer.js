// Bilet kapanislarinda ve haftalik ozetlerde kullanilan e-posta gonderimi.
// Ayarlar admin panelde girilip SQLite'ta (email_settings tablosu) saklanir.

const nodemailer = require('nodemailer');
const db = require('./db');

function getSettings() {
  return db.prepare('SELECT * FROM email_settings WHERE id = 1').get() || null;
}

function saveSettings({ smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword, fromAddress, recipients, weeklySummaryEnabled }) {
  const existing = getSettings();
  db.prepare(
    `INSERT INTO email_settings (id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password, from_address, recipients, weekly_summary_enabled, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       smtp_host = excluded.smtp_host,
       smtp_port = excluded.smtp_port,
       smtp_secure = excluded.smtp_secure,
       smtp_user = excluded.smtp_user,
       smtp_password = CASE WHEN excluded.smtp_password = '' THEN email_settings.smtp_password ELSE excluded.smtp_password END,
       from_address = excluded.from_address,
       recipients = excluded.recipients,
       weekly_summary_enabled = excluded.weekly_summary_enabled,
       updated_at = excluded.updated_at`
  ).run(
    smtpHost,
    smtpPort || 587,
    smtpSecure ? 1 : 0,
    smtpUser || '',
    smtpPassword || '',
    fromAddress,
    recipients || '',
    weeklySummaryEnabled ? 1 : 0
  );
  return getSettings();
}

function getTransporter() {
  const s = getSettings();
  if (!s || !s.smtp_host || !s.from_address) {
    throw new Error('E-posta ayarları eksik. Önce admin panelden SMTP bilgilerini girin.');
  }
  return nodemailer.createTransport({
    host: s.smtp_host,
    port: s.smtp_port || 587,
    secure: !!s.smtp_secure,
    auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_password } : undefined,
  });
}

function getRecipientList() {
  const s = getSettings();
  if (!s || !s.recipients) return [];
  return s.recipients.split(',').map((r) => r.trim()).filter(Boolean);
}

async function sendMail({ to, subject, html }) {
  const s = getSettings();
  const transporter = getTransporter();
  await transporter.sendMail({ from: s.from_address, to, subject, html });
}

module.exports = { getSettings, saveSettings, getTransporter, getRecipientList, sendMail };
