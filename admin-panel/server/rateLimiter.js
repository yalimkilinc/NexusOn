// Basit, bellek-ici IP bazli hiz sinirlayici. Bu uygulamanin olcegi icin
// (tek sunucu, Redis gibi harici bir depo gerektirmeyecek kadar kucuk)
// yeterli - sifre/kod deneme uclarinda kaba kuvvet saldirilarini pratikte
// imkansiz hale getirmek amacli (mukemmel/kriptografik bir savunma degil,
// maliyeti makul olcude yukseltmek yeterli).

function createRateLimiter({ windowMs, max }) {
  const hits = new Map(); // ip -> { count, windowStart }

  // Bellek sizintisini onlemek icin eski kayitlari periyodik temizle.
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) {
      if (now - entry.windowStart > windowMs) hits.delete(ip);
    }
  }, windowMs).unref();

  return function rateLimit(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || 'bilinmeyen';
    const now = Date.now();
    let entry = hits.get(ip);
    if (!entry || now - entry.windowStart > windowMs) {
      entry = { count: 0, windowStart: now };
      hits.set(ip, entry);
    }
    entry.count++;
    if (entry.count > max) {
      return res.status(429).json({ error: 'Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.' });
    }
    next();
  };
}

module.exports = { createRateLimiter };
