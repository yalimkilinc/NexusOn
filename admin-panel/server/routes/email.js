// E-posta (SMTP) ayarlari - yalnizca admin.

const express = require('express');
const { requireAuth, requireFullAdmin } = require('../middleware');
const mailer = require('../mailer');
const { runWeeklyCustomerSummary } = require('../weeklySummary');

const router = express.Router();

router.get('/admin/email-settings', requireAuth, requireFullAdmin, (_req, res) => {
  const s = mailer.getSettings();
  if (!s) return res.json(null);
  // Sifreyi oldugu gibi geri gondermiyoruz, sadece "ayarlanmis mi" bilgisini veriyoruz.
  res.json({
    smtpHost: s.smtp_host,
    smtpPort: s.smtp_port,
    smtpSecure: !!s.smtp_secure,
    smtpUser: s.smtp_user,
    hasPassword: !!s.smtp_password,
    fromAddress: s.from_address,
    recipients: s.recipients,
    weeklySummaryEnabled: !!s.weekly_summary_enabled,
    updatedAt: s.updated_at,
  });
});

router.post('/admin/email-settings', requireAuth, requireFullAdmin, (req, res) => {
  const { smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword, fromAddress, recipients, weeklySummaryEnabled } = req.body || {};
  if (!smtpHost || !fromAddress) {
    return res.status(400).json({ error: 'SMTP sunucu adresi ve gönderen e-posta adresi gerekli.' });
  }
  const saved = mailer.saveSettings({
    smtpHost,
    smtpPort: Number(smtpPort) || 587,
    smtpSecure: !!smtpSecure,
    smtpUser,
    smtpPassword,
    fromAddress,
    recipients,
    weeklySummaryEnabled: !!weeklySummaryEnabled,
  });
  res.json({ ok: true, updatedAt: saved.updated_at });
});

router.post('/admin/email-settings/send-weekly-now', requireAuth, requireFullAdmin, async (_req, res) => {
  try {
    const result = await runWeeklyCustomerSummary();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/admin/email-settings/test', requireAuth, requireFullAdmin, async (req, res) => {
  const to = (req.body && req.body.to) || mailer.getRecipientList()[0];
  if (!to) return res.status(400).json({ error: 'Test göndermek için bir alıcı e-posta adresi gerekli.' });

  try {
    await mailer.sendMail({
      to,
      subject: 'NexusOn - Test E-postası',
      html: '<p>Bu, NexusOn admin panelinden gönderilen bir test e-postasıdır. SMTP ayarlarınız çalışıyor.</p>',
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
