// Musteri (host) tarafinda "Bağlantı Talebi İlet" akisi artik anonim degil:
// ilk seferinde musteri kayit olur (ad soyad, telefon, vergi no, sifre, KVKK
// onayi), sonraki seferlerde sadece telefon+sifre ile "giris yapar". Kayitlar
// NexusOn'un kendi SQLite'inda DEGIL, ABSupport (Ab Yazilim'in baska bir
// uygulamasinin kullandigi SQL Server veritabani) icinde NexusOn_Musteriler
// tablosunda tutulur - musteri boyle istedi (ortak raporlama icin).
//
// Vergi numarasi V3'teki (Nebim) GERCEK cari kaydiyla eslesmek ZORUNDA -
// eslesmezse kayit reddedilir, boylece sadece gercek musteriler kayit
// olabilir ve firma adi guvenilir sekilde V3'ten (musterinin kendi yazdigi
// bir metinden DEGIL) geliyor.

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const telegram = require('../telegram');
const v3db = require('../v3db');
const absupport = require('../absupport');
const { createRateLimiter } = require('../rateLimiter');

const router = express.Router();

// Herkese acik (girissiz) uclar - kaba kuvvet/kotuye kullanima karsi.
const checkPhoneRateLimit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });
const registerRateLimit = createRateLimiter({ windowMs: 30 * 60 * 1000, max: 5 });
const loginRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const forgotRateLimit = createRateLimiter({ windowMs: 30 * 60 * 1000, max: 6 });
const resetRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

// Sifre sifirlama (SMS altyapisi yok, destek ekibi onayli): musteri telefon +
// vergi numarasini girer; eslesirse tek kullanimlik 6 haneli kod Telegram destek
// grubuna duser. Destek KAYITLI numarayi geri arayip dogrular ve kodu iletir.
// Kod olmadan sifre degistirilemez.
const RESET_TTL_MINUTES = 30;
const RESET_MAX_ATTEMPTS = 5;
const RESET_MAX_REQUESTS_PER_HOUR = 3;

function normalizeDigits(raw) {
  return String(raw || '').replace(/[^0-9]/g, '');
}

function hashResetCode(code, salt) {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

// Telefon numaralarini karsilastirmadan once ayni formata indirger (bosluk/
// tire/parantez farkli yazilsa da ayni numara olarak eslessin).
function normalizePhone(raw) {
  return String(raw || '').replace(/[^0-9]/g, '');
}

async function findCustomerByPhone(pool, telefon) {
  const result = await pool
    .request()
    .input('telefon', telefon)
    .query(`SELECT * FROM ${absupport.CUSTOMERS_TABLE} WHERE Telefon = @telefon`);
  return result.recordset[0] || null;
}

router.post('/public/customer/check-phone', checkPhoneRateLimit, async (req, res) => {
  const telefon = normalizePhone(req.body && req.body.telefon);
  if (!telefon) return res.status(400).json({ error: 'Telefon numarası gerekli.' });

  try {
    await absupport.ensureCustomersTable();
    const pool = await absupport.connect();
    try {
      const existing = await findCustomerByPhone(pool, telefon);
      res.json({ registered: !!existing });
    } finally {
      await pool.close();
    }
  } catch (err) {
    console.error('Müşteri telefon kontrolü başarısız:', err.message);
    res.status(500).json({ error: 'Şu anda bu işlem yapılamıyor, lütfen daha sonra tekrar deneyin.' });
  }
});

router.post('/public/customer/register', registerRateLimit, async (req, res) => {
  const adSoyad = String((req.body && req.body.adSoyad) || '').trim();
  const telefon = normalizePhone(req.body && req.body.telefon);
  const vergiNo = String((req.body && req.body.vergiNo) || '').trim();
  const sifre = String((req.body && req.body.sifre) || '');
  const kvkkOnay = !!(req.body && req.body.kvkkOnay);

  if (!adSoyad || !telefon || !vergiNo || !sifre) {
    return res.status(400).json({ error: 'Tüm alanları doldurun.' });
  }
  if (sifre.length < 6) {
    return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı.' });
  }
  if (!kvkkOnay) {
    return res.status(400).json({ error: 'Gizlilik Sözleşmesi ve KVKK Onayı gerekli.' });
  }

  try {
    const match = await v3db.findCustomerByTaxNumber(vergiNo);
    if (!match) {
      return res.status(400).json({ error: 'Bu vergi numarasıyla kayıtlı bir firma bulunamadı.' });
    }

    await absupport.ensureCustomersTable();
    const pool = await absupport.connect();
    try {
      const existing = await findCustomerByPhone(pool, telefon);
      if (existing) {
        return res.status(409).json({ error: 'Bu telefon numarası zaten kayıtlı. Lütfen giriş yapın.' });
      }

      const passwordHash = bcrypt.hashSync(sifre, 10);
      await pool
        .request()
        .input('adSoyad', adSoyad)
        .input('telefon', telefon)
        .input('vergiNo', vergiNo)
        .input('cariKodu', match.cariKodu)
        .input('cariAdi', match.cariAdi)
        .input('passwordHash', passwordHash)
        .query(`
          INSERT INTO ${absupport.CUSTOMERS_TABLE}
            (AdSoyad, Telefon, VergiNo, CariKodu, CariAdi, PasswordHash, KvkkOnayTarihi, CreatedAt)
          VALUES
            (@adSoyad, @telefon, @vergiNo, @cariKodu, @cariAdi, @passwordHash, SYSDATETIME(), SYSDATETIME())
        `);

      res.json({ ok: true, cariKodu: match.cariKodu, cariAdi: match.cariAdi, adSoyad, telefon });
    } finally {
      await pool.close();
    }
  } catch (err) {
    console.error('Müşteri kaydı başarısız:', err.message);
    res.status(500).json({ error: 'Kayıt sırasında bir sorun oluştu, lütfen daha sonra tekrar deneyin.' });
  }
});

router.post('/public/customer/login', loginRateLimit, async (req, res) => {
  const telefon = normalizePhone(req.body && req.body.telefon);
  const sifre = String((req.body && req.body.sifre) || '');
  if (!telefon || !sifre) {
    return res.status(400).json({ error: 'Telefon ve şifre gerekli.' });
  }

  try {
    await absupport.ensureCustomersTable();
    const pool = await absupport.connect();
    try {
      const customer = await findCustomerByPhone(pool, telefon);
      if (!customer || !bcrypt.compareSync(sifre, customer.PasswordHash)) {
        return res.status(401).json({ error: 'Telefon numarası veya şifre hatalı.' });
      }
      res.json({
        ok: true,
        cariKodu: customer.CariKodu,
        cariAdi: customer.CariAdi,
        adSoyad: customer.AdSoyad,
        telefon: customer.Telefon,
      });
    } finally {
      await pool.close();
    }
  } catch (err) {
    console.error('Müşteri girişi başarısız:', err.message);
    res.status(500).json({ error: 'Şu anda giriş yapılamıyor, lütfen daha sonra tekrar deneyin.' });
  }
});

// Sifremi unuttum: hesabin varligini/yoklugunu ele vermemek icin eslesse de
// eslesmese de ayni yaniti doner.
router.post('/public/customer/forgot', forgotRateLimit, async (req, res) => {
  const telefon = normalizePhone(req.body && req.body.telefon);
  const vergiNo = normalizeDigits(req.body && req.body.vergiNo);
  if (!telefon || !vergiNo) {
    return res.status(400).json({ error: 'Telefon ve vergi numarası gerekli.' });
  }

  try {
    await absupport.ensureCustomersTable();
    const pool = await absupport.connect();
    let customer;
    try {
      customer = await findCustomerByPhone(pool, telefon);
    } finally {
      await pool.close();
    }
    if (!customer || normalizeDigits(customer.VergiNo) !== vergiNo) {
      return res.json({ ok: true });
    }

    const recent = db
      .prepare("SELECT COUNT(*) AS c FROM customer_password_resets WHERE telefon = ? AND created_at > datetime('now', '-60 minutes')")
      .get(telefon).c;
    if (recent >= RESET_MAX_REQUESTS_PER_HOUR) return res.json({ ok: true });

    db.prepare('UPDATE customer_password_resets SET used = 1 WHERE telefon = ? AND used = 0').run(telefon);
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const salt = crypto.randomBytes(8).toString('hex');
    const info = db
      .prepare(`INSERT INTO customer_password_resets (telefon, code_hash, salt, expires_at) VALUES (?, ?, ?, datetime('now', '+${RESET_TTL_MINUTES} minutes'))`)
      .run(telefon, hashResetCode(code, salt), salt);

    try {
      await telegram.sendMessage(
        `🔑 Şifre sıfırlama talebi\n` +
          `Firma: ${customer.CariAdi}\n` +
          `Ad soyad: ${customer.AdSoyad}\n` +
          `Telefon: +${customer.Telefon}\n` +
          `Kod: ${code}  (${RESET_TTL_MINUTES} dk geçerli, tek kullanımlık)\n\n` +
          `Kodu vermeden önce müşteriyi KAYITLI numarasından geri arayıp kimliğini doğrulayın.`
      );
    } catch (err) {
      console.error('Şifre sıfırlama bildirimi gönderilemedi:', err.message);
      db.prepare('UPDATE customer_password_resets SET used = 1 WHERE id = ?').run(info.lastInsertRowid);
      return res.status(500).json({ error: 'Şu anda sıfırlama isteği iletilemiyor. Lütfen destek hattımızı arayın.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Şifre sıfırlama isteği başarısız:', err.message);
    res.status(500).json({ error: 'Şu anda bu işlem yapılamıyor, lütfen daha sonra tekrar deneyin.' });
  }
});

router.post('/public/customer/reset', resetRateLimit, async (req, res) => {
  const telefon = normalizePhone(req.body && req.body.telefon);
  const kod = normalizeDigits(req.body && req.body.kod);
  const yeniSifre = String((req.body && req.body.yeniSifre) || '');
  if (!telefon || kod.length !== 6 || !yeniSifre) {
    return res.status(400).json({ error: 'Kod (6 hane) ve yeni şifre gerekli.' });
  }
  if (yeniSifre.length < 6) {
    return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı.' });
  }
  const fail = () => res.status(400).json({ error: 'Kod hatalı veya süresi dolmuş.' });

  try {
    const row = db
      .prepare("SELECT * FROM customer_password_resets WHERE telefon = ? AND used = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1")
      .get(telefon);
    if (!row) return fail();

    const attempts = row.attempts + 1;
    db.prepare('UPDATE customer_password_resets SET attempts = ?, used = ? WHERE id = ?').run(
      attempts,
      attempts >= RESET_MAX_ATTEMPTS ? 1 : 0,
      row.id
    );
    if (row.attempts >= RESET_MAX_ATTEMPTS) return fail();

    const given = Buffer.from(hashResetCode(kod, row.salt));
    const stored = Buffer.from(row.code_hash);
    if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) return fail();

    await absupport.ensureCustomersTable();
    const pool = await absupport.connect();
    try {
      await pool
        .request()
        .input('telefon', telefon)
        .input('passwordHash', bcrypt.hashSync(yeniSifre, 10))
        .query(`UPDATE ${absupport.CUSTOMERS_TABLE} SET PasswordHash = @passwordHash WHERE Telefon = @telefon`);
    } finally {
      await pool.close();
    }
    db.prepare('UPDATE customer_password_resets SET used = 1 WHERE id = ?').run(row.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Şifre sıfırlama başarısız:', err.message);
    res.status(500).json({ error: 'Şu anda bu işlem yapılamıyor, lütfen daha sonra tekrar deneyin.' });
  }
});

module.exports = router;
