use super::{build_command, ProviderAdapter, ProviderCapabilityReport, ProviderRunRequest, ProviderStreamEvent};
use anyhow::Result;
use async_trait::async_trait;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, oneshot};

/// Real Claude Code CLI adapter (`claude -p --output-format stream-json --verbose` + `--resume <session_id>`).
/// Respects native Claude Code permissions (never injects `--dangerously-skip-permissions`).
pub struct ClaudeCodeAdapter {
    bin: String,
}

impl ClaudeCodeAdapter {
    pub fn new(bin: Option<String>) -> Self {
        Self {
            bin: bin.unwrap_or_else(|| "claude".to_string()),
        }
    }

    pub fn parse_ndjson_line(line: &str) -> Option<ProviderStreamEvent> {
        let val: serde_json::Value = serde_json::from_str(line).ok()?;
        let event_type = val.get("type")?.as_str()?;

        match event_type {
            "system" => {
                let sid = val.get("session_id")?.as_str()?.to_string();
                Some(ProviderStreamEvent::SessionStarted(sid))
            }
            "assistant" => {
                let contents = val
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_array())?;
                let mut text_parts = Vec::new();
                for block in contents {
                    if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                            text_parts.push(t);
                        }
                    }
                }
                if !text_parts.is_empty() {
                    Some(ProviderStreamEvent::OutputChunk(text_parts.join("\n")))
                } else {
                    None
                }
            }
            "result" => {
                let is_err = val
                    .get("is_error")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let result_text = val
                    .get("result")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Claude Code run finished")
                    .to_string();
                if is_err {
                    Some(ProviderStreamEvent::Failed(result_text))
                } else {
                    let sid = val
                        .get("session_id")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    Some(ProviderStreamEvent::Completed {
                        summary: result_text,
                        provider_session_id: sid,
                    })
                }
            }
            _ => None,
        }
    }
}

#[async_trait]
impl ProviderAdapter for ClaudeCodeAdapter {
    fn provider_id(&self) -> &'static str {
        "claude_code"
    }

    async fn probe(&self) -> ProviderCapabilityReport {
        let output = tokio::process::Command::new(&self.bin)
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await;

        match output {
            Ok(out) if out.status.success() => {
                let ver = String::from_utf8_lossy(&out.stdout).trim().to_string();
                ProviderCapabilityReport {
                    provider: "claude_code".into(),
                    available: true,
                    version: if ver.is_empty() { None } else { Some(ver) },
                    supports_resume: true,
                    notes: Some(
                        "Uses `claude -p --output-format stream-json --verbose` and `--resume <session_id>`. Local permission prompts remain enforced."
                            .into(),
                    ),
                }
            }
            _ => ProviderCapabilityReport {
                provider: "claude_code".into(),
                available: false,
                version: None,
                supports_resume: false,
                notes: Some(format!(
                    "`{}` binary not found on PATH. Install Claude Code CLI or configure path in Bridge settings.",
                    self.bin
                )),
            },
        }
    }

    async fn run(
        &self,
        req: ProviderRunRequest,
        tx: mpsc::Sender<ProviderStreamEvent>,
        mut cancel_rx: oneshot::Receiver<()>,
    ) -> Result<()> {
        let mut cmd = build_command(&self.bin, &req.cwd);
        cmd.args(["-p", "--output-format", "stream-json", "--verbose"]);
        if let Some(ref sid) = req.provider_session_id {
            cmd.args(["--resume", sid]);
        }
        cmd.arg(&req.prompt);

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn()?;
        let stdout = child.stdout.take().unwrap();
        let mut reader = BufReader::new(stdout).lines();

        let mut captured_session = req.provider_session_id.clone();
        let mut emitted_complete = false;

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
                            if let Some(ev) = Self::parse_ndjson_line(&line) {
                                match &ev {
                                    ProviderStreamEvent::SessionStarted(sid) => {
                                        captured_session = Some(sid.clone());
                                    }
                                    ProviderStreamEvent::Completed { .. } => {
                                        emitted_complete = true;
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
        if !emitted_complete {
            if status.success() {
                let _ = tx
                    .send(ProviderStreamEvent::Completed {
                        summary: "Claude Code execution completed.".into(),
                        provider_session_id: captured_session,
                    })
                    .await;
            } else {
                let _ = tx
                    .send(ProviderStreamEvent::Failed(format!(
                        "Claude Code exited with status {}",
                        status
                    )))
                    .await;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_claude_stream_json_events() {
        let init = ClaudeCodeAdapter::parse_ndjson_line(
            r#"{"type":"system","subtype":"init","session_id":"sess_abc123"}"#,
        );
        assert!(matches!(init, Some(ProviderStreamEvent::SessionStarted(id)) if id == "sess_abc123"));

        let res = ClaudeCodeAdapter::parse_ndjson_line(
            r#"{"type":"result","is_error":false,"result":"All checks pass","session_id":"sess_abc123"}"#,
        );
        assert!(matches!(res, Some(ProviderStreamEvent::Completed { summary, .. }) if summary == "All checks pass"));
    }
}
