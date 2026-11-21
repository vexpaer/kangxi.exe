import {
  MCP_TOOL_DEFINITIONS,
  McpCheckMemorialInputSchema,
  McpGetMemorialReplyInputSchema,
  McpSubmitMemorialInputSchema,
  McpSubmitReportInputSchema,
} from "@kangxi/protocol";
import { canAccessProject } from "./auth.ts";
import {
  appendTaskMessageRecord,
  createMemorialRecord,
  emitEvent,
  getMemorialWithDecision,
} from "./db.ts";
import type { AuthContext, Env } from "./types.ts";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function jsonRpcResult(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function jsonRpcError(
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: unknown
) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

function formatMcpResponse(
  request: Request,
  payload: unknown,
  status = 200,
  sessionId?: string
): Response {
  const accept = request.headers.get("Accept") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, MCP-Session-Id, Accept",
    "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  };
  if (sessionId) {
    headers["MCP-Session-Id"] = sessionId;
  }

  if (
    accept.includes("text/event-stream") &&
    !accept.includes("application/json")
  ) {
    headers["Content-Type"] = "text/event-stream";
    return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
      status,
      headers,
    });
  }

  headers["Content-Type"] = "application/json";
  return new Response(JSON.stringify(payload), { status, headers });
}

export async function handleMcpRequest(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  if (auth.scope !== "mcp_agent" && auth.scope !== "owner") {
    return formatMcpResponse(
      request,
      jsonRpcError(null, -32001, "Credential scope is not permitted for MCP"),
      403
    );
  }

  if (request.method === "GET") {
    // Streamable HTTP optional info / keepalive check
    return formatMcpResponse(request, {
      server: "kangxi-mcp",
      protocol: "streamable-http",
      tools: MCP_TOOL_DEFINITIONS.map((t) => t.name),
    });
  }

  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return formatMcpResponse(
      request,
      jsonRpcError(null, -32700, "Invalid JSON payload"),
      400
    );
  }

  const sessionId =
    request.headers.get("MCP-Session-Id") ?? `mcp_${auth.credential_id}`;

  switch (body.method) {
    case "initialize": {
      return formatMcpResponse(
        request,
        jsonRpcResult(body.id, {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: "kangxi-mcp",
            version: env.APP_VERSION ?? "0.1.0",
          },
        }),
        200,
        sessionId
      );
    }

    case "notifications/initialized": {
      return new Response(null, {
        status: 202,
        headers: {
          "MCP-Session-Id": sessionId,
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    case "ping": {
      return formatMcpResponse(request, jsonRpcResult(body.id, {}), 200, sessionId);
    }

    case "tools/list": {
      return formatMcpResponse(
        request,
        jsonRpcResult(body.id, { tools: MCP_TOOL_DEFINITIONS }),
        200,
        sessionId
      );
    }

    case "tools/call": {
      const toolName = String(body.params?.name ?? "");
      const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
      const result = await executeMcpTool(env, auth, toolName, args);
      return formatMcpResponse(
        request,
        jsonRpcResult(body.id, result),
        200,
        sessionId
      );
    }

    default: {
      return formatMcpResponse(
        request,
        jsonRpcError(body.id, -32601, `Unsupported MCP method: ${body.method}`),
        200,
        sessionId
      );
    }
  }
}

async function executeMcpTool(
  env: Env,
  auth: AuthContext,
  toolName: string,
  args: Record<string, unknown>
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}> {
  try {
    if (toolName === "submit_memorial") {
      const parsed = McpSubmitMemorialInputSchema.parse(args);
      if (!canAccessProject(auth, parsed.project_id)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Permission denied for project ${parsed.project_id}`,
            },
          ],
        };
      }

      const agentId = auth.agent_id ?? "agent_mcp_default";
      const memorial = await createMemorialRecord(env, {
        owner_id: auth.owner_id,
        project_id: parsed.project_id,
        agent_id: agentId,
        session_id: parsed.session_id ?? null,
        task_id: parsed.task_id ?? null,
        title: parsed.title,
        content: parsed.content,
        request_type: parsed.request_type,
        options: parsed.options,
        risk_level: parsed.risk_level,
        risk_notes: parsed.risk_notes ?? null,
        context_summary: parsed.context_summary ?? null,
        source: `mcp:${auth.credential_id}`,
        idempotency_key: parsed.idempotency_key ?? null,
      });

      const structured = {
        memorial_id: memorial.id,
        status: memorial.status,
        version: memorial.version,
        delivery_status: memorial.delivery_status,
        resume_status: memorial.resume_status,
        created_at: memorial.created_at,
      };
      return {
        structuredContent: structured,
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
      };
    }

    if (toolName === "check_memorial") {
      const parsed = McpCheckMemorialInputSchema.parse(args);
      const memorial = await getMemorialWithDecision(
        env,
        auth.owner_id,
        parsed.memorial_id
      );
      if (!memorial) {
        return {
          isError: true,
          content: [
            { type: "text", text: `Memorial ${parsed.memorial_id} not found` },
          ],
        };
      }
      if (!canAccessProject(auth, memorial.project_id)) {
        return {
          isError: true,
          content: [{ type: "text", text: "Permission denied for memorial project" }],
        };
      }
      const structured = {
        memorial_id: memorial.id,
        status: memorial.status,
        has_reply: memorial.decision !== null,
        version: memorial.version,
        delivery_status: memorial.delivery_status,
        resume_status: memorial.resume_status,
        updated_at: memorial.updated_at,
      };
      return {
        structuredContent: structured,
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
      };
    }

    if (toolName === "get_memorial_reply") {
      const parsed = McpGetMemorialReplyInputSchema.parse(args);
      const memorial = await getMemorialWithDecision(
        env,
        auth.owner_id,
        parsed.memorial_id
      );
      if (!memorial) {
        return {
          isError: true,
          content: [
            { type: "text", text: `Memorial ${parsed.memorial_id} not found` },
          ],
        };
      }
      if (!canAccessProject(auth, memorial.project_id)) {
        return {
          isError: true,
          content: [{ type: "text", text: "Permission denied for memorial project" }],
        };
      }

      if (!memorial.decision) {
        const pending = {
          memorial_id: memorial.id,
          status: memorial.status,
          replied: false,
          message: "Still pending human review.",
        };
        return {
          structuredContent: pending,
          content: [{ type: "text", text: JSON.stringify(pending, null, 2) }],
        };
      }

      // Mark acknowledged if MCP-only agent retrieved the reply directly
      if (memorial.decision.delivery_status === "queued") {
        const now = new Date().toISOString();
        await env.DB.prepare(
          `UPDATE decisions SET delivery_status = 'acknowledged', updated_at = ? WHERE id = ?`
        )
          .bind(now, memorial.decision.id)
          .run();
        await env.DB.prepare(
          `UPDATE memorials SET delivery_status = 'acknowledged', updated_at = ? WHERE id = ?`
        )
          .bind(now, memorial.id)
          .run();
      }

      const reply = {
        memorial_id: memorial.id,
        status: memorial.status,
        replied: true,
        decision_id: memorial.decision.id,
        action: memorial.decision.action,
        selected_option_id: memorial.decision.selected_option_id,
        comment: memorial.decision.comment,
        instructions: memorial.decision.instructions,
        decided_by: memorial.decision.decided_by_label,
        decided_at: memorial.decision.created_at,
        version: memorial.version,
      };
      return {
        structuredContent: reply,
        content: [{ type: "text", text: JSON.stringify(reply, null, 2) }],
      };
    }

    if (toolName === "submit_report") {
      const parsed = McpSubmitReportInputSchema.parse(args);
      if (!canAccessProject(auth, parsed.project_id)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Permission denied for project ${parsed.project_id}`,
            },
          ],
        };
      }

      const agentId = auth.agent_id ?? "agent_mcp_default";
      const now = new Date().toISOString();
      let messageId: string | null = null;

      if (parsed.task_id) {
        const msg = await appendTaskMessageRecord(env, {
          owner_id: auth.owner_id,
          task_id: parsed.task_id,
          session_id: parsed.session_id ?? null,
          sender_type: "agent",
          sender_id: agentId,
          kind: parsed.task_status === "completed" ? "task_result" : "agent_report",
          content: `## ${parsed.title}\n\n${parsed.content}`,
          metadata: { source: "mcp_report" },
          emit: false,
        });
        messageId = msg.id;

        if (parsed.task_status) {
          await env.DB.prepare(
            `UPDATE tasks SET status = ?, summary = ?, version = version + 1, updated_at = ?
             WHERE id = ? AND owner_id = ?`
          )
            .bind(
              parsed.task_status,
              parsed.title,
              now,
              parsed.task_id,
              auth.owner_id
            )
            .run();
        }
      }

      const evt = await emitEvent(env, {
        owner_id: auth.owner_id,
        type: "report.created",
        entity_id: parsed.task_id ?? parsed.project_id,
        project_id: parsed.project_id,
        payload: {
          title: parsed.title,
          content: parsed.content,
          agent_id: agentId,
          task_id: parsed.task_id ?? null,
          task_status: parsed.task_status ?? null,
          message_id: messageId,
        },
      });

      const structured = {
        ok: true,
        event_id: evt.event_id,
        sequence: evt.sequence,
        message_id: messageId,
      };
      return {
        structuredContent: structured,
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
      };
    }

    return {
      isError: true,
      content: [{ type: "text", text: `Unknown MCP tool: ${toolName}` }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
}
