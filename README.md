# Vanity Watch

Discord vanity URL'lerini (`discord.gg/xyz`) takip eden küçük, açık kaynak bir masaüstü uygulaması.
Bir URL boşa düştüğünde anında Windows bildirimi alırsın. Pencereyi kapatınca tepside çok az kaynakla çalışmaya devam eder.

*A tiny open-source desktop app that watches Discord vanity URLs and notifies you when one is released. English summary below.*

## Ne yapar?

- İstediğin vanity URL'leri ekle, her birinin durumunu canlı bir panelde gör:
  - 🟢 **Kullanımda**: sunucu adı, ikonu, üye sayısı
  - 🟡 **Boşta görünüyor**: hiçbir sunucu kullanmıyor (alınabilir olması garanti değil)
  - 🟠 **Boşaldı · sunucu var**: önceki sunucu URL'yi bırakmış
  - 🔴 **Boşaldı · sunucu kapalı**: önceki sunucu silinmiş/kapatılmış, URL bir süre kilitli kalabilir
  - 🔒 **Engelli**: topluluk listesinde ya da senin "alınamıyor" işaretinde
- 10–60 saniyede bir otomatik kontrol, geri sayım göstergesi, tek tek veya toplu yenileme
- Durum değişince Windows bildirimi, URL bazında sessize alma
- Durum geçmişi, son hareketler akışı ve not alanı
- Tepside hafif çalışma (pencere kapanınca arayüz bellekten silinir), isteğe bağlı Windows ile başlatma

## Ne yapmaz?

- **Token istemez.** Kullanıcı ya da bot token'ı yok; kontroller Discord'un herkese açık, kimlik doğrulama gerektirmeyen invite ve widget endpoint'leriyle yapılır.
- **URL'yi otomatik almaz (sniping yok).** Bu, kullanıcı token'ı ile otomasyon gerektirir ve Discord Hizmet Şartları'nı ihlal eder.
- Bir URL'nin kesin olarak alınabilir olduğunu söyleyemez: Discord bazı kelimeleri rezerve eder ve bunu herkese açık API'den öğrenmenin yolu yoktur.

## Kurulum

[Releases](https://github.com/Mavrom/vanity-watch/releases) sayfasından `.msi` veya `-setup.exe` dosyasını indirip kur.

## Geliştirme

Gereksinimler: Node.js 20+, Rust (stable), Windows'ta WebView2 (Windows 10/11'de yüklü gelir).

```bash
npm install
npm run tauri dev            # uygulamayı geliştirme modunda aç
npm run dev                  # sadece arayüz, tarayıcıda örnek verilerle (http://localhost:1420)
npm test                     # arayüz testleri
cd src-tauri && cargo test   # backend testleri
npm run tauri build          # release build
```

## Engelli listesine katkı

Boşta görünen ama kendi sunucunda almayı denediğinde Discord'un izin vermediği bir URL bulduysan,
`known-blocked.json` dosyasına ekleyip PR aç. Kurallar: küçük harf, sadece `a-z0-9-`, alfabetik sıralı, tekrar yok
(CI bunu kontrol eder). Liste bir sonraki sürümle uygulamaya gömülür.

## English

Vanity Watch tracks Discord vanity invite codes using only Discord's public, unauthenticated endpoints
(`GET /invites/{code}` and `GET /guilds/{id}/widget.json`). It never asks for a token and never claims URLs.
When a tracked code is released you get a native notification. Closing the window destroys the webview and
leaves a tiny tray process running.

## Lisans

MIT. İkonlar [Lucide](https://lucide.dev) (ISC) yollarından uyarlanmıştır. Font: [Inter](https://rsms.me/inter/) (OFL).
