# Project Research Summary

**Project:** Lumo — Agent Sessions milestone
**Domain:** Client-side Claude Code session capture + unified agent session tracking in an existing Next.js 14 PM tool
**Researched:** 2026-04-10
**Confidence:** HIGH (stack, architecture, pitfalls grounded in official docs and direct codebase inspection); MEDIUM (features, grounded in competitor analysis with some UX specifics inferred)

---

## Executive Summary

This milestone closes the visibility gap between where Claude does work (the user's terminal, inside Claude Code) and where that work is tracked (Lumo tasks). The core mechanism is straightforward: three Claude Code hooks (`SessionStart`, `PostToolUse`, `SessionEnd`) POST structured events to a new Lumo ingestion endpoint, which writes to two new Prisma models (`AgentSession`, `AgentSessionEvent`) and fans events out to the existing Pusher `task-{taskId}` channel. A new Sessions tab on the task page renders both client-side (Claude Code) and server-side (`agent-server`) sessions in a single interleaved timeline. No new infrastructure is required — Pusher, Clerk, Zod, and Node crypto already exist in the monorepo.

The recommended approach is to keep the hook transport as `"type": "http"` pointing directly at the Lumo ingestion API, with authentication via an ephemeral JWT minted at launcher time (15-minute TTL, scoped to a single `(sessionId, taskId, workspaceId)` tuple). The launcher is a "Copy CLI command" panel on the task page — not a `claude://` deep-link, whose parameter support is insufficiently documented for v1. The Sessions tab starts with seven evidence item types (commit, file touched, command, error, test output, session metadata, tokens/cost); diff previews and tool call detail are explicitly deferred to v1.x. Agent-server integration adds a thin `session-recorder.ts` wrapper around the existing `execute.ts` loop — the state machine, MCP tool surface, and notification handlers are untouched.

The dominant risks are cross-cutting concerns that must be locked in before any feature code is written: the RSC barrel boundary (the `b7bc170` regression waiting to repeat itself), the canonical event payload shape (if server-origin and client-origin events diverge early, the UI and analytics must branch forever), and event ordering (using `createdAt` as a sort key breaks under concurrent writes — a monotonic `sequence` integer is required from day one). Security risks are real and specific: a cross-workspace event injection vulnerability exists if the ingestion route only checks Clerk auth without verifying task workspace membership, and command output can contain secrets that must be redacted before persisting. These pitfalls map directly to the Data Model and Ingestion API phases, which must be done first and done carefully.

---

## Key Findings

### Recommended Stack

The milestone requires no new npm packages. The entire implementation is buildable on what is already in the monorepo: `pusher` 5.3.3 / `pusher-js` 8.5.0 for fan-out, Zod 4.3.6 for payload validation, Node.js `crypto` for token hashing, and Prisma for all database access. The only external dependency is on Claude Code CLI >= v2.1.89 running on the user's machine, which provides the hook mechanism.

**Core technologies (new additions only):**

- Claude Code CLI >= v2.1.89: runs on user's machine; fires `PostToolUse`, `SessionStart`, `SessionEnd` hooks — stable `--session-id` flag and HTTP hook support confirmed at this version
- `"type": "http"` hooks (built into Claude Code): POST evidence events directly to Lumo's ingestion API — eliminates any shell-script intermediary and adds no runtime dependency to the user's machine
- Ephemeral JWT (15-min TTL, signed with new `LUMO_HOOK_TOKEN_SECRET`): authenticate hook POSTs — scoped per `(sessionId, taskId, workspaceId)`, simple HMAC verify, no Clerk JWT expiry problem
- Pusher (existing, no upgrade): fan events to Sessions tab via the existing `task-{taskId}` channel with two new event types (`session:event`, `session:update`)
- Node.js `crypto` (built-in): hash/verify tokens — no new package

**Critical version notes:**

- `"type": "http"` hook handler: confirmed in current docs but exact minimum version floor not pinpointed. v2.1.89 is a conservative safe floor. Verify with a live test before implementing the ingestion route.
- `tool_response` vs `tool_result` field name: varies across docs; write Zod schema with `.or()` to accept both until confirmed by a live test.
- `SessionEnd.reason` field: treat as optional; the documented values do not cover all exit paths (GitHub issue #17885).

### Expected Features

**Must have for v1 (table stakes):**

- Session list on task page — chronological, grouped by day, expandable rows, origin badge (server/client), status pill (Live/Completed/Failed)
- Live streaming — Pusher events append evidence items in real-time; auto-scroll while active
- Evidence trail: Commit, File touched, Command run, Error / stack trace, Test output, Session metadata header, Tokens + cost — seven types answering the reviewer's primary question "did the agent make progress?"
- Launcher button — "Copy CLI command" panel generating a copyable shell invocation with task context pre-seeded and an optional deep-link fallback
- Agent identity in activity feed — session start/end writes activity events with clear "Claude Code via Alice" attribution; never attributed as "Alice"
- Ingestion API — bearer-token-authenticated endpoint; workspace-scoped authorization; idempotent via `@@unique([sessionId, sequence])`

**Should have for v1.x (differentiators):**

- Tool calls evidence item — transparency into what tools the agent used and why
- Diff preview evidence item — inline patch rendering without requiring a GitHub tab
- "Continue this session" launcher — session handoff between teammates
- Session filter bar — filter by origin, status, date range once workspaces accumulate 20+ sessions
- Custom session tags — organizational labels for parallel workstreams
- Session-to-commit back-link — `githubCommitUrl` in commit evidence items
- Secret redaction (regex-based) — once evidence schema is stable

**Defer to v2+:**

- Full-text search over command output — indexing cost not justified until filter bar is proven insufficient
- Agent assignment on task (auto-session trigger) — requires launcher pattern to mature first
- Per-session annotation / comment threads — validate whether task-level comments are sufficient first
- Cost analytics roll-up (aggregate by project/week) — needs session volume first

**Explicit anti-features (do not build):**

- Narrative / decision transcripts — structured evidence covers reviewer needs; free-text is unscannable
- Figma-style live cursor presence — streaming event trail already conveys activity
- Human-in-the-loop question queue — not the loudest pain for this milestone
- Multi-workspace session sharing — violates workspace-centric security model
- Branch-name inference as sole task binding — fails for greenfield tasks and multi-task sessions

### Architecture Approach

The system follows Lumo's existing layered architecture strictly: hooks on the user's machine POST to a thin API route, which calls a service, which calls a repository, which writes to Prisma. Fan-out to Pusher happens in the service layer, not the route. The `lib/integrations/claude-code/` module must be structured from day one with explicit client-safe submodules — the barrel (`index.ts`) must export only pure TypeScript types and the `buildLaunchCommand` helper; server-only code (`ingest.ts`, `token.ts`) is never re-exported through the barrel. Agent-server gains a thin `session-recorder.ts` wrapper; its existing `execute.ts`, state machine, and MCP surface are untouched.

**Major components:**

1. `lib/integrations/claude-code/` (new integration module) — typed event schemas (`events.ts`), client-safe types (`types.ts`), launcher command builder (`launcher.ts`), server-only ingestion + token utilities; barrel exports only client-safe items
2. `hook-runtime/` (standalone Node.js script, ~150 lines) — reads Claude Code hook stdin, classifies tool events into canonical `AgentSessionEventKind`, POSTs to ingestion API; installable via `npx` or manual copy; never imports from `lib/`
3. `POST /api/agent-sessions/ingest` (new API route) — bearer-token auth, Zod validation, workspace membership check, bulk-insert via `createMany({ skipDuplicates: true })`, Pusher publish
4. `AgentSession` + `AgentSessionEvent` (new Prisma models) — single `payload Json` column discriminated by `kind` enum, `@@unique([sessionId, sequence])` idempotency constraint, `workspaceId` denormalized for auth checks
5. `SessionsTab.tsx` + `EventTimeline.tsx` (new UI components) — client components subscribing to existing `task-{taskId}` Pusher channel; initial load via REST, gap recovery on reconnect via REST fetch from last sequence number
6. `agent-server/session-recorder.ts` (new thin wrapper) — called from `execute.ts` to write `AgentSession` and `AgentSessionEvent` records for server-origin sessions; existing Pusher broadcast calls unchanged

**Key architectural decisions:**

- Single `AgentSessionEvent` table with `payload Json` + `kind` enum (not per-kind tables) — the query pattern is always "all events for session ordered by sequence"
- `task-{taskId}` Pusher channel reuse (not per-session channels) — prevents channel proliferation; client was already subscribed
- Canonical event payload shape defined in `shared/` before any event-producing code is written — ensures one rendering component tree for both origins
- `sequence` integer as the ordering key (not `createdAt`) — monotonically increasing per session; `@@unique([sessionId, sequence])` provides idempotency

### Critical Pitfalls

1. **RSC barrel boundary violation (b7bc170 repeat)** — structure `lib/integrations/claude-code/` with explicit client-safe submodules from day one; never re-export `ingest.ts` or `token.ts` through `index.ts`; client components import from submodules directly. Address in Data Model phase.

2. **Cross-workspace event injection** — ingestion route must verify `task.project.workspaceId` matches the authenticated workspace after token validation; Clerk auth alone is insufficient. Address in Ingestion API phase.

3. **Secret / PII capture in command output** — `PostToolUse` for Bash captures full stdout; commands like `printenv` or `cat .env.local` expose credentials to all workspace members. Apply regex redaction in the hook script before POST and a server-side fallback in the ingestion service. Address in Hook Runtime and Ingestion API phases.

4. **Diverging event shapes between server-origin and client-origin** — define the canonical `AgentSessionEventPayload` discriminated union in `shared/` before writing any event-producing code. If they diverge, UI and analytics branch permanently. Address in Data Model phase.

5. **Hook script blocking Claude Code synchronously** — `PostToolUse` hooks must be non-blocking; verify HTTP hooks are fire-and-forget or use `"async": true` for command hooks. A synchronous POST adds network latency to every agent step. Address in Hook Runtime phase.

6. **Event ordering by `createdAt` breaks under concurrent writes** — use a monotonic `sequence` integer assigned client-side; sort by `sequence ASC` everywhere. Address in Data Model phase.

7. **Unbounded command output stored as JSONB** — truncate `stdout`/`stderr` at 4KB in the hook script and enforce a max-length cap in the Zod ingestion schema. Address in Data Model and Hook Runtime phases.

---

## Implications for Roadmap

### Phase 1: Data Model and Canonical Schema

**Rationale:** Everything else depends on the Prisma models and the canonical event payload type. RSC boundary structure, event ordering, idempotency, and payload shape must all be decided before any feature code is written. Getting these wrong triggers cascading changes to every downstream phase.

**Delivers:** `AgentSession` and `AgentSessionEvent` Prisma models with migration; canonical `AgentSessionEventPayload` discriminated union in `shared/`; `lib/integrations/claude-code/` directory skeleton with correct barrel structure; Zod schemas for ingestion validation.

**Addresses:** Foundation for all v1 features; no user-visible output yet.

**Must avoid:** Pitfall 1 (barrel structure correct from first commit), Pitfall 4 (canonical shape defined here), Pitfall 6 (sequence field not createdAt), Pitfall 7 (payload size caps), Pitfall 11 (payload truncation strategy), Pitfall 13 (migration without ALTER TABLE on Task), Pitfall 22 (agent-server Prisma client regeneration plan).

**Research flag:** Standard patterns — skip phase research.

---

### Phase 2: Ingestion API and Hook Authentication

**Rationale:** The ingestion endpoint is the trust boundary for the entire system. Auth, workspace authorization, idempotency, rate limiting, and secret redaction must all be implemented here before any hook sends real data.

**Delivers:** `POST /api/agent-sessions/ingest` with bearer-token auth, Zod validation, workspace membership check, `createMany({ skipDuplicates: true })`, Pusher publish; `POST /api/agent-sessions` (session creation + JWT mint); `GET /api/tasks/[taskId]/sessions`; `GET /api/agent-sessions/[id]/events` (paginated); ephemeral JWT mint/verify in `token.ts`; service and repository layers.

**Addresses features:** Ingestion API (P1); session list data (P1); live streaming data path (P1).

**Must avoid:** Pitfall 2 (tokens from env vars, never hardcoded), Pitfall 4 (workspace membership check on every request), Pitfall 5 (rate limiting, batch size cap), Pitfall 6 (idempotency via skipDuplicates), Pitfall 17 (server-side secret redaction fallback), Pitfall 19 (workspace membership re-verified per request).

**Research flag:** Rate limiting library choice (Vercel Edge vs. Upstash) needs a quick spike at phase start if not already resolved.

---

### Phase 3: Hook Runtime

**Rationale:** The hook runtime runs on the user's machine. It must be built and tested independently of the UI. Authentication tokens, event classification, and payload truncation must all be correct before any real session fires.

**Delivers:** `hook-runtime/` standalone Node.js script (~150 lines); event classification logic (`classify.ts`); secret redaction before POST; `async: true` configuration; `.claude/settings.json` template for the repo; installation instructions.

**Addresses features:** Claude Code hook integration (P1); all client-side evidence types.

**Must avoid:** Pitfall 2 (tokens from `allowedEnvVars`), Pitfall 3 (async: true on PostToolUse), Pitfall 7 (4KB stdout truncation), Pitfall 16 (defensive error trapping, health check on SessionStart), Pitfall 17 (redaction filter before POST).

**Research flag:** NEEDS RESEARCH — live smoke test required at start of phase to confirm `tool_response` vs `tool_result` field name and verify HTTP hook async behavior at v2.1.89. Cannot be resolved by documentation alone.

---

### Phase 4: Launcher UI

**Rationale:** The launcher is the user-facing binding mechanism. It depends on the ingestion API (Phase 2) to mint tokens and create sessions. It must handle the case where Claude Code is not installed.

**Delivers:** "Start Claude session" button on task page; launcher modal with copyable CLI command, task context download, Windows PowerShell variant; session pending state polling (warning after 30 seconds with no events); `buildLaunchCommand()` in `launcher.ts`; context injection capped to essential fields only (~1500 chars).

**Addresses features:** Launcher button (P1); task context injection; session_id pre-generation.

**Must avoid:** Pitfall 20 (pre-flight instructions and pending-state polling), Pitfall 21 (context injection size cap), Pitfall 2 (token in env var only, never displayed in UI).

**Research flag:** `claude://` deep-link parameter support is LOW confidence — spike before implementing; fall back to "Copy CLI command" if undocumented. Otherwise standard patterns.

---

### Phase 5: Sessions Tab UI

**Rationale:** UI is last because it has the most dependencies — data model, ingestion API, and live Pusher events must all be working before the rendering layer can be meaningfully built and tested.

**Delivers:** `SessionsTab.tsx` on task page; session list with day grouping, origin badge, status indicator (Live pill + pulsing dot); expandable session cards with `EventTimeline.tsx`; seven evidence item renderers (commit, file touched, command, error, test output, session metadata, tokens/cost); Pusher subscription on `task-{taskId}`; REST fallback for gap recovery on reconnect; auto-scroll while live; i18n strings for all 16 locales using existing date formatter.

**Addresses features:** Sessions tab (P1); all seven v1 evidence types (P1); live streaming (P1); agent identity in activity feed (P1).

**Must avoid:** Pitfall 1 (import from submodules directly), Pitfall 9 (single `task-{taskId}` channel with useEffect cleanup), Pitfall 10 (REST fallback for reconnect gap recovery), Pitfall 12 (paginated initial load, not N+1 loop), Pitfall 18 (render as "Claude Code via Alice"), Pitfall 25 (i18n strings for all 16 locales), Pitfall 26 (locale-aware date formatting using existing utility).

**Research flag:** Standard patterns — skip phase research.

---

### Phase 6: Agent-Server Unification

**Rationale:** Agent-server integration is last because it modifies existing working infrastructure. The data model and ingestion patterns must be proven on the client-side path first. This phase is additive only — existing state machine, MCP tools, and Pusher broadcast calls are untouched.

**Delivers:** `agent-server/session-recorder.ts` thin wrapper writing `AgentSession` (origin: `server`) and `AgentSessionEvent` records during agent-server execution; server-origin sessions appearing interleaved with client-origin sessions in the Sessions tab; agent-server Prisma client regeneration after migration.

**Addresses features:** Unified interleaved session list (P1); server-origin agent identity in activity feed.

**Must avoid:** Pitfall 8 (clear write-path ownership: server-origin written only via session-recorder), Pitfall 15 (canonical payload shape enforced in agent-server adapter), Pitfall 22 (agent-server Prisma client regeneration in deployment order), Pitfall 23 (additive-only changes to `shared/`; run agent-server Jest suite after any shared/ change).

**Research flag:** Agent-server internals well-understood from codebase analysis — skip phase research. Integration test covering full server-origin event loop is required before shipping.

---

### Phase Ordering Rationale

- Data model before API: Prisma models, Zod schemas, and canonical payload shape are imported by every subsequent phase. Changing them later triggers cascading updates.
- API before hook runtime: the hook runtime must POST to an actual endpoint to be testable; building the API first decouples ingestion testing from the hook.
- Hook runtime before launcher UI: the launcher command includes `LUMO_SESSION_TOKEN`; the token format and hook auth contract must be finalized first.
- Launcher before Sessions tab: the live-session UX requires real events flowing, which requires the launcher to exist.
- Sessions tab before agent-server unification: the display layer is proven on client-origin events first; server-origin events are layered in without changing the rendering path.

---

## Confidence Assessment

| Area         | Confidence  | Notes                                                                                                                                                                                                                                                                                                                      |
| ------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack        | HIGH        | Hooks mechanism, `--session-id` flag, HTTP hook type, Pusher reuse, token auth — all verified against official Claude Code docs. Two MEDIUM gaps: `tool_response` field name (docs inconsistent) and HTTP hook minimum version floor (not pinpointed in release notes). Both resolvable with a live test at Phase 3 start. |
| Features     | MEDIUM-HIGH | Table stakes and differentiators grounded in Devin, GitHub Copilot, Linear, JetBrains Junie, Atlassian Rovo competitor analysis. UX specifics are inferred from patterns across multiple sources, not verified from official API specs.                                                                                    |
| Architecture | HIGH        | Based on direct codebase inspection (commit `b49864f` codebase map) and official Claude Code hooks docs. Prisma model proposals are concrete. API shapes are fully specified. RSC boundary structure directly addresses the confirmed `b7bc170` regression pattern.                                                        |
| Pitfalls     | HIGH        | 28 pitfalls identified with severity, phase mapping, and concrete prevention strategies. Grounded in official docs, confirmed CVEs, Lumo codebase analysis (`CONCERNS.md`), and GitHub issue tracking. All CRITICAL pitfalls have documented prior incidents or confirmed vulnerability patterns.                          |

**Overall confidence: HIGH**

### Gaps to Address

- **`tool_response` vs `tool_result` field name:** Write Zod schema accepting both via `.or()` as a temporary measure. Resolve with a live test at Phase 3 start.
- **HTTP hook async behavior:** Verify with `claude --debug` during the Phase 3 smoke test that HTTP hooks do not block between tool calls; fall back to `"type": "command"` with `async: true` if they do.
- **JWT TTL for long sessions:** 15 minutes is the starting point. Evaluate a "token refresh on ingest" pattern during Phase 2 if sessions routinely exceed this in smoke testing.
- **Rate limiting library:** Evaluate `@vercel/edge-ratelimit` (no additional infra) vs. Upstash Redis (new service) at Phase 2 start.

---

## Sources

### Primary (HIGH confidence)

- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — hook types, payload schemas, settings.json format, HTTP hook configuration, allowedEnvVars, exit codes
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) — `--session-id`, `--append-system-prompt-file`, `--name`, `--permission-mode` flags
- [GitHub: anthropics/claude-code plugin SKILL.md](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/hook-development/SKILL.md) — PostToolUse tool_response field schemas
- [Lumo codebase map](../codebase/) — confirmed Pusher versions, channel topology, CONCERNS.md gaps, b7bc170 RSC boundary lesson
- [Claude Code Releases](https://github.com/anthropics/claude-code/releases) — v2.1.100 current; defer PreToolUse requires v2.1.89+

### Secondary (MEDIUM confidence)

- [Devin 2025 release notes](https://docs.devin.ai/release-notes/2025) — session list UX, custom tags, Follow tab patterns
- [GitHub Copilot: Trace commits to session logs (March 2026)](https://github.blog/changelog/2026-03-20-trace-any-copilot-coding-agent-commit-to-its-session-logs/) — Agent-Logs-Url commit trailer pattern
- [Linear for Agents (May 2025)](https://linear.app/changelog/2025-05-20-linear-for-agents) — agent identity, first-class user model
- [JetBrains Junie: session history](https://junie.jetbrains.com/docs/) — LLM usage data display, session history UX
- [GitHub Copilot: Track Copilot sessions](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/track-copilot-sessions) — live vs. completed session UX patterns

### Tertiary (LOW confidence)

- [GitHub issue #17885](https://github.com/anthropics/claude-code/issues/17885) — SessionEnd.reason field inconsistency; treat reason as optional
- [GitHub issues #22178, #38575](https://github.com/anthropics/claude-code/issues/) — session ID instability on resume; use Lumo-assigned AgentSession.id as primary key
- [claude-code-hooks-schemas gist](https://gist.github.com/FrancisBourre/50dca37124ecc43eaf08328cdcccdb34) — schema cross-reference; community doc, not official

---

_Research completed: 2026-04-10_
_Ready for roadmap: yes_
