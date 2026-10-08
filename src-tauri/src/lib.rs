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
