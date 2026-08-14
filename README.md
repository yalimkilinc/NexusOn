# NexusGo (Prototip / PoC)

Musteri bilgisayarlarina uzaktan destek icin gelistirilen NexusGo uygulamasinin,
maliyet kisitlarina uygun teknolojilerle kurulmus calisan ilk prototipi.

## Neden bu bilesenler secildi (maliyet modeli)

En kritik kisit **abonelik / kullanim-bazli ucret olmamasi**ydi. Asagidaki
tabloda kullanilan HER bilesenin ucretsiz oldugu, kullanim/oturum basina
hicbir sey odenmedigi gorulebilir:

| Bilesen | Ne ise yarar | Lisans / Maliyet |
|---|---|---|
| WebRTC (Chromium/Electron icinde yerlesik) | Ekran video akisi + dosya veri kanali, NAT gecisi, sifreleme | Acik web standardi, $0 |
| Google STUN sunucusu (`stun.l.google.com:19302`) | NAT arkasindaki iki bilgisayarin birbirini bulmasi | Herkese acik, ucretsiz, kayit gerekmez |
| Kendi sinyal (rendezvous) sunucumuz (`signaling-server/`) | Oda kodu ile host/viewer eslestirme | Kendi yazdigimiz ~100 satirlik Node.js kodu, $0. Kendi bilgisayarinizda ya da sabit/tek seferlik ucretli ufak bir sunucuda (VPS) calisir — kullanim basina ucret YOK |
| Electron | Windows masaustu uygulamasi cati (framework) | MIT lisans, $0 |
| `@nut-tree-fork/nut-js` | Uzaktan fare/klavye enjeksiyonu | MIT lisans, $0 |
| `electron-builder` | Kurulum dosyasi (.exe) uretme | MIT lisans, $0 |
| Express + `better-sqlite3` + `bcryptjs` + `multer` (admin-panel) | Slider/duyuru yonetimi, giris, dosya sunumu | Hepsi MIT/ISC lisans, $0. SQLite tek dosya, ayri veritabani sunucusu gerektirmez |

**Odenmesi gerekebilecek TEK kalem** (zorunlu degil, itibar/guven icin
onerilir): kod imzalama sertifikasi — yillik sabit ucret (~$100-300/yil),
**kullanim bazli degil**, tek seferlik yenilenen bir abonelik gibi dusunulebilir.
Kurulum sirasinda Windows SmartScreen uyarisini azaltir.

Ileride NAT'in cok kisitli oldugu durumlar (kurumsal firewall vb.) icin bir
**TURN relay sunucusu** gerekebilir. Bunun icin de ucretli bir SaaS (Twilio,
Xirsys vb. GB basina ucretlendirir) yerine **`coturn`** (acik kaynak, MPL
lisansli, $0) kendi sunucunuzda calistirilabilir — yine sabit/tek seferlik
altyapi maliyeti disinda kullanim ucreti yoktur.

## Klasor yapisi

```
NexusGo/
  signaling-server/   Node.js WebSocket sinyal sunucusu (oda kodu eslestirme)
  app/                 Electron masaustu uygulamasi (Windows) — tek kurulum, rol secimli
  admin-panel/
    server/             Express + SQLite backend (giris, icerik API, kurulum uretme)
    public/              Web tabanli admin arayuzu (login.html, dashboard.html)
```

## Calistirma (yerel test)

1. Sinyal sunucusunu baslatin:
   ```
   cd signaling-server
   npm install
   npm start
   ```
   `ws://localhost:7777` adresinde calisir.

2. (Opsiyonel ama onerilir) Admin panelini baslatin:
   ```
   cd admin-panel/server
   npm install
   npm start
   ```
   `http://localhost:4000` adresinde calisir. Ilk calistirmada konsola bir
   admin kullanici adi/sifresi yazdirilir (varsayilan: `admin` / `admin123`).
   **Uretimde `ADMIN_PASSWORD` ortam degiskeniyle mutlaka degistirin.**
   Tarayicidan `http://localhost:4000/login.html` adresine gidip giris
   yapabilir, slider gorsellerini ve duyuru metinlerini yonetebilirsiniz.

3. Uygulamayi baslatin (musteri ve destek ekibi ayni kurulum icinde, acilista
   rol secilir):
   ```
   cd app
   npm install
   npm start
   ```
   Test icin bu adimi iki kere calistirip iki pencere acabilirsiniz.

4. Birinci pencerede **"Destek Almak İçin"** secili kalsin, **"Destek Kodu
   Oluştur ve Paylaşımı Başlat"**a basin. Acilan Windows ekran-secim
   penceresinden paylasilacak ekrani onaylayin.

5. Ikinci pencerede **"Destek Vermek İçin"**e gecin, ayni kodu girin,
   **"Bağlan"**a basin.

6. Baglanti kurulunca host tarafinda ekran goruntusu viewer'da belirir.
   Host, "Uzaktan kontrole izin ver" kutusunu isaretlerse viewer ekrana
   tiklayip fare/klavye ile kontrol edebilir. Her iki tarafta da
   **"Dosya Gönder"** ile karsi tarafa dosya yollanabilir (buton veya
   surukle-birak); alan taraf kaydetme konumunu secer (onay mekanizmasi —
   sessiz/otomatik kabul yok).

## Admin panel

Musteri (host) ekranindaki gorsel slider ve kayan duyuru yazisi, admin
panelden yonetilir. NexusGo uygulamasi her acilista
`http://localhost:4000/api/public/content` adresinden guncel icerigi ceker;
panele ulasamazsa (kapali, offline vb.) sessizce yerel varsayilan icerikle
calismaya devam eder, cokmez.

Panelde ayrica **"Yeni Kurulum Üret"** butonu bulunur — basildiginda sunucu
tarafinda `npm run dist` (electron-builder) calistirir ve bitince guncel
`.exe` dosyasini indirtir. **Bu ozellik yalnizca panelin bir Windows
makinesinde calismasi durumunda islev gorur** (Linux sunucuda derleme adimi
calismaz).

## Su an eksik olan / bir sonraki adimlar

- **Internet uzerinden gercek musteri baglantisi**: Su an sinyal sunucusu ve
  admin panel `localhost`'ta. Gercek kullanim icin ikisinin de herkese acik
  sabit bir adrese (kucuk bir Windows VPS, sabit aylik ucret) tasinmasi
  gerekir — bu bir "kullanim bazli ucret" degil, sabit altyapi maliyetidir.
  NexusGo uygulamasindaki `DEFAULT_SERVER_URL` ve `CONTENT_API_URL`
  degerlerinin de gercek adrese guncellenmesi gerekir.
- **TURN relay** eklenmesi (siki kurumsal aglarda P2P baglanti kurulamazsa).
- **Kod imzalama** (AV/SmartScreen guveni icin).
- **Admin panel sifresi**: varsayilan `admin`/`admin123` yalnizca yerel test
  icindir, gercek kullanimdan once mutlaka degistirilmeli.
- Ses aktarimi, coklu monitor secimi, oturum kayitlarinin (audit log) saklanmasi.
