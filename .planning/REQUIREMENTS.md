# Requirements: Lumo — Agent Sessions Milestone

**Defined:** 2026-04-10
**Core Value:** Work done in Claude Code flows into the bound Lumo task automatically — live, queryable, no manual ferrying.

## v1 Requirements

Requirements for the Agent Sessions milestone. Each maps to exactly one roadmap phase.

### Data Model

Foundation layer. Every other category depends on this being stable.

- [ ] **DATA-01**: `AgentSession` Prisma model exists with fields: `id` (Lumo-owned CUID), `origin` (`server | client` enum), `taskId`, `launchedByUserId` (Clerk user ID), `claudeSessionId` (correlation-only, not primary key), `status` (`pending | active | completed | failed | abandoned`), `startedAt`, `endedAt`, `metadata` (Json), `workspaceId` (denormalized for auth checks), timestamps
- [ ] **DATA-02**: `AgentSessionEvent` Prisma model exists with fields: `id`, `sessionId`, `sequence` (monotonic integer), `kind` (enum), `payload` (Json), `createdAt`, and a `@@unique([sessionId, sequence])` constraint for idempotency
- [ ] **DATA-03**: Canonical `AgentSessionEventPayload` discriminated union defined in `shared/` with kinds `session-start | session-end | commit | file | command | error | test | metadata | tokens`, imported by both the main app and `agent-server/`
- [ ] **DATA-04**: Prisma migration applied cleanly against Neon without locking the existing `Task` table under load; workspace scoping path from `AgentSession → Task → Project → Workspace` is traceable via query
- [ ] **DATA-05**: `lib/integrations/claude-code/` module structured with client-safe submodules (`types.ts`, `events.ts`, `launcher.ts`) and server-only submodules (`ingest.ts`, `token.ts`); barrel `index.ts` re-exports ONLY client-safe items; server-only modules are never reachable from a `'use client'` component (per b7bc170 lesson)
- [ ] **DATA-06**: Zod schemas for every event payload kind, with `tool_response` / `tool_result` field name tolerated via `.or()` until live-test resolution
- [ ] **DATA-07**: Payload size caps enforced at schema level: `stdout`/`stderr` capped at 4KB per command event; total event payload capped at 16KB

### Ingestion API

Trust boundary. Auth, workspace authorization, idempotency, rate limiting, and secret redaction all live here.

- [ ] **INGEST-01**: `POST /api/agent-sessions` — authenticated (Clerk) route that creates an `AgentSession` record and returns an ephemeral JWT scoped to `(sessionId, taskId, workspaceId)` with a 15-minute TTL; route follows the layered architecture (route → service → repository)
- [ ] **INGEST-02**: `POST /api/agent-sessions/ingest` — bearer-token-authenticated batch event endpoint; validates payload via Zod; persists events via `createMany({ skipDuplicates: true })`; returns the current server wall-clock for client drift correction
- [ ] **INGEST-03**: `GET /api/tasks/[taskId]/sessions` — returns the list of `AgentSession`s for a task, scoped to workspace membership, ordered newest first; supports cursor pagination
- [ ] **INGEST-04**: `GET /api/agent-sessions/[id]/events` — returns events for a session ordered by `sequence ASC` with cursor pagination
- [ ] **INGEST-05**: Workspace membership check verifies `task.project.workspaceId` matches the authenticated workspace on every ingest request; bearer-token scope enforcement prevents cross-task event injection
- [ ] **INGEST-06**: Per-session rate limit enforced at the ingestion endpoint (burst cap + sustained cap) to prevent runaway sessions from swamping Postgres or Pusher
- [ ] **INGEST-07**: Server-side regex-based secret redaction applied to command `stdout`/`stderr` and error messages before persist (matching `AKIA*`, `ghp_*`, `sk-*`, `.env` contents, and common private-key headers)
- [ ] **INGEST-08**: On successful event write, service layer publishes a `session:event` message on the existing `task-{taskId}` Pusher channel with enough payload for the UI to render without re-fetching
- [ ] **INGEST-09**: `POST /api/agent-sessions/[id]/end` — explicit session-end endpoint called by `SessionEnd` hook or by a user "Mark ended" UI affordance (escape hatch for hooks that fail to fire on SIGKILL)

### Hook Runtime

Runs on the user's machine via Claude Code HTTP hooks. Must be non-blocking, safe, and self-healing.

- [ ] **HOOK-01**: `.claude/settings.json` template in the Lumo repo configuring three HTTP hooks: `SessionStart`, `PostToolUse` (matcher: `Bash|Write|Edit|MultiEdit|Read`), and `SessionEnd`, all pointing at the Lumo ingestion API base URL
- [ ] **HOOK-02**: Hook runtime classification logic maps `PostToolUse` tool events to canonical `AgentSessionEventKind` (Bash → `command`, Write/Edit/MultiEdit → `file`, Read → `file` read, test runner output → `test`, error exit codes → `error`)
- [ ] **HOOK-03**: Hook runtime reads `LUMO_SESSION_TOKEN` and `LUMO_TASK_ID` from env vars via Claude Code's `allowedEnvVars` and attaches `Authorization: Bearer ${LUMO_SESSION_TOKEN}` header
- [ ] **HOOK-04**: Hook runtime truncates `stdout`/`stderr` to 4KB and strips ANSI escapes before POST
- [ ] **HOOK-05**: Client-side regex redaction filter applied to command output before POST (defence in depth — server-side INGEST-07 is the fallback)
- [ ] **HOOK-06**: Hooks configured as non-blocking (`async: true` for command hooks, or verified fire-and-forget behavior for HTTP hooks) so they do not add latency between agent tool calls
- [ ] **HOOK-07**: `SessionStart` hook performs an ingest endpoint health check and logs failures to stderr without crashing the session; session binding survives transient network failures
- [ ] **HOOK-08**: Hook setup is documented in `lib/integrations/claude-code/README.md` with copy-pasteable installation instructions and a one-command repo setup

### Launcher UI

The user-facing binding mechanism. "Launched from Lumo" is the canonical v1 path.

- [ ] **LAUNCH-01**: "Start Claude Session" button rendered on the task page header for workspace members with write access to the task
- [ ] **LAUNCH-02**: Clicking the button opens a launcher modal that (a) creates a pending `AgentSession` via `POST /api/agent-sessions`, (b) mints the ephemeral JWT, (c) generates a pre-seeded CLI command with `--session-id`, `--append-system-prompt-file`, and `--name`, and env vars `LUMO_SESSION_TOKEN`, `LUMO_TASK_ID`
- [ ] **LAUNCH-03**: Launcher writes task context (title, description, acceptance criteria) to a temp file path referenced by `--append-system-prompt-file`; context is capped at ~1500 characters with intelligent truncation
- [ ] **LAUNCH-04**: Launcher modal offers platform-specific command variants: macOS/Linux (Bash) and Windows (PowerShell); `Copy to clipboard` is the primary action
- [ ] **LAUNCH-05**: Launcher shows a pending-state spinner + polling on the newly-created session; if no events arrive within 30 seconds, the UI surfaces a diagnostic warning with a link to hook installation instructions
- [ ] **LAUNCH-06**: Token is never rendered into the visible UI — it is injected only into the copyable command via `env LUMO_SESSION_TOKEN=...` prefix; token is opaque to the user

### Sessions Tab UI

The queryable evidence trail on the task page.

- [ ] **SESSION-01**: Sessions tab added to task page; tab lists all `AgentSession`s for the task interleaved by origin (server and client), grouped by day, sorted newest-first
- [ ] **SESSION-02**: Each session row shows: origin badge (`server` | `client`), status pill (`Live` with pulsing dot / `Completed` / `Failed` / `Abandoned`), actor attribution string (`Claude Code via Alice`), duration, and event count
- [ ] **SESSION-03**: Clicking a session row expands it to reveal the full evidence timeline sorted by `sequence ASC`
- [ ] **SESSION-04**: Evidence renderer for `commit` — hash, message, author, diff stats, links to GitHub if available
- [ ] **SESSION-05**: Evidence renderer for `file` — path, operation (create/modify/delete/read), file size delta
- [ ] **SESSION-06**: Evidence renderer for `command` — command line, exit code, truncated stdout/stderr inside a `<details>` expand
- [ ] **SESSION-07**: Evidence renderer for `error` — error message, stack-trace excerpt, file/line if available
- [ ] **SESSION-08**: Evidence renderer for `test` — pass/fail counts, failing test names, summary line
- [ ] **SESSION-09**: Evidence renderer for `metadata` — session header card with model, working directory, git branch, start time
- [ ] **SESSION-10**: Evidence renderer for `tokens` — token usage and estimated cost summary
- [ ] **SESSION-11**: Live Pusher subscription on the existing `task-{taskId}` channel; incoming `session:event` messages append to the appropriate session's event timeline in real-time with auto-scroll
- [ ] **SESSION-12**: Auto-scroll pauses if the user scrolls manually; a "New events ↓" jump-to-bottom chip appears when paused and new events arrive
- [ ] **SESSION-13**: REST gap-recovery fallback: on Pusher reconnect, fetch events with `sequence > lastSeenSequence` via `GET /api/agent-sessions/[id]/events` to close any delivery gap
- [ ] **SESSION-14**: Any workspace member (not just the launcher) can open a teammate's past session and read its full evidence trail — review and handoff are first-class
- [ ] **SESSION-15**: All Sessions tab UI strings added to all 16 locales; timestamps and durations formatted with the existing locale-aware date formatter

### Agent Identity + Agent-Server Unification

Treats agents as teammates and folds the existing `agent-server/` origin into the unified data model.

- [ ] **AGENT-01**: `agent-server/src/agent/session-recorder.ts` thin wrapper called from `execute.ts` to create `AgentSession` (`origin: 'server'`) and append `AgentSessionEvent` records during server-side execution; existing state machine, MCP tool surface, `broadcast` calls, and notification handlers are untouched
- [ ] **AGENT-02**: Server-origin sessions appear interleaved with client-origin sessions in the Sessions tab with identical rendering (same evidence item components); the only difference is the `origin` badge
- [ ] **AGENT-03**: Session start and session end write entries into the existing activity timeline, attributed as `Claude Code via {launcher display name}`; attribution is never flattened to the launching human user alone
- [ ] **AGENT-04**: Agent identity is represented per-workspace and scoped to the Clerk user who launched the session; agent entries in activity feeds, `@mentions`, and assignment UI use a distinct visual treatment (e.g. bot badge) that differentiates them from human actors without inventing a parallel auth system
- [ ] **AGENT-05**: Canonical event payload shape from `shared/AgentSessionEventPayload` is enforced in the agent-server session-recorder so server-origin events validate against the same Zod schema as client-origin events; one rendering component tree serves both

## v2 Requirements

Deferred to follow-up milestones. Tracked but not in current roadmap.

### Enhanced Evidence

- **EVIDENCE-01**: `tool-call` evidence type — surface which Claude Code tools the agent invoked and their summarized inputs/outputs
- **EVIDENCE-02**: `diff` evidence type — inline patch preview rendered from captured diffs, without requiring a GitHub tab switch
- **EVIDENCE-03**: Advanced secret redaction with customizable workspace-level pattern rules
- **EVIDENCE-04**: Back-link from commit events to the session that produced them (`githubCommitUrl` round-trip)

### Session Management

- **MGMT-01**: "Continue this session" launcher — start a new Claude Code session seeded with the prior session's task context and last-known state; enables handoff between teammates
- **MGMT-02**: Per-session annotation / comment threads — comment on specific evidence items, not just the task
- **MGMT-03**: Session filter bar on the Sessions tab — filter by origin, status, date range, launcher (activated once workspaces accumulate 20+ sessions per task)
- **MGMT-04**: Custom session tags — organizational labels for parallel workstreams

### Analytics & Search

- **ANALYTICS-01**: Cost analytics roll-up aggregating tokens/cost by project, week, and launcher
- **ANALYTICS-02**: Full-text search over command output and evidence payloads (deferred until filter bar is proven insufficient)
- **ANALYTICS-03**: Session duration and success-rate dashboards per workspace

### Automation

- **AUTO-01**: Assign an agent to a task — auto-trigger a server-side session when assignment fires
- **AUTO-02**: Git-branch inference as a secondary task-binding signal when launcher was not used
- **AUTO-03**: Human-in-the-loop question queue — dedicated UI surface for `Claude is blocked waiting on A or B?`

## Out of Scope

Explicitly excluded. Documented to prevent scope creep. Mirrors PROJECT.md `Out of Scope` with phase-level reasoning.

| Feature                                                           | Reason                                                                                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Narrative / decision transcripts                                  | Deliberately traded for structured artifacts + evidence; the user wants a queryable audit log, not a teammate monologue                         |
| Figma-style live cursor presence (`Claude is editing file X now`) | Cost/complexity vs. value; the streaming trail already shows current activity implicitly via `session:event` Pusher messages                    |
| Dedicated human-in-the-loop question-queue UI                     | Not the loudest pain for this milestone; defer to v2 `AUTO-03` once friction emerges                                                            |
| Agent-agent collaboration as a UI surface                         | Server-side agents already compose internally via `state-machine.ts`; the user's pain is human-agent friction, not agent-agent                  |
| Rebuilding `agent-server`                                         | It already works and carries the MCP, state machine, Pusher infrastructure we need; this milestone extends it additively                        |
| Parallel "bot identity" auth system distinct from Clerk           | Agents-as-teammates integrate with existing Clerk workspace identity; avoids a second auth system                                               |
| New Claude inference billing                                      | Client sessions use the user's Claude Code subscription; server sessions keep using `agent-server`'s Anthropic SDK credentials                  |
| Multi-workspace session sharing                                   | A session belongs to exactly one workspace, aligning with Lumo's workspace-centric security model                                               |
| Task-ID inference from git branch as sole binding                 | Fails for greenfield tasks and multi-task sessions; launcher-first is the deterministic v1 path, with branch inference deferred to v2 `AUTO-02` |
| Cross-machine session resume                                      | Requires persistent state transport outside the scope of this milestone                                                                         |
| Narrative LLM summarization of sessions                           | Contradicts `Artifacts + evidence` decision in PROJECT.md                                                                                       |

## Traceability

Which phases cover which requirements. Populated by the gsd-roadmapper agent.

| Requirement | Phase   | Status  |
| ----------- | ------- | ------- |
| DATA-01     | Phase 1 | Pending |
| DATA-02     | Phase 1 | Pending |
| DATA-03     | Phase 1 | Pending |
| DATA-04     | Phase 1 | Pending |
| DATA-05     | Phase 1 | Pending |
| DATA-06     | Phase 1 | Pending |
| DATA-07     | Phase 1 | Pending |
| INGEST-01   | Phase 2 | Pending |
| INGEST-02   | Phase 2 | Pending |
| INGEST-03   | Phase 2 | Pending |
| INGEST-04   | Phase 2 | Pending |
| INGEST-05   | Phase 2 | Pending |
| INGEST-06   | Phase 2 | Pending |
| INGEST-07   | Phase 2 | Pending |
| INGEST-08   | Phase 2 | Pending |
| INGEST-09   | Phase 2 | Pending |
| HOOK-01     | Phase 3 | Pending |
| HOOK-02     | Phase 3 | Pending |
| HOOK-03     | Phase 3 | Pending |
| HOOK-04     | Phase 3 | Pending |
| HOOK-05     | Phase 3 | Pending |
| HOOK-06     | Phase 3 | Pending |
| HOOK-07     | Phase 3 | Pending |
| HOOK-08     | Phase 3 | Pending |
| LAUNCH-01   | Phase 4 | Pending |
| LAUNCH-02   | Phase 4 | Pending |
| LAUNCH-03   | Phase 4 | Pending |
| LAUNCH-04   | Phase 4 | Pending |
| LAUNCH-05   | Phase 4 | Pending |
| LAUNCH-06   | Phase 4 | Pending |
| SESSION-01  | Phase 5 | Pending |
| SESSION-02  | Phase 5 | Pending |
| SESSION-03  | Phase 5 | Pending |
| SESSION-04  | Phase 5 | Pending |
| SESSION-05  | Phase 5 | Pending |
| SESSION-06  | Phase 5 | Pending |
| SESSION-07  | Phase 5 | Pending |
| SESSION-08  | Phase 5 | Pending |
| SESSION-09  | Phase 5 | Pending |
| SESSION-10  | Phase 5 | Pending |
| SESSION-11  | Phase 5 | Pending |
| SESSION-12  | Phase 5 | Pending |
| SESSION-13  | Phase 5 | Pending |
| SESSION-14  | Phase 5 | Pending |
| SESSION-15  | Phase 5 | Pending |
| AGENT-01    | Phase 6 | Pending |
| AGENT-02    | Phase 6 | Pending |
| AGENT-03    | Phase 6 | Pending |
| AGENT-04    | Phase 6 | Pending |
| AGENT-05    | Phase 6 | Pending |

**Coverage:**

- v1 requirements: 50 total
- Mapped to phases: 50/50 ✓
- Unmapped: 0 ✓

---

_Requirements defined: 2026-04-10_
_Last updated: 2026-04-10 — traceability populated by gsd-roadmapper (Agent Sessions milestone)_
