// NexusOn Admin Panel - veritabani katmani.
//
// SQLite kullanilir: ayri bir veritabani sunucusu gerekmez, tek bir dosyada
// (data.sqlite) saklanir. Node.js'in kendi icine gomulu node:sqlite modulu
// kullaniliyor (Node 22.5+), boylece ayri bir native paket / derleme araci
// (Python, Visual Studio Build Tools) gerekmez.

const path = require('path');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.join(__dirname, 'data.sqlite'));
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS slides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    image_filename TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS news_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL, -- "Kullanici Kodu": personelin giris yaptigi kod
    full_name TEXT,                -- "Kullanici Adi": kisinin gercek adi (goruntuleme icin)
    phone TEXT,
    email TEXT,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER,
    agent_username TEXT NOT NULL,
    room_code TEXT NOT NULL,
    cari_kodu TEXT,
    cari_adi TEXT,
    category TEXT,
    note TEXT,
    customer_note TEXT,
    status TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    duration_seconds INTEGER
  );

  -- Musteri, kod uretirken "ne icin destek istiyor" notunu buraya birakir.
  -- Personel baglanip bilet olusturunca bu not otomatik oraya tasinir ve silinir.
  CREATE TABLE IF NOT EXISTS room_notes (
    room_code TEXT PRIMARY KEY,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Nebim V3 (Microsoft SQL Server) baglanti ayarlari. Tek satirlik (id=1)
  -- basit bir ayar tablosu; sifre bu dosyada (sunucu tarafinda) durur,
  -- koda hic gomulmez.
  CREATE TABLE IF NOT EXISTS v3_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    host TEXT,
    port INTEGER,
    database_name TEXT,
    username TEXT,
    password TEXT,
    cari_table TEXT,
    updated_at TEXT
  );

  -- Bilet kapanislarinda yetkililere bilgilendirme maili atmak icin SMTP
  -- ayarlari. Sifre bu dosyada (sunucu tarafinda) durur, koda gomulmez.
  CREATE TABLE IF NOT EXISTS email_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    smtp_host TEXT,
    smtp_port INTEGER,
    smtp_secure INTEGER DEFAULT 0,
    smtp_user TEXT,
    smtp_password TEXT,
    from_address TEXT,
    recipients TEXT,
    weekly_summary_enabled INTEGER DEFAULT 0,
    updated_at TEXT
  );

  -- Musteri "Baglanti Talebi Ilet" ile firma adi girip talep gonderdiginde
  -- destek ekibine Telegram bildirimi atmak icin bot ayarlari. Token bu
  -- dosyada (sunucu tarafinda) durur, koda hic gomulmez.
  CREATE TABLE IF NOT EXISTS telegram_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    bot_token TEXT,
    chat_id TEXT,
    updated_at TEXT
  );

  -- "Baglanti Talebi Ilet" ile gelen ve V3'te eslesen musteri talepleri
  -- burada gecici olarak tutulur. Destek personeli musteriyi (cari) secince
  -- NexusOn uygulamasi buradan cariKodu ile eslesen bir talep var mi diye
  -- sorar ve varsa kodu otomatik doldurur. Kullanilinca (ya da 30 dk sonra)
  -- silinir.
  CREATE TABLE IF NOT EXISTS pending_connection_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cari_kodu TEXT NOT NULL,
    cari_adi TEXT,
    room_code TEXT NOT NULL,
    telegram_message_id TEXT,
    telegram_chat_id TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Var olan (eski) pending_connection_requests tablosunda telegram_message_id/
// telegram_chat_id/note sutunlari olmayabilir (personel baglaninca Telegram
// mesajinin durumunu guncelleyebilmek icin sonradan eklendi).
for (const col of ['telegram_message_id', 'telegram_chat_id', 'note']) {
  const cols = db.prepare('PRAGMA table_info(pending_connection_requests)').all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE pending_connection_requests ADD COLUMN ${col} TEXT`);
}

// Var olan (eski) veritabani dosyalarinda tickets tablosu cari_kodu/cari_adi
// sutunlari olmadan olusturulmus olabilir; sonradan ekle.
for (const col of ['cari_kodu', 'cari_adi']) {
  const cols = db.prepare('PRAGMA table_info(tickets)').all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE tickets ADD COLUMN ${col} TEXT`);
}

// Var olan (eski) email_settings tablosunda weekly_summary_enabled sutunu
// olmayabilir; sonradan ekle.
{
  const cols = db.prepare('PRAGMA table_info(email_settings)').all().map((c) => c.name);
  if (!cols.includes('weekly_summary_enabled')) {
    db.exec('ALTER TABLE email_settings ADD COLUMN weekly_summary_enabled INTEGER DEFAULT 0');
  }
}

// Var olan (eski) agents tablosunda full_name/phone/email sutunlari
// olmayabilir; sonradan ekle.
for (const col of ['full_name', 'phone', 'email']) {
  const cols = db.prepare('PRAGMA table_info(agents)').all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE agents ADD COLUMN ${col} TEXT`);
}

// Var olan (eski) veritabani dosyalarinda tickets tablosu customer_note
// sutunu olmadan olusturulmus olabilir; sonradan ekle.
const ticketColumns = db.prepare('PRAGMA table_info(tickets)').all().map((c) => c.name);
if (!ticketColumns.includes('customer_note')) {
  db.exec('ALTER TABLE tickets ADD COLUMN customer_note TEXT');
}

// Var olan (eski) slides tablosunda media_type sutunu olmayabilir; sonradan
// ekle. Bu sutun olmadan yuklenmis eski kayitlarin hepsi gorsel oldugundan
// varsayilan 'image' degeri dogru davranisi korur.
{
  const cols = db.prepare('PRAGMA table_info(slides)').all().map((c) => c.name);
  if (!cols.includes('media_type')) {
    db.exec("ALTER TABLE slides ADD COLUMN media_type TEXT NOT NULL DEFAULT 'image'");
  }
}

// Ilk calistirmada admin kullanicisi yoksa olustur.
// Uretimde mutlaka ADMIN_USERNAME / ADMIN_PASSWORD ortam degiskenleriyle degistirin.
const adminCount = db.prepare('SELECT COUNT(*) AS c FROM admins').get().c;
if (adminCount === 0) {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, hash);
  console.log(`[NexusOn Admin] İlk admin kullanıcısı oluşturuldu -> kullanıcı adı: "${username}", şifre: "${password}"`);
  console.log('[NexusOn Admin] UYARI: Üretimde bu varsayılan şifreyi mutlaka değiştirin (ADMIN_PASSWORD ortam değişkeni ile).');
}

// Baslangicta hic haber/duyuru yoksa ornek birkac tane ekle (bos ekran gorunmesin).
const newsCount = db.prepare('SELECT COUNT(*) AS c FROM news_items').get().c;
if (newsCount === 0) {
  const insert = db.prepare('INSERT INTO news_items (text, sort_order) VALUES (?, ?)');
  insert.run('NexusOn ile uzaktan destek artık çok daha hızlı.', 0);
  insert.run('Destek ekibimiz hafta içi 09:00–18:00 arası hizmet vermektedir.', 1);
}

module.exports = db;
