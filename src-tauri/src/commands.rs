use crate::model::{Settings, TrackedUrl};
use crate::monitor::{self, AppState, CycleState};
use crate::parse;
use crate::tray;
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
    cycle: CycleState,
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
        cycle: state.cycle.lock().unwrap().clone(),
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
pub fn remove_url(app: AppHandle, state: State<'_, AppState>, code: String) {
    state.store.lock().unwrap().data.urls.retain(|u| u.code != code);
    state.save();
    tray::refresh_tooltip(&app);
}

#[tauri::command]
pub fn dismiss_alert(app: AppHandle, state: State<'_, AppState>, code: String) -> Result<(), String> {
    with_url(&state, &code, |u| u.alert = false)?;
    tray::refresh_tooltip(&app);
    Ok(())
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
    let previous = state.store.lock().unwrap().data.settings.clone();
    if settings.autostart != previous.autostart {
        let autolaunch = app.autolaunch();
        let result = if settings.autostart { autolaunch.enable() } else { autolaunch.disable() };
        result.map_err(|e| format!("Windows ile başlat ayarlanamadı: {e}"))?;
    }
    state.store.lock().unwrap().data.settings = settings.clone();
    state.save();
    // Only schedule changes need the loop; notification toggles don't warrant a new cycle.
    if settings.auto_check != previous.auto_check || settings.interval_secs != previous.interval_secs {
        state.wake.notify_one();
    }
    Ok(settings)
}
