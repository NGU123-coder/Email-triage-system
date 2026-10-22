import { describe, it, expect } from "vitest";
import {
  stripHtml,
  stripSignatureAndQuotes,
  normaliseWhitespace,
  truncateBody,
  parseEmailBody,
  parseSubject,
  MAX_BODY_CHARS,
} from "../email-parser";

describe("stripHtml", () => {
  it("removes tags and decodes common entities", () => {
    expect(stripHtml("<p>Hello&nbsp;&amp;&nbsp;world</p>")).toContain("Hello");
    expect(stripHtml("<p>Hello&nbsp;&amp;&nbsp;world</p>")).toContain("&");
    expect(stripHtml("<b>x</b>")).not.toContain("<");
  });

  it("handles empty input", () => {
    expect(stripHtml("")).toBe("");
  });
});

describe("stripSignatureAndQuotes", () => {
  it("cuts forwarded history", () => {
    const raw =
      "Please review ASAP\n---------------------- Forwarded by Someone on 10/09/2000 --- old stuff";
    expect(stripSignatureAndQuotes(raw)).toBe("Please review ASAP");
  });

  it("returns trimmed text when no signature present", () => {
    expect(stripSignatureAndQuotes("  hello  ")).toBe("hello");
  });
});

describe("normaliseWhitespace", () => {
  it("collapses newlines and spaces", () => {
    expect(normaliseWhitespace("a\n\n  b\r\n c")).toBe("a b c");
  });
});

describe("truncateBody (REQ-1.3)", () => {
  it("truncates payloads to exactly 4000 characters", () => {
    const long = "x".repeat(9000);
    expect(truncateBody(long)).toHaveLength(MAX_BODY_CHARS);
    expect(MAX_BODY_CHARS).toBe(4000);
  });

  it("leaves short bodies untouched", () => {
    expect(truncateBody("short")).toBe("short");
  });
});

describe("parseEmailBody pipeline", () => {
  it("strips HTML + signatures and bounds length", () => {
    const raw =
      "<p>Server is DOWN, fix ASAP</p><br>-- <br>John Doe, VP<br>---------------------- Forwarded by X --- old";
    const parsed = parseEmailBody(raw);
    expect(parsed).toContain("Server is DOWN");
    expect(parsed.length).toBeLessThanOrEqual(4000);
    expect(parsed).not.toContain("Forwarded by");
  });

  it("never exceeds 4000 chars on adversarial input", () => {
    const parsed = parseEmailBody("<p>" + "y".repeat(20000) + "</p>");
    expect(parsed.length).toBeLessThanOrEqual(4000);
  });
});

describe("parseSubject", () => {
  it("strips html and bounds length", () => {
    expect(parseSubject("<b>Hi</b>")).toBe("Hi");
    expect(parseSubject("a".repeat(900)).length).toBeLessThanOrEqual(500);
  });
});
