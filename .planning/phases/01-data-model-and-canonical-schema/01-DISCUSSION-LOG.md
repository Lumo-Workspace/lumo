---
phase: 1
name: Data Model and Canonical Schema
slug: data-model-and-canonical-schema
mode: auto
created: 2026-04-10T17:50:22.251Z
---

# Phase 1 Discussion Log — Data Model and Canonical Schema

**Mode:** `--auto` (YOLO) — gray areas auto-resolved from research SUMMARY.md, ARCHITECTURE.md, and PITFALLS.md. No user interaction this phase.

## Gray Areas Identified

| #   | Area                                           | Candidates                                                                                                                                         |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `AgentSession` primary key identity            | (a) Use Claude Code's `session_id` as PK; (b) Lumo-owned CUID with `claudeSessionId` as correlation column                                         |
| 2   | `AgentSessionEvent` storage shape              | (a) Single table with `payload Json` discriminated by `kind`; (b) One table per event kind                                                         |
| 3   | Event ordering mechanism                       | (a) `createdAt` timestamp; (b) Monotonic `sequence` integer assigned client-side; (c) Postgres sequence generator                                  |
| 4   | Canonical payload union location               | (a) `shared/src/agent-session-events.ts` re-exported; (b) `lib/integrations/claude-code/types.ts`; (c) Duplicate in both main app and agent-server |
| 5   | RSC boundary layout                            | (a) Single-file module; (b) Barrel with client-safe + server-only submodule split per `b7bc170` lesson                                             |
| 6   | Workspace scoping strategy                     | (a) Traversal-only via `Task → Project → Workspace`; (b) Denormalize `workspaceId` onto `AgentSession` for O(1) auth checks                        |
| 7   | Zod `tool_response` vs `tool_result` tolerance | (a) Pick one field name now and require Phase 3 to conform; (b) Accept both via `.or()` until Phase 3 resolves live                                |
| 8   | Payload size enforcement layer                 | (a) Trim/truncate in Zod schema; (b) Reject oversized via `.max()` in Zod, truncate in hook runtime client-side                                    |
| 9   | Migration scope                                | (a) Additive only (new tables/enums); (b) Also refactor existing `Task` columns for cleaner FK                                                     |
| 10  | Token/bearer-token table creation timing       | (a) Create in Phase 1 alongside the session models; (b) Defer entirely to Phase 2                                                                  |

## Auto-Resolutions

### 1. Primary key → **(b) Lumo-owned CUID with `claudeSessionId` as correlation column**

**Rationale:** PITFALLS.md #4 documents that Claude Code's `session_id` is not stable across resumes and can differ between `/resume` invocations. REQUIREMENTS.md DATA-01 explicitly states "`claudeSessionId` (correlation-only, not primary key)". Lumo must own the ID it ferries into the launcher command via `--session-id`.

### 2. Event storage → **(a) Single table with `payload Json` discriminated by `kind`**

**Rationale:** ARCHITECTURE.md research recommends the single-table discriminated union. Per-kind tables would explode the schema, complicate the Sessions tab join (it would need 9 UNIONs), and double migration work on every new event kind. JSON storage with Zod-enforced shape is the standard discriminated-union pattern in Prisma.

### 3. Ordering → **(b) Monotonic `sequence` integer assigned client-side**

**Rationale:** PITFALLS.md #6 — `createdAt` timestamps are too coarse to disambiguate events in a single batch; client-side `sequence` gives deterministic ordering regardless of Postgres insert order. Postgres sequence generators break idempotency (a retried batch would generate new numbers). Client-side integer + `@@unique([sessionId, sequence])` is the Phase 1 + Phase 2 idempotency story.

### 4. Canonical payload location → **(a) `shared/src/agent-session-events.ts` re-exported from `shared/src/index.ts`**

**Rationale:** REQUIREMENTS.md DATA-03 explicitly mandates `shared/`. The existing `shared/src/index.ts` already exports domain events and is imported by both the main app and `agent-server/`; adding a sibling file preserves the existing import surface. `lib/integrations/claude-code/types.ts` re-exports from `shared/` (client-safe) for ergonomic main-app access.

### 5. RSC boundary → **(b) Barrel with client-safe + server-only submodule split per `b7bc170`**

**Rationale:** DATA-05 mandates it. The `b7bc170` lesson in the memory file is explicit: barrels that re-export server code leak it into the client bundle. Phase 1 enforces the correct structure from the first commit, including a test that asserts the boundary holds.

### 6. Workspace scoping → **(b) Denormalize `workspaceId` onto `AgentSession`**

**Rationale:** Phase 2's ingestion endpoint will perform workspace auth on every event batch POST. A join through `Task → Project → Workspace` on the hot path is avoidable; denormalization is the standard Lumo pattern (see how `Task` carries `projectId` and `teamId` together in the existing schema). Success criterion 1 requires the traversal path _also_ be traceable — both approaches coexist.

### 7. `tool_response` vs `tool_result` → **(b) Accept both via `.or()`**

**Rationale:** DATA-06 mandates it explicitly. SUMMARY.md flags this as a research gap to resolve in Phase 3 once the hook runtime can inspect live events. Over-constraining now blocks Phase 3; over-loosening is the acceptable temporary choice.

### 8. Payload size enforcement → **(b) Reject oversized via Zod `.max()`, truncate in hook runtime client-side**

**Rationale:** DATA-07 mandates reject, not trim. Trimming in the server schema masks client bugs (hooks sending 10MB of stdout silently become 4KB events). Truncation is the client's responsibility (HOOK-04, Phase 3); the server schema's job is to reject misbehaving clients loudly.

### 9. Migration scope → **(a) Additive only**

**Rationale:** PITFALLS.md #11 — `ALTER TABLE Task` under Neon production load risks a table lock. New enums + new tables + new indexes is the safe path. Any cross-table work is deferred to a later milestone when the foundation is proven.

### 10. Token table timing → **(b) Defer entirely to Phase 2**

**Rationale:** Phase 1's goal is the data model and canonical schema contract. Token storage is an ingestion-layer concern; bundling it into Phase 1 would blur the phase boundary. Phase 1's `token.ts` file is a skeleton that proves the server-only boundary holds — Phase 2 fills in the JWT logic and (if needed) the persistence table.

## Outcome

All 10 gray areas auto-resolved. CONTEXT.md written with full decision rationale. No open questions block Phase 1 planning. Phase 1 scope is precisely the four success criteria from the roadmap; nothing added, nothing removed.

**Next step:** `/gsd-plan-phase 1 --auto`
