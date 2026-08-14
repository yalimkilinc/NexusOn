// Destek gorusmesi kayitlari (biletler). Her gorusme bir "ticket" satirina
// karsilik gelir: kim (ajan), ne zaman baslayip bitti, ne turdendi, sonucu ne oldu.

const express = require('express');
const sql = require('mssql');
const db = require('../db');
const v3db = require('../v3db');
const mailer = require('../mailer');
const telegram = require('../telegram');
const { buildRequestMessage, buildDeepLinkKeyboard } = require('./connection');
const { requireAuth, requireAgentToken } = require('../middleware');

const router = express.Router();

const VALID_CATEGORIES = ['hata', 'sorun', 'istek', 'gelistirme'];
const VALID_STATUSES = ['cozuldu', 'devam_ediyor', 'yonlendirildi'];

const CATEGORY_LABELS = { hata: 'Hata', sorun: 'Sorun', istek: 'İstek', gelistirme: 'Geliştirme Talebi' };
const STATUS_LABELS = { cozuldu: 'Çözüldü', devam_ediyor: 'Devam Ediyor', yonlendirildi: 'Yönlendirildi' };

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}dk ${s}sn`;
}

// Bilet kapaninca yetkililere bilgilendirme maili gonderir. Bu adim
// basarisiz olsa bile (SMTP ayari girilmemis, sunucu erisilemez vb.)
// ajanin akisini kesmez, sadece loglanir.
async function notifyTicketClosed(ticket, { category, note, status, durationSeconds }) {
  const recipients = mailer.getRecipientList();
  if (recipients.length === 0) return;

  const html = `
    <h3>NexusOn - Destek Görüşmesi Kapandı</h3>
    <p><b>Personel:</b> ${ticket.agent_username}</p>
    <p><b>Müşteri:</b> ${ticket.cari_adi || '—'} (${ticket.cari_kodu || '—'})</p>
    <p><b>Oda Kodu:</b> ${ticket.room_code}</p>
    <p><b>Tür:</b> ${CATEGORY_LABELS[category] || category}</p>
    <p><b>Durum:</b> ${STATUS_LABELS[status] || status}</p>
    <p><b>Süre:</b> ${formatDuration(durationSeconds)}</p>
    <p><b>Müşteri Talebi:</b> ${ticket.customer_note || '—'}</p>
    <p><b>Personel Notu:</b> ${note || '—'}</p>
  `;

  try {
    await mailer.sendMail({ to: recipients.join(','), subject: `NexusOn Destek Kaydı - ${ticket.cari_adi || ticket.room_code}`, html });
  } catch (err) {
    console.error('Bilet kapanis maili gonderilemedi:', err.message);
  }
}

// --------------------------- Musteri: destek talebi notu (herkese acik) ---------------------------
//
// Musteri kod uretirken "ne icin destek istiyor" notunu buraya birakir. Henuz
// hangi personelin baglanacagi belli olmadigi icin bilet degil, oda koduna
// bagli gecici bir not olarak saklanir; personel baglanip bilet acinca
// otomatik oraya tasinir (asagida).

router.post('/public/room-note', (req, res) => {
  const roomCode = String((req.body && req.body.roomCode) || '').trim();
  const note = String((req.body && req.body.note) || '').trim();
  if (!roomCode || !note) return res.status(400).json({ error: 'Oda kodu ve not gerekli.' });

  db.prepare('INSERT OR REPLACE INTO room_notes (room_code, note) VALUES (?, ?)').run(roomCode, note);
  res.json({ ok: true });
});

// --------------------------- Ajan: gorusme basla/bitir ---------------------------

router.post('/agent/tickets/start', requireAgentToken, (req, res) => {
  const roomCode = String((req.body && req.body.roomCode) || '').trim();
  const cariKodu = req.body && req.body.cariKodu ? String(req.body.cariKodu) : null;
  const cariAdi = req.body && req.body.cariAdi ? String(req.body.cariAdi) : null;
  if (!roomCode) return res.status(400).json({ error: 'Oda kodu gerekli.' });

  const roomNote = db.prepare('SELECT note FROM room_notes WHERE room_code = ?').get(roomCode);

  const info = db
    .prepare(
      'INSERT INTO tickets (agent_id, agent_username, room_code, cari_kodu, cari_adi, customer_note) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(req.agent.agentId, req.agent.username, roomCode, cariKodu, cariAdi, roomNote ? roomNote.note : null);

  if (roomNote) db.prepare('DELETE FROM room_notes WHERE room_code = ?').run(roomCode);

  // "Bağlantı Talebi İlet" ile gelmis bir talep bu roomCode'a karsilik
  // geliyorsa, Telegram'daki orijinal mesajin durumunu "beklıyor"dan
  // "bağlanıldı"ya guncelle - musteri Telegram tarafinda hicbir sey
  // gormedigi icin bu SADECE destek ekibinin gordugu mesajda degisir.
  const pendingRequest = db
    .prepare('SELECT * FROM pending_connection_requests WHERE room_code = ?')
    .get(roomCode);
  if (pendingRequest) {
    db.prepare('DELETE FROM pending_connection_requests WHERE id = ?').run(pendingRequest.id);
    if (pendingRequest.telegram_message_id && pendingRequest.telegram_chat_id) {
      const text = buildRequestMessage(
        pendingRequest.cari_adi,
        roomCode,
        pendingRequest.note,
        `✅ Bağlanıldı (${req.agent.username})`
      );
      const keyboard = buildDeepLinkKeyboard(roomCode, pendingRequest.cari_kodu, pendingRequest.cari_adi);
      telegram
        .editMessageText(pendingRequest.telegram_chat_id, pendingRequest.telegram_message_id, text, keyboard)
        .catch((err) => console.error('Telegram mesaj durumu güncellenemedi:', err.message));
    }
  }

  res.json({ ticketId: info.lastInsertRowid });
});

router.post('/agent/tickets/:id/end', requireAgentToken, async (req, res) => {
  const { category, note, status } = req.body || {};
  if (!VALID_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Geçersiz tür.' });
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Geçersiz durum.' });

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ? AND agent_id = ?').get(req.params.id, req.agent.agentId);
  if (!ticket) return res.status(404).json({ error: 'Bulunamadı.' });

  const startedMs = new Date(ticket.started_at + 'Z').getTime();
  const durationSeconds = Math.max(0, Math.round((Date.now() - startedMs) / 1000));

  db.prepare(
    `UPDATE tickets SET category = ?, note = ?, status = ?, ended_at = datetime('now'), duration_seconds = ? WHERE id = ?`
  ).run(category, note || '', status, durationSeconds, req.params.id);

  // V3'e de yazmayi dene. Bu basarisiz olsa bile (V3 o an erisilemez olsa
  // bile) kendi kaydimiz (SQLite) zaten guvenli sekilde kaydedildi; ajanin
  // akisini kesmiyoruz, sadece isareti donuyoruz.
  let v3Written = false;
  try {
    const pool = await v3db.connect();
    await pool
      .request()
      .input('agentUsername', sql.NVarChar, ticket.agent_username)
      .input('roomCode', sql.NVarChar, ticket.room_code)
      .input('cariKodu', sql.NVarChar, ticket.cari_kodu)
      .input('cariAdi', sql.NVarChar, ticket.cari_adi)
      .input('category', sql.NVarChar, category)
      .input('status', sql.NVarChar, status)
      .input('note', sql.NVarChar, note || '')
      .input('customerNote', sql.NVarChar, ticket.customer_note)
      .input('startedAt', sql.DateTime2, new Date(ticket.started_at + 'Z'))
      .input('durationSeconds', sql.Int, durationSeconds)
      .query(`
        INSERT INTO ${v3db.TICKETS_TABLE}
          (AgentUsername, RoomCode, CariKodu, CariAdi, Category, Status, Note, CustomerNote, StartedAt, EndedAt, DurationSeconds)
        VALUES
          (@agentUsername, @roomCode, @cariKodu, @cariAdi, @category, @status, @note, @customerNote, @startedAt, SYSDATETIME(), @durationSeconds)
      `);
    await pool.close();
    v3Written = true;
  } catch (err) {
    console.error('V3 yazma hatası:', err.message);
  }

  notifyTicketClosed(ticket, { category, note, status, durationSeconds });

  res.json({ ok: true, v3Written });
});

// --------------------------- Admin: gorusme kayitlarini goruntule ---------------------------

router.get('/admin/tickets', requireAuth, (_req, res) => {
  const tickets = db.prepare('SELECT * FROM tickets ORDER BY started_at DESC').all();
  res.json(tickets);
});

router.delete('/admin/tickets/:id', requireAuth, (req, res) => {
  const info = db.prepare('DELETE FROM tickets WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Bulunamadı.' });
  res.json({ ok: true });
});

module.exports = router;
