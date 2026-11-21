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
  Moon,
  Plus,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings,
  Sun,
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
      const idx = filteredMemorials.findIndex(
        (m) => m.id === activeMemorial?.id
      );
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

  const isLight = store.prefs.modernAppearance === "light";

  return (
    <div className="modern-shell">
      {/* Translucent macOS Vibrancy Sidebar */}
      <aside className="modern-rail">
        <div className="modern-brand">
          <div className="modern-logo">
            <span>御</span>
          </div>
          <div>
            <div className="modern-brand-name">KangXi</div>
            <div className="modern-brand-sub">Agent Workspace</div>
          </div>
        </div>

        <button className="modern-new-btn" onClick={onOpenNewTask}>
          <Plus size={15} strokeWidth={2.2} /> New Task
        </button>

        <div className="rail-section-label">Workspace</div>
        <nav className="modern-nav" aria-label="Workspace Navigation">
          <button
            className={store.nav === "inbox" ? "is-active" : ""}
            onClick={() => store.setNav("inbox")}
          >
            <Inbox size={16} strokeWidth={1.75} />
            <span>Inbox</span>
            {store.pendingCount > 0 && (
              <span className="rail-badge">{store.pendingCount}</span>
            )}
          </button>
          <button
            className={store.nav === "tasks" ? "is-active" : ""}
            onClick={() => store.setNav("tasks")}
          >
            <Layers size={16} strokeWidth={1.75} />
            <span>Sessions</span>
            {store.tasks.length > 0 && (
              <span className="rail-count">{store.tasks.length}</span>
            )}
          </button>

          <div className="rail-section-label" style={{ marginTop: 12 }}>
            Environment
          </div>

          <button
            className={store.nav === "bridge" ? "is-active" : ""}
            onClick={() => store.setNav("bridge")}
          >
            <Server size={16} strokeWidth={1.75} />
            <span>Projects & Host</span>
          </button>
          <button
            className={store.nav === "mcp" ? "is-active" : ""}
            onClick={() => store.setNav("mcp")}
          >
            <KeyRound size={16} strokeWidth={1.75} />
            <span>MCP & Pairing</span>
          </button>
          <button
            className={store.nav === "settings" ? "is-active" : ""}
            onClick={() => store.setNav("settings")}
          >
            <Settings size={16} strokeWidth={1.75} />
            <span>Settings</span>
          </button>
        </nav>

        <div className="modern-rail-footer">
          <div className="sync-pill">
            <span
              className={`status-dot ${
                store.connectionState === "online" ||
                store.connectionState === "local"
                  ? "is-online"
                  : store.connectionState === "sandbox"
                    ? "is-sandbox"
                    : "is-offline"
              }`}
            />
            <span className="truncate">
              {store.connectionState === "local"
                ? `Local · ${store.projects.length} projects`
                : store.connectionState === "online"
                  ? `Cloud · #${store.latestSequence}`
                  : store.connectionState === "sandbox"
                    ? "Sandbox"
                    : "Reconnecting"}
            </span>
            {store.localMode && (
              <button
                className="rail-mini-icon"
                title="重新扫描本机 Codex / Claude 会话"
                disabled={store.rescanning}
                onClick={store.rescanLocalImport}
              >
                <RefreshCw size={13} strokeWidth={1.8} />
              </button>
            )}
          </div>

          <div className="rail-footer-controls">
            <button
              className="rail-appearance-btn"
              title={isLight ? "切换深空石墨深色模式" : "切换通透浅色模式"}
              onClick={() =>
                store.updatePrefs({
                  modernAppearance: isLight ? "dark" : "light",
                })
              }
            >
              {isLight ? (
                <>
                  <Moon size={13} strokeWidth={1.8} /> Dark
                </>
              ) : (
                <>
                  <Sun size={13} strokeWidth={1.8} /> Light
                </>
              )}
            </button>
            <button
              className="rail-switch-btn"
              onClick={() => store.updatePrefs({ themeMode: "imperial" })}
            >
              <Crown size={13} strokeWidth={1.8} /> 御案模式
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Canvas */}
      <div className="modern-main">
        <header className="modern-topbar">
          <div className="modern-search">
            <Search size={14} strokeWidth={1.8} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search memorials, sessions, projects…"
            />
          </div>

          <div className="modern-topbar-right">
            <button
              className="apple-chip"
              onClick={() =>
                store.updatePrefs({
                  reportStyle:
                    store.prefs.reportStyle === "standard"
                      ? "memorial"
                      : "standard",
                })
              }
            >
              Style: {store.prefs.reportStyle === "memorial" ? "奏折体" : "Standard"}
            </button>
            <button className="apple-chip hide-mobile" onClick={onOpenPalette}>
              <Command size={12} strokeWidth={2} /> K
            </button>
            <button
              className="apple-chip show-mobile-only"
              onClick={() =>
                store.updatePrefs({
                  modernAppearance: isLight ? "dark" : "light",
                })
              }
            >
              {isLight ? <Moon size={13} /> : <Sun size={13} />}
            </button>
            <button
              className="apple-chip show-mobile-only"
              onClick={() => store.updatePrefs({ themeMode: "imperial" })}
            >
              <Crown size={13} /> 御案
            </button>
          </div>
        </header>

        <div className="modern-content">
          {store.nav === "inbox" && (
            <div
              className={`modern-three-pane ${mobileDetailOpen ? "mobile-detail-open" : ""}`}
            >
              {/* Pane 1: Apple Mail-inspired Queue */}
              <div className="modern-queue-col">
                <div className="queue-tabs">
                  {(
                    [
                      ["pending", "Pending"],
                      ["approved", "Approved"],
                      ["rejected", "Rejected"],
                      ["needs_info", "Info"],
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
                    <div className="apple-empty-state">
                      <Inbox size={26} strokeWidth={1.3} />
                      <strong>All Clear</strong>
                      <p className="muted small">
                        {store.localMode
                          ? "No pending memorials. Local MCP agents can submit requests to 127.0.0.1, or open Sessions to continue imported Codex / Claude threads."
                          : "No items match this filter."}
                      </p>
                    </div>
                  ) : (
                    filteredMemorials.map((m) => {
                      const ag = store.agents.find((a) => a.id === m.agent_id);
                      const prj = store.projects.find(
                        (p) => p.id === m.project_id
                      );
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
                            <span
                              className={`risk-indicator risk-${m.risk_level}`}
                            />
                            <strong className="truncate">{m.title}</strong>
                          </div>
                          <div className="queue-row-meta">
                            <span className="truncate">
                              {ag?.name ?? m.agent_id} ·{" "}
                              {prj?.name ?? m.project_id}
                            </span>
                            <span className={`mini-status status-${m.status}`}>
                              {formatMemorialStatus(
                                m.status,
                                store.prefs.reportStyle
                              )}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Pane 2: Airy Apple Reading Sheet + Composer */}
              <div className="modern-detail-col">
                {activeMemorial && presented ? (
                  <div className="apple-reading-sheet">
                    <div className="detail-mobile-back">
                      <button
                        className="btn-ghost"
                        onClick={() => setMobileDetailOpen(false)}
                      >
                        <ArrowLeft size={14} /> Back
                      </button>
                    </div>

                    <div className="modern-detail-head">
                      <div>
                        <div className="eyebrow-row">
                          <span className="apple-tag">
                            {presented.requestTypeLabel}
                          </span>
                          <span
                            className={`apple-tag risk-${activeMemorial.risk_level}`}
                          >
                            {presented.riskLabel}
                          </span>
                          <code className="muted small">
                            {activeMemorial.id}
                          </code>
                        </div>
                        <h2>{activeMemorial.title}</h2>
                        <p className="muted small">{presented.salutation}</p>
                      </div>
                      <button
                        className="apple-chip"
                        onClick={() => setRawOverride((v) => !v)}
                      >
                        {rawOverride ? (
                          <Eye size={13} strokeWidth={1.8} />
                        ) : (
                          <FileCode2 size={13} strokeWidth={1.8} />
                        )}
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
                        <strong>Risk Note:</strong> {activeMemorial.risk_notes}
                      </div>
                    )}

                    <div className="modern-body-card">
                      <pre className="raw-content">{presented.rawContent}</pre>
                    </div>

                    {activeMemorial.options.length > 0 && (
                      <div className="options-grid">
                        {activeMemorial.options.map((opt) => {
                          const picked =
                            (activeMemorial.decision?.selected_option_id ??
                              selectedOption) === opt.id;
                          return (
                            <button
                              key={opt.id}
                              disabled={activeMemorial.status !== "pending"}
                              className={`option-card ${picked ? "is-picked" : ""}`}
                              onClick={() => setSelectedOption(opt.id)}
                            >
                              <div className="option-head">
                                <strong>{opt.label}</strong>
                                {opt.recommended && (
                                  <span className="badge is-ok">
                                    Recommended
                                  </span>
                                )}
                              </div>
                              {opt.description && (
                                <p className="muted small">{opt.description}</p>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {activeDraft?.conflict && (
                      <div className="conflict-box">
                        <strong>Version Conflict (409)</strong>
                        <p className="small">
                          Server state is now{" "}
                          <code>
                            {activeDraft.conflict.server_memorial.status}
                          </code>
                          . Your local draft was preserved:
                        </p>
                        <blockquote className="small">
                          {activeDraft.comment}
                        </blockquote>
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
                            <Check size={12} />{" "}
                            {activeMemorial.decision.action.toUpperCase()}
                          </span>
                          <span className="muted small">
                            {activeMemorial.decision.decided_by_label} ·{" "}
                            {new Date(
                              activeMemorial.decision.created_at
                            ).toLocaleString()}
                          </span>
                        </div>
                        <p className="decided-comment">
                          {activeMemorial.decision.comment}
                        </p>
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
                            [
                              "approve",
                              "reject",
                              "needs_info",
                              "reply",
                            ] as DecisionAction[]
                          ).map((act) => (
                            <button
                              key={act}
                              className={`apple-seg-pill ${action === act ? "is-active" : ""}`}
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
                                activeDraft?.idempotency_key ??
                                crypto.randomUUID(),
                            });
                          }}
                          onKeyDown={(e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                              void handleSubmit();
                            }
                          }}
                          placeholder="Add your decision note (⌘/Ctrl + Enter to submit)…"
                        />
                        <div className="composer-foot">
                          <input
                            value={instructions}
                            onChange={(e) => setInstructions(e.target.value)}
                            placeholder="Optional instructions for the agent…"
                          />
                          <button
                            className="btn-primary"
                            disabled={submitting}
                            onClick={handleSubmit}
                          >
                            <Send size={13} strokeWidth={2} />{" "}
                            {submitting
                              ? "Saving…"
                              : presented.actionLabels[action]}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="apple-empty-state centered">
                    <Inbox size={32} strokeWidth={1.25} />
                    <strong>No Memorial Selected</strong>
                    <p className="muted small">
                      Select an item from the queue, or switch to Sessions to
                      continue your imported Codex &amp; Claude Code threads.
                    </p>
                  </div>
                )}
              </div>

              {/* Pane 3: Quiet macOS Inspector */}
              <aside className="modern-inspector-col">
                <h4>Inspector</h4>
                {activeMemorial ? (
                  <div className="kv-list">
                    <div>
                      <span>Agent</span>
                      <strong>
                        {activeAgent?.name ?? activeMemorial.agent_id}
                      </strong>
                    </div>
                    <div>
                      <span>Mode</span>
                      <strong>
                        {activeAgent?.mode === "bridge_managed"
                          ? "Managed"
                          : "MCP Poll"}
                      </strong>
                    </div>
                    <div>
                      <span>Project</span>
                      <strong>
                        {activeProject?.name ?? activeMemorial.project_id}
                      </strong>
                    </div>
                    <div>
                      <span>Version</span>
                      <code className="tabular">v{activeMemorial.version}</code>
                    </div>
                    <div>
                      <span>Delivery</span>
                      <strong>
                        {formatDeliveryStatus(
                          activeMemorial.decision?.delivery_status ??
                            activeMemorial.delivery_status,
                          "standard"
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Resume</span>
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
                        <span>Claimed</span>
                        <span className="small tabular">
                          {new Date(
                            activeMemorial.decision.bridge_claimed_at
                          ).toLocaleTimeString()}
                        </span>
                      </div>
                    )}
                    {activeMemorial.decision?.agent_resumed_at && (
                      <div>
                        <span>Resumed</span>
                        <span className="small tabular">
                          {new Date(
                            activeMemorial.decision.agent_resumed_at
                          ).toLocaleTimeString()}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="muted small">No selection</p>
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

      {/* Mobile Frosted Bottom Tab Bar */}
      <nav className="mobile-bottom-dock" aria-label="Mobile Navigation">
        <button
          className={store.nav === "inbox" ? "is-active" : ""}
          onClick={() => store.setNav("inbox")}
        >
          <Inbox size={18} strokeWidth={1.75} />
          <span>Inbox</span>
          {store.pendingCount > 0 && <em>{store.pendingCount}</em>}
        </button>
        <button
          className={store.nav === "tasks" ? "is-active" : ""}
          onClick={() => store.setNav("tasks")}
        >
          <Layers size={18} strokeWidth={1.75} />
          <span>Sessions</span>
        </button>
        <button
          className={store.nav === "bridge" ? "is-active" : ""}
          onClick={() => store.setNav("bridge")}
        >
          <Server size={18} strokeWidth={1.75} />
          <span>Host</span>
        </button>
        <button
          className={store.nav === "mcp" ? "is-active" : ""}
          onClick={() => store.setNav("mcp")}
        >
          <KeyRound size={18} strokeWidth={1.75} />
          <span>MCP</span>
        </button>
        <button
          className={store.nav === "settings" ? "is-active" : ""}
          onClick={() => store.setNav("settings")}
        >
          <Settings size={18} strokeWidth={1.75} />
          <span>Settings</span>
        </button>
      </nav>
    </div>
  );
}
