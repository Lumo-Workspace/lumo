# Architecture Research

**Domain:** Client-side Claude Code session capture integrated into existing Next.js 14 + Prisma + Pusher + agent-server architecture (Lumo)
**Researched:** 2026-04-10
**Confidence:** HIGH (based on direct codebase inspection + official Claude Code hooks documentation)

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  USER'S MACHINE                                                               │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  Claude Code (terminal)                                                  │ │
│  │                                                                          │ │
│  │  env: LUMO_SESSION_ID, LUMO_TASK_ID, LUMO_TOKEN, LUMO_API_URL           │ │
│  │  hooks: PostToolUse, Stop → hook-runtime script                         │ │
│  └──────────────────────────────┬───────────────────────────────────────────┘ │
│                                 │ HTTP POST (batched events + auth token)      │
└─────────────────────────────────┼────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  LUMO MAIN APP (Next.js 14)                                                   │
│                                                                               │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │  API Routes (app/api/)                                                   │ │
│  │                                                                          │ │
│  │  POST /api/agent-sessions          (create session, task page launcher)  │ │
│  │  POST /api/agent-sessions/ingest   (receive hook events, bearer auth)    │ │
│  │  GET  /api/tasks/[taskId]/sessions (list sessions for task page)         │ │
│  │  GET  /api/agent-sessions/[id]/events (event list for expanded session)  │ │
│  │  POST /api/user/session-tokens     (mint short-lived launcher token)     │ │
│  └─────────────────────────┬────────────────────────────────────────────────┘ │
│                             │                                                  │
│  ┌──────────────────────────▼────────────────────────────────────────────────┐ │
│  │  Service Layer (lib/services/)                                            │ │
│  │                                                                          │ │
│  │  agent-session.service.ts  — create, update status, validate token       │ │
│  │  session-ingest.service.ts — classify event kind, persist, publish       │ │
│  └─────────────────────────┬────────────────────────────────────────────────┘ │
│                             │                                                  │
│  ┌──────────────────────────▼────────────────────────────────────────────────┐ │
│  │  Repository Layer (lib/repositories/)                                    │ │
│  │                                                                          │ │
│  │  agent-session.repository.ts — AgentSession CRUD                         │ │
│  │  session-event.repository.ts — AgentSessionEvent append + paginated list │ │
│  └─────────────────────────┬────────────────────────────────────────────────┘ │
│                             │                                                  │
│  ┌──────────────────────────▼────────────────────────────────────────────────┐ │
│  │  Prisma / Neon Postgres                                                  │ │
│  │                                                                          │ │
│  │  AgentSession (id, origin, taskId, workspaceId, launchedByMemberId,      │ │
│  │               claudeSessionId, status, startedAt, endedAt, metadata)     │ │
│  │  AgentSessionEvent (id, sessionId, kind, sequence, createdAt, payload)   │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                             │                                                  │
│  ┌──────────────────────────▼────────────────────────────────────────────────┐ │
│  │  Pusher (lib/integrations/pusher/server.ts — existing)                   │ │
│  │                                                                          │ │
│  │  channel: task-{taskId}                                                  │ │
│  │  event:   session-event  { sessionId, kind, sequence, payload }          │ │
│  │  event:   session-update { sessionId, status }                           │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                             │                                                  │
│  ┌──────────────────────────▼────────────────────────────────────────────────┐ │
│  │  Browser — Sessions Tab (app/workspace/.../components/SessionsTab.tsx)   │ │
│  │                                                                          │ │
│  │  pusher-js subscription on task-{taskId}                                 │ │
│  │  SessionList → SessionCard → EventTimeline (interleaved server+client)   │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│  AGENT-SERVER (separate workspace)                                            │
│                                                                               │
│  execute.ts loop → session-recorder.ts (new, thin wrapper)                   │
│    writes AgentSession + AgentSessionEvent via Prisma                         │
│    existing pushAgentEvent() calls remain unchanged                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow — Both Origins

### Client-side Origin (Claude Code on user's machine)

```
1. User clicks "Start Claude session" button on task page
         │
         ▼
2. Browser calls POST /api/user/session-tokens
   → Service mints ephemeral JWT (15-min TTL) signed with LUMO_TOKEN_SECRET
   → Service creates AgentSession { origin:'client', status:'pending', taskId }
   → Returns: { token, sessionId, taskId, taskContext }
         │
         ▼
3. UI constructs "Copy CLI command" panel:
   LUMO_SESSION_ID=<sessionId> \
   LUMO_TASK_ID=<taskId> \
   LUMO_TOKEN=<jwt> \
   LUMO_API_URL=https://app.uselumo.ai \
   claude --append-system-prompt "$(cat .lumo-context.md)"
         │
         ▼
4. User runs command in their terminal
   Claude Code starts, reads env vars
   Claude Code executes hook script on PostToolUse + Stop events
         │
         ▼
5. Hook runtime (Node.js script) fires on each tool event:
   Reads JSON from stdin { session_id, tool_name, tool_input, tool_response }
   Classifies event kind (bash→command, Write/Edit→file, Bash grep/test→test, etc.)
   Builds payload per kind
   POSTs to LUMO_API_URL/api/agent-sessions/ingest:
     Authorization: Bearer <LUMO_TOKEN>
     Body: { sessionId, events: [{ kind, sequence, payload, claudeSessionId }] }
         │
         ▼
6. POST /api/agent-sessions/ingest
   → Validates Bearer token (JWT verify: correct secret, not expired, sessionId matches)
   → Zod-validates event batch
   → session-ingest.service.ts:
       - Upserts AgentSession status to 'active' if still 'pending'
       - Bulk-inserts AgentSessionEvents
       - Publishes to Pusher channel task-{taskId}: event 'session-event'
         │
         ▼
7. Browser Pusher subscription receives 'session-event'
   SessionsTab state updates → EventTimeline renders new row
```

### Server-side Origin (agent-server execution)

```
1. User triggers "Run Agent" (existing flow — unchanged)
         │
         ▼
2. execute.ts calls createAgentRun() (existing)
   + session-recorder.ts (new):
     createAgentSession({ origin:'server', taskId, launchedByMemberId, workspaceId })
     → persists AgentSession { status:'active' }
         │
         ▼
3. execute.ts runs agent loop (unchanged):
   - fireAgentEvent() calls continue to push to Pusher as today
   - After each tool call (or at key lifecycle events), session-recorder.ts:
     appendSessionEvent(sessionId, { kind, sequence, payload })
     → inserts AgentSessionEvent
     → publishes Pusher 'session-event' on task-{taskId}
         │
         ▼
4. Agent finishes → session-recorder.ts:
   finalizeAgentSession(sessionId, { status:'completed'|'failed', endedAt })
   Existing markRunCompleted() / markFailed() paths untouched
         │
         ▼
5. Browser receives Pusher events (same path as client-side origin)
   Sessions tab shows both origins interleaved by createdAt
```

---

## Prisma Model Proposals

### Rationale: Single Events Table vs. Per-Kind Tables

**Single table (`AgentSessionEvent`) is recommended.** Rationale:

- The query pattern is always "all events for session, ordered by sequence" — never "give me all commits across sessions."
- Discriminated-union payloads via `payload Json` + `kind` enum keeps schema additive: new event kinds require no migration, only a new union branch in TypeScript.
- Per-kind tables (`SessionCommit`, `SessionDiff`, etc.) would require joins for timeline rendering and separate repo methods per kind. That complexity is only warranted if you need to index or aggregate within a kind (e.g., "list all commits across all sessions in a project") — which is explicitly out of scope for v1.
- The tradeoff: `payload Json` is not enforced at the DB layer. Enforcement lives in the Zod schemas and TypeScript discriminated unions in `lib/integrations/claude-code/events.ts`.

### Enums (add to schema.prisma)

```prisma
enum AgentSessionOrigin {
  server
  client
}

enum AgentSessionStatus {
  pending    // created by launcher, not yet receiving events
  active     // receiving events
  completed  // Stop hook fired or agent-server finished normally
  failed     // error terminal state
  abandoned  // token expired without a Stop event (cleaned up by cron)
}

enum AgentSessionEventKind {
  session_start
  session_end
  command       // Bash tool executed
  file_write    // Write tool
  file_edit     // Edit tool
  file_read     // Read tool (only logged if interesting — filtered in hook)
  test          // Bash command matching test pattern (npm test, pytest, etc.)
  error         // tool_response with error signal, or bash exit != 0
  tool_call     // generic catch-all for other tool uses
  commit        // detected from Bash: git commit
  pr_created    // detected from Bash: gh pr create, or via GitHub webhook later
}
```

### AgentSession Model

```prisma
model AgentSession {
  id                  String              @id @default(cuid())
  workspaceId         String              // denormalized for workspace-scoped queries
  taskId              String
  origin              AgentSessionOrigin
  status              AgentSessionStatus  @default(pending)
  launchedByMemberId  String              // WorkspaceMember.id of launcher (human who clicked)
  claudeSessionId     String?             // session_id reported by Claude Code hook (client origin)
  agentRunId          String?             @unique // links to AgentRun for server origin
  startedAt           DateTime            @default(now())
  endedAt             DateTime?
  metadata            Json?               // arbitrary extensible bag; not queried, used for display

  workspace  Workspace       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  task       Task            @relation(fields: [taskId], references: [id], onDelete: Cascade)
  launcher   WorkspaceMember @relation(fields: [launchedByMemberId], references: [id])
  agentRun   AgentRun?       @relation(fields: [agentRunId], references: [id])
  events     AgentSessionEvent[]

  @@index([taskId])
  @@index([workspaceId])
  @@index([launchedByMemberId])
  @@map("agent_sessions")
}
```

**Workspace scoping path:** `AgentSession.workspaceId` is denormalized directly. Authorization check: `requireWorkspaceMember(session.workspaceId, clerkId)`. The `taskId → task → project → workspaceId` path is available for cross-validation but the denormalized field avoids the join on every auth check.

### AgentSessionEvent Model

```prisma
model AgentSessionEvent {
  id        String                @id @default(cuid())
  sessionId String
  kind      AgentSessionEventKind
  sequence  Int                   // monotonically increasing per session; used for ordering + idempotency
  createdAt DateTime              @default(now())
  payload   Json                  // discriminated by kind; see TypeScript union in events.ts

  session AgentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@unique([sessionId, sequence])   // idempotency: re-posting the same sequence is a no-op
  @@index([sessionId, createdAt])
  @@map("agent_session_events")
}
```

**Note:** The `@@unique([sessionId, sequence])` constraint provides idempotency for hook retries without an explicit idempotency key header — the hook can safely re-POST a batch and the DB will reject duplicates via upsert semantics (Prisma `createMany({ skipDuplicates: true })`).

### Linking Events to GitHub PRs

Claude Code's `Bash` tool executes `gh pr create` or `git push` commands. The hook detects these via pattern matching on `tool_input.command`. When a `pr_created` event is captured, its payload includes `{ prUrl, prNumber, branchName }`. The existing `PullRequest` model is the source of truth for GitHub PR state; the session event is the audit trail entry that records _when_ the PR was created in the session context. A `prUrl` field in the event payload is sufficient to link them without a foreign key — adding an FK to `PullRequest` would require coordination between the GitHub webhook path and the session event path, which is unnecessary complexity for v1.

---

## Integration Module Structure

Following the b7bc170 lesson: the barrel (`index.ts`) must never re-export server-only submodules to prevent leakage into client bundles.

```
lib/integrations/claude-code/
├── index.ts          BARREL — exports ONLY: types, launcher (client-safe)
│                     Must NOT export: ingest, token, events (server-only)
├── types.ts          Pure TS types. Client-safe. No imports from server packages.
│                     Exports: AgentSessionOrigin, AgentSessionStatus, AgentSessionEventKind
│                              AgentSessionSummary (for UI list), AgentSessionEventRow (for UI)
├── events.ts         Zod schemas + TS discriminated union for payload per kind.
│                     Client-safe (Zod is isomorphic). Import directly in API route + hook runtime.
│                     Exports: AgentSessionEventPayload (union), sessionEventSchema, ingestBatchSchema
├── launcher.ts       Client-safe. Constructs CLI command string + copy-to-clipboard helper.
│                     No Prisma, no Pusher, no server SDK imports.
│                     Exports: buildLaunchCommand(sessionId, token, taskContext, apiUrl)
├── ingest.ts         SERVER-ONLY. Prisma writes + Pusher publish.
│                     'use server' directive or import guard.
│                     Called only from session-ingest.service.ts. Never imported by client code.
├── token.ts          SERVER-ONLY. JWT mint/verify for hook auth tokens.
│                     Uses: jsonwebtoken or jose. Never exported from barrel.
└── hook-runtime/     Lives outside Next.js. Standalone Node.js script.
    ├── index.ts      Entry point — reads stdin, classifies, POSTs to Lumo.
    ├── classify.ts   Maps tool_name + tool_input → AgentSessionEventKind + payload.
    └── README.md     Setup instructions (copy to ~/.claude/hooks/ or configure in settings.json)
```

**Barrel rule (index.ts):**

```typescript
// lib/integrations/claude-code/index.ts
// ONLY client-safe exports. Server code imports submodules directly.
export type {
  AgentSessionOrigin,
  AgentSessionStatus,
  AgentSessionEventKind,
} from './types'
export type { AgentSessionSummary, AgentSessionEventRow } from './types'
export { buildLaunchCommand } from './launcher'
// DO NOT export: ingest, token, events (contains Zod which is fine, but ingest is not)
```

**Client component imports (correct):**

```typescript
// In SessionsTab.tsx ('use client')
import { buildLaunchCommand } from '@/lib/integrations/claude-code/launcher'
import type { AgentSessionSummary } from '@/lib/integrations/claude-code/types'
// NOT: import { ... } from '@/lib/integrations/claude-code'  ← safe since barrel is limited
```

**Server code imports (correct):**

```typescript
// In session-ingest.service.ts (server only)
import { ingestBatchSchema } from '@/lib/integrations/claude-code/events'
import {
  persistEvents,
  publishToChannel,
} from '@/lib/integrations/claude-code/ingest'
import { verifyHookToken } from '@/lib/integrations/claude-code/token'
```

**hook-runtime/ placement:** The hook script runs on the user's laptop, not inside Next.js. It should live under `agent-server/src/hook-runtime/` or as a standalone package in the monorepo root (`packages/claude-code-hook/`). It shares the Zod schemas from `events.ts` (copy or reference via workspace dependency). It does NOT import from `lib/` — it only reads from stdin and POSTs HTTP. Keep it as a single ~150-line Node.js file that users can install with `npx` or copy manually.

---

## API Route Shapes

### POST /api/agent-sessions

Creates a session record and mints the launcher token. Called by "Start Claude session" button.

```typescript
// Request body (Clerk-authenticated, workspace context from session)
{ taskId: string }

// Response
{
  session: { id: string; taskId: string; status: 'pending' },
  token: string,          // ephemeral JWT; 15-min TTL
  launchCommand: string,  // pre-built CLI invocation string
  taskContext: {          // injected into Claude Code as system prompt / context file
    title: string
    description: string | null
    spec: string | null
    identifier: string    // e.g. "ENG-42"
  }
}
```

### POST /api/agent-sessions/ingest

Receives batched events from hook runtime. Bearer token auth (not Clerk session).

```typescript
// Headers: Authorization: Bearer <jwt>

// Request body (Zod validated)
{
  sessionId: string
  claudeSessionId: string // session_id from Claude Code hook stdin
  events: Array<{
    kind: AgentSessionEventKind
    sequence: number
    payload: AgentSessionEventPayload // discriminated union per kind
  }>
}

// Response
{
  accepted: number
  skipped: number
}
// skipped = duplicates (@@unique constraint hit, skipDuplicates)
// 401 if token invalid/expired
// 403 if sessionId does not match token claims
// 400 if Zod validation fails
```

### GET /api/tasks/[taskId]/sessions

Lists all sessions for a task. Clerk-authenticated, workspace-scoped.

```typescript
// Response
{
  sessions: Array<{
    id: string
    origin: AgentSessionOrigin
    status: AgentSessionStatus
    launchedBy: { memberId: string; name: string; avatarUrl: string | null }
    startedAt: string
    endedAt: string | null
    eventCount: number
    latestEventAt: string | null
    metadata: Record<string, unknown> | null
  }>
}
```

### GET /api/agent-sessions/[id]/events

Paginates events for an expanded session. Clerk-authenticated, workspace-scoped via session.workspaceId.

```typescript
// Query params: ?cursor=<lastEventId>&limit=50

// Response
{
  events: Array<{
    id: string
    kind: AgentSessionEventKind
    sequence: number
    createdAt: string
    payload: AgentSessionEventPayload
  }>
  nextCursor: string | null
}
```

---

## Hook Auth Token Strategy

**Recommendation: ephemeral JWT minted by the launcher, written into the launch command.**

Rationale for each option evaluated:

| Option                                                 | Ship speed                                                                                             | Safety                                                           | Revocability                      | Verdict                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| Clerk session token piped to CLI                       | Slow — Clerk tokens are short-lived JWTs not meant to be copied manually; user must re-auth frequently | Poor — exposes full Clerk session                                | Per-revocation is Clerk's problem | Rejected — Clerk session tokens are not designed to be used as bearer tokens by external scripts |
| Long-lived workspace-scoped token (like `ApiKey`)      | Fast                                                                                                   | Medium — survives indefinitely if leaked                         | Yes, via revoke endpoint          | Rejected for default flow — too powerful, no session binding                                     |
| Per-user personal access token (existing ApiKey model) | Fast — model already exists                                                                            | Medium — long-lived                                              | Yes                               | Acceptable as fallback if user wants persistent CLI setup; NOT the default launcher flow         |
| Ephemeral JWT minted at launch (15-min TTL)            | Fast                                                                                                   | HIGH — short-lived, session-scoped, bound to sessionId in claims | Implicit (expiry)                 | RECOMMENDED for launcher button                                                                  |

**JWT claims structure:**

```json
{
  "sub": "<workspaceMemberId>",
  "sessionId": "<agentSessionId>",
  "workspaceId": "<workspaceId>",
  "taskId": "<taskId>",
  "iat": 1712700000,
  "exp": 1712700900 // 15 minutes
}
```

**Why 15 minutes:** Claude Code sessions typically start within seconds of copying the command. The hook fires continuously during the session, so the token must cover the full session duration. Sessions rarely exceed 15 minutes of active tool use before the first batch posts. If a session runs longer, the hook will receive 401s — the user re-launches from Lumo to get a fresh token.

**FLAG for phase research:** 15 minutes may be too short for long agentic sessions. Consider a "session-scoped refresh" flow where the ingest endpoint returns a new short-lived token on each successful ingest. This avoids requiring re-launch without creating a long-lived credential. Evaluate in Phase C.

**Signing key:** `LUMO_HOOK_TOKEN_SECRET` — new env var, 32-byte random hex, stored in Vercel environment variables. Never the same as `ENCRYPTION_KEY`.

**Existing `ApiKey` model reuse:** The schema already has `ApiKey` with `keyHash`, `keyPrefix`, `revokedAt`. This is suitable for a "persistent hook credential" that power users can configure globally (e.g., `LUMO_TOKEN=$(lumo token generate)` in their shell profile). Offer this as an advanced option in workspace settings. The ephemeral JWT is the default launcher flow.

---

## Launcher Mechanism

**Recommendation: "Copy CLI command" panel (not a deep link).**

**claude-cli:// deep link status (confidence: LOW):** The `claude-cli://` URI scheme is used by Claude Code for OAuth callbacks. There is evidence it exists, but documentation on whether it accepts arbitrary `--append-system-prompt` parameters or arbitrary working directory is absent. Deep links that invoke external processes with user-supplied parameters are also a security surface. Do not rely on this mechanism for v1. Flag for investigation in Phase D.

**Recommended flow:**

1. User clicks "Start Claude session" on task page.
2. Lumo creates `AgentSession` (status: pending), mints JWT, fetches task context.
3. UI shows a panel with:
   - A copyable shell command block:
     ```
     LUMO_SESSION_ID=<id> LUMO_TASK_ID=<taskId> LUMO_TOKEN=<jwt> LUMO_API_URL=https://app.uselumo.ai claude --append-system-prompt "$(cat ~/.claude/lumo-context.md)"
     ```
   - A task context file download button (`lumo-context.md`) containing title, spec, acceptance criteria.
   - A "Copy command" button.
   - Optionally: a QR code or one-liner `curl ... | bash` for first-time hook installation.
4. User pastes the command into their terminal in their project directory.

**Context injection:** The task context reaches Claude Code via `--append-system-prompt`. The content is a Markdown string built by `buildLaunchCommand()` in `launcher.ts`. It includes task title, identifier, description, spec, and a note that the Lumo session is active. A file at `~/.claude/lumo-context.md` (written by the launcher command or a one-time setup script) is the simplest approach; alternatively, inline the context directly in the command string.

**Cross-platform:** Bash environment variable assignment (`VAR=value cmd`) works on macOS and Linux. For Windows users (PowerShell), a separate command variant is needed:

```powershell
$env:LUMO_SESSION_ID="<id>"; $env:LUMO_TOKEN="<jwt>"; claude ...
```

Offer both variants in the UI via a toggle. This is a UI detail, not an architectural blocker.

---

## Hook Runtime Design

**Language: Node.js (single-file script, no build step required).**

Rationale: Claude Code hooks already run in a Node.js environment. A Node.js hook script can be installed as a global npm package (`npm install -g @lumo/claude-hook`) or copied manually. Bash + curl + jq is simpler but harder to maintain as the event classification logic grows. Node.js gives access to the same Zod schemas used in the server.

**Configuration (in Claude Code settings.json or `~/.claude/settings.json`):**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "lumo-hook post-tool-use" }]
      }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "lumo-hook session-end" }] }
    ]
  }
}
```

**Event classification logic (in `hook-runtime/classify.ts`):**

| `tool_name` | `tool_input` pattern               | `kind`       |
| ----------- | ---------------------------------- | ------------ | ---------- | ------ | ---- | ------ | ------------ | ------ |
| `Bash`      | command matches `/git commit/`     | `commit`     |
| `Bash`      | command matches `/gh pr create/`   | `pr_created` |
| `Bash`      | command matches `/(npm             | yarn         | pnpm) test | pytest | jest | vitest | cargo test/` | `test` |
| `Bash`      | exit code != 0 or stderr non-empty | `error`      |
| `Bash`      | (other)                            | `command`    |
| `Write`     | any                                | `file_write` |
| `Edit`      | any                                | `file_edit`  |
| `*`         | any unmatched                      | `tool_call`  |

**Input from Claude Code (stdin):**

```json
{
  "session_id": "abc123",
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test", "description": "Run tests" },
  "tool_response": { "stdout": "...", "stderr": "...", "exitCode": 0 },
  "cwd": "/Users/user/my-project"
}
```

**Payload per kind (TypeScript discriminated union in `events.ts`):**

```typescript
type AgentSessionEventPayload =
  | {
      kind: 'command'
      command: string
      exitCode: number
      stdout: string
      stderr: string
      cwd: string
    }
  | { kind: 'file_write'; filePath: string; contentPreview: string } // first 500 chars
  | {
      kind: 'file_edit'
      filePath: string
      oldSnippet: string
      newSnippet: string
    }
  | {
      kind: 'test'
      command: string
      passed: boolean
      exitCode: number
      output: string
    }
  | { kind: 'error'; tool: string; message: string; exitCode: number | null }
  | { kind: 'commit'; message: string; hash: string | null } // hash extracted from stdout
  | { kind: 'pr_created'; prUrl: string; prNumber: number | null }
  | { kind: 'tool_call'; tool: string; inputSummary: string }
  | {
      kind: 'session_start'
      claudeSessionId: string
      cwd: string
      model?: string
    }
  | { kind: 'session_end'; claudeSessionId: string; reason?: string }
```

**Content size guardrails:** stdout/stderr truncated to 4KB in the hook runtime before POSTing. The Zod schema enforces max length. This prevents accidental large payloads from verbose test output.

---

## Pusher Channel Design

**Recommendation: single channel per task (`task-{taskId}`), not a per-session channel.**

Rationale:

- The Sessions tab is task-scoped. It already subscribes to `task-{taskId}` for other task events.
- Adding a separate `session-{sessionId}` channel would require the browser to subscribe dynamically when a session card is expanded — a re-subscription UX that adds complexity.
- Pusher free tier channel limits are per-connection concurrent channel subscriptions. Keeping all task events on one channel is cheaper.
- The existing agent-server already publishes to `task-{taskId}`. Consistency matters.

**New events on existing channel:**

```typescript
// Added to pusher/types.ts
| { type: 'session:event';  sessionId: string; kind: AgentSessionEventKind; sequence: number; payload: AgentSessionEventPayload; createdAt: string }
| { type: 'session:update'; sessionId: string; status: AgentSessionStatus }
```

The Sessions tab listens for `session:event` and `session:update` alongside existing `agent-update` and `task-update` events. When `session:event` arrives, the tab updates the in-memory event list for that session. When `session:update` arrives, it updates session status (e.g., pending → active, active → completed).

**Fanout on session open:** When a user expands a session card, the initial event list is fetched via `GET /api/agent-sessions/[id]/events`. Subsequent live events arrive via Pusher. No re-subscription needed.

---

## Unifying Agent-Server Origin

**Recommended seam: thin `session-recorder.ts` module in agent-server.**

Rationale:

- The `execute.ts` state machine is already complex (600+ lines in the slice read). Augmenting `broadcast` / `notifyAgentActions` paths would scatter session recording across multiple files.
- A dedicated `session-recorder.ts` is a clean seam: `execute.ts` calls it at four lifecycle moments. The recorder handles Prisma writes and Pusher publishes independently.
- This avoids modifying the existing `markRunCompleted`, `markFailed`, `createAgentRun` functions — minimal change.

**Integration points in execute.ts (four calls, additive only):**

```typescript
// 1. After createAgentRun() — create the session
const agentSession = await recorder.startSession({
  origin: 'server',
  taskId,
  projectId: task.project.id,
  launchedByMemberId: actorMemberId,
  agentRunId: agentRun.id,
})

// 2. After each tool call in the agent loop — append event
await recorder.appendEvent(
  agentSession.id,
  classifyAgentTool(toolName, toolInput, toolResult)
)

// 3. After markRunCompleted() — finalize
await recorder.endSession(agentSession.id, 'completed')

// 4. After markFailed() — finalize
await recorder.endSession(agentSession.id, 'failed')
```

**session-recorder.ts responsibilities:**

- `startSession()` — inserts `AgentSession` with `origin:'server'`, returns id.
- `appendEvent()` — inserts `AgentSessionEvent`, calls `fireSessionEvent()` on Pusher.
- `endSession()` — updates `AgentSession.status` + `endedAt`.
- Does NOT touch `AgentRun`, task status, or existing notification flows.

**Prisma access:** Agent-server has its own Prisma instance (`agent-server/src/db/prisma.ts`) connected to the same Neon Postgres DB. The new `AgentSession` and `AgentSessionEvent` models are in the shared `prisma/schema.prisma`. The agent-server's generated client will include the new models after `prisma generate` runs in both workspaces.

---

## Component Boundaries

| Component                        | Location                                                           | Responsibility                                                                                 | Communicates with                                                           |
| -------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `SessionsTab`                    | `app/workspace/.../components/SessionsTab.tsx`                     | Renders interleaved session list; subscribes to Pusher; manages expand/collapse                | API Client → `agent-sessions.ts`; Pusher subscription                       |
| `SessionCard`                    | `components/task/SessionCard.tsx`                                  | Renders one session: header (origin badge, actor, status, duration); expandable event timeline | `SessionsTab` passes flat props                                             |
| `EventTimeline`                  | `components/task/EventTimeline.tsx`                                | Renders ordered events for one expanded session                                                | `SessionCard` passes event array                                            |
| `LaunchSessionPanel`             | `components/task/LaunchSessionPanel.tsx`                           | "Start Claude session" button → copy command panel                                             | API Client → `agent-sessions.ts`; `buildLaunchCommand()` from `launcher.ts` |
| `agent-sessions.ts` (API Client) | `lib/api-client/agent-sessions.ts`                                 | Type-safe fetch wrapper for all session endpoints                                              | `apiFetch` base                                                             |
| `agent-session.service.ts`       | `lib/services/agent-session.service.ts`                            | Create session, validate launcher token, update status                                         | `agent-session.repository.ts`; `token.ts`                                   |
| `session-ingest.service.ts`      | `lib/services/session-ingest.service.ts`                           | Validate hook token, classify events, persist batch, publish Pusher                            | `session-event.repository.ts`; `ingest.ts`; `token.ts`                      |
| `agent-session.repository.ts`    | `lib/repositories/agent-session.repository.ts`                     | Prisma CRUD for AgentSession                                                                   | Prisma client                                                               |
| `session-event.repository.ts`    | `lib/repositories/session-event.repository.ts`                     | Bulk insert with skipDuplicates, paginated list                                                | Prisma client                                                               |
| `session-recorder.ts`            | `agent-server/src/agent/session-recorder.ts`                       | Thin wrapper — creates/updates AgentSession from agent-server context                          | agent-server Prisma instance; agent-server Pusher `server.ts`               |
| `hook-runtime/`                  | `agent-server/src/hook-runtime/` (or `packages/claude-code-hook/`) | Standalone script — classifies Claude Code hook events, POSTs to ingest API                    | HTTP only — no shared module imports from main app                          |

---

## Build Order

**Critical path:** Data model → Ingest API → Hook runtime → Launcher UI → Sessions tab → Agent-server unification → Handoff.

The ordering ensures each phase produces a shippable integration test surface before the next phase depends on it.

```
Phase A: Data model + Repository
  - Add enums + AgentSession + AgentSessionEvent to prisma/schema.prisma
  - Run migration
  - agent-session.repository.ts + session-event.repository.ts
  - Tests: repository unit tests against in-memory Prisma mock
  - No UI changes. No API changes. Agent-server untouched.
  Dependency: none — standalone foundation

Phase B: Ingest API + Auth token
  - lib/integrations/claude-code/token.ts (JWT mint/verify)
  - lib/integrations/claude-code/events.ts (Zod schemas + payload union)
  - lib/integrations/claude-code/ingest.ts (Prisma + Pusher, server-only)
  - lib/services/agent-session.service.ts + session-ingest.service.ts
  - app/api/agent-sessions/route.ts (POST create session, GET list for admin)
  - app/api/agent-sessions/ingest/route.ts (POST batch events, bearer auth)
  - app/api/user/session-tokens/route.ts (POST mint token)
  - Tests: service unit tests, route integration tests
  Dependency: Phase A

Phase C: Hook runtime
  - agent-server/src/hook-runtime/index.ts + classify.ts
  - Manual integration test: run Claude Code with hook, observe events in DB
  - Validate JWT expiry behavior, test retry idempotency via @@unique constraint
  - RESEARCH FLAG: evaluate token TTL. If 15 min is insufficient, add token refresh
    response header to ingest endpoint (ingest responds with { accepted, skipped, refreshedToken? })
  Dependency: Phase B (ingest endpoint must be live)

Phase D: Launcher UI
  - lib/integrations/claude-code/launcher.ts (buildLaunchCommand, client-safe)
  - LaunchSessionPanel.tsx (button → modal with copy command panel)
  - lib/api-client/agent-sessions.ts (createSession, mintToken API client methods)
  - Task page: add "Start Claude session" button to task detail header/actions area
  - Windows PowerShell variant of command
  - RESEARCH FLAG: investigate claude-cli:// deep link parameters for optional one-click launch
  Dependency: Phase B (session creation endpoint)

Phase E: Sessions tab + Live streaming
  - GET /api/tasks/[taskId]/sessions route + GET /api/agent-sessions/[id]/events route
  - SessionsTab.tsx, SessionCard.tsx, EventTimeline.tsx
  - Pusher session:event / session:update event types in pusher/types.ts
  - lib/api-client/agent-sessions.ts (fetchSessions, fetchEvents methods)
  - End-to-end: run hook → observe live updates in Sessions tab
  Dependency: Phase B (events exist in DB), Phase D (can create sessions from UI)

Phase F: Agent-server unification
  - agent-server/src/agent/session-recorder.ts
  - Four additive call sites in execute.ts (start, appendEvent x N, end)
  - Both origins now appear in Sessions tab
  - Regression test: existing agent execution flow unchanged
  Dependency: Phase A (models exist), Phase E (Sessions tab renders server sessions)

Phase G: Handoff + review features
  - Sessions tab: "Pass to server agent" action (creates AgentRun from session context)
  - Evidence linking: pr_created event payload → link to PullRequest model
  - Activity timeline entries for session_start / session_end
  - Notification: session completed → notify reviewer
  Dependency: Phase E + Phase F
```

---

## Architectural Tradeoffs

### Single events table vs. per-kind tables

**Chosen:** Single `AgentSessionEvent` with `kind` enum + `payload Json`.
**Tradeoff accepted:** No DB-level payload validation. Schema enforcement lives in Zod.
**When to revisit:** If product needs cross-session analytics (e.g., "all commits across all client sessions in project"), add a materialized view or add indexed columns to the event table at that point.

### Ephemeral JWT vs. long-lived ApiKey for hook auth

**Chosen:** Ephemeral JWT for launcher button (15-min TTL); existing ApiKey for advanced/persistent configuration.
**Tradeoff accepted:** If a session runs >15 minutes before first event batch, the token is expired. The hook returns 401 and the user must re-launch.
**Mitigation:** Ingest endpoint can return a refreshed short-lived token in the response body (evaluated in Phase C).

### No per-session Pusher channel

**Chosen:** All session events publish on existing `task-{taskId}` channel.
**Tradeoff accepted:** High-frequency sessions (many tool calls per minute) will flood the task channel. At Lumo's current scale (small teams), this is not a problem. Pusher free tier allows 200 messages/second.
**When to revisit:** If a session generates >100 events/minute, consider a `session-{sessionId}` channel for the duration of the session and fall back to `task-{taskId}` only for status updates.

### Discriminated union payloads vs. strongly-typed relational columns

**Chosen:** `payload Json` with TypeScript discriminated union in application layer.
**Tradeoff accepted:** Postgres cannot enforce payload shape. Migrations are not needed to add new event kinds.
**Mitigation:** Zod validates on ingest. Repository layer uses `z.parse()` before returning events to the service layer.

### Hook runtime location (agent-server vs. separate package)

**Chosen:** `agent-server/src/hook-runtime/` for now; can be extracted to `packages/claude-code-hook/` if it grows or needs separate release cadence.
**Tradeoff accepted:** Coupling hook runtime to the agent-server workspace. The hook runtime does NOT import from agent-server — it is a standalone Node.js script that happens to live in that directory. Moving it later requires no code changes.

### Context injection via --append-system-prompt vs. MCP tool

**Chosen:** `--append-system-prompt` with a task context Markdown string.
**Tradeoff accepted:** The system prompt injection is static — Claude Code does not get live task updates mid-session. For v1, this is acceptable. A future MCP tool `lumo:get_task()` could provide live context, but that requires the user to configure the MCP server separately.
**When to revisit:** If users report that Claude Code makes decisions based on stale task context (e.g., spec was updated after session launch).

---

## Integration Points

### External Services

| Service         | Integration Pattern                                                  | Notes                                                                                             |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Pusher          | Existing `pushAgentEvent()` pattern extended with `session:event`    | Reuse `getPusher()` singleton in agent-server and `lib/integrations/pusher/server.ts` in main app |
| Clerk           | Auth check via existing `requireAuth()` + `requireWorkspaceMember()` | Ingest endpoint skips Clerk — uses JWT bearer token instead                                       |
| Prisma / Neon   | New models added to shared `prisma/schema.prisma`                    | Both main app and agent-server run `prisma generate`                                              |
| Claude Code CLI | Hook configuration in user's `~/.claude/settings.json`               | No server-side changes to Claude Code itself                                                      |

### Internal Boundaries

| Boundary                            | Communication                                                                  | Notes                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Main app ↔ agent-server (new)       | Shared Prisma schema; agent-server writes AgentSession + events directly to DB | No new REST API between them for session recording                       |
| Hook runtime ↔ ingest API           | HTTP POST with bearer JWT                                                      | Hook runtime has no awareness of Prisma schema — it's a pure HTTP client |
| Sessions tab ↔ ingest API           | Pusher real-time for live updates; REST for initial load and pagination        | Same channel as existing task events                                     |
| LaunchSessionPanel ↔ token endpoint | POST /api/user/session-tokens, Clerk session auth                              | Returns JWT + pre-built command string                                   |

---

## Sources

- Lumo codebase direct inspection: `prisma/schema.prisma`, `agent-server/src/agent/execute.ts`, `agent-server/src/pusher/server.ts`, `agent-server/src/agent/state-machine.ts`, `agent-server/src/events/dispatcher.ts`
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — official hook event JSON schemas (HIGH confidence)
- [Claude Code Hook Schemas Gist](https://gist.github.com/FrancisBourre/50dca37124ecc43eaf08328cdcccdb34) — PostToolUse/PreToolUse field details (MEDIUM confidence — community gist, consistent with official docs)
- [claude-cli:// deep link behavior](https://deepwiki.com/claude-code-best/claude-code/12.2-audio-modifiers-and-url-handler) — URL scheme exists for OAuth; parameter support for arbitrary invocations is undocumented (LOW confidence — do not rely on for v1)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) — `--append-system-prompt` flag confirmed (HIGH confidence)

---

_Architecture research for: Lumo Agent Sessions milestone_
_Researched: 2026-04-10_
