const { verifyToken } = require('./agentTokens');

function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) return next();
  res.status(401).json({ error: 'Giriş yapmanız gerekiyor.' });
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

module.exports = { requireAuth, requireAgentToken };
