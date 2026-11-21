#![cfg(not(any(target_os = "android", target_os = "ios")))]

use kangxi_bridge::discovery::{
    configure_codex_local_mcp, discover_local_environment, now_iso, DiscoveredProject,
    DiscoveredSession,
};
use kangxi_bridge::providers::claude::ClaudeCodeAdapter;
use kangxi_bridge::providers::codex::CodexAdapter;
use kangxi_bridge::providers::{
    build_command, ProviderAdapter, ProviderCapabilityReport, ProviderRunRequest,
    ProviderStreamEvent,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalWorkspaceData {
    pub local_mcp_token: String,
    pub projects: Vec<Value>,
    pub agents: Vec<Value>,
    pub tasks: Vec<Value>,
    pub task_messages: HashMap<String, Vec<Value>>,
    pub memorials: Vec<Value>,
    /// Internal map: task_id -> { provider, cwd, provider_session_id }
    pub task_bindings: HashMap<String, LocalTaskBinding>,
    /// Internal map: project_id -> local filesystem path
    pub project_paths: HashMap<String, String>,
    pub codex_home: Option<String>,
    pub claude_home: Option<String>,
    pub scanned_files: usize,
    pub imported_session_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalTaskBinding {
    pub provider: String,
    pub cwd: String,
    pub provider_session_id: Option<String>,
    pub imported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalWorkspaceResponse {
    pub host_name: String,
    pub local_mcp_url: String,
    pub local_mcp_token: String,
    pub codex_home: Option<String>,
    pub claude_home: Option<String>,
    pub scanned_files: usize,
    pub imported_session_count: usize,
    pub providers: Vec<ProviderCapabilityReport>,
    pub projects: Vec<Value>,
    pub agents: Vec<Value>,
    pub tasks: Vec<Value>,
    pub task_messages: HashMap<String, Vec<Value>>,
    pub memorials: Vec<Value>,
    pub project_paths: HashMap<String, String>,
}

pub struct LocalHub {
    data: Mutex<LocalWorkspaceData>,
    store_path: PathBuf,
    mcp_port: Mutex<u16>,
    active_cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,
    host_name: String,
}

fn generate_local_token() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    format!("kx_loc_{pid:x}_{nanos:x}")
}

fn new_local_id(prefix: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{prefix}_{nanos:x}")
}

fn default_local_agents(host_name: &str, now: &str) -> Vec<Value> {
    vec![
        json!({
            "id": "agt_local_codex",
            "owner_id": "local_owner",
            "name": "Codex",
            "title": "本机军机处 · 编修",
            "provider": "codex",
            "mode": "bridge_managed",
            "bridge_id": "brg_local",
            "capabilities": {
                "supports_resume": true,
                "supports_streaming": true,
                "supports_cancel": true,
                "notes": format!("Direct local execution on {host_name} (`codex exec --json` / `codex exec resume`).")
            },
            "version": 1,
            "source": "local",
            "created_at": now,
            "updated_at": now
        }),
        json!({
            "id": "agt_local_claude",
            "owner_id": "local_owner",
            "name": "Claude Code",
            "title": "本机内阁 · 大学士",
            "provider": "claude_code",
            "mode": "bridge_managed",
            "bridge_id": "brg_local",
            "capabilities": {
                "supports_resume": true,
                "supports_streaming": true,
                "supports_cancel": true,
                "notes": format!("Direct local execution on {host_name} (`claude -p --output-format stream-json --resume`).")
            },
            "version": 1,
            "source": "local",
            "created_at": now,
            "updated_at": now
        }),
        json!({
            "id": "agt_local_mcp",
            "owner_id": "local_owner",
            "name": "Local MCP Agent",
            "title": "本机外派 · 钦差",
            "provider": "mcp_external",
            "mode": "mcp_only",
            "bridge_id": "brg_local",
            "capabilities": {
                "supports_resume": false,
                "supports_streaming": false,
                "supports_cancel": false,
                "notes": "Connects via embedded loopback MCP server (127.0.0.1)."
            },
            "version": 1,
            "source": "local",
            "created_at": now,
            "updated_at": now
        }),
    ]
}

impl LocalHub {
    pub fn init(app: &AppHandle) -> Arc<Self> {
        let host_name = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "Local-PC".to_string());

        let data_dir = app
            .path()
            .app_local_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("kangxi-local"));
        let _ = std::fs::create_dir_all(&data_dir);
        let store_path = data_dir.join("local_workspace.json");

        let now = now_iso();
        let initial = std::fs::read_to_string(&store_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<LocalWorkspaceData>(&raw).ok())
            .unwrap_or_else(|| LocalWorkspaceData {
                local_mcp_token: generate_local_token(),
                projects: Vec::new(),
                agents: default_local_agents(&host_name, &now),
                tasks: Vec::new(),
                task_messages: HashMap::new(),
                memorials: Vec::new(),
                task_bindings: HashMap::new(),
                project_paths: HashMap::new(),
                codex_home: None,
                claude_home: None,
                scanned_files: 0,
                imported_session_count: 0,
            });

        let hub = Arc::new(Self {
            data: Mutex::new(initial),
            store_path,
            mcp_port: Mutex::new(18730),
            active_cancels: Mutex::new(HashMap::new()),
            host_name,
        });

        // Start embedded loopback MCP server immediately (127.0.0.1 only)
        let hub_for_server = Arc::clone(&hub);
        let app_for_server = app.clone();
        tauri::async_runtime::spawn(async move {
            hub_for_server.run_loopback_mcp_server(app_for_server).await;
        });

        hub
    }

    async fn persist(&self) {
        let snapshot = self.data.lock().await.clone();
        if let Ok(json_str) = serde_json::to_string_pretty(&snapshot) {
            let _ = std::fs::write(&self.store_path, json_str);
        }
    }

    pub async fn mcp_url(&self) -> String {
        let port = *self.mcp_port.lock().await;
        format!("http://127.0.0.1:{port}/mcp")
    }

    pub async fn probe_providers(&self) -> Vec<ProviderCapabilityReport> {
        let codex = CodexAdapter::new(None);
        let claude = ClaudeCodeAdapter::new(None);
        vec![codex.probe().await, claude.probe().await]
    }

    /// Auto-scans local Codex & Claude Code directories (like T3 Code) and merges
    /// discovered projects & historical sessions into the local workspace without duplicates.
    pub async fn rescan_and_import(&self) -> (usize, usize) {
        let report = tokio::task::spawn_blocking(|| discover_local_environment(80))
            .await
            .unwrap_or_else(|_| kangxi_bridge::LocalDiscoveryReport {
                codex_home: None,
                claude_home: None,
                projects: Vec::new(),
                sessions: Vec::new(),
                scanned_files: 0,
            });

        let mut data = self.data.lock().await;
        data.codex_home = report.codex_home;
        data.claude_home = report.claude_home;
        data.scanned_files = report.scanned_files;
        data.imported_session_count = report.sessions.len();

        let now = now_iso();
        if data.agents.is_empty() {
            data.agents = default_local_agents(&self.host_name, &now);
        }

        // Merge projects
        for proj in &report.projects {
            merge_discovered_project(&mut data, proj, &self.host_name);
        }

        // Merge sessions as resumable tasks
        for sess in &report.sessions {
            merge_discovered_session(&mut data, sess);
        }

        // Sort tasks by updated_at descending
        data.tasks.sort_by(|a, b| {
            let ta = a.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            let tb = b.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            tb.cmp(ta)
        });

        let proj_count = report.projects.len();
        let sess_count = report.sessions.len();
        drop(data);
        self.persist().await;
        (proj_count, sess_count)
    }

    pub async fn get_workspace_response(&self, auto_scan: bool) -> LocalWorkspaceResponse {
        if auto_scan {
            self.rescan_and_import().await;
        }
        let providers = self.probe_providers().await;
        let mcp_url = self.mcp_url().await;
        let data = self.data.lock().await.clone();

        LocalWorkspaceResponse {
            host_name: self.host_name.clone(),
            local_mcp_url: mcp_url,
            local_mcp_token: data.local_mcp_token,
            codex_home: data.codex_home,
            claude_home: data.claude_home,
            scanned_files: data.scanned_files,
            imported_session_count: data.imported_session_count,
            providers,
            projects: data.projects,
            agents: data.agents,
            tasks: data.tasks,
            task_messages: data.task_messages,
            memorials: data.memorials,
            project_paths: data.project_paths,
        }
    }

    pub async fn add_local_project(
        &self,
        name: String,
        local_path: String,
        description: String,
    ) -> Result<Value, String> {
        let p = PathBuf::from(&local_path);
        if !p.is_dir() {
            return Err(format!("目录不存在：{local_path}"));
        }
        let now = now_iso();
        let id = new_local_id("prj_loc");
        let slug = name
            .to_lowercase()
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { '-' })
            .collect::<String>();
        let proj = json!({
            "id": id,
            "owner_id": "local_owner",
            "name": name,
            "slug": slug,
            "description": if description.is_empty() { local_path.clone() } else { description },
            "default_agent_id": "agt_local_codex",
            "bridge_id": "brg_local",
            "host_label": self.host_name,
            "version": 1,
            "source": "local_manual",
            "created_at": now,
            "updated_at": now
        });

        let mut data = self.data.lock().await;
        data.project_paths.insert(id, local_path);
        data.projects.insert(0, proj.clone());
        drop(data);
        self.persist().await;
        Ok(proj)
    }

    pub async fn create_and_run_task(
        self: &Arc<Self>,
        app: AppHandle,
        project_id: String,
        agent_id: String,
        title: String,
        prompt: String,
    ) -> Result<Value, String> {
        let (cwd, provider) = {
            let data = self.data.lock().await;
            let cwd = data
                .project_paths
                .get(&project_id)
                .cloned()
                .ok_or_else(|| "该项目未绑定本机目录，请先添加或自动导入项目目录。".to_string())?;
            let provider = data
                .agents
                .iter()
                .find(|a| a.get("id").and_then(|v| v.as_str()) == Some(agent_id.as_str()))
                .and_then(|a| a.get("provider").and_then(|v| v.as_str()))
                .unwrap_or("codex")
                .to_string();
            (cwd, provider)
        };

        let now = now_iso();
        let task_id = new_local_id("tsk_loc");
        let session_id = new_local_id("ses_loc");

        let task = json!({
            "id": task_id,
            "owner_id": "local_owner",
            "project_id": project_id,
            "agent_id": agent_id,
            "session_id": session_id,
            "bridge_id": "brg_local",
            "title": title,
            "prompt": prompt,
            "status": "running",
            "delivery_status": "acknowledged",
            "resume_status": "resuming",
            "summary": "正在本机直接执行...",
            "error_message": null,
            "version": 1,
            "source": format!("本机直连 · {}", self.host_name),
            "created_at": now,
            "updated_at": now
        });

        let first_msg = json!({
            "id": new_local_id("msg"),
            "task_id": task_id,
            "session_id": session_id,
            "sender_type": "user",
            "sender_id": "local_owner",
            "kind": "user_prompt",
            "content": prompt,
            "metadata": {},
            "truncated": false,
            "created_at": now
        });

        {
            let mut data = self.data.lock().await;
            data.tasks.insert(0, task.clone());
            data.task_messages
                .insert(task_id.clone(), vec![first_msg]);
            data.task_bindings.insert(
                task_id.clone(),
                LocalTaskBinding {
                    provider: provider.clone(),
                    cwd: cwd.clone(),
                    provider_session_id: None,
                    imported: false,
                },
            );
        }
        self.persist().await;
        let _ = app.emit("kangxi:local-update", json!({ "kind": "task_created", "task_id": task_id }));

        self.spawn_local_execution(app, task_id, provider, PathBuf::from(cwd), prompt, None)
            .await?;

        Ok(task)
    }

    pub async fn send_followup(
        self: &Arc<Self>,
        app: AppHandle,
        task_id: String,
        content: String,
    ) -> Result<Value, String> {
        let binding = {
            let data = self.data.lock().await;
            data.task_bindings
                .get(&task_id)
                .cloned()
                .ok_or_else(|| "未找到该会话的本机绑定信息。".to_string())?
        };

        let now = now_iso();
        let msg = json!({
            "id": new_local_id("msg"),
            "task_id": task_id,
            "session_id": binding.provider_session_id,
            "sender_type": "user",
            "sender_id": "local_owner",
            "kind": "user_followup",
            "content": content,
            "metadata": {},
            "truncated": false,
            "created_at": now
        });

        {
            let mut data = self.data.lock().await;
            data.task_messages
                .entry(task_id.clone())
                .or_default()
                .push(msg.clone());
            if let Some(t) = data
                .tasks
                .iter_mut()
                .find(|t| t.get("id").and_then(|v| v.as_str()) == Some(task_id.as_str()))
            {
                t["status"] = json!("running");
                t["resume_status"] = json!("resuming");
                t["updated_at"] = json!(now);
            }
        }
        self.persist().await;
        let _ = app.emit("kangxi:local-update", json!({ "kind": "task_followup", "task_id": task_id }));

        self.spawn_local_execution(
            app,
            task_id,
            binding.provider,
            PathBuf::from(binding.cwd),
            content,
            binding.provider_session_id,
        )
        .await?;

        Ok(msg)
    }

    pub async fn cancel_task(&self, app: AppHandle, task_id: String) -> Result<(), String> {
        if let Some(tx) = self.active_cancels.lock().await.remove(&task_id) {
            let _ = tx.send(());
        }
        let now = now_iso();
        {
            let mut data = self.data.lock().await;
            if let Some(t) = data
                .tasks
                .iter_mut()
                .find(|t| t.get("id").and_then(|v| v.as_str()) == Some(task_id.as_str()))
            {
                t["status"] = json!("cancelled");
                t["updated_at"] = json!(now);
            }
        }
        self.persist().await;
        let _ = app.emit("kangxi:local-update", json!({ "kind": "task_cancelled", "task_id": task_id }));
        Ok(())
    }

    pub async fn decide_memorial(
        self: &Arc<Self>,
        app: AppHandle,
        memorial_id: String,
        action: String,
        selected_option_id: Option<String>,
        comment: String,
        instructions: Option<String>,
        expected_version: u64,
    ) -> Result<Value, String> {
        let now = now_iso();
        let next_status = match action.as_str() {
            "reject" => "rejected",
            "needs_info" => "needs_info",
            _ => "approved",
        };

        let mut linked_resume: Option<(String, LocalTaskBinding)> = None;
        let updated_memorial = {
            let mut data = self.data.lock().await;
            let idx = data
                .memorials
                .iter()
                .position(|m| m.get("id").and_then(|v| v.as_str()) == Some(memorial_id.as_str()))
                .ok_or_else(|| "奏折不存在".to_string())?;

            let current_ver = data.memorials[idx]
                .get("version")
                .and_then(|v| v.as_u64())
                .unwrap_or(1);
            let current_status = data.memorials[idx]
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("pending");
            if current_ver != expected_version || current_status != "pending" {
                return Err("VERSION_CONFLICT: 该奏折已被批复或更新。".into());
            }

            let linked_task_id = data.memorials[idx]
                .get("task_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            if let Some(ref tid) = linked_task_id {
                if let Some(b) = data.task_bindings.get(tid).cloned() {
                    if b.provider_session_id.is_some() {
                        linked_resume = Some((tid.clone(), b));
                    }
                }
            }

            let resume_status = if linked_resume.is_some() {
                "resuming"
            } else {
                "not_supported"
            };

            let decision = json!({
                "id": new_local_id("dec"),
                "memorial_id": memorial_id,
                "action": action,
                "selected_option_id": selected_option_id,
                "comment": comment,
                "instructions": instructions,
                "decided_by_device_id": "local_desktop",
                "decided_by_label": format!("本机御案 · {}", self.host_name),
                "delivery_status": "acknowledged",
                "resume_status": resume_status,
                "bridge_claimed_at": now,
                "agent_resumed_at": if linked_resume.is_some() { Some(now.clone()) } else { None },
                "resume_error": null,
                "version": 1,
                "created_at": now,
                "updated_at": now
            });

            data.memorials[idx]["status"] = json!(next_status);
            data.memorials[idx]["delivery_status"] = json!("acknowledged");
            data.memorials[idx]["resume_status"] = json!(resume_status);
            data.memorials[idx]["version"] = json!(current_ver + 1);
            data.memorials[idx]["updated_at"] = json!(now);
            data.memorials[idx]["decision"] = decision;
            data.memorials[idx].clone()
        };

        self.persist().await;
        let _ = app.emit("kangxi:local-update", json!({ "kind": "memorial_decided", "memorial_id": memorial_id }));

        if let Some((tid, binding)) = linked_resume {
            let prompt = format!(
                "Human operator decision on memorial {memorial_id}: [{action}]\nComment: {comment}\nInstructions: {}\nPlease proceed accordingly.",
                instructions.unwrap_or_default()
            );
            let _ = self
                .spawn_local_execution(
                    app,
                    tid,
                    binding.provider,
                    PathBuf::from(binding.cwd),
                    prompt,
                    binding.provider_session_id,
                )
                .await;
        }

        Ok(updated_memorial)
    }

    pub async fn install_local_mcp(&self, target: &str) -> Result<String, String> {
        let url = self.mcp_url().await;
        let token = self.data.lock().await.local_mcp_token.clone();

        match target {
            "codex" => {
                let path = configure_codex_local_mcp(&url, &token)?;
                Ok(format!("已自动写入 Codex 本机 MCP 配置：{path}"))
            }
            "claude_code" => {
                let output = build_command("claude", None)
                    .args([
                        "mcp",
                        "add",
                        "--transport",
                        "http",
                        "kangxi-local",
                        &url,
                        "--header",
                        &format!("Authorization: Bearer {token}"),
                    ])
                    .output()
                    .await
                    .map_err(|e| format!("无法调用 claude CLI：{e}"))?;
                if output.status.success() {
                    Ok("已自动注册 Claude Code 本机 MCP（kangxi-local）。".into())
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    Err(format!("claude mcp add 返回错误：{stderr}"))
                }
            }
            _ => Err(format!("不支持的目标 CLI：{target}")),
        }
    }

    async fn spawn_local_execution(
        self: &Arc<Self>,
        app: AppHandle,
        task_id: String,
        provider: String,
        cwd: PathBuf,
        prompt: String,
        provider_session_id: Option<String>,
    ) -> Result<(), String> {
        let adapter: Arc<dyn ProviderAdapter> = match provider.as_str() {
            "claude_code" => Arc::new(ClaudeCodeAdapter::new(None)),
            "codex" => Arc::new(CodexAdapter::new(None)),
            _ => {
                return Err(
                    "该 Agent 为 MCP-only 模式，无法由本机直接启动 CLI；请通过本机 MCP 接入。"
                        .into(),
                );
            }
        };

        let (tx, mut rx) = mpsc::channel::<ProviderStreamEvent>(64);
        let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
        self.active_cancels
            .lock()
            .await
            .insert(task_id.clone(), cancel_tx);

        let req = ProviderRunRequest {
            cwd,
            prompt,
            provider_session_id,
        };
        tokio::spawn(async move {
            if let Err(err) = adapter.run(req, tx.clone(), cancel_rx).await {
                let _ = tx.send(ProviderStreamEvent::Failed(err.to_string())).await;
            }
        });

        let hub = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            while let Some(ev) = rx.recv().await {
                let now = now_iso();
                match ev {
                    ProviderStreamEvent::SessionStarted(pid) => {
                        let mut data = hub.data.lock().await;
                        if let Some(b) = data.task_bindings.get_mut(&task_id) {
                            b.provider_session_id = Some(pid.clone());
                        }
                        if let Some(t) = data
                            .tasks
                            .iter_mut()
                            .find(|t| t.get("id").and_then(|v| v.as_str()) == Some(task_id.as_str()))
                        {
                            t["resume_status"] = json!("resumed");
                            t["updated_at"] = json!(now);
                        }
                    }
                    ProviderStreamEvent::OutputChunk(chunk) => {
                        let mut data = hub.data.lock().await;
                        data.task_messages
                            .entry(task_id.clone())
                            .or_default()
                            .push(json!({
                                "id": new_local_id("msg"),
                                "task_id": task_id,
                                "session_id": null,
                                "sender_type": "agent",
                                "sender_id": provider,
                                "kind": "agent_log",
                                "content": chunk,
                                "metadata": {},
                                "truncated": false,
                                "created_at": now
                            }));
                        if let Some(t) = data
                            .tasks
                            .iter_mut()
                            .find(|t| t.get("id").and_then(|v| v.as_str()) == Some(task_id.as_str()))
                        {
                            t["updated_at"] = json!(now);
                        }
                    }
                    ProviderStreamEvent::Completed {
                        summary,
                        provider_session_id,
                    } => {
                        let mut data = hub.data.lock().await;
                        if let Some(pid) = provider_session_id {
                            if let Some(b) = data.task_bindings.get_mut(&task_id) {
                                b.provider_session_id = Some(pid);
                            }
                        }
                        data.task_messages
                            .entry(task_id.clone())
                            .or_default()
                            .push(json!({
                                "id": new_local_id("msg"),
                                "task_id": task_id,
                                "session_id": null,
                                "sender_type": "agent",
                                "sender_id": provider,
                                "kind": "task_result",
                                "content": summary,
                                "metadata": {},
                                "truncated": false,
                                "created_at": now
                            }));
                        if let Some(t) = data
                            .tasks
                            .iter_mut()
                            .find(|t| t.get("id").and_then(|v| v.as_str()) == Some(task_id.as_str()))
                        {
                            t["status"] = json!("completed");
                            t["resume_status"] = json!("resumed");
                            t["summary"] = json!(summary.chars().take(240).collect::<String>());
                            t["updated_at"] = json!(now);
                        }
                    }
                    ProviderStreamEvent::Failed(err_msg) => {
                        let mut data = hub.data.lock().await;
                        data.task_messages
                            .entry(task_id.clone())
                            .or_default()
                            .push(json!({
                                "id": new_local_id("msg"),
                                "task_id": task_id,
                                "session_id": null,
                                "sender_type": "system",
                                "sender_id": "local_bridge",
                                "kind": "system",
                                "content": format!("执行失败：{err_msg}"),
                                "metadata": {},
                                "truncated": false,
                                "created_at": now
                            }));
                        if let Some(t) = data
                            .tasks
                            .iter_mut()
                            .find(|t| t.get("id").and_then(|v| v.as_str()) == Some(task_id.as_str()))
                        {
                            t["status"] = json!("failed");
                            t["resume_status"] = json!("resume_failed");
                            t["error_message"] = json!(err_msg);
                            t["updated_at"] = json!(now);
                        }
                    }
                }
                hub.persist().await;
                let _ = app.emit(
                    "kangxi:local-update",
                    json!({ "kind": "task_stream", "task_id": task_id }),
                );
            }
            hub.active_cancels.lock().await.remove(&task_id);
        });

        Ok(())
    }

    /// Lightweight embedded Streamable HTTP MCP server bound strictly to 127.0.0.1.
    async fn run_loopback_mcp_server(self: Arc<Self>, app: AppHandle) {
        let listener = match TcpListener::bind("127.0.0.1:18730").await {
            Ok(l) => l,
            Err(_) => match TcpListener::bind("127.0.0.1:0").await {
                Ok(l) => l,
                Err(_) => return,
            },
        };
        if let Ok(addr) = listener.local_addr() {
            *self.mcp_port.lock().await = addr.port();
        }

        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                continue;
            };
            let hub = Arc::clone(&self);
            let app_clone = app.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 65536];
                let Ok(n) = socket.read(&mut buf).await else {
                    return;
                };
                if n == 0 {
                    return;
                }
                let raw = String::from_utf8_lossy(&buf[..n]).to_string();
                let (status, resp_body) = hub.handle_http_request(&raw, &app_clone).await;
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Content-Type, Authorization, MCP-Session-Id, Accept\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{resp_body}",
                    resp_body.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
            });
        }
    }

    async fn handle_http_request(&self, raw: &str, app: &AppHandle) -> (&'static str, String) {
        let mut parts = raw.splitn(2, "\r\n\r\n");
        let head = parts.next().unwrap_or("");
        let body = parts.next().unwrap_or("").trim();

        let mut lines = head.lines();
        let req_line = lines.next().unwrap_or("");
        let mut tokens = req_line.split_whitespace();
        let method = tokens.next().unwrap_or("GET");
        let path = tokens.next().unwrap_or("/");

        if method == "OPTIONS" {
            return ("204 No Content", String::new());
        }

        if path == "/health" {
            return (
                "200 OK",
                json!({ "ok": true, "mode": "local_desktop_mcp", "host": self.host_name }).to_string(),
            );
        }

        // Check bearer token for /mcp
        let expected_token = self.data.lock().await.local_mcp_token.clone();
        let mut authorized = false;
        for line in lines {
            if let Some((k, v)) = line.split_once(':') {
                if k.eq_ignore_ascii_case("authorization") {
                    let val = v.trim();
                    if let Some(bearer) = val.strip_prefix("Bearer ").or_else(|| val.strip_prefix("bearer ")) {
                        if bearer.trim() == expected_token {
                            authorized = true;
                        }
                    }
                }
            }
        }
        if !authorized {
            return (
                "401 Unauthorized",
                json!({ "error": "Invalid local MCP bearer token" }).to_string(),
            );
        }

        if path != "/mcp" || method != "POST" {
            return (
                "200 OK",
                json!({ "server": "kangxi-local-mcp", "protocol": "streamable-http" }).to_string(),
            );
        }

        let Ok(rpc) = serde_json::from_str::<Value>(body) else {
            return (
                "400 Bad Request",
                json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Invalid JSON" } }).to_string(),
            );
        };

        let id = rpc.get("id").cloned().unwrap_or(Value::Null);
        let rpc_method = rpc.get("method").and_then(|v| v.as_str()).unwrap_or("");

        match rpc_method {
            "initialize" => (
                "200 OK",
                json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "protocolVersion": "2025-03-26",
                        "capabilities": { "tools": { "listChanged": false } },
                        "serverInfo": { "name": "kangxi-local-mcp", "version": env!("CARGO_PKG_VERSION") }
                    }
                })
                .to_string(),
            ),
            "notifications/initialized" => ("202 Accepted", String::new()),
            "ping" => ("200 OK", json!({ "jsonrpc": "2.0", "id": id, "result": {} }).to_string()),
            "tools/list" => (
                "200 OK",
                json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "tools": [
                            {
                                "name": "submit_memorial",
                                "description": "Submit a memorial (approval/decision request) to the local KangXi.exe desktop workbench.",
                                "inputSchema": {
                                    "type": "object",
                                    "required": ["title", "content"],
                                    "properties": {
                                        "project_id": { "type": "string" },
                                        "title": { "type": "string" },
                                        "content": { "type": "string" },
                                        "request_type": { "type": "string" },
                                        "risk_level": { "type": "string" },
                                        "risk_notes": { "type": "string" },
                                        "options": { "type": "array" },
                                        "task_id": { "type": "string" }
                                    }
                                }
                            },
                            {
                                "name": "check_memorial",
                                "description": "Check the status of a local memorial.",
                                "inputSchema": {
                                    "type": "object",
                                    "required": ["memorial_id"],
                                    "properties": { "memorial_id": { "type": "string" } }
                                }
                            },
                            {
                                "name": "get_memorial_reply",
                                "description": "Get the human rescript/decision for a local memorial.",
                                "inputSchema": {
                                    "type": "object",
                                    "required": ["memorial_id"],
                                    "properties": { "memorial_id": { "type": "string" } }
                                }
                            },
                            {
                                "name": "submit_report",
                                "description": "Submit an informational progress or completion report.",
                                "inputSchema": {
                                    "type": "object",
                                    "required": ["title", "content"],
                                    "properties": {
                                        "project_id": { "type": "string" },
                                        "task_id": { "type": "string" },
                                        "title": { "type": "string" },
                                        "content": { "type": "string" }
                                    }
                                }
                            }
                        ]
                    }
                })
                .to_string(),
            ),
            "tools/call" => {
                let tool_name = rpc
                    .get("params")
                    .and_then(|p| p.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let args = rpc
                    .get("params")
                    .and_then(|p| p.get("arguments"))
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                let res = self.execute_local_mcp_tool(tool_name, args, app).await;
                (
                    "200 OK",
                    json!({ "jsonrpc": "2.0", "id": id, "result": res }).to_string(),
                )
            }
            _ => (
                "200 OK",
                json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "Method not found" } }).to_string(),
            ),
        }
    }

    async fn execute_local_mcp_tool(&self, tool: &str, args: Value, app: &AppHandle) -> Value {
        let now = now_iso();
        match tool {
            "submit_memorial" => {
                let title = args
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Untitled Memorial")
                    .to_string();
                let content = args
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let mut data = self.data.lock().await;
                let project_id = args
                    .get("project_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| {
                        data.projects
                            .first()
                            .and_then(|p| p.get("id").and_then(|v| v.as_str()))
                            .map(|s| s.to_string())
                    })
                    .unwrap_or_else(|| "prj_local_default".to_string());
                let mem_id = new_local_id("mem_loc");
                let mem = json!({
                    "id": mem_id,
                    "owner_id": "local_owner",
                    "project_id": project_id,
                    "agent_id": "agt_local_mcp",
                    "session_id": args.get("session_id").cloned().unwrap_or(Value::Null),
                    "task_id": args.get("task_id").cloned().unwrap_or(Value::Null),
                    "title": title,
                    "content": content,
                    "request_type": args.get("request_type").and_then(|v| v.as_str()).unwrap_or("approval"),
                    "options": args.get("options").cloned().unwrap_or_else(|| json!([])),
                    "risk_level": args.get("risk_level").and_then(|v| v.as_str()).unwrap_or("medium"),
                    "risk_notes": args.get("risk_notes").cloned().unwrap_or(Value::Null),
                    "context_summary": "由本机 MCP 直接呈递（无需云端后端）",
                    "status": "pending",
                    "delivery_status": "acknowledged",
                    "resume_status": "not_supported",
                    "decision": null,
                    "version": 1,
                    "source": "local_mcp",
                    "created_at": now,
                    "updated_at": now
                });
                data.memorials.insert(0, mem);
                drop(data);
                self.persist().await;
                let _ = app.emit(
                    "kangxi:local-update",
                    json!({ "kind": "memorial_created", "memorial_id": mem_id, "title": title }),
                );
                let out = json!({ "memorial_id": mem_id, "status": "pending", "version": 1 });
                json!({ "structuredContent": out, "content": [{ "type": "text", "text": out.to_string() }] })
            }
            "check_memorial" => {
                let mid = args.get("memorial_id").and_then(|v| v.as_str()).unwrap_or("");
                let data = self.data.lock().await;
                if let Some(m) = data
                    .memorials
                    .iter()
                    .find(|m| m.get("id").and_then(|v| v.as_str()) == Some(mid))
                {
                    let out = json!({
                        "memorial_id": mid,
                        "status": m["status"],
                        "has_reply": !m["decision"].is_null(),
                        "version": m["version"]
                    });
                    json!({ "structuredContent": out, "content": [{ "type": "text", "text": out.to_string() }] })
                } else {
                    json!({ "isError": true, "content": [{ "type": "text", "text": "Memorial not found" }] })
                }
            }
            "get_memorial_reply" => {
                let mid = args.get("memorial_id").and_then(|v| v.as_str()).unwrap_or("");
                let data = self.data.lock().await;
                if let Some(m) = data
                    .memorials
                    .iter()
                    .find(|m| m.get("id").and_then(|v| v.as_str()) == Some(mid))
                {
                    if m["decision"].is_null() {
                        let out = json!({ "memorial_id": mid, "status": m["status"], "replied": false });
                        json!({ "structuredContent": out, "content": [{ "type": "text", "text": out.to_string() }] })
                    } else {
                        let d = &m["decision"];
                        let out = json!({
                            "memorial_id": mid,
                            "status": m["status"],
                            "replied": true,
                            "action": d["action"],
                            "selected_option_id": d["selected_option_id"],
                            "comment": d["comment"],
                            "instructions": d["instructions"],
                            "decided_at": d["created_at"]
                        });
                        json!({ "structuredContent": out, "content": [{ "type": "text", "text": out.to_string() }] })
                    }
                } else {
                    json!({ "isError": true, "content": [{ "type": "text", "text": "Memorial not found" }] })
                }
            }
            "submit_report" => {
                let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("Report");
                let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
                let task_id = args.get("task_id").and_then(|v| v.as_str());
                let mut data = self.data.lock().await;
                if let Some(tid) = task_id {
                    data.task_messages
                        .entry(tid.to_string())
                        .or_default()
                        .push(json!({
                            "id": new_local_id("msg"),
                            "task_id": tid,
                            "session_id": null,
                            "sender_type": "agent",
                            "sender_id": "agt_local_mcp",
                            "kind": "agent_report",
                            "content": format!("## {title}\n\n{content}"),
                            "metadata": {},
                            "truncated": false,
                            "created_at": now
                        }));
                }
                drop(data);
                self.persist().await;
                let _ = app.emit("kangxi:local-update", json!({ "kind": "report_created" }));
                let out = json!({ "ok": true });
                json!({ "structuredContent": out, "content": [{ "type": "text", "text": out.to_string() }] })
            }
            _ => json!({ "isError": true, "content": [{ "type": "text", "text": "Unknown tool" }] }),
        }
    }
}

fn merge_discovered_project(
    data: &mut LocalWorkspaceData,
    proj: &DiscoveredProject,
    host_name: &str,
) {
    data.project_paths
        .insert(proj.id.clone(), proj.path.clone());
    let default_agent = if proj.providers.iter().any(|p| p == "claude_code")
        && !proj.providers.iter().any(|p| p == "codex")
    {
        "agt_local_claude"
    } else {
        "agt_local_codex"
    };
    let desc = match &proj.git_branch {
        Some(br) => format!("{} · 分支 {} · 已导入 {} 条会话", proj.path, br, proj.session_count),
        None => format!("{} · 已导入 {} 条会话", proj.path, proj.session_count),
    };

    if let Some(existing) = data
        .projects
        .iter_mut()
        .find(|p| p.get("id").and_then(|v| v.as_str()) == Some(proj.id.as_str()))
    {
        existing["description"] = json!(desc);
        existing["updated_at"] = json!(proj.last_activity_at);
    } else {
        data.projects.push(json!({
            "id": proj.id,
            "owner_id": "local_owner",
            "name": proj.name,
            "slug": proj.name.to_lowercase(),
            "description": desc,
            "default_agent_id": default_agent,
            "bridge_id": "brg_local",
            "host_label": host_name,
            "version": 1,
            "source": "auto_import",
            "created_at": proj.last_activity_at,
            "updated_at": proj.last_activity_at
        }));
    }
}

fn merge_discovered_session(data: &mut LocalWorkspaceData, sess: &DiscoveredSession) {
    let agent_id = if sess.provider == "claude_code" {
        "agt_local_claude"
    } else {
        "agt_local_codex"
    };

    data.task_bindings.insert(
        sess.id.clone(),
        LocalTaskBinding {
            provider: sess.provider.clone(),
            cwd: sess.cwd.clone(),
            provider_session_id: Some(sess.provider_session_id.clone()),
            imported: true,
        },
    );

    let msgs: Vec<Value> = sess
        .messages
        .iter()
        .map(|m| {
            json!({
                "id": m.id,
                "task_id": sess.id,
                "session_id": sess.provider_session_id,
                "sender_type": m.sender_type,
                "sender_id": if m.sender_type == "user" { "local_owner" } else { agent_id },
                "kind": m.kind,
                "content": m.content,
                "metadata": { "imported": true },
                "truncated": false,
                "created_at": m.created_at
            })
        })
        .collect();

    // Update messages only if the file has >= our stored count so live unsaved messages aren't lost
    let should_replace = data
        .task_messages
        .get(&sess.id)
        .map(|existing| msgs.len() >= existing.len())
        .unwrap_or(true);
    if should_replace {
        data.task_messages.insert(sess.id.clone(), msgs);
    }

    let source_label = if sess.provider == "claude_code" {
        "自动导入 · Claude Code"
    } else {
        "自动导入 · Codex CLI"
    };

    if let Some(existing) = data
        .tasks
        .iter_mut()
        .find(|t| t.get("id").and_then(|v| v.as_str()) == Some(sess.id.as_str()))
    {
        if existing.get("status").and_then(|v| v.as_str()) != Some("running") {
            existing["title"] = json!(sess.title);
            existing["summary"] = json!(sess.summary);
            existing["updated_at"] = json!(sess.updated_at);
        }
    } else {
        data.tasks.push(json!({
            "id": sess.id,
            "owner_id": "local_owner",
            "project_id": sess.project_id,
            "agent_id": agent_id,
            "session_id": sess.provider_session_id,
            "bridge_id": "brg_local",
            "title": sess.title,
            "prompt": sess.messages.first().map(|m| m.content.as_str()).unwrap_or(&sess.title),
            "status": "completed",
            "delivery_status": "acknowledged",
            "resume_status": "resumed",
            "summary": sess.summary,
            "error_message": null,
            "version": 1,
            "source": source_label,
            "created_at": sess.created_at,
            "updated_at": sess.updated_at
        }));
    }
}
