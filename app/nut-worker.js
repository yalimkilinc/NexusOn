// Uzaktan fare/klavye enjeksiyonunu (nut-js) ayri bir worker thread'de calistirir.
//
// Bunun sebebi: nut-js'in native (yerel) baglayicisindaki bir cagri bazi
// makinelerde SENKRON olarak (Node'un olay dongusunu bloke ederek) takilabiliyor.
// Bu durumda ana surecte (main.js) yazilan bir JS zaman asimi (setTimeout) bile
// hicbir zaman calismaz, cunku o da ayni bloke olmus is parcacigini bekler.
// Bu kodu tamamen ayri bir isletim sistemi thread'ine tasiyarak, o thread
// tikansa bile ana surec (ve dolayisiyla uygulamanin geri kalani) calismaya
// devam eder; ana surec bir yanit gelmedigini fark edip bu worker'i sonlandirip
// yenisini baslatabilir.

const { parentPort } = require('worker_threads');
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

// ONEMLI (CANLI KANITLANDI): nut-js'in native typeString() fonksiyonu,
// U+00FF ustundeki (Latin Extended-A) kod noktalarini 8 bite KIRPIYOR -
// Turkce ğ (U+011F) -> 0x1F (Unit Separator kontrol karakteri), ş (U+015F)
// -> 0x5F ('_'), ı (U+0131) -> 0x31 ('1'), İ (U+0130) -> 0x30 ('0') olarak
// cikiyordu. Bu, kutuphanenin PRECOMPILED native (.node) binary'sinde -
// kaynak kodu yerel olarak yok, node_modules icindeki diger native
// modullerin (windows-desktop-duplication) aksine burada payload'i
// duzeltemiyoruz. Bunun yerine kendi kucuk, KALICI PowerShell yardimci
// surecimizi (unicode-typer.ps1) kullaniyoruz - o, Win32 SendInput'u
// KEYEVENTF_UNICODE ile TAM/kirpilmamis UTF-16 kod birimiyle dogrudan
// cagirir (canli dogrulandi: "iğş.ıİöçü" birebir dogru cikti). Fiziksel
// tus (Key[] pressKey/releaseKey) konum-tabanli oldugundan ve Turkce Q
// klavyede OEM tus konumlari US duzeninden farkli oldugundan (bir baska
// canli kanitlanmis yanlis yol) o da kullanilmiyor.
let unicodeTyperProc = null;
let unicodeTyperReady = null;
let unicodeTyperRl = null;
let unicodeTyperQueue = Promise.resolve();

function ensureUnicodeTyper() {
  if (unicodeTyperProc) return;
  // ONEMLI: paketlenmis (asar) derlemede __dirname 'app.asar' icini gosterir
  // - bu SANAL bir dosya sistemi, sadece Electron/Node'un KENDI yamali fs
  // API'lerine seffaf. powershell.exe HARICI bir surec oldugundan asar
  // icindeki bir yolu ACAMAZ - bu yuzden .ps1 dosyasini package.json'daki
  // "asarUnpack" ile GERCEK bir dosya olarak cikartip, burada yolu
  // 'app.asar' -> 'app.asar.unpacked' cevirerek GERCEK konumuna yonlendiriyoruz
  // (gelistirme modunda __dirname'de 'app.asar' hic gecmedigi icin bu
  // degistirme orada zararsiz bir no-op'tur).
  const scriptPath = path.join(__dirname, 'unicode-typer.ps1').replace('app.asar', 'app.asar.unpacked');
  const proc = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { windowsHide: true }
  );
  unicodeTyperProc = proc;
  const rl = readline.createInterface({ input: proc.stdout });
  unicodeTyperRl = rl;
  let resolveReady;
  unicodeTyperReady = new Promise((resolve) => { resolveReady = resolve; });

  const lineQueue = [];
  rl.on('line', (line) => {
    if (line === 'READY') {
      resolveReady();
      return;
    }
    const waiter = lineQueue.shift();
    if (waiter) waiter();
  });
  unicodeTyperRl._lineQueue = lineQueue;

  proc.on('exit', (code) => {
    parentPort.postMessage({ type: 'debug', msg: `[unicode-typer] surec kapandi, kod: ${code}` });
    unicodeTyperProc = null;
    unicodeTyperReady = null;
    unicodeTyperRl = null;
  });
  proc.on('error', (err) => {
    parentPort.postMessage({ type: 'debug', msg: `[unicode-typer] baslatma HATASI: ${err.message}` });
  });
}

async function typeUnicodeChar(ch) {
  ensureUnicodeTyper();
  await unicodeTyperReady;
  return new Promise((resolve) => {
    unicodeTyperRl._lineQueue.push(resolve);
    unicodeTyperProc.stdin.write(ch + '\n', 'utf8');
  });
}
// Uygulama acilir acilmaz sicak tut - ilk Turkce karakterde surpriz bir
// PowerShell baslatma/JIT gecikmesi yasanmasin (nut-js'in kendi onceden
// yukleme deseniyle ayni mantik, asagida).
ensureUnicodeTyper();

const KEY_MAP = {
  Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape', Space: 'Space',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Shift: 'LeftShift', Control: 'LeftControl', Alt: 'LeftAlt', Meta: 'LeftSuper',
  Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
};

function resolveKey(Key, jsKey) {
  if (jsKey.length === 1) {
    const upper = jsKey.toUpperCase();
    if (/^[A-Z]$/.test(upper)) return Key[upper];
    if (/^[0-9]$/.test(upper)) return Key[`Num${upper}`];
  }
  const mapped = KEY_MAP[jsKey];
  return mapped ? Key[mapped] : undefined;
}

let nutModule = null;
async function getNut() {
  if (!nutModule) {
    nutModule = await import('@nut-tree-fork/nut-js');
    // ONEMLI (CANLI KANITLANDI - "kuyruk birikmesi" zaman asimlarinin asil
    // buyuk sebebi): nut-js varsayilan olarak HER fare tikla/scroll'a 100ms,
    // HER klavye tus basma/birakmaya (ve type() ile yazilan HER karaktere)
    // 300ms "insan gibi dogal" bekleme (autoDelayMs) ekliyor - bu, ekran
    // kaydi/otomasyon senaryolari icin dusunulmus, ama NexusOn zaten GERCEK
    // bir insanin GERCEK zamanli eylemlerini aktarirken bu ekstra suni
    // gecikmenin hicbir anlami yok, sadece zarar veriyor: tek bir tiklama
    // (bas+birak) en az 200ms, tek bir tus basimi (bas+birak) en az 600ms
    // yapay gecikmeyle geciyordu - sirali islem kuyrugunun gercek zamanli
    // girdi hizina asla yetisememesinin (ve "kuyruk birikmesi" zaman
    // asimlarinin) en buyuk tek sebebi buydu. Sifira cekiyoruz - native
    // cagri ANINDA calissin, kuyrukta suni bekleme birikmesin.
    nutModule.mouse.config.autoDelayMs = 0;
    nutModule.keyboard.config.autoDelayMs = 0;
  }
  return nutModule;
}

// ONEMLI (CANLI KANITLANDI): bir "keydown" (ornegin Win/Ctrl/Shift/Alt)
// basariyla islenip, eslesen "keyup" ise nut-worker'in cokup yeniden
// baslatilmasi (bkz. main.js sendToNutWorker zaman asimi kurtarmasi)
// sirasinda kaybolursa, o tus MUSTERI MAKINESINDE isletim sistemi
// seviyesinde "basili" kalip kaliyor. Bir sonraki normal harf tuslarinin
// HEPSI o an "basili" kalan tus ile birlesip kisayol olarak yorumlanmaya
// baslar (ornegin Win basiliyken "s" harfi arama kutusunu acar, Ctrl
// basiliyken "s" kaydetme penceresi acar) - musteriye "klavye hic
// calismiyor" gibi gorunur, oysa gercekte HER tus dogru gonderiliyordur.
// Bu yuzden worker her (yeniden) baslatildiginda, olasi tum degistirici
// tuslari onceden acikca birakiyoruz - onceki oturumdan kalma "takili"
// bir tus varsa temizlenmis olur.
async function releaseAllModifiers(mod) {
  const { keyboard, Key } = mod;
  const modifiers = [
    Key.LeftShift, Key.RightShift,
    Key.LeftControl, Key.RightControl,
    Key.LeftAlt, Key.RightAlt,
    Key.LeftSuper, Key.RightSuper,
  ];
  for (const key of modifiers) {
    try {
      await keyboard.releaseKey(key);
    } catch {
      // tus zaten birakilmis olabilir, onemli degil
    }
  }
}

// Uygulama acilir acilmaz onceden yukle/isit - ilk gercek komutta surpriz
// bir gecikme yasanmasin.
getNut()
  .then(async (mod) => {
    await mod.mouse.getPosition();
    await releaseAllModifiers(mod);
    parentPort.postMessage({ type: 'ready' });
  })
  .catch((err) => parentPort.postMessage({ type: 'ready-error', error: err.message }));

// ONEMLI: parentPort'un 'message' olayi ASYNC bir dinleyiciyi BEKLEMEZ - bir
// sonraki mesaj, bir oncekinin (mousedown gibi birden fazla await iceren) tum
// adimlari bitmeden ISLENMEYE BASLAYABILIYORDU (ornegin bir "birak" komutu,
// hemen onceki "bas" komutundan once islenip dugmeyi fiilen hic birakilmamis
// gibi "basili" birakabiliyordu). Duzeltme: gelen komutlari bir kuyrukta
// kesinlikle sirali, bir onceki tamamen bitmeden digeri baslamadan isliyoruz.
//
// ONEMLI (CANLI KANITLANDI - "kuyruk birikmesi" hala az da olsa devam
// ediyordu): fare hizli hareket ettirildiginde mousemove olaylari, aralarinda
// baska hicbir sey olmadan, birbiri ardina KUYRUGA EKLENIYORDU - kuyruk
// nut-js'in isleyebildiginden hizli buyudugunde, HER ara konum sirayla
// islenmeye calisiliyor, imlec gitgide daha geriden (eski konumlardan)
// gelmeye devam ediyordu. Oysa mousemove MUTLAK bir konum bildirir (goreceli
// degil) - araya baska bir olay (tik/tus) girmediyse, kuyrukta bekleyen ESKI
// bir mousemove'un hicbir degeri yoktur, sadece EN SON konum onemlidir.
// Cozum: kuyruga eklenirken, kuyrugun EN SONUNDAKI oge de HENUZ islenmemis
// bir mousemove ise (arada baska bir olay yoksa), onun YERINE geciyoruz -
// boylece ardisik mousemove'lar kuyrukta asla 1'den fazla birikmiyor. Baska
// hicbir olay turu (mousedown/up/keydown/wheel) asla atlanmiyor/birlestirilmiyor.
const eventQueue = [];
let draining = false;

function enqueueEvent(id, evt) {
  if (evt.type === 'mousemove' && eventQueue.length > 0) {
    const last = eventQueue[eventQueue.length - 1];
    if (last.evt.type === 'mousemove') {
      // Kuyrukta bekleyen eski mousemove artik hic gonderilmeyecek - onun
      // IPC cagirani ana surecte sonsuza kadar (zaman asimina kadar)
      // beklemesin diye hemen "basarili" olarak yanitliyoruz.
      parentPort.postMessage({ id: last.id, ok: true });
      eventQueue[eventQueue.length - 1] = { id, evt };
      return;
    }
  }
  eventQueue.push({ id, evt });
}

async function drainQueue() {
  if (draining) return;
  draining = true;
  while (eventQueue.length > 0) {
    const { id, evt } = eventQueue.shift();
    await processEvent(id, evt);
  }
  draining = false;
}

parentPort.on('message', ({ id, evt }) => {
  enqueueEvent(id, evt);
  drainQueue();
});

// Ekran boyutu bir oturum icinde pratikte hemen hic degismiyor. Onceden her
// TEK fare hareketinde (saniyede ~40 kez) screen.width()/height() icin ayri
// birer native cagri yapiliyordu - bu, uc native cagriyi (genislik+
// yukseklik+konum) tek bir olaya sikistirip zaten zorlanan bir makinede
// kuyrugun birikmesine (fare hareketinin gitgide geriden gelmesine) katki
// sagliyordu. Artik sadece BIR KERE olculup onbellekleniyor.
let cachedScreenSize = null;

async function processEvent(id, evt) {
  try {
    const { mouse, keyboard, screen, Point, Button, Key } = await getNut();
    switch (evt.type) {
      case 'mousemove': {
        if (!cachedScreenSize) {
          cachedScreenSize = { w: await screen.width(), h: await screen.height() };
        }
        const { w, h } = cachedScreenSize;
        const target = new Point(Math.round(evt.x * w), Math.round(evt.y * h));
        await mouse.setPosition(target);
        // NOT: burada eskiden her 50 hareketten birinde dogrulama icin ekstra
        // bir mouse.getPosition() native cagrisi da yapiliyordu (imlecin
        // gercekten hareket ettigini kanitlamak icin, bkz. nexusgo-freeze-
        // history.md v1.2.26). O tanisal ihtiyac karsilandi (imlec gercekten
        // hareket ediyor) - kaldirildi, cunku CANLI KANITLANDI: fare
        // hareketleri saniyede ~40 kez gonderilirken, bu periyodik EKSTRA
        // native cagri bile nut-worker'in sirali kuyrugunda gereksiz yuk
        // olusturup "kuyruk birikmesi" zaman asimlarina katkida bulunuyordu.
        break;
      }
      case 'mousedown':
        await mouse.pressButton(evt.button === 2 ? Button.RIGHT : Button.LEFT);
        break;
      case 'mouseup':
        await mouse.releaseButton(evt.button === 2 ? Button.RIGHT : Button.LEFT);
        break;
      case 'wheel':
        if (evt.deltaY > 0) await mouse.scrollDown(Math.round(Math.abs(evt.deltaY)));
        else await mouse.scrollUp(Math.round(Math.abs(evt.deltaY)));
        break;
      case 'keydown': {
        // ONEMLI (CANLI KANITLANDI - "ğ,ş,i ve . tuslari farkli karakter
        // olarak cikiyor"): resolveKey, harfleri nut-js'in FIZIKSEL Key
        // sabitlerine (VirtualKey/konum tabanli, ornegin Key.I = "I" harfinin
        // US klavyedeki konumu) eslestiriyordu. Turkce Q klavyede 'i' (noktali
        // kucuk i) ile 'ı' (noktasiz) AYRI fiziksel tuslardir - agent
        // tarafinda 'i' basildiginda (evt.key='i') eskiden bunu
        // Key['I'].toUpperCase() ile "I" konumuna (US klavyede tek konum,
        // Turkce'de 'ı/I' konumuna denk gelir) gonderiyorduk; host
        // makinesinde Turkce duzen aktifken bu konum 'ı' uretiyor, 'i' degil
        // - tam olarak bildirilen hata buydu. Ayni sinif sorun '.' gibi
        // noktalama icin de gecerli (klavye duzenine gore konum farkli
        // karaktere denk gelebilir).
        //
        // Kalici cozum: MODIFIER (Ctrl/Alt/Win) basili DEGILKEN, TEK
        // KARAKTERLIK butun tuslari (harf/rakam/noktalama, Turkce dahil)
        // klavye duzeninden tamamen bagimsiz calisan KENDI Unicode yazma
        // yardimcimizla (typeUnicodeChar - bkz. dosya basi, nut-js'in
        // kendi type() fonksiyonu bazi karakterleri kirpiyordu) gonderiyoruz
        // - hangi fiziksel tus/duzen olursa olsun DOGRU karakter cikar.
        // Ctrl+C gibi kisayollar icin ise Unicode enjeksiyonu OS'nin
        // kisayol algilamasini TETIKLEMEZ - o yuzden bir modifier
        // basiliyken fiziksel Key[] basma yolunu (eski davranis) koruyoruz.
        const hasModifier = evt.ctrlKey || evt.altKey || evt.metaKey;
        const key = resolveKey(Key, evt.key);
        if (hasModifier && key !== undefined) {
          await keyboard.pressKey(key);
        } else if (!hasModifier && evt.key.length === 1) {
          await typeUnicodeChar(evt.key);
        } else if (key !== undefined) {
          // Ok tuslari, Enter, Backspace, Tab vb. isimli (tek karakter
          // olmayan) tuslar - fiziksel basma/birakma gerektirir.
          await keyboard.pressKey(key);
        }
        break;
      }
      case 'keyup': {
        const hasModifier = evt.ctrlKey || evt.altKey || evt.metaKey;
        const key = resolveKey(Key, evt.key);
        // Tek karakterlik, modifier'siz gonderilen tuslar (yukarida
        // typeUnicodeChar ile) icin ayrica "birak" gerekmiyor - o zaten
        // bas+birak'i kendi icinde yapiyor. Digerleri (kisayol sirasinda
        // basilanlar + isimli tuslar) fiziksel olarak birakilmali.
        if ((hasModifier || evt.key.length !== 1) && key !== undefined) {
          await keyboard.releaseKey(key);
        }
        break;
      }
      case 'getpos': {
        // NexusOn: DXGI'nin PointerPosition verisi bazi makinelerde hicbir
        // zaman dolmuyor (surucu/donanima ozgu bir sinirlama - musteri
        // makinesinde defalarca gozlemlendi, fare aktif hareket ederken bile
        // hep visible=false/x=0/y=0 geliyordu). Bunun yerine dogrudan
        // Windows'un GERCEK imlec konumunu (nut-js zaten remote-input icin
        // kullaniyor, ayni guvenilir kaynak) okuyoruz - donanimdan bagimsiz.
        if (!cachedScreenSize) {
          cachedScreenSize = { w: await screen.width(), h: await screen.height() };
        }
        const pos = await mouse.getPosition();
        parentPort.postMessage({
          id,
          ok: true,
          data: { x: pos.x, y: pos.y, screenWidth: cachedScreenSize.w, screenHeight: cachedScreenSize.h },
        });
        return;
      }
    }
    parentPort.postMessage({ id, ok: true });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: err.message });
  }
}
