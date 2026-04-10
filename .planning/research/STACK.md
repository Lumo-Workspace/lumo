# Stack Research: Claude Code Session Observability in Lumo

**Domain:** Claude Code hook integration + agent session streaming into an existing Next.js 14 PM tool
**Researched:** 2026-04-10
**Confidence:** HIGH (hook mechanism, CLI flags, Pusher transport); MEDIUM (Bash tool_response full schema, SessionEnd fields); LOW (minimum version floor for HTTP hooks — not pinpointed in release notes)

---

## Scope Note

This document covers only the **new pieces** this milestone introduces. The existing Lumo stack (Next.js 14, Prisma, Clerk, Pusher 5.3.3 / pusher-js 8.5.0, Zod 4.3.6, TypeScript strict) is documented in `.planning/codebase/STACK.md` and is not duplicated here.

---

## 1. Claude Code Hook Mechanism

**Confidence: HIGH** — verified against official `code.claude.com/docs/en/hooks` and GitHub plugin SKILL.md.

### Hook Types Available

| Hook Event         | When It Fires                                             | Blocks Execution  | Relevant for Lumo?             |
| ------------------ | --------------------------------------------------------- | ----------------- | ------------------------------ |
| `SessionStart`     | Session begins, resumes, after `/clear`, after compaction | No                | YES — emit session-open event  |
| `PostToolUse`      | After every tool call succeeds                            | No                | YES — primary evidence capture |
| `PreToolUse`       | Before tool executes                                      | Yes (can deny)    | No — observational only needed |
| `Stop`             | Claude finishes responding                                | Yes (can prevent) | No                             |
| `SubagentStop`     | Subagent finishes                                         | Yes (can prevent) | No                             |
| `SessionEnd`       | Session terminates                                        | No                | YES — emit session-close event |
| `UserPromptSubmit` | Before Claude processes user prompt                       | Yes               | No                             |
| `Notification`     | When notification is sent                                 | No                | No                             |
| `PreCompact`       | Before context compaction                                 | No                | No                             |
| `PostCompact`      | After compaction                                          | No                | No                             |

### Recommended Hooks for Lumo

Use exactly three hooks:

1. **`SessionStart`** — POST session-open event to Lumo with `session_id`, `task_id` (from env), `transcript_path`, `cwd`.
2. **`PostToolUse`** (matcher: `Bash|Write|Edit|MultiEdit|Read`) — POST evidence events with tool name, input, and response.
3. **`SessionEnd`** — POST session-close event to Lumo to mark the session terminal.

Do **not** use `PreToolUse` — we need observed evidence, not gating. Do not use `Stop` — it can prevent Claude from stopping.

### Payload Schemas (stdin JSON)

**Common fields — every hook:**

```json
{
  "session_id": "abc123-uuid",
  "transcript_path": "/Users/.../.claude/projects/<slug>/<session-id>.jsonl",
  "cwd": "/Users/user/project",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "agent_id": "(only in subagent context)",
  "agent_type": "(only in subagent context)"
}
```

**SessionStart additional fields:**

```json
{
  "source": "startup|resume|clear|compact",
  "model": "claude-sonnet-4-6"
}
```

`hook_event_name` is `"SessionStart"`. `permission_mode` is absent in some SessionStart contexts — treat as optional.

**PostToolUse additional fields:**

```json
{
  "tool_name": "Bash",
  "tool_use_id": "toolu_01ABC123...",
  "tool_input": { ... },
  "tool_response": { ... }
}
```

**PostToolUse — tool-specific `tool_input` and `tool_response`:**

| Tool                 | `tool_input` fields                                             | `tool_response` fields                                  |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| `Bash`               | `command: string`, `description?: string`, `restart?: boolean`  | `stdout: string`, `stderr: string`, `exit_code: number` |
| `Write`              | `file_path: string`, `content: string`                          | `file_path: string`, `success: boolean`                 |
| `Edit` / `MultiEdit` | `file_path: string`, `old_string: string`, `new_string: string` | `file_path: string`, `success: boolean`                 |
| `Read`               | `file_path: string`, `limit?: number`, `offset?: number`        | `file_path: string`, `content: string`                  |

Note: `tool_response` field name is `tool_response` in some docs and `tool_result` in others — Lumo's Zod schema should accept either key. Confidence: MEDIUM (field names vary slightly across docs; verify with a live test before shipping).

**SessionEnd fields:** SessionEnd fires on session exit (including `/exit`, process kill, natural end). The payload contains the common fields. A `reason` field is documented in the official matchers list (`"clear"`, `"resume"`, `"logout"`, `"prompt_input_exit"`, `"other"`) but may not appear in all exit paths (GitHub issue #17885 shows `/exit` sometimes fires `reason: "exit"` instead). Treat `reason` as optional in Zod schema. Confidence: MEDIUM.

### Settings.json Configuration Format

Claude Code reads hooks from (in precedence order):

```
~/.claude/settings.json           (user-global, all projects)
.claude/settings.json             (project-level, shareable — commit this)
.claude/settings.local.json       (project-local, gitignored)
```

**Recommended:** Ship hooks in `.claude/settings.json` at the project root. This gets committed and is picked up by any team member who clones the repo.

**Structure:**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "http",
            "url": "https://lumo.app/api/agent-sessions/events",
            "timeout": 10,
            "headers": {
              "Authorization": "Bearer $LUMO_SESSION_TOKEN",
              "X-Lumo-Task-Id": "$LUMO_TASK_ID"
            },
            "allowedEnvVars": ["LUMO_SESSION_TOKEN", "LUMO_TASK_ID"]
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|Write|Edit|MultiEdit|Read",
        "hooks": [
          {
            "type": "http",
            "url": "https://lumo.app/api/agent-sessions/events",
            "timeout": 10,
            "headers": {
              "Authorization": "Bearer $LUMO_SESSION_TOKEN",
              "X-Lumo-Task-Id": "$LUMO_TASK_ID"
            },
            "allowedEnvVars": ["LUMO_SESSION_TOKEN", "LUMO_TASK_ID"]
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "https://lumo.app/api/agent-sessions/events",
            "timeout": 10,
            "headers": {
              "Authorization": "Bearer $LUMO_SESSION_TOKEN",
              "X-Lumo-Task-Id": "$LUMO_TASK_ID"
            },
            "allowedEnvVars": ["LUMO_SESSION_TOKEN", "LUMO_TASK_ID"]
          }
        ]
      }
    ]
  }
}
```

**Hook handler types available:**

- `"type": "command"` — shell script, reads stdin JSON, writes stdout
- `"type": "http"` — HTTP POST to URL, receives same JSON as stdin, returns JSON response
- `"type": "prompt"` — single-turn LLM evaluation
- `"type": "agent"` — subagent with tools

**Use `"type": "http"` directly** — it sends the hook payload as the POST body to Lumo's ingestion endpoint. This eliminates the need for a shell-script intermediary, is faster, and requires no additional runtime on the user's machine.

**Environment variable interpolation:** Variables referenced as `$VAR` in `headers` or `url` are only interpolated if listed in `allowedEnvVars`. Any variable not listed silently resolves to empty string — list them explicitly.

**Timeout:** Default is 60 seconds. Use 10 seconds (`"timeout": 10`) for Lumo hooks so a slow/unreachable Lumo server does not block Claude's work. `PostToolUse` is non-blocking (observational) anyway — hook failures don't interrupt Claude.

### Hook Output / Exit Codes

For `PostToolUse` and `SessionEnd` (both non-blocking):

- HTTP hook: 2xx response = success, non-2xx = error logged but Claude continues
- Command hook: exit 0 = success; exit 2 = stderr fed to Claude; other = stderr logged silently

For non-blocking hooks, a failed POST to Lumo only logs a warning — Claude's session is never interrupted.

---

## 2. Session Identification

**Confidence: HIGH** — verified from official hooks docs and CLI reference.

### Session UUID

Every hook payload contains `session_id` — a stable UUID scoped to the current conversation. It:

- Is generated by Claude Code at session start
- Persists across `--resume` (the session keeps its UUID when resumed via `claude --resume <id>`)
- Is exposed in all hook payloads via the `session_id` field
- **Can be pre-set by the launcher** via the `--session-id <UUID>` CLI flag

### Pre-setting Session ID (Critical for Lumo)

The Lumo task page launcher generates a UUID server-side (or client-side), stores it in the pending `AgentSession` record in Prisma, and passes it to Claude Code at launch:

```bash
claude --session-id "550e8400-e29b-41d4-a716-446655440000" \
       --append-system-prompt-file /tmp/lumo-task-context.txt \
       --name "lumo-task-LUM-42"
```

This makes the `session_id` in all hook payloads deterministic — Lumo already has the `AgentSession` row before the session starts. No scraping needed.

### Transcript Storage

Sessions are stored at:

```
~/.claude/projects/<project-path-hash>/sessions/<session-id>.jsonl
```

The `transcript_path` field in every hook payload gives the exact path. Lumo hooks do not need to read this file — the `PostToolUse` payload already contains the evidence. Reading `transcript_path` is only useful if you need narrative reconstruction (out of scope for this milestone).

---

## 3. Evidence Extraction from PostToolUse

**Confidence: HIGH** — verified from hooks docs and plugin SKILL.md.

### Mapping Tool Events to Evidence Types

| Claude Code Tool     | Evidence Type         | Lumo Evidence Key | Key Fields to Extract                                                                           |
| -------------------- | --------------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| `Bash`               | Command executed      | `command`         | `tool_input.command`, `tool_response.stdout`, `tool_response.stderr`, `tool_response.exit_code` |
| `Bash` (git commit)  | Commit event          | `commit`          | Parse `tool_input.command` for `git commit`; extract hash from `stdout`                         |
| `Bash` (git diff)    | Diff                  | `diff`            | Parse `tool_input.command` for `git diff`; `stdout` is the diff                                 |
| `Bash` (test runner) | Test output           | `test_output`     | Parse `tool_input.command` for `npm test`, `jest`, `pytest`, etc.                               |
| `Write`              | File created/replaced | `file_write`      | `tool_input.file_path`, `tool_input.content`                                                    |
| `Edit` / `MultiEdit` | File patched          | `file_edit`       | `tool_input.file_path`, `tool_input.old_string`, `tool_input.new_string`                        |
| `Read`               | File accessed         | `file_read`       | `tool_input.file_path` (content optional — may be large)                                        |

**Git operations:** Claude Code does not have a dedicated git tool — it runs git via `Bash`. Lumo must parse `tool_input.command` to classify git operations. Keep this simple: check if command starts with `git commit`, `git diff`, `git push`, etc. Do not build a full git command parser — a set of string prefix checks is sufficient for v1.

**Test detection:** Similarly pattern-match `tool_input.command` against common test runners (`npm test`, `jest`, `pytest`, `go test`, `cargo test`). `exit_code: 0` = pass, non-zero = fail.

**Do not capture `Read` content** in the database — file content can be arbitrarily large. Store only `file_path` and the timestamp.

---

## 4. Task Context Injection at Launch

**Confidence: HIGH** — verified from official CLI reference at `code.claude.com/docs/en/cli-reference`.

### Canonical Launch Command

The Lumo "Start Claude Session" button generates this shell invocation and opens a terminal:

```bash
LUMO_SESSION_TOKEN="<per-session-ephemeral-token>" \
LUMO_TASK_ID="<task-id>" \
claude \
  --session-id "<pre-generated-uuid>" \
  --name "lumo-LUM-<task-number>" \
  --append-system-prompt-file "/tmp/lumo-task-<uuid>.txt" \
  --permission-mode acceptEdits
```

The context file (`/tmp/lumo-task-<uuid>.txt`) is written by Lumo before launching and contains:

```
Task: LUM-42 — Implement webhook signature verification
Description: <task description>
Acceptance criteria:
- <criterion 1>
- <criterion 2>
Branch: lumo/LUM-42-webhook-signature
```

### Why `--append-system-prompt-file` Over Alternatives

| Approach                                   | Verdict           | Reason                                                                                                                                                                       |
| ------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--append-system-prompt-file`              | **Use this**      | Appends to default prompt; preserves Claude Code's capabilities; accepts multi-line task spec from a file                                                                    |
| `--append-system-prompt`                   | Too limited       | Inline string only; bad for multi-line task specs with acceptance criteria                                                                                                   |
| `--system-prompt` / `--system-prompt-file` | Avoid             | Replaces the entire default prompt — loses Claude Code's built-in tools and context                                                                                          |
| `CLAUDE.md` injection                      | Use as complement | Drop a `.claude/CLAUDE.md` with project conventions; but task-specific context goes in the append flag so it's session-scoped, not committed                                 |
| Environment variables alone                | Insufficient      | No way to pass multi-line text to Claude's context via env vars                                                                                                              |
| `--resume` with pre-seeded session         | Fragile           | Requires the session to exist already on disk; circular                                                                                                                      |
| `$CLAUDE_ENV_FILE` via SessionStart hook   | Complementary     | A `SessionStart` hook command can echo `LUMO_TASK_ID` into `$CLAUDE_ENV_FILE` to make it available to subsequent hooks' env — use this in addition to the system prompt file |

### SessionStart Hook + `$CLAUDE_ENV_FILE` Pattern

The `SessionStart` hook can write environment variables that persist for the session:

```bash
#!/usr/bin/env bash
# .claude/hooks/session-start.sh
echo "LUMO_TASK_ID=${LUMO_TASK_ID}" >> "$CLAUDE_ENV_FILE"
echo "LUMO_SESSION_TOKEN=${LUMO_SESSION_TOKEN}" >> "$CLAUDE_ENV_FILE"
```

This ensures subsequent hooks (PostToolUse, SessionEnd) can read `LUMO_TASK_ID` from the session environment even if the user opens a new terminal tab. However, with the `"type": "http"` hook approach, the env vars are already in headers — this is optional belt-and-suspenders.

---

## 5. Ingestion Transport: Hook → Lumo HTTPS

**Confidence: HIGH** — verified from official hooks docs on HTTP hook type and `allowedEnvVars`.

### Auth Pattern: Ephemeral Bearer Token per Session

**Use an ephemeral, scoped bearer token tied to `(userId, taskId, sessionId)`.** Not a Clerk session token.

**Why not Clerk session tokens:**

- Clerk session JWTs expire (typically 1 hour) and cannot be refreshed from a shell environment without browser interaction
- They require the full Clerk SDK to verify, not a simple HMAC check
- They encode the user's full identity which is over-scoped for a write-only ingestion endpoint

**Why ephemeral bearer tokens:**

- Generated server-side at session launch time, stored in `AgentSession.ingestToken` (hashed with bcrypt or SHA-256)
- Scoped to exactly one `(sessionId, taskId)` pair — compromised token can only write to that session
- No expiry needed during the session lifetime; Lumo can expire them post-`SessionEnd` + grace period (e.g., 1 hour)
- Passed to Claude Code via environment variable (`LUMO_SESSION_TOKEN`) in the launch command
- Referenced in hook headers as `"Authorization": "Bearer $LUMO_SESSION_TOKEN"` with `"allowedEnvVars": ["LUMO_SESSION_TOKEN"]`

**Token lifecycle:**

1. User clicks "Start Claude Session" on task page
2. Lumo API generates UUID token → hashes it → stores in `AgentSession.ingestTokenHash`
3. Lumo returns plaintext token to browser
4. Browser launches Claude Code via deep link or CLI with `LUMO_SESSION_TOKEN=<token>`
5. Hooks POST to Lumo with `Authorization: Bearer <token>`
6. Lumo ingestion route: hash incoming token → compare to `AgentSession.ingestTokenHash` → match → accept

**Ingestion endpoint design:**

```
POST /api/agent-sessions/events
Authorization: Bearer <ephemeral-token>
Content-Type: application/json

{ ...hook payload (session_id, hook_event_name, tool_name, tool_input, tool_response, ...) }
```

The route resolves `AgentSession` from the token, validates the payload with Zod, writes the `AgentSessionEvent` to Prisma, and publishes to Pusher. No Clerk middleware needed on this route — it uses its own token auth.

### Retry / Buffering Story

**Claude Code HTTP hooks do not retry on failure.** If Lumo is unreachable, the event is silently dropped (PostToolUse is non-blocking; exit non-2 just logs). Options for offline resilience:

**Option A (recommended for v1):** Accept lossy delivery. The session transcript in `~/.claude/projects/` is always available as a fallback for reconstruction. Lumo can offer a "import session from transcript" feature later. Do not build a retry layer for v1 — the complexity vs. benefit is poor for an always-connected dev workflow.

**Option B (if reliability required later):** Use a `"type": "command"` hook instead of `"type": "http"`. The shell script can append to a local queue file and a background process (`lumo-hook-relay`) POSTs with retry. Over-engineered for v1.

**Recommendation:** Use `"type": "http"` with a 10-second timeout. Lost events during network outages are acceptable for v1. Add a manual "sync from transcript" import later.

---

## 6. Real-time Fan-out

**Confidence: HIGH** — Pusher integration already exists and is verified from codebase analysis.

### No New Library Needed

Lumo already has:

- `pusher` 5.3.3 (server) — currently in `lib/integrations/pusher/server.ts`
- `pusher-js` 8.5.0 (client) — used by `useRealtimeNotifications()` hook

Both versions are current as of April 2026. No upgrade required.

### Channel Strategy

```
Channel: task-<taskId>          (already exists per INTEGRATIONS.md)
New event: session:event        (new event type added to existing channel)
New event: session:start        (new)
New event: session:end          (new)
```

Do **not** create a separate `session-<sessionId>` channel — it would require the client to subscribe to N channels (one per session). The existing `task-<taskId>` channel is the right scope: the Sessions tab on the task page is already subscribed to that channel.

### Event Flow

```
Claude Code hook fires
  → POST /api/agent-sessions/events (Lumo HTTPS, bearer token auth)
  → API route: verify token → validate Zod → write AgentSessionEvent to Prisma
  → push to Pusher: channel=task-<taskId>, event=session:event, data={sessionId, eventType, ...}
  → pusher-js client in Sessions tab receives event → updates local state
```

### Pusher Event Payload

```typescript
// lib/integrations/pusher/types.ts — add to existing PusherEvent union
{
  type: 'session:event',
  sessionId: string,
  taskId: string,
  eventKind: 'command' | 'file_write' | 'file_edit' | 'file_read' | 'commit' | 'test_output' | 'session_start' | 'session_end',
  origin: 'client',  // distinguishes from server-side agent-server events
  timestamp: string, // ISO 8601
  payload: Record<string, unknown>  // tool-specific fields
}
```

---

## 7. Claude Code Version Floor

**Confidence: MEDIUM** — CLI reference shows `--session-id` flag is current (v2.1.100); HTTP hooks are documented in current docs; exact minimum version for HTTP hooks not pinpointed in release notes.

### Key Version Data Points

| Feature                                           | Verified Available In                             | Confidence |
| ------------------------------------------------- | ------------------------------------------------- | ---------- |
| `PostToolUse`, `SessionStart`, `SessionEnd` hooks | Current (v2.1.100)                                | HIGH       |
| `"type": "http"` hook handler                     | Current docs confirm it; earliest version unclear | MEDIUM     |
| `"type": "command"` hooks                         | Available since hooks feature launch (~v1.x)      | HIGH       |
| `--session-id <UUID>` CLI flag                    | Listed in current CLI reference (v2.1.100)        | HIGH       |
| `--append-system-prompt-file` flag                | Documented, available since v1.0.51               | HIGH       |
| `defer` decision for PreToolUse                   | Requires v2.1.89+ (explicitly documented)         | HIGH       |
| `allowedEnvVars` in HTTP hooks                    | Current docs                                      | MEDIUM     |

**Recommended minimum version floor: Claude Code v2.1.89** (latest stable as of April 2026: v2.1.100). This is the version that introduced `defer` for PreToolUse and is a reasonable proxy for when HTTP hooks and `--session-id` stabilized together.

**Practical enforcement:** Include a version check in the launcher script:

```bash
claude --version  # parse and assert >= 2.1.89
```

Or document the minimum version in Lumo's "Start Claude Session" setup UI and link to `claude update`.

---

## Recommended Stack (New Additions Only)

### Core Technologies

| Technology                   | Version                    | Purpose                            | Why Recommended                                                            |
| ---------------------------- | -------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| Claude Code CLI              | >= 2.1.89                  | Run on user's machine; fires hooks | Stable hook + `--session-id` + HTTP hook support confirmed                 |
| `"type": "http"` hooks       | (built into Claude Code)   | Ship evidence events to Lumo       | Eliminates shell-script intermediary; no extra runtime on user's machine   |
| Pusher (existing)            | server 5.3.3, client 8.5.0 | Fan events to Sessions tab         | Already wired; reuse existing `task-<taskId>` channel with new event types |
| Ephemeral bearer token (new) | n/a — implement in Lumo    | Authenticate hook POSTs            | Scoped per session; no Clerk JWT expiry problem; simple HMAC verify        |

### Supporting Libraries

| Library                                       | Version | Purpose                                          | When to Use                                                                           |
| --------------------------------------------- | ------- | ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Zod (existing)                                | 4.3.6   | Validate hook payloads at ingestion endpoint     | Required — incoming data is untrusted; validate before writing to Prisma              |
| `crypto` (Node built-in)                      | n/a     | Hash/verify ephemeral tokens                     | SHA-256 HMAC for token verification; no new package needed                            |
| `nanoid` or `uuid` (check if already present) | latest  | Generate pre-set session UUIDs and ingest tokens | UUID v4 for session IDs (`--session-id` requires valid UUID); random token for bearer |

### No New Packages Required

The entire hook infrastructure (HTTP hooks, evidence capture, real-time fan-out via Pusher, payload validation via Zod, token auth via Node crypto) can be built with packages already in the Lumo monorepo. The only new concern is the `.claude/settings.json` hook configuration file that gets committed to the repo.

---

## Alternatives Considered

| Decision            | Recommended                                          | Alternative                                      | Why Not                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hook handler type   | `"type": "http"`                                     | `"type": "command"` shell script                 | Shell script adds complexity: must install a runtime (node/python), handle dependency management on user's machine, implement its own HTTP client. HTTP hook calls Lumo directly. |
| Hook auth           | Ephemeral scoped bearer token                        | Clerk session JWT                                | Clerk JWTs expire in ~1 hour; can't refresh from shell; over-scoped for write-only ingestion                                                                                      |
| Hook auth           | Ephemeral scoped bearer token                        | Long-lived API key per workspace                 | Workspace key leakage lets anyone write to any task in the workspace; session-scoped token limits blast radius                                                                    |
| Real-time transport | Existing Pusher                                      | WebSocket server in Next.js                      | Second real-time layer violates project constraint; adds infra complexity                                                                                                         |
| Context injection   | `--append-system-prompt-file`                        | `--system-prompt-file`                           | Replacement flag strips Claude Code's built-in tools and context; append flag is additive                                                                                         |
| Context injection   | `--append-system-prompt-file`                        | `CLAUDE.md` only                                 | `CLAUDE.md` is committed and static — cannot carry per-session task context like task ID and acceptance criteria                                                                  |
| Session ID          | Pre-set via `--session-id` at launch                 | Read from `transcript_path` after session starts | Race condition: hooks fire before Lumo reads the path; also requires filesystem access. Pre-setting is deterministic and clean.                                                   |
| Evidence storage    | Structured `AgentSessionEvent` records per tool call | Full JSONL transcript import                     | Transcript is narrative + reasoning (out of scope); structured records are queryable and match the "artifacts over narrative" decision in PROJECT.md                              |

---

## What NOT to Use

| Avoid                                                     | Why                                                                                                         | Use Instead                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `"type": "command"` shell script hook as ingestion relay  | Adds a runtime dependency on user's machine; requires maintaining a shell script that installs dependencies | `"type": "http"` hook pointing directly at Lumo API                        |
| Clerk session tokens in hook Authorization header         | 1-hour expiry; can't refresh from shell; requires browser; over-scoped                                      | Ephemeral session-scoped bearer token passed via env var at launch         |
| Separate `session-<id>` Pusher channel                    | Requires client to subscribe to unbounded N channels                                                        | Existing `task-<taskId>` channel with new event types                      |
| Second real-time layer (SSE endpoint, custom WebSocket)   | Redundant with existing Pusher infrastructure; violates project constraints                                 | Pusher (existing)                                                          |
| Reading `transcript_path` JSONL for evidence extraction   | File is narrative, not structured evidence; parsing it is brittle                                           | `PostToolUse` hook payload — already contains tool_input and tool_response |
| `--system-prompt` or `--system-prompt-file` (replacement) | Strips all Claude Code built-in tools and behavior; breaks Claude Code                                      | `--append-system-prompt-file` (additive)                                   |
| Git-branch inference for task binding                     | Ambiguous (no branch yet for new tasks; branch names collide; sessions span multiple tasks)                 | Explicit `--session-id` + env var `LUMO_TASK_ID` at launch                 |

---

## Open Questions (LOW Confidence — Needs Verification)

1. **Exact `tool_response` field name:** Some docs say `tool_response`, others say `tool_result`. Write Zod schema to accept both via `.or()` until confirmed by live test. **Action: test with a real Claude Code session before implementing the ingestion route.**

2. **HTTP hook minimum version floor:** The exact Claude Code version where `"type": "http"` was introduced is not pinpointed in release notes. v2.1.89 is a safe floor based on other confirmed features. **Action: test HTTP hooks on v2.1.89 during implementation; fall back to command hook if needed.**

3. **SessionEnd `reason` field:** Documented matcher values (`"clear"`, `"resume"`, `"logout"`, `"prompt_input_exit"`, `"other"`) may not cover all exit paths (GitHub issue #17885 reports `reason: "exit"` appearing in practice). **Action: treat `reason` as optional in Zod schema; do not branch logic on it for v1.**

4. **`tool_response` for Bash — stdout size:** No documented size limit on `stdout`/`stderr` in the hook payload. Long-running commands (e.g., full test suite) could produce megabytes of output. **Action: truncate `stdout`/`stderr` at the ingestion endpoint (e.g., 64KB) before writing to Postgres. Store truncation flag in the event record.**

5. **`SessionStart` hook timing vs. env vars:** If `LUMO_SESSION_TOKEN` and `LUMO_TASK_ID` are passed at launch, they must be in `allowedEnvVars` for the HTTP hook headers to interpolate them. Verify that env vars set in the launch command are accessible to hooks at `SessionStart` time (before any `$CLAUDE_ENV_FILE` writes). **Confidence: HIGH that launch-time env vars are inherited by hook processes, but worth a smoke test.**

---

## Sources

- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — hook types, payload schemas, settings.json format, HTTP hook configuration, allowedEnvVars, exit codes. **HIGH confidence.**
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) — `--session-id`, `--append-system-prompt-file`, `--append-system-prompt`, `--name`, `--permission-mode` flags. **HIGH confidence.**
- [GitHub: anthropics/claude-code plugin SKILL.md](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/hook-development/SKILL.md) — PostToolUse tool_response field schemas (Bash stdout/stderr/exit_code, Write file_path/success, Read content). **HIGH confidence.**
- [GitHub: claude-code-hooks-schemas gist](https://gist.github.com/FrancisBourre/50dca37124ecc43eaf08328cdcccdb34) — schema cross-reference. **MEDIUM confidence (community doc).**
- [Claude Code Releases](https://github.com/anthropics/claude-code/releases) — version v2.1.100 is current as of 2026-04-10; `defer` for PreToolUse requires v2.1.89+ (official docs). **HIGH confidence.**
- [GitHub issue #17885](https://github.com/anthropics/claude-code/issues/17885) — SessionEnd `reason` field inconsistency. **MEDIUM confidence (bug report).**
- [Lumo codebase: .planning/codebase/INTEGRATIONS.md](..//codebase/INTEGRATIONS.md) — existing Pusher channels (`task-{taskId}`), pusher 5.3.3 / pusher-js 8.5.0 versions. **HIGH confidence.**

---

_Stack research for: Claude Code session observability + agent session tracking in Lumo_
_Researched: 2026-04-10_
