import { invoke } from "@tauri-apps/api/core";

export interface PlatformInfo {
  os: string;
  is_mobile: boolean;
  bridge_supported: boolean;
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
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// In-memory fallback ONLY for non-Tauri browser preview (never stores tokens in localStorage)
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
      app_version: "0.1.0",
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
    title: "选择授权给本地 Bridge 的项目目录",
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

/**
 * Lightweight WebAudio synthesizer for Imperial jade seal stamp thud & chime.
 * Zero external audio assets required; respects user mute / reduced-motion settings.
 */
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

    // Resonant wooden desk thud
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

    // Subtle bronze/jade overtone chime
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
