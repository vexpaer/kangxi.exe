import { formatMemorialStatus, presentMemorial } from "@kangxi/app-core";
import type { DecisionAction, Memorial } from "@kangxi/protocol";
import {
  ArrowLeft,
  BookOpen,
  Eye,
  FileText,
  KeyRound,
  Plus,
  ScrollText,
  Search,
  Server,
  Settings,
  Sparkles,
  Stamp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DeliveryPipeline } from "../../components/DeliveryPipeline";
import {
  McpAccessPanel,
  ProjectsBridgePanel,
  SettingsPanel,
  TasksWorkspace,
} from "../../components/ModalsAndPanels";
import type { KangXiStore } from "../../state/useKangXiStore";

interface Props {
  store: KangXiStore;
  onOpenNewTask: () => void;
  onOpenPalette: () => void;
}

const VERMILION_PRESETS: Record<DecisionAction, string> = {
  approve: "准奏。依议妥善施行，办毕即刻回奏。",
  reject: "所请不准。兹事风险未明，着即退回另议。",
  needs_info: "着补陈详情与回滚预案，再行具奏。",
  reply: "已阅。按补充谕旨继续推进。",
};

export function ImperialWorkbench({
  store,
  onOpenNewTask,
  onOpenPalette,
}: Props) {
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [search, setSearch] = useState("");
  const [rawOverride, setRawOverride] = useState(false);
  const [mobileScrollOpen, setMobileScrollOpen] = useState(false);

  // Rescript composer state
  const [action, setAction] = useState<DecisionAction>("approve");
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [instructions, setInstructions] = useState("");
  const [stamping, setStamping] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const filteredMemorials = useMemo(() => {
    const q = search.trim().toLowerCase();
    return store.memorials.filter((m) => {
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (q) {
        return (
          m.title.toLowerCase().includes(q) ||
          m.content.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [store.memorials, statusFilter, search]);

  const activeMemorial: Memorial | undefined =
    store.memorials.find((m) => m.id === store.selectedMemorialId) ??
    filteredMemorials[0];

  const activeDraft = activeMemorial
    ? store.getDraft(activeMemorial.id)
    : undefined;

  // Sync draft into composer when switching memorials
  useEffect(() => {
    if (!activeMemorial) return;
    setRawOverride(false);
    const d = store.getDraft(activeMemorial.id);
    if (d) {
      setAction(d.action);
      setSelectedOption(d.selected_option_id);
      setComment(d.comment);
      setInstructions(d.instructions);
    } else {
      setAction("approve");
      const rec = activeMemorial.options.find((o) => o.recommended);
      setSelectedOption(rec?.id ?? activeMemorial.options[0]?.id ?? null);
      setComment("");
      setInstructions("");
    }
  }, [activeMemorial?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpenMemorial = (id: string) => {
    store.setSelectedMemorialId(id);
    setMobileScrollOpen(true);
  };

  const handleStampSubmit = async () => {
    if (!activeMemorial || submitting) return;
    const text = comment.trim() || VERMILION_PRESETS[action];
    setSubmitting(true);
    setStamping(true);
    try {
      await store.submitDecision({
        memorial: activeMemorial,
        action,
        selected_option_id: selectedOption,
        comment: text,
        instructions: instructions.trim() || undefined,
      });
    } finally {
      setSubmitting(false);
      setTimeout(() => setStamping(false), 680);
    }
  };

  const effectiveStyle = rawOverride ? "standard" : store.prefs.reportStyle;
  const activeAgent = activeMemorial
    ? store.agents.find((a) => a.id === activeMemorial.agent_id)
    : undefined;
  const activeProject = activeMemorial
    ? store.projects.find((p) => p.id === activeMemorial.project_id)
    : undefined;
  const presented = activeMemorial
    ? presentMemorial(activeMemorial, effectiveStyle, activeAgent, activeProject)
    : null;

  return (
    <div className="imperial-shell">
      {/* Imperial Top Canopy Bar */}
      <header className="imperial-topbar">
        <div className="imperial-brand">
          <div className="jade-emblem" aria-hidden="true">
            御
          </div>
          <div>
            <div className="imperial-title">
              KangXi.exe <span className="imperial-subtitle">乾清宫 · 御案</span>
            </div>
            <div className="imperial-meta">
              <span
                className={`status-dot ${
                  store.connectionState === "online"
                    ? "is-online"
                    : store.connectionState === "sandbox"
                      ? "is-sandbox"
                      : "is-offline"
                }`}
              />
              <span>
                {store.connectionState === "online"
                  ? "中枢实时联机"
                  : store.connectionState === "sandbox"
                    ? "本地演示沙盒"
                    : "重连补齐游标中"}
              </span>
              <span>·</span>
              <span>候批奏折 {store.pendingCount} 件</span>
            </div>
          </div>
        </div>

        <nav className="imperial-nav" aria-label="Primary">
          <button
            className={store.nav === "inbox" ? "is-active" : ""}
            onClick={() => store.setNav("inbox")}
          >
            <ScrollText size={15} /> 御案批折
            {store.pendingCount > 0 && (
              <span className="count-pill">{store.pendingCount}</span>
            )}
          </button>
          <button
            className={store.nav === "tasks" ? "is-active" : ""}
            onClick={() => store.setNav("tasks")}
          >
            <BookOpen size={15} /> 军机差事
          </button>
          <button
            className={store.nav === "bridge" ? "is-active" : ""}
            onClick={() => store.setNav("bridge")}
          >
            <Server size={15} /> 本机驿站
          </button>
          <button
            className={store.nav === "mcp" ? "is-active" : ""}
            onClick={() => store.setNav("mcp")}
          >
            <KeyRound size={15} /> 钦差敕令
          </button>
          <button
            className={store.nav === "settings" ? "is-active" : ""}
            onClick={() => store.setNav("settings")}
          >
            <Settings size={15} /> 宫务设置
          </button>
        </nav>

        <div className="imperial-actions">
          <button
            className="pill-btn"
            title="独立切换 Agent 汇报文风"
            onClick={() =>
              store.updatePrefs({
                reportStyle:
                  store.prefs.reportStyle === "memorial"
                    ? "standard"
                    : "memorial",
              })
            }
          >
            文风：{store.prefs.reportStyle === "memorial" ? "奏折体" : "标准体"}
          </button>
          <button
            className="pill-btn"
            title="切换至现代极简模式"
            onClick={() => store.updatePrefs({ themeMode: "modern" })}
          >
            <Sparkles size={13} /> 现代模式
          </button>
          <button className="btn-imperial-cta" onClick={onOpenNewTask}>
            <Plus size={15} /> 拟旨派差
          </button>
          <button
            className="icon-btn hide-mobile"
            onClick={onOpenPalette}
            title="快捷命令 (Ctrl+K)"
          >
            ⌘K
          </button>
        </div>
      </header>

      {/* Main Imperial Desk Surface */}
      <main className="imperial-desk">
        {store.nav === "inbox" && (
          <div
            className={`imperial-desk-grid ${mobileScrollOpen ? "mobile-scroll-open" : ""}`}
          >
            {/* Left Stack of Physical Memorial Folders */}
            <aside className="memorial-stack-col">
              <div className="stack-header">
                <div className="search-box">
                  <Search size={14} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="检索奏折标题、正文、编号..."
                  />
                </div>
                <div className="filter-pills">
                  {(
                    [
                      ["pending", "候批"],
                      ["approved", "准奏"],
                      ["rejected", "驳回"],
                      ["needs_info", "再议"],
                      ["all", "全部"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      className={statusFilter === key ? "is-active" : ""}
                      onClick={() => setStatusFilter(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="zhezi-stack">
                {filteredMemorials.length === 0 ? (
                  <div className="empty-desk-hint">
                    御案清朗，此列暂无奏折。
                  </div>
                ) : (
                  filteredMemorials.map((m, idx) => {
                    const ag = store.agents.find((a) => a.id === m.agent_id);
                    const prj = store.projects.find((p) => p.id === m.project_id);
                    const isSelected = activeMemorial?.id === m.id;
                    const hasDraft = Boolean(store.getDraft(m.id));
                    return (
                      <button
                        key={m.id}
                        className={`zhezi-folder status-${m.status} risk-${m.risk_level} ${isSelected ? "is-open" : ""}`}
                        style={{ ["--stack-idx" as string]: idx }}
                        onClick={() => handleOpenMemorial(m.id)}
                      >
                        <div className="zhezi-ribbon" aria-hidden="true" />
                        <div className="zhezi-cover-top">
                          <span className="zhezi-tag">
                            {formatMemorialStatus(m.status, store.prefs.reportStyle)}
                          </span>
                          <span className={`risk-dot risk-${m.risk_level}`}>
                            {m.risk_level.toUpperCase()}
                          </span>
                        </div>
                        <div className="zhezi-title">{m.title}</div>
                        <div className="zhezi-footer">
                          <span>{ag?.name ?? m.agent_id}</span>
                          <span>·</span>
                          <span>{prj?.name ?? m.project_id}</span>
                          {hasDraft && <span className="draft-chip">草稿</span>}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            {/* Center Unfolding Xuan-Paper Memorial Scroll & Vermilion Brush Desk */}
            <section className="scroll-stage">
              {activeMemorial && presented ? (
                <article className="xuan-scroll">
                  <div className="scroll-mobile-bar">
                    <button
                      className="btn-ghost"
                      onClick={() => setMobileScrollOpen(false)}
                    >
                      <ArrowLeft size={15} /> 返回奏折堆
                    </button>
                    <span className="muted small">{activeMemorial.id}</span>
                  </div>

                  {/* Scroll Header Frame */}
                  <div className="xuan-header">
                    <div className="xuan-heading-row">
                      <span className="xuan-kicker">{presented.headerPrefix}</span>
                      <div className="xuan-head-controls">
                        <span className={`badge risk-${activeMemorial.risk_level}`}>
                          {presented.riskLabel}
                        </span>
                        <button
                          className="btn-paper-toggle"
                          onClick={() => setRawOverride((v) => !v)}
                        >
                          {rawOverride ? <Eye size={13} /> : <FileText size={13} />}
                          {rawOverride ? "恢复文风包装" : "一键查看原文"}
                        </button>
                      </div>
                    </div>
                    <h2 className="xuan-title">{activeMemorial.title}</h2>
                    <div className="xuan-byline">
                      <span>{presented.salutation}</span>
                      <span className="muted small">
                        版本 v{activeMemorial.version} ·{" "}
                        {new Date(activeMemorial.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Separated 3-stage Delivery & Resume Pipeline */}
                  <DeliveryPipeline
                    memorial={activeMemorial}
                    reportStyle={effectiveStyle}
                  />

                  {/* Risk Notes & Context */}
                  {(activeMemorial.risk_notes || activeMemorial.context_summary) && (
                    <div className="xuan-callout">
                      {activeMemorial.risk_notes && (
                        <div>
                          <strong>
                            {effectiveStyle === "memorial" ? "干系风险：" : "Risk Note: "}
                          </strong>
                          {activeMemorial.risk_notes}
                        </div>
                      )}
                      {activeMemorial.context_summary && (
                        <div className="muted small">
                          {activeMemorial.context_summary}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Raw Unmodified Factual Content inside Xuan Paper Column Box */}
                  <div className="xuan-body-box">
                    <pre className="xuan-raw-content">{presented.rawContent}</pre>
                    {presented.closingFormula && (
                      <div className="xuan-closing">{presented.closingFormula}</div>
                    )}
                  </div>

                  {/* Selectable Options */}
                  {activeMemorial.options.length > 0 && (
                    <div className="xuan-options">
                      <div className="xuan-section-label">
                        {effectiveStyle === "memorial"
                          ? "拟呈方案（择一或另降御旨）"
                          : "Proposed Options"}
                      </div>
                      <div className="options-grid">
                        {activeMemorial.options.map((opt) => (
                          <button
                            key={opt.id}
                            disabled={activeMemorial.status !== "pending"}
                            className={`option-card ${
                              (activeMemorial.decision?.selected_option_id ??
                                selectedOption) === opt.id
                                ? "is-picked"
                                : ""
                            }`}
                            onClick={() => setSelectedOption(opt.id)}
                          >
                            <div className="option-head">
                              <strong>{opt.label}</strong>
                              {opt.recommended && (
                                <span className="badge is-ok">推荐</span>
                              )}
                            </div>
                            {opt.description && (
                              <p className="muted small">{opt.description}</p>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 409 Conflict Banner preserving local draft */}
                  {activeDraft?.conflict && (
                    <div className="conflict-box">
                      <strong>⚠ 检测到多端并发批复冲突</strong>
                      <p className="small">
                        另一台设备已先行批复此折（当前服务端状态：
                        <strong>{activeDraft.conflict.server_memorial.status}</strong>
                        ）。您先前的本地草稿仍完好保留如下：
                      </p>
                      <blockquote className="small">
                        {activeDraft.comment}
                      </blockquote>
                      <button
                        className="btn-ghost"
                        onClick={() => store.clearDraft(activeMemorial.id)}
                      >
                        知晓并清除冲突草稿
                      </button>
                    </div>
                  )}

                  {/* Existing Vermilion Rescript Stamp Display OR Interactive Brush Desk */}
                  {activeMemorial.decision ? (
                    <div className="vermilion-stamped-panel">
                      <div
                        className={`imperial-seal-stamp action-${activeMemorial.decision.action}`}
                      >
                        <div className="seal-inner">
                          {activeMemorial.decision.action === "approve"
                            ? "御览准奏"
                            : activeMemorial.decision.action === "reject"
                              ? "御批驳回"
                              : activeMemorial.decision.action === "needs_info"
                                ? "着令再议"
                                : "御批已阅"}
                        </div>
                      </div>
                      <div className="vermilion-rescript-text">
                        <div className="vermilion-kicker">
                          朱批御览 · {activeMemorial.decision.decided_by_label} ·{" "}
                          {new Date(
                            activeMemorial.decision.created_at
                          ).toLocaleString()}
                        </div>
                        <p className="vermilion-handwriting">
                          {activeMemorial.decision.comment}
                        </p>
                        {activeMemorial.decision.instructions && (
                          <div className="vermilion-instructions">
                            <strong>附降细则：</strong>
                            {activeMemorial.decision.instructions}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="vermilion-desk">
                      <div className="vermilion-desk-head">
                        <span className="vermilion-title">
                          御笔朱批 · 落印台
                        </span>
                        <div className="action-pills">
                          {(
                            ["approve", "reject", "needs_info", "reply"] as DecisionAction[]
                          ).map((act) => (
                            <button
                              key={act}
                              className={`vermilion-choice choice-${act} ${action === act ? "is-active" : ""}`}
                              onClick={() => {
                                setAction(act);
                                if (!comment.trim()) {
                                  setComment(VERMILION_PRESETS[act]);
                                }
                              }}
                            >
                              {presented.actionLabels[act]}
                            </button>
                          ))}
                        </div>
                      </div>

                      <textarea
                        className="vermilion-input"
                        rows={3}
                        value={comment}
                        onChange={(e) => {
                          setComment(e.target.value);
                          store.saveDraft({
                            memorial_id: activeMemorial.id,
                            action,
                            selected_option_id: selectedOption,
                            comment: e.target.value,
                            instructions,
                            expected_version: activeMemorial.version,
                            idempotency_key:
                              activeDraft?.idempotency_key ?? crypto.randomUUID(),
                          });
                        }}
                        placeholder={VERMILION_PRESETS[action]}
                      />

                      <input
                        className="vermilion-subinput"
                        value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                        placeholder="可选：附加给 Agent 的修改指令或下一步约束条件..."
                      />

                      <div className="vermilion-footer">
                        <span className="muted small">
                          乐观锁版本 v{activeMemorial.version} · 离线草稿自动本地保护
                        </span>
                        <button
                          className={`btn-jade-seal ${stamping ? "is-stamping" : ""}`}
                          disabled={submitting}
                          onClick={handleStampSubmit}
                        >
                          <Stamp size={16} />
                          {submitting
                            ? "落印存案中..."
                            : `落印降旨 · ${presented.actionLabels[action]}`}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              ) : (
                <div className="empty-scroll-placeholder">
                  <div className="jade-emblem lg">御</div>
                  <h3>御案静候奏折</h3>
                  <p className="muted">
                    从左侧奏折堆点选一件即可展开朱批，或点击右上角“拟旨派差”向受管 Agent 下达新任务。
                  </p>
                </div>
              )}
            </section>
          </div>
        )}

        {store.nav === "tasks" && (
          <TasksWorkspace store={store} onOpenNewTask={onOpenNewTask} />
        )}
        {store.nav === "bridge" && <ProjectsBridgePanel store={store} />}
        {store.nav === "mcp" && <McpAccessPanel store={store} />}
        {store.nav === "settings" && <SettingsPanel store={store} />}
      </main>

      {/* Mobile Imperial Lacquer Bottom Dock */}
      <nav className="mobile-bottom-dock" aria-label="Mobile Navigation">
        <button
          className={store.nav === "inbox" ? "is-active" : ""}
          onClick={() => store.setNav("inbox")}
        >
          <ScrollText size={18} />
          <span>奏折</span>
          {store.pendingCount > 0 && <em>{store.pendingCount}</em>}
        </button>
        <button
          className={store.nav === "tasks" ? "is-active" : ""}
          onClick={() => store.setNav("tasks")}
        >
          <BookOpen size={18} />
          <span>差事</span>
        </button>
        <button
          className={store.nav === "bridge" ? "is-active" : ""}
          onClick={() => store.setNav("bridge")}
        >
          <Server size={18} />
          <span>驿站</span>
        </button>
        <button
          className={store.nav === "mcp" ? "is-active" : ""}
          onClick={() => store.setNav("mcp")}
        >
          <KeyRound size={18} />
          <span>敕令</span>
        </button>
        <button
          className={store.nav === "settings" ? "is-active" : ""}
          onClick={() => store.setNav("settings")}
        >
          <Settings size={18} />
          <span>设置</span>
        </button>
      </nav>
    </div>
  );
}
