use crate::blocked;
use crate::discord::{DiscordClient, InviteResult, API_BASE};
use crate::notify;
use crate::status;
use crate::store::Store;
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Notify;

/// Pause between two codes in one cycle, to stay far below Discord's rate limits.
const GAP_BETWEEN_CHECKS: Duration = Duration::from_secs(1);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CycleInfo {
    next_check_at: Option<DateTime<Utc>>,
}

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
            let _ = app.emit("cycle-started", ());
            run_cycle(&app).await;
        }
        // Lets the UI draw a countdown; `None` means auto-check is paused.
        let next_check_at = auto.then(|| Utc::now() + chrono::Duration::seconds(interval.into()));
        let _ = app.emit("cycle-finished", CycleInfo { next_check_at });
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
