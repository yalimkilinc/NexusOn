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
  app/                 Electron masaustu uygulamasi (Windows)
```

## Calistirma (yerel test)

1. Sinyal sunucusunu baslatin:
   ```
   cd signaling-server
   npm install
   npm start
   ```
   `ws://localhost:7777` adresinde calisir.

2. Uygulamayi iki kere baslatin (biri Host, biri Viewer olacak — gercek
   kullanimda iki farkli bilgisayarda calisir):
   ```
   cd app
   npm install
   npm start
   ```

3. Birinci pencerede **"Bu Bilgisayarı Paylaş"** secin, **"Kod Üret"**e
   basin, ardindan **"Bağlan"**a basin. Acilan Windows ekran-secim
   penceresinden paylasilacak ekrani onaylayin.

4. Ikinci pencerede **"Uzak Bilgisayara Bağlan"** secin, ayni kodu girin,
   **"Bağlan"**a basin.

5. Baglanti kurulunca host tarafinda ekran goruntusu viewer'da belirir.
   Host, "Uzaktan kontrole izin ver" kutusunu isaretlerse viewer ekrana
   tiklayip fare/klavye ile kontrol edebilir. Her iki tarafta da
   **"Dosya Gönder"** ile karsi tarafa dosya yollanabilir; alan taraf
   kaydetme konumunu secer (onay mekanizmasi — sessiz/otomatik kabul yok).

## Su an eksik olan / bir sonraki adimlar

- **Internet uzerinden gercek musteri baglantisi**: Su an sinyal sunucusu
  `localhost`'ta. Gercek kullanim icin bu sunucunun herkese acik sabit bir
  adrese (kucuk bir VPS, ~$5/ay sabit) tasinmasi gerekir — bu bir
  "kullanim bazli ucret" degil, sabit altyapi maliyetidir.
- **TURN relay** eklenmesi (siki kurumsal aglarda P2P baglanti kurulamazsa).
- **Kod imzalama** (AV/SmartScreen guveni icin).
- **Kimlik dogrulama / yetkilendirme** (su anki oda kodu herkese acik bir
  eslestirme kodu; production icin destek personeli girisi + oturum kayitlari
  eklenmeli).
- Ses aktarimi, coklu monitor secimi, oturum kayitlarinin (audit log) saklanmasi.
