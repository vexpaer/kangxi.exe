import { describe, expect, it } from "vitest";
import {
  CreateMemorialRequestSchema,
  MCP_TOOL_DEFINITIONS,
  SCHEMA_VERSION,
  SubmitDecisionRequestSchema,
  SyncEventSchema,
  decisionActionToMemorialStatus,
} from "./index.js";

describe("@kangxi/protocol contracts", () => {
  it("validates memorial creation and optimistic decision payloads", () => {
    const memorial = CreateMemorialRequestSchema.parse({
      project_id: "proj_1",
      title: "Deploy migration 0002 to production D1",
      content: "Adds index on memorials(status, created_at).",
      request_type: "risk_confirmation",
      risk_level: "high",
      options: [
        { id: "opt_run", label: "Run migration now", recommended: true },
        { id: "opt_defer", label: "Defer until weekend" },
      ],
    });
    expect(memorial.options).toHaveLength(2);

    const decision = SubmitDecisionRequestSchema.parse({
      action: "approve",
      selected_option_id: "opt_run",
      comment: "准奏，备份后立即执行。",
      expected_version: 1,
    });
    expect(decisionActionToMemorialStatus(decision.action)).toBe("approved");
  });

  it("enforces required sync event envelope fields", () => {
    const evt = SyncEventSchema.parse({
      event_id: "evt_01",
      sequence: 42,
      type: "decision.created",
      entity_id: "mem_01",
      occurred_at: "2026-11-21T00:00:00.000Z",
      schema_version: SCHEMA_VERSION,
      payload: { action: "approve" },
    });
    expect(evt.sequence).toBe(42);
  });

  it("exposes all four MCP tools", () => {
    const names = MCP_TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual([
      "submit_memorial",
      "check_memorial",
      "get_memorial_reply",
      "submit_report",
    ]);
  });
});
