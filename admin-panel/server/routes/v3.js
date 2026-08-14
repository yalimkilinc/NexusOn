// Nebim V3 baglanti ayarlari ve sema kesif ucu (yalnizca admin) + ajanlarin
// baglanmadan once musteri aramasi icin kullandigi uc.

const express = require('express');
const sql = require('mssql');
const { requireAuth, requireAgentToken } = require('../middleware');
const v3db = require('../v3db');

const router = express.Router();

// --------------------------- Ajan: musteri (cari) arama ---------------------------
//
// Destek personeli, baglanmadan once musterinin V3'teki cari kaydini secer.
// CurrAccTypeCode = 3 olanlar "hizmet verilebilecek musteriler"dir (musteri
// tarafindan dogrulandi). Kod araligi ortamdan ortama degisebildigi icin
// sabit bir on-ek FILTRESI KOYULMADI.

router.get('/agent/v3-customers', requireAgentToken, async (req, res) => {
  const search = String(req.query.search || '').trim();
  if (search.length < 2) return res.json([]);

  let pool;
  try {
    pool = await v3db.connect();
    const result = await pool
      .request()
      .input('search', sql.NVarChar, `%${search}%`)
      .query(`
        SELECT TOP 30 CurrAccCode, CurrAccDescription
        FROM cdCurrAccDesc
        WHERE CurrAccTypeCode = 3
          AND (CurrAccCode LIKE @search OR CurrAccDescription LIKE @search)
        ORDER BY CurrAccDescription
      `);
    res.json(result.recordset.map((r) => ({ cariKodu: r.CurrAccCode, cariAdi: r.CurrAccDescription })));
  } catch (err) {
    res.status(400).json({ error: 'Müşteri araması yapılamadı: ' + err.message });
  } finally {
    if (pool) await pool.close().catch(() => {});
  }
});

router.get('/admin/v3-settings', requireAuth, (_req, res) => {
  const s = v3db.getSettings();
  if (!s) return res.json(null);
  // Sifreyi oldugu gibi geri gondermiyoruz, sadece "ayarlanmis mi" bilgisini veriyoruz.
  res.json({
    host: s.host,
    port: s.port,
    databaseName: s.database_name,
    username: s.username,
    hasPassword: !!s.password,
    cariTable: s.cari_table,
    updatedAt: s.updated_at,
  });
});

router.post('/admin/v3-settings', requireAuth, (req, res) => {
  const { host, port, databaseName, username, password, cariTable } = req.body || {};
  if (!host || !databaseName || !username) {
    return res.status(400).json({ error: 'Sunucu adresi, veritabanı adı ve kullanıcı adı gerekli.' });
  }
  const saved = v3db.saveSettings({ host, port: Number(port) || 1433, databaseName, username, password, cariTable });
  res.json({ ok: true, updatedAt: saved.updated_at });
});

router.post('/admin/v3-settings/test', requireAuth, async (_req, res) => {
  try {
    const pool = await v3db.connect();
    await pool.request().query('SELECT 1 AS ok');
    await pool.close();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Cari tablosunu birlikte bulabilmek icin: veritabanindaki tum tablolari listele.
router.get('/admin/v3-settings/tables', requireAuth, async (_req, res) => {
  let pool;
  try {
    pool = await v3db.connect();
    const result = await pool.request().query(`
      SELECT TABLE_SCHEMA, TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    if (pool) await pool.close().catch(() => {});
  }
});

// Secilen bir tablonun sutunlarini listele (cari tablosunu dogrulamak icin).
router.get('/admin/v3-settings/columns', requireAuth, async (req, res) => {
  const table = String(req.query.table || '').trim();
  if (!table) return res.status(400).json({ error: 'Tablo adı gerekli.' });

  let pool;
  try {
    pool = await v3db.connect();
    const result = await pool
      .request()
      .input('table', table)
      .query(`
        SELECT COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @table
        ORDER BY ORDINAL_POSITION
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    if (pool) await pool.close().catch(() => {});
  }
});

// Bir tablodan birkac ornek satir getir (gercek veriyi gormek icin).
// Tablo adi SQL sorgusuna doğrudan eklenecegi icin (T-SQL tablo adlarini
// parametre olarak vermeye izin vermez) siki bir bicim dogrulamasi yapiyoruz.
const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;

router.get('/admin/v3-settings/preview', requireAuth, async (req, res) => {
  const table = String(req.query.table || '').trim();
  if (!SAFE_IDENTIFIER.test(table)) {
    return res.status(400).json({ error: 'Geçersiz tablo adı.' });
  }

  let pool;
  try {
    pool = await v3db.connect();
    const result = await pool.request().query(`SELECT TOP 5 * FROM [${table}]`);
    res.json(result.recordset);
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    if (pool) await pool.close().catch(() => {});
  }
});

// Musterinin verdigi ornek sorguyu dogrulamak icin gecici bir kontrol ucu.
router.get('/admin/v3-settings/cari-check', requireAuth, async (_req, res) => {
  let pool;
  try {
    pool = await v3db.connect();
    const countResult = await pool.request().query(`
      SELECT COUNT(*) AS total FROM cdCurrAccDesc WHERE CurrAccTypeCode = 3
    `);
    const sampleResult = await pool.request().query(`
      SELECT TOP 20 CurrAccCode, CurrAccDescription, LangCode
      FROM cdCurrAccDesc
      WHERE CurrAccTypeCode = 3
      ORDER BY CurrAccDescription
    `);
    res.json({ totalCount: countResult.recordset[0].total, sample: sampleResult.recordset });
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    if (pool) await pool.close().catch(() => {});
  }
});

// Nebim'in kendi tablolarina dokunmadan, V3'un AYNI veritabaninda NexusOn'ya
// ait ayri bir tablo olusturur (yoksa). Idempotent: zaten varsa bir sey yapmaz.
router.post('/admin/v3-settings/setup-table', requireAuth, async (_req, res) => {
  try {
    await v3db.ensureTicketsTable();
    res.json({ ok: true, table: v3db.TICKETS_TABLE });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
