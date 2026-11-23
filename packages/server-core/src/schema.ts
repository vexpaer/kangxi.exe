import type { SqlDatabase } from "./types.js";

/**
 * Canonical SQLite schema for both standalone Node servers (`node:sqlite`)
 * and Cloudflare D1. All statements are idempotent.
 */
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS owners (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT,
    password_hash TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    key TEXT PRIMARY KEY,
    failures INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    label TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('owner', 'device', 'bridge', 'mcp_agent')),
    device_platform TEXT,
    agent_id TEXT,
    bridge_id TEXT,
    allowed_project_ids_json TEXT,
    token_hash TEXT NOT NULL UNIQUE,
    token_prefix TEXT NOT NULL,
    fcm_token TEXT,
    last_used_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES owners(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_credentials_owner ON credentials(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_credentials_hash ON credentials(token_hash)`,
  `CREATE TABLE IF NOT EXISTS pairing_codes (
    code_hash TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    label TEXT NOT NULL,
    platform TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    redeemed_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES owners(id)
  )`,
  `CREATE TABLE IF NOT EXISTS bridges (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    hostname TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'windows',
    bridge_version TEXT NOT NULL DEFAULT '0.1.2',
    status TEXT NOT NULL CHECK (status IN ('online', 'offline')) DEFAULT 'offline',
    last_seen_at TEXT,
    providers_json TEXT NOT NULL DEFAULT '[]',
    authorized_project_ids_json TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES owners(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bridges_owner ON bridges(owner_id)`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    default_agent_id TEXT,
    bridge_id TEXT,
    host_label TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'api',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES owners(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id)`,
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude_code', 'mcp_external')),
    mode TEXT NOT NULL CHECK (mode IN ('bridge_managed', 'mcp_only')),
    bridge_id TEXT,
    capabilities_json TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'api',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES owners(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_id)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    bridge_id TEXT,
    mode TEXT NOT NULL CHECK (mode IN ('bridge_managed', 'mcp_only')),
    provider_session_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'idle', 'closed')) DEFAULT 'active',
    version INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'api',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES owners(id),
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    session_id TEXT,
    bridge_id TEXT,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting_for_user', 'paused', 'completed', 'failed', 'cancelled')),
    delivery_status TEXT NOT NULL CHECK (delivery_status IN ('queued', 'delivered', 'acknowledged', 'failed')) DEFAULT 'queued',
    resume_status TEXT NOT NULL CHECK (resume_status IN ('not_supported', 'waiting_for_bridge', 'resuming', 'resumed', 'resume_failed')) DEFAULT 'waiting_for_bridge',
    summary TEXT,
    error_message TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'api',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES owners(id),
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_owner_updated ON tasks(owner_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_bridge_status ON tasks(bridge_id, status)`,
  `CREATE TABLE IF NOT EXISTS task_messages (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    session_id TEXT,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'agent', 'bridge', 'system')),
    sender_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    truncated INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_task_messages_task ON task_messages(task_id, created_at ASC)`,
  `CREATE TABLE IF NOT EXISTS memorials (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    session_id TEXT,
    task_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    request_type TEXT NOT NULL DEFAULT 'approval',
    options_json TEXT NOT NULL DEFAULT '[]',
    risk_level TEXT NOT NULL DEFAULT 'low',
    risk_notes TEXT,
    context_summary TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'needs_info', 'superseded')) DEFAULT 'pending',
    delivery_status TEXT NOT NULL CHECK (delivery_status IN ('queued', 'delivered', 'acknowledged', 'failed')) DEFAULT 'queued',
    resume_status TEXT NOT NULL CHECK (resume_status IN ('not_supported', 'waiting_for_bridge', 'resuming', 'resumed', 'resume_failed')) DEFAULT 'not_supported',
    version INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'mcp',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES owners(id),
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memorials_owner_status ON memorials(owner_id, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_memorials_project ON memorials(project_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    memorial_id TEXT NOT NULL UNIQUE,
    action TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'needs_info', 'reply')),
    selected_option_id TEXT,
    comment TEXT NOT NULL,
    instructions TEXT,
    decided_by_device_id TEXT,
    decided_by_label TEXT NOT NULL,
    delivery_status TEXT NOT NULL CHECK (delivery_status IN ('queued', 'delivered', 'acknowledged', 'failed')) DEFAULT 'queued',
    resume_status TEXT NOT NULL CHECK (resume_status IN ('not_supported', 'waiting_for_bridge', 'resuming', 'resumed', 'resume_failed')) DEFAULT 'not_supported',
    bridge_claimed_at TEXT,
    agent_resumed_at TEXT,
    resume_error TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (memorial_id) REFERENCES memorials(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_memorial ON decisions(memorial_id)`,
  `CREATE TABLE IF NOT EXISTS events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    owner_id TEXT NOT NULL,
    type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    project_id TEXT,
    bridge_id TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    occurred_at TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (owner_id) REFERENCES owners(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_owner_seq ON events(owner_id, sequence ASC)`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
    owner_id TEXT NOT NULL,
    key TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, key)
  )`,
];

const ensuredDatabases = new WeakSet<SqlDatabase>();

/**
 * Ensures all tables and password-auth upgrade columns exist.
 * Safe to invoke on both fresh standalone SQLite files and existing v0.1.0/v0.1.1 D1 databases.
 */
export async function ensureSchema(db: SqlDatabase): Promise<void> {
  if (ensuredDatabases.has(db)) return;

  for (const sql of SCHEMA_STATEMENTS) {
    await db.prepare(sql).run();
  }

  // Upgrade older v0.1.0/v0.1.1 databases that predate username/password columns
  try {
    await db.prepare(`SELECT username, password_hash FROM owners LIMIT 1`).first();
  } catch {
    try {
      await db.prepare(`ALTER TABLE owners ADD COLUMN username TEXT`).run();
    } catch {
      // column already exists
    }
    try {
      await db.prepare(`ALTER TABLE owners ADD COLUMN password_hash TEXT`).run();
    } catch {
      // column already exists
    }
  }

  ensuredDatabases.add(db);
}
