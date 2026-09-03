mod error;
mod filesystem;
mod security;
mod storage;
mod watcher;

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, RwLock,
    },
};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State,
};

#[derive(Default)]
struct CompanionState {
    enabled: AtomicBool,
    allow_close: AtomicBool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfiguredRoots {
    logs_root: Option<String>,
    screenshots_root: Option<String>,
}

#[derive(Default)]
struct NativeState {
    storage: Mutex<Option<storage::Storage>>,
    roots: RwLock<ConfiguredRoots>,
    watcher: Mutex<Option<watcher::WatchSession>>,
}

impl NativeState {
    fn initialize(&self, app_data_dir: PathBuf) -> Result<(), String> {
        let storage = storage::Storage::new(app_data_dir).map_err(String::from)?;
        let config = storage.load_config().map_err(String::from)?;
        *self
            .roots
            .write()
            .map_err(|_| "Native state lock poisoned".to_string())? = ConfiguredRoots {
            logs_root: config.logs_root,
            screenshots_root: config.screenshots_root,
        };
        *self
            .storage
            .lock()
            .map_err(|_| "Native state lock poisoned".to_string())? = Some(storage);
        Ok(())
    }

    fn with_storage<T>(
        &self,
        operation: impl FnOnce(&storage::Storage) -> Result<T, error::NativeError>,
    ) -> Result<T, String> {
        let guard = self
            .storage
            .lock()
            .map_err(|_| "Native state lock poisoned".to_string())?;
        guard
            .as_ref()
            .ok_or_else(|| "Native storage has not been initialized.".to_string())
            .and_then(|storage| operation(storage).map_err(String::from))
    }

    fn roots(&self) -> Result<ConfiguredRoots, String> {
        self.roots
            .read()
            .map(|roots| roots.clone())
            .map_err(|_| "Native state lock poisoned".to_string())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompanionStatus {
    state: &'static str,
    detail: &'static str,
    last_sync_at: Option<&'static str>,
    pending_count: u32,
}

#[tauri::command]
fn get_companion_status(state: State<'_, CompanionState>) -> CompanionStatus {
    let enabled = state.enabled.load(Ordering::Relaxed);
    CompanionStatus {
        state: if enabled { "connecting" } else { "offline" },
        detail: if enabled {
            "Waiting for sync engine"
        } else {
            "Sync engine is not connected"
        },
        last_sync_at: None,
        pending_count: 0,
    }
}

#[tauri::command]
fn set_companion_enabled(enabled: bool, state: State<'_, CompanionState>) {
    state.enabled.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn quit_companion(app: AppHandle, state: State<'_, CompanionState>) {
    state.allow_close.store(true, Ordering::Relaxed);
    app.exit(0);
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RootConfigInput {
    logs_root: Option<String>,
    screenshots_root: Option<String>,
}

#[tauri::command]
fn select_eft_directory() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Choose an EFT folder")
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_eft_roots(state: State<'_, NativeState>) -> Result<ConfiguredRoots, String> {
    state.roots()
}

#[tauri::command]
fn configure_eft_roots(
    input: RootConfigInput,
    state: State<'_, NativeState>,
) -> Result<ConfiguredRoots, String> {
    let logs = input
        .logs_root
        .map(filesystem::canonical_root)
        .transpose()
        .map_err(String::from)?;
    let screenshots = input
        .screenshots_root
        .map(filesystem::canonical_root)
        .transpose()
        .map_err(String::from)?;
    let config = storage::CompanionConfig {
        version: storage::STATE_VERSION,
        logs_root: logs
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned()),
        screenshots_root: screenshots
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned()),
    };
    state.with_storage(|storage| storage.save_config(config))?;
    let roots = ConfiguredRoots {
        logs_root: logs.map(|path| path.to_string_lossy().into_owned()),
        screenshots_root: screenshots.map(|path| path.to_string_lossy().into_owned()),
    };
    *state
        .roots
        .write()
        .map_err(|_| "Native state lock poisoned".to_string())? = roots.clone();
    if let Some(session) = state
        .watcher
        .lock()
        .map_err(|_| "Native state lock poisoned".to_string())?
        .take()
    {
        session.stop();
    }
    Ok(roots)
}

#[tauri::command]
fn enumerate_eft_logs(state: State<'_, NativeState>) -> Result<filesystem::ScanResult, String> {
    let roots = state.roots()?;
    roots
        .logs_root
        .ok_or_else(|| error::NativeError::NotConfigured.to_string())
        .and_then(|root| filesystem::enumerate_logs(root).map_err(String::from))
}

#[tauri::command]
fn enumerate_eft_screenshots(
    state: State<'_, NativeState>,
) -> Result<Vec<filesystem::FileMetadata>, String> {
    let roots = state.roots()?;
    roots
        .screenshots_root
        .ok_or_else(|| error::NativeError::NotConfigured.to_string())
        .and_then(|root| filesystem::enumerate_screenshots(root).map_err(String::from))
}

#[tauri::command]
fn read_eft_log(
    path: String,
    offset: u64,
    state: State<'_, NativeState>,
) -> Result<filesystem::LogRead, String> {
    let roots = state.roots()?;
    roots
        .logs_root
        .ok_or_else(|| error::NativeError::NotConfigured.to_string())
        .and_then(|root| filesystem::read_log_at_offset(root, path, offset).map_err(String::from))
}

#[tauri::command]
fn read_eft_logs(
    offsets: HashMap<String, u64>,
    state: State<'_, NativeState>,
) -> Result<Vec<filesystem::LogRead>, String> {
    let roots = state.roots()?;
    roots
        .logs_root
        .ok_or_else(|| error::NativeError::NotConfigured.to_string())
        .and_then(|root| filesystem::read_logs_at_offsets(root, &offsets).map_err(String::from))
}

#[tauri::command]
fn load_sync_checkpoints(state: State<'_, NativeState>) -> Result<serde_json::Value, String> {
    state.with_storage(storage::Storage::load_checkpoints)
}

#[tauri::command]
fn save_sync_checkpoints(
    checkpoints: serde_json::Value,
    state: State<'_, NativeState>,
) -> Result<(), String> {
    state.with_storage(|storage| storage.save_checkpoints(checkpoints))
}

#[tauri::command]
fn clear_local_state(state: State<'_, NativeState>) -> Result<(), String> {
    state.with_storage(storage::Storage::clear)?;
    if let Some(session) = state
        .watcher
        .lock()
        .map_err(|_| "Native state lock poisoned".to_string())?
        .take()
    {
        session.stop();
    }
    *state
        .roots
        .write()
        .map_err(|_| "Native state lock poisoned".to_string())? = ConfiguredRoots::default();
    Ok(())
}

#[tauri::command]
fn credential_get(account: String) -> Result<Option<String>, String> {
    security::get(&account).map_err(String::from)
}

#[tauri::command]
fn credential_set(account: String, secret: String) -> Result<(), String> {
    security::set(&account, &secret).map_err(String::from)
}

#[tauri::command]
fn credential_delete(account: String) -> Result<(), String> {
    security::delete(&account).map_err(String::from)
}

#[tauri::command]
fn start_native_watch(app: AppHandle, state: State<'_, NativeState>) -> Result<(), String> {
    let roots = state.roots()?;
    let session = watcher::start(
        app,
        roots.logs_root.map(PathBuf::from),
        roots.screenshots_root.map(PathBuf::from),
    )
    .map_err(String::from)?;
    let mut guard = state
        .watcher
        .lock()
        .map_err(|_| "Native state lock poisoned".to_string())?;
    if let Some(previous) = guard.take() {
        previous.stop();
    }
    *guard = Some(session);
    Ok(())
}

#[tauri::command]
fn stop_native_watch(state: State<'_, NativeState>) -> Result<(), String> {
    let mut guard = state
        .watcher
        .lock()
        .map_err(|_| "Native state lock poisoned".to_string())?;
    if let Some(session) = guard.take() {
        session.stop();
    }
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn run() {
    let launched_in_background = std::env::args().any(|arg| arg == "--background");

    tauri::Builder::default()
        .manage(CompanionState::default())
        .manage(NativeState::default())
        // The callback intentionally only brings the existing instance forward.
        // Deep-link and sync handling stay at the adapter boundary.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app)
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        // The updater endpoint and release public key are configured in tauri.conf.json.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let native_state = app.state::<NativeState>();
            native_state
                .initialize(
                    app.path()
                        .app_data_dir()
                        .map_err(|error| error.to_string())?,
                )
                .map_err(std::io::Error::other)?;
            let show = MenuItemBuilder::with_id("show", "Open companion").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

            TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Tarkov Squad Planner Companion")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "quit" => {
                        if let Some(state) = app.try_state::<CompanionState>() {
                            state.allow_close.store(true, Ordering::Relaxed);
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button, .. } = event {
                        if button == tauri::tray::MouseButton::Left {
                            show_main_window(tray.app_handle());
                        }
                    }
                })
                .build(app)?;

            if launched_in_background {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if let Some(state) = window.app_handle().try_state::<CompanionState>() {
                    if !state.allow_close.load(Ordering::Relaxed) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_companion_status,
            set_companion_enabled,
            quit_companion,
            select_eft_directory,
            get_eft_roots,
            configure_eft_roots,
            enumerate_eft_logs,
            enumerate_eft_screenshots,
            read_eft_log,
            read_eft_logs,
            load_sync_checkpoints,
            save_sync_checkpoints,
            clear_local_state,
            credential_get,
            credential_set,
            credential_delete,
            start_native_watch,
            stop_native_watch
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tarkov Squad Planner Companion");
}
