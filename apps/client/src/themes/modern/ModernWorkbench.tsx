import {
  formatDeliveryStatus,
  formatMemorialStatus,
  formatResumeStatus,
  presentMemorial,
} from "@kangxi/app-core";
import type { DecisionAction, Memorial } from "@kangxi/protocol";
import {
  ArrowLeft,
  Check,
  Command,
  Crown,
  Eye,
  FileCode2,
  Inbox,
  KeyRound,
  Layers,
  Plus,
  Search,
  Send,
  Server,
  Settings,
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

export function ModernWorkbench({
  store,
  onOpenNewTask,
  onOpenPalette,
}: Props) {
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [search, setSearch] = useState("");
  const [rawOverride, setRawOverride] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const [action, setAction] = useState<DecisionAction>("approve");
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [instructions, setInstructions] = useState("");
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

  // Keyboard navigation J/K in inbox
  useEffect(() => {
    if (store.nav !== "inbox") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (filteredMemorials.length === 0) return;
      const idx = filteredMemorials.findIndex((m) => m.id === activeMemorial?.id);
      if (e.key === "j" && idx < filteredMemorials.length - 1) {
        store.setSelectedMemorialId(filteredMemorials[idx + 1]!.id);
      } else if (e.key === "k" && idx > 0) {
        store.setSelectedMemorialId(filteredMemorials[idx - 1]!.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, filteredMemorials, activeMemorial?.id]);

  const handleSubmit = async () => {
    if (!activeMemorial || submitting) return;
    const finalComment =
      comment.trim() ||
      (action === "approve"
        ? "Approved."
        : action === "reject"
          ? "Rejected."
          : "Needs additional details.");
    setSubmitting(true);
    try {
      await store.submitDecision({
        memorial: activeMemorial,
        action,
        selected_option_id: selectedOption,
        comment: finalComment,
        instructions: instructions.trim() || undefined,
      });
    } finally {
      setSubmitting(false);
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
    <div className="modern-shell">
      {/* Left Studio Rail */}
      <aside className="modern-rail">
        <div className="modern-brand">
          <div className="modern-logo">KX</div>
          <div>
            <div className="modern-brand-name">KangXi.exe</div>
            <div className="modern-brand-sub">Agent Console</div>
          </div>
        </div>

        <button className="modern-new-btn" onClick={onOpenNewTask}>
          <Plus size={15} /> New Task
        </button>

        <nav className="modern-nav" aria-label="Workspace Navigation">
          <button
            className={store.nav === "inbox" ? "is-active" : ""}
            onClick={() => store.setNav("inbox")}
          >
            <Inbox size={16} />
            <span>Inbox</span>
            {store.pendingCount > 0 && (
              <span className="rail-badge">{store.pendingCount}</span>
            )}
          </button>
          <button
            className={store.nav === "tasks" ? "is-active" : ""}
            onClick={() => store.setNav("tasks")}
          >
            <Layers size={16} />
            <span>Tasks & Sessions</span>
          </button>
          <button
            className={store.nav === "bridge" ? "is-active" : ""}
            onClick={() => store.setNav("bridge")}
          >
            <Server size={16} />
            <span>Projects & Bridge</span>
          </button>
          <button
            className={store.nav === "mcp" ? "is-active" : ""}
            onClick={() => store.setNav("mcp")}
          >
            <KeyRound size={16} />
            <span>MCP & Pairing</span>
          </button>
          <button
            className={store.nav === "settings" ? "is-active" : ""}
            onClick={() => store.setNav("settings")}
          >
            <Settings size={16} />
            <span>Settings</span>
          </button>
        </nav>

        <div className="modern-rail-footer">
          <div className="sync-pill">
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
                ? `Live · #${store.latestSequence}`
                : store.connectionState === "sandbox"
                  ? "Sandbox Preview"
                  : "Reconnecting"}
            </span>
          </div>
          <button
            className="rail-switch-btn"
            onClick={() => store.updatePrefs({ themeMode: "imperial" })}
          >
            <Crown size={14} /> 切换仿真皇帝模式
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="modern-main">
        <header className="modern-topbar">
          <div className="modern-search">
            <Search size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search memorials, IDs, projects..."
            />
          </div>

          <div className="modern-topbar-right">
            <button
              className="pill-btn"
              onClick={() =>
                store.updatePrefs({
                  reportStyle:
                    store.prefs.reportStyle === "standard"
                      ? "memorial"
                      : "standard",
                })
              }
            >
              Report: {store.prefs.reportStyle === "memorial" ? "奏折体" : "Standard"}
            </button>
            <button className="pill-btn hide-mobile" onClick={onOpenPalette}>
              <Command size={13} /> K
            </button>
            <button
              className="pill-btn show-mobile-only"
              onClick={() => store.updatePrefs({ themeMode: "imperial" })}
            >
              <Crown size={13} /> 皇帝模式
            </button>
          </div>
        </header>

        <div className="modern-content">
          {store.nav === "inbox" && (
            <div
              className={`modern-three-pane ${mobileDetailOpen ? "mobile-detail-open" : ""}`}
            >
              {/* Pane 1: Dense Queue */}
              <div className="modern-queue-col">
                <div className="queue-tabs">
                  {(
                    [
                      ["pending", "Pending"],
                      ["approved", "Approved"],
                      ["rejected", "Rejected"],
                      ["needs_info", "Needs Info"],
                      ["all", "All"],
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

                <div className="queue-list">
                  {filteredMemorials.length === 0 ? (
                    <div className="empty-hint">No items match this filter.</div>
                  ) : (
                    filteredMemorials.map((m) => {
                      const ag = store.agents.find((a) => a.id === m.agent_id);
                      const prj = store.projects.find((p) => p.id === m.project_id);
                      const isSel = activeMemorial?.id === m.id;
                      return (
                        <button
                          key={m.id}
                          className={`queue-row ${isSel ? "is-selected" : ""}`}
                          onClick={() => {
                            store.setSelectedMemorialId(m.id);
                            setMobileDetailOpen(true);
                          }}
                        >
                          <div className="queue-row-top">
                            <span className={`risk-bar risk-${m.risk_level}`} />
                            <strong className="truncate">{m.title}</strong>
                          </div>
                          <div className="queue-row-meta">
                            <span>{ag?.name ?? m.agent_id}</span>
                            <span>·</span>
                            <span>{prj?.name ?? m.project_id}</span>
                            <span className={`mini-status status-${m.status}`}>
                              {formatMemorialStatus(m.status, store.prefs.reportStyle)}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Pane 2: Detail Reader + Decision Composer */}
              <div className="modern-detail-col">
                {activeMemorial && presented ? (
                  <>
                    <div className="detail-mobile-back">
                      <button
                        className="btn-ghost"
                        onClick={() => setMobileDetailOpen(false)}
                      >
                        <ArrowLeft size={14} /> Back to Queue
                      </button>
                    </div>

                    <div className="modern-detail-head">
                      <div>
                        <div className="eyebrow-row">
                          <span className="badge">{presented.requestTypeLabel}</span>
                          <span className={`badge risk-${activeMemorial.risk_level}`}>
                            {presented.riskLabel}
                          </span>
                          <code className="muted small">{activeMemorial.id}</code>
                        </div>
                        <h2>{activeMemorial.title}</h2>
                        <p className="muted small">{presented.salutation}</p>
                      </div>
                      <button
                        className="btn-ghost"
                        onClick={() => setRawOverride((v) => !v)}
                      >
                        {rawOverride ? <Eye size={14} /> : <FileCode2 size={14} />}
                        {rawOverride ? "Wrapped" : "Raw"}
                      </button>
                    </div>

                    <DeliveryPipeline
                      memorial={activeMemorial}
                      reportStyle={effectiveStyle}
                      compact
                    />

                    {activeMemorial.risk_notes && (
                      <div className="alert-warn">
                        <strong>Risk:</strong> {activeMemorial.risk_notes}
                      </div>
                    )}

                    <div className="modern-body-card">
                      <pre className="raw-content">{presented.rawContent}</pre>
                    </div>

                    {activeMemorial.options.length > 0 && (
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
                                <span className="badge is-ok">Recommended</span>
                              )}
                            </div>
                            {opt.description && (
                              <p className="muted small">{opt.description}</p>
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {activeDraft?.conflict && (
                      <div className="conflict-box">
                        <strong>409 Version Conflict Detected</strong>
                        <p className="small">
                          Server state is now{" "}
                          <code>{activeDraft.conflict.server_memorial.status}</code>.
                          Your local draft was preserved:
                        </p>
                        <blockquote className="small">{activeDraft.comment}</blockquote>
                        <button
                          className="btn-ghost"
                          onClick={() => store.clearDraft(activeMemorial.id)}
                        >
                          Dismiss Draft
                        </button>
                      </div>
                    )}

                    {activeMemorial.decision ? (
                      <div className="modern-decided-card">
                        <div className="eyebrow-row">
                          <span className="badge is-ok">
                            <Check size={12} /> {activeMemorial.decision.action.toUpperCase()}
                          </span>
                          <span className="muted small">
                            by {activeMemorial.decision.decided_by_label} ·{" "}
                            {new Date(activeMemorial.decision.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p>{activeMemorial.decision.comment}</p>
                        {activeMemorial.decision.instructions && (
                          <p className="muted small">
                            <strong>Instructions:</strong>{" "}
                            {activeMemorial.decision.instructions}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="modern-composer">
                        <div className="composer-actions-row">
                          {(
                            ["approve", "reject", "needs_info", "reply"] as DecisionAction[]
                          ).map((act) => (
                            <button
                              key={act}
                              className={`pill-btn ${action === act ? "is-active" : ""}`}
                              onClick={() => setAction(act)}
                            >
                              {presented.actionLabels[act]}
                            </button>
                          ))}
                        </div>
                        <textarea
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
                          onKeyDown={(e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                              void handleSubmit();
                            }
                          }}
                          placeholder="Write decision rationale (Ctrl+Enter to submit)..."
                        />
                        <div className="composer-foot">
                          <input
                            value={instructions}
                            onChange={(e) => setInstructions(e.target.value)}
                            placeholder="Optional follow-up instructions for agent..."
                          />
                          <button
                            className="btn-primary"
                            disabled={submitting}
                            onClick={handleSubmit}
                          >
                            <Send size={14} />{" "}
                            {submitting
                              ? "Saving..."
                              : presented.actionLabels[action]}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="empty-hint">
                    Select a memorial from the queue to inspect and decide.
                  </div>
                )}
              </div>

              {/* Pane 3: Telemetry & Context Inspector */}
              <aside className="modern-inspector-col">
                <h4>Delivery Telemetry</h4>
                {activeMemorial ? (
                  <div className="kv-list">
                    <div>
                      <span>Agent</span>
                      <strong>{activeAgent?.name ?? activeMemorial.agent_id}</strong>
                    </div>
                    <div>
                      <span>Execution Mode</span>
                      <strong>
                        {activeAgent?.mode === "bridge_managed"
                          ? "Bridge-managed"
                          : "MCP-only (Poll)"}
                      </strong>
                    </div>
                    <div>
                      <span>Project</span>
                      <strong>{activeProject?.name ?? activeMemorial.project_id}</strong>
                    </div>
                    <div>
                      <span>Optimistic Lock</span>
                      <code>v{activeMemorial.version}</code>
                    </div>
                    <div>
                      <span>Delivery State</span>
                      <strong>
                        {formatDeliveryStatus(
                          activeMemorial.decision?.delivery_status ??
                            activeMemorial.delivery_status,
                          "standard"
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Resume State</span>
                      <strong>
                        {formatResumeStatus(
                          activeMemorial.decision?.resume_status ??
                            activeMemorial.resume_status,
                          "standard"
                        )}
                      </strong>
                    </div>
                    {activeMemorial.decision?.bridge_claimed_at && (
                      <div>
                        <span>Bridge Claimed</span>
                        <span className="small">
                          {new Date(
                            activeMemorial.decision.bridge_claimed_at
                          ).toLocaleTimeString()}
                        </span>
                      </div>
                    )}
                    {activeMemorial.decision?.agent_resumed_at && (
                      <div>
                        <span>Agent Resumed</span>
                        <span className="small">
                          {new Date(
                            activeMemorial.decision.agent_resumed_at
                          ).toLocaleTimeString()}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="muted small">No active selection.</p>
                )}
              </aside>
            </div>
          )}

          {store.nav === "tasks" && (
            <TasksWorkspace store={store} onOpenNewTask={onOpenNewTask} />
          )}
          {store.nav === "bridge" && <ProjectsBridgePanel store={store} />}
          {store.nav === "mcp" && <McpAccessPanel store={store} />}
          {store.nav === "settings" && <SettingsPanel store={store} />}
        </div>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="mobile-bottom-dock" aria-label="Mobile Navigation">
        <button
          className={store.nav === "inbox" ? "is-active" : ""}
          onClick={() => store.setNav("inbox")}
        >
          <Inbox size={18} />
          <span>Inbox</span>
          {store.pendingCount > 0 && <em>{store.pendingCount}</em>}
        </button>
        <button
          className={store.nav === "tasks" ? "is-active" : ""}
          onClick={() => store.setNav("tasks")}
        >
          <Layers size={18} />
          <span>Tasks</span>
        </button>
        <button
          className={store.nav === "bridge" ? "is-active" : ""}
          onClick={() => store.setNav("bridge")}
        >
          <Server size={18} />
          <span>Bridge</span>
        </button>
        <button
          className={store.nav === "mcp" ? "is-active" : ""}
          onClick={() => store.setNav("mcp")}
        >
          <KeyRound size={18} />
          <span>MCP</span>
        </button>
        <button
          className={store.nav === "settings" ? "is-active" : ""}
          onClick={() => store.setNav("settings")}
        >
          <Settings size={18} />
          <span>Settings</span>
        </button>
      </nav>
    </div>
  );
}
