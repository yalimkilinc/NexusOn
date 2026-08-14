// Haftalik musteri ozeti: son 7 gunde kapanan biletleri musteri (cari_kodu)
// bazinda gruplayip, her musterinin V3'teki e-posta adresine bir ozet
// gonderir. Sadece admin panelden "Müşterilere haftalık özet gönder"
// acikken calisir (varsayilan kapali - musterilere otomatik mail gitmesi
// bilincli bir tercih olmali).

const db = require('./db');
const v3db = require('./v3db');
const mailer = require('./mailer');

const CATEGORY_LABELS = { hata: 'Hata', sorun: 'Sorun', istek: 'İstek', gelistirme: 'Geliştirme Talebi' };
const STATUS_LABELS = { cozuldu: 'Çözüldü', devam_ediyor: 'Devam Ediyor', yonlendirildi: 'Yönlendirildi' };

function formatDuration(seconds) {
  const m = Math.floor((seconds || 0) / 60);
  const s = (seconds || 0) % 60;
  return `${m}dk ${s}sn`;
}

function getTicketsFromLastWeek() {
  return db
    .prepare(
      `SELECT * FROM tickets
       WHERE ended_at IS NOT NULL AND ended_at >= datetime('now', '-7 days') AND cari_kodu IS NOT NULL
       ORDER BY cari_kodu, started_at`
    )
    .all();
}

function groupByCustomer(tickets) {
  const groups = new Map();
  for (const t of tickets) {
    if (!groups.has(t.cari_kodu)) groups.set(t.cari_kodu, { cariAdi: t.cari_adi, tickets: [] });
    groups.get(t.cari_kodu).tickets.push(t);
  }
  return groups;
}

function buildSummaryHtml(cariAdi, tickets) {
  const rows = tickets
    .map(
      (t) => `
        <tr>
          <td>${t.started_at}</td>
          <td>${CATEGORY_LABELS[t.category] || t.category || '—'}</td>
          <td>${STATUS_LABELS[t.status] || t.status || '—'}</td>
          <td>${formatDuration(t.duration_seconds)}</td>
        </tr>`
    )
    .join('');

  return `
    <h3>NexusOn - Haftalık Destek Özeti</h3>
    <p>Sayın ${cariAdi || 'yetkilisi'}, bu hafta tarafınıza sağlanan destek hizmetlerinin özeti aşağıdadır.</p>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
      <thead><tr><th>Tarih</th><th>Tür</th><th>Durum</th><th>Süre</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function runWeeklyCustomerSummary() {
  const settings = mailer.getSettings();
  if (!settings || !settings.weekly_summary_enabled) return { skipped: true };

  const tickets = getTicketsFromLastWeek();
  const groups = groupByCustomer(tickets);

  let sent = 0;
  let failed = 0;
  for (const [cariKodu, { cariAdi, tickets: customerTickets }] of groups) {
    try {
      const email = await v3db.getCustomerEmail(cariKodu);
      if (!email) continue;
      await mailer.sendMail({
        to: email,
        subject: `NexusOn - Haftalık Destek Özeti (${cariAdi || cariKodu})`,
        html: buildSummaryHtml(cariAdi, customerTickets),
      });
      sent++;
    } catch (err) {
      failed++;
      console.error(`Haftalık özet gönderilemedi (${cariKodu}):`, err.message);
    }
  }
  return { sent, failed, totalCustomers: groups.size };
}

module.exports = { runWeeklyCustomerSummary };
