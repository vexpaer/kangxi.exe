use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Local-only Windows Bridge configuration.
/// Directory authorizations live strictly on the execution host and cannot be added remotely.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeConfig {
    pub server_url: String,
    pub bridge_token: String,
    pub bridge_id: Option<String>,
    pub bridge_name: String,
    pub hostname: String,
    /// Map of KangXi `project_id` -> locally authorized workspace directory on this machine.
    pub authorized_projects: HashMap<String, PathBuf>,
    /// Persisted event cursor for offline catch-up via GET /api/v1/events?after=cursor
    #[serde(default)]
    pub last_sequence: u64,
    /// Local mapping of KangXi session_id -> Provider native session/thread ID
    #[serde(default)]
    pub session_bindings: HashMap<String, SessionBinding>,
    /// Optional custom executable paths
    #[serde(default)]
    pub codex_bin: Option<String>,
    #[serde(default)]
    pub claude_bin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionBinding {
    pub provider: String,
    pub project_id: String,
    pub provider_session_id: Option<String>,
    pub task_id: Option<String>,
}

impl BridgeConfig {
    pub fn load(path: &Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("Failed to read bridge config at {}", path.display()))?;
        let cfg: Self = serde_json::from_str(&raw)
            .with_context(|| format!("Invalid bridge config JSON at {}", path.display()))?;
        Ok(cfg)
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let body = serde_json::to_string_pretty(self)?;
        std::fs::write(path, body)?;
        Ok(())
    }

    /// Strict authorization check: ensures the project is explicitly bound to an existing local directory.
    pub fn resolve_authorized_cwd(&self, project_id: &str) -> Result<PathBuf> {
        let dir = self
            .authorized_projects
            .get(project_id)
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Project '{}' is not authorized on this local Bridge host",
                    project_id
                )
            })?;

        let canonical = dir.canonicalize().with_context(|| {
            format!(
                "Authorized project directory '{}' does not exist or cannot be accessed",
                dir.display()
            )
        })?;

        if !canonical.is_dir() {
            anyhow::bail!(
                "Authorized project path '{}' is not a directory",
                canonical.display()
            );
        }
        Ok(canonical)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unauthorized_project_id() {
        let cfg = BridgeConfig {
            server_url: "https://example.workers.dev".into(),
            bridge_token: "kx_brg_test".into(),
            bridge_id: None,
            bridge_name: "TestHost".into(),
            hostname: "WIN-DEV".into(),
            authorized_projects: HashMap::new(),
            last_sequence: 0,
            session_bindings: HashMap::new(),
            codex_bin: None,
            claude_bin: None,
        };
        assert!(cfg.resolve_authorized_cwd("prj_unauthorized").is_err());
    }

    #[test]
    fn resolves_authorized_existing_directory() {
        let dir = tempfile::tempdir().unwrap();
        let mut projects = HashMap::new();
        projects.insert("prj_1".into(), dir.path().to_path_buf());
        let cfg = BridgeConfig {
            server_url: "https://example.workers.dev".into(),
            bridge_token: "kx_brg_test".into(),
            bridge_id: None,
            bridge_name: "TestHost".into(),
            hostname: "WIN-DEV".into(),
            authorized_projects: projects,
            last_sequence: 0,
            session_bindings: HashMap::new(),
            codex_bin: None,
            claude_bin: None,
        };
        assert!(cfg.resolve_authorized_cwd("prj_1").is_ok());
    }
}
