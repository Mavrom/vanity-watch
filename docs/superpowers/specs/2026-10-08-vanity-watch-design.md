# Vanity Watch — Tasarım Dokümanı

**Tarih:** 2026-10-08
**Durum:** Onaylandı (brainstorming)

## Amaç

Discord vanity URL'lerini (ör. `discord.gg/xyz`) takip eden, açık kaynak, küçük bir **masaüstü uygulaması**. Kullanıcı istediği URL'leri ekler; uygulama her birinin kullanımda mı yoksa boşta mı olduğunu gösterir, durum değişince anında Windows bildirimi verir. Uygulama tamamen kullanıcının kendi bilgisayarında çalışır; sunucu, hesap veya bulut yoktur.

## Kapsam dışı (bilinçli)

- **Kullanıcı token'ı ile giriş ve URL'yi otomatik alma (sniping).** Selfbot sayılır, Discord ToS ihlalidir; kullanıcıların hesaplarını riske atar. Bot token'ları vanity URL değiştiremez.
- Hesap sistemi, merkezi sunucu, bulut senkronizasyonu.
- "Bu URL alınabilir mi?" kesin tespiti — Discord'da böyle bir endpoint yoktur. Uygulama yalnızca dolaylı ipuçları sunar ve bunu kullanıcıya açıkça belirtir.

## Teknoloji

- **Tauri 2** (Rust backend + WebView2 arayüz). Gerekçe: `.exe` ~5–10 MB, düşük RAM; Electron gibi Chromium paketlemez, Windows'un yerleşik WebView2'sini kullanır.
- **Rust:** `reqwest` (HTTP, rustls), `tokio` (zamanlayıcı/async), `serde`/`serde_json` (veri), `chrono` (zaman damgası).
- **Tauri plugin'leri:** `tauri-plugin-notification` (Windows bildirimleri), `tauri-plugin-autostart` (Windows ile başlat), `tauri-plugin-single-instance` (ikinci kez açılırsa mevcut pencereyi öne getirir; iki ayrı kontrol döngüsü çalışmasını engeller), tray için Tauri'nin yerleşik `tray-icon` özelliği.
- **Arayüz:** Vite + sade TypeScript (framework yok).
- **Lisans:** MIT. GitHub Actions (`tauri-action`) ile tag'lerde `.exe`/`.msi` release.

## Mimari

### Rust modülleri (`src-tauri/src/`)

| Modül | Sorumluluk | Bağımlılık |
|---|---|---|
| `parse.rs` | Kullanıcı girdisini vanity koduna normalize eder. `xyz`, `discord.gg/xyz`, `https://discord.gg/xyz`, `discord.com/invite/xyz`, `https://discordapp.com/invite/xyz` → `xyz`. Küçük harfe çevirir; geçersiz karakter veya uzunlukta hata döner (izinli: `a-z0-9-`, 2–32 karakter). | yok (saf) |
| `discord.rs` | Discord HTTP istemcisi. `check_invite(code)` ve `check_guild_widget(guild_id)`. Ham yanıtı tip güvenli bir sonuca çevirir. Base URL enjekte edilebilir (test için). | `reqwest` |
| `status.rs` | Durum sınıflandırma. Girdi: invite sonucu, URL'nin geçmişi (son görülen sunucu ID'si), engelli listesi üyeliği, opsiyonel widget sonucu. Çıktı: `Status`. | yok (saf) |
| `store.rs` | Kalıcı veri: takip listesi, geçmiş, ayarlar. AppData'da tek JSON dosyası (`vanity-watch.json`), atomik yazma (temp dosya + rename). | `serde` |
| `monitor.rs` | Arka plan kontrol döngüsü; sıralı kontrol, rate limit bekleme, durum değişiminde event + bildirim. | `discord`, `status`, `store` |
| `notify.rs` | Durum geçişinin bildirim gerektirip gerektirmediğine karar verir (saf fonksiyon) ve bildirimi gönderir. | notification plugin |
| `blocked.rs` | `known-blocked.json`'u derleme zamanında gömer (`include_str!`), üyelik sorgusu sağlar. | yok |
| `commands.rs` | Tauri komutları (arayüz → backend). | hepsi |
| `tray.rs` | Tepsi ikonu, menü (Aç / Hepsini yenile / Çık), pencere oluşturma/yok etme. | Tauri |

### Veri modeli

```rust
struct TrackedUrl {
    code: String,                 // normalize edilmiş vanity kodu (benzersiz anahtar)
    added_at: DateTime<Utc>,
    status: Status,
    last_checked: Option<DateTime<Utc>>,
    last_error: Option<String>,   // son kontrol başarısızsa
    guild: Option<GuildInfo>,     // son görülen sunucu (kullanımdayken güncellenir, boşalınca korunur)
    note: String,
    user_blocked: bool,           // kullanıcı "denedim, alınamıyor" işaretledi
    muted: bool,                  // bu URL için bildirim kapalı
    history: Vec<HistoryEntry>,   // durum değişimleri, en fazla 50 kayıt
}

struct GuildInfo { id: String, name: String, icon: Option<String>, member_count: Option<u64> }

struct HistoryEntry { at: DateTime<Utc>, from: Status, to: Status }

enum Status {
    Unknown,             // henüz kontrol edilmedi
    InUse,               // 🟢 kullanımda
    AppearsFree,         // 🟡 boşta görünüyor (hiç kullanımda görülmedi)
    ReleasedGuildExists, // 🟠 boşaldı, sunucu hâlâ var
    ReleasedGuildGone,   // 🔴 boşaldı, sunucu kapatılmış/silinmiş
    Blocked,             // 🔒 bilinen engelli (topluluk listesi veya kullanıcı işareti)
}

struct Settings {
    auto_check: bool,         // varsayılan true
    interval_secs: u32,       // 10 | 15 | 20 | 30 | 60, varsayılan 20
    notify_on_release: bool,  // kullanımda → boş, varsayılan true
    notify_on_taken: bool,    // boş → kullanımda, varsayılan false
    autostart: bool,          // Windows ile başlat, varsayılan false
}
```

Kontrol hatası (ağ hatası, 429, 5xx) `Status`'u değiştirmez; yalnızca `last_error` doldurulur ve arayüzde ⚠️ "Kontrol edilemedi" gösterilir.

### Durum sınıflandırma kuralları (`status.rs`)

1. **Invite 200** → `InUse`. `guild` güncellenir (ID, ad, ikon, `approximate_member_count`).
2. **Invite 404 (code 10006)**:
   1. Kod topluluk listesinde **veya** `user_blocked == true` → `Blocked`.
   2. Aksi halde `guild` (son görülen sunucu) varsa → widget sorgusu:
      - `GET /guilds/{id}/widget.json` → `404` / code `10004` (Unknown Guild) → `ReleasedGuildGone`
      - Diğer tüm yanıtlar (`200`, `403` code `50004` Widget Disabled) → `ReleasedGuildExists`
      - Widget isteği hata verirse (ağ/429) → `ReleasedGuildExists` varsayılır, `last_error` doldurulur.
   3. `guild` yoksa → `AppearsFree`.
3. **429 / ağ hatası / 5xx / beklenmeyen yanıt** → durum korunur, `last_error` set edilir.

Widget sorgusu yalnızca boş durumdayken ve önceki durum `InUse` iken (geçiş anında) ya da sonuç henüz belirlenmemişken yapılır; her turda tekrarlanmaz. `ReleasedGuildExists`/`ReleasedGuildGone` durumundaki bir URL tekrar 404 dönerse durum korunur.

> **Doğrulandı (2026-10-08):** Var olan, widget'ı kapalı sunucu → `403` / `50004 Widget Disabled`; var olmayan sunucu ID'si → `404` / `10004 Unknown Guild`. (Gerçekten silinmiş bir sunucu ile test edilemedi; var olmayan ID ile aynı yanıtı vermesi bekleniyor.)

### Discord API

- Base: `https://discord.com/api/v10`
- `GET /invites/{code}?with_counts=true` — token gerektirmez.
- `GET /guilds/{id}/widget.json` — token gerektirmez.
- `User-Agent`: `VanityWatch/<versiyon> (+https://github.com/Mavrom/vanity-watch)`.
- **429:** `Retry-After` header'ı (veya gövdedeki `retry_after`) kadar beklenir; o tur için kalan URL'ler bekleme sonrası devam eder.

### Kontrol döngüsü (`monitor.rs`)

- Tek bir tokio task. Döngü: tur başla → URL'leri **sırayla**, aralarında ~1 sn bekleyerek kontrol et → tur bitince `interval_secs` kadar uyu.
- Tur, aralıktan uzun sürerse bir sonraki tur önceki bitince başlar (çakışma yok).
- `auto_check` kapalıyken döngü uyur; ayar değişince ve manuel "Hepsini yenile" ile uyandırılır (`tokio::sync::Notify`).
- Tekil "yenile" komutu aynı istemciyi kullanır, döngüyü beklemez.
- Her kontrol sonrası: store güncellenir, `url-updated` event'i arayüze yayınlanır (pencere varsa), durum değiştiyse geçmişe eklenir ve `notify.rs` çağrılır.
- Diske yazma yalnızca bir şey değiştiğinde yapılır (durum, guild bilgisi, hata, ayar); `last_checked` değişimi tur sonunda toplu yazılır.

### Bildirimler (`notify.rs`)

- `should_notify(from, to, settings, muted) -> Option<Kind>` saf fonksiyonu:
  - `muted` → hiçbir zaman.
  - `from == Unknown` → bildirim yok (ilk kontrol).
  - `from == InUse` ve `to ∈ {AppearsFree, ReleasedGuildExists, ReleasedGuildGone}` ve `notify_on_release` → **Released**.
  - `from ∈ {AppearsFree, ReleasedGuildExists, ReleasedGuildGone}` ve `to == InUse` ve `notify_on_taken` → **Taken**.
  - Diğer geçişler → yok.
- Metin örnekleri: "🔔 discord.gg/xyz boşaldı! (sunucu hâlâ var)", "discord.gg/xyz alındı: Sunucu Adı".
- Bildirimleri Rust tarafı gönderir; pencerenin açık olması gerekmez.
- Bildirime tıklayınca uygulamayı açma: Tauri'nin masaüstü bildirim plugin'i tıklama olayını desteklemediği için kapsam dışı. Kullanıcı tepsi ikonundan açar.

### Hafiflik (performans gereksinimi)

- **Pencere kapatılınca WebView yok edilir** (gizlenmez). Uygulama tepside, yalnızca Rust süreciyle çalışmaya devam eder.
- Tepsi ikonuna tıklama / "Aç" menüsü pencereyi yeniden oluşturur; arayüz açılışta `get_state` ile tüm durumu çeker.
- Hedef: tepsi modunda **≤ 25 MB RAM**, boşta CPU ≈ %0. Uygulama sonunda Görev Yöneticisi ile ölçülüp raporlanacak.
- Tek `reqwest::Client` paylaşılır (bağlantı yeniden kullanımı). Tauri'nin kendi async runtime'ı kullanılır; ayrıca runtime veya thread pool açılmaz.
- Tamamen çıkış yalnızca tepsi menüsünden "Çık" ile.

### Tauri komutları (`commands.rs`)

| Komut | Açıklama |
|---|---|
| `get_state()` | Tüm takip listesi + ayarlar. |
| `add_url(input)` | Normalize eder, ekler, hemen kontrol eder. Geçersiz/var olan kodda hata döner. |
| `remove_url(code)` | Siler. |
| `refresh_url(code)` | Tek URL'yi hemen kontrol eder. |
| `refresh_all()` | Döngüyü hemen bir tur için uyandırır. |
| `set_note(code, note)` | Not kaydeder. |
| `set_user_blocked(code, bool)` | "Denedim, alınamıyor" işareti; durumu yeniden sınıflandırır. |
| `set_muted(code, bool)` | URL bildirimini sessize alır. |
| `update_settings(settings)` | Ayarları kaydeder; autostart değişince plugin'i günceller, döngüyü uyandırır. |

Event: `url-updated` (payload: `TrackedUrl`), `checking` (payload: kod — kart üzerinde dönen ikon için).

## Arayüz

- **Koyu tema**, Discord'a yakın palet. Tek pencere, ~900×640 varsayılan, yeniden boyutlandırılabilir.
- **Üst çubuk:** URL ekleme kutusu (Enter ile ekle), otomatik kontrol açma/kapama, aralık seçici, "Hepsini yenile", ayarlar ikonu.
- **Filtreler:** Tümü / Kullanımda / Boşta (Boşta görünüyor) / Boşaldı (iki alt durum) / Engelli — her birinde sayı.
- **Kart:** durum rozeti (renk + ikon + metin), sunucu ikonu ve adı, üye sayısı, "son kontrol: 5 sn önce" (canlı güncellenir), ⚠️ hata ipucu, zil (sessize al), yenile, sil (onaylı).
- **Kart detayı (tıklayınca açılır):** geçmiş listesi, not alanı, "Denedim, alınamıyor" işareti, `AppearsFree` için "alınabilir olması garanti değil" açıklaması.
- **Ayarlar paneli:** bildirim türleri, Windows ile başlat, aralık.
- Boş liste durumu: kısa açıklama + örnek girdi.

## Topluluk engelli listesi

- Repo kökünde `known-blocked.json`: `{ "codes": ["..."] }` (küçük harf, sıralı).
- Derleme zamanında gömülür; yeni sürümle güncellenir.
- README'de PR ile ekleme yönergesi ve CI'da format kontrolü (geçerli kod, tekrar yok, sıralı).

## Hata yönetimi

- Ağ yok / zaman aşımı (istek başına 10 sn) → `last_error`, durum korunur, döngü devam eder.
- 429 → bekle, devam et; arayüzde bekleme süresi gösterilmez, yalnızca kart ⚠️ alabilir.
- Bozuk JSON veri dosyası → `.bak` olarak yeniden adlandırılır, boş state ile başlanır, arayüzde bir kerelik uyarı.
- Bildirim izni yok / bildirim gönderilemedi → sessizce loglanır, uygulama çalışmaya devam eder.

## Test

- **Rust unit testleri:**
  - `parse.rs`: tüm girdi biçimleri, büyük/küçük harf, geçersiz karakter, uzunluk sınırları.
  - `status.rs`: her sınıflandırma dalı (200, 404+blocked, 404+user_blocked, 404+guild+widget gone/exists/error, 404 guild yok, hata durumları).
  - `notify.rs`: tüm geçiş kombinasyonları, muted, ayarlar.
  - `store.rs`: kaydet/yükle round-trip, bozuk dosya kurtarma.
  - `discord.rs`: mock HTTP sunucusu (`wiremock`) ile 200/404/429/5xx eşlemesi ve `Retry-After` okuma.
- **Gerçek dünya doğrulaması (manuel):** kullanımda bilinen bir kod (ör. `discord-developers`), rastgele uzun boş bir kod, widget endpoint'inin silinmiş/var olan sunucu yanıtları.
- **Performans ölçümü:** tepsi modunda RAM ve CPU, Görev Yöneticisi ile.

## Dağıtım

- GitHub repo: `vanity-watch` (MIT).
- `.github/workflows/release.yml`: `v*` tag'inde `tauri-action` ile Windows build (`.msi` + NSIS `.exe`), draft release.
- `.github/workflows/ci.yml`: `cargo test`, `cargo clippy`, `known-blocked.json` format kontrolü, frontend `tsc --noEmit`.
- README (Türkçe + İngilizce): ne yapar, ne yapmaz (token yok, sniping yok), kurulum, katkı, engelli listesine ekleme.
