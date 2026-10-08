mod blocked;
mod commands;
mod discord;
mod model;
mod monitor;
mod notifier;
mod notify;
mod parse;
mod status;
mod store;
mod tray;
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
            app.manage(notifier::Notifier::default());
            tray::create_tray(app.handle())?;
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
            commands::dismiss_alert,
            commands::refresh_url,
            commands::refresh_all,
            commands::set_note,
            commands::set_user_blocked,
            commands::set_muted,
            commands::update_settings,
            notifier::notifier_popups,
            notifier::notifier_layout,
            notifier::notifier_dismiss,
            notifier::notifier_open,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Vanity Watch")
        .run(|_app, event| {
            // Closing the window destroys the webview; keep running in the tray.
            // Only the tray's "Çık" (app.exit, which sets a code) really quits.
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = event {
                api.prevent_exit();
            }
        });
}
