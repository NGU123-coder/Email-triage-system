/**
 * Retry helper with exponential backoff + jitter (NFR: Resilience).
 * Used by the LLM orchestration layer to survive 429s / timeouts.
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Return true if the error is retryable. Defaults to rate-limit/network detection. */
  isRetryable?: (error: unknown) => boolean;
}

export function isRetryableError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("rate_limit") ||
    lower.includes("rate limit") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("504") ||
    lower.includes("timeout") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ECONNRESET") ||
    lower.includes("fetch failed")
  );
}

export function computeBackoffDelay(
  attempt: number,
  baseDelayMs = 1000,
  maxDelayMs = 30000,
): number {
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  const jitter = Math.random() * baseDelayMs * 0.25;
  return Math.min(exponential + jitter, maxDelayMs);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run `fn` with retries. Re-throws the last error after maxAttempts. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 4,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    isRetryable = isRetryableError,
  } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isRetryable(error)) {
        throw error;
      }
      await sleep(computeBackoffDelay(attempt, baseDelayMs, maxDelayMs));
    }
  }
  throw lastError;
}
