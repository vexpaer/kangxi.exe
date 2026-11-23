import { invoke } from "@tauri-apps/api/core";
import type {
  Agent,
  DecisionAction,
  Memorial,
  Project,
  Task,
  TaskMessage,
} from "@kangxi/protocol";

export interface PlatformInfo {
  os: string;
  is_mobile: boolean;
  bridge_supported: boolean;
  local_mode_supported: boolean;
  app_version: string;
}

export interface StoredCredentials {
  server_url: string;
  token: string;
  device_label: string;
  scope: string;
  bridge_token?: string | null;
}

export interface BridgeRuntimeState {
  running: boolean;
  keep_running_in_tray: boolean;
  bridge_name: string;
  authorized_projects: Record<string, string>;
  last_error: string | null;
}

export interface ProviderProbeResult {
  provider: string;
  available: boolean;
  version: string | null;
  supports_resume: boolean;
  notes: string | null;
  resolved_path?: string | null;
}

export interface LocalWorkspaceResponse {
  host_name: string;
  local_mcp_url: string;
  local_mcp_token: string;
  codex_home: string | null;
  claude_home: string | null;
  scanned_files: number;
  imported_session_count: number;
  providers: ProviderProbeResult[];
  projects: Project[];
  agents: Agent[];
  tasks: Task[];
  task_messages: Record<string, TaskMessage[]>;
  memorials: Memorial[];
  project_paths: Record<string, string>;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let memoryCreds: StoredCredentials | null = null;

export async function getPlatformInfo(): Promise<PlatformInfo> {
  if (!isTauriRuntime()) {
    const mobile =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 860px)").matches;
    return {
      os: "web",
      is_mobile: mobile,
      bridge_supported: false,
      local_mode_supported: false,
      app_version: "0.1.2",
    };
  }
  return invoke<PlatformInfo>("get_platform_info");
}

export async function saveSecureCredentials(
  creds: StoredCredentials
): Promise<void> {
  if (!isTauriRuntime()) {
    memoryCreds = creds;
    return;
  }
  await invoke("save_secure_credentials", { creds });
}

export async function loadSecureCredentials(): Promise<StoredCredentials | null> {
  if (!isTauriRuntime()) {
    return memoryCreds;
  }
  return invoke<StoredCredentials | null>("load_secure_credentials");
}

export async function clearSecureCredentials(): Promise<void> {
  if (!isTauriRuntime()) {
    memoryCreds = null;
    return;
  }
  await invoke("clear_secure_credentials");
}

// ---------------------------------------------------------------------------
// Desktop Local-First + Auto-Import APIs (Zero Backend Required)
// ---------------------------------------------------------------------------

export async function localGetWorkspace(
  autoScan = true
): Promise<LocalWorkspaceResponse> {
  return invoke<LocalWorkspaceResponse>("local_get_workspace", {
    autoScan,
  });
}

export async function localRescanImport(): Promise<{
  projects_found: number;
  sessions_found: number;
  workspace: LocalWorkspaceResponse;
}> {
  return invoke("local_rescan_import");
}

export async function localAddProject(params: {
  name: string;
  localPath: string;
  description?: string;
}): Promise<Project> {
  return invoke<Project>("local_add_project", {
    name: params.name,
    localPath: params.localPath,
    description: params.description ?? null,
  });
}

export async function localCreateTask(params: {
  projectId: string;
  agentId: string;
  title: string;
  prompt: string;
}): Promise<Task> {
  return invoke<Task>("local_create_task", {
    projectId: params.projectId,
    agentId: params.agentId,
    title: params.title,
    prompt: params.prompt,
  });
}

export async function localSendFollowup(params: {
  taskId: string;
  content: string;
}): Promise<TaskMessage> {
  return invoke<TaskMessage>("local_send_followup", {
    taskId: params.taskId,
    content: params.content,
  });
}

export async function localCancelTask(taskId: string): Promise<void> {
  await invoke("local_cancel_task", { taskId });
}

export async function localDecideMemorial(params: {
  memorialId: string;
  action: DecisionAction;
  selectedOptionId?: string | null;
  comment: string;
  instructions?: string | null;
  expectedVersion: number;
}): Promise<Memorial> {
  return invoke<Memorial>("local_decide_memorial", {
    memorialId: params.memorialId,
    action: params.action,
    selectedOptionId: params.selectedOptionId ?? null,
    comment: params.comment,
    instructions: params.instructions ?? null,
    expectedVersion: params.expectedVersion,
  });
}

export async function localInstallMcpConfig(
  target: "codex" | "claude_code"
): Promise<string> {
  return invoke<string>("local_install_mcp_config", { target });
}

export async function listenLocalHubUpdates(
  cb: (payload: { kind?: string; title?: string; task_id?: string }) => void
): Promise<() => void> {
  if (!isTauriRuntime()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<{
    kind?: string;
    title?: string;
    task_id?: string;
  }>("kangxi:local-update", (event) => {
    cb(event.payload ?? {});
  });
  return unlisten;
}

// ---------------------------------------------------------------------------
// Remote Bridge & Native Desktop Utilities
// ---------------------------------------------------------------------------

export async function getBridgeState(): Promise<BridgeRuntimeState> {
  if (!isTauriRuntime()) {
    return {
      running: false,
      keep_running_in_tray: false,
      bridge_name: "Browser-Preview",
      authorized_projects: {},
      last_error: null,
    };
  }
  return invoke<BridgeRuntimeState>("get_bridge_state");
}

export async function setKeepBridgeInTray(enabled: boolean): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return invoke<boolean>("set_keep_bridge_in_tray", { enabled });
}

export async function authorizeLocalProject(
  projectId: string,
  localPath: string
): Promise<Record<string, string>> {
  if (!isTauriRuntime()) {
    throw new Error("Local directory authorization requires the Windows desktop app.");
  }
  return invoke<Record<string, string>>("authorize_local_project", {
    projectId,
    localPath,
  });
}

export async function removeAuthorizedProject(
  projectId: string
): Promise<Record<string, string>> {
  if (!isTauriRuntime()) return {};
  return invoke<Record<string, string>>("remove_authorized_project", {
    projectId,
  });
}

export async function pickLocalDirectory(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const dialog = await import("@tauri-apps/plugin-dialog");
  const selected = await dialog.open({
    directory: true,
    multiple: false,
    title: "选择本机项目文件夹",
  });
  return typeof selected === "string" ? selected : null;
}

export async function probeLocalProviders(): Promise<ProviderProbeResult[]> {
  if (!isTauriRuntime()) return [];
  return invoke<ProviderProbeResult[]>("probe_local_providers");
}

export async function startLocalBridge(params: {
  serverUrl: string;
  bridgeToken: string;
  bridgeName?: string;
}): Promise<BridgeRuntimeState> {
  if (!isTauriRuntime()) {
    throw new Error("Local Bridge requires the Windows desktop app.");
  }
  return invoke<BridgeRuntimeState>("start_local_bridge", {
    serverUrl: params.serverUrl,
    bridgeToken: params.bridgeToken,
    bridgeName: params.bridgeName ?? null,
  });
}

export async function stopLocalBridge(): Promise<BridgeRuntimeState> {
  if (!isTauriRuntime()) {
    return getBridgeState();
  }
  return invoke<BridgeRuntimeState>("stop_local_bridge");
}

export async function getAutostartEnabled(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const autostart = await import("@tauri-apps/plugin-autostart");
    return await autostart.isEnabled();
  } catch {
    return false;
  }
}

export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const autostart = await import("@tauri-apps/plugin-autostart");
    if (enabled) await autostart.enable();
    else await autostart.disable();
    return await autostart.isEnabled();
  } catch {
    return false;
  }
}

export async function sendNativeNotification(
  title: string,
  body: string
): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const notif = await import("@tauri-apps/plugin-notification");
    let granted = await notif.isPermissionGranted();
    if (!granted) {
      const perm = await notif.requestPermission();
      granted = perm === "granted";
    }
    if (granted) {
      notif.sendNotification({ title, body });
    }
  } catch {
    // Non-fatal
  }
}

export function playImperialStampSound(enabled: boolean): void {
  if (!enabled || typeof window === "undefined") return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.14);
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.19);

    const chime = ctx.createOscillator();
    const chimeGain = ctx.createGain();
    chime.type = "sine";
    chime.frequency.setValueAtTime(880, now + 0.03);
    chime.frequency.exponentialRampToValueAtTime(660, now + 0.35);
    chimeGain.gain.setValueAtTime(0.06, now + 0.03);
    chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    chime.connect(chimeGain);
    chimeGain.connect(ctx.destination);
    chime.start(now + 0.03);
    chime.stop(now + 0.4);
  } catch {
    // Ignore audio context restrictions
  }
}
