import type { SyncEvent } from "@kangxi/protocol";
import type { AuthContext, RealtimeHub } from "@kangxi/server-core";
import { WebSocket } from "ws";

interface TrackedSocket {
  ws: WebSocket;
  auth: AuthContext;
  connectedAt: string;
}

/**
 * In-memory WebSocket fan-out hub for standalone Node/Docker deployments.
 * Mirrors the exact protocol of Cloudflare SyncHub Durable Object.
 */
export class NodeRealtimeHub implements RealtimeHub {
  private sockets = new Set<TrackedSocket>();

  register(ws: WebSocket, auth: AuthContext): void {
    const entry: TrackedSocket = {
      ws,
      auth,
      connectedAt: new Date().toISOString(),
    };
    this.sockets.add(entry);

    ws.on("message", (raw) => {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      if (text === "ping") {
        if (ws.readyState === WebSocket.OPEN) ws.send("pong");
        return;
      }
      try {
        const parsed = JSON.parse(text) as { type?: string };
        if (parsed.type === "ping" && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "pong", ts: new Date().toISOString() }));
        }
      } catch {
        // ignore non-JSON frames
      }
    });

    const cleanup = () => {
      this.sockets.delete(entry);
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  }

  async broadcast(ownerId: string, event: SyncEvent): Promise<void> {
    const payload = JSON.stringify({ kind: "event", event });
    for (const entry of this.sockets) {
      if (entry.auth.owner_id !== ownerId) continue;
      if (entry.ws.readyState !== WebSocket.OPEN) continue;
      try {
        entry.ws.send(payload);
      } catch {
        try {
          entry.ws.close(1011, "send_failed");
        } catch {
          // ignore
        }
        this.sockets.delete(entry);
      }
    }
  }

  async kick(credentialId: string): Promise<void> {
    for (const entry of this.sockets) {
      if (entry.auth.credential_id !== credentialId) continue;
      try {
        entry.ws.close(4001, "credential_revoked");
      } catch {
        // ignore
      }
      this.sockets.delete(entry);
    }
  }

  closeAll(): void {
    for (const entry of this.sockets) {
      try {
        entry.ws.close(1001, "server_shutdown");
      } catch {
        // ignore
      }
    }
    this.sockets.clear();
  }
}
