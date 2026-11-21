import { DurableObject } from "cloudflare:workers";
import type { SyncEvent } from "@kangxi/protocol";
import type { Env } from "./types.ts";

interface SocketMeta {
  owner_id: string;
  credential_id: string;
  scope: string;
  bridge_id: string | null;
  connected_at: string;
}

/**
 * SQLite-backed Durable Object for WebSocket Hibernation fan-out and bridge presence.
 * Keeps idle mobile/desktop/bridge connections lightweight within Cloudflare Free tier.
 */
export class SyncHub extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      const ownerId = url.searchParams.get("owner_id") ?? "";
      const credentialId = url.searchParams.get("credential_id") ?? "";
      const scope = url.searchParams.get("scope") ?? "device";
      const bridgeId = url.searchParams.get("bridge_id");

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

      const tags = [`owner:${ownerId}`, `cred:${credentialId}`, `scope:${scope}`];
      if (bridgeId) tags.push(`bridge:${bridgeId}`);

      this.ctx.acceptWebSocket(server, tags);
      const meta: SocketMeta = {
        owner_id: ownerId,
        credential_id: credentialId,
        scope,
        bridge_id: bridgeId,
        connected_at: new Date().toISOString(),
      };
      server.serializeAttachment(meta);

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const body = (await request.json()) as {
        owner_id: string;
        event: SyncEvent;
      };
      const payload = JSON.stringify({ kind: "event", event: body.event });
      const sockets = this.ctx.getWebSockets(`owner:${body.owner_id}`);
      let sent = 0;
      for (const ws of sockets) {
        try {
          ws.send(payload);
          sent++;
        } catch {
          try {
            ws.close(1011, "send_failed");
          } catch {
            // ignore
          }
        }
      }
      return Response.json({ ok: true, delivered_sockets: sent });
    }

    if (url.pathname === "/kick" && request.method === "POST") {
      const body = (await request.json()) as { credential_id: string };
      const sockets = this.ctx.getWebSockets(`cred:${body.credential_id}`);
      for (const ws of sockets) {
        try {
          ws.close(4001, "credential_revoked");
        } catch {
          // ignore
        }
      }
      return Response.json({ ok: true, closed: sockets.length });
    }

    if (url.pathname === "/presence" && request.method === "GET") {
      const ownerId = url.searchParams.get("owner_id") ?? "";
      const sockets = this.ctx.getWebSockets(`owner:${ownerId}`);
      const bridges = new Set<string>();
      for (const ws of sockets) {
        const meta = ws.deserializeAttachment() as SocketMeta | null;
        if (meta?.bridge_id) bridges.add(meta.bridge_id);
      }
      return Response.json({
        connected_clients: sockets.length,
        online_bridge_ids: Array.from(bridges),
      });
    }

    return new Response("Not Found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    if (message === "ping") {
      ws.send("pong");
      return;
    }
    try {
      const parsed = JSON.parse(message) as { type?: string };
      if (parsed.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", ts: new Date().toISOString() }));
      }
    } catch {
      // ignore malformed frames
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code);
    } catch {
      // ignore
    }
  }
}
