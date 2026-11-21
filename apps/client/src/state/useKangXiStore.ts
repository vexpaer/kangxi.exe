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
  loadSecureCredentials,
  playImperialStampSound,
  probeLocalProviders,
  saveSecureCredentials,
  sendNativeNotification,
  type BridgeRuntimeState,
  type PlatformInfo,
  type ProviderProbeResult,
  type StoredCredentials,
} from "../platform/bridge";

export type NavSection = "inbox" | "tasks" | "bridge" | "mcp" | "settings";

export interface UiPreferences {
  themeMode: ThemeMode;
  reportStyle: ReportStyle;
  soundEnabled: boolean;
  reducedMotion: boolean;
}

const PREFS_KEY = "kangxi_ui_prefs_v1";
const DRAFTS_KEY = "kangxi_offline_drafts_v1";

function loadPreferences(): UiPreferences {
  const defaultMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fallback: UiPreferences = {
    themeMode: "imperial",
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
      bridge_version: "0.1.0",
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
      context_summary: "源自受管会话 ses_demo_01（Codex · WIN11-STUDIO），批准后 Bridge 将自动唤醒原线程。",
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
      content: `在外部终端排查超时重放日志时，发现固定 5s 重试会导致瞬时重试风暴。\n\n建议改为：\n- 初始退避 2s，上限 60s，附带 ±20% jitter\n- 保留幂等键 24 小时\n\n注：当前为外部 MCP-only 会话，朱批保存后由该 Agent 主动调用 get_memorial_reply 获取结果。`,
      request_type: "decision",
      options: [
        {
          id: "opt_jitter",
          label: "采用指数抖动退避",
          recommended: true,
        },
        {
          id: "opt_keep",
          label: "维持现有固定间隔",
        },
      ],
      risk_level: "medium",
      risk_notes: "仅调整重试调度器，不改动账本写入逻辑。",
      context_summary: "MCP-only 外部会话（无须 Bridge 强行唤醒）。",
      status: "pending",
      delivery_status: "queued",
      resume_status: "not_supported",
      decision: null,
      version: 1,
      source: "mcp:sandbox",
      created_at: now,
      updated_at: now,
    },
    {
      id: "mem_demo_03",
      owner_id: "own_demo",
      project_id: "prj_core",
      agent_id: "agt_claude",
      session_id: "ses_demo_02",
      task_id: "tsk_demo_02",
      title: "合并认证令牌吊销中间件补丁",
      content: `已补全 credentials.revoked_at 实时校验，并在吊销后通知 SyncHub Durable Object 断开对应 WebSocket 连接。\n\n全部 6 项端到端用例通过。请求准予合入主干。`,
      request_type: "approval",
      options: [],
      risk_level: "low",
      risk_notes: "纯安全增强补丁，向后兼容。",
      context_summary: "已完成端到端闭环验证。",
      status: "approved",
      delivery_status: "acknowledged",
      resume_status: "resumed",
      decision: {
        id: "dec_demo_03",
        memorial_id: "mem_demo_03",
        action: "approve",
        selected_option_id: null,
        comment: "准奏。吊销即断连，甚合朕意。",
        instructions: "合入后顺手补齐 README 安全章节。",
        decided_by_device_id: "crd_android",
        decided_by_label: "Android 随身御批",
        delivery_status: "acknowledged",
        resume_status: "resumed",
        bridge_claimed_at: earlier,
        agent_resumed_at: earlier,
        resume_error: null,
        version: 2,
        created_at: earlier,
        updated_at: earlier,
      },
      version: 2,
      source: "mcp:sandbox",
      created_at: older,
      updated_at: earlier,
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
    {
      id: "tsk_demo_02",
      owner_id: "own_demo",
      project_id: "prj_core",
      agent_id: "agt_claude",
      session_id: "ses_demo_02",
      bridge_id: "brg_win11",
      title: "实现凭证吊销即时踢出 WebSocket 连接",
      prompt: "在 POST /api/v1/credentials/:id/revoke 中调用 SyncHub /kick 并补充测试。",
      status: "completed",
      delivery_status: "acknowledged",
      resume_status: "resumed",
      summary: "已完成实现与端到端测试验证。",
      error_message: null,
      version: 4,
      source: "Windows 御案",
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
        content: "已运行 EXPLAIN QUERY PLAN，确认缺少 (owner_id, sequence) 复合索引。正在生成迁移草案。",
        metadata: {},
        truncated: false,
        created_at: earlier,
      },
      {
        id: "msg_3",
        task_id: "tsk_demo_01",
        session_id: "ses_demo_01",
        sender_type: "agent",
        sender_id: "agt_codex",
        kind: "memorial_notice",
        content: "[Memorial mem_demo_01] 已递呈风险确认奏折，当前暂停等待朱批。",
        metadata: { memorial_id: "mem_demo_01" },
        truncated: false,
        created_at: earlier,
      },
    ],
    tsk_demo_02: [
      {
        id: "msg_4",
        task_id: "tsk_demo_02",
        session_id: "ses_demo_02",
        sender_type: "user",
        sender_id: "own_demo",
        kind: "user_prompt",
        content: "在 POST /api/v1/credentials/:id/revoke 中调用 SyncHub /kick 并补充测试。",
        metadata: {},
        truncated: false,
        created_at: older,
      },
      {
        id: "msg_5",
        task_id: "tsk_demo_02",
        session_id: "ses_demo_02",
        sender_type: "agent",
        sender_id: "agt_claude",
        kind: "task_result",
        content: "已完成 SyncHub /kick 接线并补充端到端吊销验证，全部检查通过。",
        metadata: {},
        truncated: false,
        created_at: earlier,
      },
    ],
  };

  const credentials: CredentialRecord[] = [
    {
      id: "crd_win",
      owner_id: "own_demo",
      label: "Windows 御案",
      scope: "owner",
      device_platform: "windows",
      agent_id: null,
      bridge_id: null,
      allowed_project_ids: null,
      token_prefix: "kx_own_demo",
      last_used_at: now,
      revoked_at: null,
      created_at: older,
    },
    {
      id: "crd_android",
      owner_id: "own_demo",
      label: "Android 随身御批",
      scope: "device",
      device_platform: "android",
      agent_id: null,
      bridge_id: null,
      allowed_project_ids: null,
      token_prefix: "kx_dev_demo",
      last_used_at: earlier,
      revoked_at: null,
      created_at: older,
    },
  ];

  return {
    owner: { id: "own_demo", name: "康熙（本地预览）" },
    projects,
    agents,
    bridges,
    memorials,
    tasks,
    taskMessages,
    credentials,
  };
}

export function useKangXiStore() {
  const [platform, setPlatform] = useState<PlatformInfo>({
    os: "web",
    is_mobile: false,
    bridge_supported: false,
    app_version: "0.1.0",
  });
  const [prefs, setPrefs] = useState<UiPreferences>(loadPreferences);
  const [nav, setNav] = useState<NavSection>("inbox");
  const [creds, setCreds] = useState<StoredCredentials | null>(null);
  const [sandboxMode, setSandboxMode] = useState(false);
  const [loadingCreds, setLoadingCreds] = useState(true);
  const [connectionState, setConnectionState] = useState<
    "disconnected" | "connecting" | "online" | "reconnecting" | "sandbox"
  >("disconnected");
  const [syncError, setSyncError] = useState<string | null>(null);

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
  const [toast, setToast] = useState<{ id: number; text: string; tone: "ok" | "warn" | "err" } | null>(null);

  const draftStoreRef = useRef<OfflineDraftStore>(new OfflineDraftStore());
  const [draftTick, setDraftTick] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);

  const api = useMemo(() => {
    if (!creds) return null;
    return new KangXiApiClient({ baseUrl: creds.server_url, token: creds.token });
  }, [creds]);

  const showToast = useCallback((text: string, tone: "ok" | "warn" | "err" = "ok") => {
    setToast({ id: Date.now(), text, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  // Apply theme & motion attributes to document root
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.themeMode;
    document.documentElement.dataset.motion = prefs.reducedMotion ? "reduced" : "full";
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs]);

  const updatePrefs = useCallback((patch: Partial<UiPreferences>) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
  }, []);

  // Hydrate drafts + platform info + secure credentials on boot
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
      if (info.bridge_supported) {
        probeLocalProviders().then((p) => {
          if (active) setProviderProbes(p);
        });
      }
      if (savedCreds && savedCreds.server_url && savedCreds.token) {
        setCreds(savedCreds);
      }
      setLoadingCreds(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const persistDrafts = useCallback(() => {
    try {
      localStorage.setItem(DRAFTS_KEY, draftStoreRef.current.serialize());
    } catch {
      // ignore
    }
    setDraftTick((n) => n + 1);
  }, []);

  const refreshSnapshot = useCallback(async () => {
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
  }, [api, showToast]);

  const loadTaskTimeline = useCallback(
    async (taskId: string) => {
      if (sandboxMode) return;
      if (!api) return;
      try {
        const res = await api.getTaskMessages(taskId);
        setTaskMessages((prev) => ({ ...prev, [taskId]: res.messages }));
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? res.task : t))
        );
      } catch {
        // ignore transient error
      }
    },
    [api, sandboxMode]
  );

  // Real-time WebSocket + Cursor Catch-Up loop
  useEffect(() => {
    if (!api || sandboxMode) return;
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
          // Catch up any events missed during disconnect via cursor
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
  }, [api, sandboxMode, refreshSnapshot, loadTaskTimeline]);

  // Load selected task timeline automatically
  useEffect(() => {
    if (selectedTaskId) {
      void loadTaskTimeline(selectedTaskId);
    }
  }, [selectedTaskId, loadTaskTimeline]);

  const enterSandbox = useCallback(() => {
    const data = buildSandboxData();
    setSandboxMode(true);
    setConnectionState("sandbox");
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
    showToast("已进入本地演示沙盒，随时可在设置中连接真实 Cloudflare 后端。", "warn");
  }, [showToast]);

  const connectWithCredentials = useCallback(
    async (next: StoredCredentials) => {
      await saveSecureCredentials(next);
      setSandboxMode(false);
      setCreds(next);
      showToast("已安全保存凭证并连接后端。", "ok");
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
    setSandboxMode(false);
    setConnectionState("disconnected");
    setMemorials([]);
    setTasks([]);
    showToast("已退出连接并清除本机凭证。", "ok");
  }, [showToast]);

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

      // Save offline draft FIRST so nothing is ever lost on network drop or 409 conflict
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

      if (sandboxMode) {
        const now = new Date().toISOString();
        const nextStatus =
          params.action === "reject"
            ? "rejected"
            : params.action === "needs_info"
              ? "needs_info"
              : "approved";
        const isManaged = params.memorial.resume_status === "waiting_for_bridge";
        const updated: Memorial = {
          ...params.memorial,
          status: nextStatus,
          delivery_status: isManaged ? "acknowledged" : "acknowledged",
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
        showToast("朱批落印成功（预览沙盒）。", "ok");
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
          const details = err.details as { current_memorial?: Memorial } | undefined;
          const serverMem = details?.current_memorial;
          if (serverMem) {
            draftStoreRef.current.markConflict(params.memorial.id, serverMem);
            persistDrafts();
            setMemorials((prev) =>
              prev.map((m) => (m.id === serverMem.id ? serverMem : m))
            );
            showToast("检测到并发批复冲突：已保留您的本地草稿，并展示服务端现行批复。", "warn");
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
    [api, sandboxMode, persistDrafts, prefs.soundEnabled, showToast]
  );

  const createTask = useCallback(
    async (input: {
      project_id: string;
      agent_id: string;
      title: string;
      prompt: string;
    }) => {
      if (sandboxMode) {
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
          source: "本地预览",
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
        showToast("已下达新任务（预览沙盒）。", "ok");
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
    [api, sandboxMode, showToast]
  );

  const sendTaskFollowup = useCallback(
    async (taskId: string, content: string) => {
      if (sandboxMode) {
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
        showToast("续旨已追加（预览沙盒）。", "ok");
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
    [api, sandboxMode, showToast]
  );

  const cancelTask = useCallback(
    async (taskId: string) => {
      if (sandboxMode) {
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
    [api, sandboxMode, showToast]
  );

  const createProject = useCallback(
    async (input: { name: string; description?: string }) => {
      if (sandboxMode) {
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
    [api, sandboxMode, agents, bridges, showToast]
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
    creds,
    api,
    sandboxMode,
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
