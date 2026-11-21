pub mod claude;
pub mod codex;

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCapabilityReport {
    pub provider: String,
    pub available: bool,
    pub version: Option<String>,
    pub supports_resume: bool,
    pub notes: Option<String>,
    #[serde(default)]
    pub resolved_path: Option<String>,
}

#[derive(Debug, Clone)]
pub enum ProviderStreamEvent {
    SessionStarted(String),
    OutputChunk(String),
    Completed {
        summary: String,
        provider_session_id: Option<String>,
    },
    Failed(String),
}

#[derive(Debug, Clone)]
pub struct ProviderRunRequest {
    pub cwd: PathBuf,
    pub prompt: String,
    pub provider_session_id: Option<String>,
}

#[async_trait]
pub trait ProviderAdapter: Send + Sync {
    fn provider_id(&self) -> &'static str;
    async fn probe(&self) -> ProviderCapabilityReport;
    async fn run(
        &self,
        req: ProviderRunRequest,
        tx: mpsc::Sender<ProviderStreamEvent>,
        cancel_rx: tokio::sync::oneshot::Receiver<()>,
    ) -> Result<()>;
}

/// Resolves a CLI binary across PATH and common Windows/Unix user install locations
/// (e.g. `%APPDATA%\npm\codex.cmd`, `%USERPROFILE%\.local\bin\claude.exe`, `~/.local/bin/claude`).
pub fn resolve_cli_binary(bin: &str) -> String {
    let candidate_path = Path::new(bin);
    if candidate_path.is_absolute() && candidate_path.exists() {
        return bin.to_string();
    }

    let mut search_dirs: Vec<PathBuf> = Vec::new();
    if let Ok(path_var) = std::env::var("PATH") {
        for p in std::env::split_paths(&path_var) {
            search_dirs.push(p);
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            search_dirs.push(PathBuf::from(&appdata).join("npm"));
        }
        if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
            search_dirs.push(PathBuf::from(&local_appdata).join("Programs"));
            search_dirs.push(PathBuf::from(&local_appdata).join("pnpm"));
        }
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let home = PathBuf::from(&profile);
            search_dirs.push(home.join(".local").join("bin"));
            search_dirs.push(home.join(".cargo").join("bin"));
            search_dirs.push(home.join(".bun").join("bin"));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(home) = std::env::var("HOME") {
            let h = PathBuf::from(home);
            search_dirs.push(h.join(".local").join("bin"));
            search_dirs.push(h.join(".npm-global").join("bin"));
            search_dirs.push(h.join(".cargo").join("bin"));
            search_dirs.push(h.join(".bun").join("bin"));
        }
    }

    #[cfg(target_os = "windows")]
    let exts = ["", ".exe", ".cmd", ".bat"];
    #[cfg(not(target_os = "windows"))]
    let exts = [""];

    for dir in search_dirs {
        for ext in exts {
            let name = if ext.is_empty() || bin.ends_with(ext) {
                bin.to_string()
            } else {
                format!("{bin}{ext}")
            };
            let full = dir.join(name);
            if full.is_file() {
                return full.to_string_lossy().to_string();
            }
        }
    }

    bin.to_string()
}

pub fn build_command(bin: &str, cwd: Option<&Path>) -> tokio::process::Command {
    let resolved = resolve_cli_binary(bin);
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let lower = resolved.to_ascii_lowercase();
        if lower.ends_with(".cmd") || lower.ends_with(".bat") {
            let mut c = tokio::process::Command::new("cmd");
            c.args(["/C", &resolved]);
            c
        } else {
            tokio::process::Command::new(&resolved)
        }
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = tokio::process::Command::new(&resolved);

    #[cfg(target_os = "windows")]
    {
        // Prevent flashing console windows when launched from GUI
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd
}
