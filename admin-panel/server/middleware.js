const { verifyToken } = require('./agentTokens');

function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) return next();
  res.status(401).json({ error: 'Giriş yapmanız gerekiyor.' });
}

// requireAuth'tan SONRA kullanilir: 'destek' rolundeki panel hesaplari sadece
// Destek Kayitlari ve Kurulum Dosyasi (indirme linki) sayfalarina erisebilir;
// geri kalan tum admin route'lari bunu da gerektirir.
function requireFullAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  res.status(403).json({ error: 'Bu işlem için yönetici yetkisi gerekiyor.' });
}

// NexusOn uygulamasi (file://) icin: cerez degil, "Authorization: Bearer <token>"
// basligi kullanilir (capraz-kaynak cerez kisitlamalarindan etkilenmez).
function requireAgentToken(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const agent = token && verifyToken(token);
  if (!agent) return res.status(401).json({ error: 'Ajan girişi yapmanız gerekiyor.' });
  req.agent = agent;
  req.agentToken = token;
  next();
}

module.exports = { requireAuth, requireFullAdmin, requireAgentToken };
