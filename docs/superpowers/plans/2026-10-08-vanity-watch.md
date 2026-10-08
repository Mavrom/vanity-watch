# Vanity Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discord vanity URL'lerini token'sız takip eden, durum değişince Windows bildirimi veren, tepside çok hafif çalışan açık kaynak Tauri 2 masaüstü uygulaması.

**Architecture:** Rust backend saf modüllerden (parse, model, status, notify, store, blocked) ve bunları kullanan yan etkili katmandan (discord HTTP istemcisi, monitor döngüsü, Tauri komutları, tepsi/pencere yönetimi) oluşur. Arayüz Vite + sade TypeScript ile yazılır, backend ile Tauri komutları ve event'leri üzerinden konuşur. Pencere kapatılınca WebView yok edilir, sadece Rust süreci tepside çalışır.

**Tech Stack:** Tauri 2, Rust (reqwest/rustls, tokio, serde, chrono), tauri-plugin-notification, tauri-plugin-autostart, tauri-plugin-single-instance, Vite, TypeScript, vitest, wiremock (test).

**Spec:** `docs/superpowers/specs/2026-10-08-vanity-watch-design.md`

## Global Constraints

- Kullanıcı token'ı, bot token'ı veya herhangi bir kimlik bilgisi YOK. Sadece token'sız açık endpoint'ler: `GET /api/v10/invites/{code}?with_counts=true`, `GET /api/v10/guilds/{id}/widget.json`.
- URL'yi otomatik alma (sniping) YOK.
- Discord API base: `https://discord.com/api/v10`. User-Agent: `VanityWatch/<CARGO_PKG_VERSION> (+https://github.com/Mavrom/vanity-watch)`. İstek zaman aşımı: 10 sn.
- Vanity kodu: küçük harf, `a-z0-9-`, 2–32 karakter.
- Aralık değerleri: 10, 15, 20, 30, 60 sn; varsayılan 20. URL'ler arası bekleme ~1 sn, sıralı.
- Geçmiş limiti: URL başına 50 kayıt.
- Veri dosyası: `<AppData>/io.github.mavrom.vanitywatch/vanity-watch.json`, atomik yazma (tmp + rename), bozuksa `.json.bak`.
- Tepsi modunda hedef ≤ 25 MB RAM, boşta CPU ≈ %0.
- Bundle identifier: `io.github.mavrom.vanitywatch`; productName: `Vanity Watch`.
- Arayüz dili Türkçe; kod, isimler ve kod yorumları İngilizce.
- Discord'dan gelen metinler (sunucu adı vb.) ASLA `innerHTML` ile basılmaz; DOM `textContent`/`append` ile oluşturulur.
- Git commit e-postası: `95590733+Mavrom@users.noreply.github.com`. Commit mesajları `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` ile biter.

## File Structure

```
known-blocked.json              community blocked-codes list (embedded at compile time)
app-icon.svg                    source icon for `tauri icon`
index.html                      app shell markup
package.json / tsconfig.json / vite.config.ts
src/
  main.ts                       app wiring: state, list, filters, settings, events
  api.ts                        TS types mirroring Rust models + invoke/listen wrappers
  card.ts                       one URL card component (render/update in place)
  format.ts                     pure formatting: status meta, filters, relative time
  format.test.ts                vitest tests for format.ts
  dom.ts                        tiny element builder `h()` + `svgIcon()`
  icons.ts                      static SVG icon strings
  styles.css                    dark theme
src-tauri/
  Cargo.toml / build.rs / tauri.conf.json / capabilities/default.json / icons/
  src/
    main.rs                     binary entry → lib::run()
    lib.rs                      builder, plugins, setup, run-event loop
    parse.rs                    input → vanity code
    model.rs                    Status, GuildInfo, HistoryEntry, TrackedUrl, Settings, Classification
    blocked.rs                  embedded known-blocked list lookup
    discord.rs                  HTTP client: invite + widget checks
    status.rs                   classify() + widget_target()
    notify.rs                   should_notify() + message()
    store.rs                    JSON persistence
    monitor.rs                  AppState, check_one(), background loop
    commands.rs                 Tauri commands
    window.rs                   open/recreate main window
    tray.rs                     tray icon + menu
.github/workflows/ci.yml, release.yml
README.md, LICENSE
```

---

### Task 1: Proje iskeleti (Tauri 2 + Vite + TS)

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/styles.css`, `.gitignore`, `app-icon.svg`
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/icons/*`

**Interfaces:**
- Produces: derlenebilir boş Tauri uygulaması; `vanity_watch_lib::run()`; `npm run build` → `dist/`.

- [ ] **Step 1: create-tauri-app ile scratch klasörde iskelet oluştur**

Scratchpad'de (proje dışında):

```bash
npm create tauri-app@latest vanity-watch -- --template vanilla-ts --manager npm --identifier io.github.mavrom.vanitywatch --yes
```

Sonra `node_modules` hariç her şeyi repo köküne kopyala (`docs/` ve `.git` korunur).

- [ ] **Step 2: Scaffold'daki örnek kodu temizle**

`src/` içindeki örnek varlıkları (`assets/`, logo svg'leri) sil. `src/main.ts`'i şu hale getir:

```ts
import "./styles.css";
```

`src/styles.css`'i boşalt (Task 11'de yazılacak). `index.html`:

```html
<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vanity Watch</title>
    <script type="module" src="/src/main.ts" defer></script>
  </head>
  <body></body>
</html>
```

`package.json`'dan `@tauri-apps/plugin-opener` bağımlılığını kaldır; `name` → `vanity-watch`, `version` → `0.1.0`; scripts'e `"test": "vitest run"` ekle. Sonra:

```bash
npm install
npm install -D vitest
```

- [ ] **Step 3: `src-tauri/Cargo.toml`**

```toml
[package]
name = "vanity-watch"
version = "0.1.0"
description = "Discord vanity URL tracker"
authors = ["Mavrom"]
license = "MIT"
edition = "2021"

[lib]
name = "vanity_watch_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-notification = "2"
tauri-plugin-autostart = "2"
tauri-plugin-single-instance = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
chrono = { version = "0.4", features = ["serde"] }
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
tokio = { version = "1", features = ["time", "sync", "macros"] }

[dev-dependencies]
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
wiremock = "0.6"
tempfile = "3"

[profile.release]
codegen-units = 1
lto = true
opt-level = "s"
panic = "abort"
strip = true
```

- [ ] **Step 4: `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Vanity Watch",
  "version": "0.1.0",
  "identifier": "io.github.mavrom.vanitywatch",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Vanity Watch",
        "width": 900,
        "height": 640,
        "minWidth": 560,
        "minHeight": 420,
        "create": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; style-src 'self' 'unsafe-inline'; connect-src ipc: http://ipc.localhost"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["msi", "nsis"],
    "shortDescription": "Discord vanity URL tracker",
    "license": "MIT",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

`"create": false` alanının kurulu tauri-utils sürümünde olduğunu doğrula (`cargo check` config hatası vermemeli).

- [ ] **Step 5: `src-tauri/capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Main window permissions",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

- [ ] **Step 6: Minimal `lib.rs` ve `main.rs`**

`src-tauri/src/lib.rs`:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Vanity Watch");
}
```

`src-tauri/src/main.rs`:

```rust
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vanity_watch_lib::run()
}
```

- [ ] **Step 7: Uygulama ikonu**

`app-icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6d78ff"/>
      <stop offset="1" stop-color="#4752c4"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="230" fill="url(#bg)"/>
  <path d="M176 512 C 304 292, 720 292, 848 512 C 720 732, 304 732, 176 512 Z" fill="#ffffff"/>
  <circle cx="512" cy="512" r="136" fill="#4752c4"/>
  <circle cx="560" cy="464" r="44" fill="#ffffff"/>
</svg>
```

```bash
npx tauri icon app-icon.svg
```

Expected: `src-tauri/icons/` altında `icon.ico`, `32x32.png`, `128x128.png` vb. üretilir. (SVG desteklenmezse hata mesajına göre PNG'ye çevirip tekrar çalıştır.)

- [ ] **Step 8: `.gitignore`**

```
node_modules/
dist/
src-tauri/target/
src-tauri/gen/schemas/
*.log
.DS_Store
```

- [ ] **Step 9: Derlemeyi doğrula**

```bash
npm run build
cd src-tauri && cargo check
```

Expected: ikisi de hatasız biter.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold Tauri 2 + Vite TypeScript app"
```

---

### Task 2: Girdi normalize etme (`parse.rs`)

**Files:**
- Create: `src-tauri/src/parse.rs`
- Modify: `src-tauri/src/lib.rs` (en üste `mod parse;`)

**Interfaces:**
- Produces: `pub fn normalize(input: &str) -> Result<String, String>` — hata mesajı Türkçe, kullanıcıya gösterilir.

- [ ] **Step 1: Failing testleri yaz**

`src-tauri/src/parse.rs`:

```rust
/// Turns user input like `discord.gg/Xyz` or `https://discord.com/invite/xyz` into a vanity code.
pub fn normalize(input: &str) -> Result<String, String> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn accepts_plain_code() {
        assert_eq!(normalize("cool-server"), Ok("cool-server".to_string()));
    }

    #[test]
    fn lowercases_and_trims() {
        assert_eq!(normalize("  CoolServer \n"), Ok("coolserver".to_string()));
    }

    #[test]
    fn strips_known_url_forms() {
        for input in [
            "discord.gg/abc",
            "https://discord.gg/abc",
            "http://discord.gg/abc",
            "https://www.discord.gg/abc",
            "discord.com/invite/abc",
            "https://discord.com/invite/abc",
            "https://discordapp.com/invite/abc",
            "https://discord.gg/abc/",
            "https://discord.gg/abc?event=1",
            "https://discord.gg/abc#x",
        ] {
            assert_eq!(normalize(input), Ok("abc".to_string()), "input: {input}");
        }
    }

    #[test]
    fn rejects_bad_length() {
        assert!(normalize("").is_err());
        assert!(normalize("a").is_err());
        assert!(normalize(&"a".repeat(33)).is_err());
        assert!(normalize(&"a".repeat(32)).is_ok());
        assert!(normalize("ab").is_ok());
    }

    #[test]
    fn rejects_invalid_characters() {
        for input in ["ab cd", "ab_cd", "ab.cd", "çay", "a/b/c"] {
            assert!(normalize(input).is_err(), "input: {input}");
        }
    }
}
```

`lib.rs` en üstüne `mod parse;` ekle.

- [ ] **Step 2: Testlerin fail ettiğini doğrula**

Run: `cd src-tauri && cargo test parse::`
Expected: FAIL (`not yet implemented` panic).

- [ ] **Step 3: Implementasyon**

`todo!()` yerine:

```rust
pub fn normalize(input: &str) -> Result<String, String> {
    let mut rest = input.trim().to_lowercase();
    for prefix in ["https://", "http://"] {
        if let Some(r) = rest.strip_prefix(prefix) {
            rest = r.to_string();
        }
    }
    if let Some(r) = rest.strip_prefix("www.") {
        rest = r.to_string();
    }
    for host in ["discord.gg/", "discord.com/invite/", "discordapp.com/invite/"] {
        if let Some(r) = rest.strip_prefix(host) {
            rest = r.to_string();
            break;
        }
    }
    let code = rest
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_end_matches('/')
        .to_string();

    if code.len() < 2 || code.len() > 32 {
        return Err("URL kodu 2-32 karakter olmalı".to_string());
    }
    if !code
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err("URL yalnızca harf, rakam ve tire (-) içerebilir".to_string());
    }
    Ok(code)
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cd src-tauri && cargo test parse::`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/parse.rs src-tauri/src/lib.rs
git commit -m "feat: normalize vanity URL input"
```

---

### Task 3: Veri modeli (`model.rs`)

**Files:**
- Create: `src-tauri/src/model.rs`
- Modify: `src-tauri/src/lib.rs` (`mod model;`)

**Interfaces:**
- Produces:
  - `enum Status { Unknown, InUse, AppearsFree, ReleasedGuildExists, ReleasedGuildGone, Blocked }` (serde snake_case, `Copy`, `Default = Unknown`), `Status::is_free()`, `Status::is_released()`
  - `struct GuildInfo { id: String, name: String, icon: Option<String>, member_count: Option<u64> }` (serde camelCase)
  - `struct HistoryEntry { at: DateTime<Utc>, from: Status, to: Status }`
  - `struct TrackedUrl { code, added_at, status, last_checked: Option<DateTime<Utc>>, last_error: Option<String>, guild: Option<GuildInfo>, note: String, user_blocked: bool, muted: bool, history: Vec<HistoryEntry> }` (serde camelCase, default)
  - `TrackedUrl::new(code: String, now: DateTime<Utc>) -> TrackedUrl`
  - `TrackedUrl::apply(&mut self, c: Classification, now: DateTime<Utc>) -> Option<(Status, Status)>`
  - `struct Classification { status: Option<Status>, guild: Option<GuildInfo>, error: Option<String> }` (`None` = değiştirme)
  - `struct Settings { auto_check: bool, interval_secs: u32, notify_on_release: bool, notify_on_taken: bool, autostart: bool }` (serde camelCase, default), `Settings::sanitized(self) -> Settings`
  - `const HISTORY_LIMIT: usize = 50`, `const ALLOWED_INTERVALS: [u32; 5]`

- [ ] **Step 1: Failing testlerle birlikte tipleri yaz**

`src-tauri/src/model.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const HISTORY_LIMIT: usize = 50;
pub const ALLOWED_INTERVALS: [u32; 5] = [10, 15, 20, 30, 60];
const DEFAULT_INTERVAL: u32 = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    #[default]
    Unknown,
    InUse,
    AppearsFree,
    ReleasedGuildExists,
    ReleasedGuildGone,
    Blocked,
}

impl Status {
    /// Not used by any server (whatever we know about why).
    pub fn is_free(self) -> bool {
        matches!(
            self,
            Status::AppearsFree | Status::ReleasedGuildExists | Status::ReleasedGuildGone
        )
    }

    /// Freed after we had seen it in use.
    pub fn is_released(self) -> bool {
        matches!(self, Status::ReleasedGuildExists | Status::ReleasedGuildGone)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuildInfo {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub member_count: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub at: DateTime<Utc>,
    pub from: Status,
    pub to: Status,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrackedUrl {
    pub code: String,
    pub added_at: DateTime<Utc>,
    pub status: Status,
    pub last_checked: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    /// Last guild seen using this code; kept after the code is released.
    pub guild: Option<GuildInfo>,
    pub note: String,
    pub user_blocked: bool,
    pub muted: bool,
    pub history: Vec<HistoryEntry>,
}

/// Outcome of one check. `None` fields leave the stored value unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Classification {
    pub status: Option<Status>,
    pub guild: Option<GuildInfo>,
    pub error: Option<String>,
}

impl TrackedUrl {
    pub fn new(code: String, now: DateTime<Utc>) -> Self {
        todo!()
    }

    /// Applies a check result. Returns `(from, to)` when the status changed.
    pub fn apply(&mut self, c: Classification, now: DateTime<Utc>) -> Option<(Status, Status)> {
        todo!()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub auto_check: bool,
    pub interval_secs: u32,
    pub notify_on_release: bool,
    pub notify_on_taken: bool,
    pub autostart: bool,
}

impl Default for Settings {
    fn default() -> Self {
        todo!()
    }
}

impl Settings {
    /// Replaces out-of-range values (e.g. a hand-edited interval) with defaults.
    pub fn sanitized(self) -> Self {
        todo!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn t(secs: i64) -> DateTime<Utc> {
        Utc.timestamp_opt(1_700_000_000 + secs, 0).unwrap()
    }

    fn guild() -> GuildInfo {
        GuildInfo { id: "1".into(), name: "G".into(), icon: None, member_count: Some(5) }
    }

    fn status(s: Status) -> Classification {
        Classification { status: Some(s), ..Default::default() }
    }

    #[test]
    fn new_url_starts_unknown() {
        let u = TrackedUrl::new("abc".into(), t(0));
        assert_eq!(u.code, "abc");
        assert_eq!(u.added_at, t(0));
        assert_eq!(u.status, Status::Unknown);
        assert!(u.history.is_empty());
        assert!(u.last_checked.is_none());
    }

    #[test]
    fn apply_records_transition() {
        let mut u = TrackedUrl::new("abc".into(), t(0));
        let tr = u.apply(
            Classification { status: Some(Status::InUse), guild: Some(guild()), error: None },
            t(1),
        );
        assert_eq!(tr, Some((Status::Unknown, Status::InUse)));
        assert_eq!(u.status, Status::InUse);
        assert_eq!(u.guild, Some(guild()));
        assert_eq!(u.last_checked, Some(t(1)));
        assert_eq!(
            u.history,
            vec![HistoryEntry { at: t(1), from: Status::Unknown, to: Status::InUse }]
        );
    }

    #[test]
    fn apply_same_status_is_not_a_transition() {
        let mut u = TrackedUrl::new("abc".into(), t(0));
        u.apply(status(Status::InUse), t(1));
        assert_eq!(u.apply(status(Status::InUse), t(2)), None);
        assert_eq!(u.history.len(), 1);
        assert_eq!(u.last_checked, Some(t(2)));
    }

    #[test]
    fn apply_error_keeps_status_and_guild() {
        let mut u = TrackedUrl::new("abc".into(), t(0));
        u.apply(
            Classification { status: Some(Status::InUse), guild: Some(guild()), error: None },
            t(1),
        );
        let tr = u.apply(Classification { error: Some("boom".into()), ..Default::default() }, t(2));
        assert_eq!(tr, None);
        assert_eq!(u.status, Status::InUse);
        assert_eq!(u.guild, Some(guild()));
        assert_eq!(u.last_error.as_deref(), Some("boom"));
    }

    #[test]
    fn apply_clears_previous_error() {
        let mut u = TrackedUrl::new("abc".into(), t(0));
        u.apply(Classification { error: Some("boom".into()), ..Default::default() }, t(1));
        u.apply(status(Status::AppearsFree), t(2));
        assert_eq!(u.last_error, None);
    }

    #[test]
    fn history_is_capped() {
        let mut u = TrackedUrl::new("abc".into(), t(0));
        for i in 0..60 {
            let s = if i % 2 == 0 { Status::InUse } else { Status::AppearsFree };
            u.apply(status(s), t(i + 1));
        }
        assert_eq!(u.history.len(), HISTORY_LIMIT);
        assert_eq!(u.history.last().unwrap().at, t(60));
    }

    #[test]
    fn status_helpers() {
        assert!(Status::AppearsFree.is_free());
        assert!(Status::ReleasedGuildGone.is_free());
        assert!(!Status::Blocked.is_free());
        assert!(!Status::InUse.is_free());
        assert!(Status::ReleasedGuildExists.is_released());
        assert!(!Status::AppearsFree.is_released());
    }

    #[test]
    fn settings_defaults() {
        let s = Settings::default();
        assert!(s.auto_check);
        assert_eq!(s.interval_secs, 20);
        assert!(s.notify_on_release);
        assert!(!s.notify_on_taken);
        assert!(!s.autostart);
    }

    #[test]
    fn sanitized_resets_invalid_interval() {
        let s = Settings { interval_secs: 3, ..Settings::default() }.sanitized();
        assert_eq!(s.interval_secs, 20);
        let s = Settings { interval_secs: 60, ..Settings::default() }.sanitized();
        assert_eq!(s.interval_secs, 60);
    }

    #[test]
    fn serializes_for_frontend() {
        assert_eq!(
            serde_json::to_string(&Status::ReleasedGuildGone).unwrap(),
            "\"released_guild_gone\""
        );
        let json = serde_json::to_string(&TrackedUrl::new("abc".into(), t(0))).unwrap();
        assert!(json.contains("\"lastChecked\""));
        assert!(json.contains("\"userBlocked\""));
        let s: Settings = serde_json::from_str("{\"intervalSecs\":30}").unwrap();
        assert_eq!(s.interval_secs, 30);
        assert!(s.auto_check);
    }
}
```

`lib.rs`'e `mod model;` ekle.

- [ ] **Step 2: Testlerin fail ettiğini doğrula**

Run: `cd src-tauri && cargo test model::`
Expected: FAIL (`not yet implemented`).

- [ ] **Step 3: Implementasyon**

`todo!()`'ları değiştir:

```rust
    pub fn new(code: String, now: DateTime<Utc>) -> Self {
        Self { code, added_at: now, ..Default::default() }
    }

    pub fn apply(&mut self, c: Classification, now: DateTime<Utc>) -> Option<(Status, Status)> {
        self.last_checked = Some(now);
        self.last_error = c.error;
        if let Some(guild) = c.guild {
            self.guild = Some(guild);
        }
        let to = c.status?;
        if to == self.status {
            return None;
        }
        let from = std::mem::replace(&mut self.status, to);
        self.history.push(HistoryEntry { at: now, from, to });
        if self.history.len() > HISTORY_LIMIT {
            let excess = self.history.len() - HISTORY_LIMIT;
            self.history.drain(..excess);
        }
        Some((from, to))
    }
```

```rust
impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_check: true,
            interval_secs: DEFAULT_INTERVAL,
            notify_on_release: true,
            notify_on_taken: false,
            autostart: false,
        }
    }
}

impl Settings {
    pub fn sanitized(mut self) -> Self {
        if !ALLOWED_INTERVALS.contains(&self.interval_secs) {
            self.interval_secs = DEFAULT_INTERVAL;
        }
        self
    }
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cd src-tauri && cargo test model::`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/model.rs src-tauri/src/lib.rs
git commit -m "feat: add tracked URL data model"
```

---

### Task 4: Topluluk engelli listesi (`blocked.rs`)

**Files:**
- Create: `known-blocked.json`, `src-tauri/src/blocked.rs`
- Modify: `src-tauri/src/lib.rs` (`mod blocked;`)

**Interfaces:**
- Consumes: `crate::parse::normalize`
- Produces: `pub fn is_known_blocked(code: &str) -> bool`

- [ ] **Step 1: Liste dosyası**

`known-blocked.json` (başlangıçta boş — uydurma kayıt eklenmez; topluluk PR ile doldurur):

```json
{
  "codes": []
}
```

- [ ] **Step 2: Failing testlerle modülü yaz**

`src-tauri/src/blocked.rs`:

```rust
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::OnceLock;

/// Community-maintained list of codes that show as free but cannot be claimed.
const RAW: &str = include_str!("../../known-blocked.json");

#[derive(Deserialize)]
struct BlockedFile {
    codes: Vec<String>,
}

fn parse(raw: &str) -> HashSet<String> {
    todo!()
}

pub fn is_known_blocked(code: &str) -> bool {
    static SET: OnceLock<HashSet<String>> = OnceLock::new();
    SET.get_or_init(|| parse(RAW)).contains(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_file_is_valid() {
        let file: BlockedFile = serde_json::from_str(RAW).expect("known-blocked.json must be valid JSON");
        for code in &file.codes {
            assert_eq!(
                crate::parse::normalize(code).as_ref(),
                Ok(code),
                "invalid or non-normalized code in known-blocked.json: {code}"
            );
        }
        assert!(
            file.codes.windows(2).all(|w| w[0] < w[1]),
            "known-blocked.json codes must be sorted and unique"
        );
    }

    #[test]
    fn parse_reads_codes() {
        let set = parse(r#"{"codes":["abc","xyz"]}"#);
        assert!(set.contains("abc"));
        assert!(set.contains("xyz"));
        assert!(!set.contains("nope"));
    }

    #[test]
    fn parse_tolerates_garbage() {
        assert!(parse("not json").is_empty());
    }

    #[test]
    fn unknown_code_is_not_blocked() {
        assert!(!is_known_blocked("zz-surely-not-in-list-123"));
    }
}
```

`lib.rs`'e `mod blocked;` ekle.

- [ ] **Step 3: Fail doğrula**

Run: `cd src-tauri && cargo test blocked::`
Expected: FAIL (`not yet implemented`).

- [ ] **Step 4: Implementasyon**

```rust
fn parse(raw: &str) -> HashSet<String> {
    serde_json::from_str::<BlockedFile>(raw)
        .map(|f| f.codes.into_iter().collect())
        .unwrap_or_default()
}
```

- [ ] **Step 5: Geçtiğini doğrula**

Run: `cd src-tauri && cargo test blocked::`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add known-blocked.json src-tauri/src/blocked.rs src-tauri/src/lib.rs
git commit -m "feat: embed community known-blocked list"
```

---

### Task 5: Discord HTTP istemcisi (`discord.rs`)

**Files:**
- Create: `src-tauri/src/discord.rs`
- Modify: `src-tauri/src/lib.rs` (`mod discord;`)

**Interfaces:**
- Consumes: `crate::model::GuildInfo`
- Produces:
  - `pub const API_BASE: &str = "https://discord.com/api/v10"`
  - `pub enum InviteResult { Found(GuildInfo), NotFound, RateLimited(Duration), Error(String) }` (`Debug, Clone, PartialEq`)
  - `pub enum WidgetResult { GuildExists, GuildGone, Error(String) }` (`Debug, Clone, PartialEq`)
  - `pub struct DiscordClient` (`Clone`), `DiscordClient::new(base: impl Into<String>) -> Self`
  - `async fn check_invite(&self, code: &str) -> InviteResult`
  - `async fn check_guild_widget(&self, guild_id: &str) -> WidgetResult`

Gerçek yanıtlar (2026-10-08'de doğrulandı): invite yoksa `404 {"message":"Unknown Invite","code":10006}`; widget kapalı var olan sunucu `403 {"code":50004}`; olmayan sunucu `404 {"code":10004}`.

- [ ] **Step 1: Failing testlerle modül iskeleti**

`src-tauri/src/discord.rs`:

```rust
use crate::model::GuildInfo;
use reqwest::{Client, Response, StatusCode};
use serde::Deserialize;
use std::time::Duration;

pub const API_BASE: &str = "https://discord.com/api/v10";

const USER_AGENT: &str = concat!(
    "VanityWatch/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/Mavrom/vanity-watch)"
);
const DEFAULT_RETRY_SECS: f64 = 5.0;
const MAX_RETRY_SECS: f64 = 60.0;

#[derive(Debug, Clone, PartialEq)]
pub enum InviteResult {
    Found(GuildInfo),
    NotFound,
    RateLimited(Duration),
    Error(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum WidgetResult {
    GuildExists,
    GuildGone,
    Error(String),
}

#[derive(Deserialize)]
struct InviteBody {
    guild: Option<InviteGuild>,
    approximate_member_count: Option<u64>,
}

#[derive(Deserialize)]
struct InviteGuild {
    id: String,
    name: String,
    icon: Option<String>,
}

#[derive(Deserialize)]
struct RateLimitBody {
    retry_after: Option<f64>,
}

/// Unauthenticated client for Discord's public invite and widget endpoints.
#[derive(Clone)]
pub struct DiscordClient {
    http: Client,
    base: String,
}

impl DiscordClient {
    pub fn new(base: impl Into<String>) -> Self {
        let http = Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(10))
            .build()
            .expect("failed to build HTTP client");
        Self { http, base: base.into() }
    }

    pub async fn check_invite(&self, code: &str) -> InviteResult {
        todo!()
    }

    pub async fn check_guild_widget(&self, guild_id: &str) -> WidgetResult {
        todo!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    async fn mock(server: &MockServer, p: &str, response: ResponseTemplate) {
        Mock::given(method("GET")).and(path(p)).respond_with(response).mount(server).await;
    }

    #[tokio::test]
    async fn invite_found_maps_guild() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/invites/cool"))
            .and(query_param("with_counts", "true"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "code": "cool",
                "guild": { "id": "123", "name": "Cool Server", "icon": "abc" },
                "approximate_member_count": 42
            })))
            .mount(&server)
            .await;
        let client = DiscordClient::new(server.uri());
        assert_eq!(
            client.check_invite("cool").await,
            InviteResult::Found(GuildInfo {
                id: "123".into(),
                name: "Cool Server".into(),
                icon: Some("abc".into()),
                member_count: Some(42),
            })
        );
    }

    #[tokio::test]
    async fn invite_without_guild_is_found_with_empty_id() {
        let server = MockServer::start().await;
        mock(&server, "/invites/dm", ResponseTemplate::new(200).set_body_json(json!({ "code": "dm" }))).await;
        let client = DiscordClient::new(server.uri());
        match client.check_invite("dm").await {
            InviteResult::Found(g) => assert!(g.id.is_empty()),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[tokio::test]
    async fn invite_404_is_not_found() {
        let server = MockServer::start().await;
        mock(
            &server,
            "/invites/free",
            ResponseTemplate::new(404).set_body_json(json!({ "message": "Unknown Invite", "code": 10006 })),
        )
        .await;
        let client = DiscordClient::new(server.uri());
        assert_eq!(client.check_invite("free").await, InviteResult::NotFound);
    }

    #[tokio::test]
    async fn invite_429_reads_retry_after_header() {
        let server = MockServer::start().await;
        mock(&server, "/invites/x", ResponseTemplate::new(429).insert_header("Retry-After", "2.5")).await;
        let client = DiscordClient::new(server.uri());
        assert_eq!(
            client.check_invite("x").await,
            InviteResult::RateLimited(Duration::from_millis(2500))
        );
    }

    #[tokio::test]
    async fn invite_429_falls_back_to_body() {
        let server = MockServer::start().await;
        mock(&server, "/invites/x", ResponseTemplate::new(429).set_body_json(json!({ "retry_after": 3.0 }))).await;
        let client = DiscordClient::new(server.uri());
        assert_eq!(client.check_invite("x").await, InviteResult::RateLimited(Duration::from_secs(3)));
    }

    #[tokio::test]
    async fn invite_429_clamps_huge_wait() {
        let server = MockServer::start().await;
        mock(&server, "/invites/x", ResponseTemplate::new(429).insert_header("Retry-After", "9999")).await;
        let client = DiscordClient::new(server.uri());
        assert_eq!(client.check_invite("x").await, InviteResult::RateLimited(Duration::from_secs(60)));
    }

    #[tokio::test]
    async fn invite_500_is_error() {
        let server = MockServer::start().await;
        mock(&server, "/invites/x", ResponseTemplate::new(500)).await;
        let client = DiscordClient::new(server.uri());
        assert_eq!(client.check_invite("x").await, InviteResult::Error("HTTP 500".into()));
    }

    #[tokio::test]
    async fn network_failure_is_error() {
        let client = DiscordClient::new("http://127.0.0.1:1");
        assert!(matches!(client.check_invite("x").await, InviteResult::Error(_)));
        assert!(matches!(client.check_guild_widget("1").await, WidgetResult::Error(_)));
    }

    #[tokio::test]
    async fn widget_statuses() {
        let server = MockServer::start().await;
        mock(&server, "/guilds/1/widget.json", ResponseTemplate::new(200).set_body_json(json!({ "id": "1" }))).await;
        mock(
            &server,
            "/guilds/2/widget.json",
            ResponseTemplate::new(403).set_body_json(json!({ "message": "Widget Disabled", "code": 50004 })),
        )
        .await;
        mock(
            &server,
            "/guilds/3/widget.json",
            ResponseTemplate::new(404).set_body_json(json!({ "message": "Unknown Guild", "code": 10004 })),
        )
        .await;
        mock(&server, "/guilds/4/widget.json", ResponseTemplate::new(429)).await;
        mock(&server, "/guilds/5/widget.json", ResponseTemplate::new(502)).await;
        let client = DiscordClient::new(server.uri());
        assert_eq!(client.check_guild_widget("1").await, WidgetResult::GuildExists);
        assert_eq!(client.check_guild_widget("2").await, WidgetResult::GuildExists);
        assert_eq!(client.check_guild_widget("3").await, WidgetResult::GuildGone);
        assert!(matches!(client.check_guild_widget("4").await, WidgetResult::Error(_)));
        assert_eq!(client.check_guild_widget("5").await, WidgetResult::Error("HTTP 502".into()));
    }
}
```

`lib.rs`'e `mod discord;` ekle.

- [ ] **Step 2: Fail doğrula**

Run: `cd src-tauri && cargo test discord::`
Expected: FAIL (`not yet implemented`).

- [ ] **Step 3: Implementasyon**

`check_invite` ve `check_guild_widget` gövdeleri ile yardımcı fonksiyonlar:

```rust
    pub async fn check_invite(&self, code: &str) -> InviteResult {
        let url = format!("{}/invites/{}?with_counts=true", self.base, code);
        let resp = match self.http.get(&url).send().await {
            Ok(r) => r,
            Err(e) => return InviteResult::Error(describe(&e)),
        };
        match resp.status() {
            StatusCode::TOO_MANY_REQUESTS => InviteResult::RateLimited(retry_after(resp).await),
            StatusCode::NOT_FOUND => InviteResult::NotFound,
            s if s.is_success() => match resp.json::<InviteBody>().await {
                Ok(body) => InviteResult::Found(to_guild(body)),
                Err(_) => InviteResult::Error("Beklenmeyen yanıt".into()),
            },
            s => InviteResult::Error(format!("HTTP {}", s.as_u16())),
        }
    }

    pub async fn check_guild_widget(&self, guild_id: &str) -> WidgetResult {
        let url = format!("{}/guilds/{}/widget.json", self.base, guild_id);
        let resp = match self.http.get(&url).send().await {
            Ok(r) => r,
            Err(e) => return WidgetResult::Error(describe(&e)),
        };
        match resp.status() {
            // 403 = guild exists but its widget is disabled (code 50004).
            s if s.is_success() || s == StatusCode::FORBIDDEN => WidgetResult::GuildExists,
            // 404 = Unknown Guild (code 10004): deleted or terminated.
            StatusCode::NOT_FOUND => WidgetResult::GuildGone,
            StatusCode::TOO_MANY_REQUESTS => WidgetResult::Error("Rate limit".into()),
            s => WidgetResult::Error(format!("HTTP {}", s.as_u16())),
        }
    }
}

fn to_guild(body: InviteBody) -> GuildInfo {
    match body.guild {
        Some(g) => GuildInfo {
            id: g.id,
            name: g.name,
            icon: g.icon,
            member_count: body.approximate_member_count,
        },
        None => GuildInfo {
            id: String::new(),
            name: "Sunucu dışı davet".into(),
            icon: None,
            member_count: body.approximate_member_count,
        },
    }
}

async fn retry_after(resp: Response) -> Duration {
    let header = resp
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<f64>().ok());
    let secs = match header {
        Some(s) => s,
        None => resp
            .json::<RateLimitBody>()
            .await
            .ok()
            .and_then(|b| b.retry_after)
            .unwrap_or(DEFAULT_RETRY_SECS),
    };
    let secs = if secs.is_finite() { secs } else { DEFAULT_RETRY_SECS };
    Duration::from_secs_f64(secs.clamp(1.0, MAX_RETRY_SECS))
}

fn describe(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "Zaman aşımı".into()
    } else if e.is_connect() {
        "Bağlantı kurulamadı".into()
    } else {
        "Ağ hatası".into()
    }
}
```

(Not: `impl DiscordClient` bloğunun kapanış `}`'ı `check_guild_widget`'tan sonra gelir; yardımcılar blok dışındadır.)

- [ ] **Step 4: Geçtiğini doğrula**

Run: `cd src-tauri && cargo test discord::`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/discord.rs src-tauri/src/lib.rs
git commit -m "feat: add Discord invite and widget client"
```

---

### Task 6: Durum sınıflandırma (`status.rs`)

**Files:**
- Create: `src-tauri/src/status.rs`
- Modify: `src-tauri/src/lib.rs` (`mod status;`)

**Interfaces:**
- Consumes: `InviteResult`, `WidgetResult` (Task 5); `Classification`, `GuildInfo`, `Status` (Task 3)
- Produces:
  - `pub fn widget_target<'a>(current: Status, invite: &InviteResult, blocked: bool, last_guild: Option<&'a GuildInfo>) -> Option<&'a str>`
  - `pub fn classify(current: Status, invite: &InviteResult, blocked: bool, widget: Option<&WidgetResult>) -> Classification`

- [ ] **Step 1: Failing testlerle modül**

`src-tauri/src/status.rs`:

```rust
use crate::discord::{InviteResult, WidgetResult};
use crate::model::{Classification, GuildInfo, Status};

/// Guild ID to probe with the widget endpoint, if this check needs one:
/// the code just went free, isn't blocked, and we know which guild had it.
pub fn widget_target<'a>(
    current: Status,
    invite: &InviteResult,
    blocked: bool,
    last_guild: Option<&'a GuildInfo>,
) -> Option<&'a str> {
    todo!()
}

pub fn classify(
    current: Status,
    invite: &InviteResult,
    blocked: bool,
    widget: Option<&WidgetResult>,
) -> Classification {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn g(id: &str) -> GuildInfo {
        GuildInfo { id: id.into(), name: "G".into(), icon: None, member_count: None }
    }

    fn only(status: Status) -> Classification {
        Classification { status: Some(status), ..Default::default() }
    }

    #[test]
    fn found_is_in_use_and_updates_guild() {
        let c = classify(Status::Unknown, &InviteResult::Found(g("1")), false, None);
        assert_eq!(c, Classification { status: Some(Status::InUse), guild: Some(g("1")), error: None });
    }

    #[test]
    fn found_wins_over_blocked() {
        let c = classify(Status::Blocked, &InviteResult::Found(g("1")), true, None);
        assert_eq!(c.status, Some(Status::InUse));
    }

    #[test]
    fn not_found_blocked_is_blocked() {
        let c = classify(Status::InUse, &InviteResult::NotFound, true, None);
        assert_eq!(c, only(Status::Blocked));
    }

    #[test]
    fn not_found_never_seen_is_appears_free() {
        let c = classify(Status::Unknown, &InviteResult::NotFound, false, None);
        assert_eq!(c, only(Status::AppearsFree));
    }

    #[test]
    fn not_found_with_widget_results() {
        let nf = InviteResult::NotFound;
        assert_eq!(
            classify(Status::InUse, &nf, false, Some(&WidgetResult::GuildGone)),
            only(Status::ReleasedGuildGone)
        );
        assert_eq!(
            classify(Status::InUse, &nf, false, Some(&WidgetResult::GuildExists)),
            only(Status::ReleasedGuildExists)
        );
        assert_eq!(
            classify(Status::InUse, &nf, false, Some(&WidgetResult::Error("x".into()))),
            Classification {
                status: Some(Status::ReleasedGuildExists),
                guild: None,
                error: Some("x".into())
            }
        );
    }

    #[test]
    fn not_found_keeps_released_status() {
        for s in [Status::ReleasedGuildExists, Status::ReleasedGuildGone] {
            assert_eq!(classify(s, &InviteResult::NotFound, false, None), Classification::default());
        }
    }

    #[test]
    fn rate_limited_keeps_status_with_error() {
        let c = classify(Status::InUse, &InviteResult::RateLimited(Duration::from_secs(4)), false, None);
        assert_eq!(c.status, None);
        assert!(c.error.unwrap().contains("Rate limit"));
    }

    #[test]
    fn error_keeps_status() {
        let c = classify(Status::InUse, &InviteResult::Error("Zaman aşımı".into()), false, None);
        assert_eq!(c, Classification { error: Some("Zaman aşımı".into()), ..Default::default() });
    }

    #[test]
    fn widget_target_after_in_use() {
        let guild = g("42");
        assert_eq!(widget_target(Status::InUse, &InviteResult::NotFound, false, Some(&guild)), Some("42"));
        assert_eq!(widget_target(Status::Blocked, &InviteResult::NotFound, false, Some(&guild)), Some("42"));
    }

    #[test]
    fn widget_target_skipped_when_not_needed() {
        let guild = g("42");
        let empty = g("");
        assert_eq!(widget_target(Status::InUse, &InviteResult::Found(g("1")), false, Some(&guild)), None);
        assert_eq!(widget_target(Status::InUse, &InviteResult::NotFound, true, Some(&guild)), None);
        assert_eq!(widget_target(Status::ReleasedGuildGone, &InviteResult::NotFound, false, Some(&guild)), None);
        assert_eq!(widget_target(Status::InUse, &InviteResult::NotFound, false, None), None);
        assert_eq!(widget_target(Status::InUse, &InviteResult::NotFound, false, Some(&empty)), None);
        assert_eq!(
            widget_target(Status::InUse, &InviteResult::Error("x".into()), false, Some(&guild)),
            None
        );
    }
}
```

`lib.rs`'e `mod status;` ekle.

- [ ] **Step 2: Fail doğrula**

Run: `cd src-tauri && cargo test status::`
Expected: FAIL.

- [ ] **Step 3: Implementasyon**

```rust
pub fn widget_target<'a>(
    current: Status,
    invite: &InviteResult,
    blocked: bool,
    last_guild: Option<&'a GuildInfo>,
) -> Option<&'a str> {
    if !matches!(invite, InviteResult::NotFound) || blocked || current.is_released() {
        return None;
    }
    last_guild.map(|g| g.id.as_str()).filter(|id| !id.is_empty())
}

pub fn classify(
    current: Status,
    invite: &InviteResult,
    blocked: bool,
    widget: Option<&WidgetResult>,
) -> Classification {
    let to = |status: Status| Classification { status: Some(status), ..Default::default() };
    match invite {
        InviteResult::Found(guild) => Classification {
            status: Some(Status::InUse),
            guild: Some(guild.clone()),
            error: None,
        },
        InviteResult::NotFound if blocked => to(Status::Blocked),
        InviteResult::NotFound => match widget {
            Some(WidgetResult::GuildGone) => to(Status::ReleasedGuildGone),
            Some(WidgetResult::GuildExists) => to(Status::ReleasedGuildExists),
            Some(WidgetResult::Error(e)) => Classification {
                status: Some(Status::ReleasedGuildExists),
                guild: None,
                error: Some(e.clone()),
            },
            None if current.is_released() => Classification::default(),
            None => to(Status::AppearsFree),
        },
        InviteResult::RateLimited(wait) => Classification {
            error: Some(format!("Rate limit, {} sn bekleniyor", wait.as_secs().max(1))),
            ..Default::default()
        },
        InviteResult::Error(e) => Classification { error: Some(e.clone()), ..Default::default() },
    }
}
```

- [ ] **Step 4: Geçtiğini doğrula**

Run: `cd src-tauri && cargo test status::`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/status.rs src-tauri/src/lib.rs
git commit -m "feat: classify vanity status from API results"
```

---

### Task 7: Bildirim kararı ve metni (`notify.rs`)

**Files:**
- Create: `src-tauri/src/notify.rs`
- Modify: `src-tauri/src/lib.rs` (`mod notify;`)

**Interfaces:**
- Consumes: `GuildInfo`, `Settings`, `Status` (Task 3)
- Produces:
  - `pub enum NotifyKind { Released, Taken }`
  - `pub fn should_notify(from: Status, to: Status, settings: &Settings, muted: bool) -> Option<NotifyKind>`
  - `pub fn message(kind: NotifyKind, code: &str, to: Status, guild: Option<&GuildInfo>) -> (String, String)` — `(title, body)`

- [ ] **Step 1: Failing testlerle modül**

`src-tauri/src/notify.rs`:

```rust
use crate::model::{GuildInfo, Settings, Status};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotifyKind {
    /// A code we saw in use became free.
    Released,
    /// A free code was taken by a server.
    Taken,
}

pub fn should_notify(from: Status, to: Status, settings: &Settings, muted: bool) -> Option<NotifyKind> {
    todo!()
}

pub fn message(kind: NotifyKind, code: &str, to: Status, guild: Option<&GuildInfo>) -> (String, String) {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn defaults() -> Settings {
        Settings::default()
    }

    #[test]
    fn release_notifies_for_every_free_status() {
        for to in [Status::AppearsFree, Status::ReleasedGuildExists, Status::ReleasedGuildGone] {
            assert_eq!(should_notify(Status::InUse, to, &defaults(), false), Some(NotifyKind::Released));
        }
    }

    #[test]
    fn muted_never_notifies() {
        assert_eq!(should_notify(Status::InUse, Status::AppearsFree, &defaults(), true), None);
    }

    #[test]
    fn release_respects_setting() {
        let s = Settings { notify_on_release: false, ..defaults() };
        assert_eq!(should_notify(Status::InUse, Status::AppearsFree, &s, false), None);
    }

    #[test]
    fn taken_is_off_by_default_and_opt_in() {
        assert_eq!(should_notify(Status::AppearsFree, Status::InUse, &defaults(), false), None);
        let s = Settings { notify_on_taken: true, ..defaults() };
        assert_eq!(
            should_notify(Status::ReleasedGuildGone, Status::InUse, &s, false),
            Some(NotifyKind::Taken)
        );
    }

    #[test]
    fn other_transitions_are_silent() {
        let all_on = Settings { notify_on_taken: true, ..defaults() };
        assert_eq!(should_notify(Status::Unknown, Status::InUse, &all_on, false), None);
        assert_eq!(should_notify(Status::Unknown, Status::AppearsFree, &all_on, false), None);
        assert_eq!(should_notify(Status::InUse, Status::Blocked, &all_on, false), None);
        assert_eq!(should_notify(Status::AppearsFree, Status::ReleasedGuildGone, &all_on, false), None);
    }

    #[test]
    fn messages_mention_code_and_context() {
        let (title, body) = message(NotifyKind::Released, "xyz", Status::ReleasedGuildExists, None);
        assert_eq!(title, "discord.gg/xyz boşaldı!");
        assert!(body.contains("hâlâ var"));
        let (_, body) = message(NotifyKind::Released, "xyz", Status::ReleasedGuildGone, None);
        assert!(body.contains("kapatılmış"));
        let guild = GuildInfo { id: "1".into(), name: "Kedi Sever".into(), icon: None, member_count: None };
        let (title, body) = message(NotifyKind::Taken, "xyz", Status::InUse, Some(&guild));
        assert_eq!(title, "discord.gg/xyz alındı");
        assert!(body.contains("Kedi Sever"));
    }
}
```

`lib.rs`'e `mod notify;` ekle.

- [ ] **Step 2: Fail doğrula**

Run: `cd src-tauri && cargo test notify::`
Expected: FAIL.

- [ ] **Step 3: Implementasyon**

```rust
pub fn should_notify(from: Status, to: Status, settings: &Settings, muted: bool) -> Option<NotifyKind> {
    if muted {
        return None;
    }
    if from == Status::InUse && to.is_free() && settings.notify_on_release {
        return Some(NotifyKind::Released);
    }
    if from.is_free() && to == Status::InUse && settings.notify_on_taken {
        return Some(NotifyKind::Taken);
    }
    None
}

pub fn message(kind: NotifyKind, code: &str, to: Status, guild: Option<&GuildInfo>) -> (String, String) {
    match kind {
        NotifyKind::Released => {
            let body = match to {
                Status::ReleasedGuildExists => "Sunucu hâlâ var, URL'yi bırakmış. Alınabilir olabilir.",
                Status::ReleasedGuildGone => "Sunucu kapatılmış veya silinmiş. URL bir süre kilitli kalabilir.",
                _ => "URL boşta görünüyor.",
            };
            (format!("discord.gg/{code} boşaldı!"), body.to_string())
        }
        NotifyKind::Taken => {
            let body = match guild {
                Some(g) => format!("Sunucu: {}", g.name),
                None => "Bir sunucu bu URL'yi aldı.".to_string(),
            };
            (format!("discord.gg/{code} alındı"), body)
        }
    }
}
```

- [ ] **Step 4: Geçtiğini doğrula**

Run: `cd src-tauri && cargo test notify::`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/notify.rs src-tauri/src/lib.rs
git commit -m "feat: decide and word status-change notifications"
```

---

### Task 8: Kalıcı veri (`store.rs`)

**Files:**
- Create: `src-tauri/src/store.rs`
- Modify: `src-tauri/src/lib.rs` (`mod store;`)

**Interfaces:**
- Consumes: `Settings`, `TrackedUrl` (Task 3)
- Produces:
  - `pub struct Data { pub settings: Settings, pub urls: Vec<TrackedUrl> }` (serde camelCase, default)
  - `pub struct Store { pub data: Data, .. }`
  - `Store::load(path: PathBuf) -> (Store, bool)` — bool: bozuk dosyadan kurtarıldı mı
  - `Store::save(&self) -> std::io::Result<()>`
  - `Store::get(&self, code: &str) -> Option<&TrackedUrl>`, `Store::get_mut(&mut self, code: &str) -> Option<&mut TrackedUrl>`

- [ ] **Step 1: Failing testlerle modül**

`src-tauri/src/store.rs`:

```rust
use crate::model::{Settings, TrackedUrl};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::PathBuf;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Data {
    pub settings: Settings,
    pub urls: Vec<TrackedUrl>,
}

pub struct Store {
    path: PathBuf,
    pub data: Data,
}

impl Store {
    /// Loads `path`. A corrupt file is moved to `*.json.bak` and an empty store is
    /// returned with `true` so the UI can tell the user once.
    pub fn load(path: PathBuf) -> (Store, bool) {
        todo!()
    }

    /// Writes atomically: temp file, then rename over the old one.
    pub fn save(&self) -> io::Result<()> {
        todo!()
    }

    pub fn get(&self, code: &str) -> Option<&TrackedUrl> {
        self.data.urls.iter().find(|u| u.code == code)
    }

    pub fn get_mut(&mut self, code: &str) -> Option<&mut TrackedUrl> {
        self.data.urls.iter_mut().find(|u| u.code == code)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn missing_file_gives_empty_store() {
        let dir = tempfile::tempdir().unwrap();
        let (store, recovered) = Store::load(dir.path().join("data.json"));
        assert!(!recovered);
        assert_eq!(store.data, Data::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("data.json");
        let (mut store, _) = Store::load(path.clone());
        store.data.urls.push(TrackedUrl::new("abc".into(), Utc::now()));
        store.data.settings.interval_secs = 30;
        store.save().unwrap();

        let (loaded, recovered) = Store::load(path);
        assert!(!recovered);
        assert_eq!(loaded.data, store.data);
        assert!(loaded.get("abc").is_some());
    }

    #[test]
    fn corrupt_file_is_backed_up() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        fs::write(&path, "{ not json").unwrap();
        let (store, recovered) = Store::load(path.clone());
        assert!(recovered);
        assert_eq!(store.data, Data::default());
        assert!(dir.path().join("data.json.bak").exists());
        assert!(!path.exists());
    }

    #[test]
    fn invalid_interval_is_sanitized_on_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        fs::write(&path, r#"{"settings":{"intervalSecs":1},"urls":[]}"#).unwrap();
        let (store, _) = Store::load(path);
        assert_eq!(store.data.settings.interval_secs, 20);
    }

    #[test]
    fn get_mut_edits_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let (mut store, _) = Store::load(dir.path().join("data.json"));
        store.data.urls.push(TrackedUrl::new("abc".into(), Utc::now()));
        store.get_mut("abc").unwrap().note = "hi".into();
        assert_eq!(store.get("abc").unwrap().note, "hi");
        assert!(store.get_mut("nope").is_none());
    }
}
```

`lib.rs`'e `mod store;` ekle.

- [ ] **Step 2: Fail doğrula**

Run: `cd src-tauri && cargo test store::`
Expected: FAIL.

- [ ] **Step 3: Implementasyon**

```rust
    pub fn load(path: PathBuf) -> (Store, bool) {
        let raw = match fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(_) => return (Store { path, data: Data::default() }, false),
        };
        match serde_json::from_str::<Data>(&raw) {
            Ok(mut data) => {
                data.settings = data.settings.sanitized();
                (Store { path, data }, false)
            }
            Err(_) => {
                let _ = fs::rename(&path, path.with_extension("json.bak"));
                (Store { path, data: Data::default() }, true)
            }
        }
    }

    pub fn save(&self) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(&self.data)?)?;
        fs::rename(&tmp, &self.path)
    }
```

- [ ] **Step 4: Geçtiğini doğrula**

Run: `cd src-tauri && cargo test store::`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/store.rs src-tauri/src/lib.rs
git commit -m "feat: persist tracked URLs and settings to JSON"
```

---

### Task 9: Kontrol döngüsü, komutlar ve uygulama bağlantısı

**Files:**
- Create: `src-tauri/src/monitor.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/window.rs`
- Modify: `src-tauri/src/lib.rs` (tam yeniden yazım)

**Interfaces:**
- Consumes: Task 2–8'deki her şey.
- Produces:
  - `monitor::AppState { store: Mutex<Store>, client: DiscordClient, wake: Notify, force_cycle: AtomicBool, recovered: AtomicBool }`, `AppState::new(store, recovered)`, `AppState::save(&self)`, `AppState::request_cycle(&self)`
  - `monitor::check_one(app: &AppHandle, code: &str)` (async), `monitor::run(app: AppHandle)` (async)
  - Event'ler: `"checking"` (payload `String` kod), `"url-updated"` (payload `TrackedUrl`)
  - Komutlar: `get_state`, `add_url { input }`, `remove_url { code }`, `refresh_url { code }`, `refresh_all`, `set_note { code, note }`, `set_user_blocked { code, blocked }`, `set_muted { code, muted }`, `update_settings { settings }`
  - `window::MAIN_WINDOW = "main"`, `window::open_main_window(app: &AppHandle)`

Bu katman Tauri runtime'ına bağlı olduğu için unit test yerine Task 12'de gerçek uygulamada doğrulanır; saf mantığın tamamı önceki task'larda test edildi.

- [ ] **Step 1: `monitor.rs`**

```rust
use crate::blocked;
use crate::discord::{DiscordClient, InviteResult, API_BASE};
use crate::notify;
use crate::status;
use crate::store::Store;
use chrono::Utc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Notify;

/// Pause between two codes in one cycle, to stay far below Discord's rate limits.
const GAP_BETWEEN_CHECKS: Duration = Duration::from_secs(1);

pub struct AppState {
    pub store: Mutex<Store>,
    pub client: DiscordClient,
    /// Wakes the monitor loop (settings changed or a cycle was requested).
    pub wake: Notify,
    /// Run one cycle even if auto-check is off.
    pub force_cycle: AtomicBool,
    /// Data file was corrupt on startup; reported to the UI once.
    pub recovered: AtomicBool,
}

impl AppState {
    pub fn new(store: Store, recovered: bool) -> Self {
        Self {
            store: Mutex::new(store),
            client: DiscordClient::new(API_BASE),
            wake: Notify::new(),
            force_cycle: AtomicBool::new(false),
            recovered: AtomicBool::new(recovered),
        }
    }

    pub fn save(&self) {
        if let Err(e) = self.store.lock().unwrap().save() {
            eprintln!("failed to save data: {e}");
        }
    }

    pub fn request_cycle(&self) {
        self.force_cycle.store(true, Ordering::SeqCst);
        self.wake.notify_one();
    }
}

pub async fn run(app: AppHandle) {
    let state = app.state::<AppState>();
    loop {
        let (auto, interval) = {
            let store = state.store.lock().unwrap();
            (store.data.settings.auto_check, store.data.settings.interval_secs)
        };
        let forced = state.force_cycle.swap(false, Ordering::SeqCst);
        if auto || forced {
            run_cycle(&app).await;
        }
        if auto {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(interval.into())) => {}
                _ = state.wake.notified() => {}
            }
        } else {
            state.wake.notified().await;
        }
    }
}

async fn run_cycle(app: &AppHandle) {
    let state = app.state::<AppState>();
    let codes: Vec<String> = {
        let store = state.store.lock().unwrap();
        store.data.urls.iter().map(|u| u.code.clone()).collect()
    };
    for (i, code) in codes.iter().enumerate() {
        if i > 0 {
            tokio::time::sleep(GAP_BETWEEN_CHECKS).await;
        }
        check_one(app, code).await;
    }
    // Persists last_checked timestamps once per cycle.
    state.save();
}

/// Checks one code, stores the result, emits `url-updated` and notifies on transitions.
pub async fn check_one(app: &AppHandle, code: &str) {
    let state = app.state::<AppState>();
    let snapshot = {
        let store = state.store.lock().unwrap();
        match store.get(code) {
            Some(url) => url.clone(),
            None => return,
        }
    };
    let _ = app.emit("checking", code);

    let blocked = snapshot.user_blocked || blocked::is_known_blocked(code);
    let mut invite = state.client.check_invite(code).await;
    if let InviteResult::RateLimited(wait) = invite {
        tokio::time::sleep(wait).await;
        invite = state.client.check_invite(code).await;
    }
    let widget = match status::widget_target(snapshot.status, &invite, blocked, snapshot.guild.as_ref()) {
        Some(guild_id) => Some(state.client.check_guild_widget(guild_id).await),
        None => None,
    };
    let classification = status::classify(snapshot.status, &invite, blocked, widget.as_ref());

    let (updated, transition, settings) = {
        let mut store = state.store.lock().unwrap();
        let settings = store.data.settings.clone();
        let Some(url) = store.get_mut(code) else { return };
        let transition = url.apply(classification, Utc::now());
        (url.clone(), transition, settings)
    };
    if transition.is_some() {
        state.save();
    }
    let _ = app.emit("url-updated", &updated);

    if let Some((from, to)) = transition {
        if let Some(kind) = notify::should_notify(from, to, &settings, updated.muted) {
            let (title, body) = notify::message(kind, code, to, updated.guild.as_ref());
            if let Err(e) = app.notification().builder().title(title).body(body).show() {
                eprintln!("failed to show notification: {e}");
            }
        }
    }
}
```

- [ ] **Step 2: `commands.rs`**

```rust
use crate::model::{Settings, TrackedUrl};
use crate::monitor::{self, AppState};
use crate::parse;
use chrono::Utc;
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

const NOTE_LIMIT: usize = 500;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    settings: Settings,
    urls: Vec<TrackedUrl>,
    recovered: bool,
}

fn spawn_check(app: AppHandle, code: String) {
    tauri::async_runtime::spawn(async move {
        monitor::check_one(&app, &code).await;
    });
}

fn with_url(state: &AppState, code: &str, edit: impl FnOnce(&mut TrackedUrl)) -> Result<(), String> {
    {
        let mut store = state.store.lock().unwrap();
        let url = store.get_mut(code).ok_or("URL bulunamadı")?;
        edit(url);
    }
    state.save();
    Ok(())
}

#[tauri::command]
pub fn get_state(state: State<'_, AppState>) -> AppSnapshot {
    let store = state.store.lock().unwrap();
    AppSnapshot {
        settings: store.data.settings.clone(),
        urls: store.data.urls.clone(),
        recovered: state.recovered.swap(false, Ordering::SeqCst),
    }
}

#[tauri::command]
pub fn add_url(app: AppHandle, state: State<'_, AppState>, input: String) -> Result<TrackedUrl, String> {
    let code = parse::normalize(&input)?;
    let url = {
        let mut store = state.store.lock().unwrap();
        if store.get(&code).is_some() {
            return Err(format!("discord.gg/{code} zaten listede"));
        }
        let url = TrackedUrl::new(code.clone(), Utc::now());
        store.data.urls.push(url.clone());
        url
    };
    state.save();
    spawn_check(app, code);
    Ok(url)
}

#[tauri::command]
pub fn remove_url(state: State<'_, AppState>, code: String) {
    state.store.lock().unwrap().data.urls.retain(|u| u.code != code);
    state.save();
}

#[tauri::command]
pub fn refresh_url(app: AppHandle, code: String) {
    spawn_check(app, code);
}

#[tauri::command]
pub fn refresh_all(state: State<'_, AppState>) {
    state.request_cycle();
}

#[tauri::command]
pub fn set_note(state: State<'_, AppState>, code: String, note: String) -> Result<(), String> {
    let note: String = note.chars().take(NOTE_LIMIT).collect();
    with_url(&state, &code, |u| u.note = note)
}

#[tauri::command]
pub fn set_user_blocked(
    app: AppHandle,
    state: State<'_, AppState>,
    code: String,
    blocked: bool,
) -> Result<(), String> {
    with_url(&state, &code, |u| u.user_blocked = blocked)?;
    spawn_check(app, code);
    Ok(())
}

#[tauri::command]
pub fn set_muted(state: State<'_, AppState>, code: String, muted: bool) -> Result<(), String> {
    with_url(&state, &code, |u| u.muted = muted)
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Settings, String> {
    let settings = settings.sanitized();
    let previous_autostart = state.store.lock().unwrap().data.settings.autostart;
    if settings.autostart != previous_autostart {
        let autolaunch = app.autolaunch();
        let result = if settings.autostart { autolaunch.enable() } else { autolaunch.disable() };
        result.map_err(|e| format!("Windows ile başlat ayarlanamadı: {e}"))?;
    }
    state.store.lock().unwrap().data.settings = settings.clone();
    state.save();
    state.wake.notify_one();
    Ok(settings)
}
```

- [ ] **Step 3: `window.rs`**

```rust
use tauri::{AppHandle, Manager, WebviewWindowBuilder};

pub const MAIN_WINDOW: &str = "main";

/// Shows the main window, recreating it from config if it was closed (closing
/// destroys the webview so the tray-only app stays light).
/// Runs on the async runtime: building a webview synchronously inside an event
/// handler can deadlock on Windows.
pub fn open_main_window(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            return;
        }
        let Some(config) = app.config().app.windows.iter().find(|w| w.label == MAIN_WINDOW).cloned() else {
            return;
        };
        match WebviewWindowBuilder::from_config(&app, &config).and_then(|b| b.build()) {
            Ok(window) => {
                let _ = window.set_focus();
            }
            Err(e) => eprintln!("failed to open main window: {e}"),
        }
    });
}
```

- [ ] **Step 4: `lib.rs`'i bağla**

```rust
mod blocked;
mod commands;
mod discord;
mod model;
mod monitor;
mod notify;
mod parse;
mod status;
mod store;
mod window;

use monitor::AppState;
use store::Store;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::open_main_window(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("vanity-watch.json");
            let (store, recovered) = Store::load(path);
            app.manage(AppState::new(store, recovered));
            if !std::env::args().any(|a| a == "--minimized") {
                window::open_main_window(app.handle());
            }
            tauri::async_runtime::spawn(monitor::run(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::add_url,
            commands::remove_url,
            commands::refresh_url,
            commands::refresh_all,
            commands::set_note,
            commands::set_user_blocked,
            commands::set_muted,
            commands::update_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vanity Watch");
}
```

- [ ] **Step 5: Derle ve tüm testleri çalıştır**

```bash
npm run build
cd src-tauri && cargo build && cargo test
```

Expected: build hatasız; tüm testler (49) geçer. Derleme hatası API isim farkından çıkarsa (ör. plugin sürümü), kurulu crate'in dokümantasyonuna göre düzelt.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src
git commit -m "feat: wire monitor loop, commands and app state"
```

---

### Task 10: Tepsi ve hafif arka plan modu

**Files:**
- Create: `src-tauri/src/tray.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `window::open_main_window`, `AppState::request_cycle`
- Produces: `tray::create_tray(app: &AppHandle) -> tauri::Result<()>`; pencere kapanınca uygulama çıkmaz.

- [ ] **Step 1: `tray.rs`**

```rust
use crate::monitor::AppState;
use crate::window::open_main_window;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Aç", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Hepsini yenile", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Çık", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &refresh, &separator, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("Vanity Watch")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => open_main_window(app),
            "refresh" => app.state::<AppState>().request_cycle(),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                open_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
```

(Kurulu tauri sürümünde `show_menu_on_left_click` yoksa eski adı `menu_on_left_click` kullanılır.)

- [ ] **Step 2: `lib.rs` — tray'i kur, pencere kapanınca çıkma**

`mod tray;` ekle. `setup` içinde `app.manage(...)` satırından sonra:

```rust
            tray::create_tray(app.handle())?;
```

`.run(tauri::generate_context!()).expect(...)` kısmını şununla değiştir:

```rust
        .build(tauri::generate_context!())
        .expect("error while building Vanity Watch")
        .run(|_app, event| {
            // Closing the window destroys the webview; keep running in the tray.
            // Only the tray's "Çık" (app.exit, which sets a code) really quits.
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = event {
                api.prevent_exit();
            }
        });
```

- [ ] **Step 3: Derle**

```bash
cd src-tauri && cargo build && cargo test
```

Expected: hatasız, testler geçer.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src
git commit -m "feat: run from the tray with the window destroyed on close"
```

---

### Task 11: Arayüz

**Files:**
- Create: `src/api.ts`, `src/format.ts`, `src/format.test.ts`, `src/dom.ts`, `src/icons.ts`, `src/card.ts`
- Modify: `index.html`, `src/main.ts`, `src/styles.css`

**Interfaces:**
- Consumes: Task 9'daki komutlar ve event'ler (camelCase alanlar).
- Produces: tam panel.

- [ ] **Step 1: `src/api.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Status =
  | "unknown"
  | "in_use"
  | "appears_free"
  | "released_guild_exists"
  | "released_guild_gone"
  | "blocked";

export interface GuildInfo {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number | null;
}

export interface HistoryEntry {
  at: string;
  from: Status;
  to: Status;
}

export interface TrackedUrl {
  code: string;
  addedAt: string;
  status: Status;
  lastChecked: string | null;
  lastError: string | null;
  guild: GuildInfo | null;
  note: string;
  userBlocked: boolean;
  muted: boolean;
  history: HistoryEntry[];
}

export interface Settings {
  autoCheck: boolean;
  intervalSecs: number;
  notifyOnRelease: boolean;
  notifyOnTaken: boolean;
  autostart: boolean;
}

export interface AppSnapshot {
  settings: Settings;
  urls: TrackedUrl[];
  recovered: boolean;
}

export const api = {
  getState: () => invoke<AppSnapshot>("get_state"),
  addUrl: (input: string) => invoke<TrackedUrl>("add_url", { input }),
  removeUrl: (code: string) => invoke<void>("remove_url", { code }),
  refreshUrl: (code: string) => invoke<void>("refresh_url", { code }),
  refreshAll: () => invoke<void>("refresh_all"),
  setNote: (code: string, note: string) => invoke<void>("set_note", { code, note }),
  setUserBlocked: (code: string, blocked: boolean) =>
    invoke<void>("set_user_blocked", { code, blocked }),
  setMuted: (code: string, muted: boolean) => invoke<void>("set_muted", { code, muted }),
  updateSettings: (settings: Settings) => invoke<Settings>("update_settings", { settings }),
};

export function onUrlUpdated(cb: (url: TrackedUrl) => void): Promise<UnlistenFn> {
  return listen<TrackedUrl>("url-updated", (e) => cb(e.payload));
}

export function onChecking(cb: (code: string) => void): Promise<UnlistenFn> {
  return listen<string>("checking", (e) => cb(e.payload));
}
```

- [ ] **Step 2: `src/format.test.ts` (failing)**

```ts
import { describe, expect, it } from "vitest";
import { formatMembers, guildIconUrl, matchesFilter, relativeTime } from "./format";

describe("relativeTime", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  it("handles missing and invalid input", () => {
    expect(relativeTime(null, now)).toBe("hiç");
    expect(relativeTime("nope", now)).toBe("hiç");
  });
  it("formats ranges", () => {
    expect(relativeTime("2026-10-08T11:59:58Z", now)).toBe("az önce");
    expect(relativeTime("2026-10-08T11:59:30Z", now)).toBe("30 sn önce");
    expect(relativeTime("2026-10-08T11:55:00Z", now)).toBe("5 dk önce");
    expect(relativeTime("2026-10-08T09:00:00Z", now)).toBe("3 sa önce");
    expect(relativeTime("2026-10-06T12:00:00Z", now)).toBe("2 gün önce");
  });
  it("clamps future timestamps", () => {
    expect(relativeTime("2026-10-08T12:00:10Z", now)).toBe("az önce");
  });
});

describe("matchesFilter", () => {
  it("groups statuses", () => {
    expect(matchesFilter("in_use", "all")).toBe(true);
    expect(matchesFilter("in_use", "in_use")).toBe(true);
    expect(matchesFilter("appears_free", "free")).toBe(true);
    expect(matchesFilter("released_guild_gone", "released")).toBe(true);
    expect(matchesFilter("released_guild_exists", "released")).toBe(true);
    expect(matchesFilter("released_guild_exists", "free")).toBe(false);
    expect(matchesFilter("blocked", "blocked")).toBe(true);
    expect(matchesFilter("unknown", "in_use")).toBe(false);
  });
});

describe("formatMembers", () => {
  it("formats counts", () => {
    expect(formatMembers(null)).toBe("");
    expect(formatMembers(950)).toBe("950 üye");
    expect(formatMembers(12400)).toMatch(/^12,4\s?B üye$/);
  });
});

describe("guildIconUrl", () => {
  it("builds CDN url only when possible", () => {
    expect(guildIconUrl({ id: "1", name: "x", icon: "abc", memberCount: null })).toBe(
      "https://cdn.discordapp.com/icons/1/abc.png?size=64",
    );
    expect(guildIconUrl({ id: "1", name: "x", icon: null, memberCount: null })).toBeNull();
    expect(guildIconUrl({ id: "", name: "x", icon: "abc", memberCount: null })).toBeNull();
  });
});
```

Run: `npm test` → Expected: FAIL (`./format` yok).

- [ ] **Step 3: `src/format.ts`**

```ts
import type { GuildInfo, Status } from "./api";

export type Tone = "green" | "yellow" | "orange" | "red" | "gray" | "lock";

export interface StatusMeta {
  label: string;
  tone: Tone;
  hint: string;
}

export const STATUS_META: Record<Status, StatusMeta> = {
  unknown: { label: "Kontrol ediliyor", tone: "gray", hint: "Henüz kontrol edilmedi." },
  in_use: {
    label: "Kullanımda",
    tone: "green",
    hint: "Bu URL şu an bir sunucu tarafından kullanılıyor.",
  },
  appears_free: {
    label: "Boşta görünüyor",
    tone: "yellow",
    hint: "Hiçbir sunucu kullanmıyor ama alınabilir olması garanti değil: Discord bazı kelimeleri rezerve eder.",
  },
  released_guild_exists: {
    label: "Boşaldı · sunucu var",
    tone: "orange",
    hint: "Önceki sunucu hâlâ var, URL'yi bırakmış. Alınabilme ihtimali daha yüksek.",
  },
  released_guild_gone: {
    label: "Boşaldı · sunucu kapalı",
    tone: "red",
    hint: "Önceki sunucu silinmiş veya kapatılmış. URL bir süre kilitli kalabilir.",
  },
  blocked: {
    label: "Engelli",
    tone: "lock",
    hint: "Topluluk listesinde ya da senin tarafından alınamaz olarak işaretlenmiş.",
  },
};

export type Filter = "all" | "in_use" | "free" | "released" | "blocked";

export const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Tümü" },
  { id: "in_use", label: "Kullanımda" },
  { id: "free", label: "Boşta" },
  { id: "released", label: "Boşaldı" },
  { id: "blocked", label: "Engelli" },
];

export function matchesFilter(status: Status, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "in_use":
      return status === "in_use";
    case "free":
      return status === "appears_free";
    case "released":
      return status === "released_guild_exists" || status === "released_guild_gone";
    case "blocked":
      return status === "blocked";
  }
}

export function relativeTime(iso: string | null, now = Date.now()): string {
  const then = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(then)) return "hiç";
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 5) return "az önce";
  if (secs < 60) return `${secs} sn önce`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa önce`;
  return `${Math.floor(hours / 24)} gün önce`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const compact = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });

export function formatMembers(count: number | null): string {
  return count == null ? "" : `${compact.format(count)} üye`;
}

export function guildIconUrl(guild: GuildInfo): string | null {
  return guild.icon && guild.id
    ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`
    : null;
}
```

Run: `npm test` → Expected: PASS. (`formatMembers(12400)` Node ICU'da "12,4 B" verir; farklıysa testin regex'ini gerçek çıktıya göre güncelle.)

- [ ] **Step 4: `src/dom.ts` ve `src/icons.ts`**

`src/dom.ts`:

```ts
type Attrs = Record<string, string | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

/** Creates an element. Keys starting with "on" become event listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, value);
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

/** Wraps static markup from icons.ts. Never pass external data here. */
export function svgIcon(markup: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "icon";
  span.innerHTML = markup;
  return span;
}
```

`src/icons.ts`:

```ts
// Paths adapted from Lucide (ISC license).
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  refresh: svg(
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  ),
  bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  bellOff: svg(
    '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>',
  ),
  trash: svg(
    '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  ),
  sliders: svg(
    '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
  ),
  plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
};
```

- [ ] **Step 5: `src/card.ts`**

```ts
import { api, type TrackedUrl } from "./api";
import { h, svgIcon } from "./dom";
import { STATUS_META, formatDate, formatMembers, guildIconUrl, relativeTime } from "./format";
import { ICONS } from "./icons";

export interface Card {
  el: HTMLElement;
  update(url: TrackedUrl): void;
  setChecking(on: boolean): void;
}

export interface CardHandlers {
  onError(message: string): void;
  onRemoved(code: string): void;
}

export function createCard(initial: TrackedUrl, handlers: CardHandlers): Card {
  let url = initial;
  const fail = (e: unknown) => handlers.onError(String(e));

  const avatar = h("div", { class: "avatar" });
  const info = h("div", { class: "info" });
  const bellBtn = h("button", { class: "btn icon ghost bell" });
  const refreshBtn = h("button", { class: "btn icon ghost refresh", title: "Şimdi kontrol et" }, svgIcon(ICONS.refresh));
  const deleteBtn = h("button", { class: "btn icon ghost danger", title: "Sil" }, svgIcon(ICONS.trash));
  const main = h("div", { class: "card-main" }, avatar, info, h("div", { class: "actions" }, bellBtn, refreshBtn, deleteBtn));

  const hint = h("p", { class: "hint" });
  const blockedInput = h("input", { type: "checkbox" });
  const note = h("textarea", { class: "note", placeholder: "Not ekle…", maxlength: "500", rows: "2" });
  const history = h("ul", { class: "history" });
  const details = h(
    "div",
    { class: "details", hidden: true },
    hint,
    h("label", { class: "check" }, blockedInput, h("span", {}, "Denedim, bu URL alınamıyor")),
    note,
    h("h4", {}, "Geçmiş"),
    history,
  );
  const el = h("article", { class: "card" }, main, details);

  main.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".actions")) return;
    details.hidden = !details.hidden;
    el.classList.toggle("open", !details.hidden);
  });

  bellBtn.addEventListener("click", () => {
    const muted = !url.muted;
    api.setMuted(url.code, muted).then(() => {
      url = { ...url, muted };
      render();
    }, fail);
  });

  refreshBtn.addEventListener("click", () => {
    setChecking(true);
    api.refreshUrl(url.code).catch(fail);
  });

  let confirmTimer: number | undefined;
  deleteBtn.addEventListener("click", () => {
    if (!deleteBtn.classList.contains("confirm")) {
      deleteBtn.classList.add("confirm");
      deleteBtn.title = "Silmek için tekrar tıkla";
      confirmTimer = window.setTimeout(() => {
        deleteBtn.classList.remove("confirm");
        deleteBtn.title = "Sil";
      }, 3000);
      return;
    }
    window.clearTimeout(confirmTimer);
    api.removeUrl(url.code).then(() => handlers.onRemoved(url.code), fail);
  });

  blockedInput.addEventListener("change", () => {
    setChecking(true);
    api.setUserBlocked(url.code, blockedInput.checked).catch(fail);
  });

  let noteTimer: number | undefined;
  const saveNote = () => {
    window.clearTimeout(noteTimer);
    if (note.value === url.note) return;
    url = { ...url, note: note.value };
    api.setNote(url.code, note.value).catch(fail);
  };
  note.addEventListener("input", () => {
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(saveNote, 600);
  });
  note.addEventListener("blur", saveNote);

  function render() {
    const meta = STATUS_META[url.status];
    el.dataset.tone = meta.tone;

    const iconUrl = url.guild ? guildIconUrl(url.guild) : null;
    const initial = (url.guild?.name || url.code).charAt(0).toUpperCase();
    avatar.replaceChildren(iconUrl ? h("img", { src: iconUrl, alt: "" }) : h("span", {}, initial));

    const secondary: Node[] = [];
    if (url.guild) {
      const inUse = url.status === "in_use";
      secondary.push(h("span", { class: "guild" }, inUse ? url.guild.name : `Son sahibi: ${url.guild.name}`));
      const members = formatMembers(url.guild.memberCount);
      if (inUse && members) secondary.push(h("span", {}, members));
    }
    secondary.push(h("span", { class: "time", "data-time": url.lastChecked ?? "" }, relativeTime(url.lastChecked)));

    info.replaceChildren(
      h(
        "div",
        { class: "line1" },
        h("span", { class: "code" }, h("span", { class: "prefix" }, "discord.gg/"), url.code),
        h("span", { class: `badge tone-${meta.tone}` }, meta.label),
        url.lastError ? h("span", { class: "warn", title: url.lastError }, "⚠ Kontrol edilemedi") : null,
      ),
      h("div", { class: "line2" }, ...secondary),
    );

    bellBtn.replaceChildren(svgIcon(url.muted ? ICONS.bellOff : ICONS.bell));
    bellBtn.title = url.muted ? "Bildirimler kapalı (aç)" : "Bildirimler açık (kapat)";
    bellBtn.classList.toggle("muted", url.muted);

    hint.textContent = meta.hint;
    blockedInput.checked = url.userBlocked;
    if (document.activeElement !== note) note.value = url.note;

    const entries = [...url.history].reverse();
    history.replaceChildren(
      ...(entries.length
        ? entries.map((e) =>
            h("li", {}, h("time", {}, formatDate(e.at)), `${STATUS_META[e.from].label} → ${STATUS_META[e.to].label}`),
          )
        : [h("li", { class: "empty-history" }, "Henüz değişiklik yok")]),
    );
  }

  function setChecking(on: boolean) {
    el.classList.toggle("checking", on);
  }

  render();
  return {
    el,
    update(next) {
      url = next;
      setChecking(false);
      render();
    },
    setChecking,
  };
}
```

- [ ] **Step 6: `index.html`**

```html
<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vanity Watch</title>
    <script type="module" src="/src/main.ts" defer></script>
  </head>
  <body>
    <header class="topbar">
      <div class="brand">
        <span class="logo" aria-hidden="true"></span>
        <span>Vanity Watch</span>
      </div>
      <form id="add-form" class="add" autocomplete="off">
        <span class="add-prefix">discord.gg/</span>
        <input id="add-input" placeholder="takip edilecek url" spellcheck="false" />
        <button type="submit" class="btn primary">Ekle</button>
      </form>
      <div class="controls">
        <label class="switch" title="Otomatik kontrol">
          <input type="checkbox" id="auto-toggle" />
          <span class="track"><span class="thumb"></span></span>
          <span>Otomatik</span>
        </label>
        <select id="interval-select" title="Kontrol aralığı">
          <option value="10">10 sn</option>
          <option value="15">15 sn</option>
          <option value="20">20 sn</option>
          <option value="30">30 sn</option>
          <option value="60">60 sn</option>
        </select>
        <button id="refresh-all" class="btn" title="Hepsini şimdi kontrol et">Hepsini yenile</button>
        <button id="open-settings" class="btn icon" title="Ayarlar"></button>
      </div>
    </header>
    <p id="add-error" class="add-error" hidden></p>
    <nav id="filters" class="filters"></nav>
    <main id="list" class="list"></main>
    <section id="empty" class="empty" hidden>
      <h2>Henüz takip ettiğin bir URL yok</h2>
      <p>Yukarıya bir vanity URL yaz: <code>sunucum</code>, <code>discord.gg/sunucum</code> veya tam link olabilir.</p>
      <p class="muted">Kontroller token gerektirmeyen açık Discord endpoint'iyle yapılır. Hesabın hiçbir şekilde kullanılmaz.</p>
    </section>
    <dialog id="settings" class="settings">
      <form method="dialog">
        <h2>Ayarlar</h2>
        <label class="row"><input type="checkbox" id="set-release" /> URL boşa düşünce bildirim gönder</label>
        <label class="row"><input type="checkbox" id="set-taken" /> Boştaki URL alınınca bildirim gönder</label>
        <label class="row"><input type="checkbox" id="set-autostart" /> Windows ile başlat (tepside, penceresiz)</label>
        <p class="muted">Pencereyi kapatınca uygulama tepside çalışmaya devam eder. Tamamen çıkmak için tepsi ikonuna sağ tıklayıp "Çık"ı seç.</p>
        <div class="dialog-actions"><button class="btn primary" value="close">Tamam</button></div>
      </form>
    </dialog>
    <div id="toast" class="toast" hidden></div>
  </body>
</html>
```

- [ ] **Step 7: `src/main.ts`**

```ts
import "./styles.css";
import { api, onChecking, onUrlUpdated, type Settings, type TrackedUrl } from "./api";
import { createCard, type Card } from "./card";
import { h, svgIcon } from "./dom";
import { FILTERS, matchesFilter, relativeTime, type Filter } from "./format";
import { ICONS } from "./icons";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const list = byId<HTMLElement>("list");
const filtersEl = byId<HTMLElement>("filters");
const emptyEl = byId<HTMLElement>("empty");
const addForm = byId<HTMLFormElement>("add-form");
const addInput = byId<HTMLInputElement>("add-input");
const addError = byId<HTMLParagraphElement>("add-error");
const autoToggle = byId<HTMLInputElement>("auto-toggle");
const intervalSelect = byId<HTMLSelectElement>("interval-select");
const refreshAllBtn = byId<HTMLButtonElement>("refresh-all");
const settingsBtn = byId<HTMLButtonElement>("open-settings");
const settingsDialog = byId<HTMLDialogElement>("settings");
const setRelease = byId<HTMLInputElement>("set-release");
const setTaken = byId<HTMLInputElement>("set-taken");
const setAutostart = byId<HTMLInputElement>("set-autostart");
const toast = byId<HTMLDivElement>("toast");

const urls = new Map<string, TrackedUrl>();
const cards = new Map<string, Card>();
let settings: Settings;
let filter: Filter = "all";
let toastTimer: number | undefined;

function showToast(message: string) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 4000);
}

function upsert(url: TrackedUrl, prepend = false) {
  urls.set(url.code, url);
  const existing = cards.get(url.code);
  if (existing) {
    existing.update(url);
  } else {
    const card = createCard(url, { onError: showToast, onRemoved: remove });
    cards.set(url.code, card);
    if (prepend) list.prepend(card.el);
    else list.append(card.el);
  }
  refreshView();
}

function remove(code: string) {
  urls.delete(code);
  cards.get(code)?.el.remove();
  cards.delete(code);
  refreshView();
}

function refreshView() {
  for (const [code, card] of cards) {
    card.el.hidden = !matchesFilter(urls.get(code)!.status, filter);
  }
  const all = [...urls.values()];
  filtersEl.replaceChildren(
    ...FILTERS.map((f) =>
      h(
        "button",
        {
          class: f.id === filter ? "chip active" : "chip",
          onclick: () => {
            filter = f.id;
            refreshView();
          },
        },
        f.label,
        h("span", { class: "count" }, String(all.filter((u) => matchesFilter(u.status, f.id)).length)),
      ),
    ),
  );
  emptyEl.hidden = urls.size > 0;
  filtersEl.hidden = urls.size === 0;
}

function applySettings() {
  autoToggle.checked = settings.autoCheck;
  intervalSelect.value = String(settings.intervalSecs);
  intervalSelect.disabled = !settings.autoCheck;
  setRelease.checked = settings.notifyOnRelease;
  setTaken.checked = settings.notifyOnTaken;
  setAutostart.checked = settings.autostart;
}

async function saveSettings(patch: Partial<Settings>) {
  try {
    settings = await api.updateSettings({ ...settings, ...patch });
  } catch (e) {
    showToast(String(e));
  }
  applySettings();
}

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = addInput.value.trim();
  if (!value) return;
  addError.hidden = true;
  try {
    const url = await api.addUrl(value);
    filter = "all";
    upsert(url, true);
    cards.get(url.code)?.setChecking(true);
    addInput.value = "";
  } catch (err) {
    addError.textContent = String(err);
    addError.hidden = false;
  }
});
addInput.addEventListener("input", () => (addError.hidden = true));

autoToggle.addEventListener("change", () => saveSettings({ autoCheck: autoToggle.checked }));
intervalSelect.addEventListener("change", () => saveSettings({ intervalSecs: Number(intervalSelect.value) }));
setRelease.addEventListener("change", () => saveSettings({ notifyOnRelease: setRelease.checked }));
setTaken.addEventListener("change", () => saveSettings({ notifyOnTaken: setTaken.checked }));
setAutostart.addEventListener("change", () => saveSettings({ autostart: setAutostart.checked }));
refreshAllBtn.addEventListener("click", () => api.refreshAll().catch((e) => showToast(String(e))));
settingsBtn.append(svgIcon(ICONS.sliders));
settingsBtn.addEventListener("click", () => settingsDialog.showModal());

async function init() {
  await onUrlUpdated((url) => {
    // Ignore late events for URLs removed in the meantime.
    if (urls.has(url.code)) upsert(url);
  });
  await onChecking((code) => cards.get(code)?.setChecking(true));

  const snapshot = await api.getState();
  settings = snapshot.settings;
  applySettings();
  [...snapshot.urls].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).forEach((u) => upsert(u));
  refreshView();
  if (snapshot.recovered) showToast("Veri dosyası bozuktu: yedeği alındı ve liste sıfırlandı.");

  window.setInterval(() => {
    document.querySelectorAll<HTMLElement>("[data-time]").forEach((el) => {
      el.textContent = relativeTime(el.dataset.time || null);
    });
  }, 1000);
}

init().catch((e) => showToast(`Başlatılamadı: ${e}`));
```

- [ ] **Step 8: `src/styles.css`**

```css
:root {
  --bg: #1e1f22;
  --panel: #2b2d31;
  --panel-2: #313338;
  --panel-3: #383a40;
  --border: #3f4147;
  --text: #dbdee1;
  --text-strong: #f2f3f5;
  --muted: #949ba4;
  --accent: #5865f2;
  --accent-hover: #4752c4;
  --green: #23a55a;
  --yellow: #f0b232;
  --orange: #e67e22;
  --red: #f23f43;
  --gray: #80848e;
  --radius: 10px;
  color-scheme: dark;
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }

html, body { margin: 0; height: 100%; }
body {
  background: var(--bg);
  color: var(--text);
  font: 14px/1.45 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
}

button, input, select, textarea { font: inherit; color: inherit; }
code { background: var(--panel-3); padding: 1px 6px; border-radius: 4px; font-size: 13px; }
.muted { color: var(--muted); }

/* Top bar */
.topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--text-strong); }
.logo {
  width: 22px; height: 22px; border-radius: 7px;
  background: radial-gradient(circle at 55% 45%, #fff 0 3px, #4752c4 3.5px 6px, #fff 6.5px 9px, transparent 9.5px), linear-gradient(135deg, #6d78ff, #4752c4);
}
.add {
  flex: 1;
  min-width: 240px;
  display: flex;
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 3px 3px 3px 12px;
}
.add:focus-within { border-color: var(--accent); }
.add-prefix { color: var(--muted); }
.add input { flex: 1; min-width: 0; background: none; border: 0; outline: 0; padding: 6px 4px; user-select: text; }
.add-error { margin: 8px 16px 0; color: var(--red); font-size: 13px; }
.controls { display: flex; align-items: center; gap: 8px; }

.btn {
  border: 0;
  border-radius: 8px;
  padding: 7px 12px;
  background: var(--panel-3);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background 0.15s, color 0.15s;
}
.btn:hover { background: #43454b; }
.btn.primary { background: var(--accent); color: #fff; }
.btn.primary:hover { background: var(--accent-hover); }
.btn.icon { padding: 7px; }
.btn.ghost { background: transparent; color: var(--muted); }
.btn.ghost:hover { background: var(--panel-3); color: var(--text-strong); }
.btn.danger.confirm { background: var(--red); color: #fff; }
.icon { display: inline-flex; width: 16px; height: 16px; }
.icon svg { width: 100%; height: 100%; }

select {
  background: var(--panel-3);
  border: 0;
  border-radius: 8px;
  padding: 7px 8px;
  cursor: pointer;
}
select:disabled { opacity: 0.5; cursor: default; }

.switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.switch input { display: none; }
.switch .track {
  width: 34px; height: 20px; border-radius: 10px; background: var(--gray);
  position: relative; transition: background 0.15s;
}
.switch .thumb {
  position: absolute; top: 3px; left: 3px; width: 14px; height: 14px;
  border-radius: 50%; background: #fff; transition: transform 0.15s;
}
.switch input:checked + .track { background: var(--green); }
.switch input:checked + .track .thumb { transform: translateX(14px); }

/* Filters */
.filters { display: flex; gap: 8px; padding: 12px 16px 4px; flex-wrap: wrap; }
.chip {
  border: 1px solid var(--border);
  background: transparent;
  border-radius: 999px;
  padding: 4px 12px;
  cursor: pointer;
  display: inline-flex;
  gap: 6px;
  align-items: center;
  color: var(--muted);
}
.chip:hover { color: var(--text-strong); }
.chip.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.chip .count { font-size: 12px; opacity: 0.8; }

/* List */
.list { flex: 1; overflow-y: auto; padding: 8px 16px 16px; display: flex; flex-direction: column; gap: 8px; }
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-left: 4px solid var(--tone, var(--gray));
  border-radius: var(--radius);
  transition: border-color 0.2s;
}
.card[data-tone="green"] { --tone: var(--green); }
.card[data-tone="yellow"] { --tone: var(--yellow); }
.card[data-tone="orange"] { --tone: var(--orange); }
.card[data-tone="red"] { --tone: var(--red); }
.card[data-tone="lock"] { --tone: var(--gray); }
.card-main { display: flex; align-items: center; gap: 12px; padding: 10px 12px; cursor: pointer; }
.avatar {
  width: 40px; height: 40px; border-radius: 50%; flex: none; overflow: hidden;
  background: var(--panel-3); display: grid; place-items: center;
  font-weight: 600; color: var(--muted);
}
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.info { flex: 1; min-width: 0; }
.line1 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.code { font-weight: 600; color: var(--text-strong); font-size: 15px; }
.code .prefix { color: var(--muted); font-weight: 400; }
.line2 { display: flex; gap: 6px; color: var(--muted); font-size: 12.5px; margin-top: 2px; white-space: nowrap; overflow: hidden; }
.line2 > span + span::before { content: "·"; margin-right: 6px; }
.line2 .guild { overflow: hidden; text-overflow: ellipsis; }
.badge { font-size: 12px; padding: 1px 8px; border-radius: 999px; font-weight: 600; }
.tone-green { background: rgb(35 165 90 / 0.18); color: #3ccf7c; }
.tone-yellow { background: rgb(240 178 50 / 0.18); color: var(--yellow); }
.tone-orange { background: rgb(230 126 34 / 0.2); color: #f39c4a; }
.tone-red { background: rgb(242 63 67 / 0.18); color: #ff6b6e; }
.tone-gray, .tone-lock { background: rgb(128 132 142 / 0.2); color: #b5bac1; }
.tone-lock::before { content: "🔒 "; }
.warn { color: var(--yellow); font-size: 12px; cursor: help; }
.actions { display: flex; gap: 2px; }
.bell.muted { color: var(--red); }
.card.checking .refresh .icon { animation: spin 0.9s linear infinite; color: var(--accent); }
@keyframes spin { to { transform: rotate(360deg); } }

.details { padding: 0 12px 12px 64px; border-top: 1px solid var(--border); }
.hint { color: var(--muted); font-size: 13px; margin: 10px 0; }
.check { display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 8px; }
.note {
  width: 100%; resize: vertical; background: var(--bg); border: 1px solid var(--border);
  border-radius: 8px; padding: 8px; outline: 0; user-select: text;
}
.note:focus { border-color: var(--accent); }
.details h4 { margin: 12px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.history { list-style: none; margin: 0; padding: 0; font-size: 13px; max-height: 160px; overflow-y: auto; }
.history li { padding: 3px 0; }
.history time { color: var(--muted); margin-right: 8px; font-variant-numeric: tabular-nums; }
.empty-history { color: var(--muted); }

/* Empty state */
.empty { margin: auto; text-align: center; max-width: 440px; padding: 24px; }
.empty h2 { color: var(--text-strong); font-size: 18px; }

/* Settings dialog */
.settings {
  background: var(--panel); color: var(--text); border: 1px solid var(--border);
  border-radius: 14px; padding: 20px 22px; width: min(440px, 92vw);
}
.settings::backdrop { background: rgb(0 0 0 / 0.55); }
.settings h2 { margin: 0 0 14px; font-size: 17px; color: var(--text-strong); }
.settings .row { display: flex; gap: 10px; align-items: center; padding: 6px 0; cursor: pointer; }
.dialog-actions { display: flex; justify-content: flex-end; margin-top: 12px; }

/* Toast */
.toast {
  position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
  background: var(--panel-3); border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 16px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.4); max-width: 90vw;
}

::-webkit-scrollbar { width: 10px; }
::-webkit-scrollbar-thumb { background: var(--panel-3); border-radius: 5px; border: 2px solid var(--bg); }
```

- [ ] **Step 9: Tip kontrolü, test, build**

```bash
npm test
npm run build
```

Expected: vitest PASS; `tsc` hatasız; `dist/` üretilir.

- [ ] **Step 10: Commit**

```bash
git add index.html src
git commit -m "feat: add tracker panel UI"
```

---

### Task 12: Gerçek uygulamada doğrulama ve performans ölçümü

**Files:** (kod değişikliği yalnızca bulunan hatalar için)

- [ ] **Step 1: Geliştirme modunda çalıştır**

```bash
npm run tauri dev
```

- [ ] **Step 2: Temel akış**

1. `discord-developers` ekle → 🟢 Kullanımda, "Discord Developers", üye sayısı görünür.
2. `zzqq-not-a-real-vanity-8812` ekle → 🟡 Boşta görünüyor.
3. `a b` ekle → hata mesajı; aynı kodu ikinci kez ekle → "zaten listede".
4. Kart tıklanınca detay açılır; not yaz, uygulamayı kapat-aç → not durur.
5. "Denedim, alınamıyor" işaretle → 🔒 Engelli; kaldır → 🟡.
6. Otomatik kapalıyken kontrol yapılmadığını, "Hepsini yenile" ile yapıldığını gör.

- [ ] **Step 3: Bildirim ve "boşaldı" akışı (veri dosyasıyla simülasyon)**

Uygulamadan tepsi → Çık. `%APPDATA%\io.github.mavrom.vanitywatch\vanity-watch.json` içinde `zzqq-not-a-real-vanity-8812` kaydını şu şekilde düzenle: `"status": "in_use"`, `"guild": {"id": "1", "name": "Test", "icon": null, "memberCount": 5}`. Uygulamayı başlat → ilk turda 404 + widget(1) = Unknown Guild → 🔴 "Boşaldı · sunucu kapalı" ve Windows bildirimi "discord.gg/zzqq-not-a-real-vanity-8812 boşaldı!" görülür; geçmişte "Kullanımda → Boşaldı · sunucu kapalı" kaydı olur.

- [ ] **Step 4: Tepsi davranışı**

Pencereyi X ile kapat → uygulama tepside kalır; tepsi ikonuna sol tık → pencere yeniden açılır ve liste dolu gelir; ikinci kez `.exe` başlatılınca yeni süreç açılmaz, mevcut pencere öne gelir.

- [ ] **Step 5: Release build ve RAM ölçümü**

```bash
npm run tauri build
```

Oluşan `src-tauri/target/release/vanity-watch.exe`'yi çalıştır, birkaç URL ekle, pencereyi kapat, 1 dk bekle, sonra PowerShell'de:

```powershell
Get-Process vanity-watch, msedgewebview2 -ErrorAction SilentlyContinue | Select-Object Name, Id, @{n='MB';e={[math]::Round($_.WorkingSet64/1MB,1)}}, CPU
```

Expected: `vanity-watch` ≤ 25 MB; uygulamaya ait `msedgewebview2` süreci kalmamış olmalı (başka uygulamaların WebView2 süreçleri olabilir, ana süreç ID'sine göre ayır). Pencere açıkken ve kapalıyken değerleri kaydet, kullanıcıya raporla.

- [ ] **Step 6: Bulunan hataları düzelt ve commit**

```bash
git add -A
git commit -m "fix: issues found during manual verification"
```

---

### Task 13: Açık kaynak dosyaları ve CI

**Files:**
- Create: `README.md`, `LICENSE`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`

- [ ] **Step 1: `LICENSE`**

```
MIT License

Copyright (c) 2026 Mavrom

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: `README.md`**

```markdown
# Vanity Watch

Discord vanity URL'lerini (`discord.gg/xyz`) takip eden küçük, açık kaynak bir masaüstü uygulaması.
Bir URL boşa düştüğünde anında Windows bildirimi alırsın. Pencereyi kapatınca tepside çok az kaynakla çalışmaya devam eder.

*A tiny open-source desktop app that watches Discord vanity URLs and notifies you when one is released. English summary below.*

## Ne yapar?

- İstediğin vanity URL'leri ekle, her birinin durumunu gör:
  - 🟢 **Kullanımda**: sunucu adı, ikonu, üye sayısı
  - 🟡 **Boşta görünüyor**: hiçbir sunucu kullanmıyor (alınabilir olması garanti değil)
  - 🟠 **Boşaldı · sunucu var**: önceki sunucu URL'yi bırakmış
  - 🔴 **Boşaldı · sunucu kapalı**: önceki sunucu silinmiş/kapatılmış, URL bir süre kilitli kalabilir
  - 🔒 **Engelli**: topluluk listesinde ya da senin "alınamıyor" işaretinde
- 10–60 saniyede bir otomatik kontrol, tek tek veya toplu yenileme
- Durum değişince Windows bildirimi, URL bazında sessize alma
- Durum geçmişi ve not alanı
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
npm run tauri dev      # geliştirme
npm test               # arayüz testleri
cd src-tauri && cargo test   # backend testleri
npm run tauri build    # release build
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

MIT. İkonlar [Lucide](https://lucide.dev) (ISC) yollarından uyarlanmıştır.
```

- [ ] **Step 3: `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy
      - uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - run: npm ci
      - run: npm test
      - run: npm run build
      - name: Clippy
        working-directory: src-tauri
        run: cargo clippy --all-targets -- -D warnings
      - name: Rust tests (includes known-blocked.json validation)
        working-directory: src-tauri
        run: cargo test
```

- [ ] **Step 4: `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags: ["v*"]

permissions:
  contents: write

jobs:
  release:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: dtolnay/rust-toolchain@stable
      - uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - run: npm ci
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: Vanity Watch ${{ github.ref_name }}
          releaseBody: "Kurulum için aşağıdaki .msi veya -setup.exe dosyasını indir."
          releaseDraft: true
          prerelease: false
```

- [ ] **Step 5: Clippy'yi lokal çalıştır**

```bash
cd src-tauri && cargo clippy --all-targets -- -D warnings
```

Expected: uyarı yok (varsa düzelt).

- [ ] **Step 6: Commit**

```bash
git add README.md LICENSE .github
git commit -m "docs: add README, license and CI/release workflows"
```
