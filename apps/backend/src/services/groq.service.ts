import Groq from "groq-sdk";
import { parseEmailBody, parseSubject } from "../utils/email-parser";
import {
  parseOrchestrationResult,
  type OrchestrationResult,
} from "../utils/orchestration-schema";
import { withRetry, isRetryableError } from "../utils/retry";

const groqSdkMissingKeyHint =
  "Groq authentication failed — set a valid GROQ_API_KEY in apps/backend/.env (see https://console.groq.com/keys).";

/** Lazily build the client so importing this module never crashes (tests, CLI). */
function getGroqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      `${groqSdkMissingKeyHint} Cause: The GROQ_API_KEY environment variable is missing or empty`,
    );
  }
  return new Groq({ apiKey });
}

// Default model (overridable via GROQ_MODEL).
// NOTE (Sep 2026): Groq shut down `llama-3.3-70b-versatile` on 16 Aug 2026
// for free/developer tiers (see https://console.groq.com/docs/deprecations).
// `openai/gpt-oss-120b` is Groq's recommended Production-tier replacement:
// 131K context, JSON modes, ~500 t/s.
export const DEFAULT_MODEL = "openai/gpt-oss-120b";

export function resolveModel(): string {
  return process.env.GROQ_MODEL || DEFAULT_MODEL;
}

function buildPrompt(subject: string, body: string): string {
  // Body is already parsed/truncated by parseEmailBody (REQ-1.3: 4000 chars).
  return `You are an AI email triage assistant acting as a routing agent.

Analyze the email carefully and output a routing decision as strict JSON.

Available tool calls (intent MUST map to one or more of these):
- schedule_meeting
- draft_response
- escalate_to_manager
- create_task
- flag_urgent
- archive_no_action

Categories: MEETING, URGENT, TASK, FOLLOW_UP, INFORMATIONAL, ESCALATION, NEWSLETTER, ACTION_REQUIRED, UNCLASSIFIED
Priorities: CRITICAL, HIGH, MEDIUM, LOW

Return ONLY valid JSON in this exact shape (no markdown, no commentary):
{
  "category": "TASK",
  "priority": "HIGH",
  "intent": "short operational intent, e.g. 'request deadline extension'",
  "summary": "one-sentence summary of what the email needs",
  "confidence": 0.85,
  "toolCalls": [
    {
      "toolName": "create_task",
      "rationale": "Reason for choosing this tool",
      "arguments": { "subject": "Task subject" }
    }
  ]
}

Rules:
- Always return at least one tool call; multiple allowed.
- priority CRITICAL only for outages, safety, legal threats, or explicit ASAP deadlines.
- confidence must be a number between 0 and 1.
- Return ONLY valid JSON.

Email Subject:
${subject}

Email Body:
${body}`;
}

/**
 * Map raw Groq SDK failures to actionable errors (pure, unit-testable).
 * Never swallows the underlying message — the previous generic
 * "Failed communicating with Groq AI service" hid a model shutdown.
 */
export function mapGroqError(error: unknown, model: string): Error {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();

  if (
    lower.includes("missing credentials") ||
    lower.includes("api key") ||
    lower.includes("apikey") ||
    lower.includes("unauthorized") ||
    lower.includes("401") ||
    lower.includes("invalid_api_key")
  ) {
    return new Error(
      `Groq authentication failed — set a valid GROQ_API_KEY in apps/backend/.env (see https://console.groq.com/keys). Cause: ${message}`,
    );
  }

  if (
    lower.includes("model_decommissioned") ||
    lower.includes("decommissioned") ||
    lower.includes("model_not_found") ||
    lower.includes("does not exist") ||
    (lower.includes("404") && lower.includes(model.toLowerCase()))
  ) {
    return new Error(
      `Groq model "${model}" is unavailable (retired or unknown). ` +
        `Set GROQ_MODEL to a current Production model from https://console.groq.com/docs/models ` +
        `(e.g. "${DEFAULT_MODEL}"). Cause: ${message}`,
    );
  }

  if (
    lower.includes("429") ||
    lower.includes("rate_limit") ||
    lower.includes("rate limit")
  ) {
    return new Error(
      `Groq API rate limit reached. Please retry later. (${message})`,
    );
  }

  return new Error(`Groq request failed: ${message}`);
}

/** Retryable = transient network/rate-limit faults, never config errors. */
export function isGroqRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  if (
    lower.includes("authentication failed") ||
    lower.includes("is unavailable (retired or unknown)")
  ) {
    return false; // mapped config errors: retrying is pointless
  }
  return isRetryableError(error);
}

export async function classifyEmail(
  subject: string,
  body: string,
): Promise<OrchestrationResult> {
  const cleanSubject = parseSubject(subject);
  const truncatedBody = parseEmailBody(body);
  const model = resolveModel();
  const groq = getGroqClient(); // fail fast before any retry budget is spent

  const content = await withRetry(
    async () => {
      try {
        const completion = await groq.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content:
                "You are a structured email triage AI. Return ONLY valid JSON.",
            },
            { role: "user", content: buildPrompt(cleanSubject, truncatedBody) },
          ],
          temperature: 0.2,
        });

        const text = completion.choices[0]?.message?.content;
        if (!text) throw new Error("Empty Groq response");
        return text;
      } catch (error: unknown) {
        throw mapGroqError(error, model);
      }
    },
    {
      maxAttempts: Number(process.env.LLM_MAX_RETRIES || 4),
      baseDelayMs: Number(process.env.LLM_RETRY_BASE_MS || 1000),
      isRetryable: isGroqRetryable,
    },
  );

  let parsedJson: unknown;
  try {
    const cleaned = content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    parsedJson = JSON.parse(cleaned);
  } catch {
    console.error("Failed parsing Groq response:", content);
    throw new Error("Invalid JSON response from AI model");
  }

  // Strict validation (REQ-2.1): throws on unknown tools / missing fields.
  return parseOrchestrationResult(parsedJson);
}
