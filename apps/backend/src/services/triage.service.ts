import prisma from "../config/prisma";

import { ProcessingStatus } from "@prisma/client";

import { classifyEmail } from "./groq.service";
import { riskLevelForPriority } from "../utils/orchestration-schema";

// Configurable batch size (NFR: Scalability) — env override, default 5.
export const BATCH_SIZE = Number(process.env.TRIAGE_BATCH_SIZE || 5);

export async function triageEmail(emailId: string) {
  const email = await prisma.email.findUnique({
    where: { id: emailId },
  });

  if (!email) {
    throw new Error("Email not found");
  }

  // classifyEmail validates strict JSON via zod (throws on invalid tools).
  const result = await classifyEmail(email.subject, email.body);

  const riskLevel = riskLevelForPriority(result.priority);

  for (const toolCall of result.toolCalls) {
    await prisma.toolCall.create({
      data: {
        emailId: email.id,
        toolName: toolCall.toolName,
        rationale: toolCall.rationale,
        argumentsJson: (toolCall.arguments || {}) as never,
        riskLevel,
        approvalStatus: "PENDING",
      },
    });

    console.log(`AI selected ${toolCall.toolName} for email: ${email.subject}`);
  }

  // Persist triage insights + lineage: ingested -> analyzed -> pending_approval.
  await prisma.email.update({
    where: { id: email.id },
    data: {
      processingStatus: ProcessingStatus.COMPLETED,
      processingError: null,
      category: result.category,
      priority: result.priority,
      intent: result.intent,
      summary: result.summary,
      confidence: result.confidence,
      triagedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      emailId: email.id,
      action: "TRIAGED",
      actor: "ai-orchestrator",
      details: {
        category: result.category,
        priority: result.priority,
        intent: result.intent,
        confidence: result.confidence,
        toolCount: result.toolCalls.length,
      },
    },
  });
}

async function processSingleEmail(emailId: string) {
  try {
    await prisma.email.update({
      where: { id: emailId },
      data: { processingStatus: ProcessingStatus.PROCESSING },
    });

    await triageEmail(emailId);
  } catch (error) {
    console.error(`Failed processing email ${emailId}`, error);

    await prisma.email.update({
      where: { id: emailId },
      data: {
        processingStatus: ProcessingStatus.FAILED,
        processingError:
          error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

export async function processPendingEmails() {
  const pendingEmails = await prisma.email.findMany({
    where: { processingStatus: ProcessingStatus.PENDING },
  });

  console.log(`Found ${pendingEmails.length} pending emails`);

  // Parallel orchestration with bounded concurrency (NFR: rate-limit safety).
  for (let index = 0; index < pendingEmails.length; index += BATCH_SIZE) {
    const batch = pendingEmails.slice(index, index + BATCH_SIZE);

    console.log(`Processing batch ${index / BATCH_SIZE + 1}`);

    await Promise.all(batch.map((email) => processSingleEmail(email.id)));
  }
}
