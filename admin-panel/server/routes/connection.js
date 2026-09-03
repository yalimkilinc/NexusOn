// Musteri ekranindaki "Bağlantı Talebi İlet" butonundan gelen talepleri
// destek ekibine Telegram uzerinden bildirir (herkese acik uc - ama artik
// anonim degil: musteri onceden customerAuth.js uzerinden giris/kayit olup
// cariKodu/cariAdi'yi ZATEN cozmus halde buraya gonderiyor, tipki
// /public/room-note gibi kimlik dogrulamasiz bir uc olsa da). Musteri
// ekraninda Telegram ile ilgili hicbir sey gorunmez - bu uc sadece arka
// planda bildirim gonderir.

const express = require('express');
const telegram = require('../telegram');
const db = require('../db');
const { requireAgentToken } = require('../middleware');
const { createRateLimiter } = require('../rateLimiter');

const router = express.Router();

// Herkese acik (girissiz) bir uc - kotuye kullanima (Telegram spam'i)
// karsi: IP basina 10 dakikada en fazla 10 talep.
const connectionRequestRateLimit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 10 });

// Musteriye bagli statu satirini ayirarak olustururuz ki personel baglaninca
// (bkz. tickets.js /agent/tickets/start) AYNI metni "Bekliyor" yerine
// "Baglanildi" statusuyle yeniden kurup editMessageText ile guncelleyebilelim.
function buildRequestMessage(displayName, roomCode, note, status) {
  let text = `${displayName} firması online destek talep etti.\nDestek kodu: ${roomCode}\n\nDurum: ${status}`;
  if (note) text += `\n\nMüşteri notu: ${note}`;
  return text;
}

// Mesajdaki "NexusOn'da Aç" tusu: personel tiklayinca NexusOn uygulamasi
// (zaten aciksa one gelir, kapaliysa acilir) direkt bu musteri+koda gider -
// bkz. app/main.js (nexuson:// protokolu) ve app/renderer.js (applyDeepLink).
// ONEMLI (CANLI KANITLANDI): Telegram Bot API, inline keyboard butonunun
// url alaninda nexuson:// gibi ozel semalari KABUL ETMIYOR - "Unsupported
// URL protocol" hatasiyla TUM mesaji reddediyor (bildirim hic gitmiyordu).
// Standart cozum: buton kendi sunucumuzdaki bir https:// sayfasina
// (Telegram bunu kabul eder) linklenir, o sayfa acilir acilmaz JS ile
// nexuson://'ya yonlendirir (bkz. GET /public/open asagida).
function buildDeepLinkKeyboard(roomCode, cariKodu, cariAdi) {
  const params = new URLSearchParams({ roomCode });
  if (cariKodu) params.set('cariKodu', cariKodu);
  if (cariAdi) params.set('cariAdi', cariAdi);
  return {
    inline_keyboard: [[{ text: 'NexusOn\'da Aç', url: `https://nexuson.novrixon.com.tr/api/public/open?${params.toString()}` }]],
  };
}

router.post('/public/connection-request', connectionRequestRateLimit, async (req, res) => {
  const roomCode = String((req.body && req.body.roomCode) || '').trim();
  const cariKodu = String((req.body && req.body.cariKodu) || '').trim();
  const cariAdi = String((req.body && req.body.cariAdi) || '').trim();
  const note = String((req.body && req.body.note) || '').trim();
  const telefon = String((req.body && req.body.telefon) || '').trim();
  const adSoyad = String((req.body && req.body.adSoyad) || '').trim();
  if (!roomCode || !cariKodu || !cariAdi) {
    return res.status(400).json({ error: 'Oda kodu ve müşteri bilgisi gerekli.' });
  }

  // Musteriyi bekletmeyelim: Telegram basarisiz olsa da hemen ok donuyoruz,
  // gonderim arka planda devam ediyor.
  res.json({ ok: true });

  // ONEMLI: bu satir personel baglaninca (bkz. tickets.js /agent/tickets/start)
  // musterinin telefon/ad soyad/orijinal talep zamanini bilete tasimanin TEK
  // yolu - Telegram gonderimi basarisiz olsa bile (bot yanlis ayarlanmis,
  // Telegram'a erisilemiyor vb.) bu kayit MUTLAKA olusmali. Once (Telegram'dan
  // BAGIMSIZ) ekleyip, basarili olursa mesaj kimliklerini ayrica guncelliyoruz.
  const insertInfo = db
    .prepare(
      'INSERT INTO pending_connection_requests (cari_kodu, cari_adi, room_code, note, telefon, ad_soyad) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(cariKodu, cariAdi, roomCode, note || null, telefon || null, adSoyad || null);

  try {
    const keyboard = buildDeepLinkKeyboard(roomCode, cariKodu, cariAdi);
    const sent = await telegram.sendMessage(
      buildRequestMessage(cariAdi, roomCode, note, '⏳ Bekliyor (henüz destek personeli bağlanmadı)'),
      keyboard
    );
    if (sent?.result?.message_id && sent?.result?.chat?.id) {
      db.prepare('UPDATE pending_connection_requests SET telegram_message_id = ?, telegram_chat_id = ? WHERE id = ?').run(
        String(sent.result.message_id),
        String(sent.result.chat.id),
        insertInfo.lastInsertRowid
      );
    }
  } catch (err) {
    console.error('Bağlantı talebi bildirimi gönderilemedi:', err.message);
  }
});

// Telegram'daki "NexusOn'da Aç" butonu buraya (https://) gelir, JS ile
// aninda nexuson:// protokolune yonlendirir - bkz. buildDeepLinkKeyboard
// yorumu (Telegram inline keyboard'da ozel semaya izin vermiyor).
router.get('/public/open', (req, res) => {
  const params = new URLSearchParams();
  if (req.query.roomCode) params.set('roomCode', String(req.query.roomCode));
  if (req.query.cariKodu) params.set('cariKodu', String(req.query.cariKodu));
  if (req.query.cariAdi) params.set('cariAdi', String(req.query.cariAdi));
  const deepLink = `nexuson://connect?${params.toString()}`;
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8" />
<meta http-equiv="refresh" content="0;url=${deepLink}" />
<title>NexusOn açılıyor...</title></head>
<body style="font-family:sans-serif;background:#0f1420;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
<div style="text-align:center;">
<p>NexusOn açılıyor...</p>
<p style="font-size:13px;color:#8891a8;">Otomatik açılmadıysa <a href="${deepLink}" style="color:#4f7dff;">buraya tıklayın</a>.</p>
</div>
<script>window.location.href = ${JSON.stringify(deepLink)};</script>
</body></html>`);
});

// Destek personeli musteriyi (cari) sectiginde NexusOn uygulamasi burayi
// sorar: o musteri icin son 30 dakika icinde birakilmis bekleyen bir "Baglanti
// Talebi Ilet" kodu var mi? Varsa kod alanina otomatik dolsun diye donuyoruz.
// KASITLI OLARAK SILMIYORUZ - satir, personel GERCEKTEN baglanip ticket
// baslatana kadar (bkz. tickets.js /agent/tickets/start) Telegram mesaj
// durumunu guncelleyebilmek icin gerekli; oradaki akis room_notes ile ayni
// sekilde tuketip siliyor.
router.get('/agent/pending-connection-request', requireAgentToken, (req, res) => {
  const cariKodu = String(req.query.cariKodu || '').trim();
  if (!cariKodu) return res.status(400).json({ error: 'cariKodu gerekli.' });

  const row = db
    .prepare(
      `SELECT room_code FROM pending_connection_requests
       WHERE cari_kodu = ? AND created_at >= datetime('now', '-30 minutes')
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(cariKodu);

  if (!row) return res.json({ found: false });
  res.json({ found: true, roomCode: row.room_code });
});

// GET endpoint'i artik satiri silmedigi icin (bkz. yukarisi), hic
// baglanilmayan/terk edilen talepler birikmesin diye periyodik temizlik.
setInterval(() => {
  db.prepare("DELETE FROM pending_connection_requests WHERE created_at < datetime('now', '-2 hours')").run();
}, 30 * 60 * 1000).unref();

module.exports = router;
module.exports.buildRequestMessage = buildRequestMessage;
module.exports.buildDeepLinkKeyboard = buildDeepLinkKeyboard;
