// NexusOn - Electron ana surec (main process)
//
// Bu dosyadaki hicbir bilesen ucretli/kullanim-bazli bir servise baglanmaz:
//  - Ekran paylasimi: native DXGI Desktop Duplication API (windows-desktop-duplication, MIT)
//  - Dosya sec/kaydet: Electron'un yerlesik dialog API'si (ucretsiz)
//  - Uzaktan fare/klavye kontrolu: @nut-tree-fork/nut-js (MIT lisansli, ucretsiz npm paketi)

const { app, BrowserWindow, ipcMain, dialog, session, desktopCapturer, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const { DesktopDuplication } = require('windows-desktop-duplication');

let mainWindow;

// --------------------------------------------------------------------------
// Telegram bildirimindeki koda tiklaninca dogrudan NexusOn'u acan ozel
// protokol (nexuson://connect?roomCode=...&cariKodu=...&cariAdi=...).
// Windows'ta boyle bir baglanti TIKLANINCA isletim sistemi uygulamayi YENI
// bir surec olarak baslatir (URL, process.argv icinde bir arguman olarak
// gelir) - eger NexusOn zaten acik bir kopyayi calisiyorsa, bu YENI surecin
// hemen kapanip mevcut pencereyi one getirmesi ve URL'i ONA iletmesi gerekir
// (requestSingleInstanceLock + 'second-instance' olayi tam bunun icin var).
const PROTOCOL_SCHEME = 'nexuson';
app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);

function extractDeepLinkUrl(argv) {
  return argv.find((a) => a.startsWith(`${PROTOCOL_SCHEME}://`)) || null;
}

function parseDeepLink(rawUrl) {
  try {
    const u = new URL(rawUrl);
    // u.hostname => "connect" (nexuson://connect?...), parametreler u.searchParams'ta.
    return {
      roomCode: u.searchParams.get('roomCode') || '',
      cariKodu: u.searchParams.get('cariKodu') || '',
      cariAdi: u.searchParams.get('cariAdi') || '',
    };
  } catch {
    return null;
  }
}

function handleDeepLinkUrl(rawUrl) {
  const payload = parseDeepLink(rawUrl);
  if (!payload || !payload.roomCode) return;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isMaximized()) mainWindow.maximize();
    mainWindow.focus();
    mainWindow.webContents.send('deep-link', payload);
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const url = extractDeepLinkUrl(argv);
    if (url) handleDeepLinkUrl(url);
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Gecici tanilama loglamasi: donma/yavaslik sorununu somut veriyle teshis
// etmek icin. Sorun cozulup dogrulanana kadar burada kalacak.
const DEBUG_LOG_PATH = path.join(os.tmpdir(), 'nexuson-debug.log');
function debugLog(msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(DEBUG_LOG_PATH, line);
  } catch {
    // loglama basarisiz olsa bile uygulamanin geri kalani calismaya devam etsin
  }
}
ipcMain.on('debug-log', (_e, msg) => debugLog(String(msg)));

// ONEMLI: webPreferences.backgroundThrottling=false SADECE JS zamanlayicilarini
// (setTimeout/rAF) etkiler. Pencere kucultulunce (minimize/occluded) Chromium
// ayrica renderer surecinin kendisini ve video/agi (WebRTC dahil) de ayri bir
// mekanizmayla "arka plana atip" yavaslatabiliyor - bu da tam olarak "destek
// ekibi kendi NexusOn penceresini kucultunce ekran/kontrol donuyor" belirtisine
// yol aciyordu. Bu anahtarlar o ek mekanizmayi da devre disi birakir.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// NexusOn: canli bir oturumda KANITLANDI - pencere kucultulup geri
// buyutulunce MediaStreamTrackGenerator'in yazilabilir akisi Chromium
// tarafindan kalici olarak kapatiliyordu ("Stream closed"), goruntu bir
// daha hic gelmiyordu. Yukaridaki uc anahtar bunu onlemeye yetmedi - bu,
// Windows'un "native pencere gizleme" (occlusion) ozelliginin kucultulmus/
// ortulu pencereler icin GPU compositing/rendering hattini durdurmasindan
// kaynaklaniyor olabilir. Bu ozelligi de kapatiyoruz. (v1.2.9'da ayrica
// renderer.js'de bu hatayi yakalayip otomatik kurtaran bir yedek mekanizma
// da eklendi - bu anahtar onu tetiklememeye, yedek ise tetiklenirse hizlica
// toparlanmaya calisir.)
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

function createWindow() {
  Menu.setApplicationMenu(null); // File/Edit/View/Window/Help menusu son kullaniciya gerekmiyor

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: 'NexusOn',
    show: false, // maximize() cagrisi bitene kadar gostermeyip acilista "kucuk pencere -> buyume" titremesini engelle
    // Windows'un varsayilan pencere cubugu, uygulamanin kendi ozel/markali
    // ust cubugunun UZERINDE ayrica gorunup iki ayri cubukmus gibi bir
    // gorunume yol aciyordu. frame:false ile Windows'un cubugunu tamamen
    // kaldirip, kucult/buyut/kapat dugmelerini kendi ust cubugumuza tasidik
    // (bkz. index.html #windowControls, renderer.js).
    frame: false,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // dosya IPC + webUtils icin preload'da node API'lerine ihtiyac var
      backgroundThrottling: false, // pencere kucultulunce (minimize) ekran paylasimi/uzaktan girdi islenmesi durmasin
    },
  });

  // Ekrandaki bos/kullanilmayan alani degerlendirmek ve paylasilan ekrani
  // olabildigince buyuk gostermek icin uygulama acilista tam ekrana
  // (maximize) buyusun.
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.webContents.setBackgroundThrottling(false);
  mainWindow.loadFile('index.html');

  // SOGUK BASLANGIC: uygulama henuz acik degilken linke tiklanmissa, isletim
  // sistemi bizi DOGRUDAN bu URL'le baslatir - process.argv icinde gelir.
  const coldStartUrl = extractDeepLinkUrl(process.argv);
  if (coldStartUrl) {
    mainWindow.webContents.once('did-finish-load', () => handleDeepLinkUrl(coldStartUrl));
  }

  if (process.env.NEXUSGO_AUTOSCRIPT) {
    const delay = Number(process.env.NEXUSGO_AUTODELAY) || 2000;
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        mainWindow.webContents
          .executeJavaScript(process.env.NEXUSGO_AUTOSCRIPT)
          .then((result) => console.log('[autoscript-result]', JSON.stringify(result)))
          .catch((err) => console.log('[autoscript-error]', err.message));
      }, delay);
    });
  }

  // YEDEK YOL: native DXGI yakalama bazi makinelerde (coklu ekran karti,
  // farkli surucu/donanim kombinasyonu, vb.) "Failed to get duplicate
  // output: Parametre hatali" (E_INVALIDARG) ile basarisiz olabiliyor - bu
  // makineye ozgu bir uyumluluk sorunu, genel bir kod hatasi degil. Native
  // yakalama basarisiz olursa musteri HIC destek alamaz hale gelmesin diye,
  // eski (daha yavas ama her zaman calisan) getDisplayMedia/desktopCapturer
  // yolu burada YEDEK olarak duruyor - renderer.js sadece dxgi-init/
  // dxgi-get-frame basarisiz olursa buna dusuyor (bkz. startHostOffer).
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        callback({ video: sources[0] });
      } catch (err) {
        console.error('Ekran kaynagi alinamadi:', err);
        callback({});
      }
    },
    { useSystemPicker: true }
  );

  mainWindow.on('minimize', () => debugLog('[pencere] minimize'));
  mainWindow.on('restore', () => debugLog('[pencere] restore'));
  mainWindow.on('focus', () => debugLog('[pencere] focus'));
  mainWindow.on('blur', () => debugLog('[pencere] blur'));
  mainWindow.on('hide', () => debugLog('[pencere] hide'));
  mainWindow.on('show', () => debugLog('[pencere] show'));
  mainWindow.on('unresponsive', () => debugLog('[CRASH] pencere yanit vermiyor (unresponsive)'));
  mainWindow.on('responsive', () => debugLog('[CRASH] pencere tekrar yanit veriyor (responsive)'));
  mainWindow.on('closed', () => debugLog('[pencere] closed'));

  // ONEMLI: "donma" sikayetlerinin bir kismi aslinda renderer surecinin
  // CRASH olup olmesi/OOM/kill edilmesi olabilir - bu durumda pencere son
  // cizilen kareyi ekranda birakir ve kullaniciya "donmus" gibi gorunur,
  // ama aslinda surec artik yasamiyordur. Daha once bu hicbir yerde
  // loglanmiyordu; bir sonraki "donma" olayinda kesin sebebi (crashed/oom/
  // killed/launch-failed) gormek icin eklendi.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    debugLog(`[CRASH] renderer sureci gitti: reason=${details.reason} exitCode=${details.exitCode}`);
  });

  // Ozel buyut/eski-haline-getir dugmesinin dogru simgeyi gosterebilmesi
  // icin (baslik cubugunu cift tiklamak gibi baska yollarla da durum
  // degisebilir) pencere durumunu renderer'a bildiriyoruz.
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window-maximized-state', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window-maximized-state', false));
}

app.whenReady().then(createWindow);

// ---------------------------------------------------------------------------
// Pencere kontrolleri: frame:false ile Windows'un kendi kucult/buyut/kapat
// dugmeleri kaldirildigi icin, bunlarin yerini alan ozel/markali ust cubuk
// dugmeleri buradan pencereyi yonetir. Ayrica "cift tikla/buyut-kucult"
// durumunu renderer'a bildirip dogru simgeyi (buyut vs eski haline getir)
// gosterebilmesini sagliyoruz.
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize-toggle', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

// ---------------------------------------------------------------------------
// Ekran yakalama: native DXGI Desktop Duplication API. Renderer'daki eski
// getDisplayMedia() cagrisi, Chromium'un "ekranda gorunur degisiklik yoksa
// kareyi atla" davranisi yuzunden donma/1fps sikayetinin kok nedeniydi - bu
// yol GPU seviyesinde calisir ve bu davranisa sahip degil (bkz. renderer.js
// startDxgiCapture). getFrameAsync() kendi native thread'inde calisir, ana
// surecin olay dongusunu bloke etmez (nut-js'in aksine, ayri bir worker
// thread'e gerek yok).
let dxgiCapture = null;
let dxgiCaptureScreenNum = null;

// Coklu ekran secici (AnyDesk tarzi "ekran degistir" tusu) icin: personel
// tarafinin kac ekran oldugunu sorabilmesi lazim - capture BASLATMADAN,
// sadece bir sayi donuyor.
ipcMain.handle('dxgi-monitor-count', async () => {
  return DesktopDuplication.getMonitorCount();
});

ipcMain.handle('dxgi-init', async (_e, screenNum = 0) => {
  // ONEMLI (canli bir musteri oturumunda KANITLANDI): initialize() basarisiz
  // olursa (ornegin "Failed to get duplicate output: Parametre hatali" -
  // E_INVALIDARG, bu makine/surucu kombinasyonunda bilinen bir arıza),
  // dxgiCapture DEGISKENI ESKIDEN yine de bu YARIM/BOZUK nesneye atanmis
  // kaliyordu. Bir sonraki dxgi-get-frame cagrisi bu bozuk native nesne
  // uzerinden getFrameAsync() cagirinca, ana sureci JS'ten YAKALANAMAYAN bir
  // native cokme ile tamamen goturdugu gozlemlendi (uygulama sessizce
  // kapandi, hicbir [CRASH] logu bile dusmedi - main surec cokunce kimse
  // bunu loglayamiyor). Fix: baslatma basarisiz olursa dxgiCapture'i null'a
  // geri al, boylece bir sonraki cagri guvenli/JS-yakalanabilir "henuz
  // baslatilmadi" hatasini alir, bozuk native nesneye asla dokunulmaz.
  //
  // ONEMLI (CANLI KANITLANDI): eski dxgiCapture nesnesinin native yikicisi
  // (~DesktopDuplication) V8'in cop toplayicisi ne zaman isterse o zaman
  // calisiyordu, HEMEN degil - bu yuzden JS tarafina senkron bir dispose()
  // metodu eklendi (bkz. windows-desktop-duplication yamasi) ve reinit
  // oncesi burada cagrildi. AMA bu TEK BASINA yetmedi - canli testte (hem bu
  // makinede hem GERCEK test bilgisayarinda) AYNI "Failed to get duplicate
  // output: The parameter is incorrect." hatasi dispose() cagrisindan SONRA
  // bile devam etti, kisa (150ms) bir bekleme eklenince de degismedi.
  //
  // GUNCELLEME (native kaynak kodu tekrar okunarak bulundu): initialize()'in
  // KENDISI zaten fonksiyonun en basinda cleanUp() cagiriyor - native
  // kaynaginin kendi yorumu acikca soyluyor: "call cleanup so we can call
  // this function multiple times without memory leaks". Yani kutuphane
  // yazari initialize()'in AYNI nesne uzerinde GUVENLE tekrar tekrar
  // cagirilabilecek sekilde tasarlamis - main.js ise simdiye kadar HER
  // reinit'te SIFIRDAN YENI bir DesktopDuplication nesnesi olusturuyordu,
  // kutuphanenin kendi tasarladigi yeniden-baslatma yolunu hic kullanmadan.
  // Artik dxgiCapture zaten varsa dispose+yeniden olusturmak yerine AYNI
  // nesne uzerinde tekrar initialize() cagiriyoruz - bu, kutuphanenin
  // desteklemek uzere yazildigi yol.
  // Coklu ekran secici: screenNum ONCEKI baslatmadan FARKLIYSA, ayni nesne
  // uzerinde initialize() cagirmak islevsiz kalir (screenNum sadece
  // constructor'a gecer) - bu durumda YENI bir nesne kurulmali. Ayni ekran
  // icin tekrar baslatmada (reinit-after-failure) ise yukaridaki optimizasyon
  // (ayni nesne, dispose'suz initialize()) korunuyor.
  try {
    if (dxgiCapture && dxgiCaptureScreenNum === screenNum) {
      dxgiCapture.initialize();
    } else {
      dxgiCapture = new DesktopDuplication(screenNum);
      dxgiCapture.initialize();
      dxgiCaptureScreenNum = screenNum;
    }
    return DesktopDuplication.getMonitorCount();
  } catch (err) {
    dxgiCapture = null;
    dxgiCaptureScreenNum = null;
    throw err;
  }
});

ipcMain.handle('dxgi-get-frame', async () => {
  if (!dxgiCapture) throw new Error('DXGI yakalama henuz baslatilmadi.');
  const frame = await dxgiCapture.getFrameAsync();
  return frame;
});

// NexusOn: musteriye "ekran kartinizin modeli nedir" gibi teknik sorular
// sormak saçma - gerçek uzaktan destek araclari bu bilgiyi kendisi toplar.
// Bu, DXGI/getDisplayMedia'nin bazi musteri makinelerinde neden basarisiz
// oldugunu (ekran karti/surucu) HER oturumda otomatik olarak, musteriye hic
// sormadan teshis edebilmek icin eklendi.
ipcMain.handle('get-system-info', async () => {
  let gpu = null;
  try {
    gpu = await app.getGPUInfo('basic');
  } catch (err) {
    gpu = { error: err.message };
  }
  return {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    totalMemGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
    gpu,
  };
});

// Ana surecin kendisi beklenmedik bir hatayla sessizce cokup butun
// uygulamayi (ve dolayisiyla pencereyi) yok etmesi ihtimaline karsi: bu
// olmadan surec oldugunde geriye HICBIR iz kalmiyordu (log dosyasi aniden
// kesiliyordu). Artik en azindan sebep log dosyasina yazilir.
process.on('uncaughtException', (err) => {
  debugLog(`[CRASH] ana surecte yakalanmamis hata: ${err?.stack || err}`);
});
process.on('unhandledRejection', (reason) => {
  debugLog(`[CRASH] ana surecte yakalanmamis promise reddi: ${reason}`);
});
app.on('child-process-gone', (_e, details) => {
  debugLog(`[CRASH] alt surec gitti: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`);
});
app.on('render-process-gone', (_e, _webContents, details) => {
  debugLog(`[CRASH] (app) renderer sureci gitti: reason=${details.reason} exitCode=${details.exitCode}`);
});

// package.json'i preload'dan gorece yolla (require('../package.json')) okumak
// paketlenmis (asar) derlemede yanlis konuma bakiyordu (asar'in bir ust
// dizini, orada package.json yok) ve sessizce basarisiz oluyordu. Electron'un
// kendi app.getVersion() metodu hem gelistirme hem paketlenmis derlemede dogru
// calisir.
ipcMain.on('get-app-version', (event) => {
  event.returnValue = app.getVersion();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// Dosya GONDERME: kullanici dosya secer, renderer parca parca (chunk) okuyup
// WebRTC DataChannel uzerinden karsiya yollar.
// ---------------------------------------------------------------------------

ipcMain.handle('pick-file-to-send', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const stat = fs.statSync(filePath);
  return { path: filePath, name: path.basename(filePath), size: stat.size };
});

ipcMain.handle('read-file-chunk', (_e, { filePath, offset, length }) => {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, offset);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
});

// ---------------------------------------------------------------------------
// Dosya ALMA: karsi taraftan gelen parcalari kullanicinin sectigi konuma yazar.
// ---------------------------------------------------------------------------

const incomingFiles = new Map(); // transferId -> { fd, filePath }

ipcMain.handle('start-receive-file', async (_e, { transferId, fileName }) => {
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: fileName });
  if (result.canceled || !result.filePath) return null;
  const fd = fs.openSync(result.filePath, 'w');
  incomingFiles.set(transferId, { fd, filePath: result.filePath });
  return result.filePath;
});

ipcMain.handle('write-file-chunk', (_e, { transferId, chunk }) => {
  const entry = incomingFiles.get(transferId);
  if (!entry) return false;
  fs.writeSync(entry.fd, Buffer.from(chunk));
  return true;
});

ipcMain.handle('finish-receive-file', (_e, { transferId }) => {
  const entry = incomingFiles.get(transferId);
  if (!entry) return false;
  fs.closeSync(entry.fd);
  incomingFiles.delete(transferId);
  return entry.filePath;
});

ipcMain.handle('show-file-in-folder', (_e, filePath) => {
  shell.showItemInFolder(filePath);
});

// Iletisim kartindaki WhatsApp/web sitesi/e-posta baglantilari sistemin
// varsayilan uygulamasinda acilsin diye (uygulama icinde degil).
ipcMain.handle('open-external', (_e, url) => {
  shell.openExternal(url);
});

// ---------------------------------------------------------------------------
// Otomatik guncelleme: yeni kurulum dosyasini indirip calistirir, ardindan
// uygulamayi kapatir (yukleyici mevcut kurulumun uzerine yazar). Ayri bir
// guncelleme sunucusu/servisi gerektirmez, admin panelin zaten var olan
// sabit indirme linkini kullanir.
// ---------------------------------------------------------------------------

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(destPath, () => {});
        downloadFile(res.headers.location, destPath).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        reject(new Error(`Sunucu HTTP ${res.statusCode} döndürdü.`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    request.on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

ipcMain.handle('download-and-install-update', async (_e, url) => {
  const destPath = path.join(os.tmpdir(), 'NexusOn-Setup-Update.exe');
  await downloadFile(url, destPath);

  // shell.openPath hata firlatmaz, basarisiz olursa hata metnini dondurur.
  const openError = await shell.openPath(destPath);
  if (openError) throw new Error(openError);

  app.quit();
});

// ---------------------------------------------------------------------------
// Uzaktan kontrol: karsi taraftan gelen fare/klavye olaylarini bu bilgisayara
// enjekte eder (nut-js). Sadece "Uzaktan kontrole izin ver" isaretliyken
// renderer bu kanali kullanir; burasi da yalnizca cagrildiginda calisir.
// ---------------------------------------------------------------------------

// nut-js'in native cagrilari bazi makinelerde SENKRON olarak (Node'un olay
// dongusunu bloke ederek) takilabiliyor - bu durumda ana surecte yazilan bir
// JS zaman asimi (setTimeout) bile hicbir zaman calismaz, cunku o da ayni
// bloke olmus is parcacigini bekler. Bu yuzden nut-js'i tamamen ayri bir
// worker thread'de calistiriyoruz: o thread tikansa bile ana surec (ve
// dolayisiyla uygulamanin geri kalani - pencere, IPC, diger sekmeler)
// calismaya devam eder; bir yanit belirlenen surede gelmezse worker
// sonlandirilip yenisi baslatilir, boylece bir sonraki komut calisir.
const { Worker } = require('worker_threads');

let nutWorker = null;
const pendingNutRequests = new Map(); // id -> { resolve, reject, timer }
let nextNutRequestId = 1;

function spawnNutWorker() {
  // ONEMLI (CANLI KANITLANDI): nut-worker baslatilamadigi zaman viewer
  // tarafinda sadece genel "Uzaktan girdi altyapısı hazır değil" hatasi
  // goruluyordu - GERCEK sebep (ornegin nut-js native modulunun bu
  // makinede yuklenememesi) sadece console.log/console.error'a yaziliyordu,
  // ki musteri makinesinde bu konsola HICBIR ZAMAN erisimimiz yok. Artik
  // hepsi debugLog'a da (kalici dosyaya) yaziliyor - bir dahaki sefere
  // musteriden gercek sebebi gorebilecegiz.
  const worker = new Worker(path.join(__dirname, 'nut-worker.js'));
  nutWorker = worker;
  worker.on('message', (msg) => {
    if (msg.type === 'debug') {
      debugLog(msg.msg);
      return;
    }
    if (msg.type === 'ready') {
      console.log('nut-worker hazir.');
      debugLog('[nut-worker] hazir.');
      return;
    }
    if (msg.type === 'ready-error') {
      console.error('nut-worker onceden yukleme hatasi:', msg.error);
      debugLog(`[nut-worker] onceden yukleme HATASI: ${msg.error}`);
      return;
    }
    const pending = pendingNutRequests.get(msg.id);
    if (!pending) return;
    pendingNutRequests.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.ok) pending.resolve(msg.data);
    else pending.reject(new Error(msg.error));
  });
  worker.on('error', (err) => {
    console.error('nut-worker beklenmedik hata:', err.message);
    debugLog(`[nut-worker] beklenmedik HATA: ${err.message}${err.stack ? ' | ' + err.stack : ''}`);
  });
  worker.on('exit', (code) => {
    if (code !== 0) {
      console.error('nut-worker beklenmedik sekilde kapandi, kod:', code);
      debugLog(`[nut-worker] beklenmedik sekilde kapandi, kod: ${code}`);
    }
    // ONEMLI (CANLI KANITLANDI): hizli ardisik girdi (ornegin bir URL'nin
    // hizlica yazilmasi) nut-worker'in islem kuyrugunu doldurunca, kuyrukta
    // bekleyen HER istek kendi zaman asimina ayri ayri ugrayip asagidaki
    // timeout kolundan birden fazla kez "terminate + spawnNutWorker"
    // tetikleniyordu - art arda birden fazla worker baslatilip birbirinin
    // yerini aliyordu. Sonlandirilan ESKI worker'larin 'exit' olayi bu
    // yeniden baslatmalardan SONRA, gecikmeli gelebiliyor - o zaman burasi
    // kosulsuzca `nutWorker = null` yaparsa, o an gecerli olan SAGLIKLI
    // worker'in referansini siliyordu (kalici "Uzaktan girdi altyapısı
    // hazır değil" hatasinin gercek sebebi buydu). Fix: sadece HALA GUNCEL
    // worker biz isek (baskasi bizim yerimize gecmediyse) null'a cekiyoruz.
    if (nutWorker === worker) nutWorker = null;
  });
}
spawnNutWorker();

function sendToNutWorker(evt, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    if (!nutWorker) {
      // ONEMLI: eskiden burasi sadece hata donup birakiyordu - worker bir
      // kez null olduktan sonra (yukaridaki race condition ya da gercek bir
      // cokme yuzunden) uzaktan girdi o oturumun SONUNA KADAR kalici olarak
      // olu kaliyordu, hicbir sonraki komut kendini toparlayamiyordu. Simdi
      // burada da yeniden baslatmayi tetikliyoruz ki BIR SONRAKI komut
      // calissin.
      debugLog('[nut-worker] nutWorker null - yeniden baslatiliyor.');
      spawnNutWorker();
      reject(new Error('Uzaktan girdi altyapısı hazır değil, yeniden başlatılıyor - tekrar deneyin.'));
      return;
    }
    const myWorkerRef = nutWorker;
    const id = nextNutRequestId++;
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      pendingNutRequests.delete(id);
      console.error(`nut-worker '${evt.type}' komutuna ${timeoutMs}ms icinde yanit vermedi.`);
      // ONEMLI: bu istegin gonderildigi worker HALA gecerliyse (baska bir
      // zaman asimi onu zaten degistirmediyse) sonlandirip yenisini
      // baslatiyoruz. Ayni cokme olayindan kaynaklanan, kuyrukta birikmis
      // diger isteklerin zaman asimlari ise burada HICBIR SEY yapmiyor -
      // aksi halde her biri ayri ayri terminate+spawn tetikleyip birbirini
      // ezen bir dizi gereksiz worker baslatilmasina yol aciyordu.
      if (nutWorker === myWorkerRef) {
        nutWorker?.terminate();
        spawnNutWorker();
        reject(new Error(`Uzaktan girdi (${evt.type}) zaman aşımına uğradı - kurtarma için otomatik yeniden başlatıldı, tekrar deneyin.`));
      } else {
        reject(new Error(`Uzaktan girdi (${evt.type}) zaman aşımına uğradı (kuyruk birikmesi) - tekrar deneyin.`));
      }
    }, timeoutMs);
    pendingNutRequests.set(id, {
      resolve: (data) => {
        // ONEMLI: nut-worker kuyrugu birikirse (islem hizinin altinda olay
        // gelirse) her olay bir oncekinin ARKASINDA sıraya girip gitgide
        // daha geriden yanit verir - bu da "fare hareketi gecikmeli geliyor"
        // sikayetinin kanitini burada yakalar. Sadece dikkat cekici
        // (>80ms) gecikmeleri logluyoruz, her olayi degil.
        const elapsed = Date.now() - startedAt;
        if (elapsed > 80) debugLog(`[nut] '${evt.type}' işlenmesi ${elapsed}ms sürdü (kuyruk birikmiş olabilir)`);
        resolve(data);
      },
      reject,
      timer,
    });
    myWorkerRef.postMessage({ id, evt });
  });
}

ipcMain.handle('remote-input', async (_e, evt) => {
  try {
    await sendToNutWorker(evt);
  } catch (err) {
    console.error('Uzaktan girdi enjeksiyon hatasi:', err.message);
    mainWindow?.webContents.send('remote-input-error', err.message);
  }
});

// Gercek imlec konumu: DXGI'nin kendi PointerPosition verisi bazi
// makinelerde (surucuya ozgu) hicbir zaman dolmuyor - bkz.
// nexusgo-freeze-history.md. Ayni nut-js kaynagini (zaten remote-input icin
// kullaniliyor) donanimdan bagimsiz, guvenilir bir imlec konumu icin de
// kullaniyoruz.
ipcMain.handle('get-cursor-pos', async () => {
  return sendToNutWorker({ type: 'getpos' });
});
