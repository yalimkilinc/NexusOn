const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { requireAuth, requireFullAdmin } = require('../middleware');

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `slide-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  limits: { fileSize: 40 * 1024 * 1024 }, // 40 MB (kisa video loop'lari icin)
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else if (/^video\/(mp4|webm)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Sadece resim veya video dosyası yükleyebilirsiniz.'));
  },
});

function toPublicSlide(row, req) {
  const mediaUrl = row.image_filename
    ? `${req.protocol}://${req.get('host')}/uploads/${row.image_filename}`
    : null;
  return {
    id: row.id,
    text: row.text,
    mediaType: row.media_type || 'image',
    mediaUrl,
    imageUrl: row.media_type === 'video' ? null : mediaUrl, // eski istemcilerle geriye donuk uyumluluk
  };
}

// --------------------------- Herkese acik (NexusOn uygulamasi bunu cagirir) ---------------------------

router.get('/public/content', (req, res) => {
  const slides = db.prepare('SELECT * FROM slides ORDER BY sort_order ASC, id ASC').all();
  const news = db.prepare('SELECT text FROM news_items ORDER BY sort_order ASC, id ASC').all();

  // Her basarili "Yeni Kurulum Uret" sonrasi build.js tarafindan yazilir.
  // Yoksa (henuz hic derleme yapilmamissa) surum bilgisi olmadan devam eder.
  let latestVersion = null;
  try {
    const versionInfo = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'downloads', 'version.json'), 'utf8')
    );
    latestVersion = versionInfo.version;
  } catch {
    // henuz version.json yok, sorun degil
  }

  // Personel kurulumu (bkz. app/variant.js, package.json "dist:staff") ayri
  // bir .exe olarak yayinlanir - musteri kurulumu kendi guncellemesini
  // isterken yanlislikla personel .exe'sini (ya da tam tersini) indirmesin
  // diye uygulama ?variant=staff|customer gonderir. Ikisi de AYNI surumde
  // birlikte derlenip yayinlandigi icin surum bilgisi (version.json) ortak.
  const variant = req.query.variant === 'staff' ? 'staff' : 'customer';
  const exeName = variant === 'staff' ? 'NexusOn-Personel-Setup.exe' : 'NexusOn-Setup.exe';

  res.json({
    slides: slides.map((s) => toPublicSlide(s, req)),
    news: news.map((n) => n.text),
    latestVersion,
    downloadUrl: `${req.protocol}://${req.get('host')}/download/${exeName}`,
  });
});

// --------------------------- Admin: slaytlar ---------------------------

router.get('/admin/slides', requireAuth, requireFullAdmin, (req, res) => {
  const slides = db.prepare('SELECT * FROM slides ORDER BY sort_order ASC, id ASC').all();
  res.json(slides.map((s) => toPublicSlide(s, req)));
});

router.post('/admin/slides', requireAuth, requireFullAdmin, upload.single('image'), (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Başlık metni gerekli.' });

  const mediaType = req.file && req.file.mimetype.startsWith('video/') ? 'video' : 'image';
  const maxOrder = db.prepare('SELECT MAX(sort_order) AS m FROM slides').get().m || 0;
  const info = db
    .prepare('INSERT INTO slides (text, image_filename, media_type, sort_order) VALUES (?, ?, ?, ?)')
    .run(text, req.file ? req.file.filename : null, mediaType, maxOrder + 1);

  const row = db.prepare('SELECT * FROM slides WHERE id = ?').get(info.lastInsertRowid);
  res.json(toPublicSlide(row, req));
});

router.put('/admin/slides/:id', requireAuth, requireFullAdmin, upload.single('image'), (req, res) => {
  const row = db.prepare('SELECT * FROM slides WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Bulunamadı.' });

  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Başlık metni gerekli.' });

  let imageFilename = row.image_filename;
  let mediaType = row.media_type;
  if (req.file) {
    if (row.image_filename) {
      fs.unlink(path.join(UPLOADS_DIR, row.image_filename), () => {}); // eski dosya silinmezse bile devam et
    }
    imageFilename = req.file.filename;
    mediaType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
  }

  db.prepare('UPDATE slides SET text = ?, image_filename = ?, media_type = ? WHERE id = ?')
    .run(text, imageFilename, mediaType, req.params.id);

  const updated = db.prepare('SELECT * FROM slides WHERE id = ?').get(req.params.id);
  res.json(toPublicSlide(updated, req));
});

router.delete('/admin/slides/:id', requireAuth, requireFullAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM slides WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Bulunamadı.' });

  if (row.image_filename) {
    const filePath = path.join(UPLOADS_DIR, row.image_filename);
    fs.unlink(filePath, () => {}); // dosya silinmezse bile devam et
  }
  db.prepare('DELETE FROM slides WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --------------------------- Admin: duyuru/haber metinleri ---------------------------

router.get('/admin/news', requireAuth, requireFullAdmin, (req, res) => {
  const news = db.prepare('SELECT * FROM news_items ORDER BY sort_order ASC, id ASC').all();
  res.json(news);
});

router.post('/admin/news', requireAuth, requireFullAdmin, (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Duyuru metni boş olamaz.' });

  const maxOrder = db.prepare('SELECT MAX(sort_order) AS m FROM news_items').get().m || 0;
  const info = db
    .prepare('INSERT INTO news_items (text, sort_order) VALUES (?, ?)')
    .run(text, maxOrder + 1);

  res.json(db.prepare('SELECT * FROM news_items WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/admin/news/:id', requireAuth, requireFullAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM news_items WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Bulunamadı.' });
  res.json({ ok: true });
});

module.exports = { router, UPLOADS_DIR };
