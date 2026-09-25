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

// SDP/ICE mesajlari birkac KB'dir; varsayilan 100 MiB sinirini 256 KB'a indiriyoruz.
const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });

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
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS) || 15 * 60 * 1000; // oda, 2. kisi katilmadan 15 dk sonra kapanir
const ROOM_SWEEP_MS = Number(process.env.ROOM_SWEEP_MS) || 60 * 1000;
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

// Gercek istemci IP'si: uygulama Caddy arkasinda calistigi icin baglanti hep
// 127.0.0.1'den gelir; bu durumda Caddy'nin eklediği X-Forwarded-For'un SON
// elemani (Caddy'nin gordugu gercek IP) kullanilir. Aksi halde tum kullanicilar
// tek bir "IP" sayilir ve tek bir kotayi paylasir.
function clientIpOf(req) {
  const remote = req.socket.remoteAddress || 'bilinmeyen';
  const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (isLoopback) {
    const xff = String(req.headers['x-forwarded-for'] || '');
    const last = xff.split(',').pop().trim();
    if (last) return last;
  }
  return remote;
}

// "Oda bulunamadi" donen katilimlar (kod tahmininin belirtisi) icin ayri, daha
// dusuk sayac: normal kullanicinin dakikalar icinde 20'den fazla yanlis kod
// denemesi beklenmez.
const NOT_FOUND_WINDOW_MS = 2 * 60 * 1000;
const NOT_FOUND_MAX = 20;
const notFoundAttempts = new Map(); // ip -> { count, windowStart }
function countNotFound(ip) {
  const now = Date.now();
  let entry = notFoundAttempts.get(ip);
  if (!entry || now - entry.windowStart > NOT_FOUND_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    notFoundAttempts.set(ip, entry);
  }
  entry.count++;
  return entry.count > NOT_FOUND_MAX;
}

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
  for (const [ip, entry] of notFoundAttempts) {
    if (now - entry.windowStart > NOT_FOUND_WINDOW_MS) notFoundAttempts.delete(ip);
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
}, ROOM_SWEEP_MS).unref();

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
  ws.clientIp = clientIpOf(req);

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

      if (ws.roomCode) {
        send(ws, { type: 'error', message: 'Bu baglanti zaten bir odaya katildi.' });
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
        // GUVENLIK: odayi yalnizca host yaratabilir. Viewer'in var olmayan bir
        // odaya katilip onu yaratmasi, saldirganin oda kodlarini onceden isgal
        // etmesine izin veriyordu.
        if (role !== 'host') {
          if (countNotFound(ws.clientIp)) {
            send(ws, { type: 'error', message: 'Cok fazla hatali kod denendi. Lutfen biraz sonra tekrar deneyin.' });
            return;
          }
          send(ws, { type: 'error', message: 'Oda bulunamadi. Musteriden guncel kodu isteyin.' });
          return;
        }
        room = new Set();
        rooms.set(roomCode, room);
        roomCreatedAt.set(roomCode, Date.now());
      }
      if (room.size >= 2) {
        send(ws, { type: 'error', message: 'Bu oda dolu (en fazla 2 kisi baglanabilir).' });
        return;
      }
      // GUVENLIK: bir odada ayni rolden iki katilimci olamaz. Bu kural olmadan
      // saldirgan 'host' rolu iddia edip odayi onceden yaratabilir ve gercek
      // musteri o odaya katildiginda ekranini saldirgana gonderir.
      for (const peer of room) {
        if (peer.role === role) {
          send(ws, { type: 'error', message: 'Bu kod kullanimda. Lutfen yeni bir kod uretin.' });
          return;
        }
      }

      ws.roomCode = roomCode;
      ws.role = role;
      // Musteriye "kim baglaniyor" gosterebilmek icin personelin gorunen adi
      // karsi tarafa iletilir. Sadece bilgilendirme amaclidir (dogrulanmis
      // kimlik degil); kontrol karakterleri temizlenir, uzunluk sinirlanir.
      ws.displayName = String(msg.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
      room.add(ws);
      // Iki taraf da odaya girdi: oda artik 'bekleyen' degil, aktif oturum. 15 dk
      // suresi yalnizca ikinci kisi hic katilmayan odalar icindir; aktif oturumu
      // kesmemeli.
      if (room.size >= 2) roomCreatedAt.delete(roomCode);

      broadcastToRoom(ws, { type: 'peer-joined', role, name: ws.displayName });
      const otherPeer = [...room].find((p) => p !== ws);
      send(ws, {
        type: 'joined',
        roomCode,
        role,
        peers: room.size - 1,
        peerName: otherPeer ? otherPeer.displayName || '' : '',
      });
      return;
    }

    // SDP teklif/cevap ve ICE adaylarini oldugu gibi karsi tarafa ilet
    if (msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice-candidate') {
      if (!ws.roomCode) return; // odaya katilmamis soket hicbir sey iletemez
      // Roller: offer'i yalnizca host, answer'i yalnizca viewer uretir. Aksi halde
      // musteri onay vermeden once viewer'in 'offer'i host'a ulasip baglanti/IP
      // bilgisi onay beklenmeden kurulabiliyordu.
      if (msg.type === 'offer' && ws.role !== 'host') return;
      if (msg.type === 'answer' && ws.role !== 'viewer') return;
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
    } else if (room.size === 1) {
      // Yalniz kalan taraf icin oda yeniden 'bekleyen' olur; TTL yeniden baslar.
      roomCreatedAt.set(ws.roomCode, Date.now());
    }
  });
});

server.on('error', (err) => {
  console.error('HTTP sunucusu hatasi:', err.message);
});

server.listen(PORT, () => {
  console.log(`NexusGo sinyal sunucusu calisiyor: ${useTls ? 'wss' : 'ws'}://localhost:${PORT}`);
});
