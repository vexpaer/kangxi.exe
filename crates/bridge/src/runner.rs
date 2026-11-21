use crate::client::{
    BackendClient, BridgeRegisterBody, BridgeTaskUpdateBody, DeliveryAckBody, SyncEvent,
};
use crate::config::{BridgeConfig, SessionBinding};
use crate::providers::claude::ClaudeCodeAdapter;
use crate::providers::codex::CodexAdapter;
use crate::providers::{
    ProviderAdapter, ProviderCapabilityReport, ProviderRunRequest, ProviderStreamEvent,
};
use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, watch, Mutex};
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info, warn};

pub struct BridgeRunner {
    config: Arc<Mutex<BridgeConfig>>,
    config_path: Option<PathBuf>,
    client: BackendClient,
    providers: HashMap<String, Arc<dyn ProviderAdapter>>,
    processed_events: Arc<Mutex<HashSet<String>>>,
    active_cancels: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
}

impl BridgeRunner {
    pub fn new(config: BridgeConfig, config_path: Option<PathBuf>) -> Self {
        let client = BackendClient::new(config.server_url.clone(), config.bridge_token.clone());
        let mut providers: HashMap<String, Arc<dyn ProviderAdapter>> = HashMap::new();
        providers.insert(
            "codex".into(),
            Arc::new(CodexAdapter::new(config.codex_bin.clone())),
        );
        providers.insert(
            "claude_code".into(),
            Arc::new(ClaudeCodeAdapter::new(config.claude_bin.clone())),
        );

        Self {
            config: Arc::new(Mutex::new(config)),
            config_path,
            client,
            providers,
            processed_events: Arc::new(Mutex::new(HashSet::new())),
            active_cancels: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn probe_providers(&self) -> Vec<ProviderCapabilityReport> {
        let mut reports = Vec::new();
        for adapter in self.providers.values() {
            reports.push(adapter.probe().await);
        }
        reports
    }

    async fn persist_config(&self) {
        if let Some(ref path) = self.config_path {
            let cfg = self.config.lock().await;
            if let Err(err) = cfg.save(path) {
                warn!("Failed to persist bridge config: {err}");
            }
        }
    }

    /// Runs the outbound Bridge supervisor until `shutdown_rx` receives `true`.
    pub async fn run_until_shutdown(self: Arc<Self>, mut shutdown_rx: watch::Receiver<bool>) -> Result<()> {
        let reports = self.probe_providers().await;
        let reg_body = {
            let cfg = self.config.lock().await;
            BridgeRegisterBody {
                bridge_id: cfg.bridge_id.clone(),
                name: cfg.bridge_name.clone(),
                hostname: cfg.hostname.clone(),
                platform: std::env::consts::OS.to_string(),
                bridge_version: env!("CARGO_PKG_VERSION").to_string(),
                providers: reports,
                authorized_project_ids: cfg.authorized_projects.keys().cloned().collect(),
            }
        };

        let bridge = self.client.register(&reg_body).await?;
        let bridge_id = bridge.id.clone();
        info!("Registered Windows Bridge '{}' (id={})", bridge.name, bridge_id);
        {
            let mut cfg = self.config.lock().await;
            cfg.bridge_id = Some(bridge_id.clone());
        }
        self.persist_config().await;

        // Spawn periodic heartbeat loop (every 30s)
        let hb_client = self.client.clone();
        let hb_id = bridge_id.clone();
        let mut hb_shutdown = shutdown_rx.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
            loop {
                tokio::select! {
                    _ = hb_shutdown.changed() => {
                        if *hb_shutdown.borrow() { break; }
                    }
                    _ = interval.tick() => {
                        if let Err(err) = hb_client.heartbeat(&hb_id).await {
                            warn!("Bridge heartbeat failed: {err}");
                        }
                    }
                }
            }
        });

        let mut backoff_secs = 2u64;
        loop {
            if *shutdown_rx.borrow() {
                info!("Bridge shutdown signal received");
                break;
            }

            // 1. Always catch up missed events from durable cursor before streaming live WS
            if let Err(err) = self.catch_up_events().await {
                warn!("Event cursor catch-up failed: {err}");
            }

            // 2. Connect outbound WebSocket
            let ws_url = self.client.ws_url();
            match tokio_tungstenite::connect_async(&ws_url).await {
                Ok((ws_stream, _)) => {
                    info!("Connected outbound WebSocket to backend SyncHub");
                    backoff_secs = 2;
                    let (mut write, mut read) = ws_stream.split();
                    let mut ping_interval = tokio::time::interval(std::time::Duration::from_secs(25));

                    loop {
                        tokio::select! {
                            _ = shutdown_rx.changed() => {
                                if *shutdown_rx.borrow() {
                                    let _ = write.close().await;
                                    return Ok(());
                                }
                            }
                            _ = ping_interval.tick() => {
                                if write.send(Message::Text("ping".into())).await.is_err() {
                                    break;
                                }
                            }
                            frame = read.next() => {
                                match frame {
                                    Some(Ok(Message::Text(text))) => {
                                        if text == "pong" { continue; }
                                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                                            if let Some(ev_val) = val.get("event") {
                                                if let Ok(ev) = serde_json::from_value::<SyncEvent>(ev_val.clone()) {
                                                    self.handle_event(ev).await;
                                                }
                                            }
                                        }
                                    }
                                    Some(Ok(Message::Close(_))) | None => {
                                        warn!("WebSocket disconnected; will reconnect with cursor catch-up");
                                        break;
                                    }
                                    Some(Err(err)) => {
                                        warn!("WebSocket error: {err}");
                                        break;
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                }
                Err(err) => {
                    warn!("WebSocket connect failed ({err}); retrying in {backoff_secs}s");
                }
            }

            tokio::select! {
                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() { break; }
                }
                _ = tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)) => {}
            }
            backoff_secs = (backoff_secs * 2).min(30);
        }

        Ok(())
    }

    pub async fn catch_up_events(self: &Arc<Self>) -> Result<()> {
        let cursor = self.config.lock().await.last_sequence;
        let res = self.client.fetch_events(cursor).await?;
        for ev in res.events {
            self.handle_event(ev).await;
        }
        Ok(())
    }

    async fn handle_event(self: &Arc<Self>, ev: SyncEvent) {
        // Deduplicate by event_id
        {
            let mut seen = self.processed_events.lock().await;
            if !seen.insert(ev.event_id.clone()) {
                return;
            }
        }

        // Advance cursor
        {
            let mut cfg = self.config.lock().await;
            if ev.sequence > cfg.last_sequence {
                cfg.last_sequence = ev.sequence;
            }
        }
        self.persist_config().await;

        match ev.event_type.as_str() {
            "task.created" => {
                let runner = Arc::clone(self);
                tokio::spawn(async move {
                    if let Err(err) = runner.process_task_created(ev).await {
                        error!("Failed processing task.created: {err}");
                    }
                });
            }
            "task.message.created" => {
                if ev.payload.get("kind").and_then(|v| v.as_str()) == Some("user_followup") {
                    let runner = Arc::clone(self);
                    tokio::spawn(async move {
                        if let Err(err) = runner.process_task_followup(ev).await {
                            error!("Failed processing task.message.created: {err}");
                        }
                    });
                }
            }
            "decision.created" => {
                let runner = Arc::clone(self);
                tokio::spawn(async move {
                    if let Err(err) = runner.process_decision_created(ev).await {
                        error!("Failed processing decision.created: {err}");
                    }
                });
            }
            "task.cancelled" => {
                let task_id = ev.entity_id.clone();
                if let Some(tx) = self.active_cancels.lock().await.remove(&task_id) {
                    let _ = tx.send(());
                    info!("Cancelled active local provider process for task {}", task_id);
                }
            }
            _ => {}
        }
    }

    async fn process_task_created(&self, ev: SyncEvent) -> Result<()> {
        let task_id = ev.entity_id.clone();
        let project_id = ev
            .payload
            .get("project_id")
            .and_then(|v| v.as_str())
            .or(ev.project_id.as_deref())
            .unwrap_or("")
            .to_string();
        let session_id = ev
            .payload
            .get("session_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let provider_name = ev
            .payload
            .get("provider")
            .and_then(|v| v.as_str())
            .unwrap_or("codex")
            .to_string();
        let prompt = ev
            .payload
            .get("prompt")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // Only handle projects explicitly authorized on THIS host
        let cwd = match self.config.lock().await.resolve_authorized_cwd(&project_id) {
            Ok(p) => p,
            Err(_) => return Ok(()), // Belongs to another host or unauthorized
        };

        let Some(adapter) = self.providers.get(&provider_name).cloned() else {
            return Ok(());
        };

        // Acknowledge receipt
        self.client
            .ack_delivery(&DeliveryAckBody {
                entity_type: "task".into(),
                entity_id: task_id.clone(),
                delivery_status: "acknowledged".into(),
                resume_status: Some("resuming".into()),
                provider_session_id: None,
                error_message: None,
            })
            .await?;

        self.client
            .update_task(
                &task_id,
                &BridgeTaskUpdateBody {
                    status: Some("running".into()),
                    delivery_status: Some("acknowledged".into()),
                    resume_status: Some("resumed".into()),
                    ..Default::default()
                },
            )
            .await?;

        if let Some(ref sid) = session_id {
            let mut cfg = self.config.lock().await;
            cfg.session_bindings.insert(
                sid.clone(),
                SessionBinding {
                    provider: provider_name.clone(),
                    project_id: project_id.clone(),
                    provider_session_id: None,
                    task_id: Some(task_id.clone()),
                },
            );
        }
        self.persist_config().await;

        self.execute_provider(adapter, task_id, session_id, cwd, prompt, None)
            .await
    }

    async fn process_task_followup(&self, ev: SyncEvent) -> Result<()> {
        let task_id = ev.entity_id.clone();
        let content = ev
            .payload
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if content.is_empty() {
            return Ok(());
        }

        let binding_entry = {
            let cfg = self.config.lock().await;
            cfg.session_bindings
                .iter()
                .find(|(_, b)| b.task_id.as_deref() == Some(task_id.as_str()))
                .map(|(k, v)| (k.clone(), v.clone()))
        };

        let Some((session_id, binding)) = binding_entry else {
            return Ok(());
        };
        let cwd = self
            .config
            .lock()
            .await
            .resolve_authorized_cwd(&binding.project_id)?;
        let Some(adapter) = self.providers.get(&binding.provider).cloned() else {
            return Ok(());
        };

        self.client
            .update_task(
                &task_id,
                &BridgeTaskUpdateBody {
                    status: Some("running".into()),
                    delivery_status: Some("acknowledged".into()),
                    resume_status: Some("resuming".into()),
                    ..Default::default()
                },
            )
            .await?;

        self.execute_provider(
            adapter,
            task_id,
            Some(session_id),
            cwd,
            content,
            binding.provider_session_id,
        )
        .await
    }

    async fn process_decision_created(&self, ev: SyncEvent) -> Result<()> {
        let memorial_id = ev.entity_id.clone();
        let session_id = match ev.payload.get("session_id").and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => return Ok(()), // MCP-only memorial; agent polls get_memorial_reply
        };

        let binding = {
            let cfg = self.config.lock().await;
            cfg.session_bindings.get(&session_id).cloned()
        };

        let Some(binding) = binding else {
            return Ok(());
        };

        let cwd = match self
            .config
            .lock()
            .await
            .resolve_authorized_cwd(&binding.project_id)
        {
            Ok(p) => p,
            Err(err) => {
                let _ = self
                    .client
                    .ack_delivery(&DeliveryAckBody {
                        entity_type: "decision".into(),
                        entity_id: memorial_id,
                        delivery_status: "failed".into(),
                        resume_status: Some("resume_failed".into()),
                        provider_session_id: None,
                        error_message: Some(err.to_string()),
                    })
                    .await;
                return Ok(());
            }
        };

        // 1. Report Bridge claimed the decision
        self.client
            .ack_delivery(&DeliveryAckBody {
                entity_type: "decision".into(),
                entity_id: memorial_id.clone(),
                delivery_status: "acknowledged".into(),
                resume_status: Some("resuming".into()),
                provider_session_id: binding.provider_session_id.clone(),
                error_message: None,
            })
            .await?;

        let Some(adapter) = self.providers.get(&binding.provider).cloned() else {
            let _ = self
                .client
                .ack_delivery(&DeliveryAckBody {
                    entity_type: "decision".into(),
                    entity_id: memorial_id,
                    delivery_status: "acknowledged".into(),
                    resume_status: Some("not_supported".into()),
                    provider_session_id: None,
                    error_message: Some(format!("Unknown provider '{}'", binding.provider)),
                })
                .await;
            return Ok(());
        };

        let action = ev
            .payload
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("reply");
        let comment = ev
            .payload
            .get("comment")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let instructions = ev
            .payload
            .get("instructions")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let resume_prompt = format!(
            "Human operator decision on memorial {memorial_id}: [{action}]\nComment: {comment}\nInstructions: {instructions}\nPlease proceed accordingly."
        );

        let task_id = binding
            .task_id
            .clone()
            .unwrap_or_else(|| format!("resumed_{memorial_id}"));

        // Mark resumed before streaming output
        self.client
            .ack_delivery(&DeliveryAckBody {
                entity_type: "decision".into(),
                entity_id: memorial_id,
                delivery_status: "acknowledged".into(),
                resume_status: Some("resumed".into()),
                provider_session_id: binding.provider_session_id.clone(),
                error_message: None,
            })
            .await?;

        self.execute_provider(
            adapter,
            task_id,
            Some(session_id),
            cwd,
            resume_prompt,
            binding.provider_session_id,
        )
        .await
    }

    async fn execute_provider(
        &self,
        adapter: Arc<dyn ProviderAdapter>,
        task_id: String,
        session_id: Option<String>,
        cwd: PathBuf,
        prompt: String,
        provider_session_id: Option<String>,
    ) -> Result<()> {
        let (tx, mut rx) = mpsc::channel::<ProviderStreamEvent>(64);
        let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
        self.active_cancels
            .lock()
            .await
            .insert(task_id.clone(), cancel_tx);

        let run_req = ProviderRunRequest {
            cwd,
            prompt,
            provider_session_id,
        };
        let adapter_clone = Arc::clone(&adapter);
        tokio::spawn(async move {
            if let Err(err) = adapter_clone.run(run_req, tx.clone(), cancel_rx).await {
                let _ = tx.send(ProviderStreamEvent::Failed(err.to_string())).await;
            }
        });

        while let Some(ev) = rx.recv().await {
            match ev {
                ProviderStreamEvent::SessionStarted(pid) => {
                    if let Some(ref sid) = session_id {
                        let mut cfg = self.config.lock().await;
                        if let Some(binding) = cfg.session_bindings.get_mut(sid) {
                            binding.provider_session_id = Some(pid.clone());
                        }
                    }
                    self.persist_config().await;
                    let _ = self
                        .client
                        .update_task(
                            &task_id,
                            &BridgeTaskUpdateBody {
                                provider_session_id: Some(pid),
                                ..Default::default()
                            },
                        )
                        .await;
                }
                ProviderStreamEvent::OutputChunk(chunk) => {
                    let _ = self
                        .client
                        .update_task(
                            &task_id,
                            &BridgeTaskUpdateBody {
                                log_chunk: Some(chunk),
                                message_kind: Some("agent_log".into()),
                                ..Default::default()
                            },
                        )
                        .await;
                }
                ProviderStreamEvent::Completed {
                    summary,
                    provider_session_id,
                } => {
                    if let (Some(ref sid), Some(ref pid)) = (&session_id, &provider_session_id) {
                        let mut cfg = self.config.lock().await;
                        if let Some(binding) = cfg.session_bindings.get_mut(sid) {
                            binding.provider_session_id = Some(pid.clone());
                        }
                    }
                    self.persist_config().await;
                    let _ = self
                        .client
                        .update_task(
                            &task_id,
                            &BridgeTaskUpdateBody {
                                status: Some("completed".into()),
                                resume_status: Some("resumed".into()),
                                provider_session_id,
                                summary: Some(summary.chars().take(500).collect()),
                                log_chunk: Some(summary),
                                message_kind: Some("task_result".into()),
                                ..Default::default()
                            },
                        )
                        .await;
                }
                ProviderStreamEvent::Failed(err) => {
                    let _ = self
                        .client
                        .update_task(
                            &task_id,
                            &BridgeTaskUpdateBody {
                                status: Some("failed".into()),
                                resume_status: Some("resume_failed".into()),
                                error_message: Some(err.clone()),
                                log_chunk: Some(format!("Execution failed: {err}")),
                                message_kind: Some("system".into()),
                                ..Default::default()
                            },
                        )
                        .await;
                }
            }
        }

        self.active_cancels.lock().await.remove(&task_id);
        Ok(())
    }
}
