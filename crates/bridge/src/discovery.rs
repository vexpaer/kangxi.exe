use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

/// A locally discovered project derived from Codex / Claude Code history or local folders.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredProject {
    pub id: String,
    pub name: String,
    pub path: String,
    pub git_branch: Option<String>,
    pub providers: Vec<String>,
    pub session_count: usize,
    pub last_activity_at: String,
}

/// A message extracted read-only from a local Codex or Claude Code JSONL transcript.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedMessage {
    pub id: String,
    pub sender_type: String, // "user" | "agent" | "system"
    pub kind: String,        // "user_prompt" | "user_followup" | "agent_report" | "task_result"
    pub content: String,
    pub created_at: String,
}

/// A locally discovered & resumable Codex / Claude Code session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredSession {
    pub id: String,
    pub provider: String, // "codex" | "claude_code"
    pub provider_session_id: String,
    pub project_id: String,
    pub project_name: String,
    pub cwd: String,
    pub git_branch: Option<String>,
    pub title: String,
    pub summary: Option<String>,
    pub source_file: String,
    pub message_count: usize,
    pub messages: Vec<ImportedMessage>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalDiscoveryReport {
    pub codex_home: Option<String>,
    pub claude_home: Option<String>,
    pub projects: Vec<DiscoveredProject>,
    pub sessions: Vec<DiscoveredSession>,
    pub scanned_files: usize,
}

fn user_home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn stable_project_id(cwd: &str) -> String {
    // Deterministic lightweight FNV-1a 64-bit hash so re-imports never duplicate projects
    let norm = normalize_cwd(cwd).to_lowercase();
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in norm.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("prj_loc_{hash:016x}")
}

fn normalize_cwd(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        raw.trim().to_string()
    } else {
        trimmed.to_string()
    }
}

fn folder_display_name(cwd: &str) -> String {
    cwd.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(cwd)
        .to_string()
}

fn truncate_title(raw: &str) -> String {
    let first_line = raw
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("Imported Session");
    let mut out: String = first_line.chars().take(96).collect();
    if first_line.chars().count() > 96 {
        out.push('…');
    }
    out
}

fn truncate_message(raw: &str, max_chars: usize) -> String {
    if raw.chars().count() <= max_chars {
        raw.to_string()
    } else {
        let mut s: String = raw.chars().take(max_chars).collect();
        s.push_str("\n…[truncated]");
        s
    }
}

fn file_mtime_iso(path: &Path) -> String {
    let ts = fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    unix_secs_to_iso(ts)
}

pub fn unix_secs_to_iso(secs: u64) -> String {
    // Simple UTC ISO-8601 formatter without external chrono crate
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let h = rem / 3600;
    let m = (rem % 3600) / 60;
    let s = rem % 60;

    // Civil date from days since 1970-01-01 (Howard Hinnant algorithm)
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let yr = if mo <= 2 { y + 1 } else { y };

    format!("{yr:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}.000Z")
}

pub fn now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    unix_secs_to_iso(secs)
}

fn collect_jsonl_files(dir: &Path, out: &mut Vec<PathBuf>, skip_subagents: bool, depth: usize) {
    if depth > 6 || !dir.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if skip_subagents
                && p.file_name()
                    .map(|n| n.to_string_lossy().eq_ignore_ascii_case("subagents"))
                    .unwrap_or(false)
            {
                continue;
            }
            collect_jsonl_files(&p, out, skip_subagents, depth + 1);
        } else if p
            .extension()
            .map(|e| e.eq_ignore_ascii_case("jsonl"))
            .unwrap_or(false)
        {
            out.push(p);
        }
    }
}

/// Parses a local OpenAI Codex rollout JSONL file (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`).
pub fn parse_codex_rollout(path: &Path) -> Option<DiscoveredSession> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut session_id: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut git_branch: Option<String> = None;
    let mut created_at: Option<String> = None;
    let mut updated_at: Option<String> = None;
    let mut messages: Vec<ImportedMessage> = Vec::new();
    let mut msg_idx = 0usize;

    for line_res in reader.lines().take(2000) {
        let Ok(line) = line_res else { continue };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };

        let ts = val
            .get("timestamp")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        if let Some(ref t) = ts {
            if created_at.is_none() {
                created_at = Some(t.clone());
            }
            updated_at = Some(t.clone());
        }

        let outer_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let payload = val.get("payload");

        match outer_type {
            "session_meta" => {
                if let Some(p) = payload {
                    session_id = p
                        .get("id")
                        .or_else(|| p.get("session_id"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .or(session_id);
                    cwd = p
                        .get("cwd")
                        .and_then(|v| v.as_str())
                        .map(normalize_cwd)
                        .or(cwd);
                    git_branch = p
                        .get("git")
                        .and_then(|g| g.get("branch"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .or(git_branch);
                }
            }
            "turn_context" => {
                if cwd.is_none() {
                    cwd = payload
                        .and_then(|p| p.get("cwd"))
                        .and_then(|v| v.as_str())
                        .map(normalize_cwd);
                }
            }
            "event_msg" => {
                if let Some(p) = payload {
                    let pt = p.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    match pt {
                        "user_message" => {
                            if let Some(text) = p
                                .get("message")
                                .or_else(|| p.get("text"))
                                .and_then(|v| v.as_str())
                            {
                                if !text.trim().is_empty() {
                                    msg_idx += 1;
                                    messages.push(ImportedMessage {
                                        id: format!("imp_codex_{msg_idx}"),
                                        sender_type: "user".into(),
                                        kind: if msg_idx == 1 {
                                            "user_prompt".into()
                                        } else {
                                            "user_followup".into()
                                        },
                                        content: truncate_message(text.trim(), 4000),
                                        created_at: ts.clone().unwrap_or_else(now_iso),
                                    });
                                }
                            }
                        }
                        "agent_message" => {
                            if let Some(text) = p
                                .get("message")
                                .or_else(|| p.get("text"))
                                .and_then(|v| v.as_str())
                            {
                                if !text.trim().is_empty() {
                                    msg_idx += 1;
                                    messages.push(ImportedMessage {
                                        id: format!("imp_codex_{msg_idx}"),
                                        sender_type: "agent".into(),
                                        kind: "agent_report".into(),
                                        content: truncate_message(text.trim(), 4000),
                                        created_at: ts.clone().unwrap_or_else(now_iso),
                                    });
                                }
                            }
                        }
                        "task_complete" => {
                            if let Some(text) = p
                                .get("last_agent_message")
                                .and_then(|v| v.as_str())
                            {
                                let already_last = messages
                                    .last()
                                    .map(|m| m.content == text.trim())
                                    .unwrap_or(false);
                                if !text.trim().is_empty() && !already_last {
                                    msg_idx += 1;
                                    messages.push(ImportedMessage {
                                        id: format!("imp_codex_{msg_idx}"),
                                        sender_type: "agent".into(),
                                        kind: "task_result".into(),
                                        content: truncate_message(text.trim(), 4000),
                                        created_at: ts.clone().unwrap_or_else(now_iso),
                                    });
                                }
                            }
                        }
                        "item_completed" => {
                            if let Some(item) = p.get("item") {
                                let itype = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                                if let Some(text) = extract_content_text(item) {
                                    if !text.trim().is_empty() {
                                        if itype.eq_ignore_ascii_case("UserMessage")
                                            || itype == "user_message"
                                        {
                                            msg_idx += 1;
                                            messages.push(ImportedMessage {
                                                id: format!("imp_codex_{msg_idx}"),
                                                sender_type: "user".into(),
                                                kind: if msg_idx == 1 {
                                                    "user_prompt".into()
                                                } else {
                                                    "user_followup".into()
                                                },
                                                content: truncate_message(text.trim(), 4000),
                                                created_at: ts.clone().unwrap_or_else(now_iso),
                                            });
                                        } else if itype.eq_ignore_ascii_case("AgentMessage")
                                            || itype == "agent_message"
                                        {
                                            msg_idx += 1;
                                            messages.push(ImportedMessage {
                                                id: format!("imp_codex_{msg_idx}"),
                                                sender_type: "agent".into(),
                                                kind: "agent_report".into(),
                                                content: truncate_message(text.trim(), 4000),
                                                created_at: ts.clone().unwrap_or_else(now_iso),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            "response_item" => {
                if let Some(p) = payload {
                    if p.get("type").and_then(|v| v.as_str()) == Some("message") {
                        let role = p.get("role").and_then(|v| v.as_str()).unwrap_or("");
                        if let Some(text) = extract_content_text(p) {
                            let clean = text.trim();
                            // Skip system/environment boilerplate blocks
                            if !clean.is_empty()
                                && !clean.starts_with("<environment_context>")
                                && !clean.starts_with("# AGENTS.md")
                            {
                                let dup = messages
                                    .last()
                                    .map(|m| m.content == clean)
                                    .unwrap_or(false);
                                if !dup && (role == "user" || role == "assistant") {
                                    msg_idx += 1;
                                    messages.push(ImportedMessage {
                                        id: format!("imp_codex_{msg_idx}"),
                                        sender_type: if role == "user" {
                                            "user".into()
                                        } else {
                                            "agent".into()
                                        },
                                        kind: if role == "user" {
                                            if msg_idx == 1 {
                                                "user_prompt".into()
                                            } else {
                                                "user_followup".into()
                                            }
                                        } else {
                                            "agent_report".into()
                                        },
                                        content: truncate_message(clean, 4000),
                                        created_at: ts.clone().unwrap_or_else(now_iso),
                                    });
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let sid = session_id.or_else(|| {
        path.file_stem()
            .map(|s| s.to_string_lossy().to_string())
    })?;
    let cwd_val = cwd?;
    if messages.is_empty() {
        return None;
    }

    let total_count = messages.len();
    // Keep the first prompt + tail messages for responsive rendering
    let kept = if messages.len() > 36 {
        let mut slice = vec![messages[0].clone()];
        slice.extend_from_slice(&messages[messages.len() - 35..]);
        slice
    } else {
        messages
    };

    let first_user = kept
        .iter()
        .find(|m| m.sender_type == "user")
        .map(|m| m.content.as_str())
        .unwrap_or("Codex Session");
    let last_agent = kept
        .iter()
        .rev()
        .find(|m| m.sender_type == "agent")
        .map(|m| truncate_title(&m.content));

    let mtime = file_mtime_iso(path);
    let project_id = stable_project_id(&cwd_val);
    let project_name = folder_display_name(&cwd_val);

    Some(DiscoveredSession {
        id: format!("tsk_codex_{sid}"),
        provider: "codex".into(),
        provider_session_id: sid,
        project_id,
        project_name,
        cwd: cwd_val,
        git_branch,
        title: truncate_title(first_user),
        summary: last_agent,
        source_file: path.to_string_lossy().to_string(),
        message_count: total_count,
        messages: kept,
        created_at: created_at.unwrap_or_else(|| mtime.clone()),
        updated_at: updated_at.unwrap_or(mtime),
    })
}

/// Parses a local Claude Code JSONL transcript (`~/.claude/projects/<encoded>/<uuid>.jsonl`).
pub fn parse_claude_transcript(path: &Path) -> Option<DiscoveredSession> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut session_id: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut git_branch: Option<String> = None;
    let mut custom_title: Option<String> = None;
    let mut created_at: Option<String> = None;
    let mut updated_at: Option<String> = None;
    let mut messages: Vec<ImportedMessage> = Vec::new();
    let mut msg_idx = 0usize;

    for line_res in reader.lines().take(2000) {
        let Ok(line) = line_res else { continue };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };

        if session_id.is_none() {
            session_id = val
                .get("sessionId")
                .or_else(|| val.get("session_id"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }
        if cwd.is_none() {
            cwd = val
                .get("cwd")
                .and_then(|v| v.as_str())
                .map(normalize_cwd);
        }
        if git_branch.is_none() {
            git_branch = val
                .get("gitBranch")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }

        let ts = val
            .get("timestamp")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        if let Some(ref t) = ts {
            if created_at.is_none() {
                created_at = Some(t.clone());
            }
            updated_at = Some(t.clone());
        }

        let rec_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match rec_type {
            "custom-title" => {
                custom_title = val
                    .get("customTitle")
                    .or_else(|| val.get("title"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
            "user" => {
                if val.get("isMeta").and_then(|v| v.as_bool()).unwrap_or(false) {
                    continue;
                }
                if let Some(msg) = val.get("message") {
                    if let Some(text) = extract_content_text(msg) {
                        let clean = text.trim();
                        if !clean.is_empty() && !clean.starts_with("<command-name>") {
                            msg_idx += 1;
                            messages.push(ImportedMessage {
                                id: format!("imp_claude_{msg_idx}"),
                                sender_type: "user".into(),
                                kind: if msg_idx == 1 {
                                    "user_prompt".into()
                                } else {
                                    "user_followup".into()
                                },
                                content: truncate_message(clean, 4000),
                                created_at: ts.clone().unwrap_or_else(now_iso),
                            });
                        }
                    }
                }
            }
            "assistant" => {
                if let Some(msg) = val.get("message") {
                    if let Some(text) = extract_content_text(msg) {
                        let clean = text.trim();
                        if !clean.is_empty() {
                            msg_idx += 1;
                            messages.push(ImportedMessage {
                                id: format!("imp_claude_{msg_idx}"),
                                sender_type: "agent".into(),
                                kind: "agent_report".into(),
                                content: truncate_message(clean, 4000),
                                created_at: ts.clone().unwrap_or_else(now_iso),
                            });
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let sid = session_id.or_else(|| {
        path.file_stem()
            .map(|s| s.to_string_lossy().to_string())
    })?;
    let cwd_val = cwd?;
    if messages.is_empty() {
        return None;
    }

    let total_count = messages.len();
    let kept = if messages.len() > 36 {
        let mut slice = vec![messages[0].clone()];
        slice.extend_from_slice(&messages[messages.len() - 35..]);
        slice
    } else {
        messages
    };

    let first_user = kept
        .iter()
        .find(|m| m.sender_type == "user")
        .map(|m| m.content.as_str())
        .unwrap_or("Claude Code Session");
    let last_agent = kept
        .iter()
        .rev()
        .find(|m| m.sender_type == "agent")
        .map(|m| truncate_title(&m.content));

    let mtime = file_mtime_iso(path);
    let project_id = stable_project_id(&cwd_val);
    let project_name = folder_display_name(&cwd_val);

    Some(DiscoveredSession {
        id: format!("tsk_claude_{sid}"),
        provider: "claude_code".into(),
        provider_session_id: sid,
        project_id,
        project_name,
        cwd: cwd_val,
        git_branch,
        title: custom_title.unwrap_or_else(|| truncate_title(first_user)),
        summary: last_agent,
        source_file: path.to_string_lossy().to_string(),
        message_count: total_count,
        messages: kept,
        created_at: created_at.unwrap_or_else(|| mtime.clone()),
        updated_at: updated_at.unwrap_or(mtime),
    })
}

fn extract_content_text(obj: &serde_json::Value) -> Option<String> {
    if let Some(s) = obj.get("text").and_then(|v| v.as_str()) {
        return Some(s.to_string());
    }
    let content = obj.get("content")?;
    if let Some(s) = content.as_str() {
        return Some(s.to_string());
    }
    if let Some(arr) = content.as_array() {
        let mut parts = Vec::new();
        for block in arr {
            let btype = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if btype == "text" || btype == "input_text" || btype == "output_text" {
                if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                    if !t.trim().is_empty() {
                        parts.push(t.trim());
                    }
                }
            }
        }
        if !parts.is_empty() {
            return Some(parts.join("\n"));
        }
    }
    None
}

/// Scans the local machine (read-only) for Codex CLI & Claude Code projects and transcripts.
pub fn discover_local_environment(max_sessions: usize) -> LocalDiscoveryReport {
    let mut codex_roots: Vec<PathBuf> = Vec::new();
    let mut claude_roots: Vec<PathBuf> = Vec::new();

    if let Ok(ch) = std::env::var("CODEX_HOME") {
        let p = PathBuf::from(ch);
        if p.exists() {
            codex_roots.push(p);
        }
    }
    if let Ok(cc) = std::env::var("CLAUDE_CONFIG_DIR") {
        let p = PathBuf::from(cc);
        if p.exists() {
            claude_roots.push(p);
        }
    }

    if let Some(home) = user_home_dir() {
        let default_codex = home.join(".codex");
        if default_codex.exists() && !codex_roots.contains(&default_codex) {
            codex_roots.push(default_codex);
        }
        let default_claude = home.join(".claude");
        if default_claude.exists() && !claude_roots.contains(&default_claude) {
            claude_roots.push(default_claude);
        }
        let xdg_claude = home.join(".config").join("claude");
        if xdg_claude.exists() && !claude_roots.contains(&xdg_claude) {
            claude_roots.push(xdg_claude);
        }
    }

    let mut codex_files = Vec::new();
    for root in &codex_roots {
        collect_jsonl_files(&root.join("sessions"), &mut codex_files, false, 0);
    }

    let mut claude_files = Vec::new();
    for root in &claude_roots {
        collect_jsonl_files(&root.join("projects"), &mut claude_files, true, 0);
    }

    // Sort candidate files by mtime descending BEFORE parsing so even huge histories scan instantaneously
    let mut candidates: Vec<(&'static str, PathBuf, u64)> = Vec::new();
    for f in codex_files {
        let m = fs::metadata(&f)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        candidates.push(("codex", f, m));
    }
    for f in claude_files {
        let m = fs::metadata(&f)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        candidates.push(("claude_code", f, m));
    }
    candidates.sort_by(|a, b| b.2.cmp(&a.2));

    let scanned_files = candidates.len();
    let mut sessions = Vec::new();
    for (kind, path, _) in candidates.into_iter().take(max_sessions * 2) {
        if sessions.len() >= max_sessions {
            break;
        }
        let parsed = if kind == "codex" {
            parse_codex_rollout(&path)
        } else {
            parse_claude_transcript(&path)
        };
        if let Some(s) = parsed {
            sessions.push(s);
        }
    }

    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    // Aggregate deduplicated projects by normalized cwd
    let mut project_map: HashMap<String, DiscoveredProject> = HashMap::new();
    for s in &sessions {
        let entry = project_map
            .entry(s.project_id.clone())
            .or_insert_with(|| DiscoveredProject {
                id: s.project_id.clone(),
                name: s.project_name.clone(),
                path: s.cwd.clone(),
                git_branch: s.git_branch.clone(),
                providers: Vec::new(),
                session_count: 0,
                last_activity_at: s.updated_at.clone(),
            });
        entry.session_count += 1;
        if !entry.providers.contains(&s.provider) {
            entry.providers.push(s.provider.clone());
        }
        if s.updated_at > entry.last_activity_at {
            entry.last_activity_at = s.updated_at.clone();
        }
        if entry.git_branch.is_none() && s.git_branch.is_some() {
            entry.git_branch = s.git_branch.clone();
        }
    }

    let mut projects: Vec<DiscoveredProject> = project_map.into_values().collect();
    projects.sort_by(|a, b| b.last_activity_at.cmp(&a.last_activity_at));

    LocalDiscoveryReport {
        codex_home: codex_roots.first().map(|p| p.to_string_lossy().to_string()),
        claude_home: claude_roots.first().map(|p| p.to_string_lossy().to_string()),
        projects,
        sessions,
        scanned_files,
    }
}

/// Writes or updates the local `[mcp_servers.kangxi_local]` block inside `~/.codex/config.toml`
/// so local Codex CLI sessions can submit memorials to the desktop app with zero Cloudflare setup.
pub fn configure_codex_local_mcp(mcp_url: &str, token: &str) -> Result<String, String> {
    let codex_home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| user_home_dir().map(|h| h.join(".codex")))
        .ok_or_else(|| "Unable to resolve CODEX_HOME / user home directory".to_string())?;
    fs::create_dir_all(&codex_home).map_err(|e| e.to_string())?;
    let cfg_path = codex_home.join("config.toml");

    let existing = fs::read_to_string(&cfg_path).unwrap_or_default();
    let marker_start = "# BEGIN KANGXI LOCAL MCP";
    let marker_end = "# END KANGXI LOCAL MCP";
    let block = format!(
        "{marker_start}\n[mcp_servers.kangxi_local]\nurl = \"{mcp_url}\"\nhttp_headers = {{ Authorization = \"Bearer {token}\" }}\n{marker_end}\n"
    );

    let updated = if let (Some(s), Some(e)) = (existing.find(marker_start), existing.find(marker_end))
    {
        let after_end = e + marker_end.len();
        let tail = existing[after_end..].trim_start_matches(['\r', '\n']);
        format!("{}{block}{tail}", &existing[..s])
    } else if existing.is_empty() {
        block
    } else {
        format!("{}\n\n{block}", existing.trim_end())
    };

    fs::write(&cfg_path, updated).map_err(|e| e.to_string())?;
    Ok(cfg_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_codex_rollout_jsonl() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("rollout-2026-11-21-abc123.jsonl");
        let content = r#"{"timestamp":"2026-11-21T01:00:00Z","type":"session_meta","payload":{"id":"thread_001","cwd":"C:\\Users\\dev\\my-app","git":{"branch":"main"}}}
{"timestamp":"2026-11-21T01:00:05Z","type":"event_msg","payload":{"type":"user_message","message":"Refactor login middleware"}}
{"timestamp":"2026-11-21T01:00:40Z","type":"event_msg","payload":{"type":"agent_message","message":"Refactored auth middleware and verified tests."}}
"#;
        fs::write(&file, content).unwrap();

        let parsed = parse_codex_rollout(&file).expect("should parse codex rollout");
        assert_eq!(parsed.provider, "codex");
        assert_eq!(parsed.provider_session_id, "thread_001");
        assert_eq!(parsed.project_name, "my-app");
        assert_eq!(parsed.git_branch.as_deref(), Some("main"));
        assert_eq!(parsed.title, "Refactor login middleware");
        assert_eq!(parsed.messages.len(), 2);
    }

    #[test]
    fn imports_claude_code_transcript_jsonl() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sess-xyz-999.jsonl");
        let content = r#"{"type":"user","sessionId":"sess-xyz-999","cwd":"/home/dev/payments","gitBranch":"feat/webhooks","timestamp":"2026-11-21T02:00:00Z","message":{"role":"user","content":"Add idempotency check for webhooks"}}
{"type":"assistant","sessionId":"sess-xyz-999","cwd":"/home/dev/payments","timestamp":"2026-11-21T02:00:30Z","message":{"role":"assistant","content":[{"type":"text","text":"Added idempotency keys table and unit tests."}]}}
"#;
        fs::write(&file, content).unwrap();

        let parsed = parse_claude_transcript(&file).expect("should parse claude transcript");
        assert_eq!(parsed.provider, "claude_code");
        assert_eq!(parsed.provider_session_id, "sess-xyz-999");
        assert_eq!(parsed.project_name, "payments");
        assert_eq!(parsed.title, "Add idempotency check for webhooks");
        assert_eq!(parsed.messages.len(), 2);
    }
}
