// NexusGo Sinyal (Rendezvous) Sunucusu
//
// Amaci: Host ve Viewer taraflari birbirini bulamaz (ikisi de NAT/firewall arkasindadir),
// bu sunucu sadece SDP/ICE mesajlarini karsi tarafa iletir. Gercek ekran/dosya verisi
// buradan GECMEZ; kurulduktan sonra WebRTC baglantisi dogrudan (P2P) kurulur.
//
// Maliyet: $0. Kendi bilgisayarinizda ya da tek seferlik/sabit ucretli ufak bir VPS'te
// calisir. Kullanim/oturum basina hicbir ucret modeli yoktur.

const { WebSocketServer } = require('ws');
const fs = require('fs');
const http = require('http');
const https = require('https');
const tls = require('tls');

const PORT = process.env.PORT ? Number(process.env.PORT) : 7777;

// SSL_CERT_PATH/SSL_KEY_PATH verilmisse guvenli (wss://) calisir, yoksa
// duz ws:// ile (yerel gelistirme icin) calismaya devam eder.
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
  ? https.createServer({
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
      ...(sniContexts && {
        SNICallback: (servername, cb) => cb(null, sniContexts.get(servername)),
      }),
    })
  : http.createServer();

const wss = new WebSocketServer({ server });

// roomCode -> Set<WebSocket>  (bir odada en fazla 2 katilimci: host + viewer)
const rooms = new Map();

// GUVENLIK: oda kodu sadece 6 haneli rastgele bir sayi (100000-999999,
// ~900 bin ihtimal) ve suresiz gecerliydi - hicbir hiz sinirlamasi/gecerlilik
// suresi olmadan, otomatik bir script art arda rastgele kodlar deneyerek
// baska birinin ACIK/BEKLEYEN odasina (gercek personelden ONCE) "viewer"
// olarak katilip musterinin ekranina/fare-klavyesine tam erisim kazanabilirdi
// - rol de tamamen baglanan tarafin kendi beyanina dayaniyor, sunucu
// dogrulamiyor. Iki katmanli savunma ekleniyor: (1) oda kodlari belli bir
// sure sonra (baglanti tamamlanmadiysa) gecersiz hale geliyor, (2) IP basina
// 'join' deneme sayisi sinirlaniyor - ikisi birlikte kaba kuvvetle kod
// tahmin etmeyi pratikte imkansiz hale getiriyor (900 bin ihtimali, dakikada
// birkac denemeyle, birkac dakikalik bir pencerede tuketmek matematiksel
// olarak yapilamaz).
const ROOM_TTL_MS = 15 * 60 * 1000; // oda, 2. kisi katilmadan 15 dk sonra kapanir
const roomCreatedAt = new Map(); // roomCode -> olusturulma zamani (ms)

// ONEMLI (CANLI KANITLANDI - gercek destek ekibi testinde): host ve viewer
// COGU ZAMAN AYNI ofis/ag IP'sini paylasir (NAT arkasinda), ve normal
// sorun giderme sirasinda birkac kez "tekrar dene" yapmak sik rastlanan bir
// davranistir - her deneme dongusu 2 'join' mesaji (host+viewer) uretir. Ilk
// deger (dakikada 20) bunu gercek bir musteri testinde ENGELLEDI - meşru
// kullanicilar kaba kuvvet saldirganindan cok daha az sayida deneme yapsa
// da, dusuk bir tavan gercek kullanimi da kesiyordu. Cok daha comert bir
// tavana (2 dakikada 60) cikariyoruz - kaba kuvvetle kod tahminini hala
// pratikte imkansiz kilarken (900 bin ihtimali tek bir IP'den tuketmek
// yuzlerce saat surer), gercek kullanicilarin onlarca kez tekrar denemesine
// engel olmuyor.
const JOIN_RATE_WINDOW_MS = 2 * 60 * 1000;
const JOIN_RATE_MAX = 60; // IP basina 2 dakikada en fazla 60 'join' denemesi
const joinAttempts = new Map(); // ip -> { count, windowStart }

function isRateLimited(ip) {
  const now = Date.now();
  let entry = joinAttempts.get(ip);
  if (!entry || now - entry.windowStart > JOIN_RATE_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    joinAttempts.set(ip, entry);
  }
  entry.count++;
  return entry.count > JOIN_RATE_MAX;
}

// Eski giris denemesi kayitlarini ve suresi gecmis (hic tamamlanmamis)
// odalari periyodik temizle - bellek sizintisini onler.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of joinAttempts) {
    if (now - entry.windowStart > JOIN_RATE_WINDOW_MS) joinAttempts.delete(ip);
  }
  for (const [roomCode, createdAt] of roomCreatedAt) {
    if (now - createdAt > ROOM_TTL_MS) {
      const room = rooms.get(roomCode);
      if (room) {
        for (const peer of room) {
          send(peer, { type: 'error', message: 'Oda kodunun süresi doldu.' });
          peer.close();
        }
      }
      rooms.delete(roomCode);
      roomCreatedAt.delete(roomCode);
    }
  }
}, 60 * 1000).unref();

function send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastToRoom(ws, data) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  for (const peer of room) {
    if (peer !== ws) send(peer, data);
  }
}

wss.on('error', (err) => {
  console.error('WebSocketServer hatasi:', err.message);
});

wss.on('connection', (ws, req) => {
  ws.roomCode = null;
  ws.role = null;
  ws.clientIp = req.socket.remoteAddress || 'bilinmeyen';

  // Yakalanmamis bir 'error' olayi bu soketi (EventEmitter) firlatip TUM
  // sureci cokertebilir - bu da o an baglantili butun oda/oturumlari
  // (ilgisiz musteriler dahil) tek seferde kopartir. Sadece logluyoruz;
  // gercek temizlik zaten asagidaki 'close' olayinda yapiliyor.
  ws.on('error', (err) => {
    console.error(`Soket hatasi (oda: ${ws.roomCode || '-'}):`, err.message);
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'join') {
      if (isRateLimited(ws.clientIp)) {
        send(ws, { type: 'error', message: 'Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.' });
        return;
      }

      const roomCode = String(msg.roomCode || '').trim();
      const role = msg.role === 'host' ? 'host' : 'viewer';
      if (!roomCode) {
        send(ws, { type: 'error', message: 'Oda kodu bos olamaz.' });
        return;
      }

      let room = rooms.get(roomCode);
      if (!room) {
        room = new Set();
        rooms.set(roomCode, room);
        roomCreatedAt.set(roomCode, Date.now());
      }
      if (room.size >= 2) {
        send(ws, { type: 'error', message: 'Bu oda dolu (en fazla 2 kisi baglanabilir).' });
        return;
      }

      ws.roomCode = roomCode;
      ws.role = role;
      room.add(ws);

      broadcastToRoom(ws, { type: 'peer-joined', role });
      send(ws, { type: 'joined', roomCode, role, peers: room.size - 1 });
      return;
    }

    // SDP teklif/cevap ve ICE adaylarini oldugu gibi karsi tarafa ilet
    if (msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice-candidate') {
      broadcastToRoom(ws, msg);
      return;
    }
  });

  ws.on('close', () => {
    if (!ws.roomCode) return;
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    room.delete(ws);
    broadcastToRoom(ws, { type: 'peer-left' });
    if (room.size === 0) {
      rooms.delete(ws.roomCode);
      roomCreatedAt.delete(ws.roomCode);
    }
  });
});

server.on('error', (err) => {
  console.error('HTTP sunucusu hatasi:', err.message);
});

server.listen(PORT, () => {
  console.log(`NexusGo sinyal sunucusu calisiyor: ${useTls ? 'wss' : 'ws'}://localhost:${PORT}`);
});
