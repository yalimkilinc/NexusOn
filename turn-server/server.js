// NexusGo TURN Sunucusu
//
// Amaci: STUN, iki taraf arasinda dogrudan (P2P) baglanti kurulabildigi
// durumlarda NAT/firewall arkasindaki adresi bulmaya yarar - ama simetrik
// NAT ya da UDP'yi kisitlayan kurumsal guvenlik duvarlari gibi durumlarda
// dogrudan baglanti HICBIR ZAMAN kurulamaz. Bu sunucu, o durumlarda ekran/
// giris verisini iki taraf arasinda RELAY (aktarim) eder - hala uctan uca
// sifreli (DTLS/SRTP) kalir, sadece paketler bu sunucu uzerinden gecer.
//
// Sadece dogrudan baglanti basarisiz oldugunda devreye girer; cogu baglanti
// hala tamamen P2P kalir ve bu sunucudan hic gecmez.
//
// Maliyet: $0. node-turn (RFC 5389/5766) kutuphanesi ile ayni VPS'te,
// signaling-server ile ayni pm2 duzeninde calisir.

const Turn = require('node-turn');

const LISTENING_PORT = process.env.TURN_PORT ? Number(process.env.TURN_PORT) : 3478;
const MIN_PORT = process.env.TURN_MIN_PORT ? Number(process.env.TURN_MIN_PORT) : 49160;
const MAX_PORT = process.env.TURN_MAX_PORT ? Number(process.env.TURN_MAX_PORT) : 49260;
const EXTERNAL_IP = process.env.TURN_EXTERNAL_IP; // VPS'in DISARIDAN gorunen (public) IP'si - ZORUNLU
const TURN_USERNAME = process.env.TURN_USERNAME || 'nexusgo';
const TURN_PASSWORD = process.env.TURN_PASSWORD;

if (!EXTERNAL_IP) {
  console.error('HATA: TURN_EXTERNAL_IP ortam degiskeni ayarlanmamis (VPS public IP gerekli).');
  process.exit(1);
}
if (!TURN_PASSWORD) {
  console.error('HATA: TURN_PASSWORD ortam degiskeni ayarlanmamis.');
  process.exit(1);
}

const server = new Turn({
  listeningPort: LISTENING_PORT,
  minPort: MIN_PORT,
  maxPort: MAX_PORT,
  externalIps: EXTERNAL_IP,
  authMech: 'long-term',
  credentials: {
    [TURN_USERNAME]: TURN_PASSWORD,
  },
  debugLevel: 'INFO',
});

server.start();

console.log(`NexusGo TURN sunucusu calisiyor: udp/tcp ${LISTENING_PORT}, relay port araligi ${MIN_PORT}-${MAX_PORT}, external IP ${EXTERNAL_IP}`);
