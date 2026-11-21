pub mod claude;
pub mod codex;

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCapabilityReport {
    pub provider: String,
    pub available: bool,
    pub version: Option<String>,
    pub supports_resume: bool,
    pub notes: Option<String>,
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
    pub cwd: std::path::PathBuf,
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

pub fn build_command(bin: &str, cwd: &Path) -> tokio::process::Command {
    #[cfg(target_os = "windows")]
    {
        // Support .cmd / .ps1 npm shims cleanly on Windows without leaking shell injection
        let mut cmd = tokio::process::Command::new(bin);
        cmd.current_dir(cwd);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = tokio::process::Command::new(bin);
        cmd.current_dir(cwd);
        cmd
    }
}
