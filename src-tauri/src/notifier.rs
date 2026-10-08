//! Our own notification popups: a small frameless, transparent, always-on-top
//! window in the bottom-right corner that renders `notifier.html`. The window only
//! exists while a popup is on screen, so the tray-only app stays light.

use crate::model::{GuildInfo, Status};
use crate::notify::NotifyKind;
use crate::window::open_main_window;
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;

pub const LABEL: &str = "notifier";
const WIDTH: f64 = 404.0;
const MARGIN: f64 = 12.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Popup {
    id: u64,
    /// "released" stays until dismissed; "taken" hides itself after a while.
    kind: &'static str,
    code: String,
    title: String,
    body: String,
    status: Status,
    guild: Option<GuildInfo>,
    at: DateTime<Utc>,
}

#[derive(Default)]
pub struct Notifier {
    popups: Mutex<Vec<Popup>>,
    next_id: AtomicU64,
}

pub fn push(
    app: &AppHandle,
    kind: NotifyKind,
    code: &str,
    (title, body): (String, String),
    status: Status,
    guild: Option<GuildInfo>,
) {
    let notifier = app.state::<Notifier>();
    let popup = Popup {
        id: notifier.next_id.fetch_add(1, Ordering::SeqCst),
        kind: match kind {
            NotifyKind::Released => "released",
            NotifyKind::Taken => "taken",
        },
        code: code.to_string(),
        title,
        body,
        status,
        guild,
        at: Utc::now(),
    };
    notifier.popups.lock().unwrap().push(popup.clone());
    play_sound();

    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.emit("popup", &popup);
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let built = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("notifier.html".into()))
            .title("Vanity Watch")
            .inner_size(WIDTH, 180.0)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .build();
        if let Err(e) = built {
            // Fall back to a plain system notification rather than staying silent.
            eprintln!("failed to open notifier window: {e}");
            let _ = app.notification().builder().title(&popup.title).body(&popup.body).show();
        }
    });
}

fn dismiss(app: &AppHandle, id: u64) {
    let notifier = app.state::<Notifier>();
    let empty = {
        let mut popups = notifier.popups.lock().unwrap();
        popups.retain(|p| p.id != id);
        popups.is_empty()
    };
    if empty {
        if let Some(window) = app.get_webview_window(LABEL) {
            let _ = window.destroy();
        }
    }
}

/// The popup window can also be closed from outside (Alt+F4); forget its popups
/// then, or they would reappear with the next notification.
pub fn on_window_destroyed(app: &AppHandle) {
    app.state::<Notifier>().popups.lock().unwrap().clear();
}

#[tauri::command]
pub fn notifier_popups(notifier: State<'_, Notifier>) -> Vec<Popup> {
    notifier.popups.lock().unwrap().clone()
}

/// Called by the popup page after rendering: fits the window to its content and
/// pins it to the bottom-right corner of the work area (above the taskbar).
#[tauri::command]
pub fn notifier_layout(app: AppHandle, height: f64) -> Result<(), String> {
    let window = app.get_webview_window(LABEL).ok_or("notifier window missing")?;
    let monitor = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())
        .ok_or("no monitor")?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    window
        .set_size(LogicalSize::new(WIDTH, height))
        .map_err(|e| e.to_string())?;
    let x = area.position.x + area.size.width as i32 - ((WIDTH + MARGIN) * scale) as i32;
    let y = area.position.y + area.size.height as i32 - ((height + MARGIN) * scale) as i32;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    if !window.is_visible().unwrap_or(false) {
        let _ = window.show();
    }
    Ok(())
}

#[tauri::command]
pub fn notifier_dismiss(app: AppHandle, id: u64) {
    dismiss(&app, id);
}

#[tauri::command]
pub fn notifier_open(app: AppHandle, id: u64) {
    open_main_window(&app);
    dismiss(&app, id);
}

/// The regular Windows notification chime, so popups are noticed like system toasts.
#[cfg(windows)]
fn play_sound() {
    use windows_sys::Win32::Media::Audio::{PlaySoundW, SND_ALIAS, SND_ASYNC, SND_NODEFAULT};
    let alias: Vec<u16> = "Notification.Default\0".encode_utf16().collect();
    unsafe {
        PlaySoundW(alias.as_ptr(), std::ptr::null_mut(), SND_ALIAS | SND_ASYNC | SND_NODEFAULT);
    }
}

#[cfg(not(windows))]
fn play_sound() {}
