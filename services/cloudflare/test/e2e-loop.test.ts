import { describe, expect, it } from "vitest";
import { handleFetch } from "../src/index.ts";
import type { Env } from "../src/types.ts";
import { createTestD1, createTestSyncHub } from "./sqlite-d1.ts";

async function req(
  env: Env,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
) {
  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const request = new Request(`https://kangxi.example.workers.dev${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const res = await handleFetch(request, env);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  return { status: res.status, data };
}

describe("KangXi.exe full business loop (MCP -> Android Decision -> Conflict -> Bridge Resume -> Revocation)", () => {
  it("completes the real end-to-end flow with optimistic lock, cursor replay, and credential revocation", async () => {
    const db = createTestD1();
    const hub = createTestSyncHub();
    const env: Env = { DB: db, SYNC_HUB: hub.namespace, APP_VERSION: "0.1.0" };

    // 1. Bootstrap owner
    const boot = await req(env, "/api/v1/bootstrap", {
      method: "POST",
      body: { owner_name: "康熙", device_label: "Windows 御案", platform: "windows" },
    });
    expect(boot.status).toBe(201);
    const ownerToken = boot.data.token as string;
    const projectId = boot.data.default_project.id as string;
    const codexAgentId = boot.data.default_agents[0].id as string;

    // 2. Pair Android device using short-lived single-use code (no admin token in QR)
    const pairCreate = await req(env, "/api/v1/pairing/create", {
      method: "POST",
      token: ownerToken,
      body: { label: "Android 随身御批", platform: "android" },
    });
    expect(pairCreate.status).toBe(201);
    expect(String(pairCreate.data.qr_payload)).not.toContain(ownerToken);

    const pairRedeem = await req(env, "/api/v1/pairing/redeem", {
      method: "POST",
      body: {
        pairing_code: pairCreate.data.pairing_code,
        device_label: "Pixel Android",
        platform: "android",
      },
    });
    expect(pairRedeem.status).toBe(201);
    const androidToken = pairRedeem.data.token as string;
    const androidCredId = pairRedeem.data.credential.id as string;

    // Reusing the same pairing code must fail
    const pairReuse = await req(env, "/api/v1/pairing/redeem", {
      method: "POST",
      body: { pairing_code: pairCreate.data.pairing_code, platform: "android" },
    });
    expect(pairReuse.status).toBe(401);

    // 3. Issue scoped MCP Agent credential & Bridge credential
    const mcpCred = await req(env, "/api/v1/credentials", {
      method: "POST",
      token: ownerToken,
      body: {
        label: "Codex MCP",
        scope: "mcp_agent",
        agent_id: codexAgentId,
        allowed_project_ids: [projectId],
      },
    });
    expect(mcpCred.status).toBe(201);
    const mcpToken = mcpCred.data.token as string;

    const bridgeCred = await req(env, "/api/v1/credentials", {
      method: "POST",
      token: ownerToken,
      body: { label: "Win11 Bridge", scope: "bridge", device_platform: "windows" },
    });
    expect(bridgeCred.status).toBe(201);
    const bridgeToken = bridgeCred.data.token as string;

    // Register Windows Bridge & bind project
    const bridgeReg = await req(env, "/api/v1/bridges/register", {
      method: "POST",
      token: bridgeToken,
      body: {
        name: "Workstation-01",
        hostname: "DESKTOP-KANGXI",
        providers: [
          { provider: "codex", available: true, version: "0.90.0", supports_resume: true },
        ],
        authorized_project_ids: [projectId],
      },
    });
    expect(bridgeReg.status).toBe(200);
    const bridgeId = bridgeReg.data.bridge.id as string;

    // Create a Bridge-managed task so session exists
    const taskCreate = await req(env, "/api/v1/tasks", {
      method: "POST",
      token: androidToken,
      body: {
        project_id: projectId,
        agent_id: codexAgentId,
        title: "Refactor auth middleware",
        prompt: "Audit token verification and submit a memorial before touching migrations.",
      },
    });
    expect(taskCreate.status).toBe(201);
    const taskId = taskCreate.data.task.id as string;
    const sessionId = taskCreate.data.task.session_id as string;

    // Capture bridge cursor before memorial & decision
    const cursorBefore = await req(env, "/api/v1/events?after=0", { token: bridgeToken });
    const savedCursor = cursorBefore.data.latest_sequence as number;

    // 4. Agent submits memorial via Streamable HTTP MCP `/mcp`
    const mcpSubmit = await req(env, "/mcp", {
      method: "POST",
      token: mcpToken,
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "submit_memorial",
          arguments: {
            project_id: projectId,
            task_id: taskId,
            session_id: sessionId,
            title: "Approve schema index addition",
            content: "Proposing CREATE INDEX idx_tokens on credentials(token_hash).",
            request_type: "risk_confirmation",
            risk_level: "high",
            options: [
              { id: "apply", label: "Apply now", recommended: true },
              { id: "skip", label: "Skip index" },
            ],
          },
        },
      },
    });
    expect(mcpSubmit.status).toBe(200);
    const memorialId = mcpSubmit.data.result.structuredContent.memorial_id as string;
    expect(memorialId).toMatch(/^mem_/);

    // Visible on Android
    const androidList = await req(env, "/api/v1/memorials?status=pending", {
      token: androidToken,
    });
    expect(androidList.data.memorials).toHaveLength(1);
    expect(androidList.data.memorials[0].id).toBe(memorialId);

    // 5. Android approves memorial (朱批)
    const decide1 = await req(env, `/api/v1/memorials/${memorialId}/decision`, {
      method: "POST",
      token: androidToken,
      body: {
        action: "approve",
        selected_option_id: "apply",
        comment: "准奏，按方案一施行。",
        instructions: "Run migration and verify row reads.",
        expected_version: 1,
        idempotency_key: "android_dec_1",
      },
    });
    expect(decide1.status).toBe(200);
    expect(decide1.data.memorial.status).toBe("approved");
    expect(decide1.data.memorial.version).toBe(2);
    expect(decide1.data.memorial.decision.delivery_status).toBe("queued");
    expect(decide1.data.memorial.decision.resume_status).toBe("waiting_for_bridge");

    // 6. Second device attempts duplicate approval with stale version -> 409 conflict
    const decide2 = await req(env, `/api/v1/memorials/${memorialId}/decision`, {
      method: "POST",
      token: ownerToken,
      body: {
        action: "reject",
        comment: "Stale Windows decision",
        expected_version: 1,
        idempotency_key: "windows_dec_2",
      },
    });
    expect(decide2.status).toBe(409);
    expect(decide2.data.code).toBe("VERSION_CONFLICT");
    expect(decide2.data.current_memorial.status).toBe("approved");

    // 7. Bridge catches up offline events via cursor & acknowledges + marks resumed
    const catchup = await req(env, `/api/v1/events?after=${savedCursor}`, {
      token: bridgeToken,
    });
    const eventTypes = catchup.data.events.map((e: { type: string }) => e.type);
    expect(eventTypes).toContain("memorial.created");
    expect(eventTypes).toContain("decision.created");

    const ackRes = await req(env, "/api/v1/bridges/deliveries/ack", {
      method: "POST",
      token: bridgeToken,
      body: {
        entity_type: "decision",
        entity_id: memorialId,
        delivery_status: "acknowledged",
        resume_status: "resumed",
        provider_session_id: "thread_codex_999",
      },
    });
    expect(ackRes.status).toBe(200);
    expect(ackRes.data.memorial.decision.delivery_status).toBe("acknowledged");
    expect(ackRes.data.memorial.decision.resume_status).toBe("resumed");
    expect(ackRes.data.memorial.decision.bridge_claimed_at).toBeTruthy();
    expect(ackRes.data.memorial.decision.agent_resumed_at).toBeTruthy();

    // 8. MCP agent retrieves structured reply via `get_memorial_reply`
    const mcpReply = await req(env, "/mcp", {
      method: "POST",
      token: mcpToken,
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "get_memorial_reply",
          arguments: { memorial_id: memorialId },
        },
      },
    });
    expect(mcpReply.status).toBe(200);
    expect(mcpReply.data.result.structuredContent.action).toBe("approve");
    expect(mcpReply.data.result.structuredContent.comment).toBe("准奏，按方案一施行。");

    // 9. Revoking Android credential immediately blocks access & kicks WS
    const revoke = await req(env, `/api/v1/credentials/${androidCredId}/revoke`, {
      method: "POST",
      token: ownerToken,
    });
    expect(revoke.status).toBe(200);
    expect(hub.kicked).toContain(androidCredId);

    const blocked = await req(env, "/api/v1/memorials", { token: androidToken });
    expect(blocked.status).toBe(401);

    // Verify bridge was registered cleanly
    expect(bridgeId).toMatch(/^brg_/);
  });
});
