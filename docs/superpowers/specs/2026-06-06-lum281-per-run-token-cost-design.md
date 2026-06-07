# LUM-281 — Capture per-run token/loop cost onto Run/Session

**Status:** Design approved
**Date:** 2026-06-06
**Milestone:** Context Lineage (System of Record) — gap (D)

## Problem

The Context Lineage milestone makes the **edge** (`LineageEdge`: which context fragment → which run → what outcome + how much it cost) the core asset. Gap (D) is the cost dimension: a run's token/loop cost is never captured, so an edge can never be joined to "this merged PR ← 12k token / 3 loops". Cost not captured at run time is permanently unbillable — every uncaptured run is lost forever, so capture must land early.

DoD ④ for the milestone: an edge can join to **its run's token/loop cost**.

## Current state (verified)

Two distinct "run" concepts, **neither has any cost field today**:

|                         | AgentRun (cloud sandbox agent)                                                                                                                                                   | Session (local Claude Code CLI)                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Existing cost fields    | none — only `durationMs`, `steps` (7 fixed pipeline stages, not loops)                                                                                                           | none — only `eventCount` (every hook +1)                                                            |
| Token data availability | **available but discarded** — `claude --output-format stream-json` emits a final `result` message with `usage`, `num_turns`, `total_cost_usd`; stdout is logged, never persisted | **not in hook payloads** — the STOP payload carries no tokens; the transcript JSONL does (verified) |
| Loop/turn count         | `num_turns` in the stream-json `result`                                                                                                                                          | STOP/STOP_FAILURE event count (proxy)                                                               |

Empirical confirmation (real transcript on this machine, 398/398 assistant lines): every assistant entry has `message.usage` with `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`. No per-entry `cost_usd` exists — USD must be derived from tokens × price, so we store **raw tokens only**.

Relevant write points:

- `AgentRun`: `lib/agent/run-lifecycle.ts` (`createAgentRun`, `markRunCompleted` @ line 86), executed from `agent-server/src/agent/execute.ts` (foreground) and `lib/agent/pipeline.ts` (background → `/api/agent/sandbox-done`).
- `Session`: `cli/src/lib/hook-runner.ts` (forwards hook payloads), `lib/services/hook-event.service.ts` + `lib/repositories/session.repository.ts` (`upsertForHookEvent`, increments `eventCount`).
- `LineageEdge` (`prisma/schema.prisma`): already has nullable `runId`/`sessionId` and `run`/`session` relations.

## Decisions

- **Scope:** capture cost for both AgentRun and Session.
- **Unit:** raw token counts (input/output/cache-read/cache-creation) + loop count. **No USD** — model pricing drifts, USD belongs to the billing UI (next milestone, out of scope).

## Design

### 1. Data model

Add the **same nullable fields** to both `AgentRun` and `Session` so the aggregation layer joins through a uniform shape:

```prisma
inputTokens          Int?
outputTokens         Int?
cacheReadTokens      Int?
cacheCreationTokens  Int?
loopCount            Int?   // turn/loop count
```

Nullable because historical rows have nothing, failed/timed-out runs may lack a result, and capture is best-effort. Migration is purely additive (new columns) → safe. Author offline via `prisma migrate diff` (parallel-branch dev-DB drift; `reset` forbidden). PR description must note prod needs `migrate deploy`.

### 2. AgentRun capture (cloud sandbox)

New stream-json `result` parser (pure function, defensive):

- Input: accumulated claude stdout (stream-json lines).
- Output: `{ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, loopCount } | null` — parse the last `type: "result"` line; map `usage.*` and `num_turns → loopCount`. Returns null if no result line (crash/timeout).

Wire-in at both execution paths:

- **agent-server foreground** (`agent-server/src/agent/execute.ts`): accumulate stdout via the existing `onStdout` callback; parse on completion.
- **client background pipeline** (`lib/agent/pipeline.ts`): the callback script parses `/tmp/agent-stdout.log` for the result and adds token/loop fields to the `/api/agent/sandbox-done` payload; the route forwards them.

Persist in `markRunCompleted(runId, { …, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, loopCount })`. Missing result → fields stay null.

### 3. Session capture (local CLI)

- On STOP, the CLI reads `transcript_path` from the hook payload and sums `message.usage` across all assistant entries → **cumulative session totals** (`cli/src/lib/hook-runner.ts`).
- The CLI adds these cumulative totals to the forwarded hook payload.
- The server **overwrites** the Session token columns with the cumulative values on upsert (idempotent, resilient to dropped events — cumulative, not incremental).
- `loopCount` on Session: server increments it on STOP/STOP_FAILURE (parallel to `eventCount`, but STOP-only = turn count).
- Transcript missing/unreadable/unparseable → skip token capture, **never block the hook** (best-effort).

### 4. Aggregation-layer exposure (LineageEdge join)

A mapper `getEdgeCost(edge)` (lib/repositories or lib/services, alongside lineage): if `runId` present, take AgentRun cost; else take Session cost. Returns the uniform `{ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, loopCount }`. This is the DoD ④ exit consumed by LUM-275 lineage readers.

### 5. Error handling / edge cases

- `transcript_path` absent or file unreadable → no Session token write; hook still succeeds.
- stream-json `result` absent → AgentRun token fields null.
- Long-transcript parse cost on each STOP is acceptable (parse is fast for realistic sizes); revisit if it becomes a hot path.
- No backfill of historical runs/sessions — capture is going-forward only (accepted per milestone framing).

### 6. Testing

- transcript usage summation: fixture JSONL → expected cumulative totals (CLI unit test).
- stream-json result parser: fixture stdout → expected tokens/loopCount; result-missing → null (defensive).
- `markRunCompleted` persists token fields; session upsert overwrites cumulative tokens and increments `loopCount` on STOP.
- `getEdgeCost`: run-first / session-fallback selection.

### 7. Out of scope (YAGNI)

USD conversion + price table, billing UI (next milestone), historical backfill, OpenTelemetry path (separate infra, doesn't fit Lumo's per-run DB model).

## Cross-cutting notes

- CLI change (#3) → per CLAUDE.md, bump `cli/package.json` (feat → minor) + `npm publish` after merge; SKILL.md only needs updating if `cli/src/commands/` changes (this touches `cli/src/lib/`, so likely not).
- i18n: no new user-facing strings expected (backend/data only).
