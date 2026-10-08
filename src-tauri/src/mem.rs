//! Keeps the tray-only process small. While the window is closed nothing needs the
//! pages the webview and the UI code touched, so we hand them back to Windows; they
//! are faulted in again on demand. This lowers the resident ("Working Set") size that
//! Task Manager shows; the private memory the app really owns is small either way.

use tauri::{AppHandle, Manager};

/// True while no UI window exists, i.e. the app is running from the tray only.
pub fn is_tray_only(app: &AppHandle) -> bool {
    app.get_webview_window(crate::window::MAIN_WINDOW).is_none()
        && app.get_webview_window(crate::notifier::LABEL).is_none()
}

#[cfg(windows)]
pub fn trim() {
    use windows_sys::Win32::System::ProcessStatus::K32EmptyWorkingSet;
    use windows_sys::Win32::System::Threading::GetCurrentProcess;
    unsafe {
        K32EmptyWorkingSet(GetCurrentProcess());
    }
}

#[cfg(not(windows))]
pub fn trim() {}

/// Trims shortly after a webview was torn down (its memory is released asynchronously).
pub fn trim_soon(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        if is_tray_only(&app) {
            trim();
        }
    });
}
