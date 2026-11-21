import type {
  Agent,
  DecisionAction,
  DeliveryStatus,
  Memorial,
  MemorialStatus,
  Project,
  ReportStyle,
  ResumeStatus,
  RiskLevel,
  TaskMessage,
  TaskStatus,
} from "@kangxi/protocol";

export interface PresentedMemorial {
  headerPrefix: string;
  salutation: string;
  closingFormula: string;
  statusLabel: string;
  requestTypeLabel: string;
  riskLabel: string;
  /** Raw factual text is NEVER modified — always kept intact */
  rawContent: string;
  actionLabels: Record<DecisionAction, string>;
}

export interface PresentedMessage {
  prefix: string;
  kindLabel: string;
  rawContent: string;
}

const IMPERIAL_STATUS: Record<MemorialStatus, string> = {
  pending: "候旨朱批",
  approved: "已降朱批 · 准奏",
  rejected: "已降朱批 · 驳回",
  needs_info: "着令再议",
  superseded: "已为新折替代",
};

const STANDARD_STATUS: Record<MemorialStatus, string> = {
  pending: "Pending Review",
  approved: "Approved",
  rejected: "Rejected",
  needs_info: "Needs Info",
  superseded: "Superseded",
};

const IMPERIAL_TASK_STATUS: Record<TaskStatus, string> = {
  queued: "待领旨",
  running: "钦差办理中",
  waiting_for_user: "候御批",
  paused: "暂缓办理",
  completed: "差事已毕",
  failed: "办理失利",
  cancelled: "旨意已撤",
};

const STANDARD_TASK_STATUS: Record<TaskStatus, string> = {
  queued: "Queued",
  running: "Running",
  waiting_for_user: "Waiting for Approval",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const IMPERIAL_DELIVERY_STATUS: Record<DeliveryStatus, string> = {
  queued: "驿站待领",
  delivered: "已递至本机",
  acknowledged: "Bridge 已领旨",
  failed: "驿传受阻",
};

const STANDARD_DELIVERY_STATUS: Record<DeliveryStatus, string> = {
  queued: "Queued on Server",
  delivered: "Delivered to Bridge",
  acknowledged: "Bridge Claimed",
  failed: "Delivery Failed",
};

const IMPERIAL_RESUME_STATUS: Record<ResumeStatus, string> = {
  not_supported: "MCP 自主查批（无须唤醒）",
  waiting_for_bridge: "候 Bridge 传旨唤醒",
  resuming: "正在唤醒钦差会话",
  resumed: "钦差已复命续办",
  resume_failed: "唤醒受阻",
};

const STANDARD_RESUME_STATUS: Record<ResumeStatus, string> = {
  not_supported: "MCP Poll Only (No Auto-Resume)",
  waiting_for_bridge: "Waiting for Bridge",
  resuming: "Resuming Agent",
  resumed: "Agent Resumed",
  resume_failed: "Resume Failed",
};

const IMPERIAL_RISK: Record<RiskLevel, string> = {
  low: "寻常政务",
  medium: "须加详审",
  high: "兹事体大",
  critical: "十万火急 · 慎之又慎",
};

const STANDARD_RISK: Record<RiskLevel, string> = {
  low: "Low Risk",
  medium: "Medium Risk",
  high: "High Risk",
  critical: "Critical Risk",
};

export function formatMemorialStatus(
  status: MemorialStatus,
  style: ReportStyle
): string {
  return style === "memorial"
    ? IMPERIAL_STATUS[status]
    : STANDARD_STATUS[status];
}

export function formatTaskStatus(
  status: TaskStatus,
  style: ReportStyle
): string {
  return style === "memorial"
    ? IMPERIAL_TASK_STATUS[status]
    : STANDARD_TASK_STATUS[status];
}

export function formatDeliveryStatus(
  status: DeliveryStatus,
  style: ReportStyle
): string {
  return style === "memorial"
    ? IMPERIAL_DELIVERY_STATUS[status]
    : STANDARD_DELIVERY_STATUS[status];
}

export function formatResumeStatus(
  status: ResumeStatus,
  style: ReportStyle
): string {
  return style === "memorial"
    ? IMPERIAL_RESUME_STATUS[status]
    : STANDARD_RESUME_STATUS[status];
}

export function presentMemorial(
  memorial: Memorial,
  style: ReportStyle,
  agent?: Agent,
  project?: Project
): PresentedMemorial {
  const agentName = agent?.name ?? memorial.agent_id;
  const agentTitle = agent?.title ? `${agent.title} ` : "";
  const projectName = project?.name ?? memorial.project_id;

  if (style === "memorial") {
    const typeMap: Record<Memorial["request_type"], string> = {
      approval: "请旨准行折",
      decision: "军机议决折",
      clarification: "请示机宜折",
      risk_confirmation: "重大风险请裁折",
      review: "呈请御览折",
    };
    return {
      headerPrefix: "奏为请旨事",
      salutation: `臣 ${agentTitle}${agentName} 谨奏：窃照「${projectName}」一案，兹有要情呈请圣裁——`,
      closingFormula: "伏乞皇上圣鉴训示，谨奏。",
      statusLabel: IMPERIAL_STATUS[memorial.status],
      requestTypeLabel: typeMap[memorial.request_type],
      riskLabel: IMPERIAL_RISK[memorial.risk_level],
      rawContent: memorial.content,
      actionLabels: {
        approve: "准奏",
        reject: "驳回",
        needs_info: "再议 / 补陈",
        reply: "朱批回复",
      },
    };
  }

  const stdTypeMap: Record<Memorial["request_type"], string> = {
    approval: "Approval Request",
    decision: "Decision Needed",
    clarification: "Clarification",
    risk_confirmation: "Risk Confirmation",
    review: "Review Request",
  };
  return {
    headerPrefix: stdTypeMap[memorial.request_type],
    salutation: `${agentName} · ${projectName}`,
    closingFormula: "",
    statusLabel: STANDARD_STATUS[memorial.status],
    requestTypeLabel: stdTypeMap[memorial.request_type],
    riskLabel: STANDARD_RISK[memorial.risk_level],
    rawContent: memorial.content,
    actionLabels: {
      approve: "Approve",
      reject: "Reject",
      needs_info: "Request Info",
      reply: "Reply",
    },
  };
}

export function presentMessage(
  message: TaskMessage,
  style: ReportStyle
): PresentedMessage {
  if (style === "memorial") {
    const kindLabels: Record<TaskMessage["kind"], string> = {
      user_prompt: "圣旨下达",
      user_followup: "续降谕旨",
      agent_report: "钦差回奏",
      agent_log: "办差实录",
      task_result: "差竣复命",
      memorial_notice: "递呈奏折",
      decision_notice: "朱批已降",
      system: "军机处纪要",
    };
    const prefix =
      message.kind === "agent_report"
        ? "臣谨回奏："
        : message.kind === "task_result"
          ? "臣奉旨办结，谨此复命："
          : "";
    return {
      prefix,
      kindLabel: kindLabels[message.kind],
      rawContent: message.content,
    };
  }

  const stdLabels: Record<TaskMessage["kind"], string> = {
    user_prompt: "Task Prompt",
    user_followup: "Follow-up",
    agent_report: "Progress Report",
    agent_log: "Execution Log",
    task_result: "Final Result",
    memorial_notice: "Memorial Submitted",
    decision_notice: "Decision Recorded",
    system: "System",
  };
  return {
    prefix: "",
    kindLabel: stdLabels[message.kind],
    rawContent: message.content,
  };
}
