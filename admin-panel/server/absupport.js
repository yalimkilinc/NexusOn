// ABSupport (Microsoft SQL Server) - NexusOn musteri kayit/giris bilgilerini
// burada tutuyoruz. AYNI VPS/SQL Server sunucusu, V3 ile AYNI giris bilgileri
// (v3_settings tablosundaki host/kullanici/sifre paylasilir) ama FARKLI bir
// veritabaninda (ABSupport, baska bir Ab Yazilim uygulamasi tarafindan zaten
// kullaniliyor) - tablolarimiz NexusOn_ on ekiyle o uygulamanin tablolariyla
// CAKISMAZ.

const sql = require('mssql');
const db = require('./db');

const DATABASE_NAME = 'ABSupport';
const CUSTOMERS_TABLE = 'NexusOn_Musteriler';

function getConnectionBase() {
  return db.prepare('SELECT host, port, username, password FROM v3_settings WHERE id = 1').get();
}

async function connect() {
  const s = getConnectionBase();
  if (!s || !s.host || !s.username) {
    throw new Error('SQL Server bağlantı ayarları eksik (V3 ayarlarıyla paylaşılıyor, önce admin panelden V3 bağlantısını kurun).');
  }
  const pool = new sql.ConnectionPool({
    server: s.host,
    port: s.port || 1433,
    database: DATABASE_NAME,
    user: s.username,
    password: s.password,
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 8000,
    requestTimeout: 15000,
  });
  return pool.connect();
}

async function ensureCustomersTable() {
  const pool = await connect();
  try {
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = '${CUSTOMERS_TABLE}')
      CREATE TABLE ${CUSTOMERS_TABLE} (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        AdSoyad NVARCHAR(200) NOT NULL,
        Telefon NVARCHAR(30) NOT NULL,
        VergiNo NVARCHAR(20) NOT NULL,
        CariKodu NVARCHAR(50) NULL,
        CariAdi NVARCHAR(255) NULL,
        PasswordHash NVARCHAR(255) NOT NULL,
        KvkkOnayTarihi DATETIME2 NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT UQ_NexusOn_Musteriler_Telefon UNIQUE (Telefon)
      )
    `);
  } finally {
    await pool.close();
  }
}

module.exports = { connect, ensureCustomersTable, CUSTOMERS_TABLE, DATABASE_NAME };
