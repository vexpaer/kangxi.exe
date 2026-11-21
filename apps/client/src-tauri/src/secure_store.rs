use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StoredCredentials {
    pub server_url: String,
    pub token: String,
    pub device_label: String,
    pub scope: String,
    #[serde(default)]
    pub bridge_token: Option<String>,
}

const VAULT_FILENAME: &str = "kangxi_credentials.vault.json";

#[cfg(target_os = "windows")]
const KEYRING_SERVICE: &str = "io.kangxi.workbench";
#[cfg(target_os = "windows")]
const KEYRING_USER: &str = "default_profile";

fn vault_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app_local_data_dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data dir: {e}"))?;
    Ok(dir.join(VAULT_FILENAME))
}

pub fn save_credentials(app: &AppHandle, creds: &StoredCredentials) -> Result<(), String> {
    let json = serde_json::to_string(creds).map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
            if entry.set_password(&json).is_ok() {
                return Ok(());
            }
        }
    }

    let path = vault_path(app)?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to persist credential vault: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

pub fn load_credentials(app: &AppHandle) -> Result<Option<StoredCredentials>, String> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
            if let Ok(secret) = entry.get_password() {
                if let Ok(parsed) = serde_json::from_str::<StoredCredentials>(&secret) {
                    return Ok(Some(parsed));
                }
            }
        }
    }

    let path = vault_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed: StoredCredentials = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(Some(parsed))
}

pub fn clear_credentials(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
            let _ = entry.delete_credential();
        }
    }

    let path = vault_path(app)?;
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}
