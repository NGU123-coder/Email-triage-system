import { describe, it, expect } from "vitest";
import {
  parseOrchestrationResult,
  riskLevelForPriority,
} from "../orchestration-schema";

const valid = {
  category: "TASK",
  priority: "HIGH",
  intent: "review the contract",
  summary: "Client asked for contract review.",
  confidence: 0.9,
  toolCalls: [
    {
      toolName: "create_task",
      rationale: "Needs tracked work",
      arguments: { subject: "Review contract" },
    },
  ],
};

describe("parseOrchestrationResult (REQ-2.1/2.2/2.3)", () => {
  it("accepts a valid routing decision", () => {
    const out = parseOrchestrationResult(valid);
    expect(out.toolCalls).toHaveLength(1);
    expect(out.priority).toBe("HIGH");
  });

  it("applies defaults for optional triage fields", () => {
    const out = parseOrchestrationResult({
      intent: "x",
      toolCalls: [{ toolName: "flag_urgent", rationale: "r" }],
    });
    expect(out.category).toBe("UNCLASSIFIED");
    expect(out.priority).toBe("MEDIUM");
  });

  it("rejects unknown tool names", () => {
    expect(() =>
      parseOrchestrationResult({
        ...valid,
        toolCalls: [{ toolName: "send_nukes", rationale: "r" }],
      }),
    ).toThrow(/Invalid AI orchestration output/);
  });

  it("rejects empty tool calls", () => {
    expect(() =>
      parseOrchestrationResult({ ...valid, toolCalls: [] }),
    ).toThrow();
  });

  it("rejects out-of-range confidence", () => {
    expect(() =>
      parseOrchestrationResult({ ...valid, confidence: 5 }),
    ).toThrow();
  });

  it("rejects missing intent", () => {
    expect(() =>
      parseOrchestrationResult({ ...valid, intent: "" }),
    ).toThrow();
  });
});

describe("riskLevelForPriority", () => {
  it("maps CRITICAL->HIGH, HIGH->MEDIUM, rest->LOW", () => {
    expect(riskLevelForPriority("CRITICAL")).toBe("HIGH");
    expect(riskLevelForPriority("HIGH")).toBe("MEDIUM");
    expect(riskLevelForPriority("MEDIUM")).toBe("LOW");
    expect(riskLevelForPriority("LOW")).toBe("LOW");
  });
});
