import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Unified Business Status Enums (SPEC 5.2)
// ---------------------------------------------------------------------------

export const TaskStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_for_user",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const MemorialStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "needs_info",
  "superseded",
]);
export type MemorialStatus = z.infer<typeof MemorialStatusSchema>;

export const DeliveryStatusSchema = z.enum([
  "queued",
  "delivered",
  "acknowledged",
  "failed",
]);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

export const ResumeStatusSchema = z.enum([
  "not_supported",
  "waiting_for_bridge",
  "resuming",
  "resumed",
  "resume_failed",
]);
export type ResumeStatus = z.infer<typeof ResumeStatusSchema>;

export const DecisionActionSchema = z.enum([
  "approve",
  "reject",
  "needs_info",
  "reply",
]);
export type DecisionAction = z.infer<typeof DecisionActionSchema>;

export const AgentProviderSchema = z.enum([
  "codex",
  "claude_code",
  "mcp_external",
]);
export type AgentProvider = z.infer<typeof AgentProviderSchema>;

export const SessionModeSchema = z.enum([
  "bridge_managed",
  "mcp_only",
]);
export type SessionMode = z.infer<typeof SessionModeSchema>;

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const MemorialRequestTypeSchema = z.enum([
  "approval",
  "decision",
  "clarification",
  "risk_confirmation",
  "review",
]);
export type MemorialRequestType = z.infer<typeof MemorialRequestTypeSchema>;

export const CredentialScopeSchema = z.enum([
  "owner",
  "device",
  "bridge",
  "mcp_agent",
]);
export type CredentialScope = z.infer<typeof CredentialScopeSchema>;

export const DevicePlatformSchema = z.enum([
  "windows",
  "android",
  "web",
  "cli",
]);
export type DevicePlatform = z.infer<typeof DevicePlatformSchema>;

export const ThemeModeSchema = z.enum(["imperial", "modern"]);
export type ThemeMode = z.infer<typeof ThemeModeSchema>;

export const ReportStyleSchema = z.enum(["memorial", "standard"]);
export type ReportStyle = z.infer<typeof ReportStyleSchema>;

// ---------------------------------------------------------------------------
// Core Entities
// ---------------------------------------------------------------------------

export const MemorialOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  recommended: z.boolean().optional(),
});
export type MemorialOption = z.infer<typeof MemorialOptionSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().default(""),
  default_agent_id: z.string().nullable().default(null),
  bridge_id: z.string().nullable().default(null),
  /** Display label only — actual filesystem path authorization is stored ONLY on the local Windows Bridge */
  host_label: z.string().nullable().default(null),
  version: z.number().int().positive(),
  source: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const AgentSchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  name: z.string(),
  title: z.string().default(""),
  provider: AgentProviderSchema,
  mode: SessionModeSchema,
  bridge_id: z.string().nullable().default(null),
  capabilities: z.object({
    supports_resume: z.boolean(),
    supports_streaming: z.boolean(),
    supports_cancel: z.boolean(),
    notes: z.string().optional(),
  }),
  version: z.number().int().positive(),
  source: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Agent = z.infer<typeof AgentSchema>;

export const BridgeHostSchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  name: z.string(),
  hostname: z.string(),
  platform: z.string().default("windows"),
  bridge_version: z.string().default("0.1.0"),
  status: z.enum(["online", "offline"]),
  last_seen_at: z.string().nullable(),
  providers: z.array(
    z.object({
      provider: AgentProviderSchema,
      available: z.boolean(),
      version: z.string().nullable().optional(),
      supports_resume: z.boolean(),
      notes: z.string().optional(),
    })
  ),
  authorized_project_ids: z.array(z.string()).default([]),
  version: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type BridgeHost = z.infer<typeof BridgeHostSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  project_id: z.string(),
  agent_id: z.string(),
  bridge_id: z.string().nullable(),
  mode: SessionModeSchema,
  provider_session_id: z.string().nullable(),
  status: z.enum(["active", "idle", "closed"]),
  version: z.number().int().positive(),
  source: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Session = z.infer<typeof SessionSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  project_id: z.string(),
  agent_id: z.string(),
  session_id: z.string().nullable(),
  bridge_id: z.string().nullable(),
  title: z.string(),
  prompt: z.string(),
  status: TaskStatusSchema,
  delivery_status: DeliveryStatusSchema,
  resume_status: ResumeStatusSchema,
  summary: z.string().nullable(),
  error_message: z.string().nullable(),
  version: z.number().int().positive(),
  source: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const MessageKindSchema = z.enum([
  "user_prompt",
  "user_followup",
  "agent_report",
  "agent_log",
  "task_result",
  "memorial_notice",
  "decision_notice",
  "system",
]);
export type MessageKind = z.infer<typeof MessageKindSchema>;

export const TaskMessageSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  session_id: z.string().nullable(),
  sender_type: z.enum(["user", "agent", "bridge", "system"]),
  sender_id: z.string(),
  kind: MessageKindSchema,
  content: z.string(),
  metadata: z.record(z.unknown()).default({}),
  truncated: z.boolean().default(false),
  created_at: z.string(),
});
export type TaskMessage = z.infer<typeof TaskMessageSchema>;

export const DecisionSchema = z.object({
  id: z.string(),
  memorial_id: z.string(),
  action: DecisionActionSchema,
  selected_option_id: z.string().nullable().default(null),
  comment: z.string(),
  instructions: z.string().nullable().default(null),
  decided_by_device_id: z.string().nullable(),
  decided_by_label: z.string(),
  delivery_status: DeliveryStatusSchema,
  resume_status: ResumeStatusSchema,
  bridge_claimed_at: z.string().nullable(),
  agent_resumed_at: z.string().nullable(),
  resume_error: z.string().nullable(),
  version: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const MemorialSchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  project_id: z.string(),
  agent_id: z.string(),
  session_id: z.string().nullable(),
  task_id: z.string().nullable(),
  title: z.string(),
  /** Raw unmodified original content — never mutated by presentation themes */
  content: z.string(),
  request_type: MemorialRequestTypeSchema,
  options: z.array(MemorialOptionSchema).default([]),
  risk_level: RiskLevelSchema.default("low"),
  risk_notes: z.string().nullable().default(null),
  context_summary: z.string().nullable().default(null),
  status: MemorialStatusSchema,
  delivery_status: DeliveryStatusSchema,
  resume_status: ResumeStatusSchema,
  decision: DecisionSchema.nullable().default(null),
  version: z.number().int().positive(),
  source: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Memorial = z.infer<typeof MemorialSchema>;

export const CredentialRecordSchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  label: z.string(),
  scope: CredentialScopeSchema,
  device_platform: DevicePlatformSchema.nullable(),
  agent_id: z.string().nullable(),
  bridge_id: z.string().nullable(),
  allowed_project_ids: z.array(z.string()).nullable(),
  token_prefix: z.string(),
  last_used_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
});
export type CredentialRecord = z.infer<typeof CredentialRecordSchema>;

export const SyncEventTypeSchema = z.enum([
  "memorial.created",
  "memorial.updated",
  "decision.created",
  "delivery.updated",
  "resume.updated",
  "task.created",
  "task.updated",
  "task.cancelled",
  "task.message.created",
  "report.created",
  "bridge.status",
  "project.updated",
  "agent.updated",
  "credential.revoked",
]);
export type SyncEventType = z.infer<typeof SyncEventTypeSchema>;

export const SyncEventSchema = z.object({
  event_id: z.string(),
  sequence: z.number().int().nonnegative(),
  type: SyncEventTypeSchema,
  entity_id: z.string(),
  project_id: z.string().nullable().optional(),
  bridge_id: z.string().nullable().optional(),
  occurred_at: z.string(),
  schema_version: z.literal(SCHEMA_VERSION),
  payload: z.record(z.unknown()).default({}),
});
export type SyncEvent = z.infer<typeof SyncEventSchema>;

// ---------------------------------------------------------------------------
// API Request & Response Contracts
// ---------------------------------------------------------------------------

export const BootstrapRequestSchema = z.object({
  owner_name: z.string().min(1).max(80).default("陛下"),
  username: z.string().min(1).max(64).optional(),
  password: z.string().min(6).max(128).optional(),
  device_label: z.string().min(1).max(80).default("Windows 御案"),
  platform: DevicePlatformSchema.default("windows"),
  bootstrap_secret: z.string().optional(),
});

export const AuthLoginRequestSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
  device_label: z.string().min(1).max(80).default("KangXi Client"),
  platform: DevicePlatformSchema.default("windows"),
  fcm_token: z.string().max(512).optional(),
});

export const ChangePasswordRequestSchema = z.object({
  current_password: z.string().max(128).optional(),
  username: z.string().min(1).max(64).optional(),
  new_password: z.string().min(6).max(128),
  revoke_other_devices: z.boolean().default(false),
});

export const CreateProjectRequestSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  default_agent_id: z.string().nullable().optional(),
  bridge_id: z.string().nullable().optional(),
  host_label: z.string().max(120).nullable().optional(),
});

export const CreateAgentRequestSchema = z.object({
  name: z.string().min(1).max(120),
  title: z.string().max(120).optional(),
  provider: AgentProviderSchema,
  mode: SessionModeSchema.default("mcp_only"),
  bridge_id: z.string().nullable().optional(),
  supports_resume: z.boolean().optional(),
  supports_streaming: z.boolean().optional(),
  supports_cancel: z.boolean().optional(),
  notes: z.string().max(400).optional(),
});

export const CreateTaskRequestSchema = z.object({
  project_id: z.string().min(1),
  agent_id: z.string().min(1),
  title: z.string().min(1).max(200),
  prompt: z.string().min(1).max(20000),
  session_id: z.string().nullable().optional(),
  idempotency_key: z.string().max(128).optional(),
});

export const AppendTaskMessageRequestSchema = z.object({
  content: z.string().min(1).max(20000),
  kind: MessageKindSchema.optional(),
  idempotency_key: z.string().max(128).optional(),
});

export const CreateMemorialRequestSchema = z.object({
  project_id: z.string().min(1),
  agent_id: z.string().min(1).optional(),
  session_id: z.string().nullable().optional(),
  task_id: z.string().nullable().optional(),
  title: z.string().min(1).max(240),
  content: z.string().min(1).max(32000),
  request_type: MemorialRequestTypeSchema.default("approval"),
  options: z.array(MemorialOptionSchema).max(10).default([]),
  risk_level: RiskLevelSchema.default("low"),
  risk_notes: z.string().max(2000).nullable().optional(),
  context_summary: z.string().max(4000).nullable().optional(),
  idempotency_key: z.string().max(128).optional(),
});

export const SubmitDecisionRequestSchema = z.object({
  action: DecisionActionSchema,
  selected_option_id: z.string().nullable().optional(),
  comment: z.string().min(1).max(12000),
  instructions: z.string().max(12000).nullable().optional(),
  expected_version: z.number().int().positive(),
  idempotency_key: z.string().max(128).optional(),
});

export const SubmitReportRequestSchema = z.object({
  project_id: z.string().min(1),
  agent_id: z.string().min(1).optional(),
  task_id: z.string().nullable().optional(),
  session_id: z.string().nullable().optional(),
  title: z.string().min(1).max(240),
  content: z.string().min(1).max(16000),
  task_status: TaskStatusSchema.optional(),
  idempotency_key: z.string().max(128).optional(),
});

export const BridgeRegisterRequestSchema = z.object({
  bridge_id: z.string().optional(),
  name: z.string().min(1).max(120),
  hostname: z.string().min(1).max(120),
  platform: z.string().default("windows"),
  bridge_version: z.string().default("0.1.0"),
  providers: BridgeHostSchema.shape.providers,
  authorized_project_ids: z.array(z.string()).default([]),
});

export const BridgeDeliveryAckRequestSchema = z.object({
  entity_type: z.enum(["task", "decision"]),
  entity_id: z.string().min(1),
  delivery_status: DeliveryStatusSchema,
  resume_status: ResumeStatusSchema.optional(),
  provider_session_id: z.string().nullable().optional(),
  error_message: z.string().max(2000).nullable().optional(),
});

export const CreatePairingRequestSchema = z.object({
  label: z.string().min(1).max(80).default("Android 移动御批"),
  platform: DevicePlatformSchema.default("android"),
  ttl_seconds: z.number().int().min(60).max(900).default(300),
});

export const RedeemPairingRequestSchema = z.object({
  pairing_code: z.string().min(6).max(64),
  device_label: z.string().min(1).max(80).optional(),
  platform: DevicePlatformSchema.default("android"),
  fcm_token: z.string().max(512).optional(),
});

export const CreateCredentialRequestSchema = z.object({
  label: z.string().min(1).max(100),
  scope: z.enum(["device", "bridge", "mcp_agent"]),
  device_platform: DevicePlatformSchema.nullable().optional(),
  agent_id: z.string().nullable().optional(),
  bridge_id: z.string().nullable().optional(),
  allowed_project_ids: z.array(z.string()).nullable().optional(),
});

// ---------------------------------------------------------------------------
// MCP Tool Input Schemas (SPEC 5.1)
// ---------------------------------------------------------------------------

export const McpSubmitMemorialInputSchema = z.object({
  project_id: z.string().min(1).describe("Target KangXi project ID"),
  title: z.string().min(1).max(240).describe("Concise title of the decision request"),
  content: z.string().min(1).max(32000).describe("Full factual content, context, diff summary, or question"),
  request_type: MemorialRequestTypeSchema.optional().default("approval"),
  options: z.array(MemorialOptionSchema).optional().default([]),
  risk_level: RiskLevelSchema.optional().default("low"),
  risk_notes: z.string().max(2000).optional(),
  context_summary: z.string().max(4000).optional(),
  task_id: z.string().optional(),
  session_id: z.string().optional(),
  idempotency_key: z.string().max(128).optional(),
});

export const McpCheckMemorialInputSchema = z.object({
  memorial_id: z.string().min(1).describe("Memorial ID returned by submit_memorial"),
});

export const McpGetMemorialReplyInputSchema = z.object({
  memorial_id: z.string().min(1).describe("Memorial ID to retrieve the structured human rescript/decision"),
});

export const McpSubmitReportInputSchema = z.object({
  project_id: z.string().min(1).describe("Target KangXi project ID"),
  title: z.string().min(1).max(240).describe("Short report title"),
  content: z.string().min(1).max(16000).describe("Progress update or completion summary (non-blocking)"),
  task_id: z.string().optional(),
  session_id: z.string().optional(),
  task_status: TaskStatusSchema.optional(),
  idempotency_key: z.string().max(128).optional(),
});

export const MCP_TOOL_DEFINITIONS = [
  {
    name: "submit_memorial",
    description:
      "Submit a memorial (approval/decision request) to the human operator in KangXi.exe. Returns memorial_id and status.",
    inputSchema: {
      type: "object",
      required: ["project_id", "title", "content"],
      properties: {
        project_id: { type: "string", description: "Target KangXi project ID" },
        title: { type: "string", description: "Concise title of the request" },
        content: {
          type: "string",
          description: "Full factual details, proposed changes, or question",
        },
        request_type: {
          type: "string",
          enum: ["approval", "decision", "clarification", "risk_confirmation", "review"],
          default: "approval",
        },
        options: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "label"],
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              description: { type: "string" },
              recommended: { type: "boolean" },
            },
          },
        },
        risk_level: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          default: "low",
        },
        risk_notes: { type: "string" },
        context_summary: { type: "string" },
        task_id: { type: "string" },
        session_id: { type: "string" },
        idempotency_key: { type: "string" },
      },
    },
  },
  {
    name: "check_memorial",
    description:
      "Check the current status, version, delivery state, and resume state of a submitted memorial.",
    inputSchema: {
      type: "object",
      required: ["memorial_id"],
      properties: {
        memorial_id: { type: "string", description: "Memorial ID returned by submit_memorial" },
      },
    },
  },
  {
    name: "get_memorial_reply",
    description:
      "Retrieve the structured human decision (approve/reject/needs_info/reply), comment, and follow-up instructions for a memorial.",
    inputSchema: {
      type: "object",
      required: ["memorial_id"],
      properties: {
        memorial_id: { type: "string", description: "Memorial ID to query" },
      },
    },
  },
  {
    name: "submit_report",
    description:
      "Submit an informational progress or completion report without creating a blocking approval memorial.",
    inputSchema: {
      type: "object",
      required: ["project_id", "title", "content"],
      properties: {
        project_id: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
        task_id: { type: "string" },
        session_id: { type: "string" },
        task_status: {
          type: "string",
          enum: ["queued", "running", "waiting_for_user", "paused", "completed", "failed", "cancelled"],
        },
        idempotency_key: { type: "string" },
      },
    },
  },
] as const;

export function decisionActionToMemorialStatus(
  action: DecisionAction
): MemorialStatus {
  switch (action) {
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "needs_info":
      return "needs_info";
    case "reply":
      return "approved";
  }
}
