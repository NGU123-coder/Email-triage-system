import { describe, it, expect } from "vitest";
import {
  canExecuteToolCall,
  simulateExecutionResult,
} from "../../services/tool-executor.service";

describe("HITL execution gate (REQ-4.2)", () => {
  it("allows approved tool calls", () => {
    expect(
      canExecuteToolCall({
        approvalStatus: "APPROVED",
        riskLevel: "HIGH",
        hasExecution: false,
      }).allowed,
    ).toBe(true);
  });

  it("blocks rejected tool calls", () => {
    const out = canExecuteToolCall({
      approvalStatus: "REJECTED",
      riskLevel: "LOW",
      hasExecution: false,
    });
    expect(out.allowed).toBe(false);
  });

  it("blocks pending medium/high-risk calls until approval", () => {
    expect(
      canExecuteToolCall({
        approvalStatus: "PENDING",
        riskLevel: "HIGH",
        hasExecution: false,
      }).allowed,
    ).toBe(false);
    expect(
      canExecuteToolCall({
        approvalStatus: "PENDING",
        riskLevel: "MEDIUM",
        hasExecution: false,
      }).allowed,
    ).toBe(false);
  });

  it("auto-approves pending low-risk calls on execution", () => {
    const out = canExecuteToolCall({
      approvalStatus: "PENDING",
      riskLevel: "LOW",
      hasExecution: false,
    });
    expect(out).toEqual({ allowed: true, autoApprove: true });
  });

  it("blocks re-execution", () => {
    expect(
      canExecuteToolCall({
        approvalStatus: "APPROVED",
        riskLevel: "LOW",
        hasExecution: true,
      }).allowed,
    ).toBe(false);
  });
});

describe("simulateExecutionResult (deterministic)", () => {
  it("returns stable ids per tool", () => {
    expect(simulateExecutionResult("create_task", "abc")).toEqual({
      success: true,
      taskId: "task_abc",
    });
    expect(simulateExecutionResult("archive_no_action", "abc").success).toBe(
      true,
    );
  });
});
