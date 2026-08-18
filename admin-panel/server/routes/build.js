// "Yeni Kurulum Üret" ozelligi: panelden tek tikla NexusOn'nun .exe kurulum
// dosyasini yeniden derler (electron-builder'i cagirir). Bunun calismasi icin
// bu panelin BIR WINDOWS makinede calisiyor olmasi gerekir (Linux'ta calismaz).
//
// Iki ayri varyant var: musteri (herkese acik indirme linki) ve personel
// ("Destek Vermek Icin" rolunu de iceren, ayri kurulum dosyasi - bkz.
// app/variant.js). Ikisi ayri butonlarla, birbirinden bagimsiz derlenir.

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { requireAuth, requireFullAdmin } = require('../middleware');

const router = express.Router();

const APP_DIR = path.join(__dirname, '..', '..', '..', 'app');
const DIST_DIR = path.join(APP_DIR, 'dist');

// Uretilen kurulum dosyalari buraya sabit bir adla kopyalanir, boylece
// musterilere/personele hep ayni, degismeyen bir indirme linki verilebilir
// (/download/NexusOn-Setup.exe, /download/NexusOn-Personel-Setup.exe) - her
// yeni derlemede link degismez.
const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const VARIANTS = {
  customer: { npmScript: 'dist', stableExeName: 'NexusOn-Setup.exe', matchesFile: (f) => !f.includes('Personel') },
  staff: { npmScript: 'dist:staff', stableExeName: 'NexusOn-Personel-Setup.exe', matchesFile: (f) => f.includes('Personel') },
};

const buildStates = {
  customer: { status: 'idle', log: '', startedAt: null, finishedAt: null, exeFile: null },
  staff: { status: 'idle', log: '', startedAt: null, finishedAt: null, exeFile: null },
};

function findLatestExe(variant) {
  if (!fs.existsSync(DIST_DIR)) return null;
  const cfg = VARIANTS[variant];
  const exeFiles = fs
    .readdirSync(DIST_DIR)
    .filter((f) => f.endsWith('.exe'))
    .filter(cfg.matchesFile)
    .map((f) => ({ f, t: fs.statSync(path.join(DIST_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return exeFiles.length ? exeFiles[0].f : null;
}

// Uygulamanin kendisi acilista bu bilgiyi okuyup yeni surum var mi kontrol
// eder. Dosya olarak yaziliyor (VPS'te app/ kaynak kodu olmadigindan orada
// package.json'a erisilemez, ama bu dosya her derlemede indirilenler
// klasorune yazilip sunucuya da elle kopyalaniyor). Musteri ve personel
// kurulumlari AYNI surumde derlendigi icin surum bilgisi ortak.
function writeVersionInfo() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
    fs.writeFileSync(
      path.join(DOWNLOADS_DIR, 'version.json'),
      JSON.stringify({ version: pkg.version, releasedAt: new Date().toISOString() })
    );
  } catch (err) {
    console.error('version.json yazilamadi:', err.message);
  }
}

function startBuild(variant, res) {
  const cfg = VARIANTS[variant];
  const state = buildStates[variant];

  if (state.status === 'running') {
    return res.status(409).json({ error: 'Zaten devam eden bir derleme var.' });
  }

  if (!fs.existsSync(APP_DIR)) {
    return res.status(400).json({
      error:
        'Bu özellik bu sunucuda kullanılamaz: "app" kaynak kodu burada bulunmuyor. ' +
        'Kurulum dosyası üretmek için NexusOn projesinin bulunduğu bilgisayardaki (yerel) admin panelini kullanın.',
    });
  }

  state.status = 'running';
  state.log = '';
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.exeFile = null;

  // Windows'ta npm.cmd'i dogrudan spawn etmek "spawn EINVAL" hatasi verebilir;
  // cmd.exe uzerinden calistirmak guvenilir.
  const isWin = process.platform === 'win32';
  const child = isWin
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm run ${cfg.npmScript}`], { cwd: APP_DIR })
    : spawn('npm', ['run', cfg.npmScript], { cwd: APP_DIR });

  child.stdout.on('data', (d) => { state.log += d.toString(); });
  child.stderr.on('data', (d) => { state.log += d.toString(); });

  child.on('error', (err) => {
    state.status = 'error';
    state.log += `\n[Başlatma hatası] ${err.message}`;
    state.finishedAt = new Date().toISOString();
  });

  child.on('close', (code) => {
    if (code === 0) {
      state.status = 'success';
      state.exeFile = findLatestExe(variant);
      if (state.exeFile) {
        fs.copyFileSync(path.join(DIST_DIR, state.exeFile), path.join(DOWNLOADS_DIR, cfg.stableExeName));
        writeVersionInfo();
      }
    } else {
      state.status = 'error';
    }
    state.finishedAt = new Date().toISOString();
  });

  res.json({ ok: true });
}

router.post('/admin/build/customer', requireAuth, requireFullAdmin, (_req, res) => startBuild('customer', res));
router.post('/admin/build/staff', requireAuth, requireFullAdmin, (_req, res) => startBuild('staff', res));

router.get('/admin/build/customer/status', requireAuth, requireFullAdmin, (_req, res) => res.json(buildStates.customer));
router.get('/admin/build/staff/status', requireAuth, requireFullAdmin, (_req, res) => res.json(buildStates.staff));

router.get('/admin/build/customer/download', requireAuth, requireFullAdmin, (_req, res) => downloadLatest('customer', res));
router.get('/admin/build/staff/download', requireAuth, requireFullAdmin, (_req, res) => downloadLatest('staff', res));

function downloadLatest(variant, res) {
  const state = buildStates[variant];
  if (!state.exeFile) return res.status(404).json({ error: 'Henüz başarılı bir derleme yok.' });
  const filePath = path.join(DIST_DIR, state.exeFile);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Dosya bulunamadı.' });
  res.download(filePath, state.exeFile);
}

module.exports = router;
