import { describe, it, expect, vi } from "vitest";
import {
  withRetry,
  isRetryableError,
  computeBackoffDelay,
} from "../retry";

describe("isRetryableError", () => {
  it("detects rate limits as retryable", () => {
    expect(isRetryableError(new Error("429 Too Many Requests"))).toBe(true);
    expect(
      isRetryableError(new Error("Groq API rate limit reached")),
    ).toBe(true);
  });

  it("treats validation errors as non-retryable", () => {
    expect(isRetryableError(new Error("Invalid JSON response"))).toBe(false);
  });
});

describe("computeBackoffDelay", () => {
  it("grows exponentially and respects the cap", () => {
    const d1 = computeBackoffDelay(1, 1000, 30000);
    const d3 = computeBackoffDelay(3, 1000, 30000);
    expect(d3).toBeGreaterThan(d1);
    expect(computeBackoffDelay(20, 1000, 30000)).toBeLessThanOrEqual(30000);
  });
});

describe("withRetry (NFR: Resilience)", () => {
  it("retries transient failures then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 rate limit"))
      .mockRejectedValueOnce(new Error("503 busy"))
      .mockResolvedValue("ok");
    const out = await withRetry(fn, {
      maxAttempts: 4,
      baseDelayMs: 1,
      maxDelayMs: 5,
    });
    expect(out).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Invalid JSON response"));
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 }),
    ).rejects.toThrow("Invalid JSON");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws the last error after exhausting attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("429 busy"));
    await expect(
      withRetry(fn, { maxAttempts: 2, baseDelayMs: 1 }),
    ).rejects.toThrow("429");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
