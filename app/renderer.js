// NexusGo - Renderer surec: WebRTC baglantisi, ekran goruntuleme, uzaktan kontrol
// ve dosya gonderme/alma mantiginin tamami burada.
//
// Ucretsiz/standart bilesenler: RTCPeerConnection + STUN (Google'in herkese acik,
// ucretsiz STUN sunucusu) taniml WebRTC standardi. Baska hicbir ucretli servise
// baglanilmaz.

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const CHUNK_SIZE = 16 * 1024; // 16 KB - veri kanali icin guvenli parca boyutu
const HEADER_LEN = 8; // her binary dosya parcasinin basindaki transferId etiketi
const DEFAULT_SERVER_URL = 'ws://localhost:7777'; // musteri (host) ekraninda gizli, sabit deger

const CONTACT = {
  phoneDisplay: '+90 541 225 00 33',
  whatsappUrl: 'https://wa.me/905412250033',
  websiteDisplay: 'www.abyazilim.com.tr',
  websiteUrl: 'https://www.abyazilim.com.tr',
  email: 'info@abyazilim.com.tr',
};

// Admin panel henuz yok; su an icin ornek/placeholder duyurular. Ileride
// gercek bir admin panelden gelen veriyle bu diziyi doldurmak yeterli olacak.
const NEWS_ITEMS = [
  'NexusGo ile uzaktan destek artık çok daha hızlı.',
  'Destek ekibimiz hafta içi 09:00–18:00 arası hizmet vermektedir.',
  'Sorularınız için WhatsApp hattımızdan bize ulaşabilirsiniz.',
];

const els = {
  statusBadge: document.getElementById('statusBadge'),
  setupPanel: document.getElementById('setupPanel'),
  sessionPanel: document.getElementById('sessionPanel'),
  roleChoice: document.getElementById('roleChoice'),
  roleHostBtn: document.getElementById('roleHostBtn'),
  roleViewerBtn: document.getElementById('roleViewerBtn'),
  hostSetup: document.getElementById('hostSetup'),
  viewerSetup: document.getElementById('viewerSetup'),
  hostStartBtn: document.getElementById('hostStartBtn'),
  hostCodeDisplay: document.getElementById('hostCodeDisplay'),
  hostCodeValue: document.getElementById('hostCodeValue'),
  copyCodeBtn: document.getElementById('copyCodeBtn'),
  roomCodeInput: document.getElementById('roomCodeInput'),
  viewerConnectBtn: document.getElementById('viewerConnectBtn'),
  roleBadge: document.getElementById('roleBadge'),
  videoWrap: document.getElementById('videoWrap'),
  remoteVideo: document.getElementById('remoteVideo'),
  hostPlaceholder: document.getElementById('hostPlaceholder'),
  allowControlCheckbox: document.getElementById('allowControlCheckbox'),
  controlHint: document.getElementById('controlHint'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  toggleLogBtn: document.getElementById('toggleLogBtn'),
  sendFileBtn: document.getElementById('sendFileBtn'),
  filePanel: document.getElementById('filePanel'),
  transferList: document.getElementById('transferList'),
  logPanel: document.getElementById('logPanel'),
  logBox: document.getElementById('logBox'),
  newsTicker: document.getElementById('newsTicker'),
  tickerTrack: document.getElementById('tickerTrack'),
  contactWhatsapp: document.getElementById('contactWhatsapp'),
  contactWebsite: document.getElementById('contactWebsite'),
  contactEmail: document.getElementById('contactEmail'),
  contactPhoneText: document.getElementById('contactPhoneText'),
  contactWebsiteText: document.getElementById('contactWebsiteText'),
  contactEmailText: document.getElementById('contactEmailText'),
};

const state = {
  role: 'host',
  ws: null,
  pc: null,
  controlChannel: null, // fare/klavye olaylari (viewer -> host)
  fileChannel: null, // dosya protokolu (iki yonlu)
  localStream: null,
  pendingFileAccepts: new Map(), // transferId -> {resolve}
  receivingTransfers: new Map(), // transferId -> {size, received, filePath, ignored}
};

function log(msg) {
  const line = document.createElement('div');
  const t = new Date().toLocaleTimeString('tr-TR');
  line.textContent = `[${t}] ${msg}`;
  els.logBox.appendChild(line);
  els.logBox.scrollTop = els.logBox.scrollHeight;
}

function setStatus(text, cls) {
  els.statusBadge.textContent = text;
  els.statusBadge.className = `status status-${cls}`;
}

// --------------------------- Rol secimi (host/viewer) ---------------------------

els.roleHostBtn.addEventListener('click', () => setRole('host'));
els.roleViewerBtn.addEventListener('click', () => setRole('viewer'));

function setRole(role) {
  state.role = role;
  els.roleHostBtn.classList.toggle('active', role === 'host');
  els.roleViewerBtn.classList.toggle('active', role === 'viewer');

  // Musteri (host) icin sade, tek butonlu ekran; destek ekibi (viewer) icin
  // kod girisi + sunucu adresi iceren teknik ekran. Bilerek AYNI DEGIL.
  els.hostSetup.classList.toggle('hidden', role !== 'host');
  els.viewerSetup.classList.toggle('hidden', role !== 'viewer');
  els.newsTicker.classList.toggle('hidden', role !== 'host'); // sadece musteri ekraninda

  els.roleBadge.textContent = role === 'host' ? 'Müşteri' : 'Destek Ekibi';
}

// --------------------------- Iletisim karti + duyuru seridi ---------------------------

els.contactPhoneText.textContent = CONTACT.phoneDisplay;
els.contactWebsiteText.textContent = CONTACT.websiteDisplay;
els.contactEmailText.textContent = CONTACT.email;

els.contactWhatsapp.addEventListener('click', () => window.nexusgo.openExternal(CONTACT.whatsappUrl));
els.contactWebsite.addEventListener('click', () => window.nexusgo.openExternal(CONTACT.websiteUrl));
els.contactEmail.addEventListener('click', () => window.nexusgo.openExternal(`mailto:${CONTACT.email}`));

els.tickerTrack.textContent = NEWS_ITEMS.join('   •   ');

// --------------------------- Baglanti kurma ---------------------------
//
// Musteri (host) tek tikla kod uretir + baglanir. Destek ekibi (viewer)
// musterinin verdigi kodu girip baglanir. Ikisi de ayni connect() akisini
// kullanir, sadece giris noktalari farkli.

els.hostStartBtn.addEventListener('click', () => {
  const roomCode = String(Math.floor(100000 + Math.random() * 900000));
  els.hostCodeValue.textContent = roomCode;
  els.hostCodeDisplay.classList.remove('hidden');
  connect(roomCode, DEFAULT_SERVER_URL);
});

els.copyCodeBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(els.hostCodeValue.textContent);
  const original = els.copyCodeBtn.textContent;
  els.copyCodeBtn.textContent = 'Kopyalandı ✓';
  setTimeout(() => { els.copyCodeBtn.textContent = original; }, 1500);
});

els.viewerConnectBtn.addEventListener('click', () => {
  const roomCode = els.roomCodeInput.value.trim();
  if (!roomCode) {
    alert('Lütfen müşteriden aldığınız kodu girin.');
    return;
  }
  connect(roomCode, DEFAULT_SERVER_URL);
});

els.disconnectBtn.addEventListener('click', disconnect);

function lockSetupControls() {
  // Baglanti kurulduktan sonra rol degistirme / ikinci kez baglanma gibi
  // karisikliga yol acan islemleri kilitle (bir onceki ws acik kalip yeni
  // bir baglanti daha acilmasin diye).
  els.hostStartBtn.disabled = true;
  els.viewerConnectBtn.disabled = true;
  els.roleHostBtn.disabled = true;
  els.roleViewerBtn.disabled = true;
}

function unlockSetupControls() {
  els.hostStartBtn.disabled = false;
  els.viewerConnectBtn.disabled = false;
  els.roleHostBtn.disabled = false;
  els.roleViewerBtn.disabled = false;
}

function connect(roomCode, serverUrl) {
  if (state.ws) {
    log('Zaten bir bağlantı girişimi var, tekrar "Bağlan" tıklamanıza gerek yok.');
    return;
  }
  lockSetupControls();
  setStatus('Bağlanıyor...', 'connecting');
  log(`Sinyal sunucusuna bağlanılıyor: ${serverUrl}`);

  const ws = new WebSocket(serverUrl);
  state.ws = ws;

  ws.onopen = () => {
    log('Sinyal sunucusuna bağlandı, odaya katılınıyor...');
    ws.send(JSON.stringify({ type: 'join', roomCode, role: state.role }));
  };

  ws.onclose = () => {
    if (state.ws === ws) disconnect('Sinyal sunucusu bağlantısı kapandı.');
  };
  ws.onerror = () => {
    if (state.ws === ws) disconnect('Sinyal sunucusuna bağlanılamadı. Sunucu adresini/ağınızı kontrol edin.');
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'joined':
        log(`Odaya katılındı (rol: ${msg.role}). Şu anda odada ${msg.peers} başka katılımcı var.`);
        setupPeerConnection();
        if (state.role === 'host' && msg.peers > 0) {
          await startHostOffer();
        }
        break;

      case 'peer-joined':
        log(`Karşı taraf odaya katıldı (rol: ${msg.role}).`);
        if (state.role === 'host') await startHostOffer();
        break;

      case 'peer-left':
        disconnect('Karşı taraf bağlantıyı kapattı.');
        break;

      case 'offer':
        await handleOffer(msg);
        break;

      case 'answer':
        await state.pc.setRemoteDescription(new RTCSessionDescription(msg.description));
        log('Bağlantı tamamlandı, ekran akışı bekleniyor...');
        break;

      case 'ice-candidate':
        if (msg.candidate) {
          try {
            await state.pc.addIceCandidate(msg.candidate);
          } catch (err) {
            console.error('ICE aday hatası:', err);
          }
        }
        break;

      case 'error':
        alert(msg.message);
        disconnect(`Hata: ${msg.message}`);
        break;
    }
  };
}

function setupPeerConnection() {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  state.pc = pc;

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      state.ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate }));
    }
  };

  pc.onconnectionstatechange = () => {
    log(`Bağlantı durumu: ${pc.connectionState}`);
    if (pc.connectionState === 'connected') {
      setStatus('Bağlandı', 'connected');
      showSessionPanel();
    } else if (['failed', 'closed'].includes(pc.connectionState)) {
      disconnect('Bağlantı koptu.');
    }
  };

  // Viewer tarafi: host'un paylastigi ekran akisini burada alir
  pc.ontrack = (e) => {
    els.remoteVideo.srcObject = e.streams[0];
  };

  // Viewer tarafi: host'un actigi data channel'lari burada yakalar
  pc.ondatachannel = (e) => {
    if (e.channel.label === 'control') bindControlChannel(e.channel);
    if (e.channel.label === 'files') bindFileChannel(e.channel);
  };
}

async function startHostOffer() {
  const pc = state.pc;

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    state.localStream = stream;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    log('Ekran paylaşımı başlatıldı.');
  } catch (err) {
    disconnect('Ekran paylaşımı reddedildi/başarısız: ' + err.message);
    return;
  }

  state.controlChannel = pc.createDataChannel('control');
  bindControlChannel(state.controlChannel);

  state.fileChannel = pc.createDataChannel('files');
  bindFileChannel(state.fileChannel);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  state.ws.send(JSON.stringify({ type: 'offer', description: offer }));
  log('Bağlantı teklifi (offer) gönderildi.');
}

async function handleOffer(msg) {
  const pc = state.pc;
  await pc.setRemoteDescription(new RTCSessionDescription(msg.description));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  state.ws.send(JSON.stringify({ type: 'answer', description: answer }));
  log('Bağlantı cevabı (answer) gönderildi.');
}

function showSessionPanel() {
  els.setupPanel.classList.add('hidden');
  els.sessionPanel.classList.remove('hidden');

  els.logPanel.classList.add('hidden'); // varsayilan gizli, istege bagli acilir

  if (state.role === 'host') {
    els.hostPlaceholder.classList.remove('hidden');
  } else {
    els.controlHint.classList.remove('hidden');
    els.toggleLogBtn.classList.remove('hidden'); // sadece destek ekibi gorur
    setupViewerInputCapture();
  }
}

els.toggleLogBtn.addEventListener('click', () => {
  const showing = !els.logPanel.classList.contains('hidden');
  els.logPanel.classList.toggle('hidden', showing);
  els.toggleLogBtn.textContent = showing ? 'Teknik Günlüğü Göster' : 'Teknik Günlüğü Gizle';
});

let disconnecting = false;

function disconnect(reason) {
  if (disconnecting) return; // pc.close()/ws.close() kendi olaylarini tetikleyip
  disconnecting = true;      // buraya tekrar girmeye calisabilir, bunu engelle

  if (state.localStream) state.localStream.getTracks().forEach((t) => t.stop());
  if (state.pc) state.pc.close();
  if (state.ws) state.ws.close();
  state.pc = null;
  state.ws = null;
  state.controlChannel = null;
  state.fileChannel = null;

  els.sessionPanel.classList.add('hidden');
  els.setupPanel.classList.remove('hidden');
  els.hostPlaceholder.classList.add('hidden');
  els.controlHint.classList.add('hidden');
  els.logPanel.classList.add('hidden');
  els.toggleLogBtn.classList.add('hidden');
  els.toggleLogBtn.textContent = 'Teknik Günlüğü Göster';
  els.remoteVideo.srcObject = null;
  els.hostCodeDisplay.classList.add('hidden');
  unlockSetupControls();
  setStatus('Bağlı değil', 'disconnected');
  log(reason || 'Bağlantı sonlandırıldı.');

  disconnecting = false;
}

// --------------------------- Uzaktan kontrol (control channel) ---------------------------

function bindControlChannel(channel) {
  state.controlChannel = channel;
  channel.onopen = () => log('Kontrol kanalı açıldı.');
  channel.onmessage = (e) => {
    // Sadece HOST tarafi gelen input olaylarini isler, ve sadece kullanici izin verdiyse.
    if (state.role !== 'host') return;
    if (!els.allowControlCheckbox.checked) return;
    const evt = JSON.parse(e.data);
    window.nexusgo.sendRemoteInput(evt);
  };
}

function setupViewerInputCapture() {
  const wrap = els.videoWrap;
  const video = els.remoteVideo;
  let lastMoveSent = 0;

  wrap.addEventListener('click', () => wrap.focus());

  video.addEventListener('mousemove', (e) => {
    const now = performance.now();
    if (now - lastMoveSent < 25) return; // ~40 olay/sn ile sinirla
    lastMoveSent = now;
    const rect = video.getBoundingClientRect();
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);
    sendInput({ type: 'mousemove', x, y });
  });

  video.addEventListener('mousedown', (e) => {
    e.preventDefault();
    sendInput({ type: 'mousedown', button: e.button });
  });
  video.addEventListener('mouseup', (e) => {
    sendInput({ type: 'mouseup', button: e.button });
  });
  video.addEventListener('wheel', (e) => {
    e.preventDefault();
    sendInput({ type: 'wheel', deltaY: e.deltaY });
  }, { passive: false });
  video.addEventListener('contextmenu', (e) => e.preventDefault());

  wrap.addEventListener('keydown', (e) => {
    e.preventDefault();
    sendInput({ type: 'keydown', key: e.key });
  });
  wrap.addEventListener('keyup', (e) => {
    e.preventDefault();
    sendInput({ type: 'keyup', key: e.key });
  });
}

function clamp01(n) { return Math.min(1, Math.max(0, n)); }

function sendInput(evt) {
  if (state.controlChannel && state.controlChannel.readyState === 'open') {
    state.controlChannel.send(JSON.stringify(evt));
  }
}

// --------------------------- Dosya aktarimi (files channel) ---------------------------
//
// Protokol (tek bir data channel uzerinden, sira korunur):
//  1) Gonderen  -> {type:'file-offer', transferId, name, size}         (JSON string)
//  2) Alan taraf -> {type:'file-accept', transferId, accepted:boolean} (JSON string)
//  3) Kabul edildiyse gonderen art arda binary parcalar yollar:
//       [8 byte transferId etiketi][... veri ...]
//  4) Alan taraf toplam boyuta ulasinca dosyayi diske yazmayi bitirir.

function bindFileChannel(channel) {
  state.fileChannel = channel;
  channel.binaryType = 'arraybuffer';
  channel.onopen = () => log('Dosya kanalı açıldı.');

  channel.onmessage = (e) => {
    if (typeof e.data === 'string') {
      const msg = JSON.parse(e.data);
      if (msg.type === 'file-offer') handleIncomingFileOffer(msg);
      if (msg.type === 'file-accept') handleFileAccept(msg);
    } else {
      handleIncomingFileChunk(e.data);
    }
  };
}

function makeTransferId() {
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0');
}

els.sendFileBtn.addEventListener('click', async () => {
  const file = await window.nexusgo.pickFileToSend();
  if (file) sendFileObject(file);
});

// Surukle-birak: dosya panelinin uzerine dosya birakinca da ayni akis calisir
els.filePanel.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.filePanel.classList.add('drag-over');
});
els.filePanel.addEventListener('dragleave', () => {
  els.filePanel.classList.remove('drag-over');
});
els.filePanel.addEventListener('drop', (e) => {
  e.preventDefault();
  els.filePanel.classList.remove('drag-over');
  for (const f of e.dataTransfer.files) {
    const path = window.nexusgo.getPathForFile(f);
    sendFileObject({ path, name: f.name, size: f.size });
  }
});

async function sendFileObject(file) {
  if (!state.fileChannel || state.fileChannel.readyState !== 'open') {
    alert('Dosya kanalı henüz hazır değil.');
    return;
  }

  const transferId = makeTransferId();
  addTransferRow(transferId, file.name, file.size, 'out');
  updateTransferStatus(transferId, 'Onay bekleniyor...');

  state.fileChannel.send(JSON.stringify({ type: 'file-offer', transferId, name: file.name, size: file.size }));

  const accepted = await new Promise((resolve) => {
    state.pendingFileAccepts.set(transferId, { resolve });
  });

  if (!accepted) {
    updateTransferStatus(transferId, 'Karşı taraf reddetti.', true);
    return;
  }

  updateTransferStatus(transferId, 'Gönderiliyor...');
  await streamFileChunks(transferId, file);
  updateTransferProgress(transferId, 1, true);
  updateTransferStatus(transferId, 'Tamamlandı.');
}

async function streamFileChunks(transferId, file) {
  const channel = state.fileChannel;
  const encoder = new TextEncoder();
  const idBytes = encoder.encode(transferId.slice(0, HEADER_LEN).padEnd(HEADER_LEN, '0'));

  let offset = 0;
  while (offset < file.size) {
    const length = Math.min(CHUNK_SIZE, file.size - offset);
    const chunk = await window.nexusgo.readFileChunk({ filePath: file.path, offset, length });
    const payload = new Uint8Array(chunk);

    const packet = new Uint8Array(HEADER_LEN + payload.length);
    packet.set(idBytes, 0);
    packet.set(payload, HEADER_LEN);

    // Basit geri basinc: veri kanali arabellegi cok dolarsa bekle
    while (channel.bufferedAmount > 4 * 1024 * 1024) {
      await new Promise((r) => setTimeout(r, 15));
    }

    channel.send(packet);
    offset += length;
    updateTransferProgress(transferId, offset / file.size);
  }
}

async function handleIncomingFileOffer(msg) {
  addTransferRow(msg.transferId, msg.name, msg.size, 'in');
  updateTransferStatus(msg.transferId, 'Kaydetme konumu seçiliyor...');

  const filePath = await window.nexusgo.startReceiveFile({ transferId: msg.transferId, fileName: msg.name });
  const accepted = !!filePath;

  state.receivingTransfers.set(msg.transferId, {
    size: msg.size,
    received: 0,
    filePath,
    ignored: !accepted,
  });

  state.fileChannel.send(JSON.stringify({ type: 'file-accept', transferId: msg.transferId, accepted }));

  if (accepted) {
    updateTransferStatus(msg.transferId, 'Alınıyor...');
  } else {
    updateTransferStatus(msg.transferId, 'Reddedildi.', true);
  }
}

function handleFileAccept(msg) {
  const pending = state.pendingFileAccepts.get(msg.transferId);
  if (pending) {
    pending.resolve(msg.accepted);
    state.pendingFileAccepts.delete(msg.transferId);
  }
}

async function handleIncomingFileChunk(buf) {
  const bytes = new Uint8Array(buf);
  const decoder = new TextDecoder();
  const transferId = decoder.decode(bytes.subarray(0, HEADER_LEN));
  const payload = bytes.subarray(HEADER_LEN);

  const entry = state.receivingTransfers.get(transferId);
  if (!entry) return;

  if (!entry.ignored) {
    await window.nexusgo.writeFileChunk({ transferId, chunk: payload });
  }
  entry.received += payload.length;
  updateTransferProgress(transferId, entry.received / entry.size);

  if (entry.received >= entry.size) {
    if (!entry.ignored) {
      const filePath = await window.nexusgo.finishReceiveFile({ transferId });
      updateTransferProgress(transferId, 1, true);
      updateTransferStatus(transferId, 'Tamamlandı.', false, filePath);
    }
  }
}

// --------------------------- Transfer listesi UI ---------------------------

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function addTransferRow(transferId, name, size, direction) {
  const emptyHint = els.transferList.querySelector('.empty-hint');
  if (emptyHint) emptyHint.remove();

  const row = document.createElement('div');
  row.className = 'transfer-row';
  row.id = `transfer-${transferId}`;
  row.innerHTML = `
    <div class="name-row">
      <span><span class="direction">${direction === 'out' ? 'Gönderiliyor →' : '← Alınıyor'}</span>${name}</span>
      <span class="size">${formatSize(size)}</span>
    </div>
    <div class="progress-track"><div class="progress-fill" style="width:0%"></div></div>
    <div class="status-text"></div>
  `;
  els.transferList.appendChild(row);
}

function updateTransferProgress(transferId, fraction, done) {
  const row = document.getElementById(`transfer-${transferId}`);
  if (!row) return;
  const fill = row.querySelector('.progress-fill');
  fill.style.width = `${Math.round(fraction * 100)}%`;
  if (done) fill.classList.add('done');
}

function updateTransferStatus(transferId, text, rejected, filePath) {
  const row = document.getElementById(`transfer-${transferId}`);
  if (!row) return;
  const statusEl = row.querySelector('.status-text');
  statusEl.textContent = text;
  if (rejected) row.querySelector('.progress-fill').classList.add('rejected');

  if (filePath) {
    const btn = document.createElement('button');
    btn.className = 'show-folder-btn';
    btn.textContent = 'Klasörde göster';
    btn.onclick = () => window.nexusgo.showFileInFolder(filePath);
    statusEl.after(btn);
  }
}

setRole('host');
log('NexusGo hazır. Bir rol seçip bağlanabilirsiniz.');
