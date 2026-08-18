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

const express = require('express');
const bcrypt = require('bcryptjs');
const v3db = require('../v3db');
const absupport = require('../absupport');
const { createRateLimiter } = require('../rateLimiter');

const router = express.Router();

// Herkese acik (girissiz) uclar - kaba kuvvet/kotuye kullanima karsi.
const checkPhoneRateLimit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });
const registerRateLimit = createRateLimiter({ windowMs: 30 * 60 * 1000, max: 5 });
const loginRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

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

module.exports = router;
