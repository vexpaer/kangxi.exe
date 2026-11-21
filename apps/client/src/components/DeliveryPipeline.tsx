import { formatDeliveryStatus, formatResumeStatus } from "@kangxi/app-core";
import type { Memorial, ReportStyle } from "@kangxi/protocol";
import { CheckCircle2, Clock, Radio, AlertTriangle } from "lucide-react";

interface Props {
  memorial: Memorial;
  reportStyle: ReportStyle;
  compact?: boolean;
}

/**
 * Explicitly separates:
 * 1. Server Saved (服务端保存成功)
 * 2. Bridge Claimed (Bridge 已领取)
 * 3. Agent Resumed (Agent 已恢复 / MCP 自主查批)
 * per SPEC 4.1 so delivery & execution states are never conflated.
 */
export function DeliveryPipeline({ memorial, reportStyle, compact }: Props) {
  const decided = memorial.decision !== null;
  const delivery = memorial.decision?.delivery_status ?? memorial.delivery_status;
  const resume = memorial.decision?.resume_status ?? memorial.resume_status;

  const step1Done = decided;
  const step2Done =
    decided && (delivery === "acknowledged" || delivery === "delivered");
  const step2Failed = delivery === "failed";
  const step3Done = resume === "resumed";
  const step3Failed = resume === "resume_failed";
  const step3McpOnly = resume === "not_supported";

  return (
    <div className={`delivery-pipeline ${compact ? "is-compact" : ""}`}>
      <div className={`pipeline-step ${step1Done ? "is-done" : "is-pending"}`}>
        {step1Done ? <CheckCircle2 size={14} /> : <Clock size={14} />}
        <span>
          {reportStyle === "memorial" ? "中枢留档" : "Server Saved"}:{" "}
          <strong>{step1Done ? "已确认" : "待朱批"}</strong>
        </span>
      </div>

      <span className="pipeline-sep">→</span>

      <div
        className={`pipeline-step ${
          step2Failed ? "is-err" : step2Done ? "is-done" : "is-pending"
        }`}
      >
        {step2Failed ? (
          <AlertTriangle size={14} />
        ) : step2Done ? (
          <CheckCircle2 size={14} />
        ) : (
          <Radio size={14} />
        )}
        <span>
          {reportStyle === "memorial" ? "驿传回执" : "Bridge Claim"}:{" "}
          <strong>{formatDeliveryStatus(delivery, reportStyle)}</strong>
        </span>
      </div>

      <span className="pipeline-sep">→</span>

      <div
        className={`pipeline-step ${
          step3Failed
            ? "is-err"
            : step3Done
              ? "is-done"
              : step3McpOnly
                ? "is-neutral"
                : "is-pending"
        }`}
      >
        {step3Failed ? (
          <AlertTriangle size={14} />
        ) : step3Done ? (
          <CheckCircle2 size={14} />
        ) : (
          <Clock size={14} />
        )}
        <span>
          {reportStyle === "memorial" ? "钦差复命" : "Agent Resume"}:{" "}
          <strong>{formatResumeStatus(resume, reportStyle)}</strong>
        </span>
      </div>
    </div>
  );
}
