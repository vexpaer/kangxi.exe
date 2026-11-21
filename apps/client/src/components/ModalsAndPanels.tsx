import { KangXiApiClient } from "@kangxi/app-core";
import type { DecisionAction, Task } from "@kangxi/protocol";
import {
  Check,
  Cloud,
  Copy,
  Download,
  FolderPlus,
  HardDrive,
  KeyRound,
  Link2,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import {
  authorizeLocalProject,
  pickLocalDirectory,
  probeLocalProviders,
  removeAuthorizedProject,
  setAutostartEnabled,
  setKeepBridgeInTray,
  startLocalBridge,
  stopLocalBridge,
} from "../platform/bridge";
import type { KangXiStore } from "../state/useKangXiStore";

// ---------------------------------------------------------------------------
// 1. Optional Remote Cloudflare Connection Gate / Modal
//    - On Android: initial screen (pairs to self-hosted backend)
//    - On Windows Desktop: ONLY opened when user wants remote control / other PCs
// ---------------------------------------------------------------------------

export function ConnectionGate({
  store,
  asModal = false,
  onClose,
}: {
  store: KangXiStore;
  asModal?: boolean;
  onClose?: () => void;
}) {
  const [tab, setTab] = useState<"bootstrap" | "token" | "pairing">(
    store.platform.is_mobile ? "pairing" : "bootstrap"
  );
  const [serverUrl, setServerUrl] = useState(
    store.creds?.server_url ||
      "https://kangxi-backend.your-subdomain.workers.dev"
  );
  const [ownerName, setOwnerName] = useState("康熙");
  const [deviceLabel, setDeviceLabel] = useState(
    store.platform.is_mobile ? "Android 随身御批" : "Windows 御案"
  );
  const [token, setToken] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const normalizeUrl = (u: string) => u.trim().replace(/\/+$/, "");

  const handleBootstrap = async () => {
    setBusy(true);
    setErr(null);
    try {
      const url = normalizeUrl(serverUrl);
      const client = new KangXiApiClient({ baseUrl: url, token: "" });
      const res = await client.bootstrap({
        owner_name: ownerName.trim() || "陛下",
        device_label: deviceLabel.trim() || "Windows 御案",
        platform: store.platform.is_mobile ? "android" : "windows",
        bootstrap_secret: bootstrapSecret.trim() || undefined,
      });
      await store.connectWithCredentials({
        server_url: url,
        token: res.token,
        device_label: res.credential.label,
        scope: res.credential.scope,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleTokenLogin = async () => {
    setBusy(true);
    setErr(null);
    try {
      const url = normalizeUrl(serverUrl);
      const client = new KangXiApiClient({ baseUrl: url, token: token.trim() });
      await client.getSnapshot();
      await store.connectWithCredentials({
        server_url: url,
        token: token.trim(),
        device_label: deviceLabel.trim() || "Connected Device",
        scope: "device",
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handlePairingRedeem = async () => {
    setBusy(true);
    setErr(null);
    try {
      let url = normalizeUrl(serverUrl);
      let code = pairingCode.trim();
      if (code.startsWith("{")) {
        const parsed = JSON.parse(code) as {
          server_url?: string;
          pairing_code?: string;
        };
        if (parsed.server_url) url = normalizeUrl(parsed.server_url);
        if (parsed.pairing_code) code = parsed.pairing_code;
      }
      const client = new KangXiApiClient({ baseUrl: url, token: "" });
      const res = await client.redeemPairing({
        pairing_code: code,
        device_label: deviceLabel.trim() || "Android 随身御批",
        platform: store.platform.is_mobile ? "android" : "windows",
      });
      await store.connectWithCredentials({
        server_url: url,
        token: res.token,
        device_label: res.credential.label,
        scope: res.credential.scope,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const card = (
    <div className="gate-card" onClick={(e) => e.stopPropagation()}>
      <div className="gate-header">
        <div className="gate-seal">御批</div>
        <div>
          <h1>{asModal ? "连接云端后端（跨设备 / 控制其他电脑）" : "KangXi.exe"}</h1>
          <p className="muted">
            {asModal
              ? "仅在使用手机远程批阅或跨多台电脑协作时需要连接 Cloudflare 后端；单机使用可直接停留在「本机直连模式」。"
              : "自部署 Cloudflare 后端 · 跨设备 Agent 奏折批阅与远程控制"}
          </p>
        </div>
        {asModal && onClose ? (
          <button
            className="icon-btn"
            style={{ marginLeft: "auto" }}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        ) : (
          <div className="gate-theme-switch">
            <button
              className={`pill-btn ${store.prefs.themeMode === "imperial" ? "is-active" : ""}`}
              onClick={() => store.updatePrefs({ themeMode: "imperial" })}
            >
              仿真皇帝
            </button>
            <button
              className={`pill-btn ${store.prefs.themeMode === "modern" ? "is-active" : ""}`}
              onClick={() => store.updatePrefs({ themeMode: "modern" })}
            >
              现代极简
            </button>
          </div>
        )}
      </div>

      <div className="seg-tabs">
        <button
          className={tab === "bootstrap" ? "is-active" : ""}
          onClick={() => setTab("bootstrap")}
        >
          初次建阁 (Bootstrap)
        </button>
        <button
          className={tab === "pairing" ? "is-active" : ""}
          onClick={() => setTab("pairing")}
        >
          配对码登录 (手机/新设备)
        </button>
        <button
          className={tab === "token" ? "is-active" : ""}
          onClick={() => setTab("token")}
        >
          已有凭证连接
        </button>
      </div>

      <div className="form-stack">
        <label className="field">
          <span>自部署 Cloudflare Worker URL</span>
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://kangxi-backend.<subdomain>.workers.dev"
          />
        </label>

        {tab === "bootstrap" && (
          <>
            <div className="form-row">
              <label className="field">
                <span>主事者称谓 (Owner)</span>
                <input
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                />
              </label>
              <label className="field">
                <span>本机名称</span>
                <input
                  value={deviceLabel}
                  onChange={(e) => setDeviceLabel(e.target.value)}
                />
              </label>
            </div>
            <label className="field">
              <span>Bootstrap Secret（可选）</span>
              <input
                type="password"
                value={bootstrapSecret}
                onChange={(e) => setBootstrapSecret(e.target.value)}
                placeholder="若 Worker 未配置可留空"
              />
            </label>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={handleBootstrap}
            >
              {busy ? "正在初始化实例..." : "初始化并接入远程后端"}
            </button>
          </>
        )}

        {tab === "pairing" && (
          <>
            <label className="field">
              <span>一次性配对码或扫码 JSON 内容</span>
              <input
                value={pairingCode}
                onChange={(e) => setPairingCode(e.target.value)}
                placeholder="例如：ABCD-2345 或粘贴 QR JSON"
              />
            </label>
            <label className="field">
              <span>本设备名称</span>
              <input
                value={deviceLabel}
                onChange={(e) => setDeviceLabel(e.target.value)}
              />
            </label>
            <button
              className="btn-primary"
              disabled={busy || !pairingCode.trim()}
              onClick={handlePairingRedeem}
            >
              {busy ? "正在配对..." : "核验配对码并接入"}
            </button>
          </>
        )}

        {tab === "token" && (
          <>
            <label className="field">
              <span>Bearer 凭证 (kx_own_... / kx_dev_...)</span>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="凭证将安全存入系统凭证库，不写入明文 LocalStorage"
              />
            </label>
            <label className="field">
              <span>本设备名称</span>
              <input
                value={deviceLabel}
                onChange={(e) => setDeviceLabel(e.target.value)}
              />
            </label>
            <button
              className="btn-primary"
              disabled={busy || !token.trim()}
              onClick={handleTokenLogin}
            >
              {busy ? "正在校验..." : "连接实例"}
            </button>
          </>
        )}

        {err && <div className="alert-err">{err}</div>}
      </div>

      <div className="gate-footer">
        {asModal && onClose ? (
          <>
            <span className="muted">部署指引见仓库 <code>docs/SELF_HOST.md</code>。</span>
            <button className="btn-ghost" onClick={onClose}>
              暂不连接，继续使用本机模式
            </button>
          </>
        ) : (
          <>
            <span className="muted">
              尚未部署 Cloudflare Worker？可先体验双视觉与批阅交互。
            </span>
            <button className="btn-ghost" onClick={store.enterSandbox}>
              进入演示沙盒
            </button>
          </>
        )}
      </div>
    </div>
  );

  if (asModal) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        {card}
      </div>
    );
  }

  return <div className="gate-backdrop">{card}</div>;
}

// ---------------------------------------------------------------------------
// 2. New Task Modal ("拟旨派差 / Create Task")
// ---------------------------------------------------------------------------

export function NewTaskModal({
  store,
  onClose,
}: {
  store: KangXiStore;
  onClose: () => void;
}) {
  const [projectId, setProjectId] = useState(store.projects[0]?.id ?? "");
  const [agentId, setAgentId] = useState(store.agents[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedProject = store.projects.find((p) => p.id === projectId);
  const boundBridge = store.bridges.find(
    (b) => b.id === selectedProject?.bridge_id
  );
  const bridgeOffline =
    !store.localMode && (!boundBridge || boundBridge.status !== "online");

  const handlePickAndAddProject = async () => {
    const p = await store.createProject({ name: "" });
    if (p) setProjectId(p.id);
  };

  const submit = async () => {
    if (!projectId || !agentId || !title.trim() || !prompt.trim()) return;
    setBusy(true);
    try {
      await store.createTask({
        project_id: projectId,
        agent_id: agentId,
        title: title.trim(),
        prompt: prompt.trim(),
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const isImperial = store.prefs.reportStyle === "memorial";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{isImperial ? "拟旨派差" : "Create New Agent Task"}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {store.localMode && store.projects.length === 0 && (
          <div className="alert-info">
            <span>尚未发现本地项目目录。请先选择一个本机文件夹或点击重新扫描。</span>
            <button className="btn-primary btn-sm" onClick={handlePickAndAddProject}>
              <FolderPlus size={13} /> 选择本机文件夹
            </button>
          </div>
        )}

        {bridgeOffline && (
          <div className="alert-warn">
            <ShieldAlert size={16} />
            <span>
              目标执行主机当前离线或未绑定 Bridge。任务将先在服务端排队，待 Windows
              Bridge 上线并核对目录授权后自动拉取执行。
            </span>
          </div>
        )}

        <div className="form-stack">
          <div className="form-row">
            <label className="field">
              <span>{isImperial ? "归属衙门 (项目)" : "Project"}</span>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                {store.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{isImperial ? "钦派执行者 (Agent)" : "Agent"}</span>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
              >
                {store.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.mode === "bridge_managed" ? "本机执行" : "MCP-only"})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span>{isImperial ? "旨意标题" : "Task Title"}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：排查支付回调幂等漏洞并补测试"
            />
          </label>

          <label className="field">
            <span>{isImperial ? "详细谕旨内容" : "Natural Language Prompt"}</span>
            <textarea
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="输入自然语言任务描述。本机模式下将直接调用已安装的 Codex / Claude Code CLI 执行。"
            />
          </label>
        </div>

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary"
            disabled={busy || !projectId || !title.trim() || !prompt.trim()}
            onClick={submit}
          >
            {busy
              ? "派发中..."
              : store.localMode
                ? isImperial
                  ? "本机立即启办"
                  : "Run Locally"
                : isImperial
                  ? "降旨派发"
                  : "Dispatch Task"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Projects, Auto-Import Environment Hub & Optional Remote Bridge Panel
// ---------------------------------------------------------------------------

export function ProjectsBridgePanel({ store }: { store: KangXiStore }) {
  const [newProjName, setNewProjName] = useState("");
  const [newProjDesc, setNewProjDesc] = useState("");
  const [bridgeTokenInput, setBridgeTokenInput] = useState(
    store.creds?.bridge_token ?? ""
  );
  const [busyBridge, setBusyBridge] = useState(false);

  const handleAddLocalFolderProject = async () => {
    await store.createProject({
      name: newProjName.trim(),
      description: newProjDesc.trim(),
    });
    setNewProjName("");
    setNewProjDesc("");
  };

  const handleAuthorizeFolder = async (projectId: string) => {
    try {
      const dir = await pickLocalDirectory();
      if (!dir) return;
      const updated = await authorizeLocalProject(projectId, dir);
      store.setBridgeRuntime({
        ...store.bridgeRuntime,
        authorized_projects: updated,
      });
      store.showToast(`已授权本机目录：${dir}`, "ok");
    } catch (e) {
      store.showToast(e instanceof Error ? e.message : String(e), "err");
    }
  };

  const handleRemoveAuth = async (projectId: string) => {
    const updated = await removeAuthorizedProject(projectId);
    store.setBridgeRuntime({
      ...store.bridgeRuntime,
      authorized_projects: updated,
    });
    store.showToast("已撤销该项目的本机目录授权。", "warn");
  };

  const handleStartBridge = async () => {
    if (!store.creds) {
      store.setRemoteModalOpen(true);
      return;
    }
    setBusyBridge(true);
    try {
      let tokenToUse = bridgeTokenInput.trim();
      if (!tokenToUse && store.api) {
        const res = await store.api.createCredential({
          label: `${store.bridgeRuntime.bridge_name} Bridge`,
          scope: "bridge",
          device_platform: "windows",
        });
        tokenToUse = res.token;
        setBridgeTokenInput(tokenToUse);
      }
      const next = await startLocalBridge({
        serverUrl: store.creds.server_url,
        bridgeToken: tokenToUse,
        bridgeName: store.bridgeRuntime.bridge_name,
      });
      store.setBridgeRuntime(next);
      store.showToast("Windows 远程 Bridge 已启动并采用出站连接。", "ok");
    } catch (e) {
      store.showToast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusyBridge(false);
    }
  };

  const handleStopBridge = async () => {
    const next = await stopLocalBridge();
    store.setBridgeRuntime(next);
    store.showToast("远程 Bridge 已停止。", "warn");
  };

  const handleToggleTray = async (checked: boolean) => {
    const val = await setKeepBridgeInTray(checked);
    store.setBridgeRuntime({
      ...store.bridgeRuntime,
      keep_running_in_tray: val,
    });
  };

  const handleProbe = async () => {
    if (store.localMode) {
      await store.rescanLocalImport();
      return;
    }
    const results = await probeLocalProviders();
    store.setProviderProbes(results);
    store.showToast("已完成本机 CLI 能力探测。", "ok");
  };

  return (
    <div className="panel-grid">
      {/* Card 1: Local-First Auto-Import Hub (like T3 Code!) */}
      <section className="surface-card">
        <div className="section-head">
          <div>
            <h3>
              <HardDrive size={17} /> 本机环境自动汇集（免后端 · 自动导入）
            </h3>
            <p className="muted">
              像 T3 Code 一样自动扫描本机 <code>~/.codex/sessions</code> 与{" "}
              <code>~/.claude/projects</code>，汇集项目与历史对话并支持原会话直接续跑。
            </p>
          </div>
          {store.platform.local_mode_supported && (
            <button
              className="btn-primary btn-sm"
              disabled={store.rescanning}
              onClick={store.rescanLocalImport}
            >
              <RefreshCw size={14} />{" "}
              {store.rescanning ? "扫描导入中..." : "重新扫描并自动导入"}
            </button>
          )}
        </div>

        {store.localMode && store.localEnv && (
          <div className="alert-ok">
            <Sparkles size={15} />
            <span>
              <strong>本机直连运行中（无需云端后端）</strong> · 主机{" "}
              <code>{store.localEnv.host_name}</code> · 已导入{" "}
              <strong>{store.projects.length}</strong> 个项目 /{" "}
              <strong>{store.localEnv.imported_session_count}</strong> 条历史会话
              {store.localEnv.scanned_files > 0 &&
                `（扫描 ${store.localEnv.scanned_files} 份 transcript）`}
            </span>
          </div>
        )}

        {store.localEnv && (
          <div className="kv-list">
            <div>
              <span>Codex 配置目录</span>
              <code>{store.localEnv.codex_home || "未发现 ~/.codex"}</code>
            </div>
            <div>
              <span>Claude Code 配置目录</span>
              <code>{store.localEnv.claude_home || "未发现 ~/.claude"}</code>
            </div>
            <div>
              <span>内置本机 MCP 入口</span>
              <code>{store.localEnv.local_mcp_url}</code>
            </div>
          </div>
        )}

        <div className="provider-list">
          <div className="section-head">
            <h4>本机已探测 CLI 环境</h4>
            {store.platform.bridge_supported && !store.localMode && (
              <button className="btn-ghost btn-sm" onClick={handleProbe}>
                <RefreshCw size={13} /> 重新探测
              </button>
            )}
          </div>
          {store.providerProbes.length === 0 ? (
            <p className="muted small">
              {store.platform.bridge_supported
                ? "点击上方“重新扫描并自动导入”探测本机 Codex / Claude Code。"
                : "移动端不在本机执行 CLI；任务会通过云端后端派发至你的 Windows 电脑。"}
            </p>
          ) : (
            store.providerProbes.map((p) => (
              <div key={p.provider} className="provider-row">
                <div>
                  <strong>
                    {p.provider === "codex"
                      ? "OpenAI Codex CLI"
                      : "Claude Code CLI"}
                  </strong>{" "}
                  <span className={`badge ${p.available ? "is-ok" : "is-muted"}`}>
                    {p.available ? p.version || "已就绪" : "未检测到"}
                  </span>{" "}
                  <span
                    className={`badge ${p.supports_resume ? "is-ok" : "is-warn"}`}
                  >
                    {p.supports_resume ? "支持会话续跑" : "仅 MCP 查询"}
                  </span>
                  {p.resolved_path && (
                    <p className="muted small">
                      路径：<code>{p.resolved_path}</code>
                    </p>
                  )}
                  {p.notes && <p className="muted small">{p.notes}</p>}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Card 2: Projects List (Auto-Imported + Manual Folder Picker) */}
      <section className="surface-card">
        <div className="section-head">
          <div>
            <h3>本机与远程项目列表</h3>
            <p className="muted">
              自动导入的项目已自动绑定本机目录，可直接打开历史会话或下达新任务。
            </p>
          </div>
          {store.localMode && store.platform.local_mode_supported && (
            <button
              className="btn-primary btn-sm"
              onClick={handleAddLocalFolderProject}
            >
              <FolderPlus size={14} /> 添加本机文件夹
            </button>
          )}
        </div>

        {!store.localMode && (
          <div className="form-row">
            <input
              value={newProjName}
              onChange={(e) => setNewProjName(e.target.value)}
              placeholder="新项目名称（如 my-service）"
            />
            <input
              value={newProjDesc}
              onChange={(e) => setNewProjDesc(e.target.value)}
              placeholder="简短说明（可选）"
            />
            <button className="btn-primary" onClick={handleAddLocalFolderProject}>
              <Plus size={14} /> 新建项目
            </button>
          </div>
        )}

        <div className="project-list">
          {store.projects.length === 0 ? (
            <div className="empty-hint">
              暂未导入任何项目。点击右上角「添加本机文件夹」，或在终端运行过一次 Codex / Claude Code 后点击「重新扫描并自动导入」。
            </div>
          ) : (
            store.projects.map((proj) => {
              const localDir =
                store.localEnv?.project_paths[proj.id] ||
                store.bridgeRuntime.authorized_projects[proj.id];
              return (
                <div key={proj.id} className="project-row">
                  <div>
                    <strong>{proj.name}</strong>{" "}
                    {proj.source === "auto_import" && (
                      <span className="badge is-ok">自动导入</span>
                    )}{" "}
                    <code className="small muted">{proj.id}</code>
                    <p className="muted small">{proj.description || "未填写说明"}</p>
                    <p className="small">
                      {localDir ? (
                        <span className="text-ok">
                          <ShieldCheck size={13} /> 本机目录：{localDir}
                        </span>
                      ) : (
                        <span className="muted">
                          执行主机：{proj.host_label || "未绑定本地目录"}
                        </span>
                      )}
                    </p>
                  </div>
                  {store.platform.bridge_supported && !store.localMode && (
                    <div className="action-row">
                      <button
                        className="btn-ghost"
                        onClick={() => handleAuthorizeFolder(proj.id)}
                      >
                        <FolderPlus size={14} /> 授权目录
                      </button>
                      {localDir && (
                        <button
                          className="btn-ghost"
                          onClick={() => handleRemoveAuth(proj.id)}
                        >
                          撤销
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Card 3: Optional Cloud Backend & Cross-Machine Bridge */}
      <section className="surface-card">
        <div className="section-head">
          <div>
            <h3>
              <Cloud size={17} /> 跨设备远程控制（控制其他电脑 / 手机端，可选）
            </h3>
            <p className="muted">
              只在需要用 Android 手机远程批奏折、或统一控制多台电脑时，才需要连接自部署 Cloudflare 后端并开启出站 Bridge。
            </p>
          </div>
          {store.localMode ? (
            <button
              className="btn-primary btn-sm"
              onClick={() => store.setRemoteModalOpen(true)}
            >
              <Cloud size={14} /> 连接 Cloudflare 后端
            </button>
          ) : (
            store.platform.local_mode_supported && (
              <button
                className="btn-ghost btn-sm"
                onClick={store.switchToLocalMode}
              >
                <HardDrive size={14} /> 切回本机直连模式
              </button>
            )
          )}
        </div>

        {store.workspaceMode === "remote" && store.platform.bridge_supported && (
          <div className="bridge-controls">
            <div className="bridge-status-row">
              <span
                className={`status-dot ${store.bridgeRuntime.running ? "is-online" : "is-offline"}`}
              />
              <strong>
                {store.bridgeRuntime.running
                  ? "远程 Bridge 运行中（出站在线）"
                  : "远程 Bridge 已停止"}
              </strong>
              <span className="muted">主机名：{store.bridgeRuntime.bridge_name}</span>
            </div>

            {!store.bridgeRuntime.running && (
              <label className="field">
                <span>Bridge 专用 Token（留空则自动签发一条 bridge 作用域凭证）</span>
                <input
                  type="password"
                  value={bridgeTokenInput}
                  onChange={(e) => setBridgeTokenInput(e.target.value)}
                  placeholder="kx_brg_...（可选）"
                />
              </label>
            )}

            <div className="action-row">
              {store.bridgeRuntime.running ? (
                <button className="btn-danger" onClick={handleStopBridge}>
                  <Square size={14} /> 停止远程 Bridge
                </button>
              ) : (
                <button
                  className="btn-primary"
                  disabled={busyBridge}
                  onClick={handleStartBridge}
                >
                  <Play size={14} />{" "}
                  {busyBridge ? "启动中..." : "启动远程出站 Bridge"}
                </button>
              )}

              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={store.bridgeRuntime.keep_running_in_tray}
                  onChange={(e) => handleToggleTray(e.target.checked)}
                />
                <span>关闭主窗口时允许 Bridge 在系统托盘继续运行（默认关闭）</span>
              </label>
            </div>

            {store.bridgeRuntime.last_error && (
              <div className="alert-err">{store.bridgeRuntime.last_error}</div>
            )}
          </div>
        )}

        {store.workspaceMode === "remote" && (
          <div className="remote-bridges">
            <h4>已注册的远程执行主机</h4>
            {store.bridges.length === 0 ? (
              <p className="muted small">尚无在线的远程 Windows Bridge。</p>
            ) : (
              store.bridges.map((b) => (
                <div key={b.id} className="bridge-host-card">
                  <div className="bridge-status-row">
                    <span
                      className={`status-dot ${b.status === "online" ? "is-online" : "is-offline"}`}
                    />
                    <strong>{b.name}</strong>
                    <span className="muted">
                      {b.hostname} · v{b.bridge_version}
                    </span>
                    <span
                      className={`badge ${b.status === "online" ? "is-ok" : "is-warn"}`}
                    >
                      {b.status === "online" ? "在线" : "离线排队中"}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. One-Page MCP Onboarding Wizard (Local Loopback MCP + Optional Remote Pairing)
// ---------------------------------------------------------------------------

export function McpAccessPanel({ store }: { store: KangXiStore }) {
  const [mcpLabel, setMcpLabel] = useState("External Codex/Claude MCP");
  const [scopedProjectId, setScopedProjectId] = useState<string>("all");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [pairingInfo, setPairingInfo] = useState<{
    code: string;
    expires_at: string;
    qr_data_url: string;
    qr_payload: string;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isLocal = store.localMode && Boolean(store.localEnv);
  const mcpUrl = isLocal
    ? store.localEnv!.local_mcp_url
    : `${store.creds?.server_url ?? "https://kangxi-backend.your-subdomain.workers.dev"}/mcp`;
  const displayToken = isLocal
    ? store.localEnv!.local_mcp_token
    : issuedToken ?? "<YOUR_MCP_AGENT_TOKEN>";

  const claudeCmd = `claude mcp add --transport http ${isLocal ? "kangxi-local" : "kangxi"} ${mcpUrl} --header "Authorization: Bearer ${displayToken}"`;
  const codexToml = isLocal
    ? `[mcp_servers.kangxi_local]\nurl = "${mcpUrl}"\nhttp_headers = { Authorization = "Bearer ${displayToken}" }`
    : `[mcp_servers.kangxi]\nurl = "${mcpUrl}"\nbearer_token_env_var = "KANGXI_MCP_TOKEN"`;
  const genericJson = JSON.stringify(
    {
      mcpServers: {
        [isLocal ? "kangxi-local" : "kangxi"]: {
          type: "http",
          url: mcpUrl,
          headers: {
            Authorization: `Bearer ${displayToken}`,
          },
        },
      },
    },
    null,
    2
  );

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      store.showToast("复制失败，请手动选中复制。", "warn");
    }
  };

  const handleIssueMcpToken = async () => {
    if (!store.api) {
      store.showToast("当前为本机直连模式，已自动生成本机专用 MCP 令牌，无需额外签发。", "ok");
      return;
    }
    const res = await store.api.createCredential({
      label: mcpLabel.trim() || "MCP Agent",
      scope: "mcp_agent",
      allowed_project_ids: scopedProjectId === "all" ? null : [scopedProjectId],
    });
    setIssuedToken(res.token);
    await store.refreshSnapshot();
    store.showToast("已签发项目级受限 MCP 凭证（仅展示一次，请妥善保存）。", "ok");
  };

  const handleCreatePairing = async () => {
    if (!store.api) {
      store.setRemoteModalOpen(true);
      return;
    }
    const res = await store.api.createPairing({
      label: "Android 随身御批",
      platform: "android",
    });
    const qrUrl = await QRCode.toDataURL(res.qr_payload, {
      width: 220,
      margin: 2,
    });
    setPairingInfo({
      code: res.pairing_code,
      expires_at: res.expires_at,
      qr_data_url: qrUrl,
      qr_payload: res.qr_payload,
    });
    store.showToast("一次性 Android 配对码已生成（5 分钟有效，不含管理员令牌）。", "ok");
  };

  const handleRevoke = async (id: string) => {
    if (!store.api) return;
    await store.api.revokeCredential(id);
    await store.refreshSnapshot();
    store.showToast("凭证已即时吊销并断开在线连接。", "warn");
  };

  const handleExport = async () => {
    if (!store.api) {
      const localSnapshot = {
        exported_at: new Date().toISOString(),
        mode: store.workspaceMode,
        projects: store.projects,
        tasks: store.tasks,
        task_messages: store.taskMessages,
        memorials: store.memorials,
      };
      const blob = new Blob([JSON.stringify(localSnapshot, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kangxi-local-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      store.showToast("已导出本机数据快照（JSON）。", "ok");
      return;
    }
    const data = await store.api.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kangxi-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    store.showToast("已导出完整数据快照（JSON）。", "ok");
  };

  return (
    <div className="panel-grid">
      <section className="surface-card">
        <h3>
          <Link2 size={17} />{" "}
          {isLocal
            ? "本机内置 MCP 服务（零后端 · 一键自动写入 CLI）"
            : "一页式远程 MCP 接入向导（Streamable HTTP）"}
        </h3>
        <p className="muted">
          {isLocal
            ? "桌面端已自动在 127.0.0.1 启动本机 MCP 服务。点击下方按钮一键注册后，你在终端里跑的 Codex / Claude Code 即可直接向御案递呈奏折，完全不需要云端服务器。"
            : "任何兼容 MCP 的外部 Agent 均可通过 submit_memorial、check_memorial、get_memorial_reply、submit_report 接入同一后端。"}
        </p>

        {isLocal ? (
          <div className="action-row">
            <button
              className="btn-primary"
              onClick={() => store.installLocalMcp("codex")}
            >
              <Wand2 size={14} /> 一键写入本机 Codex MCP 配置
            </button>
            <button
              className="btn-primary"
              onClick={() => store.installLocalMcp("claude_code")}
            >
              <Wand2 size={14} /> 一键注册本机 Claude Code MCP
            </button>
          </div>
        ) : (
          <div className="form-row">
            <input
              value={mcpLabel}
              onChange={(e) => setMcpLabel(e.target.value)}
              placeholder="凭证名称"
            />
            <select
              value={scopedProjectId}
              onChange={(e) => setScopedProjectId(e.target.value)}
            >
              <option value="all">全部项目作用域</option>
              {store.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  仅限项目：{p.name}
                </option>
              ))}
            </select>
            <button className="btn-primary" onClick={handleIssueMcpToken}>
              <KeyRound size={14} /> 签发 MCP 凭证
            </button>
          </div>
        )}

        {issuedToken && !isLocal && (
          <div className="alert-ok">
            <strong>新签发 MCP Token（仅此一次展示）：</strong>
            <code className="token-box">{issuedToken}</code>
            <button
              className="btn-ghost"
              onClick={() => copyText("tok", issuedToken)}
            >
              {copiedId === "tok" ? <Check size={14} /> : <Copy size={14} />} 复制
            </button>
          </div>
        )}

        <div className="snippet-block">
          <div className="snippet-head">
            <span>Claude Code CLI 一键添加</span>
            <button
              className="btn-ghost"
              onClick={() => copyText("claude", claudeCmd)}
            >
              {copiedId === "claude" ? <Check size={13} /> : <Copy size={13} />} 复制
            </button>
          </div>
          <pre>{claudeCmd}</pre>
        </div>

        <div className="snippet-block">
          <div className="snippet-head">
            <span>Codex CLI (`~/.codex/config.toml`)</span>
            <button
              className="btn-ghost"
              onClick={() => copyText("codex", codexToml)}
            >
              {copiedId === "codex" ? <Check size={13} /> : <Copy size={13} />} 复制
            </button>
          </div>
          <pre>{codexToml}</pre>
        </div>

        <div className="snippet-block">
          <div className="snippet-head">
            <span>通用 Streamable HTTP MCP JSON</span>
            <button
              className="btn-ghost"
              onClick={() => copyText("json", genericJson)}
            >
              {copiedId === "json" ? <Check size={13} /> : <Copy size={13} />} 复制
            </button>
          </div>
          <pre>{genericJson}</pre>
        </div>
      </section>

      <section className="surface-card">
        <div className="section-head">
          <div>
            <h3>
              <QrCode size={17} /> 手机配对、跨电脑控制与数据导出
            </h3>
            <p className="muted">
              {isLocal
                ? "当前处于本机直连模式。如需用 Android 手机远程批奏折或控制其他电脑，点击右侧连接自部署 Cloudflare 后端即可生成配对二维码。"
                : "配对二维码仅包含短期一次性兑换码（5 分钟失效），绝不携带长期管理员 Token。"}
            </p>
          </div>
          <div className="action-row">
            {isLocal ? (
              <button
                className="btn-primary"
                onClick={() => store.setRemoteModalOpen(true)}
              >
                <Cloud size={14} /> 连接云端后端以启用跨设备配对
              </button>
            ) : (
              <button className="btn-primary" onClick={handleCreatePairing}>
                <QrCode size={14} /> 生成配对码
              </button>
            )}
            <button className="btn-ghost" onClick={handleExport}>
              <Download size={14} /> 导出全量 JSON
            </button>
          </div>
        </div>

        {pairingInfo && (
          <div className="pairing-box">
            <img src={pairingInfo.qr_data_url} alt="Android Pairing QR Code" />
            <div>
              <div className="pairing-code">{pairingInfo.code}</div>
              <p className="muted small">
                过期时间：{new Date(pairingInfo.expires_at).toLocaleTimeString()}
              </p>
              <button
                className="btn-ghost"
                onClick={() => copyText("qr", pairingInfo.qr_payload)}
              >
                {copiedId === "qr" ? <Check size={13} /> : <Copy size={13} />} 复制配对 JSON
              </button>
            </div>
          </div>
        )}

        {!isLocal && (
          <div className="cred-list">
            {store.credentials.map((c) => (
              <div
                key={c.id}
                className={`cred-row ${c.revoked_at ? "is-revoked" : ""}`}
              >
                <div>
                  <strong>{c.label}</strong>
                  <span className="badge">{c.scope}</span>
                  {c.device_platform && (
                    <span className="badge is-muted">{c.device_platform}</span>
                  )}
                  {c.revoked_at && <span className="badge is-err">已吊销</span>}
                  <p className="muted small">
                    前缀 <code>{c.token_prefix}…</code> · 最近使用：
                    {c.last_used_at
                      ? new Date(c.last_used_at).toLocaleString()
                      : "尚未使用"}
                  </p>
                </div>
                {!c.revoked_at && c.scope !== "owner" && (
                  <button
                    className="btn-danger-ghost"
                    onClick={() => handleRevoke(c.id)}
                  >
                    <Trash2 size={14} /> 吊销
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Settings Panel
// ---------------------------------------------------------------------------

export function SettingsPanel({ store }: { store: KangXiStore }) {
  const handleToggleAutostart = async (enabled: boolean) => {
    const val = await setAutostartEnabled(enabled);
    store.setAutostartEnabledState(val);
    store.showToast(val ? "已启用开机自启动。" : "已关闭开机自启动。", "ok");
  };

  return (
    <div className="panel-grid">
      <section className="surface-card">
        <h3>双视觉主题与独立汇报风格</h3>
        <p className="muted">
          全局 UI 模式与 Agent 汇报风格完全解耦，可任意组合切换；原始内容始终唯一保存，绝不篡改技术事实。
        </p>

        <div className="pref-group">
          <span className="pref-label">全局视觉模式</span>
          <div className="seg-tabs">
            <button
              className={store.prefs.themeMode === "imperial" ? "is-active" : ""}
              onClick={() => store.updatePrefs({ themeMode: "imperial" })}
            >
              仿真皇帝模式 (imperial)
            </button>
            <button
              className={store.prefs.themeMode === "modern" ? "is-active" : ""}
              onClick={() => store.updatePrefs({ themeMode: "modern" })}
            >
              现代极简模式 (modern)
            </button>
          </div>
        </div>

        {store.prefs.themeMode === "modern" && (
          <div className="pref-group">
            <span className="pref-label">极简外观（Apple 浅色 / 深色）</span>
            <div className="seg-tabs">
              <button
                className={
                  store.prefs.modernAppearance === "light" ? "is-active" : ""
                }
                onClick={() => store.updatePrefs({ modernAppearance: "light" })}
              >
                浅色通透 (Light)
              </button>
              <button
                className={
                  store.prefs.modernAppearance === "dark" ? "is-active" : ""
                }
                onClick={() => store.updatePrefs({ modernAppearance: "dark" })}
              >
                深空石墨 (Dark)
              </button>
            </div>
          </div>
        )}

        <div className="pref-group">
          <span className="pref-label">Agent 汇报风格（独立切换）</span>
          <div className="seg-tabs">
            <button
              className={store.prefs.reportStyle === "memorial" ? "is-active" : ""}
              onClick={() => store.updatePrefs({ reportStyle: "memorial" })}
            >
              奏折体 (memorial)
            </button>
            <button
              className={store.prefs.reportStyle === "standard" ? "is-active" : ""}
              onClick={() => store.updatePrefs({ reportStyle: "standard" })}
            >
              标准技术报告 (standard)
            </button>
          </div>
        </div>

        <div className="pref-toggles">
          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={store.prefs.soundEnabled}
              onChange={(e) =>
                store.updatePrefs({ soundEnabled: e.target.checked })
              }
            />
            {store.prefs.soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
            <span>御印落章与交互音效</span>
          </label>

          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={store.prefs.reducedMotion}
              onChange={(e) =>
                store.updatePrefs({ reducedMotion: e.target.checked })
              }
            />
            <span>减弱动效（适合低性能设备与无障碍体验）</span>
          </label>

          {store.platform.bridge_supported && (
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={store.autostartEnabled}
                onChange={(e) => handleToggleAutostart(e.target.checked)}
              />
              <span>Windows 开机自动启动 KangXi.exe（可选）</span>
            </label>
          )}
        </div>
      </section>

      <section className="surface-card">
        <h3>运行模式与跨设备连接</h3>
        <div className="kv-list">
          <div>
            <span>当前模式</span>
            <strong>
              {store.localMode
                ? "本机直连模式（零后端 · 自动导入）"
                : store.sandboxMode
                  ? "本地演示沙盒"
                  : "Cloudflare 远程联机模式"}
            </strong>
          </div>
          <div>
            <span>后端 / MCP 地址</span>
            <code>
              {store.localMode
                ? store.localEnv?.local_mcp_url ?? "127.0.0.1"
                : store.creds?.server_url ?? "未连接"}
            </code>
          </div>
          <div>
            <span>运行平台</span>
            <strong>
              {store.platform.os} · v{store.platform.app_version}
            </strong>
          </div>
        </div>

        <div className="action-row" style={{ marginTop: 14 }}>
          {store.localMode ? (
            <>
              <button
                className="btn-primary"
                onClick={() => store.setRemoteModalOpen(true)}
              >
                <Cloud size={14} /> 连接 Cloudflare 远程后端（控制其他电脑/手机）
              </button>
              <button className="btn-ghost" onClick={store.rescanLocalImport}>
                <RefreshCw size={14} /> 重新扫描本机环境
              </button>
            </>
          ) : (
            <>
              <button className="btn-ghost" onClick={store.refreshSnapshot}>
                <RefreshCw size={14} /> 立即同步
              </button>
              {store.platform.local_mode_supported && (
                <button className="btn-primary" onClick={store.switchToLocalMode}>
                  <HardDrive size={14} /> 切回本机直连模式
                </button>
              )}
              <button className="btn-danger" onClick={store.disconnect}>
                断开云端连接
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. Shared Task Timeline View (shows auto-imported Codex / Claude sessions!)
// ---------------------------------------------------------------------------

export function TasksWorkspace({
  store,
  onOpenNewTask,
}: {
  store: KangXiStore;
  onOpenNewTask: () => void;
}) {
  const [followup, setFollowup] = useState("");
  const [showRawIds, setShowRawIds] = useState<Record<string, boolean>>({});
  const selectedTask: Task | undefined =
    store.tasks.find((t) => t.id === store.selectedTaskId) ?? store.tasks[0];
  const messages = selectedTask ? store.taskMessages[selectedTask.id] ?? [] : [];
  const isMemorial = store.prefs.reportStyle === "memorial";

  const handleFollowup = async () => {
    if (!selectedTask || !followup.trim()) return;
    const text = followup.trim();
    setFollowup("");
    await store.sendTaskFollowup(selectedTask.id, text);
  };

  return (
    <div className="tasks-split">
      <div className="tasks-list-col">
        <div className="col-head">
          <h3>
            {isMemorial ? "差事与本机会话" : "Tasks & Imported Sessions"}
          </h3>
          <div className="action-row">
            {store.localMode && (
              <button
                className="btn-ghost btn-sm"
                title="重新扫描本机 ~/.codex 与 ~/.claude 会话"
                disabled={store.rescanning}
                onClick={store.rescanLocalImport}
              >
                <RefreshCw size={13} /> 导入
              </button>
            )}
            <button className="btn-primary btn-sm" onClick={onOpenNewTask}>
              <Plus size={14} /> {isMemorial ? "拟旨" : "New"}
            </button>
          </div>
        </div>
        {store.tasks.length === 0 ? (
          <div className="empty-hint">
            {store.localMode
              ? "未扫描到 Codex / Claude Code 历史会话。点击「拟旨 / New」可直接在任意本机项目启动新会话。"
              : "暂无任务，点击上方按钮下达首条任务。"}
          </div>
        ) : (
          store.tasks.map((task) => {
            const agent = store.agents.find((a) => a.id === task.agent_id);
            const proj = store.projects.find((p) => p.id === task.project_id);
            return (
              <button
                key={task.id}
                className={`task-item ${selectedTask?.id === task.id ? "is-selected" : ""}`}
                onClick={() => store.setSelectedTaskId(task.id)}
              >
                <div className="task-item-top">
                  <strong>{task.title}</strong>
                  <span className={`badge status-${task.status}`}>
                    {task.status}
                  </span>
                </div>
                <div className="task-item-meta">
                  <span>{agent?.name ?? task.agent_id}</span>
                  <span>·</span>
                  <span>{proj?.name ?? task.project_id}</span>
                  {task.source.includes("自动导入") && (
                    <>
                      <span>·</span>
                      <span className="text-ok">已导入</span>
                    </>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      <div className="tasks-detail-col">
        {selectedTask ? (
          <>
            <div className="task-detail-head">
              <div>
                <h3>{selectedTask.title}</h3>
                <p className="muted small">
                  来源 <strong>{selectedTask.source}</strong> · 会话{" "}
                  <code>{selectedTask.session_id ?? selectedTask.id}</code> · 状态{" "}
                  <strong>{selectedTask.status}</strong>
                </p>
              </div>
              {selectedTask.status === "running" && (
                <button
                  className="btn-danger-ghost"
                  onClick={() => store.cancelTask(selectedTask.id)}
                >
                  {isMemorial ? "撤旨停办" : "Stop"}
                </button>
              )}
            </div>

            <div className="timeline-scroll">
              {messages.map((msg) => {
                const forceRaw = Boolean(showRawIds[msg.id]);
                const effectiveStyle = forceRaw
                  ? "standard"
                  : store.prefs.reportStyle;
                return (
                  <div
                    key={msg.id}
                    className={`timeline-msg kind-${msg.kind} sender-${msg.sender_type}`}
                  >
                    <div className="timeline-msg-head">
                      <span className="badge">
                        {effectiveStyle === "memorial"
                          ? msg.kind === "user_prompt"
                            ? "圣旨"
                            : msg.kind === "user_followup"
                              ? "续旨"
                              : msg.kind === "agent_report"
                                ? "钦差回奏"
                                : msg.kind === "task_result"
                                  ? "复命结果"
                                  : msg.kind
                          : msg.kind}
                      </span>
                      <span className="muted small">
                        {new Date(msg.created_at).toLocaleTimeString()}
                      </span>
                      {store.prefs.reportStyle === "memorial" && (
                        <button
                          className="link-btn"
                          onClick={() =>
                            setShowRawIds((prev) => ({
                              ...prev,
                              [msg.id]: !prev[msg.id],
                            }))
                          }
                        >
                          {forceRaw ? "恢复奏折体" : "查看原文"}
                        </button>
                      )}
                    </div>
                    <pre className="msg-body">{msg.content}</pre>
                  </div>
                );
              })}
            </div>

            <div className="followup-bar">
              <input
                value={followup}
                onChange={(e) => setFollowup(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleFollowup();
                  }
                }}
                placeholder={
                  store.localMode
                    ? isMemorial
                      ? "续降谕旨（直接在本机恢复此 Codex / Claude 原会话）..."
                      : "Send follow-up (resumes this local Codex / Claude session directly)..."
                    : isMemorial
                      ? "续降谕旨（继续当前受管会话）..."
                      : "Send follow-up message to managed session..."
                }
              />
              <button className="btn-primary" onClick={handleFollowup}>
                {isMemorial ? "续旨" : "Send"}
              </button>
            </div>
          </>
        ) : (
          <div className="empty-hint">
            选择左侧任一导入或新建会话查看完整对话并直接继续执行。
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. Quick Command Palette (Ctrl+K)
// ---------------------------------------------------------------------------

export function CommandPalette({
  store,
  onClose,
  onNewTask,
}: {
  store: KangXiStore;
  onClose: () => void;
  onNewTask: () => void;
}) {
  const [query, setQuery] = useState("");
  const actions: Array<{ id: string; label: string; run: () => void }> = [
    ...(store.platform.local_mode_supported
      ? [
          {
            id: "rescan_local",
            label: "重新扫描并自动导入本机 Codex / Claude Code 会话",
            run: () => void store.rescanLocalImport(),
          },
          {
            id: "connect_cloud",
            label: "连接 Cloudflare 云端后端（控制其他电脑 / 手机端）",
            run: () => store.setRemoteModalOpen(true),
          },
        ]
      : []),
    {
      id: "theme_imp",
      label: "切换视觉模式：仿真皇帝御案 (Imperial)",
      run: () => store.updatePrefs({ themeMode: "imperial" }),
    },
    {
      id: "theme_mod",
      label: "切换视觉模式：现代极简 Apple 风格 (Modern)",
      run: () => store.updatePrefs({ themeMode: "modern" }),
    },
    {
      id: "appearance_toggle",
      label: `切换极简外观：${store.prefs.modernAppearance === "light" ? "深空石墨 (Dark)" : "通透浅色 (Light)"}`,
      run: () =>
        store.updatePrefs({
          themeMode: "modern",
          modernAppearance:
            store.prefs.modernAppearance === "light" ? "dark" : "light",
        }),
    },
    {
      id: "style_mem",
      label: "切换汇报风格：奏折体 (Memorial)",
      run: () => store.updatePrefs({ reportStyle: "memorial" }),
    },
    {
      id: "style_std",
      label: "切换汇报风格：标准技术报告 (Standard)",
      run: () => store.updatePrefs({ reportStyle: "standard" }),
    },
    { id: "new_task", label: "下达新任务 / 拟旨派差", run: onNewTask },
    { id: "nav_inbox", label: "前往：奏折中心 / Inbox", run: () => store.setNav("inbox") },
    { id: "nav_tasks", label: "前往：任务与导入会话 / Tasks", run: () => store.setNav("tasks") },
    { id: "nav_bridge", label: "前往：本机环境与远程 Bridge", run: () => store.setNav("bridge") },
    { id: "nav_mcp", label: "前往：MCP 接入与配对", run: () => store.setNav("mcp") },
    { id: "nav_settings", label: "前往：设置与偏好", run: () => store.setNav("settings") },
  ];

  const filtered = actions.filter((a) =>
    a.label.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="palette-card" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入指令搜索（自动导入、连接云端、切换主题、新建任务）..."
        />
        <div className="palette-list">
          {filtered.map((item) => (
            <button
              key={item.id}
              className="palette-item"
              onClick={() => {
                item.run();
                onClose();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export type QuickDecisionHandler = (action: DecisionAction) => void;
