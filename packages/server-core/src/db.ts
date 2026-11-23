import {
  SCHEMA_VERSION,
  decisionActionToMemorialStatus,
  type Agent,
  type BridgeHost,
  type CredentialRecord,
  type Decision,
  type DecisionAction,
  type DeliveryStatus,
  type Memorial,
  type MemorialOption,
  type MessageKind,
  type Project,
  type ResumeStatus,
  type Session,
  type SyncEvent,
  type SyncEventType,
  type Task,
  type TaskMessage,
  type TaskStatus,
} from "@kangxi/protocol";
import { newId } from "./auth.js";
import { sendOptionalFcmWake } from "./fcm.js";
import type { ServerEnv as Env } from "./types.js";

const MAX_LOG_MESSAGE_CHARS = 12_000;

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function mapProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    name: String(row.name),
    slug: String(row.slug),
    description: String(row.description ?? ""),
    default_agent_id: row.default_agent_id ? String(row.default_agent_id) : null,
    bridge_id: row.bridge_id ? String(row.bridge_id) : null,
    host_label: row.host_label ? String(row.host_label) : null,
    version: Number(row.version ?? 1),
    source: String(row.source ?? "api"),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function mapAgent(row: Record<string, unknown>): Agent {
  const caps = safeJsonParse<Agent["capabilities"]>(
    row.capabilities_json as string,
    {
      supports_resume: false,
      supports_streaming: false,
      supports_cancel: false,
    }
  );
  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    name: String(row.name),
    title: String(row.title ?? ""),
    provider: row.provider as Agent["provider"],
    mode: row.mode as Agent["mode"],
    bridge_id: row.bridge_id ? String(row.bridge_id) : null,
    capabilities: caps,
    version: Number(row.version ?? 1),
    source: String(row.source ?? "api"),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function mapBridge(row: Record<string, unknown>): BridgeHost {
  const lastSeen = row.last_seen_at ? String(row.last_seen_at) : null;
  let status = row.status as "online" | "offline";
  // Auto-mark stale bridges offline if heartbeat > 90s old
  if (status === "online" && lastSeen) {
    const ageMs = Date.now() - Date.parse(lastSeen);
    if (ageMs > 90_000) status = "offline";
  }
  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    name: String(row.name),
    hostname: String(row.hostname),
    platform: String(row.platform ?? "windows"),
    bridge_version: String(row.bridge_version ?? "0.1.0"),
    status,
    last_seen_at: lastSeen,
    providers: safeJsonParse(row.providers_json as string, []),
    authorized_project_ids: safeJsonParse(
      row.authorized_project_ids_json as string,
      []
    ),
    version: Number(row.version ?? 1),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function mapSession(row: Record<string, unknown>): Session {
  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    project_id: String(row.project_id),
    agent_id: String(row.agent_id),
    bridge_id: row.bridge_id ? String(row.bridge_id) : null,
    mode: row.mode as Session["mode"],
    provider_session_id: row.provider_session_id
      ? String(row.provider_session_id)
      : null,
    status: row.status as Session["status"],
    version: Number(row.version ?? 1),
    source: String(row.source ?? "api"),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function mapTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    project_id: String(row.project_id),
    agent_id: String(row.agent_id),
    session_id: row.session_id ? String(row.session_id) : null,
    bridge_id: row.bridge_id ? String(row.bridge_id) : null,
    title: String(row.title),
    prompt: String(row.prompt),
    status: row.status as TaskStatus,
    delivery_status: row.delivery_status as DeliveryStatus,
    resume_status: row.resume_status as ResumeStatus,
    summary: row.summary ? String(row.summary) : null,
    error_message: row.error_message ? String(row.error_message) : null,
    version: Number(row.version ?? 1),
    source: String(row.source ?? "api"),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function mapTaskMessage(row: Record<string, unknown>): TaskMessage {
  return {
    id: String(row.id),
    task_id: String(row.task_id),
    session_id: row.session_id ? String(row.session_id) : null,
    sender_type: row.sender_type as TaskMessage["sender_type"],
    sender_id: String(row.sender_id),
    kind: row.kind as MessageKind,
    content: String(row.content),
    metadata: safeJsonParse(row.metadata_json as string, {}),
    truncated: Boolean(row.truncated),
    created_at: String(row.created_at),
  };
}

export function mapDecision(row: Record<string, unknown>): Decision {
  return {
    id: String(row.id),
    memorial_id: String(row.memorial_id),
    action: row.action as DecisionAction,
    selected_option_id: row.selected_option_id
      ? String(row.selected_option_id)
      : null,
    comment: String(row.comment),
    instructions: row.instructions ? String(row.instructions) : null,
    decided_by_device_id: row.decided_by_device_id
      ? String(row.decided_by_device_id)
      : null,
    decided_by_label: String(row.decided_by_label),
    delivery_status: row.delivery_status as DeliveryStatus,
    resume_status: row.resume_status as ResumeStatus,
    bridge_claimed_at: row.bridge_claimed_at
      ? String(row.bridge_claimed_at)
      : null,
    agent_resumed_at: row.agent_resumed_at ? String(row.agent_resumed_at) : null,
    resume_error: row.resume_error ? String(row.resume_error) : null,
    version: Number(row.version ?? 1),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function mapMemorial(
  row: Record<string, unknown>,
  decision: Decision | null = null
): Memorial {
  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    project_id: String(row.project_id),
    agent_id: String(row.agent_id),
    session_id: row.session_id ? String(row.session_id) : null,
    task_id: row.task_id ? String(row.task_id) : null,
    title: String(row.title),
    content: String(row.content),
    request_type: row.request_type as Memorial["request_type"],
    options: safeJsonParse<MemorialOption[]>(row.options_json as string, []),
    risk_level: row.risk_level as Memorial["risk_level"],
    risk_notes: row.risk_notes ? String(row.risk_notes) : null,
    context_summary: row.context_summary ? String(row.context_summary) : null,
    status: row.status as Memorial["status"],
    delivery_status: row.delivery_status as DeliveryStatus,
    resume_status: row.resume_status as ResumeStatus,
    decision,
    version: Number(row.version ?? 1),
    source: String(row.source ?? "mcp"),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function mapCredential(row: Record<string, unknown>): CredentialRecord {
  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    label: String(row.label),
    scope: row.scope as CredentialRecord["scope"],
    device_platform: row.device_platform
      ? (String(row.device_platform) as CredentialRecord["device_platform"])
      : null,
    agent_id: row.agent_id ? String(row.agent_id) : null,
    bridge_id: row.bridge_id ? String(row.bridge_id) : null,
    allowed_project_ids: row.allowed_project_ids_json
      ? safeJsonParse<string[]>(row.allowed_project_ids_json as string, [])
      : null,
    token_prefix: String(row.token_prefix),
    last_used_at: row.last_used_at ? String(row.last_used_at) : null,
    revoked_at: row.revoked_at ? String(row.revoked_at) : null,
    created_at: String(row.created_at),
  };
}

export function mapEvent(row: Record<string, unknown>): SyncEvent {
  return {
    event_id: String(row.event_id),
    sequence: Number(row.sequence),
    type: row.type as SyncEventType,
    entity_id: String(row.entity_id),
    project_id: row.project_id ? String(row.project_id) : null,
    bridge_id: row.bridge_id ? String(row.bridge_id) : null,
    occurred_at: String(row.occurred_at),
    schema_version: SCHEMA_VERSION,
    payload: safeJsonParse<Record<string, unknown>>(
      row.payload_json as string,
      {}
    ),
  };
}

/**
 * Always persists the event to D1 FIRST, then notifies SyncHub Durable Object and optional FCM.
 */
export async function emitEvent(
  env: Env,
  params: {
    owner_id: string;
    type: SyncEventType;
    entity_id: string;
    project_id?: string | null;
    bridge_id?: string | null;
    payload?: Record<string, unknown>;
  }
): Promise<SyncEvent> {
  const eventId = newId("evt");
  const occurredAt = new Date().toISOString();
  const payload = params.payload ?? {};

  const insertRes = await env.DB.prepare(
    `INSERT INTO events (event_id, owner_id, type, entity_id, project_id, bridge_id, payload_json, occurred_at, schema_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      eventId,
      params.owner_id,
      params.type,
      params.entity_id,
      params.project_id ?? null,
      params.bridge_id ?? null,
      JSON.stringify(payload),
      occurredAt,
      SCHEMA_VERSION
    )
    .run();

  const sequence = Number(insertRes.meta?.last_row_id ?? 0);
  const event: SyncEvent = {
    event_id: eventId,
    sequence,
    type: params.type,
    entity_id: params.entity_id,
    project_id: params.project_id ?? null,
    bridge_id: params.bridge_id ?? null,
    occurred_at: occurredAt,
    schema_version: SCHEMA_VERSION,
    payload,
  };

  // Fan out via RealtimeHub (Cloudflare Durable Object or Node WebSocket Hub)
  try {
    if (env.REALTIME) {
      await env.REALTIME.broadcast(params.owner_id, event);
    }
  } catch {
    // Non-fatal: clients catch up via GET /api/v1/events?after=cursor
  }

  try {
    await sendOptionalFcmWake(env, params.owner_id, event);
  } catch {
    // Non-fatal optional push
  }

  return event;
}

export async function checkIdempotency<T>(
  env: Env,
  ownerId: string,
  key: string | null | undefined
): Promise<T | null> {
  if (!key) return null;
  const row = await env.DB.prepare(
    `SELECT response_json FROM idempotency_keys WHERE owner_id = ? AND key = ?`
  )
    .bind(ownerId, key)
    .first<{ response_json: string }>();
  if (!row) return null;
  return safeJsonParse<T | null>(row.response_json, null);
}

export async function saveIdempotency(
  env: Env,
  ownerId: string,
  key: string | null | undefined,
  response: unknown
): Promise<void> {
  if (!key) return;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO idempotency_keys (owner_id, key, response_json, created_at)
     VALUES (?, ?, ?, ?)`
  )
    .bind(ownerId, key, JSON.stringify(response), new Date().toISOString())
    .run();
}

export async function getMemorialWithDecision(
  env: Env,
  ownerId: string,
  memorialId: string
): Promise<Memorial | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM memorials WHERE id = ? AND owner_id = ?`
  )
    .bind(memorialId, ownerId)
    .first<Record<string, unknown>>();
  if (!row) return null;

  const decRow = await env.DB.prepare(
    `SELECT * FROM decisions WHERE memorial_id = ?`
  )
    .bind(memorialId)
    .first<Record<string, unknown>>();

  return mapMemorial(row, decRow ? mapDecision(decRow) : null);
}

export async function listMemorialsWithDecisions(
  env: Env,
  ownerId: string,
  filters?: {
    status?: string;
    project_id?: string;
    q?: string;
    limit?: number;
  }
): Promise<Memorial[]> {
  const clauses = ["owner_id = ?"];
  const binds: unknown[] = [ownerId];

  if (filters?.status && filters.status !== "all") {
    clauses.push("status = ?");
    binds.push(filters.status);
  }
  if (filters?.project_id) {
    clauses.push("project_id = ?");
    binds.push(filters.project_id);
  }
  if (filters?.q) {
    clauses.push("(title LIKE ? OR content LIKE ?)");
    const like = `%${filters.q}%`;
    binds.push(like, like);
  }

  const limit = Math.min(Math.max(filters?.limit ?? 100, 1), 200);
  const memRows = await env.DB.prepare(
    `SELECT * FROM memorials WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`
  )
    .bind(...binds, limit)
    .all<Record<string, unknown>>();

  const rows = memRows.results ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => String(r.id));
  const placeholders = ids.map(() => "?").join(",");
  const decRows = await env.DB.prepare(
    `SELECT * FROM decisions WHERE memorial_id IN (${placeholders})`
  )
    .bind(...ids)
    .all<Record<string, unknown>>();

  const decMap = new Map<string, Decision>();
  for (const d of decRows.results ?? []) {
    const mapped = mapDecision(d);
    decMap.set(mapped.memorial_id, mapped);
  }

  return rows.map((r) => mapMemorial(r, decMap.get(String(r.id)) ?? null));
}

export async function createMemorialRecord(
  env: Env,
  params: {
    owner_id: string;
    project_id: string;
    agent_id: string;
    session_id?: string | null;
    task_id?: string | null;
    title: string;
    content: string;
    request_type: Memorial["request_type"];
    options: MemorialOption[];
    risk_level: Memorial["risk_level"];
    risk_notes?: string | null;
    context_summary?: string | null;
    source: string;
    idempotency_key?: string | null;
  }
): Promise<Memorial> {
  const cached = await checkIdempotency<Memorial>(
    env,
    params.owner_id,
    params.idempotency_key
  );
  if (cached) return cached;

  const now = new Date().toISOString();
  const id = newId("mem");

  // Determine whether the target agent/session supports Bridge-managed resume
  let resumeStatus: ResumeStatus = "not_supported";
  let bridgeId: string | null = null;
  if (params.session_id) {
    const sess = await env.DB.prepare(
      `SELECT mode, bridge_id, provider_session_id FROM sessions WHERE id = ? AND owner_id = ?`
    )
      .bind(params.session_id, params.owner_id)
      .first<{
        mode: string;
        bridge_id: string | null;
        provider_session_id: string | null;
      }>();
    if (sess && sess.mode === "bridge_managed" && sess.bridge_id) {
      resumeStatus = "waiting_for_bridge";
      bridgeId = sess.bridge_id;
    }
  } else {
    const agent = await env.DB.prepare(
      `SELECT mode, bridge_id, capabilities_json FROM agents WHERE id = ? AND owner_id = ?`
    )
      .bind(params.agent_id, params.owner_id)
      .first<{
        mode: string;
        bridge_id: string | null;
        capabilities_json: string;
      }>();
    if (agent && agent.mode === "bridge_managed" && agent.bridge_id) {
      const caps = safeJsonParse<{ supports_resume?: boolean }>(
        agent.capabilities_json,
        {}
      );
      if (caps.supports_resume) {
        resumeStatus = "waiting_for_bridge";
        bridgeId = agent.bridge_id;
      }
    }
  }

  await env.DB.prepare(
    `INSERT INTO memorials (
      id, owner_id, project_id, agent_id, session_id, task_id,
      title, content, request_type, options_json, risk_level, risk_notes, context_summary,
      status, delivery_status, resume_status, version, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'queued', ?, 1, ?, ?, ?)`
  )
    .bind(
      id,
      params.owner_id,
      params.project_id,
      params.agent_id,
      params.session_id ?? null,
      params.task_id ?? null,
      params.title,
      params.content,
      params.request_type,
      JSON.stringify(params.options ?? []),
      params.risk_level,
      params.risk_notes ?? null,
      params.context_summary ?? null,
      resumeStatus,
      params.source,
      now,
      now
    )
    .run();

  if (params.task_id) {
    await env.DB.prepare(
      `UPDATE tasks SET status = 'waiting_for_user', version = version + 1, updated_at = ? WHERE id = ? AND owner_id = ?`
    )
      .bind(now, params.task_id, params.owner_id)
      .run();

    await appendTaskMessageRecord(env, {
      owner_id: params.owner_id,
      task_id: params.task_id,
      session_id: params.session_id ?? null,
      sender_type: "agent",
      sender_id: params.agent_id,
      kind: "memorial_notice",
      content: `[Memorial ${id}] ${params.title}\n\n${params.content}`,
      metadata: { memorial_id: id, risk_level: params.risk_level },
    });
  }

  const created = (await getMemorialWithDecision(env, params.owner_id, id))!;
  await saveIdempotency(env, params.owner_id, params.idempotency_key, created);

  await emitEvent(env, {
    owner_id: params.owner_id,
    type: "memorial.created",
    entity_id: id,
    project_id: params.project_id,
    bridge_id: bridgeId,
    payload: {
      memorial_id: id,
      title: params.title,
      risk_level: params.risk_level,
      agent_id: params.agent_id,
      task_id: params.task_id ?? null,
    },
  });

  return created;
}

export async function recordDecisionWithOptimisticLock(
  env: Env,
  params: {
    owner_id: string;
    memorial_id: string;
    action: DecisionAction;
    selected_option_id?: string | null;
    comment: string;
    instructions?: string | null;
    expected_version: number;
    decided_by_device_id: string | null;
    decided_by_label: string;
    idempotency_key?: string | null;
  }
): Promise<
  | { ok: true; memorial: Memorial }
  | { ok: false; reason: "not_found" | "conflict"; current?: Memorial }
> {
  const cached = await checkIdempotency<{ ok: true; memorial: Memorial }>(
    env,
    params.owner_id,
    params.idempotency_key
  );
  if (cached) return cached;

  const existing = await getMemorialWithDecision(
    env,
    params.owner_id,
    params.memorial_id
  );
  if (!existing) {
    return { ok: false, reason: "not_found" };
  }

  const nextStatus = decisionActionToMemorialStatus(params.action);
  const now = new Date().toISOString();

  // Check if a bridge can claim and resume this session
  let bridgeId: string | null = null;
  let resumeStatus: ResumeStatus = "not_supported";
  if (existing.session_id) {
    const sess = await env.DB.prepare(
      `SELECT mode, bridge_id FROM sessions WHERE id = ? AND owner_id = ?`
    )
      .bind(existing.session_id, params.owner_id)
      .first<{ mode: string; bridge_id: string | null }>();
    if (sess?.mode === "bridge_managed" && sess.bridge_id) {
      bridgeId = sess.bridge_id;
      resumeStatus = "waiting_for_bridge";
    }
  } else if (existing.resume_status === "waiting_for_bridge") {
    const proj = await env.DB.prepare(
      `SELECT bridge_id FROM projects WHERE id = ? AND owner_id = ?`
    )
      .bind(existing.project_id, params.owner_id)
      .first<{ bridge_id: string | null }>();
    bridgeId = proj?.bridge_id ?? null;
    if (bridgeId) resumeStatus = "waiting_for_bridge";
  }

  const deliveryStatus: DeliveryStatus =
    resumeStatus === "waiting_for_bridge" ? "queued" : "acknowledged";

  // Conditional version update prevents double-approval from two devices
  const updateRes = await env.DB.prepare(
    `UPDATE memorials
     SET status = ?, delivery_status = ?, resume_status = ?, version = version + 1, updated_at = ?
     WHERE id = ? AND owner_id = ? AND version = ? AND status = 'pending'`
  )
    .bind(
      nextStatus,
      deliveryStatus,
      resumeStatus,
      now,
      params.memorial_id,
      params.owner_id,
      params.expected_version
    )
    .run();

  if (Number(updateRes.meta?.changes ?? 0) === 0) {
    const current = await getMemorialWithDecision(
      env,
      params.owner_id,
      params.memorial_id
    );
    return { ok: false, reason: "conflict", current: current ?? undefined };
  }

  const decisionId = newId("dec");
  await env.DB.prepare(
    `INSERT INTO decisions (
      id, memorial_id, action, selected_option_id, comment, instructions,
      decided_by_device_id, decided_by_label, delivery_status, resume_status,
      version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  )
    .bind(
      decisionId,
      params.memorial_id,
      params.action,
      params.selected_option_id ?? null,
      params.comment,
      params.instructions ?? null,
      params.decided_by_device_id,
      params.decided_by_label,
      deliveryStatus,
      resumeStatus,
      now,
      now
    )
    .run();

  if (existing.task_id) {
    await appendTaskMessageRecord(env, {
      owner_id: params.owner_id,
      task_id: existing.task_id,
      session_id: existing.session_id,
      sender_type: "user",
      sender_id: params.decided_by_device_id ?? "owner",
      kind: "decision_notice",
      content: `[${params.action.toUpperCase()}] ${params.comment}${
        params.instructions ? `\n\nInstructions: ${params.instructions}` : ""
      }`,
      metadata: {
        memorial_id: params.memorial_id,
        decision_id: decisionId,
        action: params.action,
      },
    });
  }

  const updated = (await getMemorialWithDecision(
    env,
    params.owner_id,
    params.memorial_id
  ))!;
  const result = { ok: true as const, memorial: updated };
  await saveIdempotency(env, params.owner_id, params.idempotency_key, result);

  await emitEvent(env, {
    owner_id: params.owner_id,
    type: "decision.created",
    entity_id: params.memorial_id,
    project_id: existing.project_id,
    bridge_id: bridgeId,
    payload: {
      memorial_id: params.memorial_id,
      decision_id: decisionId,
      task_id: existing.task_id,
      session_id: existing.session_id,
      agent_id: existing.agent_id,
      action: params.action,
      selected_option_id: params.selected_option_id ?? null,
      comment: params.comment,
      instructions: params.instructions ?? null,
      resume_status: resumeStatus,
    },
  });

  return result;
}

export async function appendTaskMessageRecord(
  env: Env,
  params: {
    owner_id: string;
    task_id: string;
    session_id?: string | null;
    sender_type: TaskMessage["sender_type"];
    sender_id: string;
    kind: MessageKind;
    content: string;
    metadata?: Record<string, unknown>;
    emit?: boolean;
  }
): Promise<TaskMessage> {
  const id = newId("msg");
  const now = new Date().toISOString();
  let content = params.content;
  let truncated = false;
  if (content.length > MAX_LOG_MESSAGE_CHARS) {
    content = `${content.slice(0, MAX_LOG_MESSAGE_CHARS)}\n\n...[truncated for D1 storage limit; export full logs from local Bridge]`;
    truncated = true;
  }

  await env.DB.prepare(
    `INSERT INTO task_messages (id, task_id, session_id, sender_type, sender_id, kind, content, metadata_json, truncated, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      params.task_id,
      params.session_id ?? null,
      params.sender_type,
      params.sender_id,
      params.kind,
      content,
      JSON.stringify(params.metadata ?? {}),
      truncated ? 1 : 0,
      now
    )
    .run();

  const message: TaskMessage = {
    id,
    task_id: params.task_id,
    session_id: params.session_id ?? null,
    sender_type: params.sender_type,
    sender_id: params.sender_id,
    kind: params.kind,
    content,
    metadata: params.metadata ?? {},
    truncated,
    created_at: now,
  };

  if (params.emit) {
    const taskRow = await env.DB.prepare(
      `SELECT project_id, bridge_id FROM tasks WHERE id = ? AND owner_id = ?`
    )
      .bind(params.task_id, params.owner_id)
      .first<{ project_id: string; bridge_id: string | null }>();

    await emitEvent(env, {
      owner_id: params.owner_id,
      type: "task.message.created",
      entity_id: params.task_id,
      project_id: taskRow?.project_id ?? null,
      bridge_id: taskRow?.bridge_id ?? null,
      payload: {
        task_id: params.task_id,
        message_id: id,
        kind: params.kind,
        sender_type: params.sender_type,
        content: params.kind === "user_followup" ? content : undefined,
      },
    });
  }

  return message;
}
