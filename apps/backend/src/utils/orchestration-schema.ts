import { z } from "zod";

/**
 * Strict validation for the AI routing decision (REQ-2.1 / REQ-2.2 / REQ-2.3).
 * Every LLM output MUST parse against OrchestrationResultSchema before any
 * ToolCall row is persisted. Rejects unknown tools, empty tool lists, and
 * out-of-range confidence scores.
 */

export const TOOL_NAMES = [
  "schedule_meeting",
  "draft_response",
  "escalate_to_manager",
  "create_task",
  "flag_urgent",
  "archive_no_action",
] as const;

export const EMAIL_CATEGORIES = [
  "MEETING",
  "URGENT",
  "TASK",
  "FOLLOW_UP",
  "INFORMATIONAL",
  "ESCALATION",
  "NEWSLETTER",
  "ACTION_REQUIRED",
  "UNCLASSIFIED",
] as const;

export const EMAIL_PRIORITIES = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
] as const;

export const ToolCallSchema = z.object({
  toolName: z.enum(TOOL_NAMES),
  rationale: z.string().min(1, "rationale is required").max(2000),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

export const OrchestrationResultSchema = z.object({
  category: z.enum(EMAIL_CATEGORIES).default("UNCLASSIFIED"),
  priority: z.enum(EMAIL_PRIORITIES).default("MEDIUM"),
  intent: z.string().min(1, "intent is required").max(500),
  summary: z.string().max(1000).default(""),
  confidence: z.number().min(0).max(1).default(0.5),
  toolCalls: z.array(ToolCallSchema).min(1, "at least one tool call required"),
});

export type OrchestrationResult = z.infer<typeof OrchestrationResultSchema>;
export type ValidToolName = (typeof TOOL_NAMES)[number];

/** Parse + throw a descriptive error on invalid LLM JSON. */
export function parseOrchestrationResult(json: unknown): OrchestrationResult {
  const parsed = OrchestrationResultSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid AI orchestration output: ${issues}`);
  }
  return parsed.data;
}

/** Map email priority -> HITL risk level for the approval gate. */
export function riskLevelForPriority(
  priority: (typeof EMAIL_PRIORITIES)[number],
): "LOW" | "MEDIUM" | "HIGH" {
  switch (priority) {
    case "CRITICAL":
      return "HIGH";
    case "HIGH":
      return "MEDIUM";
    default:
      return "LOW";
  }
}
