# NexusOn 1.2.2 — Gerçek makinede A/B testi (yaklaşık 40 dakika)

Amaç: ekran donmasının hangi ayardan kaynaklandığını tahminsiz, ölçerek bulmak.
Aynı iki gerçek bilgisayarla (müşteri makinesi + personel makinesi) dört ayarı sırayla deneriz.
Uygulamayı yeniden kurmak gerekmez, yalnızca bir ayar dosyası değişir.

## Hazırlık (bir kez)
1. **Müşteri makinesi** (sorunun yaşandığı bilgisayar): `kurulum\NexusOn-Setup-1.2.2.exe` kurulur.
2. **Personel makinesi**: `kurulum\NexusOn-Personel-Setup-1.2.2.exe` kurulur, personel girişi yapılır.
3. Müşteri makinesinde bu klasördeki `tuning-ayarla.ps1` ve `log-al.ps1` dosyalarını bir yere kopyalayın.
   PowerShell'de betik çalışmazsa bir kez: `Set-ExecutionPolicy -Scope Process Bypass`

## Ayarlar
| Mod | contentHint | Kodlayıcı | Ne test ediyor |
|---|---|---|---|
| **A** | yok | maintain-resolution, 2,5 Mbps | 1.1.1'in sahada çalışan ayarı (taban) |
| **B** | detail | A ile aynı | Yalnızca contentHint |
| **C** | yok | balanced, 8 Mbps, 30 fps | Yalnızca yeni kodlayıcı ayarı |
| **D** | detail | balanced, 8 Mbps, 30 fps | 1.2.1'deki ayar (donmayı yaşatan) |

## Her mod için tur (A, sonra D, sonra B, sonra C)
Müşteri makinesinde:
1. `.\tuning-ayarla.ps1 -Mod A` (sırasıyla A, D, B, C)
2. NexusOn'u kapatıp yeniden açın. (Ayar açılışta okunur.)
3. Müşteri **"Bağlantı Talebi İlet"** ile kod üretir, personel bağlanır, müşteri **onay penceresinde Onayla** der.
4. Görüntü akmaya başlayınca 5 saniye bekleyin, sonra müşteri **NexusOn penceresini küçültsün**.
5. **60 saniye** bekleyin. Personel bu sürede ekranda bir şey hareket ettirip hareketi görüp görmediğini not eder
   (müşteri masaüstünde bir pencereyi sürükleyebilir ya da saat gibi hareketli bir şey açabilir).
6. Müşteri pencereyi **geri açsın**, 30 saniye bekleyin.
7. Müşteri NexusOn'u kapatsın. `.\log-al.ps1 -Etiket A-musteri` (etiket = mod adı)
8. Personel de aynı turda kendi uygulamasını kapatıp `.\log-al.ps1 -Etiket A-personel` ile logunu alsın.

## Sonuç tablosu (her tur sonunda doldurulur)
| Mod | Küçültülünce akış devam etti mi? | Geri açınca? | Donma kaç saniye sonra? | Log dosyası |
|---|---|---|---|---|
| A | | | | |
| D | | | | |
| B | | | | |
| C | | | | |

## Sonuç nasıl okunur
- **A çalışıyor, D donuyor** → sebep contentHint veya yeni kodlayıcı ayarı. B ve C hangisinin olduğunu gösterir. Çözüm: o ayarı kapalı bırakırız (varsayılan zaten A).
- **A da donuyor** → sebep bu ayarlar değil. Loglar (`KAYNAK:` ve `EK:` satırları) donmanın kaynakta mı kodlayıcıda mı olduğunu söyler. Bu durumda onay ekranı ve yakalama katmanı için ikinci bir test derlemesi hazırlarız.
- **Hiçbiri donmuyor ama sahada donuyor** → müşteri makinesine özgü (GPU sürücüsü vb.); log ve sistem bilgisiyle devam ederiz.

## Logda aranacaklar
- `[tuning] {...}`: açılışta hangi ayarın kullanıldığı (yanlış moda test yapmadığınızı doğrular).
- `[stats] YOL=P2P` ya da `TURN RELAY`.
- `[stats] KAYNAK: frames=... fps=...`: yakalama kare üretiyor mu?
- `[stats] GONDERILEN video: ... encoderImplementation=...`, `[stats] EK: framesSent=... keyFrames=...`
- `[pencere] minimize` / `restore` satırları ile donmanın zamanlamasını karşılaştırın.
- `[capture] izci ...` satırları: bekçi tetiklendi mi. Artık en fazla 2 kez tetiklenir; sonra "akış durdu" bildirimi gider.

## Bitince
- Logları (masaüstündeki `nexuson-log-*.txt` dosyaları) ve doldurduğunuz tabloyu iletin.
- Ayarı varsayılana döndürmek için: `.\tuning-ayarla.ps1 -Mod SIL`
