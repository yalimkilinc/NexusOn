// NexusOn Admin Panel - sunucu.
//
// Ucretsiz bilesenler: Express, better-sqlite3 (yerel dosya, ayri DB sunucusu
// gerekmez), bcryptjs, express-session, multer. Kendi bilgisayarinizda ya da
// sabit/tek seferlik ucretli kucuk bir VPS'te calisir; kullanim basina ucret yok.

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const tls = require('tls');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const cron = require('node-cron');

require('./db'); // ilk calistirmada tablolari + admin kullaniciyi olusturur

const authRoutes = require('./routes/auth');
const { router: contentRoutes, UPLOADS_DIR } = require('./routes/content');
const buildRoutes = require('./routes/build');
const { router: agentRoutes } = require('./routes/agents');
const ticketRoutes = require('./routes/tickets');
const v3Routes = require('./routes/v3');
const emailRoutes = require('./routes/email');
const telegramRoutes = require('./routes/telegram');
const connectionRoutes = require('./routes/connection');
const customerAuthRoutes = require('./routes/customerAuth');
const { runWeeklyCustomerSummary } = require('./weeklySummary');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

const app = express();

// NexusOn masaustu uygulamasi file:// kaynagindan istek atar (Origin: null
// olarak gelir), bu yuzden CORS'u herkese aciyoruz. ONEMLI (guvenlik
// duzeltmesi): credentials:true + origin:true (her origin'i yansitma)
// birlikte kullanildiginda, teoride kimlik bilgili (cerezli) capraz-kaynak
// isteklere izin verir - ama buna gercekte HICBIR sey ihtiyac duymuyor:
// NexusOn masaustu uygulamasi zaten cerez degil Authorization: Bearer
// token kullaniyor (bkz. renderer.js yorumu), admin panelin kendi oturum
// cerezi ise SADECE ayni kaynaktan (dashboard.html'in kendisi) geldigi icin
// tarayici CORS'u hic devreye sokmuyor. Yani credentials:true saf bir risk,
// hicbir islevsel faydasi yoktu - kapatildi.
app.use(cors({ origin: true, credentials: false }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'nexusgo-admin-panel-local-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 saat
  })
);

app.use('/uploads', express.static(UPLOADS_DIR));

// Eskiden numaralı adlarla (ör. NexusGo-Setup-1.0.15.exe, ya da "stable" ad
// degisikligi oncesi NexusGo-Setup.exe) paylasilmis linkler (Telegram mesaji,
// e-posta, taraycı geçmişi) hala erisilebilir kalirsa musteri yanlislikla
// eski bir surumu kurabilir. Indirilenler klasorundeki GUNCEL sabit dosya
// adi (STABLE_EXE_NAME, bkz. routes/build.js) DISINDAKI her .exe istegini
// her zaman guncel kuruluma yonlendiriyoruz - gelecekte adı değişse bile.
const CURRENT_EXE_NAMES = ['NexusOn-Setup.exe', 'NexusOn-Personel-Setup.exe'];
app.use('/download', (req, res, next) => {
  const requested = path.basename(req.path);
  if (/\.exe$/i.test(requested) && !CURRENT_EXE_NAMES.includes(requested)) {
    return res.redirect(302, '/download/NexusOn-Setup.exe');
  }
  next();
});
app.use('/download', express.static(path.join(__dirname, 'downloads')));
app.use('/api', authRoutes);
app.use('/api', contentRoutes);
app.use('/api', buildRoutes);
app.use('/api', agentRoutes);
app.use('/api', ticketRoutes);
app.use('/api', v3Routes);
app.use('/api', emailRoutes);
app.use('/api', telegramRoutes);
app.use('/api', connectionRoutes);
app.use('/api', customerAuthRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

// Ana adrese gidenleri dogrudan giris sayfasina yonlendir.
app.get('/', (_req, res) => res.redirect('/login.html'));

// SSL_CERT_PATH/SSL_KEY_PATH verilmisse guvenli (https://) calisir, yoksa
// duz http:// ile (yerel gelistirme icin) calismaya devam eder.
const certPath = process.env.SSL_CERT_PATH;
const keyPath = process.env.SSL_KEY_PATH;
const useTls = certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath);

// Eski (nexusgo.abyazilim.com.tr) ve yeni (nexuson.abyazilim.com.tr) domain
// AYNI portta AYNI sunucudan calisiyor - istemcinin hangi hostname'e
// baglandigina (SNI) gore dogru sertifikayi secmemiz gerekiyor, yoksa biri
// digerinin sertifikasini gorup TLS hatasi alir. SSL_SNI_MAP_PATH (opsiyonel)
// {"hostname": {"cert": "...", "key": "..."}} seklinde bir JSON dosyasi -
// verilmezse eski davranis (tek sertifika) degismeden calismaya devam eder.
let sniContexts = null;
const sniMapPath = process.env.SSL_SNI_MAP_PATH;
if (sniMapPath && fs.existsSync(sniMapPath)) {
  const map = JSON.parse(fs.readFileSync(sniMapPath, 'utf8'));
  sniContexts = new Map();
  for (const [hostname, paths] of Object.entries(map)) {
    sniContexts.set(
      hostname,
      tls.createSecureContext({ cert: fs.readFileSync(paths.cert), key: fs.readFileSync(paths.key) })
    );
  }
}

const server = useTls
  ? https.createServer(
      {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
        ...(sniContexts && {
          SNICallback: (servername, cb) => cb(null, sniContexts.get(servername)),
        }),
      },
      app
    )
  : http.createServer(app);

server.listen(PORT, () => {
  console.log(`NexusOn Admin Panel çalışıyor: ${useTls ? 'https' : 'http'}://localhost:${PORT}`);
});

// Her Pazartesi 08:00'de haftalik musteri ozetini gonderir (ayarlarda
// acikken). Sunucu saat dilimi baz alinir.
cron.schedule('0 8 * * 1', () => {
  runWeeklyCustomerSummary()
    .then((r) => console.log('Haftalık müşteri özeti çalıştı:', JSON.stringify(r)))
    .catch((err) => console.error('Haftalık müşteri özeti hatası:', err.message));
});
