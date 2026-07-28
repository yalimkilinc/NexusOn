// NexusGo Sinyal (Rendezvous) Sunucusu
//
// Amaci: Host ve Viewer taraflari birbirini bulamaz (ikisi de NAT/firewall arkasindadir),
// bu sunucu sadece SDP/ICE mesajlarini karsi tarafa iletir. Gercek ekran/dosya verisi
// buradan GECMEZ; kurulduktan sonra WebRTC baglantisi dogrudan (P2P) kurulur.
//
// Maliyet: $0. Kendi bilgisayarinizda ya da tek seferlik/sabit ucretli ufak bir VPS'te
// calisir. Kullanim/oturum basina hicbir ucret modeli yoktur.

const { WebSocketServer } = require('ws');

const PORT = process.env.PORT ? Number(process.env.PORT) : 7777;
const wss = new WebSocketServer({ port: PORT });

// roomCode -> Set<WebSocket>  (bir odada en fazla 2 katilimci: host + viewer)
const rooms = new Map();

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

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.role = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'join') {
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
    if (room.size === 0) rooms.delete(ws.roomCode);
  });
});

console.log(`NexusGo sinyal sunucusu calisiyor: ws://localhost:${PORT}`);
