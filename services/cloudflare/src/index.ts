import {
  handleFetch as coreHandleFetch,
  type AuthContext,
  type RealtimeHub,
  type ServerEnv,
  type SqlDatabase,
} from "@kangxi/server-core";
import type { SyncEvent } from "@kangxi/protocol";
import { SyncHub } from "./hub.ts";
import type { Env } from "./types.ts";

export { SyncHub };

function createCloudflareRealtimeHub(
  syncHub: DurableObjectNamespace | undefined
): RealtimeHub | undefined {
  if (!syncHub) return undefined;
  return {
    async broadcast(ownerId: string, event: SyncEvent): Promise<void> {
      const id = syncHub.idFromName(ownerId);
      const stub = syncHub.get(id);
      await stub.fetch("https://sync-hub/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_id: ownerId, event }),
      });
    },
    async kick(credentialId: string, ownerId?: string): Promise<void> {
      if (!ownerId) return;
      const stub = syncHub.get(syncHub.idFromName(ownerId));
      await stub.fetch("https://sync-hub/kick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential_id: credentialId }),
      });
    },
    async handleWebSocketUpgrade(
      request: Request,
      auth: AuthContext
    ): Promise<Response> {
      const stubId = syncHub.idFromName(auth.owner_id);
      const stub = syncHub.get(stubId);
      const hubUrl = new URL("https://sync-hub/ws");
      hubUrl.searchParams.set("owner_id", auth.owner_id);
      hubUrl.searchParams.set("credential_id", auth.credential_id);
      hubUrl.searchParams.set("scope", auth.scope);
      if (auth.bridge_id) hubUrl.searchParams.set("bridge_id", auth.bridge_id);
      return stub.fetch(new Request(hubUrl.toString(), request));
    },
  };
}

export async function handleFetch(request: Request, env: Env): Promise<Response> {
  const serverEnv: ServerEnv = {
    DB: env.DB as unknown as SqlDatabase,
    REALTIME: createCloudflareRealtimeHub(env.SYNC_HUB),
    RUNTIME: "cloudflare",
    APP_VERSION: env.APP_VERSION ?? "0.1.2",
    BOOTSTRAP_SECRET: env.BOOTSTRAP_SECRET,
    KANGXI_USERNAME: env.KANGXI_USERNAME,
    KANGXI_PASSWORD: env.KANGXI_PASSWORD,
    KANGXI_OWNER_NAME: env.KANGXI_OWNER_NAME,
    KANGXI_RESET_PASSWORD: env.KANGXI_RESET_PASSWORD,
    FCM_PROJECT_ID: env.FCM_PROJECT_ID,
    FCM_ACCESS_TOKEN: env.FCM_ACCESS_TOKEN,
  };
  return coreHandleFetch(request, serverEnv);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleFetch(request, env);
  },
} satisfies ExportedHandler<Env>;
