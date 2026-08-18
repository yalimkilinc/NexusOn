// NexusOn Admin Panel - dashboard mantigi. Sade vanilla JS, fetch() ile API'ye baglanir.

const els = {
  whoami: document.getElementById('whoami'),
  logoutBtn: document.getElementById('logoutBtn'),
  slideList: document.getElementById('slideList'),
  slideForm: document.getElementById('slideForm'),
  slideText: document.getElementById('slideText'),
  slideImage: document.getElementById('slideImage'),
  newsList: document.getElementById('newsList'),
  newsForm: document.getElementById('newsForm'),
  newsText: document.getElementById('newsText'),
  buildCustomerBtn: document.getElementById('buildCustomerBtn'),
  buildCustomerStatus: document.getElementById('buildCustomerStatus'),
  buildCustomerLog: document.getElementById('buildCustomerLog'),
  downloadCustomerLink: document.getElementById('downloadCustomerLink'),
  buildStaffBtn: document.getElementById('buildStaffBtn'),
  buildStaffStatus: document.getElementById('buildStaffStatus'),
  buildStaffLog: document.getElementById('buildStaffLog'),
  downloadStaffLink: document.getElementById('downloadStaffLink'),
  customerStableLink: document.getElementById('customerStableLink'),
  staffStableLink: document.getElementById('staffStableLink'),
  adminList: document.getElementById('adminList'),
  adminForm: document.getElementById('adminForm'),
  adminUsername: document.getElementById('adminUsername'),
  adminRole: document.getElementById('adminRole'),
  adminPassword: document.getElementById('adminPassword'),
  adminSubmitBtn: document.getElementById('adminSubmitBtn'),
  adminCancelEditBtn: document.getElementById('adminCancelEditBtn'),
  agentList: document.getElementById('agentList'),
  agentForm: document.getElementById('agentForm'),
  agentUsername: document.getElementById('agentUsername'),
  agentFullName: document.getElementById('agentFullName'),
  agentPhone: document.getElementById('agentPhone'),
  agentEmail: document.getElementById('agentEmail'),
  agentPassword: document.getElementById('agentPassword'),
  agentSubmitBtn: document.getElementById('agentSubmitBtn'),
  agentCancelEditBtn: document.getElementById('agentCancelEditBtn'),
  ticketStats: document.getElementById('ticketStats'),
  ticketTableBody: document.getElementById('ticketTableBody'),
  v3SettingsForm: document.getElementById('v3SettingsForm'),
  v3Host: document.getElementById('v3Host'),
  v3Port: document.getElementById('v3Port'),
  v3Database: document.getElementById('v3Database'),
  v3Username: document.getElementById('v3Username'),
  v3Password: document.getElementById('v3Password'),
  v3PasswordHint: document.getElementById('v3PasswordHint'),
  v3TestBtn: document.getElementById('v3TestBtn'),
  v3TestResult: document.getElementById('v3TestResult'),
  v3ListTablesBtn: document.getElementById('v3ListTablesBtn'),
  v3SetupTableBtn: document.getElementById('v3SetupTableBtn'),
  v3SetupTableResult: document.getElementById('v3SetupTableResult'),
  v3TablesResult: document.getElementById('v3TablesResult'),
  emailSettingsForm: document.getElementById('emailSettingsForm'),
  emailSmtpHost: document.getElementById('emailSmtpHost'),
  emailSmtpPort: document.getElementById('emailSmtpPort'),
  emailSmtpSecure: document.getElementById('emailSmtpSecure'),
  emailSmtpUser: document.getElementById('emailSmtpUser'),
  emailSmtpPassword: document.getElementById('emailSmtpPassword'),
  emailSmtpPasswordHint: document.getElementById('emailSmtpPasswordHint'),
  emailFromAddress: document.getElementById('emailFromAddress'),
  emailRecipients: document.getElementById('emailRecipients'),
  emailTestBtn: document.getElementById('emailTestBtn'),
  emailTestResult: document.getElementById('emailTestResult'),
  emailWeeklyEnabled: document.getElementById('emailWeeklyEnabled'),
  emailWeeklyNowBtn: document.getElementById('emailWeeklyNowBtn'),
  emailWeeklyResult: document.getElementById('emailWeeklyResult'),
  telegramSettingsForm: document.getElementById('telegramSettingsForm'),
  telegramBotToken: document.getElementById('telegramBotToken'),
  telegramTokenHint: document.getElementById('telegramTokenHint'),
  telegramChatId: document.getElementById('telegramChatId'),
  telegramTestBtn: document.getElementById('telegramTestBtn'),
  telegramTestResult: document.getElementById('telegramTestResult'),
};

const buildPollTimers = { customer: null, staff: null };
let currentRole = null;

async function api(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: options && options.body && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : undefined,
    ...options,
  });
  if (res.status === 401) {
    window.location.href = 'login.html';
    throw new Error('Oturum sona ermiş.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'İşlem başarısız.');
  return data;
}

// --------------------------- Oturum ---------------------------

async function init() {
  const session = await fetch('/api/session').then((r) => r.json());
  if (!session.loggedIn) {
    window.location.href = 'login.html';
    return;
  }
  currentRole = session.role;
  els.whoami.textContent = session.username;

  els.customerStableLink.textContent = `${location.origin}/download/NexusOn-Setup.exe`;
  els.staffStableLink.textContent = `${location.origin}/download/NexusOn-Personel-Setup.exe`;

  const isFullAdmin = currentRole === 'admin';
  document.querySelectorAll('[data-roles="admin"]').forEach((el) => {
    el.classList.toggle('hidden', !isFullAdmin);
  });

  // 'destek' rolu icin varsayilan sekme "Görsel / Video Slider" (gizli)
  // yerine goruntuleyebildigi ilk sekme olan "Destek Kayıtları" olsun.
  if (!isFullAdmin) {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === 'tickets'));
    document.querySelectorAll('.dashboard-page').forEach((page) => {
      page.classList.toggle('hidden', page.id !== 'page-tickets');
    });
  }

  loadTickets();

  if (isFullAdmin) {
    loadSlides();
    loadNews();
    loadAgents();
    loadV3Settings();
    loadEmailSettings();
    loadTelegramSettings();
    loadAdmins();
    pollBuildStatus('customer');
    pollBuildStatus('staff');
  }
}

els.logoutBtn.addEventListener('click', async () => {
  await api('/logout', { method: 'POST' });
  window.location.href = 'login.html';
});

// --------------------------- Slaytlar ---------------------------

async function loadSlides() {
  const slides = await api('/admin/slides');
  els.slideList.innerHTML = '';

  if (slides.length === 0) {
    els.slideList.innerHTML = '<p class="empty-hint">Henüz slayt eklenmedi. Aşağıdan ekleyebilirsiniz.</p>';
    return;
  }

  slides.forEach((slide, i) => {
    els.slideList.appendChild(buildSlideRow(slide, i + 1));
  });
}

function buildSlideRow(slide, order) {
  const card = document.createElement('div');
  card.className = 'slide-card';

  function renderView() {
    let thumbHtml;
    if (slide.mediaType === 'video' && slide.mediaUrl) {
      thumbHtml = `<video class="item-thumb" src="${slide.mediaUrl}" muted playsinline></video>`;
    } else if (slide.mediaUrl) {
      thumbHtml = `<img class="item-thumb" src="${slide.mediaUrl}" />`;
    } else {
      thumbHtml = `<div class="item-thumb placeholder">Görsel yok</div>`;
    }
    card.innerHTML = `
      <div class="slide-card-thumb-wrap">
        <span class="slide-card-order">${order}</span>
        ${slide.mediaType === 'video' ? '<span class="media-type-badge slide-card-badge">Video</span>' : ''}
        ${thumbHtml}
      </div>
      <div class="slide-card-foot">
        <span class="item-text"></span>
        <button class="item-view" type="button" title="Gerçek boyutunda görüntüle">⛶</button>
        <button class="item-edit" type="button" title="Düzenle">✎</button>
        <button class="item-delete" type="button" title="Sil">✕</button>
      </div>
    `;
    card.querySelector('.item-text').textContent = slide.text;
    card.querySelector('.item-view').addEventListener('click', () => {
      if (slide.mediaUrl) window.open(slide.mediaUrl, '_blank');
    });
    card.querySelector('.item-edit').addEventListener('click', renderEdit);
    card.querySelector('.item-delete').addEventListener('click', async () => {
      await api(`/admin/slides/${slide.id}`, { method: 'DELETE' });
      loadSlides();
    });
  }

  function renderEdit() {
    card.innerHTML = `
      <div class="slide-card-edit">
        <input class="edit-text" type="text" placeholder="Başlık metni" />
        <input class="edit-image" type="file" accept="image/*,video/mp4,video/webm" title="Yeni görsel/video ile değiştir (opsiyonel)" />
        <div class="slide-card-edit-actions">
          <button class="primary-btn edit-save" type="button">Kaydet</button>
          <button class="item-delete edit-cancel" type="button" title="Vazgeç">✕</button>
        </div>
      </div>
    `;
    card.querySelector('.edit-text').value = slide.text;
    card.querySelector('.edit-cancel').addEventListener('click', renderView);
    card.querySelector('.edit-save').addEventListener('click', async () => {
      const newText = card.querySelector('.edit-text').value.trim();
      if (!newText) return;
      const formData = new FormData();
      formData.append('text', newText);
      const file = card.querySelector('.edit-image').files[0];
      if (file) formData.append('image', file);
      await api(`/admin/slides/${slide.id}`, { method: 'PUT', body: formData });
      loadSlides();
    });
  }

  renderView();
  return card;
}

els.slideForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData();
  formData.append('text', els.slideText.value.trim());
  if (els.slideImage.files[0]) formData.append('image', els.slideImage.files[0]);

  await api('/admin/slides', { method: 'POST', body: formData });
  els.slideForm.reset();
  loadSlides();
});

// --------------------------- Duyurular ---------------------------

async function loadNews() {
  const news = await api('/admin/news');
  els.newsList.innerHTML = '';

  if (news.length === 0) {
    els.newsList.innerHTML = '<p class="empty-hint">Henüz duyuru eklenmedi. Aşağıdan ekleyebilirsiniz.</p>';
    return;
  }

  for (const item of news) {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `<span class="item-text"></span><button class="item-delete" type="button" title="Sil">✕</button>`;
    row.querySelector('.item-text').textContent = item.text;
    row.querySelector('.item-delete').addEventListener('click', async () => {
      await api(`/admin/news/${item.id}`, { method: 'DELETE' });
      loadNews();
    });
    els.newsList.appendChild(row);
  }
}

els.newsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/admin/news', {
    method: 'POST',
    body: JSON.stringify({ text: els.newsText.value.trim() }),
  });
  els.newsForm.reset();
  loadNews();
});

// --------------------------- Destek personeli (ajanlar) ---------------------------

let editingAgentId = null;
let agentsCache = [];

async function loadAgents() {
  const agents = await api('/admin/agents');
  agentsCache = agents;
  els.agentList.innerHTML = '';

  if (agents.length === 0) {
    els.agentList.innerHTML = '<p class="empty-hint">Henüz personel eklenmedi. Aşağıdan ekleyebilirsiniz.</p>';
    return;
  }

  for (const agent of agents) {
    const row = document.createElement('div');
    row.className = 'item-row agent-row';
    row.innerHTML = `
      <span class="item-text"></span>
      <span class="item-text"></span>
      <span class="item-text"></span>
      <span class="item-text"></span>
      <button class="link-btn" type="button" style="margin-top:0;">Düzenle</button>
      <button class="item-delete" type="button" title="Sil">✕</button>
    `;
    const cells = row.querySelectorAll('.item-text');
    cells[0].textContent = agent.username;
    cells[1].textContent = agent.full_name || '—';
    cells[2].textContent = agent.phone || '—';
    cells[3].textContent = agent.email || '—';
    row.querySelector('.link-btn').addEventListener('click', () => startEditAgent(agent.id));
    row.querySelector('.item-delete').addEventListener('click', async () => {
      if (!confirm(`"${agent.username}" personelini silmek istediğinize emin misiniz?`)) return;
      await api(`/admin/agents/${agent.id}`, { method: 'DELETE' });
      if (editingAgentId === agent.id) cancelEditAgent();
      loadAgents();
    });
    els.agentList.appendChild(row);
  }
}

function startEditAgent(id) {
  const agent = agentsCache.find((a) => a.id === id);
  if (!agent) return;
  editingAgentId = id;
  els.agentUsername.value = agent.username;
  els.agentFullName.value = agent.full_name || '';
  els.agentPhone.value = agent.phone || '';
  els.agentEmail.value = agent.email || '';
  els.agentPassword.value = '';
  els.agentPassword.required = false;
  els.agentPassword.placeholder = 'Değiştirmek istemiyorsanız boş bırakın';
  els.agentSubmitBtn.textContent = 'Güncelle';
  els.agentCancelEditBtn.classList.remove('hidden');
}

function cancelEditAgent() {
  editingAgentId = null;
  els.agentForm.reset();
  els.agentPassword.required = true;
  els.agentPassword.placeholder = 'Geçici bir şifre belirleyin';
  els.agentSubmitBtn.textContent = 'Ekle';
  els.agentCancelEditBtn.classList.add('hidden');
}

els.agentCancelEditBtn.addEventListener('click', cancelEditAgent);

els.agentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    username: els.agentUsername.value.trim(),
    fullName: els.agentFullName.value.trim(),
    phone: els.agentPhone.value.trim(),
    email: els.agentEmail.value.trim(),
    password: els.agentPassword.value,
  };
  try {
    if (editingAgentId) {
      await api(`/admin/agents/${editingAgentId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/admin/agents', { method: 'POST', body: JSON.stringify(payload) });
    }
    cancelEditAgent();
    loadAgents();
  } catch (err) {
    alert(err.message);
  }
});

// --------------------------- Destek kayitlari (biletler) ---------------------------

const STATUS_LABELS = { cozuldu: 'Çözüldü', devam_ediyor: 'Devam Ediyor', yonlendirildi: 'Yönlendirildi' };

function formatDuration(seconds) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}dk ${s}sn`;
}

async function loadTickets() {
  const tickets = await api('/admin/tickets');
  renderTicketStats(tickets);
  renderTicketTable(tickets);
}

function renderTicketStats(tickets) {
  const finished = tickets.filter((t) => t.ended_at);
  const perAgent = {};
  for (const t of finished) {
    perAgent[t.agent_username] = perAgent[t.agent_username] || { count: 0, totalDuration: 0 };
    perAgent[t.agent_username].count += 1;
    perAgent[t.agent_username].totalDuration += t.duration_seconds || 0;
  }

  els.ticketStats.innerHTML = '';
  const agentNames = Object.keys(perAgent);
  if (agentNames.length === 0) {
    els.ticketStats.innerHTML = '<p class="empty-hint">Henüz tamamlanmış görüşme yok.</p>';
    return;
  }

  for (const name of agentNames) {
    const { count, totalDuration } = perAgent[name];
    const avg = Math.round(totalDuration / count);
    const chip = document.createElement('div');
    chip.className = 'ticket-stat-chip';
    chip.innerHTML = `<b></b> — <span></span> görüşme, ort. <span></span>`;
    const spans = chip.querySelectorAll('span');
    chip.querySelector('b').textContent = name;
    spans[0].textContent = count;
    spans[1].textContent = formatDuration(avg);
    els.ticketStats.appendChild(chip);
  }
}

function renderTicketTable(tickets) {
  els.ticketTableBody.innerHTML = '';

  if (tickets.length === 0) {
    els.ticketTableBody.innerHTML = '<tr><td colspan="9" class="empty-hint">Henüz kayıt yok.</td></tr>';
    return;
  }

  for (const t of tickets) {
    const row = document.createElement('tr');
    const statusLabel = t.status ? STATUS_LABELS[t.status] || t.status : '—';
    const statusClass = t.status || '';
    row.innerHTML = `
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td>${t.status ? `<span class="status-pill ${statusClass}">${statusLabel}</span>` : '—'}</td>
      <td></td>
      <td></td>
      <td><button type="button" class="link-btn danger ticket-delete-btn">Sil</button></td>
    `;
    const customerLabel = [t.cari_adi, t.customer_full_name, t.customer_phone].filter(Boolean).join(' / ');
    const cells = row.querySelectorAll('td');
    cells[0].textContent = t.started_at;
    cells[1].textContent = t.agent_username;
    cells[2].textContent = t.room_code;
    cells[3].textContent = customerLabel || '—';
    cells[4].textContent = t.customer_note || '—';
    cells[6].textContent = formatDuration(t.duration_seconds);
    cells[7].textContent = t.note || '—';
    row.querySelector('.ticket-delete-btn').addEventListener('click', () => deleteTicket(t.id));
    els.ticketTableBody.appendChild(row);
  }
}

async function deleteTicket(id) {
  if (!confirm('Bu destek kaydını silmek istediğinize emin misiniz?')) return;
  try {
    await api(`/admin/tickets/${id}`, { method: 'DELETE' });
    loadTickets();
  } catch (err) {
    alert(err.message);
  }
}

// --------------------------- V3 (Nebim) entegrasyonu ---------------------------

async function loadV3Settings() {
  const s = await api('/admin/v3-settings');
  if (!s) return;
  els.v3Host.value = s.host || '';
  els.v3Port.value = s.port || '';
  els.v3Database.value = s.databaseName || '';
  els.v3Username.value = s.username || '';
  els.v3PasswordHint.textContent = s.hasPassword ? '(kayıtlı şifre var, değiştirmek için doldurun)' : '';
}

els.v3SettingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/admin/v3-settings', {
      method: 'POST',
      body: JSON.stringify({
        host: els.v3Host.value.trim(),
        port: els.v3Port.value.trim(),
        databaseName: els.v3Database.value.trim(),
        username: els.v3Username.value.trim(),
        password: els.v3Password.value,
        cariTable: null,
      }),
    });
    els.v3Password.value = '';
    els.v3TestResult.textContent = 'Kaydedildi.';
    els.v3TestResult.className = 'build-status status-success';
    loadV3Settings();
  } catch (err) {
    els.v3TestResult.textContent = err.message;
    els.v3TestResult.className = 'build-status status-error';
  }
});

els.v3TestBtn.addEventListener('click', async () => {
  els.v3TestResult.textContent = 'Test ediliyor...';
  els.v3TestResult.className = 'build-status status-running';
  try {
    await api('/admin/v3-settings/test', { method: 'POST' });
    els.v3TestResult.textContent = 'Bağlantı başarılı.';
    els.v3TestResult.className = 'build-status status-success';
  } catch (err) {
    els.v3TestResult.textContent = `Bağlantı başarısız: ${err.message}`;
    els.v3TestResult.className = 'build-status status-error';
  }
});

els.v3ListTablesBtn.addEventListener('click', async () => {
  els.v3TablesResult.classList.remove('hidden');
  els.v3TablesResult.textContent = 'Yükleniyor...';
  try {
    const tables = await api('/admin/v3-settings/tables');
    els.v3TablesResult.innerHTML = '';
    for (const t of tables) {
      const row = document.createElement('div');
      const link = document.createElement('button');
      link.textContent = `${t.TABLE_SCHEMA}.${t.TABLE_NAME}`;
      link.type = 'button';
      link.className = 'link-btn';
      link.style.marginTop = '0';
      link.addEventListener('click', () => showV3Columns(t.TABLE_NAME));
      row.appendChild(link);
      els.v3TablesResult.appendChild(row);
    }
  } catch (err) {
    els.v3TablesResult.textContent = `Hata: ${err.message}`;
  }
});

els.v3SetupTableBtn.addEventListener('click', async () => {
  els.v3SetupTableResult.textContent = 'Oluşturuluyor...';
  els.v3SetupTableResult.className = 'build-status status-running';
  try {
    const res = await api('/admin/v3-settings/setup-table', { method: 'POST' });
    els.v3SetupTableResult.textContent = `Hazır: ${res.table} tablosu mevcut.`;
    els.v3SetupTableResult.className = 'build-status status-success';
  } catch (err) {
    els.v3SetupTableResult.textContent = `Hata: ${err.message}`;
    els.v3SetupTableResult.className = 'build-status status-error';
  }
});

async function showV3Columns(tableName) {
  els.v3TablesResult.textContent = `${tableName} sütunları yükleniyor...`;
  try {
    const columns = await api(`/admin/v3-settings/columns?table=${encodeURIComponent(tableName)}`);
    els.v3TablesResult.textContent =
      `${tableName}:\n` + columns.map((c) => `  ${c.COLUMN_NAME} (${c.DATA_TYPE})`).join('\n');
  } catch (err) {
    els.v3TablesResult.textContent = `Hata: ${err.message}`;
  }
}

// --------------------------- E-posta ayarlari ---------------------------

async function loadEmailSettings() {
  const s = await api('/admin/email-settings');
  if (!s) return;
  els.emailSmtpHost.value = s.smtpHost || '';
  els.emailSmtpPort.value = s.smtpPort || '';
  els.emailSmtpSecure.checked = !!s.smtpSecure;
  els.emailSmtpUser.value = s.smtpUser || '';
  els.emailSmtpPasswordHint.textContent = s.hasPassword ? '(kayıtlı şifre var, değiştirmek için doldurun)' : '';
  els.emailFromAddress.value = s.fromAddress || '';
  els.emailRecipients.value = s.recipients || '';
  els.emailWeeklyEnabled.checked = !!s.weeklySummaryEnabled;
}

els.emailSettingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/admin/email-settings', {
      method: 'POST',
      body: JSON.stringify({
        smtpHost: els.emailSmtpHost.value.trim(),
        smtpPort: els.emailSmtpPort.value.trim(),
        smtpSecure: els.emailSmtpSecure.checked,
        smtpUser: els.emailSmtpUser.value.trim(),
        smtpPassword: els.emailSmtpPassword.value,
        fromAddress: els.emailFromAddress.value.trim(),
        recipients: els.emailRecipients.value.trim(),
        weeklySummaryEnabled: els.emailWeeklyEnabled.checked,
      }),
    });
    els.emailSmtpPassword.value = '';
    els.emailTestResult.textContent = 'Kaydedildi.';
    els.emailTestResult.className = 'build-status status-success';
    loadEmailSettings();
  } catch (err) {
    els.emailTestResult.textContent = err.message;
    els.emailTestResult.className = 'build-status status-error';
  }
});

els.emailTestBtn.addEventListener('click', async () => {
  els.emailTestResult.textContent = 'Test e-postası gönderiliyor...';
  els.emailTestResult.className = 'build-status status-running';
  try {
    await api('/admin/email-settings/test', { method: 'POST', body: JSON.stringify({}) });
    els.emailTestResult.textContent = 'Test e-postası gönderildi.';
    els.emailTestResult.className = 'build-status status-success';
  } catch (err) {
    els.emailTestResult.textContent = `Gönderilemedi: ${err.message}`;
    els.emailTestResult.className = 'build-status status-error';
  }
});

els.emailWeeklyNowBtn.addEventListener('click', async () => {
  els.emailWeeklyResult.textContent = 'Gönderiliyor...';
  els.emailWeeklyResult.className = 'build-status status-running';
  try {
    const r = await api('/admin/email-settings/send-weekly-now', { method: 'POST', body: JSON.stringify({}) });
    if (r.skipped) {
      els.emailWeeklyResult.textContent = 'Gönderilmedi: "Müşterilere haftalık özet gönder" kapalı.';
      els.emailWeeklyResult.className = 'build-status status-error';
    } else {
      els.emailWeeklyResult.textContent = `Tamamlandı: ${r.sent} müşteriye gönderildi, ${r.failed} hata (toplam ${r.totalCustomers} müşteri).`;
      els.emailWeeklyResult.className = 'build-status status-success';
    }
  } catch (err) {
    els.emailWeeklyResult.textContent = `Hata: ${err.message}`;
    els.emailWeeklyResult.className = 'build-status status-error';
  }
});

// --------------------------- Telegram ayarlari ---------------------------

async function loadTelegramSettings() {
  const s = await api('/admin/telegram-settings');
  if (!s) return;
  els.telegramTokenHint.textContent = s.hasToken ? '(kayıtlı token var, değiştirmek için doldurun)' : '';
  els.telegramChatId.value = s.chatId || '';
}

els.telegramSettingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/admin/telegram-settings', {
      method: 'POST',
      body: JSON.stringify({
        botToken: els.telegramBotToken.value.trim(),
        chatId: els.telegramChatId.value.trim(),
      }),
    });
    els.telegramBotToken.value = '';
    els.telegramTestResult.textContent = 'Kaydedildi.';
    els.telegramTestResult.className = 'build-status status-success';
    loadTelegramSettings();
  } catch (err) {
    els.telegramTestResult.textContent = err.message;
    els.telegramTestResult.className = 'build-status status-error';
  }
});

els.telegramTestBtn.addEventListener('click', async () => {
  els.telegramTestResult.textContent = 'Test mesajı gönderiliyor...';
  els.telegramTestResult.className = 'build-status status-running';
  try {
    await api('/admin/telegram-settings/test', { method: 'POST', body: JSON.stringify({}) });
    els.telegramTestResult.textContent = 'Test mesajı gönderildi.';
    els.telegramTestResult.className = 'build-status status-success';
  } catch (err) {
    els.telegramTestResult.textContent = `Gönderilemedi: ${err.message}`;
    els.telegramTestResult.className = 'build-status status-error';
  }
});

// --------------------------- Kurulum uretme ---------------------------

const buildEls = {
  customer: {
    btn: els.buildCustomerBtn,
    status: els.buildCustomerStatus,
    log: els.buildCustomerLog,
    downloadLink: els.downloadCustomerLink,
  },
  staff: {
    btn: els.buildStaffBtn,
    status: els.buildStaffStatus,
    log: els.buildStaffLog,
    downloadLink: els.downloadStaffLink,
  },
};

els.buildCustomerBtn.addEventListener('click', () => triggerBuild('customer'));
els.buildStaffBtn.addEventListener('click', () => triggerBuild('staff'));

async function triggerBuild(variant) {
  try {
    await api(`/admin/build/${variant}`, { method: 'POST' });
    pollBuildStatus(variant);
  } catch (err) {
    alert(err.message);
  }
}

async function pollBuildStatus(variant) {
  const state = await api(`/admin/build/${variant}/status`);
  renderBuildStatus(variant, state);

  const timers = buildPollTimers;
  if (state.status === 'running') {
    buildEls[variant].btn.disabled = true;
    if (timers[variant]) clearTimeout(timers[variant]);
    timers[variant] = setTimeout(() => pollBuildStatus(variant), 2000);
  } else {
    buildEls[variant].btn.disabled = false;
    if (timers[variant]) clearTimeout(timers[variant]);
  }
}

function renderBuildStatus(variant, state) {
  const labels = {
    idle: 'Henüz kurulum üretilmedi.',
    running: 'Kurulum üretiliyor, lütfen bekleyin...',
    success: 'Kurulum başarıyla üretildi.',
    error: 'Kurulum üretilirken bir hata oluştu.',
  };
  const ui = buildEls[variant];
  ui.status.textContent = labels[state.status] || '';
  ui.status.className = `build-status status-${state.status}`;

  if (state.log) {
    ui.log.textContent = state.log;
    ui.log.classList.remove('hidden');
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  if (state.status === 'success' && state.exeFile) {
    ui.downloadLink.href = `/api/admin/build/${variant}/download`;
    ui.downloadLink.classList.remove('hidden');
  } else {
    ui.downloadLink.classList.add('hidden');
  }
}

// --------------------------- Panel kullanicilari ---------------------------

let editingAdminId = null;
let adminsCache = [];
const ADMIN_ROLE_LABELS = { admin: 'Yönetici', destek: 'Destek (kısıtlı)' };

async function loadAdmins() {
  const admins = await api('/admin/admins');
  adminsCache = admins;
  els.adminList.innerHTML = '';

  if (admins.length === 0) {
    els.adminList.innerHTML = '<p class="empty-hint">Henüz başka panel kullanıcısı eklenmedi.</p>';
    return;
  }

  for (const admin of admins) {
    const row = document.createElement('div');
    row.className = 'item-row admin-list-row';
    row.innerHTML = `
      <span class="item-text"></span>
      <span class="item-text"></span>
      <button class="link-btn" type="button" style="margin-top:0;">Düzenle</button>
      <button class="item-delete" type="button" title="Sil">✕</button>
    `;
    const cells = row.querySelectorAll('.item-text');
    cells[0].textContent = admin.username;
    cells[1].textContent = ADMIN_ROLE_LABELS[admin.role] || admin.role;
    row.querySelector('.link-btn').addEventListener('click', () => startEditAdmin(admin.id));
    row.querySelector('.item-delete').addEventListener('click', async () => {
      if (!confirm(`"${admin.username}" panel hesabını silmek istediğinize emin misiniz?`)) return;
      try {
        await api(`/admin/admins/${admin.id}`, { method: 'DELETE' });
        if (editingAdminId === admin.id) cancelEditAdmin();
        loadAdmins();
      } catch (err) {
        alert(err.message);
      }
    });
    els.adminList.appendChild(row);
  }
}

function startEditAdmin(id) {
  const admin = adminsCache.find((a) => a.id === id);
  if (!admin) return;
  editingAdminId = id;
  els.adminUsername.value = admin.username;
  els.adminRole.value = admin.role;
  els.adminPassword.value = '';
  els.adminPassword.required = false;
  els.adminPassword.placeholder = 'Değiştirmek istemiyorsanız boş bırakın';
  els.adminSubmitBtn.textContent = 'Güncelle';
  els.adminCancelEditBtn.classList.remove('hidden');
}

function cancelEditAdmin() {
  editingAdminId = null;
  els.adminForm.reset();
  els.adminPassword.required = true;
  els.adminPassword.placeholder = 'Geçici bir şifre belirleyin';
  els.adminSubmitBtn.textContent = 'Ekle';
  els.adminCancelEditBtn.classList.add('hidden');
}

els.adminCancelEditBtn.addEventListener('click', cancelEditAdmin);

els.adminForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    username: els.adminUsername.value.trim(),
    role: els.adminRole.value,
    password: els.adminPassword.value,
  };
  try {
    if (editingAdminId) {
      await api(`/admin/admins/${editingAdminId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/admin/admins', { method: 'POST', body: JSON.stringify(payload) });
    }
    cancelEditAdmin();
    loadAdmins();
  } catch (err) {
    alert(err.message);
  }
});

// --------------------------- Sayfa gecisleri (yan menu) ---------------------------

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.dashboard-page').forEach((page) => {
      page.classList.toggle('hidden', page.id !== `page-${btn.dataset.page}`);
    });
  });
});

init();
