# Roadmap: Lumo — Agent Sessions Milestone

## Overview

Six phases transform Lumo from a tool that tracks human work to one where Claude Code sessions on a developer's machine become first-class participants in bound tasks. The journey starts with the data foundation that every other phase depends on, moves through the trust boundary of the ingestion API, then the on-device hook runtime, the user-facing launcher, the full Sessions tab UI, and finally folds the existing agent-server origin into the same unified view. Each phase is independently shippable and verifiable before the next begins.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Data Model and Canonical Schema** - Prisma models, shared event payload types, RSC-safe integration module skeleton, and Zod schemas that everything else imports
- [ ] **Phase 2: Ingestion API and Hook Authentication** - Trust boundary: session creation, JWT minting, batch event ingest, workspace-scoped auth, rate limiting, secret redaction, and Pusher fan-out
- [ ] **Phase 3: Hook Runtime** - On-device Claude Code hook scripts that classify tool events and POST to the ingestion API non-blocking
- [ ] **Phase 4: Launcher UI** - "Start Claude Session" button and modal on the task page that mints a token, builds the pre-seeded CLI command, and polls for first events
- [ ] **Phase 5: Sessions Tab UI** - Interleaved session list, expandable evidence timelines, seven evidence renderers, live Pusher streaming, and i18n for all 16 locales
- [ ] **Phase 6: Agent-Server Unification** - Thin session-recorder wrapper in agent-server so server-origin sessions appear interleaved with client-origin sessions in the same tab

## Phase Details

### Phase 1: Data Model and Canonical Schema

**Goal**: The schema and type contracts are locked so every downstream phase builds on a stable foundation — models migrated, canonical payload shape defined, RSC boundary enforced, and Zod schemas validating all event kinds.
**Depends on**: Nothing (first phase)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, DATA-07
**Success Criteria** (what must be TRUE):

1. `AgentSession` and `AgentSessionEvent` Prisma models exist, the migration applies cleanly against Neon, and the workspace scoping path `AgentSession → Task → Project → Workspace` is traversable via a Prisma query.
2. The canonical `AgentSessionEventPayload` discriminated union in `shared/` covers all nine event kinds (`session-start`, `session-end`, `commit`, `file`, `command`, `error`, `test`, `metadata`, `tokens`), and both the main app and `agent-server/` can import it without circular dependency.
3. `lib/integrations/claude-code/` has client-safe submodules (`types.ts`, `events.ts`, `launcher.ts`) and server-only submodules (`ingest.ts`, `token.ts`); the barrel `index.ts` re-exports only client-safe items; a server-only import from a `'use client'` component produces a build error.
4. Zod schemas for every event payload kind compile and validate a sample payload, including accepting both `tool_response` and `tool_result` field names via `.or()`; `stdout`/`stderr` fields reject values over 4 KB and total event payloads reject values over 16 KB.
   **Plans**: TBD
   **UI hint**: no

**Critical pitfalls to guard:**

- RSC barrel boundary: server-only modules (`ingest.ts`, `token.ts`) must never appear in the barrel `index.ts` re-exports (per b7bc170 lesson)
- Canonical shape defined before any event-producing code is written — if server-origin and client-origin events diverge here, the UI and analytics must branch forever
- `sequence` field (not `createdAt`) is the ordering key; `@@unique([sessionId, sequence])` provides idempotency from day one
- Payload size caps enforced at schema level, not just application code
- Migration must not use `ALTER TABLE` on the existing `Task` table in a way that takes a lock under load

---

### Phase 2: Ingestion API and Hook Authentication

**Goal**: The trust boundary is complete — hooks on the user's machine can authenticate, POST events, and receive Pusher fan-out; workspace membership is verified on every request; rate limiting and secret redaction are active.
**Depends on**: Phase 1
**Requirements**: INGEST-01, INGEST-02, INGEST-03, INGEST-04, INGEST-05, INGEST-06, INGEST-07, INGEST-08, INGEST-09
**Success Criteria** (what must be TRUE):

1. A manually-invoked `POST /api/agent-sessions` (Clerk-authenticated) creates a persisted `AgentSession` record with `status: pending` and returns an ephemeral JWT scoped to `(sessionId, taskId, workspaceId)` with a 15-minute TTL.
2. A `POST /api/agent-sessions/ingest` with a valid bearer token and a batch of two events with the same `sequence` number persists exactly one event (idempotency via `createMany({ skipDuplicates: true })`) and returns the server wall-clock timestamp.
3. A `POST /api/agent-sessions/ingest` with a bearer token whose `workspaceId` does not match the target task's workspace is rejected with a 403 — workspace membership verification is not bypassable with a valid token for a different workspace.
4. A command event payload whose `stdout` contains a string matching `AKIA[A-Z0-9]{16}` (AWS key pattern) is redacted before being written to the database; the persisted payload contains a redaction marker in place of the key.
5. After successful event write, a `session:event` Pusher message is published on the `task-{taskId}` channel containing enough data for the UI to render the event without a follow-up fetch.
   **Plans**: TBD
   **UI hint**: no

**Critical pitfalls to guard:**

- Cross-workspace event injection: ingestion route must verify `task.project.workspaceId` matches the token's `workspaceId`; Clerk auth alone is insufficient
- Rate limiting must be evaluated (Vercel Edge vs. Upstash) at phase start before implementation begins
- Server-side secret redaction (`AKIA*`, `ghp_*`, `sk-*`, `.env` contents, private-key headers) is a security requirement, not a nicety
- Bearer token stored as a hash (`ingestTokenHash`) in `AgentSession` — plaintext never persisted
- `INGEST-09` (`POST /api/agent-sessions/[id]/end`) is an escape hatch for SIGKILL scenarios where `SessionEnd` hook does not fire

---

### Phase 3: Hook Runtime

**Goal**: The on-device hook runtime classifies Claude Code tool events into canonical evidence kinds, redacts secrets before POST, is non-blocking, and self-heals on transient network failures — proven by a live smoke test against the Phase 2 ingestion endpoint.
**Depends on**: Phase 2
**Requirements**: HOOK-01, HOOK-02, HOOK-03, HOOK-04, HOOK-05, HOOK-06, HOOK-07, HOOK-08
**Success Criteria** (what must be TRUE):

1. Running `claude --session-id <uuid>` with `LUMO_SESSION_TOKEN` and `LUMO_TASK_ID` set, and the `.claude/settings.json` hooks active, causes a `SessionStart` event to arrive in the Lumo database within 10 seconds of session open.
2. A `Bash` tool call inside the active session causes a `command` event to appear in `AgentSessionEvent` with correct `command`, `exitCode`, `stdout` (truncated to 4 KB), and ANSI escapes stripped.
3. A `Write` or `Edit` tool call causes a `file` event with the correct `path` and `operation`; a `git commit` bash call causes a `commit` event classified separately from a generic command.
4. Hook POST failures (simulated by temporarily making the ingestion endpoint unreachable) log a warning to stderr but do not interrupt Claude Code's session — the tool call returns normally.
5. A command whose stdout contains a pattern matching `ghp_[A-Za-z0-9]{36}` (GitHub PAT) is redacted in the hook script before the POST reaches the server — the defence-in-depth layer is client-side.
   **Plans**: TBD
   **UI hint**: no

**Critical pitfalls to guard:**

- NEEDS LIVE SMOKE TEST at phase start: confirm `tool_response` vs `tool_result` field name and verify HTTP hook async behavior at Claude Code v2.1.89 — cannot be resolved by documentation alone
- `PostToolUse` hooks must be non-blocking; verify HTTP hooks are fire-and-forget; a synchronous POST adds network latency to every agent step
- `SessionEnd.reason` field must be treated as optional — documented values do not cover all exit paths (GitHub issue #17885)
- Hook installation docs must include a version check asserting Claude Code >= v2.1.89

---

### Phase 4: Launcher UI

**Goal**: A workspace member with write access can click "Start Claude Session" on any task page, get a copyable CLI command pre-seeded with task context and a session token, and see a live pending-state indicator while waiting for the first hook event.
**Depends on**: Phase 2
**Requirements**: LAUNCH-01, LAUNCH-02, LAUNCH-03, LAUNCH-04, LAUNCH-05, LAUNCH-06
**Success Criteria** (what must be TRUE):

1. The "Start Claude Session" button is visible on the task page header for a workspace member with write access; it is absent for read-only members.
2. Clicking the button opens a launcher modal that calls `POST /api/agent-sessions`, displays platform-specific command variants (macOS/Linux Bash and Windows PowerShell), and provides a "Copy to clipboard" primary action — the token is embedded only in the copyable command and is never rendered as visible text.
3. The launcher generates a `--append-system-prompt-file` reference whose content includes the task title, description, and acceptance criteria, truncated intelligently to ~1500 characters.
4. After copying and running the command, if no `SessionStart` event arrives within 30 seconds, the modal surfaces a diagnostic warning with a link to the hook installation instructions.
   **Plans**: TBD
   **UI hint**: yes

**Critical pitfalls to guard:**

- `claude://` deep-link parameter support is LOW confidence — spike before implementing; fall back to "Copy CLI command" if undocumented (research recommends CLI command as primary for v1)
- Token must never appear in the visible modal UI — it lives only in the copyable command string via `env LUMO_SESSION_TOKEN=...` prefix
- Context injection is capped at ~1500 characters with intelligent truncation to prevent an oversized system prompt that degrades Claude's context utilization
- Pending-state polling (30-second timeout warning) is a first-class UX requirement, not a nice-to-have

---

### Phase 5: Sessions Tab UI

**Goal**: Any workspace member can open the Sessions tab on a task page, see all sessions interleaved by origin, expand any session to read its full evidence trail, and watch live events stream in without a page refresh.
**Depends on**: Phases 1, 2, 4
**Requirements**: SESSION-01, SESSION-02, SESSION-03, SESSION-04, SESSION-05, SESSION-06, SESSION-07, SESSION-08, SESSION-09, SESSION-10, SESSION-11, SESSION-12, SESSION-13, SESSION-14, SESSION-15
**Success Criteria** (what must be TRUE):

1. The Sessions tab lists all `AgentSession` records for a task, grouped by day, sorted newest-first, each showing origin badge (`server` | `client`), status pill (`Live` with pulsing dot / `Completed` / `Failed` / `Abandoned`), actor attribution (`Claude Code via Alice`), duration, and event count.
2. Clicking a session row expands an evidence timeline sorted by `sequence ASC`; all seven evidence renderers (commit, file, command, error, test, metadata, tokens) render correctly for their respective event kinds.
3. While a session is `Live`, new events pushed via Pusher appear in the timeline in real-time with auto-scroll; auto-scroll pauses when the user scrolls up, and a "New events" chip appears that jumps to the bottom when clicked.
4. On Pusher reconnect, the client fetches events with `sequence > lastSeenSequence` from `GET /api/agent-sessions/[id]/events` and inserts any missed events without duplication.
5. A workspace member who did not launch the session can open it and read its full evidence trail — the Sessions tab is shared state, not private to the launcher.
   **Plans**: TBD
   **UI hint**: yes

**Critical pitfalls to guard:**

- Import from `lib/integrations/claude-code/` submodules directly in client components — never from the barrel (per b7bc170 lesson)
- Single `task-{taskId}` Pusher channel reuse (not per-session channels) to prevent channel proliferation; `useEffect` cleanup must unsubscribe on unmount
- REST gap-recovery on reconnect: fetch `sequence > lastSeenSequence`, not the full event list
- Initial session list load must use paginated cursor fetch, not an N+1 loop
- All Sessions tab UI strings must be added to all 16 locale files using the existing i18n pattern and locale-aware date formatter

---

### Phase 6: Agent-Server Unification

**Goal**: Server-side `agent-server` sessions write to the same `AgentSession` and `AgentSessionEvent` models, appear interleaved with client-origin sessions in the Sessions tab with identical rendering, and attribute session activity correctly in the task activity timeline.
**Depends on**: Phases 1, 5
**Requirements**: AGENT-01, AGENT-02, AGENT-03, AGENT-04, AGENT-05
**Success Criteria** (what must be TRUE):

1. Running a server-side agent task creates an `AgentSession` record with `origin: 'server'` and appends `AgentSessionEvent` records during execution; the existing `execute.ts`, state machine, MCP tool surface, and `broadcast` calls are unchanged.
2. Server-origin sessions appear in the Sessions tab interleaved with client-origin sessions by timestamp; the only visual difference is the origin badge; all evidence renderers work identically for both origins.
3. Session start and session end for server-origin sessions write entries into the existing task activity timeline attributed as `Claude Code via {launcher display name}` — never flattened to the human actor alone.
4. The agent-server Prisma client is regenerated after the Phase 1 migration and all agent-server Jest tests pass; no new packages are added to `agent-server/`.
   **Plans**: TBD
   **UI hint**: no

**Critical pitfalls to guard:**

- Additive-only changes to `agent-server/`: state machine, MCP tools, and Pusher broadcast calls must remain untouched
- `session-recorder.ts` is the only write path for server-origin events; no other module in agent-server should write directly to `AgentSession` or `AgentSessionEvent`
- Canonical payload shape from `shared/AgentSessionEventPayload` must be enforced in the session-recorder so server-origin events validate against the same Zod schema as client-origin events
- Run the full agent-server Jest suite after any change to `shared/`; agent-server is a separate workspace with its own Prisma client instance

---

## Progress

**Execution Order:** 1 → 2 → 3 → 4 → 5 → 6

| Phase                              | Plans Complete | Status      | Completed |
| ---------------------------------- | -------------- | ----------- | --------- |
| 1. Data Model and Canonical Schema | 0/TBD          | Not started | -         |
| 2. Ingestion API and Hook Auth     | 0/TBD          | Not started | -         |
| 3. Hook Runtime                    | 0/TBD          | Not started | -         |
| 4. Launcher UI                     | 0/TBD          | Not started | -         |
| 5. Sessions Tab UI                 | 0/TBD          | Not started | -         |
| 6. Agent-Server Unification        | 0/TBD          | Not started | -         |
