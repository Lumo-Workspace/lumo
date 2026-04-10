# Pitfalls Research

**Domain:** Claude Code session capture + unified agent-session tracking in Next.js 14 + Prisma + Clerk + Pusher (Lumo "Agent Sessions" milestone)
**Researched:** 2026-04-10
**Confidence:** HIGH — grounded in official Claude Code hook docs, confirmed CVEs, Lumo's own codebase analysis, Pusher SDK behavior, Prisma/Neon migration docs, and existing brownfield concerns documented in `.planning/codebase/CONCERNS.md`.

---

## Critical Pitfalls

### Pitfall 1: lib/integrations/claude-code/ barrel re-exporting server-only code (THE b7bc170 REPEAT)

**Severity:** CRITICAL

**What goes wrong:**
The new `lib/integrations/claude-code/` module — or whichever path houses the ingestion client, hook utilities, and Pusher wiring — follows the same barrel pattern established for `lib/integrations/slack/` and `lib/integrations/github/`. Client components that import from the barrel get Prisma, Clerk `auth()`, or other server-only modules bundled into the browser chunk. Build fails with `'server-only' cannot be imported from a Client Component module` or `Module not found: Can't resolve 'net'`.

**Why it happens:**
The barrel-only import rule (`"All external code must import from this barrel"`) is enforced for server callers but is incompatible with RSC boundaries. It bit `ProjectSlackDialog.tsx` and `CreateBranchDialog.tsx` immediately post-refactor (commit `b7bc170`). The new sessions module will have at minimum: Pusher event types (client-safe), Pusher client subscription helpers (client-safe), ingestion API client functions (client-safe), and session repository/service calls (server-only, Prisma). If all of these land in a single barrel, client components importing the Pusher types pull in Prisma.

**How to avoid:**
Mirror the pattern enforced after b7bc170: create explicit client-safe submodules that contain no server imports.

```
lib/integrations/claude-code/
  index.ts              # barrel — server callers only (service layer, API routes)
  types.ts              # pure types only — NO server imports — client components import from here
  events.ts             # event shape constants — NO server imports
  pusher-client.ts      # pusher-js subscription helpers — client safe
  ingestion-client.ts   # apiFetch wrappers for the ingestion API — client safe
  session.service.ts    # business logic — server only (uses Prisma via repository)
  session.repository.ts # Prisma queries — server only
```

Client components MUST import from submodules directly:

```typescript
// CORRECT — in a 'use client' component
import { AgentSessionEvent } from '@/lib/integrations/claude-code/types'
import { subscribeToSession } from '@/lib/integrations/claude-code/pusher-client'

// WRONG — will bundle Prisma into the browser
import { AgentSessionEvent } from '@/lib/integrations/claude-code'
```

Add an ESLint rule (or a custom lint check) that forbids barrel imports from `lib/integrations/` inside `'use client'` files.

**Warning signs:**

- Build error mentioning `server-only`, `net`, `dns`, `tls`, or `fs` in a client chunk
- Bundle analyzer showing `@prisma/client` or `@clerk/nextjs/server` in browser bundles
- TypeScript resolves fine locally but Vercel build fails with `Module not found`

**Phase to address:** Data Model phase (when the integrations/claude-code/ directory is first created) — the structure must be right from day one.

---

### Pitfall 2: Hook script checked into .claude/settings.json with hardcoded auth token

**Severity:** CRITICAL

**What goes wrong:**
The hook script that POSTs events to Lumo's ingestion API must authenticate. If the developer puts the token directly in `.claude/settings.json` (committed to the repo) or in the hook shell script itself, the Lumo session token ends up in git history for every contributor who pulls the repo.

**Why it happens:**
Claude Code's hook `command` field accepts a shell string. The quick path is: `"command": "curl -H 'Authorization: Bearer <token>' https://lumo.app/api/agent-sessions/ingest"`. This is also the path that CVE-2025-59536 exploited — malicious `.claude/settings.json` or CLAUDE.md with hook commands that exfiltrate tokens. The Lumo hook author is not an attacker, but the git exposure is equivalent.

**How to avoid:**

- Tokens MUST come from environment variables resolved at runtime, not from the settings file itself.
- Use `allowedEnvVars` in the HTTP hook config so only the named variable is interpolated (per Claude Code docs):
  ```json
  {
    "type": "http",
    "url": "https://lumo.app/api/agent-sessions/ingest",
    "headers": { "Authorization": "Bearer $LUMO_SESSION_TOKEN" },
    "allowedEnvVars": ["LUMO_SESSION_TOKEN"]
  }
  ```
- Or for a command hook: the shell script reads `$LUMO_SESSION_TOKEN` from the environment, never hardcodes it.
- `.claude/settings.local.json` (gitignored) is the correct place for per-developer secrets. Document this explicitly in the launcher UX ("Set `LUMO_SESSION_TOKEN` in your shell profile or `.env.local`").
- Add `.claude/settings.local.json` and any token file patterns to `.gitignore`. Add a pre-commit hook that scans for `LUMO_SESSION_TOKEN=` literal values.

**Warning signs:**

- `git grep -i "lumo_session_token"` or `git grep "Bearer ey"` returns hits in committed files
- The Lumo ingestion token appears in GitHub's secret scanning alerts
- A team member reports they can authenticate as another user (token shared via committed settings)

**Phase to address:** Hook Runtime phase (when the hook script and settings template are authored).

---

### Pitfall 3: Hook script blocks Claude Code synchronously (no async: true)

**Severity:** CRITICAL

**What goes wrong:**
A `PostToolUse` hook that POSTs to Lumo's ingestion API will block the Claude Code agent from proceeding to the next tool call until the HTTP request completes. If the Lumo server is slow, the user's local network has latency, or the endpoint returns a 5xx, the agent sits idle waiting. For a session with hundreds of tool calls, this adds up to minutes of dead time.

**Why it happens:**
Hooks are synchronous by default. Developers reach for `PostToolUse` because it has the tool response data they want to capture. They forget to set `async: true`. According to Claude Code docs: `PostToolUse` is non-blockable (exit code 2 is ignored), and async execution is supported for command hooks — but only if you explicitly set `async: true`.

**How to avoid:**
Always mark the ingestion hook as async:

```json
{
  "type": "command",
  "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/lumo-ingest.sh",
  "async": true
}
```

For HTTP hooks, consider whether the HTTP hook type blocks; if so, use a command hook with async that fires a background process:

```bash
#!/bin/bash
# lumo-ingest.sh — always fire and forget
curl -s -o /dev/null \
  -H "Authorization: Bearer $LUMO_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(cat)" \
  "$LUMO_INGESTION_URL" &
exit 0
```

Keep `SessionStart` and `SessionEnd` hooks non-async (they're fast one-shot events and you want them to complete before the session continues).

**Warning signs:**

- Users report Claude Code feels "laggy" or "stalls" between tool calls
- Hook script takes >500ms (network round-trip to Lumo API under normal conditions should be <200ms; anything higher needs investigation)
- Running `claude --debug` shows hook wait time dominating tool execution time

**Phase to address:** Hook Runtime phase.

---

### Pitfall 4: Cross-workspace event injection via unscoped taskId

**Severity:** CRITICAL

**What goes wrong:**
The ingestion API receives `{ taskId, sessionId, event }` from the hook script. If the API route only verifies that the caller is authenticated (valid Clerk session) but does not verify that `taskId` belongs to the caller's workspace, any authenticated user can inject events into any other workspace's task sessions. This is a cross-tenant data leak.

**Why it happens:**
Clerk's `auth()` tells you who is calling. It does not tell you whether they own the task. The join is: `Clerk userId → WorkspaceMember → Workspace → Project → Task`. All four joins must be verified. The existing pattern in Lumo's `requireWorkspaceMember()` covers Clerk → WorkspaceMember → Workspace, but if the task lookup skips the workspace join, a valid token for workspace A can write into workspace B's task.

**How to avoid:**
In the ingestion API route, after auth, always verify workspace membership before writing:

```typescript
// In app/api/agent-sessions/ingest/route.ts
const { userId } = await requireAuth()
const task = await taskRepository.findById(body.taskId)
if (!task) return notFound()
// CRITICAL: verify the task's workspace matches the authenticated user's workspace
await requireWorkspaceMember(task.project.workspaceId, userId)
// Now safe to write
```

Use Prisma's relational select to fetch `task.project.workspaceId` in a single query rather than chaining calls.

**Warning signs:**

- Integration test: create two workspaces, authenticate as user A, POST to ingest with task from workspace B — should receive 403, not 200
- Missing workspace join in the repository's `findById` select (check that `project: { select: { workspaceId: true } }` is included)

**Phase to address:** Ingestion API phase.

---

### Pitfall 5: Runaway agent generating thousands of events — no rate limit on ingestion endpoint

**Severity:** CRITICAL

**What goes wrong:**
A long Claude Code session with frequent tool calls can generate hundreds of `PostToolUse` events per minute. Without rate limiting, a runaway agent (or a loop bug) can exhaust Neon Postgres connection pool, fill the `AgentSessionEvent` table, and push Pusher past its per-second event limit — all while the developer's machine happily keeps firing.

**Why it happens:**
The existing codebase has no rate limiting on any API routes (documented in `CONCERNS.md`: "Rate Limiting on API Routes — problem: No rate limiting on public API routes"). The ingestion endpoint is a new high-frequency write path that compounds this existing gap.

**How to avoid:**
Apply per-session rate limiting at the ingestion API middleware level using `@vercel/edge-ratelimit` or a sliding window in Redis/Upstash:

```typescript
// Limit: 60 events per session per minute
const key = `ingest:session:${sessionId}`
const { success } = await ratelimit.limit(key)
if (!success) return new Response('Rate limit exceeded', { status: 429 })
```

Additionally, set a per-payload event size cap in the Zod schema:

```typescript
const ingestSchema = z.object({
  sessionId: z.string().uuid(),
  taskId: z.string().cuid(),
  events: z.array(eventSchema).max(50), // batch cap
})
```

For extreme protection, implement a per-session event count circuit breaker: after N events in a session, require a re-auth or throttle writes.

**Warning signs:**

- Neon connection pool exhausted errors in logs
- Pusher "message rate limit exceeded" errors
- `AgentSessionEvent` table growing by >1000 rows/minute for a single sessionId
- Vercel function timeout errors on the ingestion route

**Phase to address:** Ingestion API phase.

---

### Pitfall 6: No idempotency on event ingestion — duplicate events on retry

**Severity:** CRITICAL

**What goes wrong:**
The hook script fires a POST. The network times out. The script retries. Lumo now has two identical events for the same tool call. The Sessions tab shows doubled entries. Sequence numbers are wrong. Downstream analytics double-counts operations.

**Why it happens:**
HTTP retries are the correct behavior for transient network errors. Without a stable event ID on the client side and an idempotency check on the server side, retries always create duplicates.

**How to avoid:**
Generate a stable event ID client-side (deterministic based on `sessionId + sequence + eventType + timestamp`), include it in the POST body, and use `upsert` on the server:

```typescript
// Hook script generates:
// eventId = sha256(sessionId + sequence + toolName + timestamp).slice(0, 32)

// Ingestion route:
await prisma.agentSessionEvent.upsert({
  where: { stableEventId: body.eventId },
  create: { ...eventData },
  update: {}, // no-op on duplicate
})
```

Alternatively, add a `UNIQUE` constraint on `(sessionId, sequence)` and catch Prisma's P2002 conflict error to return 200 (already processed) instead of 500.

**Warning signs:**

- Sessions tab shows duplicate consecutive entries with same tool name and content
- `SELECT COUNT(*), stable_event_id FROM agent_session_events GROUP BY stable_event_id HAVING COUNT(*) > 1` returns rows
- Integration test: POST same event twice, verify only one row exists in DB

**Phase to address:** Ingestion API phase (data model must define the idempotency key at the same time).

---

### Pitfall 7: Session ID instability between hook executions — events scattered across ghost sessions

**Severity:** CRITICAL

**What goes wrong:**
The `session_id` provided in Claude Code hook input is meant to be stable for the duration of a session. However, confirmed bugs exist (GitHub issue #22178, #38575) where saved hook context entries can be written with duplicate UUIDs, corrupting the session graph. On resume, the session ID can become associated with a different transcript chain. If Lumo binds events to a `sessionId` as the primary key, and that ID changes or forks, events from the same logical session are scattered across multiple `AgentSession` records — or silently dropped when the resumed session's ID doesn't match any existing record.

**Why it happens:**
Claude Code's session resume (`--resume`) reconstructs history from transcript JSONL files. Hook messages (added since v2.x) can fork the `parentUuid` chain, causing incomplete history reconstruction. The `session_id` exposed to hooks is derived from this transcript chain and can be affected.

**How to avoid:**

- Never use Claude Code's `session_id` as a mutable primary key in Lumo's database. Instead, use it as a correlation key and bind it to a Lumo-assigned `AgentSession.id` at `SessionStart`.
- On `SessionStart`, create the `AgentSession` record and return a Lumo-assigned session token to the hook via `additionalContext`. Subsequent hooks use the Lumo token, not the Claude session_id, as their binding key.
- Implement a fallback: if a `PostToolUse` event arrives with a `session_id` that has no matching `AgentSession`, create one lazily (orphan session recovery).
- Add a `claudeSessionId` field to `AgentSession` for debugging but never use it as a foreign key reference from events.

**Warning signs:**

- `AgentSession` records with zero events despite a full session running
- Multiple `AgentSession` records with the same `taskId` and overlapping timestamps
- Users report "my session disappeared" after resuming Claude Code with `--resume`

**Phase to address:** Data Model phase.

---

### Pitfall 8: agent-server and ingestion API double-writing the same session events

**Severity:** CRITICAL

**What goes wrong:**
`agent-server` already writes to the database and broadcasts via Pusher. The new Agent Sessions milestone adds a session recorder. If the session recorder writes its own events for agent-server-originated sessions (origin: `server`), and the existing agent-server broadcast also fires, the Sessions tab shows every server-side event twice.

**Why it happens:**
The unification is additive: the existing `notifyAgentActions` and `broadcast` calls in `agent-server/src/pusher/server.ts` remain intact while the new `AgentSession` write path is layered on top. Without an explicit gating condition (`if origin === 'client'`), both paths run.

**How to avoid:**
Define a clear write-path ownership rule at the start of the unification phase:

- `origin: 'client'` sessions are written exclusively via the ingestion API.
- `origin: 'server'` sessions are written exclusively via the modified `agent-server` broadcast path (which gains `AgentSession`/`AgentSessionEvent` writes as part of this milestone).
  Add an integration test: run an agent-server task, assert each event appears exactly once in `AgentSessionEvent`.
  In the service layer, add an `assertNoDuplicate` guard that checks for an existing event by `(sessionId, sequence)` before insert (this doubles as the idempotency guard from Pitfall 6).

**Warning signs:**

- Sessions tab shows every commit/diff/test event twice for server-originated sessions
- `COUNT(*)` on `AgentSessionEvent` for a known server session is exactly 2x expected
- Existing `agent-server` Jest tests pass but the new session recording test shows duplicate rows

**Phase to address:** Agent-Server Unification phase.

---

### Pitfall 9: Pusher channel proliferation — one channel per session across 50 concurrent sessions

**Severity:** MAJOR

**What goes wrong:**
If the Sessions tab subscribes to a dedicated Pusher channel per `AgentSession` (e.g., `session:{sessionId}`), and a task page opens 10 sessions, the browser subscribes to 10 channels. A workspace-level dashboard showing 50 tasks with active sessions subscribes to 50+ channels. Pusher's free tier has a 100-channel limit per connection. Production tiers have higher limits but charge per concurrent channel. This also causes memory leaks if subscriptions are not cleaned up on component unmount.

**Why it happens:**
The natural mapping is one channel per resource. The existing Pusher usage already uses `workspace:{workspaceId}:tasks` and `task:{taskId}` channels — adding `session:{sessionId}` per session multiplies the channel count by the number of active sessions.

**How to avoid:**
Fan out session events on the existing `task:{taskId}` channel using event type namespacing:

```typescript
// Server: push session events on existing task channel
pusher.trigger(`task:${taskId}`, 'session:event', {
  sessionId,
  eventType: 'tool_use',
  payload: { ... },
})
```

Client subscribes to `task:{taskId}` (already subscribed for task updates) and filters by `sessionId` in the event handler. Zero new channels needed.
If session isolation is required (e.g., for large tasks with many sessions), use presence channels scoped to the task page, not per-session channels.
Always clean up channel subscriptions in `useEffect` return:

```typescript
useEffect(() => {
  const channel = pusher.subscribe(`task:${taskId}`)
  channel.bind('session:event', handler)
  return () => {
    channel.unbind('session:event', handler)
    pusher.unsubscribe(`task:${taskId}`)
  }
}, [taskId])
```

**Warning signs:**

- Browser DevTools → Network → WS shows 10+ Pusher subscriptions for a single page
- Pusher dashboard shows connection approaching channel limits
- After navigating away from task page and back, events arrive twice (double subscription without cleanup)
- Memory profiler shows `PusherChannel` objects accumulating without being GC'd

**Phase to address:** Sessions UI phase (design channel topology before implementing the Sessions tab).

---

### Pitfall 10: Pusher delivery is best-effort — no fallback on reconnect means lost events

**Severity:** MAJOR

**What goes wrong:**
Pusher channels deliver events best-effort. If the browser disconnects (tab backgrounded, network blip, page navigation) and reconnects, it misses events that were sent while disconnected. The Sessions tab will show a partial event trail that looks complete but has gaps.

**Why it happens:**
Pusher does not buffer missed events for reconnected clients beyond a very short window. The existing `useRealtimeNotifications` hook already relies on Pusher for task updates — it works for low-frequency events (task status changes) where a gap is tolerable. For high-frequency session events (one per tool call), the gap can be significant.

**How to avoid:**
On Pusher reconnect, trigger a REST fetch of the `AgentSessionEvent` table for the current session from a cursor (the last event sequence number the client received). This fills the gap:

```typescript
pusher.connection.bind('connected', async () => {
  if (lastReceivedSequence > 0) {
    const missed = await agentSessionClient.getEvents(sessionId, {
      after: lastReceivedSequence,
    })
    dispatchMissedEvents(missed)
  }
})
```

Track the last received `sequence` number in the component's state. The Sessions tab is then a hybrid: Pusher for live delivery, REST for gap recovery.

**Warning signs:**

- A session with 50 tool calls shows only 30 in the Sessions tab after reconnecting the browser
- "Loading" spinner appears on the Sessions tab after returning to a long-running session
- No REST fallback endpoint exists for `GET /api/agent-sessions/:id/events?after=N`

**Phase to address:** Sessions UI phase — the REST fallback endpoint must be built as part of the same phase as the Pusher subscription, not deferred.

---

### Pitfall 11: JSON payload bloat in AgentSessionEvent — unbounded command output stored as JSONB

**Severity:** MAJOR

**What goes wrong:**
`PostToolUse` events for the `Bash` tool include `tool_response` which can contain the full stdout/stderr of any shell command. A `make test` that outputs 500KB of test results, or a `cat large-file.txt`, produces a `PostToolUse` event with a 500KB+ JSON payload. Stored as JSONB in Postgres, this bloats the `AgentSessionEvent` table rapidly. Over a 100-event session with several build commands, a single session can consume 50-100MB. Neon's connection pool and Prisma's query planner slow significantly when rows have large JSONB fields.

**Why it happens:**
The hook captures `tool_response` verbatim because it's the simplest implementation. No truncation logic is applied on the client side (in the hook script) or server side (in the ingestion schema).

**How to avoid:**
Apply a two-stage size cap:

1. In the hook script, truncate `tool_response` output before POST:
   ```bash
   # Truncate tool_response to 10KB
   echo "$input" | jq '.tool_response = (.tool_response | tostring | .[0:10240])'
   ```
2. In the Zod ingestion schema, cap the payload field:
   ```typescript
   payload: z.record(z.unknown()).transform(val => {
     const str = JSON.stringify(val)
     if (str.length > 10240)
       return { truncated: true, preview: str.slice(0, 1024) }
     return val
   })
   ```
3. For large artifacts (diffs, test output), store only a content hash + size in the event, and optionally store the full artifact in object storage (S3/Vercel Blob) with a reference.

**Warning signs:**

- Average `AgentSessionEvent` row size exceeds 50KB (check with `SELECT avg(pg_column_size(payload)) FROM agent_session_events`)
- Prisma query time for loading a session's events spikes above 500ms
- Neon storage usage growing faster than expected relative to number of sessions

**Phase to address:** Data Model phase (schema and ingestion schema must enforce this from day one).

---

### Pitfall 12: N+1 queries loading events per session in the Sessions tab

**Severity:** MAJOR

**What goes wrong:**
The Sessions tab loads all `AgentSession` records for a task, then for each session loads its `AgentSessionEvent` list. If the tab queries `agentSessions.findMany({ where: { taskId } })` and then calls `agentSessionEvents.findMany({ where: { sessionId } })` in a loop, a task with 10 sessions triggers 11 DB queries. With the existing `TASK_DETAIL_INCLUDE` pattern in `task.repository.ts` already loading many relations, adding session events in a nested loop compounds the N+1 that already exists for PRs and branches.

**Why it happens:**
The existing `CONCERNS.md` already calls out N+1 patterns in `isDescendant()` and batch PR fetches. The session events relation is a one-to-many on `AgentSession`, and Prisma's `include` on nested one-to-many returns all rows — tempting developers to do an inner loop with separate queries instead.

**How to avoid:**
Always use Prisma's nested `include` to fetch events in the same query as sessions:

```typescript
const sessions = await prisma.agentSession.findMany({
  where: { task: { id: taskId } },
  include: {
    events: {
      orderBy: { sequence: 'asc' },
      take: 100, // cap per session — never load unbounded
    },
  },
  orderBy: { startedAt: 'desc' },
})
```

For the Sessions tab's initial load, return only the most recent N events per session (summary view). Full event history loads lazily on expand.
Add pagination (`cursor`-based) for sessions with >100 events so the initial load is always fast.

**Warning signs:**

- Sessions tab takes >2 seconds to load for a task with >5 sessions
- Prisma query logs show `SELECT ... FROM agent_session_events WHERE session_id = ?` repeated N times in a single request
- Adding a new session to an existing task makes the tab measurably slower (linear scaling indicates N+1)

**Phase to address:** Data Model phase (define the query shape) + Sessions UI phase (enforce pagination at render time).

---

### Pitfall 13: AgentSession Prisma migration locking tables under Neon load

**Severity:** MAJOR

**What goes wrong:**
Adding `AgentSession` and `AgentSessionEvent` models requires a Prisma migration. `CREATE TABLE` is fast. But adding foreign keys, indexes, or enum columns to the `Task` table (e.g., a `latestSessionId` backref) requires `ALTER TABLE`, which acquires an `AccessExclusiveLock`. On Neon's serverless Postgres, even a brief lock can timeout waiting connections in the pool. Prisma's advisory lock (`pg_advisory_lock`) has a known bug in v6.5+ (GitHub issue #27636) where parallel `prisma migrate deploy` processes deadlock each other.

**How to avoid:**

- Add new tables (`AgentSession`, `AgentSessionEvent`) without altering `Task` initially. The relationship is established via `taskId` on `AgentSession` (FK from the new table to the existing `Task` table — this does not lock `Task`).
- If indexes are needed on `AgentSessionEvent`, add them with `CONCURRENTLY` via raw SQL in the migration file after the `CREATE TABLE` statement. Prisma does not generate `CONCURRENTLY` syntax natively; add it manually to the migration SQL file.
- Run `prisma migrate deploy` with a single process in CI. Do not run in parallel.
- Use a direct (non-pooled) connection URL for migrations (Neon docs require this: `DIRECT_URL` env var for Prisma migrate).

**Warning signs:**

- Migration hangs for >30 seconds and then fails with `ERROR: canceling statement due to lock timeout`
- Vercel deployment succeeds but DB migration step times out
- Prisma advisory lock error: `Error: P3009 migrate found failed migrations in the target database`
- Existing tasks fail to load during the migration window

**Phase to address:** Data Model phase (migration strategy must be planned before writing the migration).

---

### Pitfall 14: Event sequence field using createdAt — ordering wrong under concurrent writes

**Severity:** MAJOR

**What goes wrong:**
Using `createdAt` as the ordering field for `AgentSessionEvent` is unreliable. Two events from the same session that arrive within the same millisecond will have the same `createdAt`. Events from different network paths (agent-server and ingestion API writing to the same session) may arrive out of clock order. The Sessions tab renders events in the wrong chronological sequence.

**Why it happens:**
`createdAt` is the default sort field in most Prisma schemas. It works for low-frequency events (one per minute). It breaks for high-frequency events (one per tool call, potentially multiple per second).

**How to avoid:**
Include a client-assigned `sequence` integer (monotonically increasing per session) in every event:

```typescript
// AgentSessionEvent schema
model AgentSessionEvent {
  id        String   @id @default(cuid())
  sessionId String
  sequence  Int      // client-assigned, 0-indexed, monotonically increasing
  // ...
  @@unique([sessionId, sequence]) // idempotency constraint
  @@index([sessionId, sequence])  // ordering index
}
```

The hook script increments a local counter per session. For agent-server-originated events, the server maintains an in-memory counter per session and flushes it to the DB. Sort by `sequence ASC` everywhere, never by `createdAt`.

**Warning signs:**

- Sessions tab shows tool calls out of order (e.g., a `Write` event appearing before the `Read` that triggered it)
- Two events with same `createdAt` and arbitrary sort order
- Users report "the timeline looks wrong"

**Phase to address:** Data Model phase.

---

### Pitfall 15: Diverging event shapes between server-origin and client-origin writes

**Severity:** MAJOR

**What goes wrong:**
The agent-server writes events to `AgentSession` with one shape (`{ type: 'agent_action', action: 'bash', result: '...' }`). The Claude Code hook sends events with Claude Code's native shape (`{ tool_name: 'Bash', tool_input: { command: '...' }, tool_response: '...' }`). The Sessions tab must render both. If the shapes differ, the UI needs two separate rendering paths, and analytics queries must handle two schemas — fragile and expensive to maintain.

**How to avoid:**
Define a canonical `AgentSessionEventPayload` type in `shared/` before writing any event-producing code:

```typescript
// shared/types/agent-session.ts
export type AgentSessionEventType =
  | 'tool_use' // a tool was called (covers both bash in agent-server and PostToolUse in Claude Code)
  | 'session_start'
  | 'session_end'
  | 'file_change'
  | 'test_result'
  | 'error'

export interface AgentSessionEvent {
  type: AgentSessionEventType
  sequence: number
  occurredAt: string // ISO8601, client-side timestamp
  tool?: string // tool name if type === 'tool_use'
  input?: unknown // tool input
  output?: unknown // tool response / result (truncated)
  exitCode?: number
  filePath?: string
  testsPassed?: number
  testsFailed?: number
  error?: string
}
```

Both the agent-server adapter and the Claude Code hook script transform their native event formats into this canonical shape before writing. The ingestion API validates against this canonical Zod schema. The Sessions tab renders one component tree.

**Warning signs:**

- Sessions tab has `if (session.origin === 'server') { ... } else { ... }` blocks with different field access patterns
- `agent_session_events.payload` JSONB column contains rows with two different top-level key sets
- Analytics query (`SELECT payload->>'tool' FROM agent_session_events`) returns null for half the rows

**Phase to address:** Data Model phase (shared type must be defined before agent-server unification and ingestion API are built).

---

### Pitfall 16: Hook script exceptions silently crash — no user-visible error

**Severity:** MAJOR

**What goes wrong:**
If the Lumo ingestion hook script throws an uncaught exception or exits non-zero for a non-blocking event type (`PostToolUse`, `SessionEnd`), Claude Code logs the error to its debug log but shows nothing to the user in the terminal. The session appears to run normally, but zero events are recorded in Lumo. The developer discovers this hours later when they check the Sessions tab and it's empty.

**Why it happens:**
Exit codes other than 0 and 2 are treated as non-blocking errors: the first line of stderr is shown in the transcript, but the agent continues. The hook developer may not see this if they're not watching the Claude Code transcript panel.

**How to avoid:**

- Write the hook script defensively with explicit error trapping and fallback:
  ```bash
  #!/bin/bash
  set -euo pipefail
  # Redirect all errors to a local log — never let them propagate as hook failures
  exec 2>> "$HOME/.lumo/hook-errors.log"
  # Main logic here...
  ```
- On `SessionStart`, do a connectivity check to the Lumo ingestion endpoint and write a visible warning if it fails:
  ```bash
  if ! curl -sf --max-time 2 "$LUMO_INGESTION_URL/health" > /dev/null; then
    echo "WARNING: Lumo ingestion endpoint unreachable — events will not be captured" >&2
  fi
  ```
- Add a UI indicator in the Sessions tab: if a session was started but has zero events after 30 seconds, show "No events received — check hook configuration."

**Warning signs:**

- Sessions tab shows `AgentSession` record with `status: 'running'` but 0 events
- `~/.lumo/hook-errors.log` contains error output (if the defensive logging above is in place)
- Claude Code `--debug` log shows `"hook exited with code 1"` for `PostToolUse` events

**Phase to address:** Hook Runtime phase + Sessions UI phase (add the "zero events" warning indicator).

---

### Pitfall 17: Hook captures PII and secrets in command output

**Severity:** CRITICAL

**What goes wrong:**
The `PostToolUse` event for `Bash` includes `tool_response` — the full stdout of the command. Commands like `printenv`, `cat .env`, `echo $DATABASE_URL`, or `git log --format="%ae %s"` (which outputs email addresses) can appear in tool responses. These get stored in `AgentSessionEvent.payload` and displayed in the Sessions tab to all workspace members. A database password or Anthropic API key captured this way is visible to every team member with workspace access.

**Why it happens:**
Claude Code agents naturally run shell commands. The agent may run `printenv` to debug an environment issue, or `cat package.json` (safe) followed by `cat .env.local` (dangerous). The hook captures both indiscriminately.

**How to avoid:**
Apply a redaction filter in the hook script before POST:

```bash
# Redact common secret patterns from tool_response
redact_secrets() {
  sed -E \
    -e 's/(sk-ant-[a-zA-Z0-9_-]{20,})/[REDACTED_ANTHROPIC_KEY]/g' \
    -e 's/(DATABASE_URL=)[^\s]*/\1[REDACTED]/g' \
    -e 's/(password[=:]["\s]*)[^\s"]+/\1[REDACTED]/gi' \
    -e 's/(Bearer\s+)[a-zA-Z0-9._-]{20,}/\1[REDACTED]/g'
}
echo "$input" | jq --arg redacted "$(echo "$input" | jq -r '.tool_response // ""' | redact_secrets)" \
  '.tool_response = $redacted'
```

Additionally, in the ingestion API, run the payload through a server-side redaction pass before persisting. Do not rely solely on the client-side hook doing the right thing.
Document in the launcher UX that session events capture command output and users should not run commands that output secrets while a Lumo session is active.

**Warning signs:**

- `SELECT payload->'tool_response' FROM agent_session_events LIMIT 100` returns rows containing `sk-ant-` or `DATABASE_URL=`
- A workspace member reports seeing another member's environment variable values in the Sessions tab
- The Neon DB (which already has a `.env.production` credential exposure issue per `CONCERNS.md`) becomes a second vector for credential exposure

**Phase to address:** Hook Runtime phase (redaction in the hook script) + Ingestion API phase (server-side redaction fallback).

---

### Pitfall 18: Clerk identity versus bot identity — launching user's sessions attributed as their own work vs. distinct actor

**Severity:** MAJOR

**What goes wrong:**
The decision is "agents-as-teammates via Clerk identity" but the implementation detail is ambiguous: does Claude Code running under developer Alice's laptop appear as Alice in the activity feed, or as "Claude (Alice's session)"? If it appears as Alice, every automated action (file write, PR creation) looks like Alice did it manually. If it appears as a separate bot identity, you need a secondary identity in Clerk, which the project decided against.

**Why it happens:**
The "agent-as-teammate" concept is correct for the product vision but the rendering rule is not specified. Developer intent and agent action are different things even when the same person launched the session.

**How to avoid:**
Define and enforce a clear attribution rule in the `AgentSession` model:

```prisma
model AgentSession {
  id           String   @id @default(cuid())
  taskId       String
  launchedById String   // the Clerk userId of the person who clicked "Start Claude session"
  origin       Origin   // 'server' | 'client'
  // ...
}
```

In the activity feed renderer, show: `"[Claude Code] via Alice"` (or `"Agent" via Alice`) — not `"Alice"`. The `launchedById` is the accountability anchor (for workspace auth); the display is clearly agent-originated. This matches the existing `agent-server` pattern where agent actions are shown distinctly from human actions.
In the `AgentSession` creation flow, store `launchedById` from the authenticated Clerk session at ingestion time — never trust a `userId` field in the POST body from the hook script.

**Warning signs:**

- Activity feed shows "Alice updated file src/index.ts" when Alice's Claude Code actually made the change
- Workspace members cannot distinguish Alice's manual edits from her Claude Code session's edits
- `launchedById` is missing from the schema, forcing the Sessions tab to show "Unknown" as the actor

**Phase to address:** Data Model phase (model the attribution) + Sessions UI phase (render it correctly).

---

### Pitfall 19: Revocation — user removed from workspace, running session continues writing

**Severity:** MAJOR

**What goes wrong:**
Alice is removed from workspace W. Her Claude Code session is still running locally. Her hook script still has a valid `LUMO_SESSION_TOKEN`. The ingestion API continues to accept events from her session because the token was valid at session start. Alice's session writes to workspace W's data for minutes or hours after her removal.

**Why it happens:**
The session token is a long-lived credential issued at session start. Without a per-request workspace membership check, the token is effectively irrevocable until it expires.

**How to avoid:**
Never use a static session token for the ingestion API. Instead:

1. Issue a short-lived token (30-minute expiry) at session start from the Lumo launcher.
2. Require the hook script to refresh the token using a refresh endpoint that re-checks workspace membership.
3. Alternatively, use the user's Clerk session token directly — Clerk tokens expire and are invalidated server-side when the user is removed.
   On every ingestion request, re-verify workspace membership:

```typescript
// Always re-check — don't cache membership at session start
await requireWorkspaceMember(task.project.workspaceId, userId)
```

**Warning signs:**

- Removed user's events appear in workspace data after their removal timestamp
- Integration test: remove user from workspace, POST event with their token, expect 403

**Phase to address:** Ingestion API phase.

---

### Pitfall 20: Launcher "Start Claude session" button with no detection of Claude Code installation

**Severity:** MAJOR

**What goes wrong:**
The user clicks "Start Claude session." The browser fires a `claude://` deep link. If Claude Code is not installed, the browser either shows nothing (on macOS, the protocol handler silently fails) or shows a generic "No application can open this URL" system dialog. The user has no idea what happened. They click the button again. Nothing.

**Why it happens:**
Browser deep links to custom URL schemes have no success/failure callback. The browser cannot distinguish between "Claude Code opened successfully" and "Claude Code is not installed."

**How to avoid:**

- Show explicit pre-flight instructions in the launcher modal: "Claude Code must be installed. [Check installation →]"
- After firing the deep link, show a status check: "Did Claude Code open? If not, run: `npm install -g @anthropic-ai/claude-code`"
- Implement a "ping" mechanism: the launcher generates a session ID and starts polling for the first event from that session ID. If no event arrives within 30 seconds, show: "Session not received — Claude Code may not be running or the hook may not be configured."
- Link directly to Claude Code installation docs in the launcher UI.

**Warning signs:**

- User reports clicking the button and nothing happening
- Support tickets describing "Start Claude session doesn't work"
- Sessions tab shows an `AgentSession` record in `status: 'pending'` with no events after the timeout window

**Phase to address:** Launcher UI phase.

---

### Pitfall 21: Context injection overflowing Claude Code's context window

**Severity:** MAJOR

**What goes wrong:**
The launcher injects task context into Claude Code at session start (task ID, title, description, acceptance criteria). If the task description is long, the acceptance criteria are detailed, and the launcher also injects workspace context and CLAUDE.md contents, the combined context can exceed Claude's context window or consume so many tokens that the agent has less room for actual work.

**How to avoid:**
Cap context injection to essential fields only:

```
- Task ID: LUM-42
- Title: Add OAuth login
- Description: (first 500 chars)
- Acceptance criteria: (first 1000 chars, bullet points only)
- Lumo session ID: <generated>
- Ingestion endpoint: https://lumo.app/api/agent-sessions/ingest
```

Do not inject: full task history, all comments, all subtasks, workspace-level CLAUDE.md content (Claude Code already reads CLAUDE.md from the repo).
Generate context as a temporary file that Claude Code reads via `--context-file` or as a minimal CLAUDE.md prepend, not as a megaprompt.

**Warning signs:**

- Claude Code's first response mentions "your context is very long" or truncates mid-sentence
- Session token counts in Claude API logs are unusually high at session start
- Users report Claude Code "seems confused about the task" (context overflow causing relevant parts to be pushed out of attention)

**Phase to address:** Launcher UI phase.

---

### Pitfall 22: New Prisma migration in main app colliding with agent-server's separate Prisma client

**Severity:** MAJOR

**What goes wrong:**
The main app (`prisma/schema.prisma`) adds `AgentSession` and `AgentSessionEvent`. The `agent-server` has its own `agent-server/src/db/prisma.ts` pointing at the same Neon database but using a separately generated Prisma client based on `agent-server/prisma/schema.prisma` (if it has its own schema) or the main app's schema (if it shares). If agent-server's generated client is out of date after the main app migration runs, agent-server's Prisma queries fail with schema mismatch errors.

**Why it happens:**
Two Prisma client instances targeting the same database is Lumo's current architecture. Running `prisma migrate deploy` in the main app changes the DB schema. Agent-server must regenerate its client (`prisma generate`) to match.

**How to avoid:**
Define a deployment order contract: main app migration runs first, then agent-server `prisma generate && restart`. Add this to CI/CD.
If agent-server does NOT have its own schema and uses the main app's schema via a shared reference, ensure the shared schema path is correct and agent-server's `prisma generate` is run as part of the main app's build pipeline.
Integration test: after running the migration, start agent-server and verify it can query the new tables without schema mismatch errors.

**Warning signs:**

- Agent-server logs `PrismaClientKnownRequestError: P1012` or `Unknown field 'agentSessions'`
- Agent-server starts successfully but all writes to task-related tables fail after the migration
- Deployment window shows main app green but agent-server red

**Phase to address:** Data Model phase (migration strategy must include agent-server client regeneration).

---

### Pitfall 23: shared/ types change breaking agent-server's own Jest suite

**Severity:** MAJOR

**What goes wrong:**
The `shared/` workspace exports types used by both the main app and agent-server. Adding new types for `AgentSession`, `AgentSessionEvent`, or `Origin` to `shared/` may require modifying existing exports or interfaces. If agent-server's Jest tests import from `shared/` and the type signature changes, agent-server's tests fail even though agent-server's own code is unchanged.

**How to avoid:**

- Use additive-only changes to `shared/` during this milestone: add new types, do not modify existing ones.
- Run `npm test` in `agent-server/` as part of CI after any `shared/` change, not just as part of the main app test suite.
- Add a `CHANGELOG` entry to `shared/` for any breaking change.

**Warning signs:**

- `agent-server` Jest suite fails after a `shared/` commit with TypeScript errors about unexpected type shapes
- `tsc --noEmit` in `agent-server/` fails

**Phase to address:** Agent-Server Unification phase.

---

### Pitfall 24: generate-claude-md CLAUDE.md overwrite wiping the existing project CLAUDE.md

**Severity:** MAJOR

**What goes wrong:**
The GSD tooling includes a `generate-claude-md` script. If this script is run as part of any milestone automation and it overwrites `CLAUDE.md`, it destroys the existing project instructions (coding style, layered architecture rules, git conventions). All agents in subsequent sessions lose the project constraints and begin generating code that violates the enforced patterns.

**How to avoid:**

- Never run `generate-claude-md` without explicit confirmation from the user.
- Add a pre-run check: if `CLAUDE.md` exists and has meaningful content (more than N lines), refuse to overwrite without `--force`.
- Treat `CLAUDE.md` as append-only for milestone-specific additions. Use a dedicated section (e.g., `## Agent Sessions Milestone`) rather than replacing the entire file.
- Add `CLAUDE.md` to the list of files that git pre-commit hooks check for unexpected large diffs.

**Warning signs:**

- `CLAUDE.md` suddenly shrinks (check `git diff HEAD CLAUDE.md`)
- Subsequent code generation ignores TypeScript strict mode or layered architecture rules
- `git log CLAUDE.md` shows an unexpected commit that replaced content

**Phase to address:** Any phase that involves running GSD tooling.

---

### Pitfall 25: i18n strings not added for all 16 locales in the Sessions UI

**Severity:** MINOR

**What goes wrong:**
The Sessions tab, session evidence cards, and launcher modal introduce new UI strings. If these strings are added to `en` locale only and the i18n system falls back to `en` for missing translations, the feature works in English but shows English text to French, Japanese, Arabic, and 13 other locale users — often breaking layout (RTL locales, long German compound words).

**How to avoid:**
Add a CI check that fails if any locale file is missing keys present in `en`. Most i18n libraries (next-intl, i18next) have tools for this: `next-intl` has `createNextIntlPlugin` that can warn on missing keys.
Add all new keys to all 16 locale files at the same time, using `TODO: translate` placeholders that at least render something coherent while professional translation is pending.
Test the Sessions tab in at least one RTL locale (Arabic or Hebrew) and one long-word locale (German) before shipping.

**Warning signs:**

- Missing translation key warning in browser console for non-English locales
- Sessions tab shows English strings embedded in a non-English UI
- RTL locale causes the Sessions tab to render with broken alignment

**Phase to address:** Sessions UI phase.

---

### Pitfall 26: Timestamps in session evidence not using locale-aware formatting

**Severity:** MINOR

**What goes wrong:**
`AgentSessionEvent.occurredAt` and `AgentSession.startedAt` are stored as UTC ISO8601. If the Sessions tab renders them with `new Date().toISOString()` or a non-locale-aware formatter, French users see `4/10/2026, 2:34 PM` (US format), Japanese users see the wrong date order, and RTL users see reversed time components.

**How to avoid:**
The codebase already has "i18n for 16 locales with locale-aware date formatting" (from `PROJECT.md`). Use the same date formatting utility already in use for the activity timeline:

```typescript
// Use the existing locale-aware formatter
import { formatDate } from '@/lib/i18n/date'
// NOT: new Date(event.occurredAt).toLocaleString()
// YES: formatDate(event.occurredAt, locale, { includeTime: true })
```

Check that the existing formatter handles timezone display (UTC vs. user's local timezone) correctly for session timestamps.

**Warning signs:**

- Session timestamps show UTC times when the user's local timezone is UTC-8 (8-hour offset with no indicator)
- Date format is `MM/DD/YYYY` in a French locale (should be `DD/MM/YYYY`)

**Phase to address:** Sessions UI phase.

---

### Pitfall 27: No integration test covering the full hook → ingestion → Prisma → Pusher → browser loop

**Severity:** MAJOR

**What goes wrong:**
Unit tests cover each layer in isolation: ingestion route receives valid payload → writes to DB. Pusher service sends events. UI renders events. But the full E2E path — hook fires, HTTP POST reaches ingestion endpoint, event persisted, Pusher triggered, browser receives event, UI updates — is untested. A subtle misfire in any one layer (wrong channel name, wrong event shape, wrong sequence number handling) causes silent failure in production.

**How to avoid:**
Write at least one integration test that exercises the full loop using a test Pusher instance (or Pusher's test mode) and a test DB:

```typescript
// integration test pseudocode
it('hook event reaches Sessions tab', async () => {
  const session = await createTestSession(taskId)
  await postIngestEvent(session.id, toolUseEvent)
  const dbEvent = await getAgentSessionEvent(session.id, 0)
  expect(dbEvent.type).toBe('tool_use')
  // Verify Pusher event was triggered (check mock/test Pusher capture)
  expect(pusherMock.lastEvent).toMatchObject({ sessionId: session.id })
})
```

Mock Pusher in unit tests but use a real (test channel) Pusher connection in integration tests to catch channel name and event format bugs.

**Warning signs:**

- Unit tests pass, but in development the Sessions tab shows no live events
- Pusher dashboard shows events sent to `session:{id}` channel but UI is subscribed to `task:{taskId}` channel (wrong channel strategy slipping through because no integration test covered the subscription name)

**Phase to address:** Ingestion API phase (the integration test should be written when the full loop first exists).

---

### Pitfall 28: Hooks executing on the wrong session — no session ID filtering in multi-session scenarios

**Severity:** MAJOR

**What goes wrong:**
A developer has two Claude Code windows open: one bound to LUM-42 and one unbound (general coding). Both windows share `~/.claude/settings.json`. The hook fires for both sessions. The unbound session's events are sent to Lumo with the `taskId` for LUM-42 (because the hook script reads `LUMO_TASK_ID` from the environment, which was set in the bound session's shell but is now inherited by the unbound session if launched from the same shell).

**Why it happens:**
Environment variables inherited from a parent shell persist in child processes. If the user opens a second terminal tab from the same shell where `LUMO_TASK_ID` is set, the second Claude Code instance inherits it.

**How to avoid:**
The launcher should set `LUMO_TASK_ID` as a session-scoped variable, not a shell export. Use a temporary file or a socket-scoped mechanism:

```bash
# Launcher generates a unique session config file
LUMO_SESSION_CONFIG="$HOME/.lumo/sessions/$SESSION_ID.env"
echo "LUMO_TASK_ID=$TASK_ID" > "$LUMO_SESSION_CONFIG"
echo "LUMO_SESSION_ID=$SESSION_ID" >> "$LUMO_SESSION_CONFIG"
# Claude Code is launched with this config file as an argument
claude --env-file "$LUMO_SESSION_CONFIG" ...
```

The hook script reads from the config file using the `session_id` from Claude Code's hook input to find the right config file:

```bash
SESSION_CONFIG="$HOME/.lumo/sessions/${session_id}.env"
[ -f "$SESSION_CONFIG" ] && source "$SESSION_CONFIG" || exit 0
```

**Warning signs:**

- Events from an unbound session appearing in the Sessions tab for LUM-42
- `AgentSession` record has events interleaved from two different Claude Code instances

**Phase to address:** Hook Runtime phase + Launcher UI phase (the launcher must set up session-scoped isolation).

---

## Technical Debt Patterns

| Shortcut                                                                | Immediate Benefit                   | Long-term Cost                                                                  | When Acceptable                                                         |
| ----------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Use `createdAt` for event ordering instead of `sequence`                | No client-side counter logic needed | Wrong ordering under concurrent writes or clock skew; breaks timeline rendering | Never — define sequence from day one                                    |
| Store full `tool_response` as JSONB without truncation                  | Simpler hook script                 | Table bloat, slow queries, PII exposure                                         | Never for production data                                               |
| Import from `lib/integrations/claude-code/` barrel in client components | Fewer import statements             | Build failure or Prisma in browser bundle (b7bc170 pattern)                     | Never                                                                   |
| Use static long-lived session token for ingestion auth                  | Simpler launcher UX                 | Irrevocable after user removal; token reuse across workspaces                   | Never for multi-user workspaces                                         |
| Skip idempotency key on ingestion endpoint                              | Simpler server code                 | Duplicate events on every hook retry                                            | Never                                                                   |
| One Pusher channel per session                                          | Clean isolation                     | Channel proliferation, memory leaks, Pusher tier limits                         | Only for <5 concurrent sessions (dev/test)                              |
| Mock Pusher in all tests (no integration test)                          | Fast test suite                     | Ordering bugs and wrong channel names slip to production                        | Acceptable for unit tests; integration test required at full-loop level |
| Defer i18n translation of new strings                                   | Ship faster                         | 16 locales show English strings; RTL layouts break                              | Only if launching to English-only users first, with a tracked TODO      |

---

## Integration Gotchas

| Integration            | Common Mistake                                                    | Correct Approach                                                                                                                |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code hooks      | Relying on `exit 1` to block tool calls                           | Use `exit 2` for blocking; `PostToolUse` is non-blockable regardless                                                            |
| Claude Code hooks      | Setting `async: true` on `SessionStart` and `SessionEnd`          | Keep `SessionStart`/`SessionEnd` synchronous — they're fast, and you need them to complete before the session continues         |
| Claude Code hooks      | Committing `.claude/settings.json` with `Bearer $TOKEN` hardcoded | Use `allowedEnvVars` + shell environment; token from `~/.lumo/session.env`, never in committed settings                         |
| Pusher server SDK      | Importing `pusher` (server) in a client component                 | Only import `pusher-js` in client code; import `pusher` (server) in API routes and services only                                |
| Pusher client SDK      | Not unbinding event handlers on component unmount                 | Always return a cleanup function from `useEffect` that calls `channel.unbind(event, handler)` and `pusher.unsubscribe(channel)` |
| Neon Postgres + Prisma | Using pooled connection URL for `prisma migrate deploy`           | Use `DIRECT_URL` (non-pooled) for migrations; pooled URL for runtime queries                                                    |
| Clerk auth             | Trusting `userId` from POST body for session attribution          | Always derive `userId` from `requireAuth()` server-side; never from client-supplied body                                        |

---

## Performance Traps

| Trap                                                    | Symptoms                                                       | Prevention                                                          | When It Breaks                                  |
| ------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| Loading all `AgentSessionEvent` rows for a session      | Sessions tab slow to open for long sessions                    | Paginate: `take: 100`, cursor-based pagination, lazy-load on expand | >100 events per session                         |
| Subscribing to one Pusher channel per session           | Page slows; Pusher dashboard shows 50+ channels per connection | Fan out on existing `task:{taskId}` channel                         | >10 concurrent sessions visible on one page     |
| Storing untruncated `tool_response` in JSONB            | Neon storage grows fast; query times increase                  | Truncate at hook level + Zod schema cap                             | First `make test` or `cat large-file` captured  |
| Syncing every PostToolUse event to Pusher synchronously | Ingestion API response time spikes under load                  | Use `waitUntil` (Vercel) to fire Pusher after returning 200         | >10 events/second per session                   |
| `createdAt` sort for events                             | Wrong timeline order in Sessions tab                           | `sequence` field with `@@index([sessionId, sequence])`              | First two events arrive within same millisecond |

---

## Security Mistakes

| Mistake                                                           | Risk                                                                       | Prevention                                                                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Token in committed `.claude/settings.json`                        | Credential exposed in git history; any repo clone leaks the token          | `allowedEnvVars` + shell environment only; token in `.claude/settings.local.json` (gitignored)              |
| Unscoped `taskId` in ingestion request                            | Cross-workspace event injection (cross-tenant data leak)                   | Verify `task.project.workspaceId` matches caller's workspace on every request                               |
| Capturing `tool_response` verbatim including `.env` contents      | PII and secrets stored in DB; visible to all workspace members             | Redaction filter in hook script + server-side redaction pass in ingestion service                           |
| Long-lived session token without revocation                       | Removed user continues writing to workspace data                           | Short-lived tokens (30min) + per-request workspace membership check                                         |
| Trust `session_id` from hook as sole source of identity           | Session ID instability (bugs #22178, #38575) allows forged session binding | Assign Lumo session ID server-side at `SessionStart`; treat Claude's `session_id` as correlation-only       |
| `agent-server` hooks injecting context via CVE-2025-59536 pattern | RCE via malicious `.claude/settings.json` or CLAUDE.md in untrusted repos  | Pin to patched Claude Code version (post-August 2025 fix); document "only run Claude Code in trusted repos" |

---

## UX Pitfalls

| Pitfall                                                      | User Impact                                                     | Better Approach                                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| "Start Claude session" fires but Claude Code isn't installed | Silent failure; user confused                                   | Pre-flight detection + install instructions in launcher modal                                 |
| Deep link blocked by browser security                        | User clicks button, nothing happens                             | Offer clipboard-copy fallback for the CLI invocation string                                   |
| Sessions tab shows `AgentSession` record with 0 events       | User thinks session is broken or lost                           | Show "Waiting for events..." with troubleshooting link after 30s                              |
| Session timeline missing events after browser reconnect      | Incomplete audit trail visible to users                         | REST fallback on Pusher reconnect fills gap from last received `sequence`                     |
| Context injection too large                                  | Claude Code starts confused or truncated                        | Cap injection to <2000 tokens; test with typical task descriptions                            |
| Agent events rendered as the launching user's own work       | Team cannot distinguish human from AI edits                     | Always render `[Claude Code] via Alice` — never raw `Alice` for agent-originated events       |
| Cross-machine resume attempted by user                       | User opens session on different machine, session has no context | Clearly label sessions as machine-local; do not imply they can be resumed cross-machine in v1 |

---

## "Looks Done But Isn't" Checklist

- [ ] **Ingestion API**: Workspace membership check present on every request — not just at session creation time
- [ ] **Event deduplication**: `UNIQUE` constraint on `(sessionId, sequence)` and idempotent `upsert` in service layer
- [ ] **Pusher cleanup**: All session-related channels unsubscribed and handlers unbound in `useEffect` cleanup functions
- [ ] **Pusher fallback**: REST polling endpoint exists for gap recovery on reconnect, not just Pusher subscription
- [ ] **Payload truncation**: Both hook-side and server-side truncation are in place — not just one or the other
- [ ] **Secret redaction**: Redaction runs server-side even if hook-side redaction is skipped (defense in depth)
- [ ] **i18n coverage**: All 16 locale files updated before Sessions tab ships (not just `en`)
- [ ] **agent-server deduplication**: Integration test confirms server-origin events appear exactly once, not twice
- [ ] **Session attribution**: `launchedById` populated server-side from `requireAuth()`, never from POST body
- [ ] **Hook async flag**: `PostToolUse` ingestion hook has `async: true` set
- [ ] **Migration direct connection**: `DIRECT_URL` env var used for `prisma migrate deploy` in CI, not pooled connection
- [ ] **shared/ additive-only**: No existing `shared/` type signatures modified, only new types added

---

## Recovery Strategies

| Pitfall                                             | Recovery Cost             | Recovery Steps                                                                                                                                                             |
| --------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Barrel leak into client bundle (Pitfall 1)          | LOW — build fails visibly | Move server-only code to dedicated server submodule; update client component imports                                                                                       |
| Token committed to git (Pitfall 2)                  | HIGH                      | Rotate token immediately; `git filter-branch` or BFG to remove from history; audit for token reuse                                                                         |
| Duplicate events in DB (Pitfall 6)                  | MEDIUM                    | Backfill deduplication: `DELETE FROM agent_session_events WHERE id NOT IN (SELECT min(id) FROM agent_session_events GROUP BY session_id, sequence)`; add UNIQUE constraint |
| Bloated JSONB rows (Pitfall 11)                     | MEDIUM                    | Add truncation; backfill: `UPDATE agent_session_events SET payload = jsonb_set(payload, '{tool_response}', '"[TRUNCATED]"') WHERE length(payload::text) > 10240`           |
| Secrets in session events (Pitfall 17)              | HIGH                      | Redact in-place in DB; notify affected workspace members; treat as a data breach if secrets were production credentials                                                    |
| Wrong Prisma migration blocking tables (Pitfall 13) | HIGH                      | Kill the migration (terminate blocking queries in Neon console); fix migration to use CONCURRENTLY; re-deploy during off-peak                                              |
| Agent-server double-writes (Pitfall 8)              | MEDIUM                    | Add origin-gate in service layer; run deduplication query; add integration test before re-deploying                                                                        |

---

## Pitfall-to-Phase Mapping

| Pitfall                                          | Severity | Prevention Phase                   | Verification                                                                |
| ------------------------------------------------ | -------- | ---------------------------------- | --------------------------------------------------------------------------- |
| barrel re-export (Pitfall 1)                     | CRITICAL | Data Model phase                   | `npx tsc --noEmit` passes; bundle analyzer shows no Prisma in browser chunk |
| token in committed settings (Pitfall 2)          | CRITICAL | Hook Runtime phase                 | `git grep -i "LUMO_SESSION_TOKEN"` returns no committed files               |
| blocking hook (Pitfall 3)                        | CRITICAL | Hook Runtime phase                 | `async: true` present in settings; hook script has background `&`           |
| cross-workspace injection (Pitfall 4)            | CRITICAL | Ingestion API phase                | Integration test: 403 on cross-workspace taskId                             |
| runaway agent / rate limit (Pitfall 5)           | CRITICAL | Ingestion API phase                | Load test: 200 events/min rate-limited at 429                               |
| duplicate events (Pitfall 6)                     | CRITICAL | Ingestion API phase                | Integration test: POST same event twice → 1 row in DB                       |
| session ID instability (Pitfall 7)               | CRITICAL | Data Model phase                   | Lumo-assigned ID used as PK; claudeSessionId is correlation-only            |
| double-write server + client (Pitfall 8)         | CRITICAL | Agent-Server Unification phase     | Integration test: server session has events with `count = expected`         |
| Pusher channel proliferation (Pitfall 9)         | MAJOR    | Sessions UI phase                  | Browser DevTools: 1 channel subscribed per task page (not per session)      |
| Pusher best-effort, no fallback (Pitfall 10)     | MAJOR    | Sessions UI phase                  | REST fallback endpoint exists; reconnect test shows no gap                  |
| JSONB payload bloat (Pitfall 11)                 | MAJOR    | Data Model phase                   | `avg(pg_column_size(payload)) < 5120` bytes after 1-week test               |
| N+1 session event queries (Pitfall 12)           | MAJOR    | Data Model + Sessions UI phase     | Prisma query count for Sessions tab load = 1                                |
| migration table lock (Pitfall 13)                | MAJOR    | Data Model phase                   | Migration completes in <5s on Neon staging; DIRECT_URL configured in CI     |
| wrong sort key (Pitfall 14)                      | MAJOR    | Data Model phase                   | `@@index([sessionId, sequence])` in schema; sort by sequence everywhere     |
| diverging event shapes (Pitfall 15)              | MAJOR    | Data Model phase                   | Single canonical type in `shared/`; both origins pass same Zod schema       |
| silent hook crash (Pitfall 16)                   | MAJOR    | Hook Runtime + Sessions UI phase   | "No events after 30s" warning visible in Sessions tab                       |
| PII / secrets in events (Pitfall 17)             | CRITICAL | Hook Runtime + Ingestion API phase | Regex scan of `agent_session_events.payload` finds no secret patterns       |
| attribution confusion (Pitfall 18)               | MAJOR    | Data Model + Sessions UI phase     | Activity feed shows "Claude Code via Alice" not "Alice"                     |
| revocation gap (Pitfall 19)                      | MAJOR    | Ingestion API phase                | Removed-user token returns 403 on next request                              |
| Claude Code not installed (Pitfall 20)           | MAJOR    | Launcher UI phase                  | Launcher modal includes install link; 30s timeout shows troubleshooting     |
| context overflow (Pitfall 21)                    | MAJOR    | Launcher UI phase                  | Injected context is <2000 tokens; tested with longest task in the codebase  |
| agent-server Prisma client mismatch (Pitfall 22) | MAJOR    | Data Model phase                   | agent-server tests pass after main app migration is applied                 |
| shared/ type break (Pitfall 23)                  | MAJOR    | Agent-Server Unification phase     | agent-server Jest suite runs in CI after every shared/ change               |
| CLAUDE.md overwrite (Pitfall 24)                 | MAJOR    | Any phase                          | `git diff HEAD CLAUDE.md` check before any GSD tooling run                  |
| missing i18n strings (Pitfall 25)                | MINOR    | Sessions UI phase                  | i18n key coverage check passes for all 16 locales                           |
| non-locale timestamps (Pitfall 26)               | MINOR    | Sessions UI phase                  | Sessions tab tested in Arabic (RTL) and German locales                      |
| no full-loop integration test (Pitfall 27)       | MAJOR    | Ingestion API phase                | Integration test exists that exercises hook → DB → Pusher path              |
| wrong session binding (Pitfall 28)               | MAJOR    | Hook Runtime + Launcher UI phase   | Two simultaneous Claude Code windows each bind to separate sessions         |

---

## Sources

- Claude Code official hooks reference: https://code.claude.com/docs/en/hooks (HIGH confidence — authoritative)
- CVE-2025-59536 / CVE-2026-21852 Check Point Research: https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/ (HIGH confidence)
- GitHub issue #22178 — saved_hook_context duplicate UUIDs: https://github.com/anthropics/claude-code/issues/22178 (HIGH confidence)
- GitHub issue #38575 — hook messages corrupt session resume history: https://github.com/anthropics/claude-code/issues/38575 (HIGH confidence)
- GitHub issue #10367 — hooks non-functional in subdirectories: https://github.com/anthropics/claude-code/issues/10367 (HIGH confidence)
- Pusher JS best practices for React: https://github.com/pusher/pusher-js/issues/837 (MEDIUM confidence)
- Neon Postgres migration locks: https://neon.com/blog/postgres-locks-neon-atlas (HIGH confidence)
- Prisma advisory lock bug #27636: https://github.com/prisma/prisma/issues/27636 (HIGH confidence)
- Neon Prisma migrate direct connection requirement: https://neon.com/docs/guides/prisma-migrations (HIGH confidence)
- Lumo codebase concerns (brownfield): `.planning/codebase/CONCERNS.md` — credential exposure, N+1 patterns, rate limiting gaps, RSC boundary issue (HIGH confidence — direct codebase observation)
- Lumo b7bc170 RSC boundary lesson: `.claude/projects/.../memory/project_integrations_barrel_rsc_boundary.md` (HIGH confidence — confirmed by committed fix)
- Idempotency best practices for telemetry ingestion: https://blog.bytebytego.com/p/mastering-idempotency-building-reliable (MEDIUM confidence)

---

_Pitfalls research for: Claude Code session capture + unified agent-session tracking in Lumo_
_Researched: 2026-04-10_
