mod secure_store;

use secure_store::StoredCredentials;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio::sync::{watch, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformInfo {
    pub os: String,
    pub is_mobile: bool,
    pub bridge_supported: bool,
    pub app_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeRuntimeState {
    pub running: bool,
    pub keep_running_in_tray: bool,
    pub bridge_name: String,
    pub authorized_projects: HashMap<String, String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderProbeResult {
    pub provider: String,
    pub available: bool,
    pub version: Option<String>,
    pub supports_resume: bool,
    pub notes: Option<String>,
}

struct AppState {
    bridge_running: Mutex<bool>,
    keep_in_tray: Mutex<bool>,
    bridge_name: Mutex<String>,
    authorized_projects: Mutex<HashMap<String, String>>,
    last_error: Mutex<Option<String>>,
    shutdown_tx: Mutex<Option<watch::Sender<bool>>>,
}

impl Default for AppState {
    fn default() -> Self {
        let host = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "KangXi-Host".to_string());
        Self {
            bridge_running: Mutex::new(false),
            keep_in_tray: Mutex::new(false),
            bridge_name: Mutex::new(host),
            authorized_projects: Mutex::new(HashMap::new()),
            last_error: Mutex::new(None),
            shutdown_tx: Mutex::new(None),
        }
    }
}

#[tauri::command]
fn get_platform_info() -> PlatformInfo {
    let os = std::env::consts::OS.to_string();
    let is_mobile = cfg!(any(target_os = "android", target_os = "ios"));
    PlatformInfo {
        os,
        is_mobile,
        bridge_supported: !is_mobile,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[tauri::command]
fn save_secure_credentials(app: AppHandle, creds: StoredCredentials) -> Result<(), String> {
    secure_store::save_credentials(&app, &creds)
}

#[tauri::command]
fn load_secure_credentials(app: AppHandle) -> Result<Option<StoredCredentials>, String> {
    secure_store::load_credentials(&app)
}

#[tauri::command]
fn clear_secure_credentials(app: AppHandle) -> Result<(), String> {
    secure_store::clear_credentials(&app)
}

#[tauri::command]
async fn get_bridge_state(state: State<'_, Arc<AppState>>) -> Result<BridgeRuntimeState, String> {
    Ok(BridgeRuntimeState {
        running: *state.bridge_running.lock().await,
        keep_running_in_tray: *state.keep_in_tray.lock().await,
        bridge_name: state.bridge_name.lock().await.clone(),
        authorized_projects: state.authorized_projects.lock().await.clone(),
        last_error: state.last_error.lock().await.clone(),
    })
}

#[tauri::command]
async fn set_keep_bridge_in_tray(
    state: State<'_, Arc<AppState>>,
    enabled: bool,
) -> Result<bool, String> {
    *state.keep_in_tray.lock().await = enabled;
    Ok(enabled)
}

#[tauri::command]
async fn authorize_local_project(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    project_id: String,
    local_path: String,
) -> Result<HashMap<String, String>, String> {
    let path = std::path::PathBuf::from(&local_path);
    if !path.is_dir() {
        return Err(format!("Directory does not exist: {local_path}"));
    }
    let mut map = state.authorized_projects.lock().await;
    map.insert(project_id, local_path);
    let snapshot = map.clone();
    drop(map);

    if let Ok(dir) = app.path().app_local_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(
            dir.join("authorized_projects.json"),
            serde_json::to_string_pretty(&snapshot).unwrap_or_default(),
        );
    }
    Ok(snapshot)
}

#[tauri::command]
async fn remove_authorized_project(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<HashMap<String, String>, String> {
    let mut map = state.authorized_projects.lock().await;
    map.remove(&project_id);
    let snapshot = map.clone();
    drop(map);

    if let Ok(dir) = app.path().app_local_data_dir() {
        let _ = std::fs::write(
            dir.join("authorized_projects.json"),
            serde_json::to_string_pretty(&snapshot).unwrap_or_default(),
        );
    }
    Ok(snapshot)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
async fn probe_local_providers() -> Result<Vec<ProviderProbeResult>, String> {
    let dummy = kangxi_bridge::BridgeConfig {
        server_url: String::new(),
        bridge_token: String::new(),
        bridge_id: None,
        bridge_name: "probe".into(),
        hostname: "localhost".into(),
        authorized_projects: HashMap::new(),
        last_sequence: 0,
        session_bindings: HashMap::new(),
        codex_bin: None,
        claude_bin: None,
    };
    let runner = kangxi_bridge::BridgeRunner::new(dummy, None);
    let reports = runner.probe_providers().await;
    Ok(reports
        .into_iter()
        .map(|r| ProviderProbeResult {
            provider: r.provider,
            available: r.available,
            version: r.version,
            supports_resume: r.supports_resume,
            notes: r.notes,
        })
        .collect())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
async fn probe_local_providers() -> Result<Vec<ProviderProbeResult>, String> {
    Ok(vec![])
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
async fn start_local_bridge(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    server_url: String,
    bridge_token: String,
    bridge_name: Option<String>,
) -> Result<BridgeRuntimeState, String> {
    if *state.bridge_running.lock().await {
        return get_bridge_state(state).await;
    }

    let name = bridge_name.unwrap_or_else(|| {
        std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "KangXi-Workstation".into())
    });
    *state.bridge_name.lock().await = name.clone();
    *state.last_error.lock().await = None;

    let authorized: HashMap<String, std::path::PathBuf> = state
        .authorized_projects
        .lock()
        .await
        .iter()
        .map(|(k, v)| (k.clone(), std::path::PathBuf::from(v)))
        .collect();

    let cfg_path = app
        .path()
        .app_local_data_dir()
        .map(|d| d.join("bridge_runtime.json"))
        .ok();

    let existing = cfg_path
        .as_ref()
        .and_then(|p| kangxi_bridge::BridgeConfig::load(p).ok());

    let config = kangxi_bridge::BridgeConfig {
        server_url,
        bridge_token,
        bridge_id: existing.as_ref().and_then(|c| c.bridge_id.clone()),
        bridge_name: name.clone(),
        hostname: name,
        authorized_projects: authorized,
        last_sequence: existing.as_ref().map(|c| c.last_sequence).unwrap_or(0),
        session_bindings: existing
            .map(|c| c.session_bindings)
            .unwrap_or_default(),
        codex_bin: None,
        claude_bin: None,
    };

    let (tx, rx) = watch::channel(false);
    *state.shutdown_tx.lock().await = Some(tx);
    *state.bridge_running.lock().await = true;

    let runner = Arc::new(kangxi_bridge::BridgeRunner::new(config, cfg_path));
    let state_arc = Arc::clone(state.inner());

    tauri::async_runtime::spawn(async move {
        if let Err(err) = runner.run_until_shutdown(rx).await {
            *state_arc.last_error.lock().await = Some(err.to_string());
        }
        *state_arc.bridge_running.lock().await = false;
        *state_arc.shutdown_tx.lock().await = None;
    });

    get_bridge_state(state).await
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
async fn start_local_bridge(
    _app: AppHandle,
    _state: State<'_, Arc<AppState>>,
    _server_url: String,
    _bridge_token: String,
    _bridge_name: Option<String>,
) -> Result<BridgeRuntimeState, String> {
    Err("Local Agent Bridge is only supported on Windows/Desktop hosts.".into())
}

#[tauri::command]
async fn stop_local_bridge(state: State<'_, Arc<AppState>>) -> Result<BridgeRuntimeState, String> {
    if let Some(tx) = state.shutdown_tx.lock().await.take() {
        let _ = tx.send(true);
    }
    *state.bridge_running.lock().await = false;
    get_bridge_state(state).await
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn setup_desktop_tray(app: &AppHandle, state: Arc<AppState>) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let show_i = MenuItem::with_id(app, "show", "打开 KangXi.exe 御案", true, None::<&str>)?;
    let stop_bridge_i =
        MenuItem::with_id(app, "stop_bridge", "停止本地 Bridge", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "完全退出（停止 Bridge）", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show_i, &stop_bridge_i, &quit_i])?;

    let mut builder = TrayIconBuilder::with_id("kangxi-tray")
        .menu(&menu)
        .tooltip("KangXi.exe — 御批 Agent 工作台")
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "stop_bridge" => {
                let st = Arc::clone(&state);
                tauri::async_runtime::spawn(async move {
                    if let Some(tx) = st.shutdown_tx.lock().await.take() {
                        let _ = tx.send(true);
                    }
                    *st.bridge_running.lock().await = false;
                });
            }
            "quit" => {
                let st = Arc::clone(&state);
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(tx) = st.shutdown_tx.lock().await.take() {
                        let _ = tx.send(true);
                    }
                    *st.bridge_running.lock().await = false;
                    app_handle.exit(0);
                });
            }
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = Arc::new(AppState::default());

    let mut builder = tauri::Builder::default()
        .manage(Arc::clone(&app_state))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ));
    }

    let state_for_setup = Arc::clone(&app_state);
    let state_for_window = Arc::clone(&app_state);

    builder
        .setup(move |app| {
            // Hydrate previously authorized local project directories
            if let Ok(dir) = app.path().app_local_data_dir() {
                let auth_file = dir.join("authorized_projects.json");
                if let Ok(raw) = std::fs::read_to_string(auth_file) {
                    if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&raw) {
                        let st = Arc::clone(&state_for_setup);
                        tauri::async_runtime::spawn(async move {
                            *st.authorized_projects.lock().await = map;
                        });
                    }
                }
            }

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                setup_desktop_tray(app.handle(), Arc::clone(&state_for_setup))?;
            }

            Ok(())
        })
        .on_window_event(move |window, event| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let keep = state_for_window
                    .keep_in_tray
                    .try_lock()
                    .map(|g| *g)
                    .unwrap_or(false);
                let running = state_for_window
                    .bridge_running
                    .try_lock()
                    .map(|g| *g)
                    .unwrap_or(false);
                // SPEC Section 2: Only stay alive in tray if user explicitly opted in AND Bridge is running
                if keep && running {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    let st = Arc::clone(&state_for_window);
                    tauri::async_runtime::spawn(async move {
                        if let Some(tx) = st.shutdown_tx.lock().await.take() {
                            let _ = tx.send(true);
                        }
                    });
                }
            }
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                let _ = (window, event);
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_platform_info,
            save_secure_credentials,
            load_secure_credentials,
            clear_secure_credentials,
            get_bridge_state,
            set_keep_bridge_in_tray,
            authorize_local_project,
            remove_authorized_project,
            probe_local_providers,
            start_local_bridge,
            stop_local_bridge
        ])
        .run(tauri::generate_context!())
        .expect("error while running KangXi.exe");
}
