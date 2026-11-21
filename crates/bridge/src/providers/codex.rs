use super::{build_command, ProviderAdapter, ProviderCapabilityReport, ProviderRunRequest, ProviderStreamEvent};
use anyhow::Result;
use async_trait::async_trait;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, oneshot};

/// Real Codex CLI adapter (`codex exec --json` & `codex exec resume <thread_id> --json`).
/// Uses `--sandbox workspace-write` (never bypasses sandbox remotely).
pub struct CodexAdapter {
    bin: String,
}

impl CodexAdapter {
    pub fn new(bin: Option<String>) -> Self {
        Self {
            bin: bin.unwrap_or_else(|| "codex".to_string()),
        }
    }

    pub fn parse_jsonl_line(line: &str) -> Option<ProviderStreamEvent> {
        let val: serde_json::Value = serde_json::from_str(line).ok()?;
        let event_type = val.get("type")?.as_str()?;
        match event_type {
            "thread.started" => {
                let tid = val.get("thread_id")?.as_str()?.to_string();
                Some(ProviderStreamEvent::SessionStarted(tid))
            }
            "item.completed" => {
                let item = val.get("item")?;
                let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if item_type == "agent_message" {
                    let text = item.get("text").and_then(|v| v.as_str()).unwrap_or("");
                    if !text.is_empty() {
                        return Some(ProviderStreamEvent::OutputChunk(text.to_string()));
                    }
                } else if item_type == "command_execution" {
                    let cmd = item.get("command").and_then(|v| v.as_str()).unwrap_or("");
                    let status = item.get("status").and_then(|v| v.as_str()).unwrap_or("");
                    return Some(ProviderStreamEvent::OutputChunk(format!(
                        "[cmd:{status}] `{cmd}`"
                    )));
                }
                None
            }
            "turn.failed" | "error" => {
                let msg = val
                    .get("message")
                    .or_else(|| val.get("error").and_then(|e| e.get("message")))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Codex turn failed");
                Some(ProviderStreamEvent::Failed(msg.to_string()))
            }
            _ => None,
        }
    }
}

#[async_trait]
impl ProviderAdapter for CodexAdapter {
    fn provider_id(&self) -> &'static str {
        "codex"
    }

    async fn probe(&self) -> ProviderCapabilityReport {
        let resolved = super::resolve_cli_binary(&self.bin);
        let output = build_command(&self.bin, None)
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await;

        match output {
            Ok(out) if out.status.success() => {
                let ver = String::from_utf8_lossy(&out.stdout).trim().to_string();
                ProviderCapabilityReport {
                    provider: "codex".into(),
                    available: true,
                    version: if ver.is_empty() { None } else { Some(ver) },
                    supports_resume: true,
                    notes: Some(
                        "Uses `codex exec --json --sandbox workspace-write` and `codex exec resume <thread_id>`."
                            .into(),
                    ),
                    resolved_path: Some(resolved),
                }
            }
            _ => ProviderCapabilityReport {
                provider: "codex".into(),
                available: false,
                version: None,
                supports_resume: false,
                notes: Some(format!(
                    "`{}` binary not found on PATH. Install OpenAI Codex CLI (`npm i -g @openai/codex`) and run `codex login`.",
                    self.bin
                )),
                resolved_path: None,
            },
        }
    }

    async fn run(
        &self,
        req: ProviderRunRequest,
        tx: mpsc::Sender<ProviderStreamEvent>,
        mut cancel_rx: oneshot::Receiver<()>,
    ) -> Result<()> {
        let mut cmd = build_command(&self.bin, Some(&req.cwd));
        if let Some(ref thread_id) = req.provider_session_id {
            cmd.args(["exec", "resume", thread_id, "--json", &req.prompt]);
        } else {
            cmd.args([
                "exec",
                "--json",
                "--sandbox",
                "workspace-write",
                &req.prompt,
            ]);
        }

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn()?;
        let stdout = child.stdout.take().unwrap();
        let mut reader = BufReader::new(stdout).lines();

        let mut captured_session = req.provider_session_id.clone();
        let mut last_message = String::new();

        loop {
            tokio::select! {
                _ = &mut cancel_rx => {
                    let _ = child.kill().await;
                    let _ = tx.send(ProviderStreamEvent::Failed("Cancelled by operator".into())).await;
                    return Ok(());
                }
                line_res = reader.next_line() => {
                    match line_res? {
                        Some(line) => {
                            if let Some(ev) = Self::parse_jsonl_line(&line) {
                                match &ev {
                                    ProviderStreamEvent::SessionStarted(tid) => {
                                        captured_session = Some(tid.clone());
                                    }
                                    ProviderStreamEvent::OutputChunk(chunk) => {
                                        last_message = chunk.clone();
                                    }
                                    _ => {}
                                }
                                let _ = tx.send(ev).await;
                            }
                        }
                        None => break,
                    }
                }
            }
        }

        let status = child.wait().await?;
        if status.success() {
            let summary = if last_message.is_empty() {
                "Codex execution completed.".to_string()
            } else {
                last_message
            };
            let _ = tx
                .send(ProviderStreamEvent::Completed {
                    summary,
                    provider_session_id: captured_session,
                })
                .await;
        } else {
            let _ = tx
                .send(ProviderStreamEvent::Failed(format!(
                    "Codex exited with status {}",
                    status
                )))
                .await;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_codex_jsonl_thread_and_message() {
        let started = CodexAdapter::parse_jsonl_line(
            r#"{"type":"thread.started","thread_id":"0199a213-81c0-7800-8aa1-bbab2a035a53"}"#,
        );
        assert!(matches!(started, Some(ProviderStreamEvent::SessionStarted(id)) if id == "0199a213-81c0-7800-8aa1-bbab2a035a53"));

        let msg = CodexAdapter::parse_jsonl_line(
            r#"{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"Done."}}"#,
        );
        assert!(matches!(msg, Some(ProviderStreamEvent::OutputChunk(t)) if t == "Done."));
    }
}
