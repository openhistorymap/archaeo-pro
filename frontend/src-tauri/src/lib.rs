//! archaeo·pro native shell.
//!
//! The whole UI is the Angular PWA loaded into a Tauri webview. Rust only
//! wires up the native plugins the field app needs:
//!   - opener     — open the GitHub OAuth page in the system browser
//!   - deep-link  — catch the `archaeopro://auth-callback?...` redirect back
//!   - geolocation— GPS for "locate me" on the map (no navigator.geolocation
//!                  exists inside the webview, so the JS side bridges to this)
//!
//! `run()` is shared by the desktop binary (`main.rs`) and the iOS/Android
//! entry point below.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_geolocation::init())
        .plugin(tauri_plugin_deep_link::init())
        .run(tauri::generate_context!())
        .expect("error while running archaeo·pro");
}
