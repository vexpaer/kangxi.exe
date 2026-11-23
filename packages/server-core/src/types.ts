import type { SyncEvent } from "@kangxi/protocol";

export interface SqlRunMeta {
  changes?: number;
  last_row_id?: number;
}

export interface SqlResult<T = Record<string, unknown>> {
  results?: T[];
  success?: boolean;
  meta?: SqlRunMeta;
}

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(col?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run(): Promise<SqlResult>;
}

/**
 * Runtime-agnostic SQLite interface compatible with both Cloudflare D1
 * and Node 24's built-in `node:sqlite`.
 */
export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  exec?(sql: string): Promise<unknown>;
}

export interface AuthContext {
  credential_id: string;
  owner_id: string;
  label: string;
  scope: "owner" | "device" | "bridge" | "mcp_agent";
  device_platform: string | null;
  agent_id: string | null;
  bridge_id: string | null;
  allowed_project_ids: string[] | null;
}

export interface RealtimeHub {
  broadcast(ownerId: string, event: SyncEvent): Promise<void>;
  kick(credentialId: string, ownerId?: string): Promise<void>;
  handleWebSocketUpgrade?(
    request: Request,
    auth: AuthContext
  ): Promise<Response>;
}

export interface ServerEnv {
  DB: SqlDatabase;
  REALTIME?: RealtimeHub;
  RUNTIME?: "cloudflare" | "node";
  APP_VERSION?: string;
  BOOTSTRAP_SECRET?: string;
  /** Optional pre-configured admin username for zero-touch agent deployments */
  KANGXI_USERNAME?: string;
  /** Optional pre-configured admin password for zero-touch agent deployments */
  KANGXI_PASSWORD?: string;
  /** Optional display name for the auto-seeded admin owner */
  KANGXI_OWNER_NAME?: string;
  /** Set to "1" or "true" to reset existing admin credentials from env */
  KANGXI_RESET_PASSWORD?: string;
  FCM_PROJECT_ID?: string;
  FCM_ACCESS_TOKEN?: string;
}
