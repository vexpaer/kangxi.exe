export interface Env {
  DB: D1Database;
  SYNC_HUB: DurableObjectNamespace;
  APP_VERSION?: string;
  BOOTSTRAP_SECRET?: string;
  FCM_PROJECT_ID?: string;
  FCM_ACCESS_TOKEN?: string;
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
