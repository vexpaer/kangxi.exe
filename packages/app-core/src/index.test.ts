import { describe, expect, it } from "vitest";
import type { Memorial } from "@kangxi/protocol";
import { OfflineDraftStore, presentMemorial } from "./index.js";

const sampleMemorial: Memorial = {
  id: "mem_1",
  owner_id: "owner_1",
  project_id: "proj_1",
  agent_id: "agent_codex",
  session_id: "sess_1",
  task_id: "task_1",
  title: "Apply database index",
  content: "CREATE INDEX idx_memorials_status ON memorials(status);\n-- Zero downtime expected.",
  request_type: "approval",
  options: [],
  risk_level: "medium",
  risk_notes: "Table write lock < 50ms",
  context_summary: null,
  status: "pending",
  delivery_status: "queued",
  resume_status: "waiting_for_bridge",
  decision: null,
  version: 1,
  source: "mcp",
  created_at: "2026-11-21T00:00:00.000Z",
  updated_at: "2026-11-21T00:00:00.000Z",
};

describe("@kangxi/app-core presenter & drafts", () => {
  it("never alters raw factual content across memorial and standard styles", () => {
    const imperial = presentMemorial(sampleMemorial, "memorial");
    const standard = presentMemorial(sampleMemorial, "standard");

    expect(imperial.rawContent).toBe(sampleMemorial.content);
    expect(standard.rawContent).toBe(sampleMemorial.content);
    expect(imperial.actionLabels.approve).toBe("准奏");
    expect(standard.actionLabels.approve).toBe("Approve");
  });

  it("preserves offline draft when a 409 server conflict occurs", () => {
    const store = new OfflineDraftStore();
    store.save({
      memorial_id: "mem_1",
      action: "approve",
      selected_option_id: null,
      comment: "Local offline approval note",
      instructions: "",
      expected_version: 1,
      idempotency_key: "idem_1",
    });

    const serverDecided: Memorial = { ...sampleMemorial, status: "rejected", version: 2 };
    const conflicted = store.markConflict("mem_1", serverDecided);
    expect(conflicted?.comment).toBe("Local offline approval note");
    expect(conflicted?.conflict?.server_memorial.status).toBe("rejected");
  });
});
