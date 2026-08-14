// Destek personeli (ajan) oturum anahtarlari. Cerez yerine token kullaniyoruz
// cunku NexusOn uygulamasi (file://) ile bu sunucu (http://) FARKLI kaynaklar
// sayilir; modern taraycilar boyle durumlarda cerezleri kisitlar/engeller.
// Basit bellek-ici (in-memory) saklama yeterli: sunucu yeniden baslarsa
// personelin tekrar giris yapmasi gerekir, bu kabul edilebilir bir durum.

const crypto = require('crypto');

const tokens = new Map(); // token -> { agentId, username }

function createToken(agentId, username) {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { agentId, username });
  return token;
}

function verifyToken(token) {
  return tokens.get(token) || null;
}

function revokeToken(token) {
  tokens.delete(token);
}

module.exports = { createToken, verifyToken, revokeToken };
