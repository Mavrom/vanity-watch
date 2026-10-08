mod store;
mod notify;
mod status;
mod discord;
mod blocked;
mod model;
mod parse;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Vanity Watch");
}
