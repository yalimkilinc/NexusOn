// NexusOn Mobil - destek personelinin telefondan bir musteriye baglanabilmesi
// icin hafif bir web istemcisi. Sadece "viewer" (destek veren) rolu icindir;
// masaustu uygulamasindaki ayni WebRTC/sinyal protokolunu kullanir.

const API_BASE_URL = window.location.origin;
const SIGNAL_URL = 'wss://nexuson-sinyal.novrixon.com.tr';
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const CHUNK_SIZE = 16 * 1024;
const HEADER_LEN = 8;

const els = {
  statusBadge: document.getElementById('statusBadge'),
  loginScreen: document.getElementById('loginScreen'),
  usernameInput: document.getElementById('usernameInput'),
  passwordInput: document.getElementById('passwordInput'),
  loginBtn: document.getElementById('loginBtn'),
  loginError: document.getElementById('loginError'),
  customerScreen: document.getElementById('customerScreen'),
  usernameLabel: document.getElementById('usernameLabel'),
  logoutBtn: document.getElementById('logoutBtn'),
  customerSearchInput: document.getElementById('customerSearchInput'),
  customerResults: document.getElementById('customerResults'),
  connectScreen: document.getElementById('connectScreen'),
  usernameLabel2: document.getElementById('usernameLabel2'),
  logoutBtn2: document.getElementById('logoutBtn2'),
  selectedCustomerText: document.getElementById('selectedCustomerText'),
  changeCustomerBtn: document.getElementById('changeCustomerBtn'),
  roomCodeInput: document.getElementById('roomCodeInput'),
  connectBtn: document.getElementById('connectBtn'),
  connectError: document.getElementById('connectError'),
  sessionScreen: document.getElementById('sessionScreen'),
  videoWrap: document.getElementById('videoWrap'),
  remoteVideo: document.getElementById('remoteVideo'),
  controlHint: document.getElementById('controlHint'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  fileMenuBtn: document.getElementById('fileMenuBtn'),
  filePanel: document.getElementById('filePanel'),
  sendFileBtn: document.getElementById('sendFileBtn'),
  fileInput: document.getElementById('fileInput'),
  transferList: document.getElementById('transferList'),
  closingOverlay: document.getElementById('closingOverlay'),
  closingCustomerRequestRow: document.getElementById('closingCustomerRequestRow'),
  closingCustomerRequestText: document.getElementById('closingCustomerRequestText'),
  closingStatus: document.getElementById('closingStatus'),
  closingNote: document.getElementById('closingNote'),
  closingSaveBtn: document.getElementById('closingSaveBtn'),
};

const state = {
  agent: null, // { username, token }
  customer: null, // { cariKodu, cariAdi }
  roomCode: null,
  ws: null,
  pc: null,
  controlChannel: null,
  fileChannel: null,
  currentTicketId: null,
  disconnecting: false,
  pendingFileAccepts: new Map(),
  receivingTransfers: new Map(),
};

function setStatus(text, cls) {
  els.statusBadge.textContent = text;
  els.statusBadge.className = `status status-${cls}`;
}

function showScreen(name) {
  els.loginScreen.classList.toggle('hidden', name !== 'login');
  els.customerScreen.classList.toggle('hidden', name !== 'customer');
  els.connectScreen.classList.toggle('hidden', name !== 'connect');
  els.sessionScreen.classList.toggle('hidden', name !== 'session');
}

// --------------------------- Oturum (localStorage) ---------------------------

function saveAgentSession() {
  if (state.agent) localStorage.setItem('nexuson_agent', JSON.stringify(state.agent));
}
function clearAgentSession() {
  localStorage.removeItem('nexuson_agent');
}
function restoreAgentSession() {
  try {
    const raw = localStorage.getItem('nexuson_agent');
    if (raw) state.agent = JSON.parse(raw);
  } catch {
    state.agent = null;
  }
}

// --------------------------- Giris ---------------------------

restoreAgentSession();
if (state.agent) {
  els.usernameLabel.textContent = state.agent.username;
  els.usernameLabel2.textContent = state.agent.username;
  showScreen('customer');
} else {
  showScreen('login');
}

els.loginBtn.addEventListener('click', async () => {
  const username = els.usernameInput.value.trim();
  const password = els.passwordInput.value;
  if (!username || !password) {
    els.loginError.textContent = 'Kullanıcı adı ve şifre gerekli.';
    els.loginError.classList.remove('hidden');
    return;
  }

  els.loginBtn.disabled = true;
  els.loginError.classList.add('hidden');
  try {
    const res = await fetch(`${API_BASE_URL}/api/agent-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Giriş başarısız.');

    state.agent = { username: data.username, token: data.token };
    saveAgentSession();
    els.usernameLabel.textContent = data.username;
    els.usernameLabel2.textContent = data.username;
    els.passwordInput.value = '';
    showScreen('customer');
  } catch (err) {
    els.loginError.textContent = err.message.includes('fetch')
      ? 'Sunucuya ulaşılamadı. İnternet/ağ bağlantınızı kontrol edin.'
      : err.message;
    els.loginError.classList.remove('hidden');
  } finally {
    els.loginBtn.disabled = false;
  }
});

function logout() {
  fetch(`${API_BASE_URL}/api/agent-logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.agent?.token}` },
  }).catch(() => {});
  state.agent = null;
  state.customer = null;
  clearAgentSession();
  els.customerSearchInput.value = '';
  els.customerResults.innerHTML = '';
  els.roomCodeInput.value = '';
  showScreen('login');
}
els.logoutBtn.addEventListener('click', logout);
els.logoutBtn2.addEventListener('click', logout);

// --------------------------- Musteri (cari) secimi ---------------------------

let customerSearchTimer = null;
els.customerSearchInput.addEventListener('input', () => {
  clearTimeout(customerSearchTimer);
  const term = els.customerSearchInput.value.trim();
  if (term.length < 2) {
    els.customerResults.innerHTML = '';
    return;
  }
  customerSearchTimer = setTimeout(() => searchCustomers(term), 300);
});

async function searchCustomers(term) {
  els.customerResults.innerHTML = '<p class="empty-hint">Aranıyor...</p>';
  try {
    const res = await fetch(`${API_BASE_URL}/api/agent/v3-customers?search=${encodeURIComponent(term)}`, {
      headers: { Authorization: `Bearer ${state.agent?.token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Arama başarısız.');
    renderCustomerResults(data);
  } catch (err) {
    els.customerResults.innerHTML = `<p class="empty-hint">${err.message}</p>`;
  }
}

function renderCustomerResults(customers) {
  els.customerResults.innerHTML = '';
  if (customers.length === 0) {
    els.customerResults.innerHTML = '<p class="empty-hint">Sonuç bulunamadı.</p>';
    return;
  }
  for (const c of customers) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'result-row';
    row.innerHTML = `${c.cariAdi}<span class="cari-kodu"></span>`;
    row.querySelector('.cari-kodu').textContent = c.cariKodu;
    row.addEventListener('click', () => {
      state.customer = c;
      els.selectedCustomerText.textContent = c.cariAdi;
      els.roomCodeInput.value = '';
      showScreen('connect');
    });
    els.customerResults.appendChild(row);
  }
}

els.changeCustomerBtn.addEventListener('click', () => {
  state.customer = null;
  showScreen('customer');
});

// --------------------------- Baglanti kurma ---------------------------

els.connectBtn.addEventListener('click', () => {
  const roomCode = els.roomCodeInput.value.trim();
  if (!roomCode) {
    els.connectError.textContent = 'Lütfen müşteriden aldığınız kodu girin.';
    els.connectError.classList.remove('hidden');
    return;
  }
  els.connectError.classList.add('hidden');
  connect(roomCode);
});

function connect(roomCode) {
  if (state.ws) return;
  state.roomCode = roomCode;
  els.connectBtn.disabled = true;
  setStatus('Bağlanıyor...', 'connecting');

  const ws = new WebSocket(SIGNAL_URL);
  state.ws = ws;

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', roomCode, role: 'viewer' }));
  };

  ws.onclose = () => { if (state.ws === ws) disconnect('Sinyal sunucusu bağlantısı kapandı.'); };
  ws.onerror = () => { if (state.ws === ws) disconnect('Sinyal sunucusuna bağlanılamadı.'); };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case 'joined':
        setupPeerConnection();
        break;
      case 'offer':
        await handleOffer(msg);
        break;
      case 'ice-candidate':
        if (msg.candidate) {
          try { await state.pc.addIceCandidate(msg.candidate); } catch {}
        }
        break;
      case 'peer-left':
        disconnect('Karşı taraf bağlantıyı kapattı.');
        break;
      case 'error':
        disconnect(msg.message);
        break;
    }
  };
}

function setupPeerConnection() {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  state.pc = pc;

  pc.onicecandidate = (e) => {
    if (e.candidate) state.ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate }));
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      setStatus('Bağlandı', 'connected');
      showScreen('session');
      setupTouchControl();
      startTicket();
    } else if (['failed', 'closed'].includes(pc.connectionState)) {
      disconnect('Bağlantı koptu.');
    }
  };

  pc.ontrack = (e) => { els.remoteVideo.srcObject = e.streams[0]; };

  pc.ondatachannel = (e) => {
    if (e.channel.label === 'control') bindControlChannel(e.channel);
    if (e.channel.label === 'files') bindFileChannel(e.channel);
  };
}

async function handleOffer(msg) {
  const pc = state.pc;
  await pc.setRemoteDescription(new RTCSessionDescription(msg.description));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  state.ws.send(JSON.stringify({ type: 'answer', description: answer }));
}

els.disconnectBtn.addEventListener('click', () => disconnect('Bağlantı sonlandırıldı.'));

function disconnect(reason) {
  if (state.disconnecting) return;
  state.disconnecting = true;

  if (state.pc) state.pc.close();
  if (state.ws) state.ws.close();
  state.pc = null;
  state.ws = null;
  state.controlChannel = null;
  state.fileChannel = null;
  els.remoteVideo.srcObject = null;
  els.connectBtn.disabled = false;
  setStatus('Bağlı değil', 'disconnected');

  const ticketId = state.currentTicketId;
  state.currentTicketId = null;

  if (ticketId) {
    showClosingForm(ticketId);
  } else {
    resetToConnectScreen();
  }
  state.disconnecting = false;
}

function resetToConnectScreen() {
  els.filePanel.classList.add('hidden');
  els.roomCodeInput.value = '';
  showScreen(state.customer ? 'connect' : 'customer');
}

// --------------------------- Dokunmatik uzaktan kontrol ---------------------------

function setupTouchControl() {
  const video = els.remoteVideo;
  let lastMoveSent = 0;

  function positionFromTouch(touch) {
    const rect = video.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (touch.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (touch.clientY - rect.top) / rect.height));
    return { x, y };
  }

  els.videoWrap.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const { x, y } = positionFromTouch(e.touches[0]);
    sendInput({ type: 'mousemove', x, y });
    sendInput({ type: 'mousedown', button: 0 });
  }, { passive: false });

  els.videoWrap.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const now = performance.now();
    if (now - lastMoveSent < 25) return;
    lastMoveSent = now;
    const { x, y } = positionFromTouch(e.touches[0]);
    sendInput({ type: 'mousemove', x, y });
  }, { passive: false });

  els.videoWrap.addEventListener('touchend', (e) => {
    e.preventDefault();
    sendInput({ type: 'mouseup', button: 0 });
  }, { passive: false });

  setTimeout(() => els.controlHint.classList.add('hidden'), 3000);
}

function sendInput(evt) {
  if (state.controlChannel && state.controlChannel.readyState === 'open') {
    state.controlChannel.send(JSON.stringify(evt));
  }
}

function bindControlChannel(channel) {
  state.controlChannel = channel;
}

// --------------------------- Destek kayitlari (biletler) ---------------------------

async function startTicket() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/agent/tickets/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.agent?.token}` },
      body: JSON.stringify({
        roomCode: state.roomCode,
        cariKodu: state.customer?.cariKodu,
        cariAdi: state.customer?.cariAdi,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      state.currentTicketId = data.ticketId;
      state.ticketCustomerNote = data.customerNote || '';
      state.ticketCustomerPhone = data.customerPhone || '';
      state.ticketCustomerFullName = data.customerFullName || '';
    }
  } catch {}
}

function showClosingForm(ticketId) {
  els.closingOverlay.dataset.ticketId = ticketId;

  const noteParts = [];
  if (state.ticketCustomerFullName || state.ticketCustomerPhone) {
    noteParts.push([state.ticketCustomerFullName, state.ticketCustomerPhone].filter(Boolean).join(' — '));
  }
  if (state.ticketCustomerNote) noteParts.push(state.ticketCustomerNote);
  if (noteParts.length) {
    els.closingCustomerRequestText.textContent = noteParts.join(' · ');
    els.closingCustomerRequestRow.classList.remove('hidden');
  } else {
    els.closingCustomerRequestText.textContent = '';
    els.closingCustomerRequestRow.classList.add('hidden');
  }

  els.closingOverlay.classList.remove('hidden');
}

els.closingSaveBtn.addEventListener('click', async () => {
  const ticketId = els.closingOverlay.dataset.ticketId;
  const status = els.closingStatus.value;
  const note = els.closingNote.value.trim();

  els.closingSaveBtn.disabled = true;
  try {
    await fetch(`${API_BASE_URL}/api/agent/tickets/${ticketId}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.agent?.token}` },
      body: JSON.stringify({ status, note }),
    });
  } catch {}
  els.closingSaveBtn.disabled = false;
  els.closingNote.value = '';
  els.closingOverlay.classList.add('hidden');
  resetToConnectScreen();
});

// --------------------------- Dosya menusu ---------------------------

els.fileMenuBtn.addEventListener('click', () => {
  els.filePanel.classList.toggle('hidden');
});

// --------------------------- Dosya aktarimi (files channel) ---------------------------
//
// Ayni protokol masaustu uygulamasiyla birebir aynidir:
//  1) Gonderen  -> {type:'file-offer', transferId, name, size}
//  2) Alan taraf -> {type:'file-accept', transferId, accepted}
//  3) Kabul edildiyse art arda binary parcalar: [8 byte transferId][veri]
// Tek fark: masaustunde dosyalar diske Node ile yazilir, burada tarayicinin
// kendi indirme mekanizmasi (Blob + <a download>) kullanilir.

function bindFileChannel(channel) {
  state.fileChannel = channel;
  channel.binaryType = 'arraybuffer';

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

els.sendFileBtn.addEventListener('click', () => els.fileInput.click());

els.fileInput.addEventListener('change', () => {
  const file = els.fileInput.files[0];
  els.fileInput.value = '';
  if (file) sendFileObject(file);
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
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const buf = await slice.arrayBuffer();
    const payload = new Uint8Array(buf);

    const packet = new Uint8Array(HEADER_LEN + payload.length);
    packet.set(idBytes, 0);
    packet.set(payload, HEADER_LEN);

    while (channel.bufferedAmount > 4 * 1024 * 1024) {
      await new Promise((r) => setTimeout(r, 15));
    }

    channel.send(packet);
    offset += payload.length;
    updateTransferProgress(transferId, offset / file.size);
  }
}

async function handleIncomingFileOffer(msg) {
  addTransferRow(msg.transferId, msg.name, msg.size, 'in');
  state.receivingTransfers.set(msg.transferId, {
    name: msg.name,
    size: msg.size,
    received: 0,
    chunks: [],
  });
  state.fileChannel.send(JSON.stringify({ type: 'file-accept', transferId: msg.transferId, accepted: true }));
  updateTransferStatus(msg.transferId, 'Alınıyor...');
}

function handleFileAccept(msg) {
  const pending = state.pendingFileAccepts.get(msg.transferId);
  if (pending) {
    pending.resolve(msg.accepted);
    state.pendingFileAccepts.delete(msg.transferId);
  }
}

function handleIncomingFileChunk(buf) {
  const bytes = new Uint8Array(buf);
  const decoder = new TextDecoder();
  const transferId = decoder.decode(bytes.subarray(0, HEADER_LEN));
  const payload = bytes.subarray(HEADER_LEN);

  const entry = state.receivingTransfers.get(transferId);
  if (!entry) return;

  entry.chunks.push(payload.slice());
  entry.received += payload.length;
  updateTransferProgress(transferId, entry.received / entry.size);

  if (entry.received >= entry.size) {
    const blob = new Blob(entry.chunks);
    const url = URL.createObjectURL(blob);
    updateTransferProgress(transferId, 1, true);
    updateTransferStatus(transferId, 'Tamamlandı.', false, url, entry.name);
    state.receivingTransfers.delete(transferId);
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

function updateTransferStatus(transferId, text, rejected, downloadUrl, downloadName) {
  const row = document.getElementById(`transfer-${transferId}`);
  if (!row) return;
  const statusEl = row.querySelector('.status-text');
  statusEl.textContent = text;
  if (rejected) row.querySelector('.progress-fill').classList.add('rejected');

  if (downloadUrl) {
    const link = document.createElement('a');
    link.className = 'download-link';
    link.href = downloadUrl;
    link.download = downloadName || 'dosya';
    link.textContent = 'İndir';
    statusEl.after(link);
  }
}
