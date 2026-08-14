// "Yeni Kurulum Üret" ozelligi: panelden tek tikla NexusOn'nun .exe kurulum
// dosyasini yeniden derler (electron-builder'i cagirir). Bunun calismasi icin
// bu panelin BIR WINDOWS makinede calisiyor olmasi gerekir (Linux'ta calismaz).

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { requireAuth } = require('../middleware');

const router = express.Router();

const APP_DIR = path.join(__dirname, '..', '..', '..', 'app');
const DIST_DIR = path.join(APP_DIR, 'dist');

// Uretilen kurulum dosyasi buraya sabit bir adla kopyalanir, boylece
// musterilere/personele hep ayni, degismeyen bir indirme linki verilebilir
// (/download/NexusOn-Setup.exe) - her yeni derlemede link degismez.
const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
const STABLE_EXE_NAME = 'NexusOn-Setup.exe';
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const buildState = {
  status: 'idle', // idle | running | success | error
  log: '',
  startedAt: null,
  finishedAt: null,
  exeFile: null,
};

router.post('/admin/build', requireAuth, (req, res) => {
  if (buildState.status === 'running') {
    return res.status(409).json({ error: 'Zaten devam eden bir derleme var.' });
  }

  if (!fs.existsSync(APP_DIR)) {
    return res.status(400).json({
      error:
        'Bu özellik bu sunucuda kullanılamaz: "app" kaynak kodu burada bulunmuyor. ' +
        'Kurulum dosyası üretmek için NexusOn projesinin bulunduğu bilgisayardaki (yerel) admin panelini kullanın.',
    });
  }

  buildState.status = 'running';
  buildState.log = '';
  buildState.startedAt = new Date().toISOString();
  buildState.finishedAt = null;
  buildState.exeFile = null;

  // Windows'ta npm.cmd'i dogrudan spawn etmek "spawn EINVAL" hatasi verebilir;
  // cmd.exe uzerinden calistirmak guvenilir.
  const isWin = process.platform === 'win32';
  const child = isWin
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run dist'], { cwd: APP_DIR })
    : spawn('npm', ['run', 'dist'], { cwd: APP_DIR });

  child.stdout.on('data', (d) => { buildState.log += d.toString(); });
  child.stderr.on('data', (d) => { buildState.log += d.toString(); });

  child.on('error', (err) => {
    buildState.status = 'error';
    buildState.log += `\n[Başlatma hatası] ${err.message}`;
    buildState.finishedAt = new Date().toISOString();
  });

  child.on('close', (code) => {
    if (code === 0) {
      buildState.status = 'success';
      buildState.exeFile = findLatestExe();
      if (buildState.exeFile) {
        fs.copyFileSync(path.join(DIST_DIR, buildState.exeFile), path.join(DOWNLOADS_DIR, STABLE_EXE_NAME));
        writeVersionInfo();
      }
    } else {
      buildState.status = 'error';
    }
    buildState.finishedAt = new Date().toISOString();
  });

  res.json({ ok: true });
});

router.get('/admin/build/status', requireAuth, (_req, res) => {
  res.json(buildState);
});

router.get('/admin/build/download', requireAuth, (_req, res) => {
  if (!buildState.exeFile) return res.status(404).json({ error: 'Henüz başarılı bir derleme yok.' });
  const filePath = path.join(DIST_DIR, buildState.exeFile);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Dosya bulunamadı.' });
  res.download(filePath, buildState.exeFile);
});

// Uygulamanin kendisi acilista bu bilgiyi okuyup yeni surum var mi kontrol
// eder. Dosya olarak yaziliyor (VPS'te app/ kaynak kodu olmadigindan orada
// package.json'a erisilemez, ama bu dosya her derlemede indirilenler
// klasorune yazilip sunucuya da elle kopyalaniyor).
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

function findLatestExe() {
  if (!fs.existsSync(DIST_DIR)) return null;
  const exeFiles = fs
    .readdirSync(DIST_DIR)
    .filter((f) => f.endsWith('.exe'))
    .map((f) => ({ f, t: fs.statSync(path.join(DIST_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return exeFiles.length ? exeFiles[0].f : null;
}

module.exports = router;
