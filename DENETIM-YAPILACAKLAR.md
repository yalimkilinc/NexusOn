# NexusOn — Denetim Sonrası Yapılacaklar

**Kaynak denetim raporu:** `C:\Projects\Analiz\Md\Ürünler\NexusOn_Denetim_Raporu.md`
**Tarih:** 2026-09-24

Bu dosya, denetimde çıkan işleri NexusOn projesi içinde uygulanabilir adımlara böler.
Her madde bağımsızdır, sırayla yapılması zorunlu değildir.

---

## A. Önce siz doğrulayın (kod işi değil, sunucuda bakılacak)

Bu ikisini ben kod okuyarak belirleyemiyorum, sunucuya bakmak gerekiyor.
Sonuca göre A-1 ve A-2 ya "zaten tamam" çıkar ya da acil iş olur.

### A-1. `SESSION_SECRET` ve admin parolası

`admin-panel\server\index.js:56` şunu içeriyor:
```js
secret: process.env.SESSION_SECRET || 'nexusgo-admin-panel-local-secret',
```
`deploy\setup.ps1` bu değişkeni **hiç ayarlamıyor**.

VPS'te admin panelin pm2 ortamında kontrol edin:
```
pm2 env <admin-panel-process-id>
```
`SESSION_SECRET` görünmüyorsa: saldırgan kaynak koddaki sabitle kendi admin çerezini
imzalayıp **parolasız admin olabilir**. Aynı çıktıda `ADMIN_PASSWORD` da kontrol edin —
yoksa `db.js:208` gereği hesap `admin` / `admin123` ile oluşmuş olabilir.

**Düzeltme (ikisi de eksikse):**
- `index.js:56`'daki `|| '...'` yedeğini kaldırın, env yoksa `throw` edin
- `db.js:208-213`'teki varsayılan parola bloğunu kaldırın
- pm2 ortamına rastgele üretilmiş kalıcı bir `SESSION_SECRET` ekleyin
- Not: anahtar değişince mevcut admin oturumları düşer, planlı yapın

### A-2. Sinyal sunucusunda TLS

`signaling-server\server.js:22` gereği TLS yalnızca `SSL_CERT_PATH` / `SSL_KEY_PATH`
verilmişse etkin; verilmezse **sessizce düz `ws://`'ye düşüyor** ve istemci bunu fark edemiyor.

Caddy arkasındaysa ve Caddy TLS'i sonlandırıp Node'a düz HTTP/WS veriyorsa **sorun yok** —
ama bunu doğrulayın. Dışarıdan test:
```
curl -I https://nexuson-sinyal.novrixon.com.tr
```

**Düzeltme (doğrudan internete açıksa ve TLS yoksa):** Node tarafında, TLS yapılandırması
yoksa sürecin başlamamasını sağlayın.

---

## B. Güvenlik — oda ele geçirme zinciri (ertelenemez)

**Dosya:** `signaling-server\server.js`, `join` işleyicisi (~160-190)

### Sorun

Üç şey üst üste geliyor:
1. `join` mesajında kimlik doğrulaması yok, rol doğrudan mesajdan alınıyor (satır 166)
2. Var olmayan bir odaya katılmak **o odayı yaratıyor** (satır 173-178)
3. Müşteri odaya girince, içeride biri varsa **hiçbir onay sormadan** ekranı yayınlıyor
   (`app\renderer.js:1163-1166`)

Saldırgan oda kodlarını önceden işgal ediyor; müşterinin ürettiği kod işgal edilmiş
odalardan birine denk gelirse ekran ve klavye saldırgana geçiyor.

### ÖNEMLİ: tek kural yetmiyor

"Odayı yalnızca host yaratsın" tek başına **yeterli değildir**. Rol de doğrulanmadığı için
saldırgan `role:'host'` iddia edip odayı yine önceden yaratabilir; gerçek müşteri aynı odaya
host olarak katıldığında `peers > 0` görüp ekranını yine saldırgana yollar.

**İki kural birlikte uygulanmalıdır.**

### Yama

`signaling-server\server.js` içinde, mevcut şu bloğu:

```js
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
```

şununla değiştirin:

```js
      let room = rooms.get(roomCode);
      if (!room) {
        // GUVENLIK: odayi yalnizca host yaratabilir. Viewer'in var olmayan bir
        // odaya katilip onu yaratmasi, saldirganin oda kodlarini onceden isgal
        // etmesine izin veriyordu.
        if (role !== 'host') {
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
```

### Test edilmesi gerekenler

- Normal akış: müşteri kod üretir (host katılır), personel kodu girer (viewer katılır) → çalışmalı
- Personel önce kodu girerse → "Oda bulunamadi" hatası almalı, oda yaratılmamalı
- İki müşteri aynı kodu üretirse → ikincisi "Bu kod kullanimda" almalı
- Müşterinin bağlantısı kopup yeniden bağlanırsa ne oluyor — **bunu özellikle deneyin**,
  eski soket odada kalıyorsa yeniden bağlanma "kod kullanimda" ile reddedilebilir.
  Gerekirse `ws.on('close')` temizliğinin odayı gerçekten boşalttığını doğrulayın.

### Sonrası (bu yama acil kapatma; kalıcı çözüm ayrı iş)

Kalıcı çözüm: viewer'ın admin panelden aldığı ajan token'ını `join` mesajında göndermesi ve
sunucunun doğrulaması. Ayrıca oda kodunun sunucuda `crypto` ile üretilmesi, 9-10 karakter,
tek kullanımlık ve TTL'li olması. Yukarıdaki yama takeover'ı kapatır, kod tahminine karşı
tam koruma token doğrulamasıyla gelir.

---

## C. Yavaşlık — üç küçük değişiklik

Üçü de küçük. C-3 olmadan C-1'in etkisini ölçemezsiniz, o yüzden üçünü birlikte yapın.

### C-1. Encoder ayarı — asıl şüpheli

**Dosya:** `app\renderer.js:1466-1473` (`applyDxgiEncoderParams` içinde)

Mevcut:
```js
  sender
    .setParameters({
      ...sender.getParameters(),
      degradationPreference: 'maintain-resolution',
      encodings: [{ maxBitrate: 2_500_000, scaleResolutionDownBy }],
    })
```

`maintain-resolution`, WebRTC'ye "bant genişliği yetmezse çözünürlüğü koru, kare hızını
düşür" diyor. 1080p için 2,5 Mbps tavanı hareketli sahnede yetmiyor — bu yüzden müşteri
pencere sürüklediğinde fps çöküyor. Şikâyetin birebir sebebi bu.

Yeni:
```js
  const params = sender.getParameters();
  params.degradationPreference = 'balanced';
  if (!params.encodings || !params.encodings.length) params.encodings = [{}];
  params.encodings[0].maxBitrate = 8_000_000;
  params.encodings[0].maxFramerate = 30;
  params.encodings[0].scaleResolutionDownBy = scaleResolutionDownBy;
  sender
    .setParameters(params)
```

Not: mevcut kod `encodings` dizisini tamamen değiştirdiği için `active` gibi mevcut alanları
düşürüyordu; yukarıdaki hâli `getParameters()`'tan geleni koruyor.

**Nasıl test edilir:** İki makine arasında bağlanın, karşı tarafta bir pencereyi sürükleyip
kaydırın. `%TEMP%\nexuson-debug.log` içinde `[stats] GONDERILEN video:` satırlarına bakın —
`framesPerSecond` hareket sırasında eskisi gibi tek haneye düşüyor mu?

### C-2. `contentHint`

Kod tabanında `contentHint` **hiç geçmiyor**. Boş bırakılınca WebRTC içeriği kamera
sanıyor ve ekran içeriği optimizasyonlarını kapatıyor.

Şu beş yere ekleyin:

| Dosya:satır | Ne eklenecek |
|---|---|
| `app\renderer.js:1632` | `generator` oluşturulduktan hemen sonra: `generator.contentHint = 'detail';` |
| `app\renderer.js:1646` | `recreateGenerator()` içindeki yeni generator'dan sonra aynısı |
| `app\renderer.js:1595` | `freshTrack.contentHint = 'detail';` |
| `app\renderer.js:1780` | `fallbackTrack.contentHint = 'detail';` |
| `app\renderer.js:2011` civarı | `getDisplayMedia` ile alınan `stream`'in video track'ine aynısı |

### C-3. Teşhis logu — bunu atlamayın

Şu an kod, bağlantının TURN relay üzerinden mi gittiğini **hiç ölçmüyor**
(`candidateType` kod tabanında hiç okunmuyor) ve donanım kodlayıcı devrede mi
söylemiyor. Bu iki bilinmeyen kapanmadan mimari kararlar tahmine dayanır.

**Dosya:** `app\renderer.js:1334-1339`

Mevcut:
```js
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
          window.nexuson.debugLog(
            `[stats] aktif aday çifti: currentRoundTripTime=${report.currentRoundTripTime} ` +
              `availableOutgoingBitrate=${report.availableOutgoingBitrate}`
          );
        }
```

Yeni:
```js
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
          const local = stats.get(report.localCandidateId);
          const remote = stats.get(report.remoteCandidateId);
          const relay = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
          window.nexuson.debugLog(
            `[stats] YOL=${relay ? 'TURN RELAY' : 'P2P'} ` +
              `local=${local?.candidateType}/${local?.protocol} remote=${remote?.candidateType} ` +
              `currentRoundTripTime=${report.currentRoundTripTime} ` +
              `availableOutgoingBitrate=${report.availableOutgoingBitrate}`
          );
        }
```

Ayrıca `renderer.js:1303-1306`'daki gönderilen video logunun sonuna
`encoderImplementation=${report.encoderImplementation}` ekleyin.

**Sonra:** Yavaşlık şikâyeti olan **gerçek bir müşteri oturumu** alın ve o müşterinin
`%TEMP%\nexuson-debug.log` dosyasını isteyin. Şu üç satırı arayın:
- `YOL=TURN RELAY` mi `YOL=P2P` mi
- `encoderImplementation=` ne diyor (`OpenH264` / `libvpx` = yazılım kodlayıcı,
  `MediaFoundation...` / `ExternalEncoder` = donanım)
- `qualityLimitationReason=` ne diyor (`bandwidth` / `cpu`)

Bu üç değer, kalan büyük kararların hepsini belirler.

---

## D. Müşteri onayı (yarım günlük iş)

**Dosya:** `app\index.html:193`, `app\renderer.js:2523-2526`

Mevcut:
```html
<input type="checkbox" id="allowControlCheckbox" checked class="hidden" />
```

Hem `checked` hem `hidden`. Kodda tek işlevsel kullanımı girdi enjeksiyonunun önündeki
kapı (`renderer.js:2525`), ve bu kutuyu görünür yapan veya işaretini kaldıran hiçbir kod yok —
kapı kalıcı olarak açık. Müşteri klavyesini devrettiğini görmüyor, geri alamıyor.

Yapılacak:
1. Peer bağlandığında müşteriye modal onay göster — **ekran görüntüleme ve kontrol için ayrı**
2. Kontrol onaylanmadan hiçbir `remote-input` iletilmesin; onay durumu `main.js` tarafında
   tutulsun (renderer'a güvenmeden)
3. Oturum boyunca görünür "Karşı taraf şu an kontrolde" rozeti
4. Bağlanan personelin adı gösterilsin

Hazır onay metni: `C:\Projects\Analiz\Md\Ürünler\NexusOn_Aydinlatma_Onay_Metni.md`

Bu aynı zamanda KVKK bulgusu #1 ve #2'yi de kapatıyor.

---

## E. Küçük ve bağımsız

| # | İş | Dosya |
|---|---|---|
| E-1 | `innerHTML` → `textContent` (depolanmış XSS) | `admin-panel\public\mobile.js:594-601` |
| E-2 | `/api/public/agents` kaldır veya kimlik doğrulaması arkasına al | `admin-panel\server\routes\agents.js:43` |
| E-3 | `version.json`'ı `1.1.1`'e güncelle — **güncellemeler müşteriye ulaşmıyor** | `admin-panel\server\downloads\version.json` |
| E-4 | `dist:staff` script'inde `&` → `&&` | `app\package.json:10` |
| E-5 | `NEXUSGO_AUTOSCRIPT` kancasını `if (!app.isPackaged)` içine al | `app\main.js:149-157` |
| E-6 | `guvenlik.html`'deki `[BELGE-NO]`, `[Mersis No]`, `[X yıl]` placeholder'larını doldur veya linki gizle | `admin-panel\public\guvenlik.html` |
| E-7 | `guvenlik.html:363-365` ve `:407`'deki iki yanlış iddiayı düzelt (TURN relay ve istemciye gömülü anahtar) | aynı dosya |
| E-8 | "E-Mail" → "E-posta" | `admin-panel\public\dashboard.html:74` |
| E-9 | `debugLog`'u asenkron tampona geçir | `app\main.js:74-82` |
| E-10 | Slayt interval'ini oturum başlayınca durdur | `app\renderer.js:2078-2080` |

---

## F. Daha büyük işler (ölçüm sonrası planlanacak)

- Kendi TURN sunucusunu Türkiye VPS'inde devreye al (`turn-server\` yazılmış ama hiç dağıtılmamış)
- Güncelleme dosyası imza doğrulaması + kod imzalama sertifikası
- DXGI "tek uçuş" kuralı, native timeout'u 16 ms'ye çekme, adaptör seçimi düzeltmesi
- Kare taşıma hattının mimari düzeltmesi (kare başına 8,3 MB × 6-7 kopya)
- `deploy\setup.ps1`'i güncel Caddy mimarisiyle yeniden yaz ve git'e al
- `data.sqlite` günlük yedeği (`VACUUM INTO`)
- Silme/saklama politikası ve otomatik imha
- Merkezi hata mesajı sözlüğü + bağlantı kalitesi rozeti

---

## Önerilen sıra

1. **A-1, A-2** — sunucuda doğrulama (kod işi değil, önce bunu bilin)
2. **B** — güvenlik yaması + testleri
3. **C-1, C-2, C-3** birlikte, sonra bir gerçek müşteri oturumunun logunu alın
4. **E-3** — yoksa yaptığınız hiçbir düzeltme müşteriye ulaşmaz
5. **D** — müşteri onayı
6. Kalan E maddeleri
7. **F** — C-3'ten gelen veriye göre
