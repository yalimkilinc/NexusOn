// NexusOn - Renderer surec: WebRTC baglantisi, ekran goruntuleme, uzaktan kontrol
// ve dosya gonderme/alma mantiginin tamami burada.
//
// RTCPeerConnection + STUN (Google'in herkese acik, ucretsiz STUN sunucusu) +
// TURN (Metered.ca, ucretsiz katman) taniml WebRTC standardi.
//
// TURN NEDEN GEREKLI: STUN sadece iki taraf DOGRUDAN (P2P) baglanabildiginde
// ise yarar. Simetrik NAT ya da UDP'yi kisitlayan kurumsal guvenlik duvarlari
// arkasindaki musterilerde dogrudan baglanti hicbir zaman kurulamaz - bu
// durumda ICE muzakeresi sessizce "connecting" durumunda takili kalir (canli
// bir musteri olayinda dogrulandi). TURN, sadece dogrudan baglanti basarisiz
// oldugunda devreye girer ve veriyi iki taraf arasinda relay eder - veri hala
// uctan uca sifrelidir (DTLS/SRTP), sadece paketler bu sunucu uzerinden gecer.
// Cogu baglanti hala tamamen P2P kalir ve TURN'den hic gecmez.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'turn:standard.relay.metered.ca:80', username: '6ec2b1b1fca62c68aa200026', credential: 'aXaf2/zoQEKwoErW' },
  { urls: 'turn:standard.relay.metered.ca:80?transport=tcp', username: '6ec2b1b1fca62c68aa200026', credential: 'aXaf2/zoQEKwoErW' },
  { urls: 'turn:standard.relay.metered.ca:443', username: '6ec2b1b1fca62c68aa200026', credential: 'aXaf2/zoQEKwoErW' },
  { urls: 'turns:standard.relay.metered.ca:443?transport=tcp', username: '6ec2b1b1fca62c68aa200026', credential: 'aXaf2/zoQEKwoErW' },
];

// ONEMLI (CANLI KANITLANDI - CDP JS profiler ile, iki gercek NexusOn
// kopyasi uretim sinyal/TURN sunuculari uzerinden birbirine baglanarak
// olculdu): destek personelinin "kendi penceresi baglandiktan sonra da
// yavas/donuk hissediyor" sikayetinin somut, olculmus bir bileseni burada
// bulundu - "Bağlan"a basildigi TAM ANDA (setupPeerConnection icindeki
// 'new RTCPeerConnection(...)' cagrisinda) 500-900ms suren, TUM ana is
// parcacigini (dolayisiyla butun pencereyi - tiklamalar, video, her sey)
// bloke eden senkron bir donma vardi. Sebep: bir RTCPeerConnection'a acikca
// bir sertifika verilmezse, tarayici o surecte kullanacagi ilk DTLS
// sertifikasini SENKRON olarak kendisi uretiyor (bilinen, WebRTC'nin
// kendisinin de belgeledigi bir maliyet) - ve bu surec basina sadece BIR
// KERE oluyor (izole testte, ayni surecte ikinci bir RTCPeerConnection
// kurulumu <1ms surdu). Kalici/mimari cozum (WebRTC'nin kendi onerdigi
// yontem): sertifikayi kullanicinin hicbir sey yapmadigi, uygulamanin daha
// yeni actigi bu anda arka planda ONCEDEN urettiriyoruz - connect() cagrildiginda
// bu Promise neredeyse HER ZAMAN coktan cozulmus oluyor (kullanicinin rol
// secip, giris yapip, "Bağlan"a basmasi bile bunun onune gecmeye yetiyor),
// boylece asil baglanti kurulum ani artik hicbir sekilde bloke olmuyor.
const rtcCertificatePromise = (typeof RTCPeerConnection !== 'undefined' && RTCPeerConnection.generateCertificate)
  ? RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' }).catch(() => null)
  : Promise.resolve(null);

// "Destek Vermek Icin" (viewer/personel) rolu musteri kurulumunda (varsayilan,
// herkese acik indirme linki) HIC gorunmemeli/calismamali - bkz. variant.js,
// package.json'daki "dist" (musteri) vs "dist:staff" (personel, ayri
// kurulum dosyasi) komutlari. Dosyanin en basinda tanimli ki her yerden
// (rol secimi, guncelleme kontrolu - dogru varyantin indirme linkini almak
// icin) erisilebilsin.
const IS_STAFF_BUILD = window.NEXUSON_VARIANT === 'staff';

const CHUNK_SIZE = 16 * 1024; // 16 KB - veri kanali icin guvenli parca boyutu
const HEADER_LEN = 8; // her binary dosya parcasinin basindaki transferId etiketi
// NOT: "localhost" yalnizca sunucularla AYNI bilgisayarda calisir. Baska bir
// bilgisayardan baglanabilmesi icin bu sunucularin calistigi bilgisayarin
// gercek ag adresi (LAN IP ya da gercek bir sunucu adresi) kullanilmali.
const DEFAULT_SERVER_URL = 'wss://nexuson.abyazilim.com.tr:11085'; // musteri (host) ekraninda gizli, sabit deger
const API_BASE_URL = 'https://nexuson.abyazilim.com.tr:11086'; // admin panel: icerik, ajan girisi, destek kayitlari
const CONTENT_API_URL = `${API_BASE_URL}/api/public/content?variant=${IS_STAFF_BUILD ? 'staff' : 'customer'}`;

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
  'NexusOn ile uzaktan destek artık çok daha hızlı.',
  'Destek ekibimiz hafta içi 09:00–18:00 arası hizmet vermektedir.',
  'Sorularınız için WhatsApp hattımızdan bize ulaşabilirsiniz.',
];

// Gorsel slider icin placeholder icerik. imageUrl bos ise degrade arka plan
// kullanilir. Admin panel baglandiginda gercek gorsellerle degistirilecek.
const DEFAULT_SLIDES = [
  { imageUrl: null, text: 'NexusOn ile uzaktan destek deneyimini yükseltin.' },
  { imageUrl: null, text: 'Hızlı, güvenli ve kesintisiz bağlantı.' },
  { imageUrl: null, text: 'Destek ekibimiz her zaman yanınızda.' },
];
const HERO_AUTOPLAY_MS = 6000;

const els = {
  statusBadge: document.getElementById('statusBadge'),
  setupPanel: document.getElementById('setupPanel'),
  sessionPanel: document.getElementById('sessionPanel'),
  roleChoice: document.getElementById('roleChoice'),
  roleHostBtn: document.getElementById('roleHostBtn'),
  roleViewerBtn: document.getElementById('roleViewerBtn'),
  hostSetup: document.getElementById('hostSetup'),
  agentLogin: document.getElementById('agentLogin'),
  agentUsernameInput: document.getElementById('agentUsernameInput'),
  agentPasswordInput: document.getElementById('agentPasswordInput'),
  agentLoginBtn: document.getElementById('agentLoginBtn'),
  agentLoginError: document.getElementById('agentLoginError'),
  agentUsernameLabel: document.getElementById('agentUsernameLabel'),
  agentLogoutBtn: document.getElementById('agentLogoutBtn'),
  customerSelect: document.getElementById('customerSelect'),
  agentUsernameLabel2: document.getElementById('agentUsernameLabel2'),
  agentLogoutBtn2: document.getElementById('agentLogoutBtn2'),
  changePasswordBtn: document.getElementById('changePasswordBtn'),
  changePasswordBtn2: document.getElementById('changePasswordBtn2'),
  changePasswordOverlay: document.getElementById('changePasswordOverlay'),
  currentPasswordInput: document.getElementById('currentPasswordInput'),
  newPasswordInput: document.getElementById('newPasswordInput'),
  newPasswordConfirmInput: document.getElementById('newPasswordConfirmInput'),
  changePasswordError: document.getElementById('changePasswordError'),
  changePasswordSuccess: document.getElementById('changePasswordSuccess'),
  changePasswordSaveBtn: document.getElementById('changePasswordSaveBtn'),
  changePasswordCancelBtn: document.getElementById('changePasswordCancelBtn'),
  customerSearchInput: document.getElementById('customerSearchInput'),
  customerSearchResults: document.getElementById('customerSearchResults'),
  selectedCustomerLabel: document.getElementById('selectedCustomerLabel'),
  changeCustomerBtn: document.getElementById('changeCustomerBtn'),
  viewerSetup: document.getElementById('viewerSetup'),
  hostRequestCategory: document.getElementById('hostRequestCategory'),
  hostRequestNote: document.getElementById('hostRequestNote'),
  hostCodeDisplay: document.getElementById('hostCodeDisplay'),
  hostCodeValue: document.getElementById('hostCodeValue'),
  hostErrorText: document.getElementById('hostErrorText'),
  copyCodeBtn: document.getElementById('copyCodeBtn'),
  roomCodeInput: document.getElementById('roomCodeInput'),
  viewerConnectBtn: document.getElementById('viewerConnectBtn'),
  sessionTabsRail: document.getElementById('sessionTabsRail'),
  sessionTabsToggleBtn: document.getElementById('sessionTabsToggleBtn'),
  sessionTabs: document.getElementById('sessionTabs'),
  roleBadge: document.getElementById('roleBadge'),
  updateBanner: document.getElementById('updateBanner'),
  updateBannerText: document.getElementById('updateBannerText'),
  updateVersionText: document.getElementById('updateVersionText'),
  updateNowBtn: document.getElementById('updateNowBtn'),
  updateBannerCloseBtn: document.getElementById('updateBannerCloseBtn'),
  appVersionText: document.getElementById('appVersionText'),
  videoWrap: document.getElementById('videoWrap'),
  remoteVideo: document.getElementById('remoteVideo'),
  hostPlaceholder: document.getElementById('hostPlaceholder'),
  allowControlCheckbox: document.getElementById('allowControlCheckbox'),
  controlHint: document.getElementById('controlHint'),
  remoteCursorDot: document.getElementById('remoteCursorDot'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  screenSelect: document.getElementById('screenSelect'),
  toggleLogBtn: document.getElementById('toggleLogBtn'),
  windowMinimizeBtn: document.getElementById('windowMinimizeBtn'),
  windowMaximizeBtn: document.getElementById('windowMaximizeBtn'),
  windowCloseBtn: document.getElementById('windowCloseBtn'),
  sendFileBtn: document.getElementById('sendFileBtn'),
  fileMenuBtn: document.getElementById('fileMenuBtn'),
  filePanel: document.getElementById('filePanel'),
  transferList: document.getElementById('transferList'),
  logPanel: document.getElementById('logPanel'),
  logBox: document.getElementById('logBox'),
  closingFormOverlay: document.getElementById('closingFormOverlay'),
  closingCustomerRequestRow: document.getElementById('closingCustomerRequestRow'),
  closingCustomerRequestText: document.getElementById('closingCustomerRequestText'),
  closingStatus: document.getElementById('closingStatus'),
  closingNote: document.getElementById('closingNote'),
  closingSaveBtn: document.getElementById('closingSaveBtn'),
  setupCard: document.getElementById('setupCard'),
  newsTicker: document.getElementById('newsTicker'),
  heroSlider: document.getElementById('heroSlider'),
  tickerTrack: document.getElementById('tickerTrack'),
  heroSlidesContainer: document.getElementById('heroSlidesContainer'),
  heroPrevBtn: document.getElementById('heroPrevBtn'),
  heroNextBtn: document.getElementById('heroNextBtn'),
  heroDots: document.getElementById('heroDots'),
  contactCard: document.getElementById('contactCard'),
  leftBottomCard: document.getElementById('leftBottomCard'),
  contactWhatsapp: document.getElementById('contactWhatsapp'),
  contactWebsite: document.getElementById('contactWebsite'),
  contactEmail: document.getElementById('contactEmail'),
  contactPhoneText: document.getElementById('contactPhoneText'),
  contactWebsiteText: document.getElementById('contactWebsiteText'),
  contactEmailText: document.getElementById('contactEmailText'),
  connectionRequestBtn: document.getElementById('connectionRequestBtn'),
  connectionRequestOverlay: document.getElementById('connectionRequestOverlay'),
  crPhoneStep: document.getElementById('crPhoneStep'),
  crPhoneInput: document.getElementById('crPhoneInput'),
  crPhoneError: document.getElementById('crPhoneError'),
  crPhoneContinueBtn: document.getElementById('crPhoneContinueBtn'),
  crCancelBtn1: document.getElementById('crCancelBtn1'),
  crLoginStep: document.getElementById('crLoginStep'),
  crLoginPhoneLabel: document.getElementById('crLoginPhoneLabel'),
  crLoginPasswordInput: document.getElementById('crLoginPasswordInput'),
  crLoginError: document.getElementById('crLoginError'),
  crLoginSubmitBtn: document.getElementById('crLoginSubmitBtn'),
  crCancelBtn2: document.getElementById('crCancelBtn2'),
  crRegisterStep: document.getElementById('crRegisterStep'),
  crRegisterNameInput: document.getElementById('crRegisterNameInput'),
  crRegisterPhoneLabel: document.getElementById('crRegisterPhoneLabel'),
  crRegisterTaxInput: document.getElementById('crRegisterTaxInput'),
  crRegisterPasswordInput: document.getElementById('crRegisterPasswordInput'),
  crKvkkCheckbox: document.getElementById('crKvkkCheckbox'),
  crRegisterError: document.getElementById('crRegisterError'),
  crRegisterSubmitBtn: document.getElementById('crRegisterSubmitBtn'),
  crCancelBtn3: document.getElementById('crCancelBtn3'),
  aboutOverlay: document.getElementById('aboutOverlay'),
  aboutVersionText: document.getElementById('aboutVersionText'),
  aboutSecurityLinkBtn: document.getElementById('aboutSecurityLinkBtn'),
  aboutCloseBtn: document.getElementById('aboutCloseBtn'),
};

if (window.nexuson.appVersion) {
  els.appVersionText.textContent = `v${window.nexuson.appVersion}`;
  els.aboutVersionText.textContent = `Sürüm v${window.nexuson.appVersion}`;
}

// Ust cubuktaki surum yazisina tiklayinca "Hakkinda" penceresi acilir -
// sirket bilgisi ve guvenlik/KVKK beyanina baglanti burada.
els.appVersionText.addEventListener('click', () => {
  els.aboutOverlay.classList.remove('hidden');
});
els.aboutCloseBtn.addEventListener('click', () => {
  els.aboutOverlay.classList.add('hidden');
});
els.aboutSecurityLinkBtn.addEventListener('click', () => {
  window.nexuson.openExternal(`${API_BASE_URL}/guvenlik.html`);
});

const state = {
  role: 'host',
  agent: null, // { username, token } - destek ekibi giris yaptiktan sonra dolar
  customer: null, // { cariKodu, cariAdi } - bir sonraki baglanti icin V3'ten secilen musteri
  pendingDeepLink: null, // Telegram'daki koda giris yapmadan once tiklanmissa, giristen sonra uygulanir

  // Musteri (host) tarafi hep TEK baglantilidir; baglanti alanlari dogrudan
  // burada tutulur (ayni bir "session" gibi davranir, ama coklanmaz).
  ws: null,
  pc: null,
  controlChannel: null,
  fileChannel: null,
  localStream: null,
  currentRoomCode: null,
  currentTicketId: null,
  disconnecting: false,
  disconnectedGraceTimer: null,
  statsInterval: null,
  dxgiCaptureInterval: null,
  pendingFileAccepts: new Map(),
  receivingTransfers: new Map(),

  // Destek ekibi (viewer) tarafi: ayni anda birden fazla musteriye
  // baglanabilmek icin her baglanti kendi "session" nesnesinde tutulur.
  viewerSessions: new Map(), // id -> session
  activeViewerSessionId: null,
};

// Host icin state'in kendisini, viewer icin aktif sekmenin session
// nesnesini dondurur - baglanti/kanal/dosya kodu boylece ikisi icin de
// ayni "ctx" seklinde yazilabilir.
function getActiveSession() {
  if (state.role === 'host') return state;
  return state.viewerSessions.get(state.activeViewerSessionId) || null;
}

function getActiveSessionKey() {
  return state.role === 'host' ? 'host' : state.activeViewerSessionId;
}

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

if (!IS_STAFF_BUILD) {
  els.roleChoice.classList.add('hidden');
}

// Windows'un kaldirilan kendi pencere dugmelerinin yerini alan ozel
// dugmeler (bkz. main.js frame:false, styles.css .window-controls).
els.windowMinimizeBtn.addEventListener('click', () => window.nexuson.windowMinimize());
els.windowMaximizeBtn.addEventListener('click', () => window.nexuson.windowMaximizeToggle());
els.windowCloseBtn.addEventListener('click', () => window.nexuson.windowClose());
window.nexuson.onWindowMaximizedState((isMaximized) => {
  els.windowMaximizeBtn.title = isMaximized ? 'Eski Boyuta Getir' : 'Büyüt';
  els.windowMaximizeBtn.setAttribute('aria-label', els.windowMaximizeBtn.title);
});

function setRole(role) {
  // Musteri kurulumunda (bkz. IS_STAFF_BUILD yukarida) viewer roluna GECIS
  // sadece butonu gizlemekle degil, burada da engellenmeli - aksi halde
  // beklenmedik bir kod yolu (ornegin bir deep link) yine de personel
  // ekranini acabilirdi.
  if (role === 'viewer' && !IS_STAFF_BUILD) return;
  state.role = role;
  els.roleHostBtn.classList.toggle('active', role === 'host');
  els.roleViewerBtn.classList.toggle('active', role === 'viewer');

  // Musteri (host) icin sade, tek butonlu ekran; destek ekibi (viewer) icin
  // once personel girisi, sonra kod girisi. Bilerek AYNI DEGIL.
  els.hostSetup.classList.toggle('hidden', role !== 'host');
  els.agentLogin.classList.toggle('hidden', !(role === 'viewer' && !state.agent));
  els.customerSelect.classList.toggle('hidden', !(role === 'viewer' && state.agent && !state.customer));
  els.viewerSetup.classList.toggle('hidden', !(role === 'viewer' && state.agent && state.customer));
  els.newsTicker.classList.toggle('hidden', role !== 'host'); // sadece musteri ekraninda
  els.contactCard.classList.toggle('hidden', role !== 'host');
  els.leftBottomCard.classList.toggle('hidden', role !== 'host');

  els.roleBadge.textContent = role === 'host' ? 'Müşteri' : 'Destek Ekibi';

  // Odak otomatik olarak dogru alana gitsin - personel fare ile tekrar
  // tiklamak zorunda kalmadan klavyeyle devam edebilsin.
  if (role === 'viewer' && state.agent && !state.customer) {
    els.customerSearchInput.focus();
  } else if (role === 'viewer' && state.agent && state.customer) {
    els.roomCodeInput.focus();
  }
}

// --------------------------- Destek personeli girisi ---------------------------

// Personel giris ekranindaki secim listesini admin panelde kayitli
// personelle doldurur - kullanici kendi adini/kodunu yazmak yerine listeden
// secer, sadece sifresini yazar. Panel calismiyorsa ya da ag erisimi yoksa
// sessizce bos birakilir (uygulama cokmez).
async function loadAgentList() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/public/agents`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const agents = await res.json();
    for (const a of agents) {
      const opt = document.createElement('option');
      opt.value = a.username;
      opt.textContent = a.fullName;
      els.agentUsernameInput.appendChild(opt);
    }
  } catch (err) {
    log('Personel listesi alınamadı. Sunucuya bağlanılamadığından giriş de yapılamayacaktır.');
  }
}
loadAgentList();

els.agentLoginBtn.addEventListener('click', async () => {
  const username = els.agentUsernameInput.value.trim();
  const password = els.agentPasswordInput.value;
  if (!username || !password) {
    els.agentLoginError.textContent = 'Kullanıcı adı ve şifre gerekli.';
    els.agentLoginError.classList.remove('hidden');
    return;
  }

  els.agentLoginBtn.disabled = true;
  els.agentLoginError.classList.add('hidden');

  try {
    const res = await fetch(`${API_BASE_URL}/api/agent-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Giriş başarısız.');

    // Cerez yerine token: NexusOn (file://) ile sunucu (http://) farkli kaynak
    // sayildigi icin tarayicilar capraz-kaynak cerezleri kisitlayabiliyor.
    // Token'i kendimiz saklayip her istekte Authorization basligiyla yolluyoruz.
    state.agent = { username: data.username, token: data.token };
    els.agentUsernameLabel.textContent = data.username;
    els.agentUsernameLabel2.textContent = data.username;
    els.agentPasswordInput.value = '';
    if (state.pendingDeepLink) {
      const pending = state.pendingDeepLink;
      state.pendingDeepLink = null;
      await applyDeepLink(pending);
    } else {
      setRole('viewer');
    }
  } catch (err) {
    els.agentLoginError.textContent = err.message.includes('fetch')
      ? 'Sunucuya ulaşılamadı. İnternet/ağ bağlantınızı kontrol edin.'
      : err.message;
    els.agentLoginError.classList.remove('hidden');
  } finally {
    els.agentLoginBtn.disabled = false;
  }
});

// Kullanici adi/sifre alanlarindan Enter ile de giris yapilabilsin - fare ile
// "Giris Yap" butonuna tiklamaya gerek kalmadan.
[els.agentUsernameInput, els.agentPasswordInput].forEach((input) => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.agentLoginBtn.click();
  });
});

function agentLogout() {
  fetch(`${API_BASE_URL}/api/agent-logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.agent?.token}` },
  }).catch(() => {});
  state.agent = null;
  state.customer = null;
  els.roomCodeInput.value = '';
  els.customerSearchInput.value = '';
  els.customerSearchResults.innerHTML = '';
  setRole('viewer');
}

els.agentLogoutBtn.addEventListener('click', agentLogout);
els.agentLogoutBtn2.addEventListener('click', agentLogout);

// --------------------------- Destek personeli: sifre degistirme ---------------------------

function openChangePasswordModal() {
  els.currentPasswordInput.value = '';
  els.newPasswordInput.value = '';
  els.newPasswordConfirmInput.value = '';
  els.changePasswordError.classList.add('hidden');
  els.changePasswordSuccess.classList.add('hidden');
  els.changePasswordOverlay.classList.remove('hidden');
}

els.changePasswordBtn.addEventListener('click', openChangePasswordModal);
els.changePasswordBtn2.addEventListener('click', openChangePasswordModal);

els.changePasswordCancelBtn.addEventListener('click', () => {
  els.changePasswordOverlay.classList.add('hidden');
});

els.changePasswordSaveBtn.addEventListener('click', async () => {
  const currentPassword = els.currentPasswordInput.value;
  const newPassword = els.newPasswordInput.value;
  const newPasswordConfirm = els.newPasswordConfirmInput.value;

  els.changePasswordError.classList.add('hidden');
  els.changePasswordSuccess.classList.add('hidden');

  if (!currentPassword || !newPassword) {
    els.changePasswordError.textContent = 'Mevcut ve yeni şifre gerekli.';
    els.changePasswordError.classList.remove('hidden');
    return;
  }
  if (newPassword !== newPasswordConfirm) {
    els.changePasswordError.textContent = 'Yeni şifreler birbiriyle eşleşmiyor.';
    els.changePasswordError.classList.remove('hidden');
    return;
  }

  els.changePasswordSaveBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/agent/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.agent?.token}`,
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Şifre değiştirilemedi.');

    els.changePasswordSuccess.classList.remove('hidden');
    els.currentPasswordInput.value = '';
    els.newPasswordInput.value = '';
    els.newPasswordConfirmInput.value = '';
    setTimeout(() => els.changePasswordOverlay.classList.add('hidden'), 1200);
  } catch (err) {
    els.changePasswordError.textContent = err.message.includes('fetch')
      ? 'Sunucuya ulaşılamadı. İnternet/ağ bağlantınızı kontrol edin.'
      : err.message;
    els.changePasswordError.classList.remove('hidden');
  } finally {
    els.changePasswordSaveBtn.disabled = false;
  }
});

// --------------------------- Musteri (cari) secimi ---------------------------

let customerSearchTimer = null;

els.customerSearchInput.addEventListener('input', () => {
  clearTimeout(customerSearchTimer);
  const term = els.customerSearchInput.value.trim();
  if (term.length < 2) {
    els.customerSearchResults.innerHTML = '';
    return;
  }
  customerSearchTimer = setTimeout(() => searchCustomers(term), 300);
});

// Arama sonuclari listeye dustukten sonra Asagi ok ile listeye gecilebilsin.
els.customerSearchInput.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown') return;
  const first = els.customerSearchResults.querySelector('.customer-result-row');
  if (first) {
    e.preventDefault();
    first.focus();
  }
});

async function searchCustomers(term) {
  els.customerSearchResults.innerHTML = '<p class="empty-hint">Aranıyor...</p>';
  try {
    const res = await fetch(`${API_BASE_URL}/api/agent/v3-customers?search=${encodeURIComponent(term)}`, {
      headers: { Authorization: `Bearer ${state.agent?.token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Arama başarısız.');
    renderCustomerResults(data);
  } catch (err) {
    els.customerSearchResults.innerHTML = '';
    const hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = err.message;
    els.customerSearchResults.appendChild(hint);
  }
}

function renderCustomerResults(customers) {
  els.customerSearchResults.innerHTML = '';
  if (customers.length === 0) {
    els.customerSearchResults.innerHTML = '<p class="empty-hint">Sonuç bulunamadı.</p>';
    return;
  }
  for (const c of customers) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'customer-result-row';
    // ONEMLI (guvenlik): c.cariAdi V3 veritabanindan geliyor - innerHTML ile
    // dogrudan basmak, cari adi HTML/script icerecek sekilde olusturulursa
    // (kazara ya da kotu niyetle) bir enjeksiyon yuzeyi acardi. textContent
    // ile guvenli sekilde ekliyoruz.
    row.appendChild(document.createTextNode(c.cariAdi));
    const cariKoduSpan = document.createElement('span');
    cariKoduSpan.className = 'cari-kodu';
    cariKoduSpan.textContent = c.cariKodu;
    row.appendChild(cariKoduSpan);
    row.addEventListener('click', () => selectCustomer(c));
    // Liste uzerinde Yukarı/Aşağı ok tuslariyla gezinme - Enter/Space zaten
    // odaklanmis bir <button>'i tarayicinin kendi varsayilan davranisiyla
    // tiklar, ayrica kod gerekmiyor.
    row.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = row.nextElementSibling;
        if (next && next.classList.contains('customer-result-row')) next.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = row.previousElementSibling;
        if (prev && prev.classList.contains('customer-result-row')) prev.focus();
        else els.customerSearchInput.focus();
      }
    });
    els.customerSearchResults.appendChild(row);
  }
}

async function selectCustomer(customer) {
  state.customer = customer;
  els.selectedCustomerLabel.textContent = customer.cariAdi;
  setRole('viewer');
  await fillPendingConnectionRequestCode(customer.cariKodu);
}

// Musteri "Bağlantı Talebi İlet" ile daha once bir talep birakmissa (Telegram
// bildirimindeki kod), destek personeli bu musteriyi secince kod alanina
// otomatik dolsun - personelin Telegram'a bakip kodu elle yazmasina gerek
// kalmasin. Bulunamazsa (talep yoksa ya da suresi gecmisse) sessizce hicbir
// sey yapmaz, alan bos/manuel kalir.
async function fillPendingConnectionRequestCode(cariKodu) {
  if (!cariKodu) return;
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/agent/pending-connection-request?cariKodu=${encodeURIComponent(cariKodu)}`,
      { headers: { Authorization: `Bearer ${state.agent?.token}` } }
    );
    if (!res.ok) return;
    const data = await res.json();
    if (data.found && data.roomCode) {
      els.roomCodeInput.value = data.roomCode;
      log(`Bağlantı talebinden kod otomatik dolduruldu: ${data.roomCode}`);
    }
  } catch (err) {
    // sessizce gec - kod manuel de girilebilir
  }
}

// --------------------------- Telegram derin baglanti (deep link) ---------------------------
//
// Telegram bildirimindeki "NexusOn'da Aç" tusuna tiklaninca nexuson://connect
// ile gelen bilgi (bkz. main.js). Personel zaten giris yapmissa doğrudan
// musteri+kodu doldurup baglanma ekranina goturur; giris yapmamissa once
// giris ekranini gosterip bilgiyi saklar, giris tamamlaninca otomatik uygular.
async function applyDeepLink({ roomCode, cariKodu, cariAdi }) {
  if (!state.agent) {
    state.pendingDeepLink = { roomCode, cariKodu, cariAdi };
    setRole('viewer');
    return;
  }
  if (cariKodu) {
    await selectCustomer({ cariKodu, cariAdi: cariAdi || cariKodu });
  } else {
    setRole('viewer');
  }
  if (roomCode) els.roomCodeInput.value = roomCode;
  log('Telegram bağlantısından NexusOn açıldı.');
}

window.nexuson.onDeepLink((payload) => applyDeepLink(payload));

els.changeCustomerBtn.addEventListener('click', () => {
  state.customer = null;
  els.roomCodeInput.value = '';
  setRole('viewer');
});

// --------------------------- Iletisim karti + duyuru seridi ---------------------------

els.contactPhoneText.textContent = CONTACT.phoneDisplay;
els.contactWebsiteText.textContent = CONTACT.websiteDisplay;
els.contactEmailText.textContent = CONTACT.email;

els.contactWhatsapp.addEventListener('click', () => window.nexuson.openExternal(CONTACT.whatsappUrl));
els.contactWebsite.addEventListener('click', () => window.nexuson.openExternal(CONTACT.websiteUrl));
els.contactEmail.addEventListener('click', () => window.nexuson.openExternal(`mailto:${CONTACT.email}`));

els.tickerTrack.textContent = NEWS_ITEMS.join('   •   ');

// --------------------------- Gorsel slider ---------------------------

const heroState = { slides: [], index: 0, timer: null };

function renderHeroSlides(slides) {
  heroState.slides = slides.length ? slides : DEFAULT_SLIDES;
  heroState.index = 0;

  els.heroSlidesContainer.innerHTML = '';
  els.heroDots.innerHTML = '';

  heroState.slides.forEach((slide, i) => {
    const slideEl = document.createElement('div');
    slideEl.className = 'hero-slide';

    if (slide.mediaType === 'video' && slide.mediaUrl) {
      const videoEl = document.createElement('video');
      videoEl.className = 'hero-slide-video';
      videoEl.src = slide.mediaUrl;
      videoEl.autoplay = true;
      videoEl.loop = true;
      videoEl.muted = true;
      videoEl.playsInline = true;
      slideEl.appendChild(videoEl);
    } else if (slide.mediaUrl || slide.imageUrl) {
      slideEl.style.backgroundImage = `url("${slide.mediaUrl || slide.imageUrl}")`;
    } else {
      slideEl.style.background = 'linear-gradient(135deg, #1d2c55, #4f7dff)';
    }

    slideEl.insertAdjacentHTML('beforeend', `<div class="hero-slide-overlay"></div><div class="hero-slide-text"></div>`);
    slideEl.querySelector('.hero-slide-text').textContent = slide.text || '';
    els.heroSlidesContainer.appendChild(slideEl);

    const dot = document.createElement('button');
    dot.className = 'hero-dot';
    dot.type = 'button';
    dot.addEventListener('click', () => goToHeroSlide(i));
    els.heroDots.appendChild(dot);
  });

  showHeroSlide(0);
  restartHeroAutoplay();
}

function showHeroSlide(index) {
  const n = heroState.slides.length;
  heroState.index = ((index % n) + n) % n;
  [...els.heroSlidesContainer.children].forEach((el, i) => {
    const isActive = i === heroState.index;
    el.classList.toggle('active', isActive);
    const videoEl = el.querySelector('.hero-slide-video');
    if (videoEl) {
      if (isActive) {
        videoEl.currentTime = 0;
        videoEl.play().catch(() => {});
      } else {
        videoEl.pause();
      }
    }
  });
  [...els.heroDots.children].forEach((el, i) => el.classList.toggle('active', i === heroState.index));
}

function goToHeroSlide(index) {
  showHeroSlide(index);
  restartHeroAutoplay();
}

function restartHeroAutoplay() {
  if (heroState.timer) clearInterval(heroState.timer);
  heroState.timer = setInterval(() => showHeroSlide(heroState.index + 1), HERO_AUTOPLAY_MS);
}

els.heroPrevBtn.addEventListener('click', () => goToHeroSlide(heroState.index - 1));
els.heroNextBtn.addEventListener('click', () => goToHeroSlide(heroState.index + 1));

renderHeroSlides(DEFAULT_SLIDES);

// Admin panelden guncel slayt/duyuru cekmeyi dene. Panel calismiyorsa ya da
// internet/ag erisimi yoksa sessizce yerel varsayilanlarla devam eder (cokmez).
async function loadRemoteContent() {
  try {
    const res = await fetch(CONTENT_API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (Array.isArray(data.news) && data.news.length > 0) {
      els.tickerTrack.textContent = data.news.join('   •   ');
    }
    if (Array.isArray(data.slides) && data.slides.length > 0) {
      renderHeroSlides(data.slides);
    }
    if (data.latestVersion && data.downloadUrl) {
      checkForUpdate(data.latestVersion, data.downloadUrl);
    }
    log('Admin panelden güncel içerik alındı.');
  } catch (err) {
    log('Admin panele ulaşılamadı, yerel varsayılan içerik kullanılıyor.');
  }
}

// "1.2.3" gibi surum dizilerini karsilastirir: a > b ise pozitif, esitse 0.
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function checkForUpdate(latestVersion, downloadUrl) {
  const currentVersion = window.nexuson.appVersion;
  if (!currentVersion || compareVersions(latestVersion, currentVersion) <= 0) return;

  els.updateVersionText.textContent = latestVersion;
  els.updateNowBtn.dataset.downloadUrl = downloadUrl;
  els.updateBanner.classList.remove('hidden');
}

els.updateNowBtn.addEventListener('click', async () => {
  const url = els.updateNowBtn.dataset.downloadUrl;
  if (!url) return;

  els.updateNowBtn.disabled = true;
  els.updateBannerText.textContent = 'Güncelleme indiriliyor, lütfen bekleyin...';
  try {
    // Basarili olursa uygulama kendini kapatir (yeni yukleyici acilir),
    // bu yuzden hata olmadan devam eden kod calismaz.
    await window.nexuson.downloadAndInstallUpdate(url);
  } catch (err) {
    els.updateBannerText.textContent = `Güncelleme indirilemedi: ${err.message}`;
    els.updateNowBtn.disabled = false;
  }
});

els.updateBannerCloseBtn.addEventListener('click', () => {
  els.updateBanner.classList.add('hidden');
});

loadRemoteContent();

// --------------------------- Baglanti kurma ---------------------------
//
// Musteri (host) tek tikla kod uretir + baglanir. Destek ekibi (viewer)
// musterinin verdigi kodu girip baglanir. Ikisi de ayni connect() akisini
// kullanir, sadece giris noktalari farkli.

// "Ne icin destek istiyorsunuz" alani: hazir kategorilerden biri secilirse
// onun metni not olarak kullanilir; "Diğer" secilirse serbest metin
// alani acilir ve onun degeri kullanilir.
els.hostRequestCategory.addEventListener('change', () => {
  const isOther = els.hostRequestCategory.value === 'diger';
  els.hostRequestNote.classList.toggle('hidden', !isOther);
  if (isOther) {
    els.hostRequestNote.value = '';
    els.hostRequestNote.focus();
  }
});

function getRequestNote() {
  const category = els.hostRequestCategory.value;
  if (!category) return '';
  if (category === 'diger') return els.hostRequestNote.value.trim();
  return category;
}

// Musteri (host) tarafinda hem "Paylaşımı Başlat" hem de "Bağlantı Talebi
// İlet" ayni kod uretme + baglanma akisini kullanir - ikinci butonun EK
// olarak yaptigi tek sey, firma adini destek ekibine Telegram ile bildirmek.
function startHostSharing() {
  els.hostErrorText.classList.add('hidden');
  const roomCode = String(Math.floor(100000 + Math.random() * 900000));
  els.hostCodeValue.textContent = roomCode;
  els.hostCodeDisplay.classList.remove('hidden');

  const requestNote = getRequestNote();
  if (requestNote) {
    // Panele ulasilamasa bile musteriyi bekletmeyelim; sessizce devam.
    fetch(`${API_BASE_URL}/api/public/room-note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, note: requestNote }),
    }).catch(() => {});
  }

  connect(roomCode, DEFAULT_SERVER_URL);
  return roomCode;
}

// --------------------------- Bağlantı Talebi İlet (musteri kayit/giris + Telegram bildirimi) ---------------------------
//
// Musteri ilk seferinde kayit olur (ad soyad, telefon, vergi no, sifre, KVKK
// onayi) - vergi numarasi V3'teki gercek cari kaydiyla eslesmek zorunda,
// firma adi oradan otomatik gelir (musteri kendisi yazmaz). Sonraki
// seferlerde sadece telefon+sifre ile "giris yapar". Kayitlar ABSupport'ta
// (bkz. admin-panel/server/absupport.js) tutulur. Musteri ekraninda
// Telegram'la ilgili hicbir metin/simge YOK - sadece normal "kod uretildi,
// baglaniliyor" akisini gorur.

function showCrStep(step) {
  els.crPhoneStep.classList.toggle('hidden', step !== 'phone');
  els.crLoginStep.classList.toggle('hidden', step !== 'login');
  els.crRegisterStep.classList.toggle('hidden', step !== 'register');
}

els.connectionRequestBtn.addEventListener('click', () => {
  els.crPhoneInput.value = '';
  els.crPhoneError.classList.add('hidden');
  els.crLoginPasswordInput.value = '';
  els.crLoginError.classList.add('hidden');
  els.crRegisterNameInput.value = '';
  els.crRegisterTaxInput.value = '';
  els.crRegisterPasswordInput.value = '';
  els.crKvkkCheckbox.checked = false;
  els.crRegisterError.classList.add('hidden');
  showCrStep('phone');
  els.connectionRequestOverlay.classList.remove('hidden');
  els.crPhoneInput.focus();
});

function closeConnectionRequestModal() {
  els.connectionRequestOverlay.classList.add('hidden');
}
els.crCancelBtn1.addEventListener('click', closeConnectionRequestModal);
els.crCancelBtn2.addEventListener('click', closeConnectionRequestModal);
els.crCancelBtn3.addEventListener('click', closeConnectionRequestModal);

// Baglanti talebini asil gonderen ortak adim: musteri kimligi (giris ya da
// kayit ile) belli olduktan SONRA cagrilir.
function finishConnectionRequest(customer) {
  closeConnectionRequestModal();
  const note = getRequestNote();
  const roomCode = startHostSharing();
  // Bildirim gonderilemese bile musteriyi bekletmeyelim; sessizce devam.
  fetch(`${API_BASE_URL}/api/public/connection-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomCode,
      cariKodu: customer.cariKodu,
      cariAdi: customer.cariAdi,
      note,
      telefon: customer.telefon,
      adSoyad: customer.adSoyad,
    }),
  }).catch(() => {});
}

// Musteri numarayi nasil yazarsa yazsin (basinda 0, 90, +90, hicbiri; arada
// bosluk/tire olsun olmasin) her tus vurusunda "+90 5XX XXX XX XX" bicimine
// (10 haneli Turk cep telefonu, 3-3-2-2 gruplu) otomatik cevirir.
function formatTurkishPhone(raw) {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0090')) digits = digits.slice(4);
  else if (digits.startsWith('90')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  const rest = digits.slice(0, 10);

  let out = '+90';
  if (rest.length > 0) out += ' ' + rest.slice(0, 3);
  if (rest.length > 3) out += ' ' + rest.slice(3, 6);
  if (rest.length > 6) out += ' ' + rest.slice(6, 8);
  if (rest.length > 8) out += ' ' + rest.slice(8, 10);
  return out;
}

els.crPhoneInput.addEventListener('input', () => {
  els.crPhoneInput.value = formatTurkishPhone(els.crPhoneInput.value);
});

// Tam bicim: +90, tek bosluk, 3 hane, bosluk, 3 hane, bosluk, 2 hane, bosluk, 2 hane.
const PHONE_FORMAT_RE = /^\+90 \d{3} \d{3} \d{2} \d{2}$/;

els.crPhoneContinueBtn.addEventListener('click', async () => {
  const telefon = els.crPhoneInput.value.trim();
  if (!PHONE_FORMAT_RE.test(telefon)) {
    els.crPhoneError.textContent = 'Lütfen geçerli bir telefon numarası girin (örn. +90 5XX XXX XX XX).';
    els.crPhoneError.classList.remove('hidden');
    return;
  }
  els.crPhoneError.classList.add('hidden');
  els.crPhoneContinueBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/public/customer/check-phone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefon }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sunucuya ulaşılamadı.');
    if (data.registered) {
      els.crLoginPhoneLabel.textContent = `Telefon: ${telefon}`;
      els.crLoginPasswordInput.value = '';
      els.crLoginError.classList.add('hidden');
      showCrStep('login');
      els.crLoginPasswordInput.focus();
    } else {
      els.crRegisterPhoneLabel.value = telefon;
      showCrStep('register');
      els.crRegisterNameInput.focus();
    }
  } catch (err) {
    els.crPhoneError.textContent = err.message.includes('fetch')
      ? 'Sunucuya ulaşılamadı. İnternet/ağ bağlantınızı kontrol edin.'
      : err.message;
    els.crPhoneError.classList.remove('hidden');
  } finally {
    els.crPhoneContinueBtn.disabled = false;
  }
});
els.crPhoneInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.crPhoneContinueBtn.click();
});

async function submitCrLogin() {
  const telefon = els.crPhoneInput.value.trim();
  const sifre = els.crLoginPasswordInput.value;
  if (!sifre) {
    els.crLoginError.textContent = 'Lütfen şifrenizi girin.';
    els.crLoginError.classList.remove('hidden');
    return;
  }
  els.crLoginError.classList.add('hidden');
  els.crLoginSubmitBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/public/customer/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefon, sifre }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Giriş başarısız.');
    finishConnectionRequest(data);
  } catch (err) {
    els.crLoginError.textContent = err.message.includes('fetch')
      ? 'Sunucuya ulaşılamadı. İnternet/ağ bağlantınızı kontrol edin.'
      : err.message;
    els.crLoginError.classList.remove('hidden');
  } finally {
    els.crLoginSubmitBtn.disabled = false;
  }
}
els.crLoginSubmitBtn.addEventListener('click', submitCrLogin);
els.crLoginPasswordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitCrLogin();
});

async function submitCrRegister() {
  const adSoyad = els.crRegisterNameInput.value.trim();
  const telefon = els.crPhoneInput.value.trim();
  const vergiNo = els.crRegisterTaxInput.value.trim();
  const sifre = els.crRegisterPasswordInput.value;
  const kvkkOnay = els.crKvkkCheckbox.checked;

  if (!adSoyad || !vergiNo || !sifre) {
    els.crRegisterError.textContent = 'Lütfen tüm alanları doldurun.';
    els.crRegisterError.classList.remove('hidden');
    return;
  }
  if (!kvkkOnay) {
    els.crRegisterError.textContent = 'Devam etmek için Gizlilik Sözleşmesi ve KVKK Onayı gerekli.';
    els.crRegisterError.classList.remove('hidden');
    return;
  }
  els.crRegisterError.classList.add('hidden');
  els.crRegisterSubmitBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/public/customer/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adSoyad, telefon, vergiNo, sifre, kvkkOnay }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Kayıt başarısız.');
    finishConnectionRequest(data);
  } catch (err) {
    els.crRegisterError.textContent = err.message.includes('fetch')
      ? 'Sunucuya ulaşılamadı. İnternet/ağ bağlantınızı kontrol edin.'
      : err.message;
    els.crRegisterError.classList.remove('hidden');
  } finally {
    els.crRegisterSubmitBtn.disabled = false;
  }
}
els.crRegisterSubmitBtn.addEventListener('click', submitCrRegister);

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

// Kod alanindan Enter ile de baglanilabilsin - fare ile "Bağlan" butonuna
// tiklamaya gerek kalmadan.
els.roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.viewerConnectBtn.click();
});

els.disconnectBtn.addEventListener('click', () => {
  const ctx = getActiveSession();
  if (!ctx) return;
  disconnectSession(ctx, state.role === 'host' ? null : ctx.id, 'Bağlantı sonlandırıldı.');
});

els.sessionTabsToggleBtn.addEventListener('click', () => {
  const collapsed = els.sessionTabsRail.classList.toggle('collapsed');
  els.sessionTabsToggleBtn.textContent = collapsed ? '›' : '‹';
  els.sessionTabsToggleBtn.title = collapsed ? 'Sekmeleri göster' : 'Sekmeleri gizle';
});

function lockSetupControls() {
  // Baglanti kurulduktan sonra rol degistirme / ikinci kez baglanma gibi
  // karisikliga yol acan islemleri kilitle (bir onceki ws acik kalip yeni
  // bir baglanti daha acilmasin diye).
  els.connectionRequestBtn.disabled = true;
  els.viewerConnectBtn.disabled = true;
  els.roleHostBtn.disabled = true;
  els.roleViewerBtn.disabled = true;
}

function unlockSetupControls() {
  els.connectionRequestBtn.disabled = false;
  els.viewerConnectBtn.disabled = false;
  els.roleHostBtn.disabled = false;
  els.roleViewerBtn.disabled = false;
}

// Host icin "ctx" dogrudan state'tir (tek baglanti). Viewer icin her
// connect() cagrisi yeni bir session nesnesi olusturur, boylece destek
// ekibi ayni anda birden fazla musteriye baglanabilir (ust tarafta sekmeler).
function connect(roomCode, serverUrl) {
  if (state.role === 'host') {
    if (state.ws) {
      log('Zaten bir bağlantı girişimi var, tekrar "Bağlan" tıklamanıza gerek yok.');
      return;
    }
    state.currentRoomCode = roomCode;
    lockSetupControls();
    startConnection(state, null, roomCode, serverUrl);
    return;
  }

  const session = createViewerSession(roomCode);
  renderSessionTabs();
  switchToSession(session.id);
  startConnection(session, session.id, roomCode, serverUrl);
}

function createViewerSession(roomCode) {
  const id = 'sess-' + Math.random().toString(36).slice(2, 9);
  const session = {
    id,
    roomCode,
    customer: state.customer, // baglanti aninda secili olan musteri "donduruluyor"
    ws: null,
    pc: null,
    controlChannel: null,
    fileChannel: null,
    localStream: null,
    remoteStream: null,
    currentTicketId: null,
    disconnecting: false,
    disconnectedGraceTimer: null,
    statsInterval: null,
    dxgiCaptureInterval: null,
    pendingFileAccepts: new Map(),
    receivingTransfers: new Map(),
  };
  state.viewerSessions.set(id, session);
  return session;
}

function startConnection(ctx, sessionId, roomCode, serverUrl) {
  // Musteri (host) kod uretip destek personelini beklerken "Bağlanıyor..."
  // yaniltici oluyordu (henuz kimse baglanmaya calismiyor, sadece bekleniyor).
  // Destek ekibi (viewer) icin ise gercekten aktif bir baglanti girisimi var,
  // o yuzden rol bazinda ayri metin/renk kullaniyoruz (ikisi de sari,
  // .status-connecting zaten sari - sadece metin degisiyor).
  setStatus(state.role === 'host' ? 'Beklemede' : 'Bağlanıyor...', 'connecting');
  log(`Sinyal sunucusuna bağlanılıyor: ${serverUrl}`);

  const ws = new WebSocket(serverUrl);
  ctx.ws = ws;

  ws.onopen = () => {
    log('Sinyal sunucusuna bağlandı, odaya katılınıyor...');
    ws.send(JSON.stringify({ type: 'join', roomCode, role: state.role }));
  };

  ws.onclose = () => {
    if (ctx.ws === ws) disconnectSession(ctx, sessionId, 'Sinyal sunucusu bağlantısı kapandı.');
  };
  ws.onerror = () => {
    if (ctx.ws === ws) disconnectSession(ctx, sessionId, 'Sinyal sunucusuna bağlanılamadı. Sunucu adresini/ağınızı kontrol edin.');
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'joined':
        log(`Odaya katılındı (rol: ${msg.role}). Şu anda odada ${msg.peers} başka katılımcı var.`);
        await setupPeerConnection(ctx, sessionId);
        if (state.role === 'host' && msg.peers > 0) {
          await startHostOffer(ctx, sessionId);
        }
        break;

      case 'peer-joined':
        log(`Karşı taraf odaya katıldı (rol: ${msg.role}).`);
        if (state.role === 'host') await startHostOffer(ctx, sessionId);
        break;

      case 'peer-left':
        disconnectSession(ctx, sessionId, 'Karşı taraf bağlantıyı kapattı.');
        break;

      case 'offer':
        await handleOffer(ctx, msg);
        break;

      case 'answer':
        await ctx.pc.setRemoteDescription(new RTCSessionDescription(msg.description));
        log('Bağlantı tamamlandı, ekran akışı bekleniyor...');
        break;

      case 'ice-candidate':
        if (msg.candidate) {
          try {
            await ctx.pc.addIceCandidate(msg.candidate);
          } catch (err) {
            console.error('ICE aday hatası:', err);
          }
        }
        break;

      case 'error':
        alert(msg.message);
        disconnectSession(ctx, sessionId, `Hata: ${msg.message}`);
        break;
    }
  };
}

async function setupPeerConnection(ctx, sessionId) {
  // ONEMLI (CANLI KANITLANDI - CDP JS profiler + performance.now() ile
  // olculdu): 'new RTCPeerConnection(...)' bir surecte SERTIFIKA VERILMEDEN
  // ilk cagrildiginda, tarayici kendi varsayilan DTLS sertifikasini SENKRON
  // olarak (ana is parcacigini tamamen bloke ederek) uretiyor. Bu makinede
  // olcduk: 500-900ms surdu, VE TAM O SIRADA butun pencere/tiklamalar/video
  // donuyordu - bu, destek personelinin "Bağlan"a tikladigi TAM ANDA
  // gerceklesiyor (setupPeerConnection HER YENI baglantida - hem host hem
  // viewer tarafinda - cagriliyor). Sertifika onceden (dosyanin en basinda,
  // kullanici daha rol bile secmeden) arka planda uretilip burada
  // kullanildiginda, ayni kurulum <1ms suruyor (asagida rtcCertificatePromise,
  // dosya basinda tanimli). Bu "tepki hizinin bir an donmasi" sikayetinin
  // olculmus, somut sebebiydi - band-aid degil, WebRTC'nin kendi onerdigi
  // (RTCPeerConnection.generateCertificate'i onceden cagirma) kalici cozum.
  const rtcCert = await rtcCertificatePromise;
  const pc = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
    ...(rtcCert ? { certificates: [rtcCert] } : {}),
  });
  ctx.pc = pc;

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ctx.ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate }));
    }
  };

  pc.onconnectionstatechange = () => {
    log(`Bağlantı durumu: ${pc.connectionState}`);
    window.nexuson.debugLog(
      `[pc] connectionState=${pc.connectionState} iceConnectionState=${pc.iceConnectionState} ` +
        `iceGatheringState=${pc.iceGatheringState} signalingState=${pc.signalingState} role=${state.role}`
    );
    if (pc.connectionState === 'connected') {
      if (ctx.disconnectedGraceTimer) {
        clearTimeout(ctx.disconnectedGraceTimer);
        ctx.disconnectedGraceTimer = null;
      }
      if (sessionId) renderSessionTabs();
      if (sessionId === null || sessionId === getActiveSessionKey()) {
        setStatus('Bağlantı kuruldu', 'connected');
        showSessionPanel();
      }
      if (state.role === 'viewer') startTicket(ctx);
    } else if (pc.connectionState === 'disconnected') {
      // 'disconnected' gecici bir ICE/DTLS kopmasi olabilir (ag sicramasi,
      // uyku/uyanma, NAT yeniden baglanmasi) ve kendi kendine 'connected'e
      // donebilir - ama hic 'failed'e de geçmeden SONSUZA KADAR bu halde
      // asili kalabiliyor: video son kareden donuyor, kontrol kanali artik
      // mesaj iletmiyor, ama UI hala "Bağlandı" gösterdigi icin kullanici
      // "ekran donuyor" diye deneyimliyor. Kisa bir toparlanma suresi
      // taniyoruz; toparlanmazsa acikca ve net bir mesajla sonlandiriyoruz.
      if (!ctx.disconnectedGraceTimer) {
        log('Bağlantı geçici olarak kesildi, toparlanması bekleniyor...');
        ctx.disconnectedGraceTimer = setTimeout(() => {
          ctx.disconnectedGraceTimer = null;
          if (ctx.pc === pc && (pc.connectionState === 'disconnected' || pc.connectionState === 'failed')) {
            disconnectSession(ctx, sessionId, 'Bağlantı koptu.');
          }
        }, 7000);
      }
    } else if (['failed', 'closed'].includes(pc.connectionState)) {
      if (ctx.disconnectedGraceTimer) {
        clearTimeout(ctx.disconnectedGraceTimer);
        ctx.disconnectedGraceTimer = null;
      }
      disconnectSession(ctx, sessionId, 'Bağlantı koptu.');
    }
  };

  pc.oniceconnectionstatechange = () => {
    window.nexuson.debugLog(`[pc] iceConnectionState değişti: ${pc.iceConnectionState}`);
  };

  // Her 3 saniyede bir gonderilen/alinan video akisinin gercek
  // cozunurluk/kare-hizi/bit-hizini loglar - "yavaslik" sikayetini somut
  // sayilarla teshis etmek icin.
  //
  // ONEMLI: jitterBufferDelay KUMULATIF bir sayactir (bytesReceived gibi) -
  // hic azalmaz, oturum boyunca surekli buyur. Bunu yanlislikla "su anki
  // gecikme" sanip onceki bir hata payi yasadik. Dogru "su anki ortalama
  // gecikme" iki ardisik ornekleme arasindaki FARKI (delta) alip
  // jitterBufferEmittedCount farkina bolerek bulunur.
  let prevJitter = null;
  let lastFramesEncoded = null;
  let stalledTicks = 0;
  const STALL_TICKS_BEFORE_RECOVERY = 3; // 3sn araliklarla ~9 saniye
  ctx.statsInterval = setInterval(async () => {
    if (!ctx.pc || ctx.pc !== pc) {
      clearInterval(ctx.statsInterval);
      return;
    }
    try {
      const stats = await pc.getStats();
      let selfSummary = null;
      stats.forEach((report) => {
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          window.nexuson.debugLog(
            `[stats] GONDERILEN video: ${report.frameWidth}x${report.frameHeight} ` +
              `${report.framesPerSecond}fps bytesSent=${report.bytesSent} qualityLimitationReason=${report.qualityLimitationReason}`
          );
          selfSummary = {
            role: state.role,
            kind: 'outbound',
            w: report.frameWidth,
            h: report.frameHeight,
            fps: report.framesPerSecond,
            bytesSent: report.bytesSent,
            qualityLimitationReason: report.qualityLimitationReason,
            encoderImplementation: report.encoderImplementation,
            totalEncodeTime: report.totalEncodeTime,
            framesEncoded: report.framesEncoded,
          };
        }
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          let windowedAvgMs = 'n/a';
          if (prevJitter) {
            const dDelay = report.jitterBufferDelay - prevJitter.delay;
            const dCount = report.jitterBufferEmittedCount - prevJitter.count;
            if (dCount > 0) windowedAvgMs = Math.round((dDelay / dCount) * 1000);
          }
          prevJitter = { delay: report.jitterBufferDelay, count: report.jitterBufferEmittedCount };
          window.nexuson.debugLog(
            `[stats] ALINAN video: ${report.frameWidth}x${report.frameHeight} ` +
              `${report.framesPerSecond}fps bytesReceived=${report.bytesReceived} ` +
              `guncelOrtalamaGecikme=${windowedAvgMs}ms framesDropped=${report.framesDropped}`
          );
        }
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
          window.nexuson.debugLog(
            `[stats] aktif aday çifti: currentRoundTripTime=${report.currentRoundTripTime} ` +
              `availableOutgoingBitrate=${report.availableOutgoingBitrate}`
          );
        }
      });
      // ONEMLI: karsi tarafin (ozellikle host - musterinin bilgisayari)
      // KENDI kodlama istatistiklerine (ozellikle qualityLimitationReason:
      // "cpu" mu "bandwidth" mi) dosya erisimi olmadan ulasmanin tek yolu bu -
      // zaten var olan kontrol kanalindan karsiya "kendi ozetini" gonderiyoruz.
      if (selfSummary && ctx.controlChannel && ctx.controlChannel.readyState === 'open') {
        try {
          ctx.controlChannel.send(JSON.stringify({ type: 'peer-stats', stats: selfSummary }));
        } catch {
          // kanal o an kapanmis olabilir, bir sonraki turda tekrar denenecek
        }
      }
      // Genel video-akisi-donmus izcisi: sadece host tarafinda.
      // ONEMLI (CANLI KANITLANDI - v1.2.19 VE v1.2.20'de bile hic
      // tetiklenmedi): eskiden burada "pc.connectionState === 'connected'"
      // sarti da vardi - musteride framesEncoded defalarca 10+ saniye sabit
      // kaldigi halde izci hic devreye girmedi, ve hicbir tanilama logu da
      // birakilmadigi icin SEBEBINI GOREMEDIK. En olasi aciklama:
      // connectionState bu spesifik oturumda tam olarak "connected" string'i
      // olmuyor (ornegin iceConnectionState ile connectionState farkli
      // zamanlanabiliyor). Gercekte onemli olan tek sey - RTCStats'tan
      // GECERLI bir outbound-rtp raporu (selfSummary) gelip gelmedigi - zaten
      // bunun kendisi baglantinin islevsel oldugunun kaniti, ayrica
      // connectionState string'ine guvenmeye gerek yok. Ayrica HER turda
      // (sadece tetiklenince degil) durumu logluyoruz - bir daha sessizce
      // basarisiz olursa en azindan NEDEN oldugunu gorebilelim.
      if (state.role === 'host' && selfSummary) {
        if (lastFramesEncoded !== null && selfSummary.framesEncoded === lastFramesEncoded) {
          stalledTicks++;
          window.nexuson.debugLog(
            `[capture] izci: framesEncoded degismedi (${selfSummary.framesEncoded}), stalledTicks=${stalledTicks}/${STALL_TICKS_BEFORE_RECOVERY} connectionState=${pc.connectionState}`
          );
          if (stalledTicks >= STALL_TICKS_BEFORE_RECOVERY) {
            stalledTicks = 0;
            window.nexuson.debugLog(
              `[capture] framesEncoded ${STALL_TICKS_BEFORE_RECOVERY * 3} saniyedir sabit (${selfSummary.framesEncoded}) - izci kurtarmayi tetikliyor`
            );
            recoverStalledDisplayMediaCapture(ctx);
          }
        } else {
          stalledTicks = 0;
        }
        lastFramesEncoded = selfSummary.framesEncoded;
      }
    } catch (err) {
      window.nexuson.debugLog(`[stats] getStats hatası: ${err.message}`);
    }
  }, 3000);

  // Viewer tarafi: host'un paylastigi ekran akisini burada alir
  pc.ontrack = (e) => {
    ctx.remoteStream = e.streams[0];
    if (sessionId === null || sessionId === getActiveSessionKey()) {
      els.remoteVideo.srcObject = e.streams[0];
    }

    // ONEMLI: WebRTC'nin jitter buffer'i varsayilan olarak AKICILIGI
    // (frame'leri asla atlamamayi) hedefler - bir kere geriye dusunce (agdaki/
    // kaynaktaki gecici bir duzensizlik yuzunden) bu gecikmeyi TELAFI ETMEZ,
    // sadece biriktirir (loglarda jitterBufferDelay ~10sn'ye kadar cikip orada
    // tavan yapiyordu - "goruntu inanilmaz yavas geliyor" sikayeti buydu).
    // Uzaktan destekte akicilik degil GUNCELLIK onemli: bu yuzden alici
    // tarafinda hedef arabellek suresini agresif sekilde dusuruyoruz; Chromium
    // bunun icin gecikmeyi yakalamak amaciyla gerekirse eski kareleri atlar.
    if (e.receiver) {
      try {
        // ONEMLI (CANLI KANITLANDI): hedef arabellek 0 iken, agdaki en ufak
        // teslimat duzensizligi (jitter) hicbir yumusatma olmadan direkt
        // ekrana yansiyordu - kullanicidan "fare hareketi aniden hizlanip
        // yavasliyor, bu hataya surukluyor" geri bildirimi geldi. Bu yuzden
        // 120ms'e cikarilmisti.
        //
        // GUNCELLEME (CANLI KANITLANDI): v1.2.24'te imlec artik bu arabellege
        // hic girmiyor - kendi yerel/aninda OS imlecimiz video'nun UZERINDE,
        // ayri, agdan bagimsiz gosteriliyor (bkz. AnyDesk/TeamViewer tasarimi
        // yorumu, startHostOffer). Yani 120ms'lik bu gecikme artik SADECE
        // ekran ICERIGINI (pencere degisimi, yazilan metin vb.) geciktiriyor,
        // imlec akiciligini degil - orijinal 120ms kararinin gerekcesi artik
        // gecerli degil. Kullanicidan "tepkime/geri donus suresi hala kotu,
        // personel icin tehlike yaratiyor" geri bildirimi geldi - guncel
        // ortalama gecikme raporlari (~150-200ms) buyuk olcude bu 120ms'lik
        // kasitli payi yansitiyordu. Kuyruk-tasmasi/tekrar-tusu sinifi
        // hatalar (bkz. v1.2.27/v1.2.30) artik duzeltildigi icin agin dogal
        // jitter'ini yutmak icin bu kadar buyuk bir paya ihtiyac yok - kucuk
        // bir degere dusuruyoruz.
        const targetMs = 30;
        e.receiver.playoutDelayHint = targetMs / 1000;
        if ('jitterBufferTarget' in e.receiver) e.receiver.jitterBufferTarget = targetMs;
        window.nexuson.debugLog(`[capture] receiver playoutDelayHint/jitterBufferTarget = ${targetMs}ms ayarlandı (akicilik icin)`);
      } catch (err) {
        window.nexuson.debugLog(`[capture] playoutDelayHint ayarlanamadı: ${err.message}`);
      }
    }
  };

  // Viewer tarafi: host'un actigi data channel'lari burada yakalar
  pc.ondatachannel = (e) => {
    if (e.channel.label === 'control') bindControlChannel(ctx, e.channel);
    if (e.channel.label === 'files') bindFileChannel(ctx, e.channel);
  };
}

// Ekran paylasimi icin kodlamayi mumkunse DONANIMLA hizlandirilabilen bir
// codec'e yonlendirir. H.264 donanim kodlayici (QuickSync/NVENC/AMF) hemen
// hemen her Intel/NVIDIA/AMD GPU'sunda mevcuttur; VP8 ona gore neredeyse
// HER ZAMAN yazilimla kodlanir ama VP9/AV1'den daha ucuzdur. Musteri
// makinesinin GPU'su/surucusu bilinmedigi icin oncelik: H264 -> VP8 ->
// (geri kalan varsayilan sira, orn. VP9/AV1). setCodecPreferences,
// createOffer'dan ONCE cagrilmali.
// ONEMLI: 'maintain-framerate' encoder'a "ag zorlanirsa kareyi dusurme, once
// netligi/kaliteyi feda et" diyordu - musteride bulanik goruntu sikayetinin
// dogrudan sebebi buydu. Uzaktan destek icin tam tersi dogru: 30fps yerine
// 15fps akan ama metnin/arayuzun net okunabildigi bir goruntu cok daha
// degerli. 'maintain-resolution' tam cozunurluk/netligi korur, gerekirse
// kare hizini dusurur. Native cozunurluk 1920x1080'i asiyorsa (bkz.
// startDxgiCapture / switch-screen), encoder'a GONDERILEN cozunurlugu
// (musterinin GERCEK Windows ekran ayari DEGISMEZ) burada sinirliyoruz -
// en-boy orani korunur. Ekran degistirildiginde (bkz. control channel
// 'switch-screen') de tekrar cagrilir, cunku yeni ekranin cozunurlugu
// oncekinden farkli olabilir.
function applyDxgiEncoderParams(ctx, sender) {
  const MAX_W = 1920, MAX_H = 1080;
  let scaleResolutionDownBy = 1;
  if (ctx.dxgiNativeWidth && ctx.dxgiNativeHeight) {
    scaleResolutionDownBy = Math.max(1, ctx.dxgiNativeWidth / MAX_W, ctx.dxgiNativeHeight / MAX_H);
  }
  sender
    .setParameters({
      ...sender.getParameters(),
      degradationPreference: 'maintain-resolution',
      encodings: [{ maxBitrate: 2_500_000, scaleResolutionDownBy }],
    })
    .then(() => window.nexuson.debugLog('[capture] sender.setParameters başarılı'))
    .catch((err) => window.nexuson.debugLog(`[capture] sender.setParameters HATASI: ${err.message}`));
}

function preferVp8Codec(pc, sender) {
  try {
    const transceiver = pc.getTransceivers().find((t) => t.sender === sender);
    if (!transceiver || !transceiver.setCodecPreferences) return;
    const { codecs } = RTCRtpSender.getCapabilities('video');
    const byMime = (mime) => codecs.filter((c) => c.mimeType.toLowerCase() === mime);
    const preferred = [...byMime('video/h264'), ...byMime('video/vp8')];
    const rest = codecs.filter((c) => !preferred.includes(c));
    if (preferred.length) {
      transceiver.setCodecPreferences([...preferred, ...rest]);
      window.nexuson.debugLog(
        `[capture] codec tercihi ayarlandı: ${preferred.map((c) => c.mimeType).join(', ')}`
      );
    }
  } catch (err) {
    window.nexuson.debugLog(`[capture] codec tercihi ayarlanamadı: ${err.message}`);
  }
}

// ONEMLI: getDisplayMedia (Chromium'un kendi ekran yakalamasi) "ekranda
// gorunur degisiklik yoksa kareyi atla" davranisi yuzunden donma/1fps
// sorununun kok nedeniydi (bkz. asagidaki startHostOffer yorumu) - bu
// gercek bir prova ile dogrulandi: Windows'un DXGI Desktop Duplication
// API'sini (native, GPU seviyesinde) dogrudan kullanan ayri bir yakalama
// yolu, ekranda hicbir sey degismese bile HER cagrida taze bir kare
// donduruyor (olculdu: ~17ms/kare, ~60fps tavan). Profesyonel uzaktan
// destek araclari (TeamViewer, AnyDesk, RustDesk) da tam olarak bu sekilde
// calisiyor - tarayici API'si degil, native DXGI.
//
// Native modul main sürecte (bkz. main.js `dxgi-init`/`dxgi-get-frame`)
// calisiyor; burada donen ham RGBA kareleri WebRTC'nin bekledigi bir video
// MediaStreamTrack'ine ceviriyoruz.
//
// ONEMLI (analiz): ilk denemede bunu <canvas> + putImageData() +
// canvas.captureStream() ile yapmistik - CANLI bir oturumda ~6-7 saniye
// sonra kare uretimi tamamen durdu (encoder "bandwidth" limitli sandi, kare
// sayisi sabit kaldi). Izole testte kanitlandi: native yakalamanin kendisi
// kusursuzdu (300 ardisik kare, hep ~15-20ms) - sorun putImageData'ydi: her
// karede 1920x1080'i (8MB) canvas'a cizmek, zamanla (muhtemelen GC baskisi/
// compositor rekabeti yuzunden) 15ms'den 1000ms+'ye yavaslayip ana JS olay
// dongusunu tikiyordu. Cozum: canvas'i tamamen atlayip WebCodecs'in
// VideoFrame + MediaStreamTrackGenerator API'lerini kullanmak - ham RGBA
// arabellegini dogrudan bir video karesine ceviriyor, 2D canvas compositing
// katmanina hic girmiyor. Izole testte 300+ kare boyunca stabil kaldi.
// ONEMLI (duzeltildi - bkz. nexusgo-freeze-history.md): once DXGI'nin kendi
// PointerPosition/hardwareCursorMode verisine gore karar veriyorduk. Bu,
// gercek bir musteri makinesinde CANLI TESTTE cursur: fare aktif surekli
// hareket ettirilirken bile 25 ardisik karede hep visible=false, x=0, y=0
// geldi - yani bu makinenin ekran karti/surucusu DXGI'ye imlec meta-verisini
// HIC doldurmuyor (bilinen bir donanim sinirlaması, kodumuzda hata degil).
// Sonuc: DXGI verisine guvenmek bazi makinelerde imleci HICBIR ZAMAN
// gostermiyordu. Cozum: imlec konumunu artik DXGI'den degil, dogrudan
// Windows'un kendisinden (nut-js'in zaten remote-input icin kullandigi
// guvenilir mouse.getPosition() kaynagi) okuyoruz - donanim/surucuden
// tamamen bagimsiz. Video akisindan TAMAMEN AYRI, control DataChannel
// uzerinden viewer'a gonderiliyor (AnyDesk/TeamViewer'in yaptigi gibi).
async function sendCursorPos(ctx) {
  if (!ctx.controlChannel || ctx.controlChannel.readyState !== 'open') return;
  try {
    const pos = await window.nexuson.getCursorPos();
    if (!pos || !pos.screenWidth || !pos.screenHeight) return;
    ctx.controlChannel.send(JSON.stringify({
      type: 'cursor-pos',
      visible: true,
      x: pos.x / pos.screenWidth,
      y: pos.y / pos.screenHeight,
    }));
  } catch {
    // gecici bir hata (ornegin nut-worker yeniden baslatiliyor) - bir sonraki
    // tikte tekrar denenir, oturumu bozmaya deger degil
  }
}

function fallbackDisplayMediaConstraints() {
  return {
    video: {
      width: { ideal: 1920, max: 1920 },
      height: { ideal: 1080, max: 1080 },
      frameRate: { ideal: 24, max: 30 },
    },
  };
}

// ONEMLI (CANLI KANITLANDI - bu son fix'lerden SONRA bile musteride
// tekrarlandi): DXGI yolunun kendi kendini onaran mekanizmasi
// (startDxgiCapture icindeki timeout/reinit/fallback) var, ama
// getDisplayMedia (yedek) yolunda BENZER HICBIR SEY yoktu - Chromium'un
// kendi ic tarafinda akis sessizce durursa (bilinen ama nadir bir
// desktopCapturer davranisi), bunu fark edip duzeltecek HICBIR kod
// calismiyordu. framesEncoded sonsuza kadar sabit kalip video donuyordu,
// hicbir hata da loglanmiyordu (cunku teknik olarak hicbir sey "hata"
// vermiyor, akis sadece yeni kare uretmeyi kesiyor). Zaten var olan 3
// saniyelik istatistik dongusunden (asagida, setupPeerConnection icinde)
// framesEncoded'in degismedigini tespit edip, gerekirse SIFIRDAN yeni bir
// getDisplayMedia akisi alip replaceTrack ile degistiren genel bir
// "izci" (watchdog) burada tanimlanıyor - hangi yoldan (ilk baslangicta
// DXGI basarisiz oldugu icin mi, yoksa oturum ortasinda mi) buraya
// gelindiginden bagimsiz calisir.
async function recoverStalledDisplayMediaCapture(ctx) {
  // ONEMLI (CANLI KANITLANDI - v1.2.19'da bile): "DXGI kendi ic kurtarma
  // mekanizmasina sahip, bu izci sadece getDisplayMedia aktifken devreye
  // girsin" varsayimi YANLIS cikti - musteride framesEncoded 40+ saniye
  // sabit kaldi ve DXGI'nin kendi ic kontrolu (sadece dxgiGetFrame()
  // cagrisinin BASARILI/BASARISIZ olmasina bakiyor) bunu hic yakalamadi.
  // Yani DXGI native yakalamasi "basariyla" kare uretiyor olabilir ama o
  // kareler encoder'a/WebRTC'ye bir sekilde ulasmiyordu - DXGI'nin kendi
  // ic sinyali bunun icin kor. Bu yuzden bu genel izci artik GERCEK YETKILI
  // KARAR MERCII: framesEncoded 9 saniyedir sabitse, DXGI ne yapiyor
  // olursa olsun (basarili gorunse bile) tamamen vazgecilip getDisplayMedia'ya
  // geciliyor - "encoder'a gercekten yeni kare ulasiyor mu" tek guvenilir
  // olcut, "ic capture cagrisi hata verdi mi" degil.
  if (ctx.dxgiCaptureInterval) {
    window.nexuson.debugLog('[capture] DXGI aktif gorunuyor ama kareler donmus - DXGI tamamen birakiliyor');
    clearInterval(ctx.dxgiCaptureInterval);
    ctx.dxgiCaptureInterval = null;
  }
  window.nexuson.debugLog('[capture] video akisi donmus gorunuyor - getDisplayMedia sifirdan yeniden aliniyor');
  try {
    const freshStream = await navigator.mediaDevices.getDisplayMedia(fallbackDisplayMediaConstraints());
    const freshTrack = freshStream.getVideoTracks()[0];
    if (ctx.dxgiSender) {
      await ctx.dxgiSender.replaceTrack(freshTrack);
      window.nexuson.debugLog('[capture] izci kurtarmasi basarili (replaceTrack)');
    }
    if (ctx.localStream) {
      ctx.localStream.getTracks().forEach((t) => {
        if (t !== freshTrack) t.stop();
      });
    }
    sendCaptureStatus(ctx, 'fallback', 'Video akışı donmuştu, yedek yakalamaya geçildi.');
    ctx.localStream = freshStream;
    els.videoWrap.classList.add('embedded-cursor');
  } catch (err) {
    window.nexuson.debugLog(`[capture] izci kurtarmasi HATASI: ${err.message}`);
  }
}

async function startDxgiCapture(ctx, targetFps) {
  const monitorCount = await window.nexuson.dxgiInit(0);
  window.nexuson.debugLog(`[dxgi] baslatildi, monitor sayisi: ${monitorCount}`);

  // ONEMLI: gercek/dusuk bant genisligi altinda (veya baska bir sebeple)
  // encoder/RTCRtpSender boru hatti kareleri bizim urettigimizden daha
  // yavas "tuketebiliyor", hatta bazen TAMAMEN tuketmeyi birakabiliyor
  // (writer.desiredSize kalici olarak <=0 kalabiliyor - gercek bir canli
  // oturumda kare sayisi 20+ saniye boyunca sabit kaldigi gozlemlendi,
  // qualityLimitationReason "none" oldugu halde). Once "await writer.write()
  // suresiz beklerse tum dongu kilitlenir" sorununu cozduk (desiredSize
  // kontrolu ile kareyi atla) - ama bu tek basina yetmedi: eger tuketici
  // GERCEKTEN kalici olarak durduysa, sonsuza kadar atlamaya devam ederiz,
  // goruntu hic ilerlemez. Bu yuzden bir "kendi kendini onarma" katmani
  // eklendi: art arda cok fazla kare atlanirsa (bkz. STALL_SKIP_THRESHOLD),
  // MediaStreamTrackGenerator'i SIFIRDAN olusturup RTCRtpSender.replaceTrack()
  // ile degistiriyoruz - boru hattinin kendisini "resetlemis" oluyoruz.
  const STALL_SKIP_THRESHOLD = Math.round(targetFps * 3); // ~3 saniyelik ardisik atlama

  let generator = new MediaStreamTrackGenerator({ kind: 'video' });
  let writer = generator.writable.getWriter();
  const outStream = new MediaStream([generator]);

  let consecutiveSkips = 0;
  let lastDesiredSizeLog = 0;

  async function recreateGenerator() {
    window.nexuson.debugLog('[dxgi] uretici (generator) sifirdan olusturuluyor - tuketici kalici olarak tikanmis gorunuyor');
    try {
      await writer.close();
    } catch {
      // eski yazici zaten bozulmus olabilir, onemli degil
    }
    generator = new MediaStreamTrackGenerator({ kind: 'video' });
    writer = generator.writable.getWriter();
    if (ctx.dxgiSender) {
      try {
        await ctx.dxgiSender.replaceTrack(generator);
        window.nexuson.debugLog('[dxgi] replaceTrack basarili');
      } catch (err) {
        window.nexuson.debugLog(`[dxgi] replaceTrack HATASI: ${err.message}`);
      }
    }
    consecutiveSkips = 0;
  }

  const writeFrame = async (frame) => {
    // ONEMLI (canli bir oturumda KANITLANDI): pencere kucultulup hemen
    // ardindan geri buyutulunce, Chromium'un kendisi MediaStreamTrackGenerator'in
    // yazilabilir akisini (writable stream) KALICI OLARAK KAPATIYOR -
    // "Failed to execute 'write' on 'UnderlyingSinkBase': Stream closed"
    // hatasi buradan geliyor. Bu, backpressure (desiredSize<=0, GECICI) ile
    // AYNI SEY DEGIL - kapanmis bir akis desiredSize=null dondurur VE bir
    // daha ASLA acilmiyor. Eski kod sadece backpressure durumunu
    // (desiredSize<=0) yakalayip kurtariyordu; desiredSize===null (kapanmis)
    // durumunu YAKALAMIYORDU - bu yuzden bu spesifik senaryoda (uzaktan
    // kucultme sonrasi geri buyutme) ekran KALICI donuyordu, hicbir zaman
    // kendiliginden duzelmiyordu. Simdi ikisini de ayri ayri ele aliyoruz:
    // kapanmis akis -> HEMEN (esik beklemeden) kurtar; backpressure -> once
    // birkac saniye atla, gecmezse kurtar.
    if (writer.desiredSize === null) {
      window.nexuson.debugLog('[dxgi] writer.desiredSize=null - akis kapanmis, HEMEN kurtariliyor');
      await recreateGenerator();
      return;
    }
    if (writer.desiredSize <= 0) {
      consecutiveSkips++;
      const now = performance.now();
      if (now - lastDesiredSizeLog > 1000) {
        lastDesiredSizeLog = now;
        window.nexuson.debugLog(`[dxgi] kare ATLANDI (${consecutiveSkips}) - writer.desiredSize=${writer.desiredSize}`);
      }
      if (consecutiveSkips >= STALL_SKIP_THRESHOLD) {
        await recreateGenerator();
      }
      return; // encoder gerideyse kareyi atla, kuyruk birikmesin/kilitlenmesin
    }
    consecutiveSkips = 0;
    const videoFrame = new VideoFrame(frame.data, {
      format: 'RGBA',
      codedWidth: frame.width,
      codedHeight: frame.height,
      timestamp: performance.now() * 1000,
    });
    try {
      await writer.write(videoFrame);
    } catch (err) {
      // yazma sirasinda beklenmedik BASKA bir hata (ornegin tam bu anda
      // akis kapandi) - guvenli tarafta kalip yine de kurtarmayi dene.
      window.nexuson.debugLog(`[dxgi] writer.write HATASI: ${err.message} - kurtarma deneniyor`);
      await recreateGenerator();
    } finally {
      videoFrame.close();
    }
  };

  const first = await window.nexuson.dxgiGetFrame();
  // ONEMLI (musteri geri bildirimi, AnyDesk ile hiz karsilastirmasi): DXGI
  // ekranin GERCEK (native) cozunurlugunde yakalar - 4K/2K bir musteri
  // ekraninda bu, sabit ~2.5 Mbps bant genisligi butcesine devasa kareler
  // sigdirmaya calisir, hem netlik hem akicilik ayni anda bozulur. Gercek
  // cozunurluk burada saklanip setupPeerConnection'daki sender.setParameters()
  // cagrisinda encodings[0].scaleResolutionDownBy ile (encoder'in kendi,
  // GPU hizlandirmali kucultmesi - manuel piksel islemeye GEREK YOK) en
  // fazla 1920x1080'e indiriliyor.
  ctx.dxgiNativeWidth = first.width;
  ctx.dxgiNativeHeight = first.height;
  await writeFrame(first);

  // ONEMLI (canli bir musteri oturumunda KANITLANDI): dxgiGetFrame() ->
  // main surecteki dxgiCapture.getFrameAsync() -> native AsyncWorker zincirinde
  // hicbir zaman asimi yoktu. Musterinin kendi penceresini uzaktan kucultup
  // hemen ardindan tikladigimiz bir oturumda, bu cagri SONSUZA KADAR ne
  // cozuldu ne reddedildi - "await" hic donmedi. Sonuc: "busy" bayragi
  // kalici olarak true kaldi, dongu her tikte "if (busy) return" ile hemen
  // cikti, HICBIR HATA LOGLANMADI (cunku hicbir sey reddedilmedi/atilmadi,
  // sadece hic bitmedi) ve hem video hem (asagidaki sendCursorPos'un o zaman
  // hala basari yoluna bagli olmasi yuzunden) imlec konumu ayni anda, kalici
  // olarak durdu - kendiliginden asla duzelmedi. Fix: native cagriyi bir
  // zaman asimiyla yarıstiriyoruz; zaman asimi olursa reddedilmis sayiyoruz
  // (finally hala calisir, busy sifirlanir, dongu tikanmiyor) ve art arda
  // birkac zaman asimi olursa DXGI'yi sifirdan yeniden baslatiyoruz (altta
  // yatan native yakalama nesnesi gercekten bozulmus olabilir).
  function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} zaman asimina ugradi (${ms}ms)`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  let consecutiveCaptureFailures = 0;
  let consecutiveReinitFailures = 0;
  let reinitBackoffUntil = 0;
  const CAPTURE_TIMEOUT_MS = 2000;
  const MAX_CAPTURE_FAILURES_BEFORE_REINIT = 2;
  // Musteride CANLI KANITLANDI: DXGI ilk baslangicta basarili olup oturum
  // ORTASINDA bozulabiliyor (ayni "Parametre hatali" / E_INVALIDARG). Eski
  // yedek-yontem (getDisplayMedia) sadece EN BASTAKI dxgiInit basarisiz
  // olursa devreye giriyordu - oturum ortasinda bozulursa musteri sonsuza
  // kadar bos/siyah ekranda kaliyordu (cokme artik yok ama goruntu de yok).
  // Bu yuzden art arda birkac tam yeniden baslatma denemesi de basarisiz
  // olursa, DXGI'den tamamen vazgecip AYNI oturumda (yeniden baglanmaya
  // gerek kalmadan) getDisplayMedia'ya gecis yapiyoruz.
  const MAX_REINIT_FAILURES_BEFORE_FALLBACK = 3;
  let fellBackToDisplayMedia = false;

  async function switchToDisplayMediaFallback() {
    if (fellBackToDisplayMedia) return;
    fellBackToDisplayMedia = true;
    window.nexuson.debugLog('[dxgi] DXGI kalici olarak bozuk - oturum ortasinda getDisplayMedia yedegine geciliyor');
    if (ctx.dxgiCaptureInterval) {
      clearInterval(ctx.dxgiCaptureInterval);
      ctx.dxgiCaptureInterval = null;
    }
    // ONEMLI (CANLI KANITLANDI, MAKRO oturumu): interval'i durdurmak
    // cursor-pos gonderimini de durduruyor, ama viewer tarafindaki kirmizi
    // gosterge en son aldigi konumda GORUNUR KALIYOR (gizlenmiyor) - "kirmizi
    // ilmec ekranda sabit duruyor" sikayeti buydu. Tek seferlik acik bir
    // "visible:false" mesaji gondermeden gostergeyi gizletecek hicbir yol
    // yok (viewer kendi DOM'unu host'un durumuna gore gunceller). Bu yuzden
    // yedege gecerken gostergeyi burada acikca kapatiyoruz.
    if (ctx.controlChannel && ctx.controlChannel.readyState === 'open') {
      ctx.controlChannel.send(JSON.stringify({ type: 'cursor-pos', visible: false }));
    }
    try {
      const fallbackStream = await navigator.mediaDevices.getDisplayMedia(fallbackDisplayMediaConstraints());
      const fallbackTrack = fallbackStream.getVideoTracks()[0];
      if (ctx.dxgiSender) {
        await ctx.dxgiSender.replaceTrack(fallbackTrack);
        window.nexuson.debugLog('[dxgi] getDisplayMedia yedegine gecis basarili (replaceTrack)');
      }
      ctx.localStream = fallbackStream;
      els.videoWrap.classList.add('embedded-cursor');
      sendCaptureStatus(ctx, 'fallback', 'DXGI kalıcı olarak bozuldu, yedek yakalamaya geçildi.');
    } catch (err) {
      window.nexuson.debugLog(`[dxgi] getDisplayMedia yedegine gecis HATASI: ${err.message}`);
    }
    // ONEMLI (CANLI KANITLANDI, MAKRO oturumu): buraya once "cursor-pos'u
    // burada da gonder" diye bir dongu eklenmisti, ama YANLISTI - musteri
    // ekraninda AYNI ANDA IKI imlec gorunmesine sebep oldu (kirmizi ok +
    // gercek imlec). Sebep: getDisplayMedia yolunda gercek imlec zaten HER
    // ZAMAN videonun icine gomulu geliyor (cursor:'never' Electron'da hicbir
    // zaman calismadi - bkz. electron/electron#7584, #14337, yukaridaki
    // eski yorumlar). remoteCursorDot gostergesi ise SADECE DXGI'nin
    // gercekten imleci videoya gommedigi durumlar icin var. getDisplayMedia
    // yedegine gecildiginde cursor-pos GONDERILMEMELI - aksi halde her
    // zaman cift imlec olur. Bilincli olarak burada hicbir seyi
    // baslatmiyoruz.
  }

  async function reinitDxgiCapture() {
    window.nexuson.debugLog('[dxgi] yakalama tikanmis/bozulmus gorunuyor - DXGI sifirdan yeniden baslatiliyor');
    try {
      await window.nexuson.dxgiInit(0);
      window.nexuson.debugLog('[dxgi] yeniden baslatma basarili');
      consecutiveReinitFailures = 0;
      // DXGI'ya geri donuldu - video artik imlec icermiyor, yerel imlec
      // tekrar gorunmeli.
      els.videoWrap.classList.remove('embedded-cursor');
      sendCaptureStatus(ctx, 'dxgi', 'DXGI yeniden başlatıldı, native yakalamaya dönüldü.');
    } catch (err) {
      consecutiveReinitFailures++;
      window.nexuson.debugLog(`[dxgi] yeniden baslatma HATASI (${consecutiveReinitFailures}): ${err.message}`);
      if (consecutiveReinitFailures >= MAX_REINIT_FAILURES_BEFORE_FALLBACK) {
        await switchToDisplayMediaFallback();
        return;
      }
      // ONEMLI: main.js artik basarisiz initialize() sonrasi dxgiCapture'i
      // null'a geri aliyor (bkz. main.js yorumu) - yani bir sonraki
      // dxgiGetFrame cagrisi guvenli sekilde "henuz baslatilmadi" hatasi
      // verecek, bozuk native nesneye asla dokunulmayacak. Yine de DXGI
      // gercekten kalici olarak bozuksa (ayni surucu/donanim arizasi) her
      // tikte yeniden denemek anlamsiz gurultu uretir - art arda basarisizlik
      // arttikca bekleme suresini kademeli uzatiyoruz (max 15sn).
      const backoffMs = Math.min(15000, 2000 * consecutiveReinitFailures);
      reinitBackoffUntil = performance.now() + backoffMs;
    }
    await recreateGenerator();
    consecutiveCaptureFailures = 0;
  }

  const intervalMs = Math.round(1000 / targetFps);
  let busy = false;

  // ONEMLI (CANLI KANITLANDI - "stall watchdog" devreye giriyor ama HICBIR
  // dxgi/writer hata logu yok): en az bir gercek oturumda framesEncoded 9+
  // saniye sabit kaldi, ustelik dxgiGetFrame() hic zaman asimina ugramadi,
  // writer.write() hic hata vermedi, desiredSize hic <=0 olmadi - yani
  // asagidaki TUM mevcut kurtarma yollarindan HICBIRI tetiklenmedi. Bu,
  // sorunun bu ANLATILAN adimlarin DISINDA (ornegin setInterval'in kendisi
  // bir sure hic tetiklenmemesi - renderer ana thread'i baska bir seyle
  // mesgulken - ya da encoder'in kareleri sessizce yutmasi) oldugunu
  // gosteriyor. Hangisi oldugunu bir DAHAKI SEFERE kesin olarak ayirt etmek
  // icin: her tick'te beklenen araligin ne kadar gerisinde kalindigini VE
  // dxgiGetFrame+writeFrame'in ne kadar surdugunu, asiri log gurultusu
  // yapmadan (~2sn'de bir) kaydediyoruz.
  let lastTickAt = performance.now();
  let lastHeartbeatLog = 0;
  const HEARTBEAT_INTERVAL_MS = 2000;

  ctx.dxgiCaptureInterval = setInterval(async () => {
    const tickStartedAt = performance.now();
    const tickGap = tickStartedAt - lastTickAt;
    lastTickAt = tickStartedAt;
    if (busy) return; // bir onceki kare hala islenirken ustune binme
    // ONEMLI (CANLI TESTTE bulundu): switch-screen sirasinda dxgi-init()
    // AYNI ANDA bu dongunun dxgi-get-frame() cagrisiyla native tarafta
    // yarisirsa "Access is denied" hatasi cikiyor - DXGI Desktop Duplication
    // API'si ayni output uzerinde eszamanli initialize+getFrame'i
    // desteklemiyor. Ekran degisimi surerken dongu tamamen duraklatiliyor.
    if (ctx.dxgiSwitchingScreen) return;
    busy = true;
    // NexusOn: kirmizi imlec gostergesi kaldirildi - AnyDesk/TeamViewer gibi
    // gercek araclar boyle bir seye ihtiyac duymuyor, kullanicinin kendi
    // fare imleci video uzerinde artik her zaman normal gorunuyor (bkz.
    // styles.css .video-wrap video). Ikisini ayni anda gostermek tam da
    // "cift imlec" sikayetine geri donerdi. sendCursorPos() artik hicbir
    // yerden cagrilmiyor.
    if (performance.now() < reinitBackoffUntil) {
      busy = false;
      return; // DXGI kalici bozuk gorunuyor, kademeli bekleme suresi dolmadan tekrar deneme
    }
    try {
      const fetchStartedAt = performance.now();
      const frame = await withTimeout(window.nexuson.dxgiGetFrame(), CAPTURE_TIMEOUT_MS, 'dxgiGetFrame');
      const fetchMs = performance.now() - fetchStartedAt;
      consecutiveCaptureFailures = 0;
      const writeStartedAt = performance.now();
      await writeFrame(frame);
      const writeMs = performance.now() - writeStartedAt;

      const now = performance.now();
      if (now - lastHeartbeatLog > HEARTBEAT_INTERVAL_MS) {
        lastHeartbeatLog = now;
        window.nexuson.debugLog(
          `[dxgi] heartbeat: tickGap=${tickGap.toFixed(0)}ms (hedef ${intervalMs}ms) fetch=${fetchMs.toFixed(0)}ms write=${writeMs.toFixed(0)}ms desiredSize=${writer.desiredSize}`
        );
      }
    } catch (err) {
      // ONEMLI (CANLI KANITLANDI - "gec tepki" sikayetinin gercek sebebi):
      // "Timeout reached", node_modules/windows-desktop-duplication/lib/
      // DesktopDuplication.js'in KENDI ic getFrameAsync(retryCount=5)
      // mekanizmasi 5 deneme sonunda da yeni kare bulamadi demek - bu ekran
      // icerigi kisa bir sure (okuma/bekleme gibi gayet normal anlarda)
      // DEGISMEDIGI icin olur, GERCEK bir yakalama arizasi DEGILDIR. Eskiden
      // bunu da diger hatalarla ayni sayaca ekleyip 2 ardisik "basarisizlikta"
      // pahali bir tam DXGI yeniden baslatmasi (reinitDxgiCapture)
      // tetikliyorduk - canli testte bu, birkac saniyede bir tekrarlanan
      // gereksiz reinit dongusune ve dogrudan gozlemlenen fps dususlerine
      // (12fps -> 4-6fps) yol aciyordu. Sadece GERCEK hatalari (accesslost,
      // DXGI native hatasi, withTimeout'un 2000ms takilma tespiti) reinit
      // sayacina ekliyoruz - salt "ekran degismedi" sessizce atlanir.
      // ONEMLI DUZELTME: ipcRenderer.invoke() bir main-surec hatasini oldugu
      // gibi degil, "Error invoking remote method 'dxgi-get-frame': Error:
      // Timeout reached" seklinde SARMALAYIP iletiyor - tam esitlik (===)
      // kontrolu bu yuzden HICBIR ZAMAN eslesmiyordu (canli kanitlandi:
      // kullanicinin gercek test bilgisayarindan gelen log, bu duzeltme
      // v1.0.10'da yuklu oldugu HALDE eski/reinit-tetikleyen davranisi
      // gosterdi). .includes() ile iceriyor mu diye bakiyoruz.
      if (err.message.includes('Timeout reached')) {
        window.nexuson.debugLog('[dxgi] bu tick icin yeni kare yok (ekran degismedi) - atlaniyor, reinit tetiklenmiyor');
        return;
      }
      consecutiveCaptureFailures++;
      window.nexuson.debugLog(`[dxgi] kare alinamadi (${consecutiveCaptureFailures}): ${err.message}`);
      if (consecutiveCaptureFailures >= MAX_CAPTURE_FAILURES_BEFORE_REINIT) {
        await reinitDxgiCapture();
      }
    } finally {
      busy = false;
    }
  }, intervalMs);

  return outStream;
}

// ONEMLI: DXGI'nin native mi yoksa getDisplayMedia yedeginde mi oldugu
// SADECE host'un kendi yerel dosya-tabanli debugLog'unda goruluyordu -
// destek personeli (viewer) kendi bilgisayarindan bunu HICBIR ZAMAN
// goremiyordu, sadece test bilgisayarinin dosya sistemine erisimi olan biri
// gorebilirdi. Yakalama yontemi degistiginde bunu kontrol kanali uzerinden
// karsi tarafa (destek personeline) da gonderip kendi "Bağlantı Günlüğü"
// panelinde gorunur hale getiriyoruz.
function sendCaptureStatus(ctx, active, detail) {
  ctx.captureStatus = { active, detail };
  if (ctx.controlChannel && ctx.controlChannel.readyState === 'open') {
    ctx.controlChannel.send(JSON.stringify({ type: 'capture-status', active, detail }));
  }
}

async function startHostOffer(ctx, sessionId) {
  const pc = ctx.pc;

  try {
    // ONEMLI: karsi tarafin (host) kendi kodlama istatistiklerini
    // (peer-stats) gordukten sonra anlasildi ki qualityLimitationReason hep
    // "none" ve kodlama donanimla (Media Foundation) hizli calisiyor -
    // CPU/bant genisligi sorunu YOKMUS.
    //
    // Daha once burada cursor:'never' + viewer tarafinda yerel bir imlec
    // gostergesi (#localCursorDot) vardi - fikir, gercek/yavas imleci
    // videodan gizleyip yerine aninda tepki veren yerel bir gosterge
    // koymakti. Ancak bu HICBIR ZAMAN calismadi: Electron'da
    // setDisplayMediaRequestHandler + desktopCapturer.getSources() ile
    // kaynak secildiginde, cursor constraint'i (ne 'never' ne 'always')
    // alttaki yakalamaya hic ulasmiyor - Electron'un desktopCapturer API'si
    // imlec gorunurlugunu kontrol etmeyi desteklemiyor (bkz.
    // electron/electron#7584, #14337). Log'da bunun kaniti: bu fonksiyondaki
    // "[capture] track.getSettings()" satiri GUNLERCE test boyunca bir kez
    // bile yazilmadi degil - asil sorun, bu kodun MUSTERI makinesinde
    // calistigi, bizim yerel log dosyamizin ise sadece Destek Ekibi
    // tarafini gordugu. Ekran goruntusunde gercek imlec videoda gorunmeye
    // devam etti - yani gizleme hic gerceklesmedi. Sonuc: iki farkli/celisen
    // imlec (gercek + yerel gosterge) sikayetinin kaynagi buydu. Cozum:
    // gizlemeyi hic denemiyoruz - her ekran paylasim aracinda oldugu gibi
    // (TeamViewer, AnyDesk) gercek imlec videoda normal sekilde gorunur,
    // yerel gosterge kaldirildi (bkz. #localCursorDot temizligi).
    //
    // GUNCELLEME: getDisplayMedia'nin kendisi de degisti - Chromium'un
    // "degisiklik yoksa kareyi atla" davranisi yuzunden 1fps'e takilma
    // sorunu KOKTEN cozulmedigi (sadece imlec ayrildigi) icin, yakalamayi
    // artik native DXGI Desktop Duplication API uzerinden yapiyoruz (bkz.
    // startDxgiCapture yukarida). Bu yol GPU seviyesinde calisir, "kare
    // atlama" davranisi yoktur.
    // YEDEK YOL: native DXGI bazi makinelerde (farkli ekran karti/surucu
    // kombinasyonu) baslatilamiyor - ornegin "Failed to get duplicate
    // output: Parametre hatali" (DXGI E_INVALIDARG), bu makineye ozgu bir
    // uyumluluk sorunu. Bu durumda musteri HIC destek alamaz hale gelmesin
    // diye eski getDisplayMedia yontemine dusuyoruz (main.js'teki
    // setDisplayMediaRequestHandler yedek olarak geri eklendi).
    // Yeni baglanti - onceki oturumdan kalma "embedded-cursor" durumu varsa
    // sifirla (bkz. asagidaki cift imlec duzeltmesi).
    els.videoWrap.classList.remove('embedded-cursor');
    let stream;
    try {
      // ONEMLI (CANLI KANITLANDI - gercek test bilgisayarinda): capture-status
      // gostergesi eklendikten sonra DXGI'nin gercek test makinesinde
      // guvenilir sekilde aktif kaldigi dogrulandi (bu gelistirme
      // makinesindeki reinit sorunu ORAYA ozgu degilmis). 15fps hedefi
      // (~67ms kare araligi) hicbir belgelenmis sebep olmadan konulmustu;
      // qualityLimitationReason loglarda HER ZAMAN "none" cikiyordu (CPU/
      // bant genisligi sinirlamasi yoktu) - yani DXGI'nin kendisi (Chromium'un
      // getDisplayMedia'sinin aksine "degismezse atla" davranisina sahip
      // olmadigi icin) daha yuksek bir hedefi rahatlikla kaldirabilir. 30fps'e
      // (~33ms) cikararak "islem sonrasi bir sonraki kareyi bekleme" suresini
      // yariya indiriyoruz - tepkime hizi sikayetine dogrudan etkisi olabilir.
      stream = await startDxgiCapture(ctx, 30);
      sendCaptureStatus(ctx, 'dxgi', 'Native DXGI yakalama aktif.');
    } catch (err) {
      window.nexuson.debugLog(
        `[dxgi] native yakalama basarisiz, getDisplayMedia'ya dusuluyor: ${err.message}`
      );
      if (ctx.dxgiCaptureInterval) {
        clearInterval(ctx.dxgiCaptureInterval);
        ctx.dxgiCaptureInterval = null;
      }
      stream = await navigator.mediaDevices.getDisplayMedia(fallbackDisplayMediaConstraints());
      // getDisplayMedia yolunda gercek imlec videoya gomulu geliyor - yerel
      // imleci de gosterirsek "iki imlec birbirini takip ediyor" olur (bkz.
      // styles.css .video-wrap.embedded-cursor).
      els.videoWrap.classList.add('embedded-cursor');
      sendCaptureStatus(ctx, 'fallback', `DXGI başlatılamadı: ${err.message}`);
    }
    ctx.localStream = stream;
    stream.getTracks().forEach((track) => {
      window.nexuson.debugLog(`[capture] track.getSettings(): ${JSON.stringify(track.getSettings())}`);
      const sender = pc.addTrack(track, stream);
      // startDxgiCapture'daki kendi kendini onarma mekanizmasi (kalici
      // tikanma tespit edilirse replaceTrack ile kurtarma) bu referansi
      // kullanir - sadece DXGI yolunda anlamli, getDisplayMedia yedeginde
      // ctx.dxgiSender hic set edilmemis olarak kalir, sorun degil.
      ctx.dxgiSender = sender;

      // ONEMLI (duzeltildi): "availableOutgoingBitrate hep 300000'de sabit
      // kaliyor" gozlemi GCC'nin bozuk oldugu anlamina gelmiyormus - bunu
      // yerel bir loopback testte (SDP + getStats() dogrudan incelendi)
      // dogruladik: transport-wide-cc uzantisi dogru muzakere ediliyor,
      // paket kaybi sifir, ve saglikli kosullarda tahmin gercekten 3+ Mbps'e
      // kadar cikabiliyor. 300000 (webrtc'nin sabit BASLANGIC degeri,
      // kDefaultStartBitrateBps) muhtemelen bazi gercek musteri baglantilarinin
      // GERCEKTEN o kadar (~300kbps) oldugunu gosteriyor - bozuk bir olcum
      // degil.
      //
      // Asil zarar veren asagidaki eski "minBitrate: 400_000" tabaniydi: agin
      // gercekte tasiyabildiginden YUKSEK bir taban zorlayinca, encoder agin
      // kaldiramayacagi kadar veri gondermeye zorlaniyor - bu hem gorunur
      // kalite bozulmasina (asiri sikistirma/bulaniklik) HEM DE kare
      // uretiminin tamamen durmasina (yazici geri basinc/backpressure kilitlenmesi)
      // yol acabiliyor. Cozum: tabani kaldirip GCC'nin gercek baglanti
      // kosuluna gorce ozgurce (gerekirse 400kbps'in altina) inmesine izin
      // ver. maxBitrate'i de DXGI'nin artik tam cozunurlukte (1920x1080)
      // besledigini goz onune alarak biraz yukselttik.
      preferVp8Codec(pc, sender);
      applyDxgiEncoderParams(ctx, sender);
    });
    log('Ekran paylaşımı başlatıldı.');
  } catch (err) {
    disconnectSession(ctx, sessionId, 'Ekran paylaşımı reddedildi/başarısız: ' + err.message);
    return;
  }

  ctx.controlChannel = pc.createDataChannel('control');
  bindControlChannel(ctx, ctx.controlChannel);

  ctx.fileChannel = pc.createDataChannel('files');
  bindFileChannel(ctx, ctx.fileChannel);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ctx.ws.send(JSON.stringify({ type: 'offer', description: offer }));
  log('Bağlantı teklifi (offer) gönderildi.');
}

async function handleOffer(ctx, msg) {
  const pc = ctx.pc;
  await pc.setRemoteDescription(new RTCSessionDescription(msg.description));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  ctx.ws.send(JSON.stringify({ type: 'answer', description: answer }));
  log('Bağlantı cevabı (answer) gönderildi.');
}

let viewerInputCaptureBound = false;

function showSessionPanel() {
  els.setupPanel.classList.add('hidden');
  els.sessionPanel.classList.remove('hidden');
  els.fileMenuBtn.classList.remove('hidden');
  els.disconnectBtn.classList.remove('hidden');

  els.logPanel.classList.add('hidden'); // varsayilan gizli, istege bagli acilir

  if (state.role === 'host') {
    els.hostPlaceholder.classList.remove('hidden');
  } else {
    els.controlHint.classList.remove('hidden');
    els.toggleLogBtn.classList.remove('hidden'); // sadece destek ekibi gorur
    if (!viewerInputCaptureBound) {
      viewerInputCaptureBound = true;
      setupViewerInputCapture();
    }
  }
  refreshTransferListVisibility();
}

els.toggleLogBtn.addEventListener('click', () => {
  const showing = !els.logPanel.classList.contains('hidden');
  els.logPanel.classList.toggle('hidden', showing);
  els.toggleLogBtn.textContent = showing ? 'Teknik Günlüğü Göster' : 'Teknik Günlüğü Gizle';
});

els.fileMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const opening = els.filePanel.classList.contains('hidden');
  els.filePanel.classList.toggle('hidden', !opening);
  els.fileMenuBtn.classList.toggle('active', opening);
});

document.addEventListener('click', (e) => {
  if (els.filePanel.classList.contains('hidden')) return;
  if (els.filePanel.contains(e.target) || els.fileMenuBtn.contains(e.target)) return;
  els.filePanel.classList.add('hidden');
  els.fileMenuBtn.classList.remove('active');
});

// --------------------------- Destek ekibi: coklu oturum (sekmeler) ---------------------------

function renderSessionTabs() {
  const sessions = [...state.viewerSessions.values()];
  els.sessionTabs.innerHTML = '';
  els.sessionTabsRail.classList.toggle('hidden', state.role !== 'viewer' || sessions.length === 0);
  if (state.role !== 'viewer') return;

  for (const s of sessions) {
    const tab = document.createElement('div');
    tab.className = 'session-tab' + (s.id === state.activeViewerSessionId ? ' active' : '');

    const label = document.createElement('span');
    label.textContent = s.customer ? s.customer.cariAdi : s.roomCode;
    tab.appendChild(label);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'session-tab-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Bu görüşmeyi sonlandır';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      disconnectSession(s, s.id, 'Görüşme sonlandırıldı.');
    });
    tab.appendChild(closeBtn);

    tab.addEventListener('click', () => switchToSession(s.id));
    els.sessionTabs.appendChild(tab);
  }

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'session-tab-add';
  addBtn.textContent = '+ Yeni Bağlantı';
  addBtn.addEventListener('click', showSetupForNewConnection);
  els.sessionTabs.appendChild(addBtn);
}

function switchToSession(id) {
  const session = state.viewerSessions.get(id);
  if (!session) return;
  state.activeViewerSessionId = id;

  els.remoteVideo.srcObject = session.remoteStream || null;
  const connected = session.pc && session.pc.connectionState === 'connected';
  setStatus(connected ? 'Bağlantı kuruldu' : 'Bağlanıyor...', connected ? 'connected' : 'connecting');

  populateScreenSelect(session, session.monitorCount || 1);
  showSessionPanel();
  renderSessionTabs();
}

// Baglantilari koparmadan, yeni bir musteriye baglanmak icin kurulum
// ekranina doner (var olan sekmeler arka planda calismaya devam eder).
function showSetupForNewConnection() {
  state.customer = null;
  els.sessionPanel.classList.add('hidden');
  els.setupPanel.classList.remove('hidden');
  els.roomCodeInput.value = '';
  els.customerSearchInput.value = '';
  els.customerSearchResults.innerHTML = '';
  setRole('viewer');
}

// --------------------------- Baglanti kapatma ---------------------------

function disconnectSession(ctx, sessionId, reason) {
  if (ctx.disconnecting) return; // pc.close()/ws.close() kendi olaylarini tetikleyip
  ctx.disconnecting = true;      // buraya tekrar girmeye calisabilir, bunu engelle

  if (ctx.disconnectedGraceTimer) {
    clearTimeout(ctx.disconnectedGraceTimer);
    ctx.disconnectedGraceTimer = null;
  }
  if (ctx.statsInterval) {
    clearInterval(ctx.statsInterval);
    ctx.statsInterval = null;
  }
  if (ctx.dxgiCaptureInterval) {
    clearInterval(ctx.dxgiCaptureInterval);
    ctx.dxgiCaptureInterval = null;
  }

  if (ctx.localStream) ctx.localStream.getTracks().forEach((t) => t.stop());
  if (ctx.pc) ctx.pc.close();
  if (ctx.ws) ctx.ws.close();
  ctx.pc = null;
  ctx.ws = null;
  ctx.controlChannel = null;
  ctx.fileChannel = null;

  if (sessionId === null) {
    // Musteri (host) tarafi.
    const wasAwaitingConnection = state.role === 'host' && !els.hostCodeDisplay.classList.contains('hidden');
    if (wasAwaitingConnection && reason) {
      els.hostErrorText.textContent = `Bağlantı kurulamadı: ${reason} Lütfen tekrar deneyin.`;
      els.hostErrorText.classList.remove('hidden');
    }
    els.remoteVideo.srcObject = null;
    resetUIToSetup(reason);
  } else {
    // Destek ekibi tarafi: sadece bu sekmeyi kapat, digerleri etkilenmez.
    const ticketId = ctx.currentTicketId;
    state.viewerSessions.delete(sessionId);

    if (ticketId) {
      showClosingForm(ctx, ticketId, sessionId);
    } else {
      afterViewerSessionClosed(sessionId, reason);
    }
  }

  ctx.disconnecting = false;
}

// Bir viewer sekmesi (kapanis formu varsa kaydedildikten sonra) tamamen
// kapandiginda: baska aktif sekme varsa ona gec, yoksa kurulum ekranina don.
function afterViewerSessionClosed(sessionId, reason) {
  log(reason || 'Bağlantı sonlandırıldı.');

  if (state.activeViewerSessionId === sessionId) {
    state.activeViewerSessionId = null;
  }

  const remaining = [...state.viewerSessions.keys()];
  if (remaining.length > 0) {
    switchToSession(remaining[remaining.length - 1]);
  } else {
    resetUIToSetup(reason);
  }
}

function resetUIToSetup(reason) {
  els.sessionPanel.classList.add('hidden');
  els.setupPanel.classList.remove('hidden');
  els.hostPlaceholder.classList.add('hidden');
  els.controlHint.classList.add('hidden');
  els.remoteCursorDot.classList.add('hidden');
  els.logPanel.classList.add('hidden');
  els.toggleLogBtn.classList.add('hidden');
  els.toggleLogBtn.textContent = 'Teknik Günlüğü Göster';
  els.fileMenuBtn.classList.add('hidden');
  els.fileMenuBtn.classList.remove('active');
  els.disconnectBtn.classList.add('hidden');
  els.filePanel.classList.add('hidden');
  els.screenSelect.classList.add('hidden');
  els.hostCodeDisplay.classList.add('hidden');
  els.hostRequestCategory.value = '';
  els.hostRequestNote.value = '';
  els.hostRequestNote.classList.add('hidden');
  els.sessionTabs.innerHTML = '';
  els.sessionTabsRail.classList.add('hidden');
  unlockSetupControls();
  setStatus('Bağlı değil', 'disconnected');
  log(reason || 'Bağlantı sonlandırıldı.');

  // Destek ekibi icin: bir sonraki gorusmede musteri tekrar secilsin (yanlislikla
  // onceki musteriye baglanmis gibi kayit olusmasin).
  if (state.role === 'viewer' && state.agent) {
    state.customer = null;
    els.roomCodeInput.value = '';
    els.customerSearchInput.value = '';
    els.customerSearchResults.innerHTML = '';
    setRole('viewer');
  }
}

// --------------------------- Destek kayitlari (biletler) ---------------------------

async function startTicket(ctx) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/agent/tickets/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.agent?.token}`,
      },
      body: JSON.stringify({
        roomCode: ctx.roomCode,
        cariKodu: ctx.customer?.cariKodu,
        cariAdi: ctx.customer?.cariAdi,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      ctx.currentTicketId = data.ticketId;
      // Gorusme kapanirken (bkz. showClosingForm) musterinin talebini
      // personele hatirlatabilmek icin sakliyoruz - sunucu bunu zaten
      // (room_notes / Baglanti Talebi Ilet akisindan) cozup donuyor.
      ctx.ticketCustomerNote = data.customerNote || '';
      ctx.ticketCustomerPhone = data.customerPhone || '';
      ctx.ticketCustomerFullName = data.customerFullName || '';
      log('Görüşme kaydı başlatıldı.');
    } else {
      log(`Görüşme kaydı başlatılamadı: ${data.error || res.status}`);
    }
  } catch (err) {
    log('Görüşme kaydı başlatılamadı (admin panele ulaşılamadı).');
  }
}

function showClosingForm(ctx, ticketId, sessionId) {
  els.closingFormOverlay.dataset.ticketId = ticketId;
  els.closingFormOverlay.dataset.sessionId = sessionId || '';

  // Musteri "Baglanti Talebi Ilet" ile baglanirken bir talep/not birakmissa,
  // personel gorusmeyi kapatirken bunu tekrar gorsun - hatirlamak icin
  // yukari kaydirip bakmasina gerek kalmaz.
  const noteParts = [];
  if (ctx.ticketCustomerFullName || ctx.ticketCustomerPhone) {
    noteParts.push([ctx.ticketCustomerFullName, ctx.ticketCustomerPhone].filter(Boolean).join(' — '));
  }
  if (ctx.ticketCustomerNote) noteParts.push(ctx.ticketCustomerNote);
  if (noteParts.length) {
    els.closingCustomerRequestText.textContent = noteParts.join(' · ');
    els.closingCustomerRequestRow.classList.remove('hidden');
  } else {
    els.closingCustomerRequestText.textContent = '';
    els.closingCustomerRequestRow.classList.add('hidden');
  }

  els.closingFormOverlay.classList.remove('hidden');
}

els.closingSaveBtn.addEventListener('click', async () => {
  const ticketId = els.closingFormOverlay.dataset.ticketId;
  const sessionId = els.closingFormOverlay.dataset.sessionId || null;
  const status = els.closingStatus.value;
  const note = els.closingNote.value.trim();

  els.closingSaveBtn.disabled = true;
  try {
    await fetch(`${API_BASE_URL}/api/agent/tickets/${ticketId}/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.agent?.token}`,
      },
      body: JSON.stringify({ status, note }),
    });
    log('Görüşme kaydı tamamlandı.');
  } catch (err) {
    log('Görüşme kaydı kapatılamadı (admin panele ulaşılamadı).');
  }
  els.closingSaveBtn.disabled = false;
  els.closingNote.value = '';
  els.closingFormOverlay.classList.add('hidden');

  if (sessionId) {
    afterViewerSessionClosed(sessionId, 'Bağlantı sonlandırıldı.');
  } else {
    resetUIToSetup('Bağlantı sonlandırıldı.');
  }
});

// --------------------------- Uzaktan kontrol (control channel) ---------------------------

// Host tarafinda uzaktan girdi enjeksiyonu (nut-js) sessizce basarisiz olabilir
// (ana surecin konsolu musteriye hic gorunmuyor); bu hatayi kontrol kanali
// uzerinden karsi tarafa (destek ekibine) iletip onun gunlugunde gosteriyoruz.
window.nexuson.onRemoteInputError((message) => {
  if (state.controlChannel && state.controlChannel.readyState === 'open') {
    state.controlChannel.send(JSON.stringify({ type: 'input-error', message }));
  }
});

function bindControlChannel(ctx, channel) {
  ctx.controlChannel = channel;
  channel.onopen = () => {
    log('Kontrol kanalı açıldı.');
    // NexusOn: musteriden "ekran kartiniz ne" gibi teknik bilgi istemek
    // saçma - gercek uzaktan destek araclari bunu kendisi toplar. DXGI/
    // getDisplayMedia'nin bazi makinelerde neden basarisiz oldugunu (surucu/
    // donanim) teshis edebilmek icin, her HOST oturumu baslar baslamaz bu
    // bilgiyi otomatik olarak karsi tarafa (destek personeline) gonderiyoruz
    // - musteriye hicbir zaman hicbir sey sorulmadan.
    if (state.role === 'host') {
      window.nexuson.getSystemInfo()
        .then((info) => {
          if (channel.readyState === 'open') {
            channel.send(JSON.stringify({ type: 'system-info', info }));
          }
        })
        .catch(() => {});
      // Yakalama yontemi kanal acilmadan once zaten belirlenmis olabilir -
      // kacirilmamasi icin kanal acilir acilmaz mevcut durumu da gonderiyoruz.
      if (ctx.captureStatus) {
        channel.send(JSON.stringify({ type: 'capture-status', ...ctx.captureStatus }));
      }
      // Coklu ekran secici (AnyDesk tarzi): personel tarafinin secici UI'i
      // gosterip gostermeyecegine karar verebilmesi icin ekran sayisini
      // bildiriyoruz.
      window.nexuson.dxgiMonitorCount()
        .then((count) => {
          if (channel.readyState === 'open') channel.send(JSON.stringify({ type: 'monitor-count', count }));
        })
        .catch(() => {});
    }
  };
  channel.onmessage = (e) => {
    const evt = JSON.parse(e.data);

    if (evt.type === 'input-error') {
      // Bu mesaji sadece destek ekibi (viewer) gorur - host'un kendi gonderdigi hata.
      if (state.role !== 'host') log(`Karşı taraf uzaktan girdiyi uygulayamadı: ${evt.message}`);
      return;
    }

    if (evt.type === 'peer-stats') {
      window.nexuson.debugLog(`[peer-stats] karşı taraf (${evt.stats.role}): ${JSON.stringify(evt.stats)}`);
      return;
    }

    if (evt.type === 'system-info') {
      window.nexuson.debugLog(`[system-info] müşteri makinesi: ${JSON.stringify(evt.info)}`);
      return;
    }

    if (evt.type === 'capture-status') {
      // Destek personelinin KENDI ekranindan gorebilmesi icin: yakalama
      // yontemi (native DXGI / yedek getDisplayMedia) degistiginde, daha
      // once sadece musteri makinesinin dosya-tabanli log'unda goruleni
      // burada da (Bağlantı Günlüğü panelinde) gosteriyoruz.
      const label = evt.active === 'dxgi' ? 'Native (DXGI)' : 'Yedek (getDisplayMedia)';
      log(`Ekran yakalama yöntemi: ${label} — ${evt.detail || ''}`);
      window.nexuson.debugLog(`[capture-status] ${evt.active}: ${evt.detail || ''}`);
      return;
    }

    // Coklu ekran secici: sadece destek personeli (viewer) tarafinda secici
    // UI'i doldurup/gosterir. Musteride (host) hicbir gorsel etki yok.
    if (evt.type === 'monitor-count') {
      ctx.monitorCount = evt.count;
      if (state.role === 'viewer' && ctx === getActiveSession()) populateScreenSelect(ctx, evt.count);
      return;
    }

    if (evt.type === 'switch-screen-result') {
      if (state.role === 'viewer') {
        log(evt.ok ? `Ekran ${evt.screenNum + 1} gösteriliyor.` : `Ekran değiştirilemedi: ${evt.error}`);
      }
      return;
    }

    if (evt.type === 'switch-screen') {
      // Sadece HOST tarafi isler - personel farkli bir ekran secmis.
      if (state.role !== 'host') return;
      const screenNum = Number(evt.screenNum) || 0;
      // Kendi yakalama dongumuzun (bkz. startDxgiCapture) ayni anda
      // dxgi-get-frame() cagirmasini engelle - ikisi native tarafta
      // eszamanli calisirsa "Access is denied" hatasina yol aciyor.
      ctx.dxgiSwitchingScreen = true;
      window.nexuson.dxgiInit(screenNum)
        .then(() => window.nexuson.dxgiGetFrame())
        .then((frame) => {
          ctx.dxgiNativeWidth = frame.width;
          ctx.dxgiNativeHeight = frame.height;
          if (ctx.dxgiSender) applyDxgiEncoderParams(ctx, ctx.dxgiSender);
          if (channel.readyState === 'open') {
            channel.send(JSON.stringify({ type: 'switch-screen-result', ok: true, screenNum }));
          }
        })
        .catch((err) => {
          window.nexuson.debugLog(`[dxgi] switch-screen HATASI: ${err.message}`);
          if (channel.readyState === 'open') {
            channel.send(JSON.stringify({ type: 'switch-screen-result', ok: false, screenNum, error: err.message }));
          }
        })
        .finally(() => {
          ctx.dxgiSwitchingScreen = false;
        });
      return;
    }

    if (evt.type === 'cursor-pos') {
      // GECICI TANILAMA: bu mesajlarin gercekten gelip gelmedigini ve
      // tasidigi degerleri gormek icin saniyede bir loglanir (donma/imlec
      // sorunlari cozulup dogrulanana kadar burada kalacak).
      const now = performance.now();
      if (!ctx._lastCursorLog || now - ctx._lastCursorLog > 1000) {
        ctx._lastCursorLog = now;
        window.nexuson.debugLog(`[cursor-pos] visible=${evt.visible} x=${evt.x?.toFixed(3)} y=${evt.y?.toFixed(3)}`);
      }
      if (!evt.visible) {
        els.remoteCursorDot.classList.add('hidden');
      } else {
        // NOT: yuzde degil piksel kullaniyoruz - video "object-fit: contain"
        // ile letterbox/pillarbox oldugunda (video orani kutu oraniyla
        // uyusmadiginda), noktanin GERCEK gorunen video icerigine gore
        // konumlanmasi icin videoWrap'in tum kutusu degil, videonun gercekten
        // gorundugu ic dikdortgen (getVideoContentRect) esas alinmali.
        const contentRect = getVideoContentRect(els.remoteVideo);
        const wrapRect = els.videoWrap.getBoundingClientRect();
        const left = (contentRect.left - wrapRect.left) + evt.x * contentRect.width;
        const top = (contentRect.top - wrapRect.top) + evt.y * contentRect.height;
        els.remoteCursorDot.classList.remove('hidden');
        els.remoteCursorDot.style.left = `${left}px`;
        els.remoteCursorDot.style.top = `${top}px`;
      }
      return;
    }

    // Uzaktan fare/klavye olaylari: sadece HOST tarafi isler, ve sadece kullanici izin verdiyse.
    if (state.role !== 'host') return;
    if (!els.allowControlCheckbox.checked) return;
    window.nexuson.sendRemoteInput(evt);
  };
}

// Coklu ekran secici (AnyDesk tarzi): musteri bilgisayarinda 1'den fazla
// ekran varsa personel tarafinda bir secici gosterilir; tek ekranda hicbir
// UI degisikligi olmaz (secici gizli kalir).
function populateScreenSelect(ctx, count) {
  if (!count || count <= 1) {
    els.screenSelect.classList.add('hidden');
    return;
  }
  els.screenSelect.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `Ekran ${i + 1}`;
    els.screenSelect.appendChild(opt);
  }
  els.screenSelect.dataset.ctxId = ctx.id || '';
  els.screenSelect.classList.remove('hidden');
}

els.screenSelect.addEventListener('change', () => {
  const ctx = getActiveSession();
  if (!ctx || !ctx.controlChannel || ctx.controlChannel.readyState !== 'open') return;
  const screenNum = Number(els.screenSelect.value) || 0;
  ctx.controlChannel.send(JSON.stringify({ type: 'switch-screen', screenNum }));
  log(`Ekran ${screenNum + 1} isteniyor...`);
});

function setupViewerInputCapture() {
  const wrap = els.videoWrap;
  const video = els.remoteVideo;
  let lastMoveSent = 0;
  // Bir tus basiliyken, gercek bir suruklemeyle (drag) ag/zamanlama
  // gecikmesinden dogan ufak titremeyi ayirt etmek icin Windows'un kendi
  // suruk-esigi mantigini (SM_CXDRAG ~4px) taklit ediyoruz: tus basildiktan
  // sonra bu esik asilana kadar HICBIR hareket iletilmiyor - boylece basit bir
  // tiklama karsi tarafa "bas, [gurultu], birak" olarak degil temiz "bas, birak"
  // olarak ulasiyor. Bazi pencerelerin baslik cubugunda boyle bir "mikro-suruk"
  // Windows'u pencere suruklemesi kip kilitlenen bir moda sokabiliyordu.
  const DRAG_THRESHOLD_PX = 4;
  let buttonDownAt = null; // {x, y} client koordinati, tus basiliyken
  let dragConfirmed = false;

  wrap.addEventListener('click', () => wrap.focus());

  video.addEventListener('mousemove', (e) => {
    if (buttonDownAt && !dragConfirmed) {
      const dx = e.clientX - buttonDownAt.x;
      const dy = e.clientY - buttonDownAt.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // esik asilmadan hareket gonderme
      dragConfirmed = true;
    }

    const now = performance.now();
    // ONEMLI (CANLI KANITLANDI - gercek test bilgisayarindan gelen "Bağlantı
    // Günlüğü": saniyede 40+ "kuyruk birikmesi" zaman asimi): 25ms (~40
    // olay/sn), nut-worker'in sirali islem hattinin GERCEKTEN yetisebildigi
    // hizin uzerindeydi - kuyruk surekli buyuyup, birkac saniye sonra
    // biriken TUM olaylar neredeyse ayni anda zaman asimina ugruyordu (hem
    // fare hem, ayni kuyruguu paylastigi icin, arkasindan gelen klavye
    // olaylari da). 50ms'e (~20 olay/sn) dusurmek gonderilen olay sayisini
    // yariya indirip kuyrugun gercekten yetisebilecegi bir hiza cekiyor.
    if (now - lastMoveSent < 50) return;
    lastMoveSent = now;
    const rect = getVideoContentRect(video);
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);
    sendInput({ type: 'mousemove', x, y });
  });

  video.addEventListener('mousedown', (e) => {
    e.preventDefault();
    buttonDownAt = { x: e.clientX, y: e.clientY };
    dragConfirmed = false;
    if (e.button === 2) log('Sağ tık gönderildi (bas).');
    sendInput({ type: 'mousedown', button: e.button });
  });
  video.addEventListener('mouseup', (e) => {
    buttonDownAt = null;
    dragConfirmed = false;
    if (e.button === 2) log('Sağ tık gönderildi (bırak).');
    sendInput({ type: 'mouseup', button: e.button });
  });
  video.addEventListener('wheel', (e) => {
    e.preventDefault();
    sendInput({ type: 'wheel', deltaY: e.deltaY });
  }, { passive: false });
  video.addEventListener('contextmenu', (e) => e.preventDefault());

  wrap.addEventListener('keydown', (e) => {
    e.preventDefault();
    // ONEMLI (CANLI KANITLANDI - kullanicinin kendi "Bağlantı Günlüğü"
    // paneli): bir tus basili tutulduğunda tarayici saniyede onlarca kez
    // "keydown" (e.repeat=true) ureterek OS'nin kendi tus-tekrar davranisini
    // taklit eder. Bunlarin HEPSINI oldugu gibi karsiya iletmek, nut-worker'in
    // sirali kuyrugunu (mouse olaylari da AYNI kuyrugu kullaniyor) saniyeler
    // icinde tikayip "kuyruk birikmesi" zaman asimlarina yol aciyordu -
    // musteriye "ekran/tiklama donmus" gibi gorunuyordu (video akisinin
    // kendisi saglikliydi, sadece girdi kuyrugu birikmisti). Gercek uzak
    // masaustu araclari (AnyDesk, RDP, TeamViewer) tekrar olaylarini hic
    // iletmez: karsi tarafa sadece ILK basisi gonderirler, tus "basili"
    // kalir, tekrari HEDEF isletim sistemi kendi dogal mekanizmasiyla uretir.
    // Ayni yaklasimi burada da uyguluyoruz.
    if (e.repeat) return;
    // ctrlKey/altKey/metaKey: host tarafinin bu harfi fiziksel tus konumuyla mi
    // (Ctrl+C gibi kisayollar icin gerekli) yoksa klavye duzeninden bagimsiz
    // Unicode yazma yoluyla mi (bkz. nut-worker.js) gonderecegine karar
    // vermesi icin. shiftKey'i BILEREK yollamiyoruz - Unicode yazma zaten
    // dogru (buyuk/kucuk) karakteri direkt uretiyor, shift durumuna bakmasi
    // gerekmiyor.
    sendInput({ type: 'keydown', key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey });
  });
  wrap.addEventListener('keyup', (e) => {
    e.preventDefault();
    sendInput({ type: 'keyup', key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey });
  });
}

function clamp01(n) { return Math.min(1, Math.max(0, n)); }

// `object-fit: contain` video elemani, video'nun gercek oraniyla (videoWidth/
// videoHeight) elemanin CSS kutusunun orani birbirini tutmadiginda videoyu
// kutunun ICINDE ortalayip ust-alt (ya da sag-sol) bosluk (letterbox/pillarbox)
// birakiyor. getBoundingClientRect() ise HER ZAMAN tum kutuyu donduruyor - bu
// bosluklari saymadan tiklama konumu kutuya gore normalize edilince, gercekte
// GORUNEN video piksellerine gore konum kayiyordu (musteri ekraninda tiklanan
// yer, agent ekraninda tiklanan yerden farkli oluyordu).
function getVideoContentRect(video) {
  const rect = video.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || !rect.width || !rect.height) return rect;

  const boxRatio = rect.width / rect.height;
  const videoRatio = vw / vh;
  let width = rect.width;
  let height = rect.height;
  let left = rect.left;
  let top = rect.top;

  if (videoRatio > boxRatio) {
    height = rect.width / videoRatio;
    top = rect.top + (rect.height - height) / 2;
  } else if (videoRatio < boxRatio) {
    width = rect.height * videoRatio;
    left = rect.left + (rect.width - width) / 2;
  }

  return { left, top, width, height };
}

function sendInput(evt) {
  const ctx = getActiveSession();
  if (ctx && ctx.controlChannel && ctx.controlChannel.readyState === 'open') {
    ctx.controlChannel.send(JSON.stringify(evt));
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

function bindFileChannel(ctx, channel) {
  ctx.fileChannel = channel;
  channel.binaryType = 'arraybuffer';
  channel.onopen = () => log('Dosya kanalı açıldı.');

  channel.onmessage = (e) => {
    if (typeof e.data === 'string') {
      const msg = JSON.parse(e.data);
      if (msg.type === 'file-offer') handleIncomingFileOffer(ctx, msg);
      if (msg.type === 'file-accept') handleFileAccept(ctx, msg);
    } else {
      handleIncomingFileChunk(ctx, e.data);
    }
  };
}

function makeTransferId() {
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0');
}

els.sendFileBtn.addEventListener('click', async () => {
  const file = await window.nexuson.pickFileToSend();
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
    const path = window.nexuson.getPathForFile(f);
    sendFileObject({ path, name: f.name, size: f.size });
  }
});

async function sendFileObject(file) {
  const ctx = getActiveSession();
  if (!ctx || !ctx.fileChannel || ctx.fileChannel.readyState !== 'open') {
    alert('Dosya kanalı henüz hazır değil.');
    return;
  }

  const transferId = makeTransferId();
  addTransferRow(transferId, file.name, file.size, 'out', getActiveSessionKey());
  updateTransferStatus(transferId, 'Onay bekleniyor...');

  ctx.fileChannel.send(JSON.stringify({ type: 'file-offer', transferId, name: file.name, size: file.size }));

  const accepted = await new Promise((resolve) => {
    ctx.pendingFileAccepts.set(transferId, { resolve });
  });

  if (!accepted) {
    updateTransferStatus(transferId, 'Karşı taraf reddetti.', true);
    return;
  }

  updateTransferStatus(transferId, 'Gönderiliyor...');
  await streamFileChunks(ctx, transferId, file);
  updateTransferProgress(transferId, 1, true);
  updateTransferStatus(transferId, 'Tamamlandı.');
}

async function streamFileChunks(ctx, transferId, file) {
  const channel = ctx.fileChannel;
  const encoder = new TextEncoder();
  const idBytes = encoder.encode(transferId.slice(0, HEADER_LEN).padEnd(HEADER_LEN, '0'));

  let offset = 0;
  while (offset < file.size) {
    const length = Math.min(CHUNK_SIZE, file.size - offset);
    const chunk = await window.nexuson.readFileChunk({ filePath: file.path, offset, length });
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

async function handleIncomingFileOffer(ctx, msg) {
  const sessionKey = state.role === 'host' ? 'host' : ctx.id;
  addTransferRow(msg.transferId, msg.name, msg.size, 'in', sessionKey);
  updateTransferStatus(msg.transferId, 'Kaydetme konumu seçiliyor...');

  const filePath = await window.nexuson.startReceiveFile({ transferId: msg.transferId, fileName: msg.name });
  const accepted = !!filePath;

  ctx.receivingTransfers.set(msg.transferId, {
    size: msg.size,
    received: 0,
    filePath,
    ignored: !accepted,
  });

  ctx.fileChannel.send(JSON.stringify({ type: 'file-accept', transferId: msg.transferId, accepted }));

  if (accepted) {
    updateTransferStatus(msg.transferId, 'Alınıyor...');
  } else {
    updateTransferStatus(msg.transferId, 'Reddedildi.', true);
  }
}

function handleFileAccept(ctx, msg) {
  const pending = ctx.pendingFileAccepts.get(msg.transferId);
  if (pending) {
    pending.resolve(msg.accepted);
    ctx.pendingFileAccepts.delete(msg.transferId);
  }
}

async function handleIncomingFileChunk(ctx, buf) {
  const bytes = new Uint8Array(buf);
  const decoder = new TextDecoder();
  const transferId = decoder.decode(bytes.subarray(0, HEADER_LEN));
  const payload = bytes.subarray(HEADER_LEN);

  const entry = ctx.receivingTransfers.get(transferId);
  if (!entry) return;

  if (!entry.ignored) {
    await window.nexuson.writeFileChunk({ transferId, chunk: payload });
  }
  entry.received += payload.length;
  updateTransferProgress(transferId, entry.received / entry.size);

  if (entry.received >= entry.size) {
    if (!entry.ignored) {
      const filePath = await window.nexuson.finishReceiveFile({ transferId });
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

function addTransferRow(transferId, name, size, direction, sessionKey) {
  const row = document.createElement('div');
  row.className = 'transfer-row';
  row.id = `transfer-${transferId}`;
  row.dataset.sessionKey = sessionKey;

  // ONEMLI (guvenlik): 'name' karsi taraftan (WebRTC data channel uzerinden
  // gelen 'file-offer' mesaji) geliyor - yani GUVENILMEYEN bir kaynak.
  // innerHTML ile dogrudan basmak, kotu niyetli bir dosya adiyla (ör.
  // "<img src=x onerror=...>") renderer icinde script calistirmaya izin
  // verirdi. Tum yapiyi guvenli DOM API'leriyle (textContent) kuruyoruz.
  const nameRow = document.createElement('div');
  nameRow.className = 'name-row';
  const nameSpan = document.createElement('span');
  const directionSpan = document.createElement('span');
  directionSpan.className = 'direction';
  directionSpan.textContent = direction === 'out' ? 'Gönderiliyor →' : '← Alınıyor';
  nameSpan.appendChild(directionSpan);
  nameSpan.appendChild(document.createTextNode(name));
  const sizeSpan = document.createElement('span');
  sizeSpan.className = 'size';
  sizeSpan.textContent = formatSize(size);
  nameRow.appendChild(nameSpan);
  nameRow.appendChild(sizeSpan);

  const progressTrack = document.createElement('div');
  progressTrack.className = 'progress-track';
  const progressFill = document.createElement('div');
  progressFill.className = 'progress-fill';
  progressFill.style.width = '0%';
  progressTrack.appendChild(progressFill);

  const statusText = document.createElement('div');
  statusText.className = 'status-text';

  row.appendChild(nameRow);
  row.appendChild(progressTrack);
  row.appendChild(statusText);

  els.transferList.appendChild(row);
  refreshTransferListVisibility();
}

// Dosya menusu tum oturumlarin transferlerini tek bir listede tutar; sadece
// o an aktif olan oturuma ait satirlar gorunur, digerleri gizlenir.
function refreshTransferListVisibility() {
  const activeKey = getActiveSessionKey();
  const rows = els.transferList.querySelectorAll('.transfer-row');
  let anyVisible = false;
  rows.forEach((row) => {
    const match = row.dataset.sessionKey === activeKey;
    row.classList.toggle('hidden', !match);
    if (match) anyVisible = true;
  });

  let emptyHint = els.transferList.querySelector('.empty-hint');
  if (!anyVisible) {
    if (!emptyHint) {
      emptyHint = document.createElement('p');
      emptyHint.className = 'empty-hint';
      emptyHint.innerHTML = 'Henüz dosya aktarımı yok.<br />Dosyayı buraya sürükleyip bırakabilirsiniz.';
      els.transferList.appendChild(emptyHint);
    }
  } else if (emptyHint) {
    emptyHint.remove();
  }
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
    btn.onclick = () => window.nexuson.showFileInFolder(filePath);
    statusEl.after(btn);
  }
}

setRole('host');
log('NexusOn hazır. Bir rol seçip bağlanabilirsiniz.');
