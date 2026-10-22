import { Request, Response } from "express";
import { z } from "zod";

import prisma from "../config/prisma";

import { processPendingEmails, triageEmail } from "../services/triage.service";

import { ProcessingStatus } from "@prisma/client";
import {
  EMAIL_CATEGORIES,
  EMAIL_PRIORITIES,
} from "../utils/orchestration-schema";

const OverrideSchema = z.object({
  category: z.enum(EMAIL_CATEGORIES).optional(),
  priority: z.enum(EMAIL_PRIORITIES).optional(),
  intent: z.string().max(500).optional(),
});

/**
 * Prioritized queue (REQ-4.1): CRITICAL first, then HIGH/MEDIUM/LOW,
 * newest first within each band. Untriaged (null priority) sort last.
 */
function sortPrioritized<T extends { priority?: string | null; date: Date }>(
  emails: T[],
): T[] {
  const rank: Record<string, number> = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  };
  return [...emails].sort((a, b) => {
    const ra = a.priority ? (rank[a.priority] ?? 4) : 4;
    const rb = b.priority ? (rank[b.priority] ?? 4) : 4;
    if (ra !== rb) return ra - rb;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });
}

export async function getEmails(req: Request, res: Response) {
  try {
    const { search, tool, priority, status } = req.query as Record<
      string,
      string | undefined
    >;

    const emails = await prisma.email.findMany({
      where: {
        ...(status ? { processingStatus: status as ProcessingStatus } : {}),
        ...(priority ? { priority: priority as never } : {}),
      },
      include: {
        toolCalls: { include: { execution: true } },
      },
    });

    let result = emails;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.from.toLowerCase().includes(q) ||
          e.subject.toLowerCase().includes(q),
      );
    }
    if (tool) {
      result = result.filter((e) =>
        e.toolCalls.some((t) => t.toolName === tool),
      );
    }

    res.json({
      success: true,
      count: result.length,
      data: sortPrioritized(result),
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed fetching emails",
    });
  }
}

export async function getEmailById(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const email = await prisma.email.findUnique({
      where: { id },
      include: {
        toolCalls: { include: { execution: true } },
        auditLogs: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!email) {
      return res
        .status(404)
        .json({ success: false, message: "Email not found" });
    }
    return res.json({ success: true, data: email });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, message: "Failed fetching email" });
  }
}

/**
 * Human override (REQ-4.3): user may correct category/priority/intent
 * before final execution. Recorded in the audit trail.
 */
export async function overrideEmail(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const parsed = OverrideSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid override payload",
        issues: parsed.error.issues,
      });
    }
    const email = await prisma.email.findUnique({ where: { id } });
    if (!email) {
      return res
        .status(404)
        .json({ success: false, message: "Email not found" });
    }
    const updated = await prisma.email.update({
      where: { id },
      data: { ...parsed.data },
      include: { toolCalls: { include: { execution: true } } },
    });
    await prisma.auditLog.create({
      data: {
        emailId: id,
        action: "TRIAGED",
        actor: "user",
        details: { override: parsed.data },
      },
    });
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, message: "Failed overriding email" });
  }
}

export async function processEmails(req: Request, res: Response) {
  try {
    await processPendingEmails();

    res.json({
      success: true,
      message: "Email processing started",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed processing emails",
    });
  }
}

export async function processSingleEmail(req: Request, res: Response) {
  try {
    const id = req.params.id as string;

    const email = await prisma.email.findUnique({
      where: {
        id,
      },
    });

    if (!email) {
      return res.status(404).json({
        success: false,
        message: "Email not found",
      });
    }

    await prisma.email.update({
      where: {
        id,
      },
      data: {
        processingStatus: ProcessingStatus.PROCESSING,
        processingError: null,
      },
    });

    try {
      await triageEmail(id);

      const updatedEmail = await prisma.email.findUnique({
        where: {
          id,
        },
        include: {
          toolCalls: {
            include: {
              execution: true,
            },
          },
        },
      });

      return res.json({
        success: true,
        message: "Email processed successfully",
        data: updatedEmail,
      });
    } catch (error) {
      await prisma.email.update({
        where: {
          id,
        },
        data: {
          processingStatus: ProcessingStatus.FAILED,
          processingError:
            error instanceof Error ? error.message : "Unknown error",
        },
      });

      return res.status(500).json({
        success: false,
        message:
          error instanceof Error ? error.message : "Failed processing email",
      });
    }
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed processing email",
    });
  }
}

export async function retryFailedEmail(req: Request, res: Response) {
  try {
    const id = req.params.id as string;

    const email = await prisma.email.findUnique({
      where: {
        id,
      },
    });

    if (!email) {
      return res.status(404).json({
        success: false,
        message: "Email not found",
      });
    }

    await prisma.toolCall.deleteMany({
      where: {
        emailId: id,
      },
    });

    await prisma.email.update({
      where: {
        id,
      },
      data: {
        processingStatus: ProcessingStatus.PENDING,
        processingError: null,
      },
    });

    await prisma.auditLog.create({
      data: { emailId: id, action: "RETRIED", actor: "user" },
    });

    res.json({
      success: true,
      message: "Email reset for retry",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed retrying email",
    });
  }
}
