import {
  AppendTaskMessageRequestSchema,
  BootstrapRequestSchema,
  BridgeDeliveryAckRequestSchema,
  BridgeRegisterRequestSchema,
  CreateAgentRequestSchema,
  CreateCredentialRequestSchema,
  CreateMemorialRequestSchema,
  CreatePairingRequestSchema,
  CreateProjectRequestSchema,
  CreateTaskRequestSchema,
  RedeemPairingRequestSchema,
  SubmitDecisionRequestSchema,
  SubmitReportRequestSchema,
  TaskStatusSchema,
  type Agent,
  type CredentialRecord,
  type Project,
} from "@kangxi/protocol";
import { z } from "zod";
import {
  authenticateRequest,
  canAccessProject,
  generatePairingCode,
  generateSecretToken,
  newId,
  sha256Hex,
} from "./auth.ts";
import {
  appendTaskMessageRecord,
  checkIdempotency,
  createMemorialRecord,
  emitEvent,
  getMemorialWithDecision,
  listMemorialsWithDecisions,
  mapAgent,
  mapBridge,
  mapCredential,
  mapEvent,
  mapProject,
  mapTask,
  mapTaskMessage,
  recordDecisionWithOptimisticLock,
  saveIdempotency,
} from "./db.ts";
import { SyncHub } from "./hub.ts";
import { handleMcpRequest } from "./mcp.ts";
import type { AuthContext, Env } from "./types.ts";

export { SyncHub };

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Idempotency-Key, MCP-Session-Id, Accept",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function errorJson(
  status: number,
  code: string,
  error: string,
  extra?: Record<string, unknown>
): Response {
  return json({ code, error, ...(extra ?? {}) }, status);
}

async function parseJson<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema
): Promise<{ ok: true; data: z.output<TSchema> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: errorJson(400, "INVALID_JSON", "Request body must be valid JSON"),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: errorJson(400, "VALIDATION_ERROR", parsed.error.message, {
        issues: parsed.error.issues,
      }),
    };
  }
  return { ok: true, data: parsed.data as z.output<TSchema> };
}

function requireScopes(
  auth: AuthContext,
  allowed: Array<AuthContext["scope"]>
): Response | null {
  if (!allowed.includes(auth.scope)) {
    return errorJson(
      403,
      "FORBIDDEN_SCOPE",
      `Scope '${auth.scope}' is not allowed for this operation`
    );
  }
  return null;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "project";
}

function landingHtml(version: string): Response {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>KangXi.exe — Backend Online</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#120d0a;color:#f4e9d8;font-family:system-ui,-apple-system,sans-serif}
    .card{max-width:520px;padding:32px;border-radius:14px;background:rgba(32,20,15,.92);border:1px solid rgba(214,173,96,.35);box-shadow:0 20px 60px rgba(0,0,0,.5)}
    .seal{display:inline-block;padding:4px 10px;border:2px solid #c9372c;color:#e85d50;font-weight:700;letter-spacing:2px;border-radius:4px;margin-bottom:14px}
    h1{margin:0 0 8px;font-size:24px;color:#f5d796}
    p{color:#cbbba4;line-height:1.6;font-size:14px}
    code{background:rgba(255,255,255,.08);padding:2px 6px;border-radius:4px;color:#ffdca0}
  </style>
</head>
<body>
  <main class="card">
    <div class="seal">御批中枢 · 在线</div>
    <h1>KangXi.exe Cloudflare Backend</h1>
    <p>Self-hosted Cloudflare Worker + D1 + SQLite Durable Object instance (<code>v${version}</code>).</p>
    <p>Copy this URL into your <strong>KangXi.exe Windows / Android</strong> client, or connect MCP agents to <code>/mcp</code>.</p>
    <p>Health endpoint: <code>GET /health</code></p>
  </main>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const BridgeTaskUpdateSchema = z.object({
  status: TaskStatusSchema.optional(),
  delivery_status: z.enum(["queued", "delivered", "acknowledged", "failed"]).optional(),
  resume_status: z
    .enum([
      "not_supported",
      "waiting_for_bridge",
      "resuming",
      "resumed",
      "resume_failed",
    ])
    .optional(),
  provider_session_id: z.string().nullable().optional(),
  summary: z.string().max(4000).nullable().optional(),
  error_message: z.string().max(4000).nullable().optional(),
  log_chunk: z.string().max(24000).optional(),
  message_kind: z
    .enum(["agent_report", "agent_log", "task_result", "system"])
    .optional(),
});

export async function handleFetch(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  // Public health & status
  if (path === "/" && request.method === "GET") {
    return landingHtml(env.APP_VERSION ?? "0.1.0");
  }

  if (path === "/health" && request.method === "GET") {
    const ownerRow = await env.DB.prepare(`SELECT id FROM owners LIMIT 1`).first();
    return json({
      ok: true,
      service: "kangxi-backend",
      version: env.APP_VERSION ?? "0.1.0",
      bootstrapped: Boolean(ownerRow),
    });
  }

  // First-time owner bootstrap (single-owner setup)
  if (path === "/api/v1/bootstrap" && request.method === "POST") {
    const parsed = await parseJson(request, BootstrapRequestSchema);
    if (!parsed.ok) return parsed.response;

    const existingOwner = await env.DB.prepare(`SELECT id FROM owners LIMIT 1`).first();
    if (existingOwner) {
      return errorJson(
        409,
        "ALREADY_BOOTSTRAPPED",
        "This instance is already initialized. Sign in with an existing token or pairing code."
      );
    }

    if (
      env.BOOTSTRAP_SECRET &&
      parsed.data.bootstrap_secret !== env.BOOTSTRAP_SECRET
    ) {
      return errorJson(403, "INVALID_BOOTSTRAP_SECRET", "Invalid bootstrap secret");
    }

    const now = new Date().toISOString();
    const ownerId = newId("own");
    const credId = newId("crd");
    const token = generateSecretToken("own");
    const tokenHash = await sha256Hex(token);

    await env.DB.prepare(
      `INSERT INTO owners (id, name, created_at) VALUES (?, ?, ?)`
    )
      .bind(ownerId, parsed.data.owner_name, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO credentials (
        id, owner_id, label, scope, device_platform, token_hash, token_prefix, created_at
      ) VALUES (?, ?, ?, 'owner', ?, ?, ?, ?)`
    )
      .bind(
        credId,
        ownerId,
        parsed.data.device_label,
        parsed.data.platform,
        tokenHash,
        token.slice(0, 12),
        now
      )
      .run();

    // Seed default project + starter agents (Codex, Claude Code, MCP External)
    const projId = newId("prj");
    const codexId = newId("agt");
    const claudeId = newId("agt");
    const mcpAgentId = newId("agt");

    const defaultAgents: Agent[] = [
      {
        id: codexId,
        owner_id: ownerId,
        name: "Codex",
        title: "军机处 · 编修",
        provider: "codex",
        mode: "bridge_managed",
        bridge_id: null,
        capabilities: {
          supports_resume: true,
          supports_streaming: true,
          supports_cancel: true,
          notes: "Runs via local Windows Bridge (`codex exec --json` / `codex exec resume`).",
        },
        version: 1,
        source: "bootstrap",
        created_at: now,
        updated_at: now,
      },
      {
        id: claudeId,
        owner_id: ownerId,
        name: "Claude Code",
        title: "内阁 · 大学士",
        provider: "claude_code",
        mode: "bridge_managed",
        bridge_id: null,
        capabilities: {
          supports_resume: true,
          supports_streaming: true,
          supports_cancel: true,
          notes: "Runs via local Windows Bridge (`claude -p --output-format stream-json --resume`).",
        },
        version: 1,
        source: "bootstrap",
        created_at: now,
        updated_at: now,
      },
      {
        id: mcpAgentId,
        owner_id: ownerId,
        name: "External MCP Agent",
        title: "外派 · 钦差",
        provider: "mcp_external",
        mode: "mcp_only",
        bridge_id: null,
        capabilities: {
          supports_resume: false,
          supports_streaming: false,
          supports_cancel: false,
          notes: "MCP-only agent: submits memorials and polls get_memorial_reply autonomously.",
        },
        version: 1,
        source: "bootstrap",
        created_at: now,
        updated_at: now,
      },
    ];

    for (const ag of defaultAgents) {
      await env.DB.prepare(
        `INSERT INTO agents (id, owner_id, name, title, provider, mode, bridge_id, capabilities_json, version, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'bootstrap', ?, ?)`
      )
        .bind(
          ag.id,
          ag.owner_id,
          ag.name,
          ag.title,
          ag.provider,
          ag.mode,
          ag.bridge_id,
          JSON.stringify(ag.capabilities),
          now,
          now
        )
        .run();
    }

    await env.DB.prepare(
      `INSERT INTO projects (id, owner_id, name, slug, description, default_agent_id, bridge_id, host_label, version, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 1, 'bootstrap', ?, ?)`
    )
      .bind(
        projId,
        ownerId,
        "Default Workspace",
        "default-workspace",
        "Bind this project to a local Windows folder in Bridge settings.",
        codexId,
        now,
        now
      )
      .run();

    const defaultProject: Project = {
      id: projId,
      owner_id: ownerId,
      name: "Default Workspace",
      slug: "default-workspace",
      description: "Bind this project to a local Windows folder in Bridge settings.",
      default_agent_id: codexId,
      bridge_id: null,
      host_label: null,
      version: 1,
      source: "bootstrap",
      created_at: now,
      updated_at: now,
    };

    const credential: CredentialRecord = {
      id: credId,
      owner_id: ownerId,
      label: parsed.data.device_label,
      scope: "owner",
      device_platform: parsed.data.platform,
      agent_id: null,
      bridge_id: null,
      allowed_project_ids: null,
      token_prefix: token.slice(0, 12),
      last_used_at: null,
      revoked_at: null,
      created_at: now,
    };

    return json(
      {
        owner: { id: ownerId, name: parsed.data.owner_name },
        token,
        credential,
        default_project: defaultProject,
        default_agents: defaultAgents,
      },
      201
    );
  }

  // Pairing redemption (unauthenticated, exchanges single-use short-lived code for scoped device token)
  if (path === "/api/v1/pairing/redeem" && request.method === "POST") {
    const parsed = await parseJson(request, RedeemPairingRequestSchema);
    if (!parsed.ok) return parsed.response;

    const codeHash = await sha256Hex(parsed.data.pairing_code.trim().toUpperCase());
    const row = await env.DB.prepare(
      `SELECT code_hash, owner_id, label, platform, expires_at, redeemed_at
       FROM pairing_codes WHERE code_hash = ?`
    )
      .bind(codeHash)
      .first<{
        code_hash: string;
        owner_id: string;
        label: string;
        platform: string;
        expires_at: string;
        redeemed_at: string | null;
      }>();

    if (!row || row.redeemed_at !== null) {
      return errorJson(401, "INVALID_PAIRING_CODE", "Pairing code is invalid or already used");
    }
    if (Date.parse(row.expires_at) < Date.now()) {
      return errorJson(401, "EXPIRED_PAIRING_CODE", "Pairing code has expired");
    }

    const now = new Date().toISOString();
    const markRes = await env.DB.prepare(
      `UPDATE pairing_codes SET redeemed_at = ? WHERE code_hash = ? AND redeemed_at IS NULL`
    )
      .bind(now, codeHash)
      .run();

    if (Number(markRes.meta?.changes ?? 0) === 0) {
      return errorJson(401, "ALREADY_REDEEMED", "Pairing code was already redeemed");
    }

    const credId = newId("crd");
    const token = generateSecretToken("dev");
    const tokenHash = await sha256Hex(token);
    const label = parsed.data.device_label || row.label;
    const platform = parsed.data.platform || row.platform;

    await env.DB.prepare(
      `INSERT INTO credentials (
        id, owner_id, label, scope, device_platform, token_hash, token_prefix, fcm_token, created_at
      ) VALUES (?, ?, ?, 'device', ?, ?, ?, ?, ?)`
    )
      .bind(
        credId,
        row.owner_id,
        label,
        platform,
        tokenHash,
        token.slice(0, 12),
        parsed.data.fcm_token ?? null,
        now
      )
      .run();

    const owner = await env.DB.prepare(`SELECT id, name FROM owners WHERE id = ?`)
      .bind(row.owner_id)
      .first<{ id: string; name: string }>();

    const credRow = await env.DB.prepare(`SELECT * FROM credentials WHERE id = ?`)
      .bind(credId)
      .first<Record<string, unknown>>();

    return json(
      {
        token,
        credential: mapCredential(credRow!),
        owner: owner ?? { id: row.owner_id, name: "陛下" },
      },
      201
    );
  }

  // All remaining routes require a valid, unrevoked Bearer credential
  const auth = await authenticateRequest(request, env);
  if (!auth) {
    return errorJson(401, "UNAUTHORIZED", "Missing, invalid, or revoked credentials");
  }

  // Streamable HTTP MCP Endpoint
  if (path === "/mcp") {
    return handleMcpRequest(request, env, auth);
  }

  // WebSocket Upgrade via Durable Object
  if (path === "/api/v1/ws" && request.method === "GET") {
    if (request.headers.get("Upgrade") !== "websocket") {
      return errorJson(426, "UPGRADE_REQUIRED", "Expected WebSocket upgrade");
    }
    const stubId = env.SYNC_HUB.idFromName(auth.owner_id);
    const stub = env.SYNC_HUB.get(stubId);
    const hubUrl = new URL("https://sync-hub/ws");
    hubUrl.searchParams.set("owner_id", auth.owner_id);
    hubUrl.searchParams.set("credential_id", auth.credential_id);
    hubUrl.searchParams.set("scope", auth.scope);
    if (auth.bridge_id) hubUrl.searchParams.set("bridge_id", auth.bridge_id);
    return stub.fetch(new Request(hubUrl.toString(), request));
  }

  // Workspace snapshot for initial sync
  if (path === "/api/v1/snapshot" && request.method === "GET") {
    const forbidden = requireScopes(auth, ["owner", "device", "bridge"]);
    if (forbidden) return forbidden;

    const owner = await env.DB.prepare(`SELECT id, name FROM owners WHERE id = ?`)
      .bind(auth.owner_id)
      .first<{ id: string; name: string }>();

    const [projRes, agentRes, bridgeRes, taskRes, credRes, seqRow, memorials] =
      await Promise.all([
        env.DB.prepare(
          `SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at ASC`
        )
          .bind(auth.owner_id)
          .all<Record<string, unknown>>(),
        env.DB.prepare(
          `SELECT * FROM agents WHERE owner_id = ? ORDER BY created_at ASC`
        )
          .bind(auth.owner_id)
          .all<Record<string, unknown>>(),
        env.DB.prepare(
          `SELECT * FROM bridges WHERE owner_id = ? ORDER BY updated_at DESC`
        )
          .bind(auth.owner_id)
          .all<Record<string, unknown>>(),
        env.DB.prepare(
          `SELECT * FROM tasks WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100`
        )
          .bind(auth.owner_id)
          .all<Record<string, unknown>>(),
        env.DB.prepare(
          `SELECT * FROM credentials WHERE owner_id = ? ORDER BY created_at DESC`
        )
          .bind(auth.owner_id)
          .all<Record<string, unknown>>(),
        env.DB.prepare(
          `SELECT COALESCE(MAX(sequence), 0) AS latest_seq FROM events WHERE owner_id = ?`
        )
          .bind(auth.owner_id)
          .first<{ latest_seq: number }>(),
        listMemorialsWithDecisions(env, auth.owner_id, { limit: 100 }),
      ]);

    return json({
      owner: owner ?? { id: auth.owner_id, name: "陛下" },
      projects: (projRes.results ?? []).map(mapProject),
      agents: (agentRes.results ?? []).map(mapAgent),
      bridges: (bridgeRes.results ?? []).map(mapBridge),
      memorials,
      tasks: (taskRes.results ?? []).map(mapTask),
      credentials:
        auth.scope === "owner" || auth.scope === "device"
          ? (credRes.results ?? []).map(mapCredential)
          : [],
      latest_sequence: Number(seqRow?.latest_seq ?? 0),
    });
  }

  // Event Cursor Catch-Up (SPEC 5.3)
  if (path === "/api/v1/events" && request.method === "GET") {
    const after = Math.max(0, Number(url.searchParams.get("after") ?? "0") || 0);
    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit") ?? "100") || 100, 1),
      500
    );

    const rows = await env.DB.prepare(
      `SELECT * FROM events WHERE owner_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?`
    )
      .bind(auth.owner_id, after, limit)
      .all<Record<string, unknown>>();

    const events = (rows.results ?? []).map(mapEvent);
    const latestSeq =
      events.length > 0 ? events[events.length - 1]!.sequence : after;
    return json({ events, latest_sequence: latestSeq });
  }

  // Projects
  if (path === "/api/v1/projects" && request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at ASC`
    )
      .bind(auth.owner_id)
      .all<Record<string, unknown>>();
    return json({ projects: (rows.results ?? []).map(mapProject) });
  }

  if (path === "/api/v1/projects" && request.method === "POST") {
    const forbidden = requireScopes(auth, ["owner", "device", "bridge"]);
    if (forbidden) return forbidden;
    const parsed = await parseJson(request, CreateProjectRequestSchema);
    if (!parsed.ok) return parsed.response;

    const now = new Date().toISOString();
    const id = newId("prj");
    const slug = parsed.data.slug || slugify(parsed.data.name);

    await env.DB.prepare(
      `INSERT INTO projects (id, owner_id, name, slug, description, default_agent_id, bridge_id, host_label, version, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    )
      .bind(
        id,
        auth.owner_id,
        parsed.data.name,
        slug,
        parsed.data.description ?? "",
        parsed.data.default_agent_id ?? null,
        parsed.data.bridge_id ?? null,
        parsed.data.host_label ?? null,
        auth.scope,
        now,
        now
      )
      .run();

    const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`)
      .bind(id)
      .first<Record<string, unknown>>();
    const project = mapProject(row!);

    await emitEvent(env, {
      owner_id: auth.owner_id,
      type: "project.updated",
      entity_id: id,
      project_id: id,
      payload: { name: project.name },
    });

    return json({ project }, 201);
  }

  // Agents
  if (path === "/api/v1/agents" && request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT * FROM agents WHERE owner_id = ? ORDER BY created_at ASC`
    )
      .bind(auth.owner_id)
      .all<Record<string, unknown>>();
    return json({ agents: (rows.results ?? []).map(mapAgent) });
  }

  if (path === "/api/v1/agents" && request.method === "POST") {
    const forbidden = requireScopes(auth, ["owner", "device", "bridge"]);
    if (forbidden) return forbidden;
    const parsed = await parseJson(request, CreateAgentRequestSchema);
    if (!parsed.ok) return parsed.response;

    const now = new Date().toISOString();
    const id = newId("agt");
    const capabilities = {
      supports_resume:
        parsed.data.supports_resume ?? parsed.data.mode === "bridge_managed",
      supports_streaming:
        parsed.data.supports_streaming ?? parsed.data.mode === "bridge_managed",
      supports_cancel:
        parsed.data.supports_cancel ?? parsed.data.mode === "bridge_managed",
      notes: parsed.data.notes,
    };

    await env.DB.prepare(
      `INSERT INTO agents (id, owner_id, name, title, provider, mode, bridge_id, capabilities_json, version, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    )
      .bind(
        id,
        auth.owner_id,
        parsed.data.name,
        parsed.data.title ?? "",
        parsed.data.provider,
        parsed.data.mode,
        parsed.data.bridge_id ?? null,
        JSON.stringify(capabilities),
        auth.scope,
        now,
        now
      )
      .run();

    const row = await env.DB.prepare(`SELECT * FROM agents WHERE id = ?`)
      .bind(id)
      .first<Record<string, unknown>>();
    const agent = mapAgent(row!);

    await emitEvent(env, {
      owner_id: auth.owner_id,
      type: "agent.updated",
      entity_id: id,
      payload: { name: agent.name, provider: agent.provider },
    });

    return json({ agent }, 201);
  }

  // Memorials list & create
  if (path === "/api/v1/memorials" && request.method === "GET") {
    const memorials = await listMemorialsWithDecisions(env, auth.owner_id, {
      status: url.searchParams.get("status") ?? undefined,
      project_id: url.searchParams.get("project_id") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    });
    const filtered = memorials.filter((m) => canAccessProject(auth, m.project_id));
    return json({ memorials: filtered });
  }

  if (path === "/api/v1/memorials" && request.method === "POST") {
    const parsed = await parseJson(request, CreateMemorialRequestSchema);
    if (!parsed.ok) return parsed.response;
    if (!canAccessProject(auth, parsed.data.project_id)) {
      return errorJson(403, "FORBIDDEN_PROJECT", "Credential cannot access this project");
    }

    const idempotencyKey =
      request.headers.get("Idempotency-Key") ?? parsed.data.idempotency_key;
    const memorial = await createMemorialRecord(env, {
      owner_id: auth.owner_id,
      project_id: parsed.data.project_id,
      agent_id: parsed.data.agent_id ?? auth.agent_id ?? "agent_mcp_default",
      session_id: parsed.data.session_id ?? null,
      task_id: parsed.data.task_id ?? null,
      title: parsed.data.title,
      content: parsed.data.content,
      request_type: parsed.data.request_type,
      options: parsed.data.options,
      risk_level: parsed.data.risk_level,
      risk_notes: parsed.data.risk_notes ?? null,
      context_summary: parsed.data.context_summary ?? null,
      source: `${auth.scope}:${auth.credential_id}`,
      idempotency_key: idempotencyKey,
    });
    return json({ memorial }, 201);
  }

  // Single Memorial GET & Decision POST
  const memorialMatch = path.match(/^\/api\/v1\/memorials\/([^/]+)(\/decision)?$/);
  if (memorialMatch) {
    const memorialId = decodeURIComponent(memorialMatch[1]!);
    const isDecision = Boolean(memorialMatch[2]);

    if (!isDecision && request.method === "GET") {
      const memorial = await getMemorialWithDecision(env, auth.owner_id, memorialId);
      if (!memorial) return errorJson(404, "NOT_FOUND", "Memorial not found");
      if (!canAccessProject(auth, memorial.project_id)) {
        return errorJson(403, "FORBIDDEN_PROJECT", "Credential cannot access this project");
      }
      return json({ memorial });
    }

    if (isDecision && request.method === "POST") {
      const forbidden = requireScopes(auth, ["owner", "device"]);
      if (forbidden) return forbidden;
      const parsed = await parseJson(request, SubmitDecisionRequestSchema);
      if (!parsed.ok) return parsed.response;

      const idempotencyKey =
        request.headers.get("Idempotency-Key") ?? parsed.data.idempotency_key;

      const res = await recordDecisionWithOptimisticLock(env, {
        owner_id: auth.owner_id,
        memorial_id: memorialId,
        action: parsed.data.action,
        selected_option_id: parsed.data.selected_option_id ?? null,
        comment: parsed.data.comment,
        instructions: parsed.data.instructions ?? null,
        expected_version: parsed.data.expected_version,
        decided_by_device_id: auth.credential_id,
        decided_by_label: auth.label,
        idempotency_key: idempotencyKey,
      });

      if (!res.ok) {
        if (res.reason === "not_found") {
          return errorJson(404, "NOT_FOUND", "Memorial not found");
        }
        return errorJson(
          409,
          "VERSION_CONFLICT",
          "Memorial was already decided or updated on another device",
          { current_memorial: res.current }
        );
      }

      return json({ memorial: res.memorial }, 200);
    }
  }

  // Informational reports (non-blocking)
  if (path === "/api/v1/reports" && request.method === "POST") {
    const parsed = await parseJson(request, SubmitReportRequestSchema);
    if (!parsed.ok) return parsed.response;
    if (!canAccessProject(auth, parsed.data.project_id)) {
      return errorJson(403, "FORBIDDEN_PROJECT", "Credential cannot access this project");
    }
    const now = new Date().toISOString();
    const agentId = parsed.data.agent_id ?? auth.agent_id ?? "agent_mcp_default";
    let messageId: string | null = null;
    if (parsed.data.task_id) {
      const msg = await appendTaskMessageRecord(env, {
        owner_id: auth.owner_id,
        task_id: parsed.data.task_id,
        session_id: parsed.data.session_id ?? null,
        sender_type: "agent",
        sender_id: agentId,
        kind:
          parsed.data.task_status === "completed" ? "task_result" : "agent_report",
        content: `## ${parsed.data.title}\n\n${parsed.data.content}`,
        metadata: { source: auth.scope },
      });
      messageId = msg.id;
      if (parsed.data.task_status) {
        await env.DB.prepare(
          `UPDATE tasks SET status = ?, summary = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND owner_id = ?`
        )
          .bind(
            parsed.data.task_status,
            parsed.data.title,
            now,
            parsed.data.task_id,
            auth.owner_id
          )
          .run();
      }
    }
    const evt = await emitEvent(env, {
      owner_id: auth.owner_id,
      type: "report.created",
      entity_id: parsed.data.task_id ?? parsed.data.project_id,
      project_id: parsed.data.project_id,
      payload: {
        title: parsed.data.title,
        content: parsed.data.content,
        agent_id: agentId,
        task_id: parsed.data.task_id ?? null,
        message_id: messageId,
      },
    });
    return json({ ok: true, event: evt, message_id: messageId }, 201);
  }

  // Tasks list & create
  if (path === "/api/v1/tasks" && request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT * FROM tasks WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100`
    )
      .bind(auth.owner_id)
      .all<Record<string, unknown>>();
    return json({ tasks: (rows.results ?? []).map(mapTask) });
  }

  if (path === "/api/v1/tasks" && request.method === "POST") {
    const forbidden = requireScopes(auth, ["owner", "device"]);
    if (forbidden) return forbidden;
    const parsed = await parseJson(request, CreateTaskRequestSchema);
    if (!parsed.ok) return parsed.response;

    const idempotencyKey =
      request.headers.get("Idempotency-Key") ?? parsed.data.idempotency_key;
    const cached = await checkIdempotency<{ task: unknown; message: unknown }>(
      env,
      auth.owner_id,
      idempotencyKey
    );
    if (cached) return json(cached, 200);

    const project = await env.DB.prepare(
      `SELECT * FROM projects WHERE id = ? AND owner_id = ?`
    )
      .bind(parsed.data.project_id, auth.owner_id)
      .first<Record<string, unknown>>();
    if (!project) return errorJson(404, "PROJECT_NOT_FOUND", "Project not found");

    const agent = await env.DB.prepare(
      `SELECT * FROM agents WHERE id = ? AND owner_id = ?`
    )
      .bind(parsed.data.agent_id, auth.owner_id)
      .first<Record<string, unknown>>();
    if (!agent) return errorJson(404, "AGENT_NOT_FOUND", "Agent not found");

    const now = new Date().toISOString();
    const taskId = newId("tsk");
    const bridgeId =
      (agent.bridge_id ? String(agent.bridge_id) : null) ??
      (project.bridge_id ? String(project.bridge_id) : null);

    let sessionId = parsed.data.session_id ?? null;
    if (!sessionId) {
      sessionId = newId("ses");
      await env.DB.prepare(
        `INSERT INTO sessions (id, owner_id, project_id, agent_id, bridge_id, mode, provider_session_id, status, version, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 'active', 1, ?, ?, ?)`
      )
        .bind(
          sessionId,
          auth.owner_id,
          parsed.data.project_id,
          parsed.data.agent_id,
          bridgeId,
          String(agent.mode),
          auth.scope,
          now,
          now
        )
        .run();
    }

    const resumeStatus =
      String(agent.mode) === "bridge_managed"
        ? "waiting_for_bridge"
        : "not_supported";

    await env.DB.prepare(
      `INSERT INTO tasks (
        id, owner_id, project_id, agent_id, session_id, bridge_id,
        title, prompt, status, delivery_status, resume_status,
        version, source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'queued', ?, 1, ?, ?, ?)`
    )
      .bind(
        taskId,
        auth.owner_id,
        parsed.data.project_id,
        parsed.data.agent_id,
        sessionId,
        bridgeId,
        parsed.data.title,
        parsed.data.prompt,
        resumeStatus,
        auth.label,
        now,
        now
      )
      .run();

    const msg = await appendTaskMessageRecord(env, {
      owner_id: auth.owner_id,
      task_id: taskId,
      session_id: sessionId,
      sender_type: "user",
      sender_id: auth.credential_id,
      kind: "user_prompt",
      content: parsed.data.prompt,
    });

    const taskRow = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`)
      .bind(taskId)
      .first<Record<string, unknown>>();
    const task = mapTask(taskRow!);
    const responseBody = { task, message: msg };
    await saveIdempotency(env, auth.owner_id, idempotencyKey, responseBody);

    await emitEvent(env, {
      owner_id: auth.owner_id,
      type: "task.created",
      entity_id: taskId,
      project_id: task.project_id,
      bridge_id: bridgeId,
      payload: {
        task_id: taskId,
        session_id: sessionId,
        project_id: task.project_id,
        agent_id: task.agent_id,
        provider: String(agent.provider),
        title: task.title,
        prompt: task.prompt,
      },
    });

    return json(responseBody, 201);
  }

  // Task messages & cancel
  const taskSubMatch = path.match(/^\/api\/v1\/tasks\/([^/]+)\/(messages|cancel)$/);
  if (taskSubMatch) {
    const taskId = decodeURIComponent(taskSubMatch[1]!);
    const action = taskSubMatch[2]!;
    const taskRow = await env.DB.prepare(
      `SELECT * FROM tasks WHERE id = ? AND owner_id = ?`
    )
      .bind(taskId, auth.owner_id)
      .first<Record<string, unknown>>();
    if (!taskRow) return errorJson(404, "NOT_FOUND", "Task not found");

    if (action === "messages" && request.method === "GET") {
      const msgRows = await env.DB.prepare(
        `SELECT * FROM task_messages WHERE task_id = ? ORDER BY created_at ASC LIMIT 200`
      )
        .bind(taskId)
        .all<Record<string, unknown>>();
      return json({
        task: mapTask(taskRow),
        messages: (msgRows.results ?? []).map(mapTaskMessage),
      });
    }

    if (action === "messages" && request.method === "POST") {
      const forbidden = requireScopes(auth, ["owner", "device"]);
      if (forbidden) return forbidden;
      const parsed = await parseJson(request, AppendTaskMessageRequestSchema);
      if (!parsed.ok) return parsed.response;

      const msg = await appendTaskMessageRecord(env, {
        owner_id: auth.owner_id,
        task_id: taskId,
        session_id: taskRow.session_id ? String(taskRow.session_id) : null,
        sender_type: "user",
        sender_id: auth.credential_id,
        kind: parsed.data.kind ?? "user_followup",
        content: parsed.data.content,
        emit: true,
      });

      const now = new Date().toISOString();
      await env.DB.prepare(
        `UPDATE tasks SET status = 'queued', delivery_status = 'queued', resume_status = 'waiting_for_bridge', version = version + 1, updated_at = ?
         WHERE id = ? AND owner_id = ?`
      )
        .bind(now, taskId, auth.owner_id)
        .run();

      const updatedTask = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`)
        .bind(taskId)
        .first<Record<string, unknown>>();
      return json({ task: mapTask(updatedTask!), message: msg }, 201);
    }

    if (action === "cancel" && request.method === "POST") {
      const forbidden = requireScopes(auth, ["owner", "device"]);
      if (forbidden) return forbidden;
      const now = new Date().toISOString();
      await env.DB.prepare(
        `UPDATE tasks SET status = 'cancelled', version = version + 1, updated_at = ? WHERE id = ? AND owner_id = ?`
      )
        .bind(now, taskId, auth.owner_id)
        .run();
      const updated = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`)
        .bind(taskId)
        .first<Record<string, unknown>>();
      const task = mapTask(updated!);
      await emitEvent(env, {
        owner_id: auth.owner_id,
        type: "task.cancelled",
        entity_id: taskId,
        project_id: task.project_id,
        bridge_id: task.bridge_id,
        payload: { task_id: taskId },
      });
      return json({ task });
    }
  }

  // Bridge endpoints (Windows Execution Host)
  if (path === "/api/v1/bridges" && request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT * FROM bridges WHERE owner_id = ? ORDER BY updated_at DESC`
    )
      .bind(auth.owner_id)
      .all<Record<string, unknown>>();
    return json({ bridges: (rows.results ?? []).map(mapBridge) });
  }

  if (path === "/api/v1/bridges/register" && request.method === "POST") {
    const forbidden = requireScopes(auth, ["owner", "bridge"]);
    if (forbidden) return forbidden;
    const parsed = await parseJson(request, BridgeRegisterRequestSchema);
    if (!parsed.ok) return parsed.response;

    const now = new Date().toISOString();
    const id = parsed.data.bridge_id || auth.bridge_id || newId("brg");

    await env.DB.prepare(
      `INSERT INTO bridges (
        id, owner_id, name, hostname, platform, bridge_version, status, last_seen_at,
        providers_json, authorized_project_ids_json, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'online', ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        hostname = excluded.hostname,
        bridge_version = excluded.bridge_version,
        status = 'online',
        last_seen_at = excluded.last_seen_at,
        providers_json = excluded.providers_json,
        authorized_project_ids_json = excluded.authorized_project_ids_json,
        version = bridges.version + 1,
        updated_at = excluded.updated_at`
    )
      .bind(
        id,
        auth.owner_id,
        parsed.data.name,
        parsed.data.hostname,
        parsed.data.platform,
        parsed.data.bridge_version,
        now,
        JSON.stringify(parsed.data.providers),
        JSON.stringify(parsed.data.authorized_project_ids),
        now,
        now
      )
      .run();

    // Link authorized projects to this bridge if unbound
    for (const projId of parsed.data.authorized_project_ids) {
      await env.DB.prepare(
        `UPDATE projects SET bridge_id = ?, host_label = ?, updated_at = ?
         WHERE id = ? AND owner_id = ?`
      )
        .bind(id, parsed.data.name, now, projId, auth.owner_id)
        .run();
    }

    const row = await env.DB.prepare(`SELECT * FROM bridges WHERE id = ?`)
      .bind(id)
      .first<Record<string, unknown>>();
    const bridge = mapBridge(row!);

    await emitEvent(env, {
      owner_id: auth.owner_id,
      type: "bridge.status",
      entity_id: id,
      bridge_id: id,
      payload: {
        bridge_id: id,
        status: "online",
        name: bridge.name,
        providers: bridge.providers,
      },
    });

    return json({ bridge });
  }

  const hbMatch = path.match(/^\/api\/v1\/bridges\/([^/]+)\/heartbeat$/);
  if (hbMatch && request.method === "POST") {
    const forbidden = requireScopes(auth, ["owner", "bridge"]);
    if (forbidden) return forbidden;
    const bridgeId = decodeURIComponent(hbMatch[1]!);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE bridges SET status = 'online', last_seen_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?`
    )
      .bind(now, now, bridgeId, auth.owner_id)
      .run();
    return json({ ok: true, bridge_id: bridgeId, last_seen_at: now });
  }

  if (path === "/api/v1/bridges/deliveries/ack" && request.method === "POST") {
    const forbidden = requireScopes(auth, ["owner", "bridge"]);
    if (forbidden) return forbidden;
    const parsed = await parseJson(request, BridgeDeliveryAckRequestSchema);
    if (!parsed.ok) return parsed.response;

    const now = new Date().toISOString();
    const { entity_type, entity_id, delivery_status, resume_status, error_message } =
      parsed.data;

    if (entity_type === "decision") {
      // entity_id can be memorial_id or decision_id
      const dec = await env.DB.prepare(
        `SELECT d.*, m.project_id, m.session_id, m.task_id
         FROM decisions d JOIN memorials m ON m.id = d.memorial_id
         WHERE (d.memorial_id = ? OR d.id = ?) AND m.owner_id = ?`
      )
        .bind(entity_id, entity_id, auth.owner_id)
        .first<Record<string, unknown>>();
      if (!dec) return errorJson(404, "NOT_FOUND", "Decision not found");

      const memorialId = String(dec.memorial_id);
      const nextResume = resume_status ?? (dec.resume_status as string);
      const claimedAt =
        delivery_status === "acknowledged" || delivery_status === "delivered"
          ? (dec.bridge_claimed_at ? String(dec.bridge_claimed_at) : now)
          : dec.bridge_claimed_at;
      const resumedAt =
        nextResume === "resumed"
          ? now
          : (dec.agent_resumed_at ? String(dec.agent_resumed_at) : null);

      await env.DB.prepare(
        `UPDATE decisions
         SET delivery_status = ?, resume_status = ?, bridge_claimed_at = ?, agent_resumed_at = ?, resume_error = ?, version = version + 1, updated_at = ?
         WHERE id = ?`
      )
        .bind(
          delivery_status,
          nextResume,
          claimedAt ?? null,
          resumedAt,
          error_message ?? null,
          now,
          String(dec.id)
        )
        .run();

      await env.DB.prepare(
        `UPDATE memorials
         SET delivery_status = ?, resume_status = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND owner_id = ?`
      )
        .bind(delivery_status, nextResume, now, memorialId, auth.owner_id)
        .run();

      if (dec.session_id && parsed.data.provider_session_id) {
        await env.DB.prepare(
          `UPDATE sessions SET provider_session_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?`
        )
          .bind(
            parsed.data.provider_session_id,
            now,
            String(dec.session_id),
            auth.owner_id
          )
          .run();
      }

      if (dec.task_id && nextResume === "resumed") {
        await env.DB.prepare(
          `UPDATE tasks SET status = 'running', resume_status = 'resumed', updated_at = ? WHERE id = ? AND owner_id = ?`
        )
          .bind(now, String(dec.task_id), auth.owner_id)
          .run();
      }

      await emitEvent(env, {
        owner_id: auth.owner_id,
        type: nextResume !== dec.resume_status ? "resume.updated" : "delivery.updated",
        entity_id: memorialId,
        project_id: String(dec.project_id),
        bridge_id: auth.bridge_id,
        payload: {
          memorial_id: memorialId,
          delivery_status,
          resume_status: nextResume,
          error_message: error_message ?? null,
        },
      });

      const updated = await getMemorialWithDecision(env, auth.owner_id, memorialId);
      return json({ ok: true, memorial: updated });
    }

    // Task delivery ack
    const taskRow = await env.DB.prepare(
      `SELECT * FROM tasks WHERE id = ? AND owner_id = ?`
    )
      .bind(entity_id, auth.owner_id)
      .first<Record<string, unknown>>();
    if (!taskRow) return errorJson(404, "NOT_FOUND", "Task not found");

    const nextResume = resume_status ?? String(taskRow.resume_status);
    await env.DB.prepare(
      `UPDATE tasks SET delivery_status = ?, resume_status = ?, error_message = COALESCE(?, error_message), version = version + 1, updated_at = ?
       WHERE id = ? AND owner_id = ?`
    )
      .bind(delivery_status, nextResume, error_message ?? null, now, entity_id, auth.owner_id)
      .run();

    if (taskRow.session_id && parsed.data.provider_session_id) {
      await env.DB.prepare(
        `UPDATE sessions SET provider_session_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?`
      )
        .bind(
          parsed.data.provider_session_id,
          now,
          String(taskRow.session_id),
          auth.owner_id
        )
        .run();
    }

    await emitEvent(env, {
      owner_id: auth.owner_id,
      type: "delivery.updated",
      entity_id,
      project_id: String(taskRow.project_id),
      bridge_id: auth.bridge_id,
      payload: { task_id: entity_id, delivery_status, resume_status: nextResume },
    });

    const updated = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`)
      .bind(entity_id)
      .first<Record<string, unknown>>();
    return json({ ok: true, task: mapTask(updated!) });
  }

  const bridgeTaskMatch = path.match(/^\/api\/v1\/bridges\/tasks\/([^/]+)\/update$/);
  if (bridgeTaskMatch && request.method === "POST") {
    const forbidden = requireScopes(auth, ["owner", "bridge"]);
    if (forbidden) return forbidden;
    const taskId = decodeURIComponent(bridgeTaskMatch[1]!);
    const parsed = await parseJson(request, BridgeTaskUpdateSchema);
    if (!parsed.ok) return parsed.response;

    const taskRow = await env.DB.prepare(
      `SELECT * FROM tasks WHERE id = ? AND owner_id = ?`
    )
      .bind(taskId, auth.owner_id)
      .first<Record<string, unknown>>();
    if (!taskRow) return errorJson(404, "NOT_FOUND", "Task not found");

    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE tasks
       SET status = COALESCE(?, status),
           delivery_status = COALESCE(?, delivery_status),
           resume_status = COALESCE(?, resume_status),
           summary = COALESCE(?, summary),
           error_message = COALESCE(?, error_message),
           version = version + 1,
           updated_at = ?
       WHERE id = ? AND owner_id = ?`
    )
      .bind(
        parsed.data.status ?? null,
        parsed.data.delivery_status ?? null,
        parsed.data.resume_status ?? null,
        parsed.data.summary ?? null,
        parsed.data.error_message ?? null,
        now,
        taskId,
        auth.owner_id
      )
      .run();

    if (taskRow.session_id && parsed.data.provider_session_id) {
      await env.DB.prepare(
        `UPDATE sessions SET provider_session_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?`
      )
        .bind(
          parsed.data.provider_session_id,
          now,
          String(taskRow.session_id),
          auth.owner_id
        )
        .run();
    }

    if (parsed.data.log_chunk) {
      await appendTaskMessageRecord(env, {
        owner_id: auth.owner_id,
        task_id: taskId,
        session_id: taskRow.session_id ? String(taskRow.session_id) : null,
        sender_type: "bridge",
        sender_id: auth.bridge_id ?? auth.credential_id,
        kind: parsed.data.message_kind ?? "agent_log",
        content: parsed.data.log_chunk,
        emit: true,
      });
    }

    const updated = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`)
      .bind(taskId)
      .first<Record<string, unknown>>();
    const task = mapTask(updated!);

    await emitEvent(env, {
      owner_id: auth.owner_id,
      type: "task.updated",
      entity_id: taskId,
      project_id: task.project_id,
      bridge_id: task.bridge_id,
      payload: {
        task_id: taskId,
        status: task.status,
        delivery_status: task.delivery_status,
        resume_status: task.resume_status,
        summary: task.summary,
      },
    });

    return json({ task });
  }

  // Pairing creation (owner/device only, short-lived single-use code, never embeds admin token!)
  if (path === "/api/v1/pairing/create" && request.method === "POST") {
    const forbidden = requireScopes(auth, ["owner"]);
    if (forbidden) return forbidden;
    const parsed = await parseJson(request, CreatePairingRequestSchema);
    if (!parsed.ok) return parsed.response;

    const code = generatePairingCode();
    const codeHash = await sha256Hex(code);
    const now = Date.now();
    const expiresAt = new Date(now + parsed.data.ttl_seconds * 1000).toISOString();

    await env.DB.prepare(
      `INSERT INTO pairing_codes (code_hash, owner_id, label, platform, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        codeHash,
        auth.owner_id,
        parsed.data.label,
        parsed.data.platform,
        expiresAt,
        new Date(now).toISOString()
      )
      .run();

    const origin = url.origin;
    const qrPayload = JSON.stringify({
      type: "kangxi_pairing_v1",
      server_url: origin,
      pairing_code: code,
      expires_at: expiresAt,
    });

    return json({ pairing_code: code, expires_at: expiresAt, qr_payload: qrPayload }, 201);
  }

  // Credentials management & revocation (owner only)
  if (path === "/api/v1/credentials" && request.method === "GET") {
    const forbidden = requireScopes(auth, ["owner", "device"]);
    if (forbidden) return forbidden;
    const rows = await env.DB.prepare(
      `SELECT * FROM credentials WHERE owner_id = ? ORDER BY created_at DESC`
    )
      .bind(auth.owner_id)
      .all<Record<string, unknown>>();
    return json({ credentials: (rows.results ?? []).map(mapCredential) });
  }

  if (path === "/api/v1/credentials" && request.method === "POST") {
    const forbidden = requireScopes(auth, ["owner"]);
    if (forbidden) return forbidden;
    const parsed = await parseJson(request, CreateCredentialRequestSchema);
    if (!parsed.ok) return parsed.response;

    const now = new Date().toISOString();
    const id = newId("crd");
    const prefixMap = { device: "dev", bridge: "brg", mcp_agent: "mcp" } as const;
    const token = generateSecretToken(prefixMap[parsed.data.scope]);
    const tokenHash = await sha256Hex(token);

    await env.DB.prepare(
      `INSERT INTO credentials (
        id, owner_id, label, scope, device_platform, agent_id, bridge_id,
        allowed_project_ids_json, token_hash, token_prefix, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        auth.owner_id,
        parsed.data.label,
        parsed.data.scope,
        parsed.data.device_platform ?? null,
        parsed.data.agent_id ?? null,
        parsed.data.bridge_id ?? null,
        parsed.data.allowed_project_ids
          ? JSON.stringify(parsed.data.allowed_project_ids)
          : null,
        tokenHash,
        token.slice(0, 12),
        now
      )
      .run();

    const row = await env.DB.prepare(`SELECT * FROM credentials WHERE id = ?`)
      .bind(id)
      .first<Record<string, unknown>>();
    return json({ token, credential: mapCredential(row!) }, 201);
  }

  const revokeMatch = path.match(/^\/api\/v1\/credentials\/([^/]+)\/revoke$/);
  if (revokeMatch && request.method === "POST") {
    const forbidden = requireScopes(auth, ["owner"]);
    if (forbidden) return forbidden;
    const credId = decodeURIComponent(revokeMatch[1]!);
    const now = new Date().toISOString();

    const res = await env.DB.prepare(
      `UPDATE credentials SET revoked_at = ? WHERE id = ? AND owner_id = ? AND revoked_at IS NULL`
    )
      .bind(now, credId, auth.owner_id)
      .run();

    if (Number(res.meta?.changes ?? 0) === 0) {
      return errorJson(404, "NOT_FOUND", "Credential not found or already revoked");
    }

    // Immediately terminate active WebSockets for the revoked credential
    try {
      if (env.SYNC_HUB) {
        const stub = env.SYNC_HUB.get(env.SYNC_HUB.idFromName(auth.owner_id));
        await stub.fetch("https://sync-hub/kick", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential_id: credId }),
        });
      }
    } catch {
      // Non-fatal
    }

    await emitEvent(env, {
      owner_id: auth.owner_id,
      type: "credential.revoked",
      entity_id: credId,
      payload: { credential_id: credId },
    });

    return json({ revoked: true, id: credId });
  }

  // Full Data Export (SPEC 6.2 & 9 — zero Cloudflare lock-in)
  if (path === "/api/v1/export" && request.method === "GET") {
    const forbidden = requireScopes(auth, ["owner"]);
    if (forbidden) return forbidden;

    const [projects, agents, bridges, sessions, tasks, messages, memorials, events] =
      await Promise.all([
        env.DB.prepare(`SELECT * FROM projects WHERE owner_id = ?`)
          .bind(auth.owner_id)
          .all(),
        env.DB.prepare(`SELECT * FROM agents WHERE owner_id = ?`)
          .bind(auth.owner_id)
          .all(),
        env.DB.prepare(`SELECT * FROM bridges WHERE owner_id = ?`)
          .bind(auth.owner_id)
          .all(),
        env.DB.prepare(`SELECT * FROM sessions WHERE owner_id = ?`)
          .bind(auth.owner_id)
          .all(),
        env.DB.prepare(`SELECT * FROM tasks WHERE owner_id = ?`)
          .bind(auth.owner_id)
          .all(),
        env.DB.prepare(
          `SELECT m.* FROM task_messages m JOIN tasks t ON t.id = m.task_id WHERE t.owner_id = ?`
        )
          .bind(auth.owner_id)
          .all(),
        listMemorialsWithDecisions(env, auth.owner_id, { limit: 200 }),
        env.DB.prepare(
          `SELECT * FROM events WHERE owner_id = ? ORDER BY sequence ASC LIMIT 1000`
        )
          .bind(auth.owner_id)
          .all(),
      ]);

    return json({
      exported_at: new Date().toISOString(),
      schema_version: 1,
      projects: projects.results ?? [],
      agents: agents.results ?? [],
      bridges: bridges.results ?? [],
      sessions: sessions.results ?? [],
      tasks: tasks.results ?? [],
      task_messages: messages.results ?? [],
      memorials,
      events: events.results ?? [],
    });
  }

  return errorJson(404, "NOT_FOUND", `Route not found: ${request.method} ${path}`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleFetch(request, env);
  },
} satisfies ExportedHandler<Env>;
