// Nebim V3 (Microsoft SQL Server) baglantisi. Ayarlar admin panelde
// girilip SQLite'ta (v3_settings tablosu) saklanir; burada o ayarlarla
// gecici bir baglanti acilir.

const sql = require('mssql');
const db = require('./db');

// Nebim'in kendi tablolarina hic dokunmuyoruz; NexusOn kendi ayri tablosunu
// V3'un AYNI veritabaninda tutar (musteri "gercekten V3'e yazilsin" istedi).
const TICKETS_TABLE = 'NexusOn_DestekKayitlari';

function getSettings() {
  return db.prepare('SELECT * FROM v3_settings WHERE id = 1').get() || null;
}

function saveSettings({ host, port, databaseName, username, password, cariTable }) {
  const existing = getSettings();
  db.prepare(
    `INSERT INTO v3_settings (id, host, port, database_name, username, password, cari_table, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       host = excluded.host,
       port = excluded.port,
       database_name = excluded.database_name,
       username = excluded.username,
       password = CASE WHEN excluded.password = '' THEN v3_settings.password ELSE excluded.password END,
       cari_table = excluded.cari_table,
       updated_at = excluded.updated_at`
  ).run(
    host,
    port || 1433,
    databaseName,
    username,
    password || '',
    cariTable || null
  );
  return getSettings();
}

async function connect() {
  const s = getSettings();
  if (!s || !s.host || !s.database_name || !s.username) {
    throw new Error('V3 bağlantı ayarları eksik. Önce admin panelden bağlantı bilgilerini girin.');
  }

  const pool = new sql.ConnectionPool({
    server: s.host,
    port: s.port || 1433,
    database: s.database_name,
    user: s.username,
    password: s.password,
    options: {
      encrypt: false, // cogu on-prem SQL Server kurulumunda kapali olur
      trustServerCertificate: true,
    },
    connectionTimeout: 8000,
    requestTimeout: 15000,
  });

  return pool.connect();
}

// Musterinin (cari) V3'teki iletisim kaydindan e-posta adresini bulur.
// CommunicationTypeCode = '3' e-posta turune karsilik gelir (V3 sema kesfiyle
// dogrulandi). Birden fazla kayit varsa en son guncelleneni kullanir.
async function getCustomerEmail(cariKodu) {
  const pool = await connect();
  try {
    const result = await pool
      .request()
      .input('cariKodu', sql.NVarChar, cariKodu)
      .query(`
        SELECT TOP 1 CommAddress
        FROM prCurrAccCommunication
        WHERE CurrAccTypeCode = 3 AND CurrAccCode = @cariKodu AND CommunicationTypeCode = '3'
        ORDER BY LastUpdatedDate DESC
      `);
    return result.recordset[0] ? result.recordset[0].CommAddress : null;
  } finally {
    await pool.close();
  }
}

// Vergi numarasindan cari (musteri) kaydini bulur - NexusOn musteri kayit
// formunda "Vergi Numarasi'ndan firma adi otomatik bulunsun" akisi icin.
// cdCurrAcc tablosu gercek kaynak (TaxNumber sutunu burada), cdCurrAccDesc
// ise goruntulenecek adi (CurrAccDescription) tutuyor - ikisini birlestiriyoruz.
async function findCustomerByTaxNumber(taxNumber) {
  const pool = await connect();
  try {
    const result = await pool
      .request()
      .input('taxNumber', sql.NVarChar, taxNumber)
      .query(`
        SELECT TOP 1 ca.CurrAccCode, cad.CurrAccDescription
        FROM cdCurrAcc ca
        JOIN cdCurrAccDesc cad
          ON cad.CurrAccCode = ca.CurrAccCode AND cad.CurrAccTypeCode = ca.CurrAccTypeCode
        WHERE ca.CurrAccTypeCode = 3 AND ca.TaxNumber = @taxNumber
      `);
    const row = result.recordset[0];
    // CurrAccCode sabit genislikli (CHAR) - kirpiyoruz (bkz. connection.js findCustomer).
    return row ? { cariKodu: row.CurrAccCode.trim(), cariAdi: row.CurrAccDescription } : null;
  } finally {
    await pool.close();
  }
}

async function ensureTicketsTable() {
  const pool = await connect();
  try {
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = '${TICKETS_TABLE}')
      CREATE TABLE ${TICKETS_TABLE} (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        AgentUsername NVARCHAR(100) NOT NULL,
        RoomCode NVARCHAR(20) NOT NULL,
        CariKodu NVARCHAR(50) NULL,
        CariAdi NVARCHAR(255) NULL,
        Category NVARCHAR(50) NULL,
        Status NVARCHAR(50) NULL,
        Note NVARCHAR(MAX) NULL,
        CustomerNote NVARCHAR(MAX) NULL,
        StartedAt DATETIME2 NOT NULL,
        EndedAt DATETIME2 NULL,
        DurationSeconds INT NULL
      )
    `);
  } finally {
    await pool.close();
  }
}

module.exports = { getSettings, saveSettings, connect, ensureTicketsTable, getCustomerEmail, findCustomerByTaxNumber, TICKETS_TABLE };
