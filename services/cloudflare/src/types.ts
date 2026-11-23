export interface Env {
  DB: D1Database;
  SYNC_HUB: DurableObjectNamespace;
  APP_VERSION?: string;
  BOOTSTRAP_SECRET?: string;
  KANGXI_USERNAME?: string;
  KANGXI_PASSWORD?: string;
  KANGXI_OWNER_NAME?: string;
  KANGXI_RESET_PASSWORD?: string;
  FCM_PROJECT_ID?: string;
  FCM_ACCESS_TOKEN?: string;
}
