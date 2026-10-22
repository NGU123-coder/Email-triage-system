# Design Document — Intelligent Email Triage Assistant

## 1. Purpose
This document records the architecture, key decisions, SRD traceability, and
operational guidance for the Email Triage Assistant. It is the companion to
`README.md` (setup/usage) and the zod/Prisma schemas (executable contracts).

## 2. Architecture

```text
CSV Upload (or future OAuth poller)
   ↓
Ingestion service (csv-ingestion.service.ts)
  · schema validation (required columns)
  · parseEmailBody: strip HTML → strip signatures/quotes → normalise → truncate 4000
  · replaces dataset on re-upload (documented demo behaviour)
   ↓
PostgreSQL-ready persistence (Prisma: Email / ToolCall / ToolExecution / AuditLog)
   ↓
AI orchestration (groq.service.ts + triage.service.ts)
  · structured prompt → strict JSON (category, priority, intent, summary,
    confidence, toolCalls[])
  · zod validation (orchestration-schema.ts) — unknown tools rejected
  · retry with exponential backoff + jitter (retry.ts)
  · bounded parallel batches (TRIAGE_BATCH_SIZE, default 5)
   ↓
Human-in-the-Loop dashboard (React/TS)
  · critical-first queue, triage badges, rationale inspection
  · approve / reject per tool call; edit draft arguments; override category/priority
   ↓
Gated execution (tool-executor.service.ts)
  · APPROVED-only batch execution; medium/high-risk single execution blocked (403)
    until approved; low-risk auto-approves on execution (audited)
  · deterministic mocked results; full AuditLog lineage
```

### 2.1 Module → file map
| SRD module | Implementation |
|---|---|
| 1. Ingestion & MIME parsing | `services/csv-ingestion.service.ts`, `utils/email-parser.ts` |
| 2. Multi-tool orchestration | `services/groq.service.ts`, `services/triage.service.ts`, `utils/orchestration-schema.ts`, `utils/retry.ts` |
| 3. Relational state | `prisma/schema.prisma`, `controllers/*`, `routes/*` |
| 4. HITL dashboard | `apps/frontend/src/pages/InboxPage.tsx`, `api/emailApi.ts` |

## 3. Stack adaptation (recorded decision)
The SRD specifies Python/FastAPI + C++ (pybind11) + HF Transformers +
PostgreSQL + React. The shipped implementation uses **Node/Express/TypeScript
+ Prisma + SQLite + Groq (OpenAI GPT-OSS 120B) + React**, already deployed
(frontend on Vercel, API on Render).

Rationale:
- The graded demo (CSV ingestion, orchestration, HITL, mocked execution) is
  fully working on this stack; a mid-review language rewrite would break
  deployment with no behavioural gain.
- All SRD *behaviours* are preserved: 4000-char truncation, strict JSON
  routing, six-tool allowlist, parallel batches, retry/backoff, relational
  lineage, approval-gated execution, prioritized queue, editable drafts.
- Migration path is explicit and low-risk:
  - **Postgres:** change `prisma/schema.prisma` datasource provider to
    `postgresql`, set `DATABASE_URL`, run `prisma migrate deploy`. Indexes
    (`Email[from, priority, processingStatus]`, `ToolCall[approvalStatus]`)
    are already declared for sub-second filtering.
  - **Python/FastAPI:** the service boundaries (ingest → orchestrate →
    approve → execute) map 1:1 to FastAPI routers; zod schemas become
    Pydantic models.
  - **C++ parsing:** `utils/email-parser.ts` is dependency-free string
    scanning precisely so it can be ported to a pybind11 extension later;
    callers (`csv-ingestion`, `groq.service`) already treat it as a black
    box. No caller change needed.
  - **OAuth ingestion:** add a poller service behind the same
    `parseEmailBody` + `triageEmail` entry points; never store passwords,
    only OAuth tokens (REQ-1.1). CSV remains as the offline/demo path.

## 4. SRD traceability
| Req | Status | Evidence |
|---|---|---|
| REQ-1.1 OAuth, no stored credentials | Partial (demo) | CSV path implemented; OAuth designed as drop-in poller (§3). No passwords stored anywhere. |
| REQ-1.2 Async polling | Partial (demo) | Batch orchestration is async/bounded; polling hook point documented. |
| REQ-1.3 Strip HTML/signatures, truncate exactly 4000 | Done | `utils/email-parser.ts` + tests; applied at ingestion AND pre-LLM. |
| REQ-2.1 Strict validated JSON | Done | `orchestration-schema.ts` (zod); invalid output throws, email marked FAILED. |
| REQ-2.2 Category/Priority/Intent/Suggested action | Done | Prompt requests all five fields; persisted on `Email`; shown in UI. |
| REQ-2.3 Intent → tool-call allowlist (6 tools) | Done | zod enum; `archive_no_action` etc. enforced. |
| REQ-3.1 Relational persistence of metadata/logs/queue | Done | `Email/ToolCall/ToolExecution/AuditLog` via Prisma. |
| REQ-3.2 Lineage ingested→analyzed→pending_approval→executed/archived | Done | `processingStatus` + `approvalStatus` + `AuditLog` (TRIAGED/APPROVED/REJECTED/EXECUTED/EXECUTION_BLOCKED/RETRIED). |
| REQ-4.1 Prioritized queue, critical first | Done | Backend `sortPrioritized` + frontend priority filter/badges. |
| REQ-4.2 No execution without explicit approval | Done | `canExecuteToolCall` gate; batch executes APPROVED only; 403 otherwise. |
| REQ-4.3 Edit draft / override categorization | Done | `PATCH /tool-calls/:id/arguments`, `PATCH /emails/:id/override`; UI editors. |
| NFR Scalability (parallel batches) | Done | `TRIAGE_BATCH_SIZE` (env), `Promise.all` per batch. |
| NFR Resilience (retry + backoff) | Done | `utils/retry.ts`, wired into Groq calls; FAILED + retry UI preserved. |
| NFR Latency (<50ms local parse) | Done by design | Dependency-free parser; vitest guards correctness (bench hook point). |

## 5. Data model & indexes
- `Email`: metadata + truncated body + triage insights
  (`category, priority, intent, confidence, summary, triagedAt`) +
  `processingStatus/processingError`. Indexes: `from`, `priority`,
  `processingStatus`, composite `(priority, processingStatus)` — the
  prioritized-queue query path.
- `ToolCall`: `toolName, rationale, argumentsJson, riskLevel` (derived from
  priority), `approvalStatus, approvedAt, rejectionReason`. Index:
  `approvalStatus` — the "pending approvals" queue.
- `ToolExecution`: one row per executed call, deterministic mocked JSON.
- `AuditLog`: append-only trail (`TRIAGED/APPROVED/REJECTED/EXECUTED/
  EXECUTION_BLOCKED/RETRIED`) with `emailId/toolCallId` indexes.

## 6. HITL security model
- State-changing execution requires `approvalStatus = APPROVED`.
- Batch `POST /tool-calls/execute` only touches APPROVED rows — rejected or
  pending medium/high-risk calls can never be swept up accidentally.
- Single execution of a pending medium/high-risk call returns **403** with
  "Approval required"; the block is audited (`EXECUTION_BLOCKED`).
- Rejected calls can never execute; edits to arguments are blocked after
  execution (409); every transition writes an `AuditLog` row with actor.
- Current demo is single-user (no auth) — production needs OIDC + per-user
  scoping + RBAC (approver vs viewer), noted in README futures.

## 7. Error handling & idempotency
- LLM failures (invalid JSON, rate limit after retries) → email FAILED with
  `processingError`; retry resets tool calls + audit-logs a RETRIED event.
- Re-execution is idempotent: existing `ToolExecution` is returned, never
  duplicated.
- CSV re-upload is a deliberate full replace (child tables cleared first,
  audit logs included) — predictable demo state.

## 8. Thread context (interview note, future)
Multiple emails in one thread are currently triaged independently. The
designed upgrade is a thread graph: group by normalized subject/thread-id,
topologically order by date, and prepend a compact thread summary + parent
intent to each child prompt so escalation decisions see full conversational
context. Schema already supports this (add nullable `threadId` + index);
no orchestration contract change needed beyond an extra prompt section.

## 9. Test strategy
- `vitest run` in `apps/backend`: pure-unit coverage of the load-bearing
  logic — parser/truncation (REQ-1.3), zod allowlist/defaults/rejections
  (REQ-2.x), backoff/retry behaviour (NFR), HITL gate matrix + deterministic
  execution (REQ-4.2). DB-backed services are intentionally excluded from
  unit scope; verify them via the API workflow (upload → process → approve
  → execute) against a scratch SQLite file.
- Frontend: manual HITL pass (approve → execute, reject → blocked 403,
  edit args → save, override → badge updates, priority filter + ordering).

## 10. Configuration
Backend env (see `apps/backend/.env.example`):
`DATABASE_URL, GROQ_API_KEY, GROQ_MODEL (default openai/gpt-oss-120b),
TRIAGE_BATCH_SIZE (default 5), LLM_MAX_RETRIES (default 4),
LLM_RETRY_BASE_MS (default 1000), PORT (default 4000)`.
Frontend env (see `apps/frontend/.env.example`): `VITE_API_BASE_URL`.

## 11. Model lifecycle (Groq)
The default model is `openai/gpt-oss-120b`, Groq's Production-tier
replacement after `llama-3.3-70b-versatile` was retired on 16 Aug 2026
([deprecations](https://console.groq.com/docs/deprecations)). Two guards
protect against the next retirement: the model ID is env-configurable
(`GROQ_MODEL`, no code change to switch), and `mapGroqError` in
`groq.service.ts` surfaces retired-model/auth failures as actionable
messages that fail fast (no wasted retries), while only transient
429/network faults use backoff. Track the
[Supported Models](https://console.groq.com/docs/models) page when
upgrading.
