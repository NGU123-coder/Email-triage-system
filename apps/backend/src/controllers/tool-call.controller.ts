import { Request, Response } from "express";

import prisma from "../config/prisma";

import {
  executePendingToolCalls,
  executeSingleToolCall,
  approveToolCall,
  rejectToolCall,
} from "../services/tool-executor.service";

export async function getToolCalls(_req: Request, res: Response) {
  try {
    const toolCalls = await prisma.toolCall.findMany({
      include: {
        email: true,
        execution: true,
      },

      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      success: true,
      count: toolCalls.length,
      data: toolCalls,
    });
  } catch (error) {
    console.error("Failed fetching tool calls", error);

    return res.status(500).json({
      success: false,
      message: "Failed fetching tool calls",
    });
  }
}

export async function executeSingleTool(req: Request, res: Response) {
  try {
    const id = req.params.id as string;

    const execution = await executeSingleToolCall(id);

    return res.status(200).json({
      success: true,
      data: execution,
    });
  } catch (error) {
    console.error("Failed executing tool", error);

    const message = error instanceof Error ? error.message : "Failed executing tool";
    const status = message.includes("Approval required") ? 403 : 500;
    return res.status(status).json({
      success: false,
      message,
    });
  }
}

export async function executeTools(_req: Request, res: Response) {
  try {
    const result = await executePendingToolCalls();

    return res.status(200).json({
      success: true,
      message: `Executed ${result.executed} approved tool call(s)` +
        (result.total - result.executed > 0
          ? `; ${result.total - result.executed} skipped/failed (pending approval or errors)`
          : ""),
      ...result,
    });
  } catch (error) {
    console.error("Failed executing tools", error);

    return res.status(500).json({
      success: false,
      message: "Failed executing tools",
    });
  }
}

/** Explicit HITL approval (REQ-4.2). */
export async function approveTool(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const data = await approveToolCall(id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Failed approving tool", error);
    return res.status(500).json({ success: false, message: "Failed approving tool" });
  }
}

/** Explicit HITL rejection with optional reason. */
export async function rejectTool(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const reason =
      typeof req.body?.reason === "string" ? req.body.reason : undefined;
    const data = await rejectToolCall(id, reason);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Failed rejecting tool", error);
    return res.status(500).json({ success: false, message: "Failed rejecting tool" });
  }
}

/**
 * Edit the AI-drafted arguments before execution (REQ-4.3).
 * e.g. user edits a draft_response body, then approves + executes.
 */
export async function updateToolArguments(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    if (!req.body || typeof req.body.arguments !== "object") {
      return res.status(400).json({
        success: false,
        message: "Body must contain an 'arguments' object",
      });
    }
    const existing = await prisma.toolCall.findUnique({
      where: { id },
      include: { execution: true },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Tool call not found" });
    }
    if (existing.execution) {
      return res.status(409).json({
        success: false,
        message: "Cannot edit arguments after execution",
      });
    }
    const data = await prisma.toolCall.update({
      where: { id },
      data: { argumentsJson: req.body.arguments },
    });
    await prisma.auditLog.create({
      data: {
        toolCallId: id,
        emailId: existing.emailId,
        action: "TRIAGED",
        actor: "user",
        details: { editedArguments: true },
      },
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Failed updating tool arguments", error);
    return res.status(500).json({ success: false, message: "Failed updating tool" });
  }
}
