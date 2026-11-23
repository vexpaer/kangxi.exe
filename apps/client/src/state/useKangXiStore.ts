import {
  ApiError,
  KangXiApiClient,
  OfflineDraftStore,
  type DecisionDraft,
} from "@kangxi/app-core";
import type {
  Agent,
  BridgeHost,
  CredentialRecord,
  DecisionAction,
  Memorial,
  Project,
  ReportStyle,
  SyncEvent,
  Task,
  TaskMessage,
  ThemeMode,
} from "@kangxi/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearSecureCredentials,
  getAutostartEnabled,
  getBridgeState,
  getPlatformInfo,
  listenLocalHubUpdates,
  loadSecureCredentials,
  localAddProject,
  localCancelTask,
  localCreateTask,
  localDecideMemorial,
  localGetWorkspace,
  localInstallMcpConfig,
  localRescanImport,
  localSendFollowup,
  pickLocalDirectory,
  playImperialStampSound,
  probeLocalProviders,
  saveSecureCredentials,
  sendNativeNotification,
  type BridgeRuntimeState,
  type LocalWorkspaceResponse,
  type PlatformInfo,
  type ProviderProbeResult,
  type StoredCredentials,
} from "../platform/bridge";

export type NavSection = "inbox" | "tasks" | "bridge" | "mcp" | "settings";
export type WorkspaceMode = "local" | "remote" | "sandbox" | "unconnected";

export interface UiPreferences {
  themeMode: ThemeMode;
  modernAppearance: "light" | "dark";
  reportStyle: ReportStyle;
  soundEnabled: boolean;
  reducedMotion: boolean;
}

export interface LocalEnvMeta {
  host_name: string;
  local_mcp_url: string;
  local_mcp_token: string;
  codex_home: string | null;
  claude_home: string | null;
  scanned_files: number;
  imported_session_count: number;
  project_paths: Record<string, string>;
}

const PREFS_KEY = "kangxi_ui_prefs_v1";
const DRAFTS_KEY = "kangxi_offline_drafts_v1";

function loadPreferences(): UiPreferences {
  const defaultMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fallback: UiPreferences = {
    themeMode: "imperial",
    modernAppearance: "light",
    reportStyle: "memorial",
    soundEnabled: true,
    reducedMotion: defaultMotion,
  };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<UiPreferences>) };
  } catch {
    return fallback;
  }
}

function buildSandboxData(): {
  owner: { id: string; name: string };
  projects: Project[];
  agents: Agent[];
  bridges: BridgeHost[];
  memorials: Memorial[];
  tasks: Task[];
  taskMessages: Record<string, TaskMessage[]>;
  credentials: CredentialRecord[];
} {
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 18 * 60_000).toISOString();
  const older = new Date(Date.now() - 65 * 60_000).toISOString();

  const projects: Project[] = [
    {
      id: "prj_core",
      owner_id: "own_demo",
      name: "kangxi-core-api",
      slug: "kangxi-core-api",
      description: "Production Cloudflare Worker + D1 sync plane",
      default_agent_id: "agt_codex",
      bridge_id: "brg_win11",
      host_label: "WIN11-STUDIO",
      version: 1,
      source: "sandbox",
      created_at: older,
      updated_at: now,
    },
    {
      id: "prj_mobile",
      owner_id: "own_demo",
      name: "payment-settlement",
      slug: "payment-settlement",
      description: "Ledger reconciliation & webhook worker",
      default_agent_id: "agt_claude",
      bridge_id: "brg_win11",
      host_label: "WIN11-STUDIO",
      version: 1,
      source: "sandbox",
      created_at: older,
      updated_at: now,
    },
  ];

  const agents: Agent[] = [
    {
      id: "agt_codex",
      owner_id: "own_demo",
      name: "Codex",
      title: "军机处 · 编修",
      provider: "codex",
      mode: "bridge_managed",
      bridge_id: "brg_win11",
      capabilities: {
        supports_resume: true,
        supports_streaming: true,
        supports_cancel: true,
        notes: "Bridge-managed `codex exec --json` + `codex exec resume`",
      },
      version: 1,
      source: "sandbox",
      created_at: older,
      updated_at: now,
    },
    {
      id: "agt_claude",
      owner_id: "own_demo",
      name: "Claude Code",
      title: "内阁 · 大学士",
      provider: "claude_code",
      mode: "bridge_managed",
      bridge_id: "brg_win11",
      capabilities: {
        supports_resume: true,
        supports_streaming: true,
        supports_cancel: true,
        notes: "Bridge-managed `claude -p --output-format stream-json --resume`",
      },
      version: 1,
      source: "sandbox",
      created_at: older,
      updated_at: now,
    },
    {
      id: "agt_mcp",
      owner_id: "own_demo",
      name: "Terminal MCP Agent",
      title: "外派 · 钦差",
      provider: "mcp_external",
      mode: "mcp_only",
      bridge_id: null,
      capabilities: {
        supports_resume: false,
        supports_streaming: false,
        supports_cancel: false,
        notes: "MCP-only session: polls `check_memorial` / `get_memorial_reply`.",
      },
      version: 1,
      source: "sandbox",
      created_at: older,
      updated_at: now,
    },
  ];

  const bridges: BridgeHost[] = [
    {
      id: "brg_win11",
      owner_id: "own_demo",
      name: "WIN11-STUDIO",
      hostname: "DESKTOP-KANGXI",
      platform: "windows",
      bridge_version: "0.1.2",
      status: "online",
      last_seen_at: now,
      providers: [
        {
          provider: "codex",
          available: true,
          version: "codex 0.90.0",
          supports_resume: true,
          notes: "workspace-write sandbox active",
        },
        {
          provider: "claude_code",
          available: true,
          version: "claude 2.1.320",
          supports_resume: true,
          notes: "stream-json + --resume supported",
        },
      ],
      authorized_project_ids: ["prj_core", "prj_mobile"],
      version: 1,
      created_at: older,
      updated_at: now,
    },
  ];

  const memorials: Memorial[] = [
    {
      id: "mem_demo_01",
      owner_id: "own_demo",
      project_id: "prj_core",
      agent_id: "agt_codex",
      session_id: "ses_demo_01",
      task_id: "tsk_demo_01",
      title: "执行 D1 索引迁移 0002_events_seq 并切流",
      content: `已完成查询分析：events 表的 cursor 补偿查询在 5 万行后出现全表扫描。\n\n拟执行 SQL：\n\`\`\`sql\nCREATE INDEX IF NOT EXISTS idx_events_owner_seq\n  ON events(owner_id, sequence ASC);\n\`\`\`\n\n影响评估：\n- D1 写入行数增量：< 200 rows\n- 预计耗时：< 120ms，无破坏性字段变更\n- 已通过本地 --local 迁移回归验证`,
      request_type: "risk_confirmation",
      options: [
        {
          id: "opt_apply",
          label: "准予立即执行迁移",
          description: "运行 0002 索引迁移并回报查询延迟变化",
          recommended: true,
        },
        {
          id: "opt_stage",
          label: "先在 staging 演练 24 小时",
          description: "暂缓生产库操作，等待观察窗口",
        },
      ],
      risk_level: "high",
      risk_notes: "涉及生产 D1 实例 DDL 变更，需人工明确批准后方可继续。",
      context_summary: "源自受管会话 ses_demo_01（Codex · WIN11-STUDIO），批准后自动恢复原线程。",
      status: "pending",
      delivery_status: "queued",
      resume_status: "waiting_for_bridge",
      decision: null,
      version: 1,
      source: "mcp:sandbox",
      created_at: earlier,
      updated_at: earlier,
    },
    {
      id: "mem_demo_02",
      owner_id: "own_demo",
      project_id: "prj_mobile",
      agent_id: "agt_mcp",
      session_id: null,
      task_id: null,
      title: "是否切换 Webhook 重试退避为指数抖动策略？",
      content: `在外部终端排查超时重放日志时，发现固定 5s 重试会导致瞬时重试风暴。\n\n建议改为：\n- 初始退避 2s，上限 60s，附带 ±20% jitter\n- 保留幂等键 24 小时`,
      request_type: "decision",
      options: [
        { id: "opt_jitter", label: "采用指数抖动退避", recommended: true },
        { id: "opt_keep", label: "维持现有固定间隔" },
      ],
      risk_level: "medium",
      risk_notes: "仅调整重试调度器，不改动账本写入逻辑。",
      context_summary: "MCP-only 外部会话。",
      status: "pending",
      delivery_status: "queued",
      resume_status: "not_supported",
      decision: null,
      version: 1,
      source: "mcp:sandbox",
      created_at: now,
      updated_at: now,
    },
  ];

  const tasks: Task[] = [
    {
      id: "tsk_demo_01",
      owner_id: "own_demo",
      project_id: "prj_core",
      agent_id: "agt_codex",
      session_id: "ses_demo_01",
      bridge_id: "brg_win11",
      title: "优化 D1 事件游标读取开销并提交索引方案",
      prompt: "分析 /api/v1/events 查询计划，提出最小索引改动，执行 DDL 前递呈奏折请旨。",
      status: "waiting_for_user",
      delivery_status: "acknowledged",
      resume_status: "waiting_for_bridge",
      summary: "已递呈奏折 mem_demo_01，等待朱批后恢复执行。",
      error_message: null,
      version: 2,
      source: "Android 随身御批",
      created_at: older,
      updated_at: earlier,
    },
  ];

  const taskMessages: Record<string, TaskMessage[]> = {
    tsk_demo_01: [
      {
        id: "msg_1",
        task_id: "tsk_demo_01",
        session_id: "ses_demo_01",
        sender_type: "user",
        sender_id: "crd_android",
        kind: "user_prompt",
        content: "分析 /api/v1/events 查询计划，提出最小索引改动，执行 DDL 前递呈奏折请旨。",
        metadata: {},
        truncated: false,
        created_at: older,
      },
      {
        id: "msg_2",
        task_id: "tsk_demo_01",
        session_id: "ses_demo_01",
        sender_type: "agent",
        sender_id: "agt_codex",
        kind: "agent_report",
        content: "已运行 EXPLAIN QUERY PLAN，确认缺少 (owner_id, sequence) 复合索引。",
        metadata: {},
        truncated: false,
        created_at: earlier,
      },
    ],
  };

  return {
    owner: { id: "own_demo", name: "康熙（演示沙盒）" },
    projects,
    agents,
    bridges,
    memorials,
    tasks,
    taskMessages,
    credentials: [],
  };
}

export function useKangXiStore() {
  const [platform, setPlatform] = useState<PlatformInfo>({
    os: "web",
    is_mobile: false,
    bridge_supported: false,
    local_mode_supported: false,
    app_version: "0.1.2",
  });
  const [prefs, setPrefs] = useState<UiPreferences>(loadPreferences);
  const [nav, setNav] = useState<NavSection>("inbox");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("unconnected");
  const [remoteModalOpen, setRemoteModalOpen] = useState(false);

  const [creds, setCreds] = useState<StoredCredentials | null>(null);
  const [loadingCreds, setLoadingCreds] = useState(true);
  const [connectionState, setConnectionState] = useState<
    "local" | "disconnected" | "connecting" | "online" | "reconnecting" | "sandbox"
  >("disconnected");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [localEnv, setLocalEnv] = useState<LocalEnvMeta | null>(null);
  const [rescanning, setRescanning] = useState(false);

  const [owner, setOwner] = useState<{ id: string; name: string }>({
    id: "",
    name: "陛下",
  });
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [bridges, setBridges] = useState<BridgeHost[]>([]);
  const [memorials, setMemorials] = useState<Memorial[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskMessages, setTaskMessages] = useState<Record<string, TaskMessage[]>>({});
  const [credentials, setCredentials] = useState<CredentialRecord[]>([]);
  const [latestSequence, setLatestSequence] = useState(0);

  const [bridgeRuntime, setBridgeRuntime] = useState<BridgeRuntimeState>({
    running: false,
    keep_running_in_tray: false,
    bridge_name: "Local-Host",
    authorized_projects: {},
    last_error: null,
  });
  const [providerProbes, setProviderProbes] = useState<ProviderProbeResult[]>([]);
  const [autostartEnabled, setAutostartEnabledState] = useState(false);

  const [selectedMemorialId, setSelectedMemorialId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    id: number;
    text: string;
    tone: "ok" | "warn" | "err";
  } | null>(null);

  const draftStoreRef = useRef<OfflineDraftStore>(new OfflineDraftStore());
  const [draftTick, setDraftTick] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);

  const sandboxMode = workspaceMode === "sandbox";
  const localMode = workspaceMode === "local";

  const api = useMemo(() => {
    if (!creds || workspaceMode !== "remote") return null;
    return new KangXiApiClient({ baseUrl: creds.server_url, token: creds.token });
  }, [creds, workspaceMode]);

  const showToast = useCallback(
    (text: string, tone: "ok" | "warn" | "err" = "ok") => {
      setToast({ id: Date.now(), text, tone });
    },
    []
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.themeMode;
    document.documentElement.dataset.appearance = prefs.modernAppearance;
    document.documentElement.dataset.motion = prefs.reducedMotion
      ? "reduced"
      : "full";
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs]);

  const updatePrefs = useCallback((patch: Partial<UiPreferences>) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
  }, []);

  const applyLocalWorkspace = useCallback((ws: LocalWorkspaceResponse, selectDefaultNav = false) => {
    setOwner({ id: "local_owner", name: `本机御案 · ${ws.host_name}` });
    setLocalEnv({
      host_name: ws.host_name,
      local_mcp_url: ws.local_mcp_url,
      local_mcp_token: ws.local_mcp_token,
      codex_home: ws.codex_home,
      claude_home: ws.claude_home,
      scanned_files: ws.scanned_files,
      imported_session_count: ws.imported_session_count,
      project_paths: ws.project_paths,
    });
    setProviderProbes(ws.providers);
    setProjects(ws.projects);
    setAgents(ws.agents);
    setTasks(ws.tasks);
    setTaskMessages(ws.task_messages);
    setMemorials(ws.memorials);
    setCredentials([]);
    setBridges([
      {
        id: "brg_local",
        owner_id: "local_owner",
        name: `${ws.host_name}（本机直连）`,
        hostname: ws.host_name,
        platform: "windows",
        bridge_version: "local",
        status: "online",
        last_seen_at: new Date().toISOString(),
        providers: ws.providers.map((p) => ({
          provider: p.provider as "codex" | "claude_code" | "mcp_external",
          available: p.available,
          version: p.version,
          supports_resume: p.supports_resume,
          notes: p.notes ?? undefined,
        })),
        authorized_project_ids: Object.keys(ws.project_paths),
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
    setBridgeRuntime((prev) => ({
      ...prev,
      authorized_projects: { ...prev.authorized_projects, ...ws.project_paths },
    }));
    setSelectedMemorialId((prev) => prev ?? ws.memorials[0]?.id ?? null);
    setSelectedTaskId((prev) => prev ?? ws.tasks[0]?.id ?? null);

    // If first boot in local mode has imported Codex/Claude sessions but no pending memorials yet,
    // land directly on Tasks & Sessions so the user immediately sees their auto-imported sessions!
    if (selectDefaultNav && ws.memorials.length === 0 && ws.tasks.length > 0) {
      setNav("tasks");
    }
  }, []);

  const refreshLocalWorkspace = useCallback(
    async (autoScan = false) => {
      try {
        const ws = await localGetWorkspace(autoScan);
        applyLocalWorkspace(ws, false);
      } catch (err) {
        showToast(
          `读取本机环境失败：${err instanceof Error ? err.message : String(err)}`,
          "err"
        );
      }
    },
    [applyLocalWorkspace, showToast]
  );

  // Boot sequence:
  // 1. If saved remote credentials exist -> connect to remote Cloudflare backend
  // 2. Otherwise on Desktop (Windows) -> boot STRAIGHT into Local-First Mode with T3Code-style Auto-Import (NO backend required!)
  // 3. Otherwise on Mobile (Android) -> show Pairing / Connection Gate
  useEffect(() => {
    try {
      draftStoreRef.current.hydrate(localStorage.getItem(DRAFTS_KEY));
      setDraftTick((n) => n + 1);
    } catch {
      // ignore
    }

    let active = true;
    (async () => {
      const [info, savedCreds, bState, auto] = await Promise.all([
        getPlatformInfo(),
        loadSecureCredentials(),
        getBridgeState(),
        getAutostartEnabled(),
      ]);
      if (!active) return;
      setPlatform(info);
      setBridgeRuntime(bState);
      setAutostartEnabledState(auto);

      if (savedCreds && savedCreds.server_url && savedCreds.token) {
        setCreds(savedCreds);
        setWorkspaceMode("remote");
        if (info.bridge_supported) {
          probeLocalProviders().then((p) => {
            if (active) setProviderProbes(p);
          });
        }
      } else if (info.local_mode_supported) {
        // Desktop zero-backend Local-First boot + automatic Codex/Claude discovery!
        setWorkspaceMode("local");
        setConnectionState("local");
        try {
          const ws = await localGetWorkspace(true);
          if (!active) return;
          applyLocalWorkspace(ws, true);
          if (ws.imported_session_count > 0) {
            showToast(
              `本机直连就绪：已自动导入 ${ws.projects.length} 个项目与 ${ws.imported_session_count} 条历史会话（Codex / Claude Code）`,
              "ok"
            );
          }
        } catch (err) {
          if (active) {
            showToast(
              `本机扫描提示：${err instanceof Error ? err.message : String(err)}`,
              "warn"
            );
          }
        }
      } else {
        setWorkspaceMode("unconnected");
      }

      if (active) setLoadingCreds(false);
    })();

    return () => {
      active = false;
    };
  }, [applyLocalWorkspace, showToast]);

  // Listen to real-time local streaming & loopback MCP events when in Local Mode
  useEffect(() => {
    if (workspaceMode !== "local") return;
    let unlisten: (() => void) | null = null;
    listenLocalHubUpdates((payload) => {
      if (payload.kind === "memorial_created") {
        sendNativeNotification(
          "KangXi.exe · 本机新奏折呈递",
          payload.title || "请移步御览"
        );
      }
      void refreshLocalWorkspace(false);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [workspaceMode, refreshLocalWorkspace]);

  const persistDrafts = useCallback(() => {
    try {
      localStorage.setItem(DRAFTS_KEY, draftStoreRef.current.serialize());
    } catch {
      // ignore
    }
    setDraftTick((n) => n + 1);
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (workspaceMode === "local") {
      await refreshLocalWorkspace(false);
      return;
    }
    if (!api) return;
    try {
      setSyncError(null);
      const snap = await api.getSnapshot();
      setOwner(snap.owner);
      setProjects(snap.projects);
      setAgents(snap.agents);
      setBridges(snap.bridges);
      setMemorials(snap.memorials);
      setTasks(snap.tasks);
      setCredentials(snap.credentials);
      setLatestSequence(snap.latest_sequence);
      seqRef.current = snap.latest_sequence;
      setSelectedMemorialId((prev) => prev ?? snap.memorials[0]?.id ?? null);
      setSelectedTaskId((prev) => prev ?? snap.tasks[0]?.id ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSyncError(msg);
      if (err instanceof ApiError && err.status === 401) {
        showToast("当前设备凭证已失效或被吊销，请重新配对。", "err");
      }
    }
  }, [api, workspaceMode, refreshLocalWorkspace, showToast]);

  const loadTaskTimeline = useCallback(
    async (taskId: string) => {
      if (workspaceMode !== "remote" || !api) return;
      try {
        const res = await api.getTaskMessages(taskId);
        setTaskMessages((prev) => ({ ...prev, [taskId]: res.messages }));
        setTasks((prev) => prev.map((t) => (t.id === taskId ? res.task : t)));
      } catch {
        // ignore transient error
      }
    },
    [api, workspaceMode]
  );

  // Remote Cloudflare WebSocket + Cursor Catch-Up loop (ONLY active in remote mode)
  useEffect(() => {
    if (!api || workspaceMode !== "remote") return;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1500;

    const handleIncomingEvent = async (ev: SyncEvent) => {
      if (ev.sequence > seqRef.current) {
        seqRef.current = ev.sequence;
        setLatestSequence(ev.sequence);
      }
      if (ev.type === "memorial.created") {
        sendNativeNotification(
          "KangXi.exe · 新奏折呈递",
          String(ev.payload.title ?? "请移步御览")
        );
      }
      await refreshSnapshot();
      if (
        (ev.type === "task.message.created" || ev.type === "task.updated") &&
        ev.entity_id
      ) {
        await loadTaskTimeline(ev.entity_id);
      }
    };

    const connect = async () => {
      if (cancelled) return;
      setConnectionState((prev) =>
        prev === "online" ? "online" : "connecting"
      );
      await refreshSnapshot();

      try {
        const ws = new WebSocket(api.getWebSocketUrl());
        wsRef.current = ws;

        ws.onopen = async () => {
          if (cancelled) return;
          backoff = 1500;
          setConnectionState("online");
          try {
            const catchup = await api.getEvents(seqRef.current);
            if (catchup.events.length > 0) {
              seqRef.current = catchup.latest_sequence;
              setLatestSequence(catchup.latest_sequence);
              await refreshSnapshot();
            }
          } catch {
            // non-fatal
          }
        };

        ws.onmessage = (evt) => {
          if (typeof evt.data !== "string" || evt.data === "pong") return;
          try {
            const parsed = JSON.parse(evt.data) as {
              kind?: string;
              event?: SyncEvent;
            };
            if (parsed.kind === "event" && parsed.event) {
              void handleIncomingEvent(parsed.event);
            }
          } catch {
            // ignore
          }
        };

        ws.onclose = () => {
          if (cancelled) return;
          setConnectionState("reconnecting");
          reconnectTimer = setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 20000);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        setConnectionState("reconnecting");
        reconnectTimer = setTimeout(connect, backoff);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [api, workspaceMode, refreshSnapshot, loadTaskTimeline]);

  useEffect(() => {
    if (selectedTaskId) {
      void loadTaskTimeline(selectedTaskId);
    }
  }, [selectedTaskId, loadTaskTimeline]);

  const rescanLocalImport = useCallback(async () => {
    if (!platform.local_mode_supported) return;
    setRescanning(true);
    try {
      const res = await localRescanImport();
      applyLocalWorkspace(res.workspace, false);
      showToast(
        `自动扫描完成：发现 ${res.projects_found} 个本机项目、${res.sessions_found} 条 Codex / Claude 会话。`,
        "ok"
      );
    } catch (err) {
      showToast(
        `扫描失败：${err instanceof Error ? err.message : String(err)}`,
        "err"
      );
    } finally {
      setRescanning(false);
    }
  }, [platform.local_mode_supported, applyLocalWorkspace, showToast]);

  const installLocalMcp = useCallback(
    async (target: "codex" | "claude_code") => {
      try {
        const msg = await localInstallMcpConfig(target);
        showToast(msg, "ok");
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), "err");
      }
    },
    [showToast]
  );

  const switchToLocalMode = useCallback(async () => {
    if (!platform.local_mode_supported) return;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setWorkspaceMode("local");
    setConnectionState("local");
    setRemoteModalOpen(false);
    await refreshLocalWorkspace(true);
    showToast("已切换回本机直连模式（无需云端后端）。", "ok");
  }, [platform.local_mode_supported, refreshLocalWorkspace, showToast]);

  const enterSandbox = useCallback(() => {
    const data = buildSandboxData();
    setWorkspaceMode("sandbox");
    setConnectionState("sandbox");
    setRemoteModalOpen(false);
    setOwner(data.owner);
    setProjects(data.projects);
    setAgents(data.agents);
    setBridges(data.bridges);
    setMemorials(data.memorials);
    setTasks(data.tasks);
    setTaskMessages(data.taskMessages);
    setCredentials(data.credentials);
    setSelectedMemorialId(data.memorials[0]?.id ?? null);
    setSelectedTaskId(data.tasks[0]?.id ?? null);
    showToast("已进入演示沙盒模式。", "warn");
  }, [showToast]);

  const connectWithCredentials = useCallback(
    async (next: StoredCredentials) => {
      await saveSecureCredentials(next);
      setCreds(next);
      setWorkspaceMode("remote");
      setRemoteModalOpen(false);
      showToast("已安全保存凭证并连接 Cloudflare 远程后端。", "ok");
    },
    [showToast]
  );

  const disconnect = useCallback(async () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    await clearSecureCredentials();
    setCreds(null);
    if (platform.local_mode_supported) {
      setWorkspaceMode("local");
      setConnectionState("local");
      await refreshLocalWorkspace(true);
      showToast("已断开云端后端，自动切回本机直连模式。", "ok");
    } else {
      setWorkspaceMode("unconnected");
      setConnectionState("disconnected");
      setMemorials([]);
      setTasks([]);
      showToast("已退出连接并清除本机凭证。", "ok");
    }
  }, [platform.local_mode_supported, refreshLocalWorkspace, showToast]);

  const getDraft = useCallback(
    (memorialId: string): DecisionDraft | undefined => {
      void draftTick;
      return draftStoreRef.current.get(memorialId);
    },
    [draftTick]
  );

  const saveDraft = useCallback(
    (draft: Omit<DecisionDraft, "updated_at">) => {
      draftStoreRef.current.save(draft);
      persistDrafts();
    },
    [persistDrafts]
  );

  const clearDraft = useCallback(
    (memorialId: string) => {
      draftStoreRef.current.clear(memorialId);
      persistDrafts();
    },
    [persistDrafts]
  );

  const submitDecision = useCallback(
    async (params: {
      memorial: Memorial;
      action: DecisionAction;
      selected_option_id?: string | null;
      comment: string;
      instructions?: string;
    }): Promise<{ ok: boolean; conflict?: Memorial }> => {
      const existingDraft = draftStoreRef.current.get(params.memorial.id);
      const idempotencyKey =
        existingDraft?.idempotency_key ?? crypto.randomUUID();

      draftStoreRef.current.save({
        memorial_id: params.memorial.id,
        action: params.action,
        selected_option_id: params.selected_option_id ?? null,
        comment: params.comment,
        instructions: params.instructions ?? "",
        expected_version: params.memorial.version,
        idempotency_key: idempotencyKey,
      });
      persistDrafts();

      if (workspaceMode === "local") {
        try {
          const updated = await localDecideMemorial({
            memorialId: params.memorial.id,
            action: params.action,
            selectedOptionId: params.selected_option_id ?? null,
            comment: params.comment,
            instructions: params.instructions || null,
            expectedVersion: params.memorial.version,
          });
          setMemorials((prev) =>
            prev.map((m) => (m.id === updated.id ? updated : m))
          );
          draftStoreRef.current.clear(params.memorial.id);
          persistDrafts();
          playImperialStampSound(prefs.soundEnabled);
          showToast("本机朱批已落印保存。", "ok");
          return { ok: true };
        } catch (err) {
          showToast(
            err instanceof Error ? err.message : String(err),
            "err"
          );
          return { ok: false };
        }
      }

      if (workspaceMode === "sandbox") {
        const now = new Date().toISOString();
        const nextStatus =
          params.action === "reject"
            ? "rejected"
            : params.action === "needs_info"
              ? "needs_info"
              : "approved";
        const isManaged =
          params.memorial.resume_status === "waiting_for_bridge";
        const updated: Memorial = {
          ...params.memorial,
          status: nextStatus,
          delivery_status: "acknowledged",
          resume_status: isManaged ? "resumed" : "not_supported",
          version: params.memorial.version + 1,
          updated_at: now,
          decision: {
            id: `dec_${Date.now()}`,
            memorial_id: params.memorial.id,
            action: params.action,
            selected_option_id: params.selected_option_id ?? null,
            comment: params.comment,
            instructions: params.instructions || null,
            decided_by_device_id: "sandbox",
            decided_by_label: "本地预览御批",
            delivery_status: "acknowledged",
            resume_status: isManaged ? "resumed" : "not_supported",
            bridge_claimed_at: isManaged ? now : null,
            agent_resumed_at: isManaged ? now : null,
            resume_error: null,
            version: 1,
            created_at: now,
            updated_at: now,
          },
        };
        setMemorials((prev) =>
          prev.map((m) => (m.id === updated.id ? updated : m))
        );
        draftStoreRef.current.clear(params.memorial.id);
        persistDrafts();
        playImperialStampSound(prefs.soundEnabled);
        showToast("朱批落印成功（演示沙盒）。", "ok");
        return { ok: true };
      }

      if (!api) return { ok: false };

      try {
        const res = await api.submitDecision(params.memorial.id, {
          action: params.action,
          selected_option_id: params.selected_option_id ?? null,
          comment: params.comment,
          instructions: params.instructions || null,
          expected_version: params.memorial.version,
          idempotency_key: idempotencyKey,
        });
        setMemorials((prev) =>
          prev.map((m) => (m.id === res.memorial.id ? res.memorial : m))
        );
        draftStoreRef.current.clear(params.memorial.id);
        persistDrafts();
        playImperialStampSound(prefs.soundEnabled);
        showToast("朱批已保存至服务端。", "ok");
        return { ok: true };
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const details = err.details as
            | { current_memorial?: Memorial }
            | undefined;
          const serverMem = details?.current_memorial;
          if (serverMem) {
            draftStoreRef.current.markConflict(params.memorial.id, serverMem);
            persistDrafts();
            setMemorials((prev) =>
              prev.map((m) => (m.id === serverMem.id ? serverMem : m))
            );
            showToast(
              "检测到并发批复冲突：已保留您的本地草稿，并展示服务端现行批复。",
              "warn"
            );
            return { ok: false, conflict: serverMem };
          }
        }
        showToast(
          `发送失败，草稿已本地保留：${err instanceof Error ? err.message : String(err)}`,
          "err"
        );
        return { ok: false };
      }
    },
    [api, workspaceMode, persistDrafts, prefs.soundEnabled, showToast]
  );

  const createTask = useCallback(
    async (input: {
      project_id: string;
      agent_id: string;
      title: string;
      prompt: string;
    }) => {
      if (workspaceMode === "local") {
        try {
          const task = await localCreateTask({
            projectId: input.project_id,
            agentId: input.agent_id,
            title: input.title,
            prompt: input.prompt,
          });
          await refreshLocalWorkspace(false);
          setSelectedTaskId(task.id);
          setNav("tasks");
          showToast("已在本机直接启动 Agent 执行任务。", "ok");
        } catch (err) {
          showToast(
            err instanceof Error ? err.message : String(err),
            "err"
          );
        }
        return;
      }

      if (workspaceMode === "sandbox") {
        const now = new Date().toISOString();
        const id = `tsk_${Date.now()}`;
        const task: Task = {
          id,
          owner_id: "own_demo",
          project_id: input.project_id,
          agent_id: input.agent_id,
          session_id: `ses_${Date.now()}`,
          bridge_id: "brg_win11",
          title: input.title,
          prompt: input.prompt,
          status: "queued",
          delivery_status: "queued",
          resume_status: "waiting_for_bridge",
          summary: "演示任务已入队。",
          error_message: null,
          version: 1,
          source: "演示沙盒",
          created_at: now,
          updated_at: now,
        };
        const msg: TaskMessage = {
          id: `msg_${Date.now()}`,
          task_id: id,
          session_id: task.session_id,
          sender_type: "user",
          sender_id: "sandbox",
          kind: "user_prompt",
          content: input.prompt,
          metadata: {},
          truncated: false,
          created_at: now,
        };
        setTasks((prev) => [task, ...prev]);
        setTaskMessages((prev) => ({ ...prev, [id]: [msg] }));
        setSelectedTaskId(id);
        setNav("tasks");
        showToast("已下达新任务（演示沙盒）。", "ok");
        return;
      }

      if (!api) return;
      const res = await api.createTask(input);
      setTasks((prev) => [res.task, ...prev]);
      setTaskMessages((prev) => ({ ...prev, [res.task.id]: [res.message] }));
      setSelectedTaskId(res.task.id);
      setNav("tasks");
      showToast("任务已提交至后端队列。", "ok");
    },
    [api, workspaceMode, refreshLocalWorkspace, showToast]
  );

  const sendTaskFollowup = useCallback(
    async (taskId: string, content: string) => {
      if (workspaceMode === "local") {
        try {
          await localSendFollowup({ taskId, content });
          await refreshLocalWorkspace(false);
          showToast("已在本机恢复原会话继续执行。", "ok");
        } catch (err) {
          showToast(
            err instanceof Error ? err.message : String(err),
            "err"
          );
        }
        return;
      }

      if (workspaceMode === "sandbox") {
        const now = new Date().toISOString();
        const msg: TaskMessage = {
          id: `msg_${Date.now()}`,
          task_id: taskId,
          session_id: null,
          sender_type: "user",
          sender_id: "sandbox",
          kind: "user_followup",
          content,
          metadata: {},
          truncated: false,
          created_at: now,
        };
        setTaskMessages((prev) => ({
          ...prev,
          [taskId]: [...(prev[taskId] ?? []), msg],
        }));
        showToast("续旨已追加（演示沙盒）。", "ok");
        return;
      }

      if (!api) return;
      const res = await api.appendTaskMessage(taskId, { content });
      setTasks((prev) => prev.map((t) => (t.id === taskId ? res.task : t)));
      setTaskMessages((prev) => ({
        ...prev,
        [taskId]: [...(prev[taskId] ?? []), res.message],
      }));
      showToast("续旨已派发。", "ok");
    },
    [api, workspaceMode, refreshLocalWorkspace, showToast]
  );

  const cancelTask = useCallback(
    async (taskId: string) => {
      if (workspaceMode === "local") {
        await localCancelTask(taskId);
        await refreshLocalWorkspace(false);
        showToast("已终止本机 Agent 进程。", "warn");
        return;
      }
      if (workspaceMode === "sandbox") {
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: "cancelled" } : t))
        );
        showToast("任务已撤销。", "warn");
        return;
      }
      if (!api) return;
      const res = await api.cancelTask(taskId);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? res.task : t)));
      showToast("任务已发送取消指令。", "warn");
    },
    [api, workspaceMode, refreshLocalWorkspace, showToast]
  );

  const createProject = useCallback(
    async (input: { name: string; description?: string; localPath?: string }) => {
      if (workspaceMode === "local") {
        let dir = input.localPath;
        if (!dir) {
          dir = (await pickLocalDirectory()) ?? undefined;
        }
        if (!dir) return null;
        const folderName =
          input.name.trim() ||
          dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ||
          "Local Project";
        const proj = await localAddProject({
          name: folderName,
          localPath: dir,
          description: input.description,
        });
        await refreshLocalWorkspace(false);
        showToast(`已导入本机项目：${proj.name}`, "ok");
        return proj;
      }

      if (workspaceMode === "sandbox") {
        const now = new Date().toISOString();
        const proj: Project = {
          id: `prj_${Date.now()}`,
          owner_id: "own_demo",
          name: input.name,
          slug: input.name.toLowerCase().replace(/\s+/g, "-"),
          description: input.description ?? "",
          default_agent_id: agents[0]?.id ?? null,
          bridge_id: bridges[0]?.id ?? null,
          host_label: bridges[0]?.name ?? null,
          version: 1,
          source: "sandbox",
          created_at: now,
          updated_at: now,
        };
        setProjects((prev) => [...prev, proj]);
        showToast(`已创建项目 ${proj.name}`, "ok");
        return proj;
      }
      if (!api) return null;
      const res = await api.createProject(input);
      setProjects((prev) => [...prev, res.project]);
      showToast(`已创建项目 ${res.project.name}`, "ok");
      return res.project;
    },
    [api, workspaceMode, refreshLocalWorkspace, agents, bridges, showToast]
  );

  const pendingCount = useMemo(
    () => memorials.filter((m) => m.status === "pending").length,
    [memorials]
  );

  return {
    platform,
    prefs,
    updatePrefs,
    nav,
    setNav,
    workspaceMode,
    localMode,
    sandboxMode,
    localEnv,
    rescanning,
    remoteModalOpen,
    setRemoteModalOpen,
    creds,
    api,
    loadingCreds,
    connectionState,
    syncError,
    owner,
    projects,
    agents,
    bridges,
    memorials,
    tasks,
    taskMessages,
    credentials,
    latestSequence,
    pendingCount,
    bridgeRuntime,
    setBridgeRuntime,
    providerProbes,
    setProviderProbes,
    autostartEnabled,
    setAutostartEnabledState,
    selectedMemorialId,
    setSelectedMemorialId,
    selectedTaskId,
    setSelectedTaskId,
    toast,
    showToast,
    refreshSnapshot,
    rescanLocalImport,
    installLocalMcp,
    switchToLocalMode,
    enterSandbox,
    connectWithCredentials,
    disconnect,
    getDraft,
    saveDraft,
    clearDraft,
    submitDecision,
    createTask,
    sendTaskFollowup,
    cancelTask,
    createProject,
  };
}

export type KangXiStore = ReturnType<typeof useKangXiStore>;
