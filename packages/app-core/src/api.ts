import type {
  Agent,
  BridgeHost,
  CredentialRecord,
  DecisionAction,
  Memorial,
  Project,
  SyncEvent,
  Task,
  TaskMessage,
} from "@kangxi/protocol";

export interface ApiClientConfig {
  baseUrl: string;
  token: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface WorkspaceSnapshot {
  owner: { id: string; name: string };
  projects: Project[];
  agents: Agent[];
  bridges: BridgeHost[];
  memorials: Memorial[];
  tasks: Task[];
  credentials: CredentialRecord[];
  latest_sequence: number;
}

export interface BootstrapResponse {
  owner: { id: string; name: string };
  token: string;
  credential: CredentialRecord;
  default_project: Project;
  default_agents: Agent[];
}

export interface PairingCreateResponse {
  pairing_code: string;
  expires_at: string;
  qr_payload: string;
}

export interface PairingRedeemResponse {
  token: string;
  credential: CredentialRecord;
  owner: { id: string; name: string };
}

export class KangXiApiClient {
  private baseUrl: string;
  private token: string;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
  }

  setConfig(config: ApiClientConfig): void {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getWebSocketUrl(): string {
    const wsBase = this.baseUrl.replace(/^http/i, "ws");
    return `${wsBase}/api/v1/ws?token=${encodeURIComponent(this.token)}`;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { idempotencyKey?: string; skipAuth?: boolean } = {}
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }
    if (!init.skipAuth && this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }
    if (init.idempotencyKey) {
      headers.set("Idempotency-Key", init.idempotencyKey);
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { message: text };
      }
    }

    if (!res.ok) {
      const errObj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<
        string,
        unknown
      >;
      throw new ApiError(
        res.status,
        String(errObj.code ?? `HTTP_${res.status}`),
        String(errObj.error ?? errObj.message ?? `Request failed (${res.status})`),
        errObj
      );
    }

    return parsed as T;
  }

  health(): Promise<{
    ok: boolean;
    service: string;
    version: string;
    runtime?: "cloudflare" | "node";
    bootstrapped: boolean;
    password_auth?: boolean;
  }> {
    return this.request("/health", { skipAuth: true });
  }

  bootstrap(input: {
    owner_name?: string;
    username?: string;
    password?: string;
    device_label: string;
    platform: "windows" | "android" | "web" | "cli";
    bootstrap_secret?: string;
  }): Promise<BootstrapResponse> {
    return this.request("/api/v1/bootstrap", {
      method: "POST",
      body: JSON.stringify(input),
      skipAuth: true,
    });
  }

  login(input: {
    username: string;
    password: string;
    device_label: string;
    platform: "windows" | "android" | "web" | "cli";
    fcm_token?: string;
  }): Promise<{
    owner: { id: string; name: string; username?: string | null };
    token: string;
    credential: CredentialRecord;
  }> {
    return this.request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
      skipAuth: true,
    });
  }

  changePassword(input: {
    current_password?: string;
    username?: string;
    new_password: string;
    revoke_other_devices?: boolean;
  }): Promise<{ ok: boolean; username: string; revoked_devices: number }> {
    return this.request("/api/v1/auth/password", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  redeemPairing(input: {
    pairing_code: string;
    device_label?: string;
    platform: "windows" | "android" | "web" | "cli";
    fcm_token?: string;
  }): Promise<PairingRedeemResponse> {
    return this.request("/api/v1/pairing/redeem", {
      method: "POST",
      body: JSON.stringify(input),
      skipAuth: true,
    });
  }

  getSnapshot(): Promise<WorkspaceSnapshot> {
    return this.request("/api/v1/snapshot");
  }

  getEvents(after: number, limit = 200): Promise<{ events: SyncEvent[]; latest_sequence: number }> {
    return this.request(`/api/v1/events?after=${after}&limit=${limit}`);
  }

  listMemorials(params?: {
    status?: string;
    project_id?: string;
    q?: string;
  }): Promise<{ memorials: Memorial[] }> {
    const sp = new URLSearchParams();
    if (params?.status && params.status !== "all") sp.set("status", params.status);
    if (params?.project_id) sp.set("project_id", params.project_id);
    if (params?.q) sp.set("q", params.q);
    const qs = sp.toString();
    return this.request(`/api/v1/memorials${qs ? `?${qs}` : ""}`);
  }

  getMemorial(id: string): Promise<{ memorial: Memorial }> {
    return this.request(`/api/v1/memorials/${encodeURIComponent(id)}`);
  }

  submitDecision(
    memorialId: string,
    input: {
      action: DecisionAction;
      selected_option_id?: string | null;
      comment: string;
      instructions?: string | null;
      expected_version: number;
      idempotency_key: string;
    }
  ): Promise<{ memorial: Memorial }> {
    return this.request(`/api/v1/memorials/${encodeURIComponent(memorialId)}/decision`, {
      method: "POST",
      body: JSON.stringify(input),
      idempotencyKey: input.idempotency_key,
    });
  }

  createProject(input: {
    name: string;
    description?: string;
    default_agent_id?: string | null;
    bridge_id?: string | null;
    host_label?: string | null;
  }): Promise<{ project: Project }> {
    return this.request("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  createAgent(input: {
    name: string;
    title?: string;
    provider: "codex" | "claude_code" | "mcp_external";
    mode: "bridge_managed" | "mcp_only";
    bridge_id?: string | null;
    supports_resume?: boolean;
    notes?: string;
  }): Promise<{ agent: Agent }> {
    return this.request("/api/v1/agents", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  createTask(input: {
    project_id: string;
    agent_id: string;
    title: string;
    prompt: string;
    session_id?: string | null;
    idempotency_key?: string;
  }): Promise<{ task: Task; message: TaskMessage }> {
    const key = input.idempotency_key ?? crypto.randomUUID();
    return this.request("/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ ...input, idempotency_key: key }),
      idempotencyKey: key,
    });
  }

  getTaskMessages(taskId: string): Promise<{ task: Task; messages: TaskMessage[] }> {
    return this.request(`/api/v1/tasks/${encodeURIComponent(taskId)}/messages`);
  }

  appendTaskMessage(
    taskId: string,
    input: { content: string; idempotency_key?: string }
  ): Promise<{ task: Task; message: TaskMessage }> {
    const key = input.idempotency_key ?? crypto.randomUUID();
    return this.request(`/api/v1/tasks/${encodeURIComponent(taskId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ ...input, idempotency_key: key }),
      idempotencyKey: key,
    });
  }

  cancelTask(taskId: string): Promise<{ task: Task }> {
    return this.request(`/api/v1/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: "POST",
    });
  }

  createPairing(input?: {
    label?: string;
    platform?: "android" | "windows" | "web";
  }): Promise<PairingCreateResponse> {
    return this.request("/api/v1/pairing/create", {
      method: "POST",
      body: JSON.stringify({
        label: input?.label ?? "Android 移动御批",
        platform: input?.platform ?? "android",
      }),
    });
  }

  createCredential(input: {
    label: string;
    scope: "device" | "bridge" | "mcp_agent";
    device_platform?: "windows" | "android" | "web" | "cli" | null;
    agent_id?: string | null;
    bridge_id?: string | null;
    allowed_project_ids?: string[] | null;
  }): Promise<{ token: string; credential: CredentialRecord }> {
    return this.request("/api/v1/credentials", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  revokeCredential(id: string): Promise<{ revoked: boolean; id: string }> {
    return this.request(`/api/v1/credentials/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
    });
  }

  exportData(): Promise<Record<string, unknown>> {
    return this.request("/api/v1/export");
  }
}
