import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function simulateExecution(toolName: string, toolCallId: string) {
  return simulateExecutionResult(toolName, toolCallId);
}

/** Pure, unit-testable execution stub (deterministic per REQ). */
export function simulateExecutionResult(toolName: string, toolCallId: string) {
  switch (toolName) {
    case "schedule_meeting":
      return { success: true, meetingId: `meeting_${toolCallId}` };

    case "draft_response":
      return {
        success: true,
        drafted: true,
        responseId: `draft_${toolCallId}`,
      };

    case "create_task":
      return { success: true, taskId: `task_${toolCallId}` };

    case "flag_urgent":
      return { success: true, flagged: true, flagId: `flag_${toolCallId}` };

    case "escalate_to_manager":
      return { success: true, escalationId: `escalation_${toolCallId}` };

    case "archive_no_action":
      return { success: true, archived: true, archiveId: `archive_${toolCallId}` };

    default:
      return { success: true };
  }
}

/**
 * Pure HITL gate decision (REQ-4.2) — unit-testable without a database.
 * Returns { allowed } or { allowed: false, reason }.
 */
export function canExecuteToolCall(toolCall: {
  approvalStatus: string;
  riskLevel: string;
  hasExecution: boolean;
}): { allowed: boolean; reason?: string; autoApprove?: boolean } {
  if (toolCall.hasExecution) return { allowed: false, reason: "already executed" };
  if (toolCall.approvalStatus === "REJECTED")
    return { allowed: false, reason: "tool call was rejected" };
  if (toolCall.approvalStatus === "APPROVED") return { allowed: true };
  // PENDING: low-risk auto-approves on execution; medium/high need approval.
  if (toolCall.riskLevel === "LOW") return { allowed: true, autoApprove: true };
  return {
    allowed: false,
    reason: `risk=${toolCall.riskLevel} requires approval`,
  };
}

async function recordAudit(
  toolCallId: string,
  emailId: string,
  action: "APPROVED" | "REJECTED" | "EXECUTED" | "EXECUTION_BLOCKED",
  actor: string,
  details?: Record<string, unknown>,
) {
  await prisma.auditLog.create({
    data: {
      toolCallId,
      emailId,
      action,
      actor,
      details: (details ?? {}) as never,
    },
  });
}

export async function approveToolCall(toolCallId: string, actor = "user") {
  const toolCall = await prisma.toolCall.findUnique({
    where: { id: toolCallId },
  });
  if (!toolCall) throw new Error("Tool call not found");

  const updated = await prisma.toolCall.update({
    where: { id: toolCallId },
    data: { approvalStatus: "APPROVED", approvedAt: new Date(), rejectionReason: null },
  });
  await recordAudit(toolCallId, toolCall.emailId, "APPROVED", actor);
  return updated;
}

export async function rejectToolCall(
  toolCallId: string,
  reason?: string,
  actor = "user",
) {
  const toolCall = await prisma.toolCall.findUnique({
    where: { id: toolCallId },
  });
  if (!toolCall) throw new Error("Tool call not found");

  const updated = await prisma.toolCall.update({
    where: { id: toolCallId },
    data: { approvalStatus: "REJECTED", rejectionReason: reason ?? null },
  });
  await recordAudit(toolCallId, toolCall.emailId, "REJECTED", actor, { reason });
  return updated;
}

export async function executeSingleToolCall(toolCallId: string, actor = "user") {
  const toolCall = await prisma.toolCall.findUnique({
    where: { id: toolCallId },
    include: { execution: true },
  });

  if (!toolCall) {
    throw new Error("Tool call not found");
  }

  if (toolCall.execution) {
    return toolCall.execution;
  }

  // HITL gate (REQ-4.2) — single source of truth is canExecuteToolCall().
  const gate = canExecuteToolCall({
    approvalStatus: toolCall.approvalStatus,
    riskLevel: toolCall.riskLevel,
    hasExecution: Boolean(toolCall.execution),
  });
  if (!gate.allowed) {
    await recordAudit(toolCall.id, toolCall.emailId, "EXECUTION_BLOCKED", actor, {
      reason: gate.reason,
    });
    throw new Error(
      gate.reason === "tool call was rejected"
        ? "Tool call was rejected and cannot be executed"
        : `Approval required before executing ${toolCall.toolName} (risk=${toolCall.riskLevel})`,
    );
  }

  if (gate.autoApprove) {
    await prisma.toolCall.update({
      where: { id: toolCall.id },
      data: { approvalStatus: "APPROVED", approvedAt: new Date() },
    });
    await recordAudit(toolCall.id, toolCall.emailId, "APPROVED", actor, {
      auto: true,
      reason: "low-risk auto-approval on execution",
    });
  }

  const result = simulateExecution(toolCall.toolName, toolCall.id);

  const execution = await prisma.toolExecution.create({
    data: {
      toolCallId: toolCall.id,
      executionResultJson: result,
    },
  });
  await recordAudit(toolCall.id, toolCall.emailId, "EXECUTED", actor, {
    toolName: toolCall.toolName,
  });
  return execution;
}

export async function executePendingToolCalls(actor = "user") {
  // Only approved-but-unexecuted calls run in batch. Rejected and
  // non-approved medium/high-risk calls are never auto-executed (REQ-4.2).
  const toolCalls = await prisma.toolCall.findMany({
    where: {
      execution: null,
      approvalStatus: "APPROVED",
    },
  });

  console.log(`Found ${toolCalls.length} approved tool calls to execute`);

  let executed = 0;
  let failed = 0;
  for (const toolCall of toolCalls) {
    try {
      const result = simulateExecution(toolCall.toolName, toolCall.id);

      await prisma.toolExecution.create({
        data: {
          toolCallId: toolCall.id,
          executionResultJson: result,
        },
      });
      await recordAudit(toolCall.id, toolCall.emailId, "EXECUTED", actor, {
        toolName: toolCall.toolName,
        batch: true,
      });

      executed++;
      console.log(`Executed tool: ${toolCall.toolName}`);
    } catch (error) {
      failed++;
      console.error(`Failed executing tool call: ${toolCall.id}`);
    }
  }
  return { executed, failed, total: toolCalls.length };
}
