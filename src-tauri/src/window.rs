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
