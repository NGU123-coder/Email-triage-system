import { describe, it, expect } from "vitest";
import {
  mapGroqError,
  isGroqRetryable,
  resolveModel,
  classifyEmail,
  DEFAULT_MODEL,
} from "../../services/groq.service";

describe("groq model resolution", () => {
  it("defaults to a live Production model, not the retired llama-3.3", () => {
    expect(DEFAULT_MODEL).toBe("openai/gpt-oss-120b");
    expect(resolveModel()).toBe(DEFAULT_MODEL);
  });
});

describe("mapGroqError (no more masked failures)", () => {
  it("maps model shutdown to an actionable error naming the model", () => {
    const err = mapGroqError(
      new Error("The model `llama-3.3-70b-versatile` has been decommissioned (model_decommissioned)"),
      "llama-3.3-70b-versatile",
    );
    expect(err.message).toContain("llama-3.3-70b-versatile");
    expect(err.message).toContain("GROQ_MODEL");
    expect(err.message).toContain("model_decommissioned");
  });

  it("maps missing/invalid API keys to an actionable error", () => {
    const err = mapGroqError(
      new Error("401 Unauthorized: Invalid API Key"),
      DEFAULT_MODEL,
    );
    expect(err.message).toContain("GROQ_API_KEY");
    expect(err.message).toContain("401 Unauthorized");
  });

  it("keeps rate-limit errors recognizable for retry + UI", () => {
    const err = mapGroqError(new Error("429 rate_limit_exceeded"), DEFAULT_MODEL);
    expect(err.message).toMatch(/rate limit/i);
  });

  it("preserves unknown SDK messages instead of masking them", () => {
    const err = mapGroqError(new Error("weird upstream failure xyz"), DEFAULT_MODEL);
    expect(err.message).toContain("weird upstream failure xyz");
    expect(err.message).not.toBe("Failed communicating with Groq AI service");
  });
});

describe("classifyEmail without credentials", () => {
  it("fails fast with an actionable auth error (no network, no retries)", async () => {
    const saved = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      await expect(classifyEmail("hi", "hello")).rejects.toThrow("GROQ_API_KEY");
    } finally {
      if (saved !== undefined) process.env.GROQ_API_KEY = saved;
    }
  });
});

describe("isGroqRetryable", () => {
  it("does not burn retries on retired models", () => {
    const mapped = mapGroqError(
      new Error("model_decommissioned"),
      "llama-3.3-70b-versatile",
    );
    expect(isGroqRetryable(mapped)).toBe(false);
  });

  it("does not burn retries on auth failures", () => {
    const mapped = mapGroqError(new Error("401 Unauthorized"), DEFAULT_MODEL);
    expect(isGroqRetryable(mapped)).toBe(false);
  });

  it("still retries rate limits", () => {
    const mapped = mapGroqError(new Error("429 slow down"), DEFAULT_MODEL);
    expect(isGroqRetryable(mapped)).toBe(true);
  });
});
