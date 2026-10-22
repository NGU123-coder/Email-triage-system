/**
 * Email parsing utilities (REQ-1.3).
 *
 * Strips HTML, removes signatures / quoted replies, normalises whitespace,
 * and aggressively truncates the payload to exactly MAX_BODY_CHARS (4000)
 * before it is sent to the LLM. Pure functions — safe to unit test and
 * cheap enough to meet the <50ms local-parsing budget.
 *
 * Production note (SRD §2): the hot path here is intentionally dependency-
 * free string scanning so it can be ported 1:1 to a C++ pybind11 extension
 * if CPU profiling ever justifies it. No behaviour change would be needed
 * on the caller side.
 */

export const MAX_BODY_CHARS = 4000;

const SIGNATURE_DELIMITERS = [
  /^--\s*$/m, // standard "-- " signature cut
  /^__+$/m,
  /^Best regards[,\s]*$/gim,
  /^Kind regards[,\s]*$/gim,
  /^Regards[,\s]*$/gim,
  /^Thanks[,\s]*$/gim,
  /^Thank you[,\s]*$/gim,
  /^Sent from my /gim,
  /^Get Your Private, Free E-mail from /gim,
];

const QUOTED_REPLY_PATTERNS = [
  /^-{10,}\s*Forwarded by[\s\S]*$/gim,
  /^On .* wrote:[\s\S]*$/gim,
  /^_{2,}Original Message_{2,}[\s\S]*$/gim,
];

/** Remove HTML tags while preserving rough line breaks. */
export function stripHtml(input: string): string {
  if (!input) return "";
  return (
    input
      // <br>/<p>/<div>/<li>/<tr> -> newline before dropping tags
      .replace(/<(br|p|div|li|tr|h[1-6])[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  );
}

/** Cut signatures and forwarded/quoted history, keeping the newest content. */
export function stripSignatureAndQuotes(input: string): string {
  if (!input) return "";
  let text = input;
  for (const pattern of QUOTED_REPLY_PATTERNS) {
    text = text.replace(pattern, "").trim();
  }
  // Cut at the first signature delimiter line.
  const lines = text.split("\n");
  const cutIndex = lines.findIndex((line) =>
    SIGNATURE_DELIMITERS.some((re) => {
      re.lastIndex = 0;
      return re.test(line.trim());
    }),
  );
  if (cutIndex > 0) {
    text = lines.slice(0, cutIndex).join("\n");
  }
  return text.trim();
}

/** Collapse whitespace/newlines into a single-space normalised string. */
export function normaliseWhitespace(input: string): string {
  return input.replace(/\r/g, "").replace(/\s+/g, " ").trim();
}

/** Truncate to exactly `max` chars (default 4000). Never pads. */
export function truncateBody(input: string, max = MAX_BODY_CHARS): string {
  if (input.length <= max) return input;
  return input.slice(0, max);
}

/**
 * Full pipeline: HTML -> signature/quote strip -> whitespace normalise ->
 * truncate. This is what MUST be called before any LLM call (REQ-1.3).
 */
export function parseEmailBody(rawBody: string, max = MAX_BODY_CHARS): string {
  const noHtml = stripHtml(rawBody ?? "");
  const noSig = stripSignatureAndQuotes(noHtml);
  const clean = normaliseWhitespace(noSig);
  return truncateBody(clean, max);
}

/** Lightweight subject clean-up (used by ingestion + orchestration). */
export function parseSubject(rawSubject: string): string {
  return normaliseWhitespace(stripHtml(rawSubject ?? "")).slice(0, 500);
}
