# Feature Research

**Domain:** AI agent session observability and tracking within a PM tool (Lumo — Agent Sessions milestone)
**Researched:** 2026-04-10
**Confidence:** MEDIUM-HIGH (grounded in Devin, GitHub Copilot, Linear, JetBrains Junie, Atlassian Rovo; some UX specifics inferred from patterns across multiple sources)

---

## Scope note

Lumo already has tasks, projects, workspaces, comments, activity timelines, GitHub + Slack integrations,
and a server-side agent-server. This file covers only the **Agent Sessions** milestone features:
what the "AI agent session tracking" surface looks like in 2025-era dev tools, and what that means
for Lumo.

Out of scope by explicit PROJECT.md decision (do not re-propose):

- Narrative / decision transcripts
- Figma-style live cursor presence ("Claude is editing file X")
- Human-in-the-loop question queue as a dedicated UI
- Agent-agent collaboration surface
- Multi-workspace session sharing

---

## Feature Landscape

### Table Stakes (Users Expect These)

Missing any of these makes the Sessions tab feel broken or untrustworthy.

| Feature                                   | Why Expected                                                                                                                                      | Complexity | Notes                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Session list on the task page**         | Without a list, there is no surface at all. Users need to see all sessions (server + client, by date) attached to a task                          | LOW        | Chronological, grouped by day (Devin, GitHub Copilot pattern). Each row: origin badge (server/client), start time, duration, status (running/completed/failed), initiator name. Collapsed by default; expandable inline.                                                                                         |
| **Origin badge (server vs client)**       | Two session origins exist from day one; a user must be able to tell which is which at a glance                                                    | LOW        | `server` = agent-server ran it; `client` = user's Claude Code session. Display as a small pill: "Server" or "Claude Code". This differentiates Lumo's unified model from single-origin tools.                                                                                                                    |
| **Status indicator: live vs completed**   | A currently-running session demands different affordances (auto-scroll, no "ended X ago") than a historical one                                   | LOW        | "Live" pill + pulsing dot on the session row during active streaming. Auto-scroll to latest evidence item within an expanded live session. On completion, replace pill with duration and end-time. GitHub Copilot's `--follow` CLI flag and Devin's real-time Follow tab both confirm this is expected behavior. |
| **Structured evidence trail per session** | The core product promise: queryable, durable artifacts, not terminal scrollback. Each session must expose the structured event types it captured  | MEDIUM     | Evidence item types (see Evidence Types section). Displayed as a vertical list inside the expanded session row, sorted by time. Each item has an icon, type label, timestamp, and collapsible detail.                                                                                                            |
| **Commits evidence item**                 | Commits are the most concrete proof of agent work. Users expect to see them immediately                                                           | LOW        | Fields: hash (short, linked to GitHub), message, author (agent identity), branch, +N/-N diff stats. Link to PR if one exists. Sourced from PostToolUse hook or agent-server commit events.                                                                                                                       |
| **Files touched evidence item**           | Devs reviewing an agent session want to know which files changed without opening a diff                                                           | LOW        | Fields: path, operation (read/write/rename/delete), size delta. Grouped by operation type.                                                                                                                                                                                                                       |
| **Commands run evidence item**            | Commands are the most common tool-call category; exit code signals success/failure at a glance                                                    | MEDIUM     | Fields: command string (truncated), exit code, stdout tail (last N lines, collapsed), working directory. Exit code 0 = green, non-zero = red.                                                                                                                                                                    |
| **Errors / stack traces evidence item**   | Errors are the most actionable signal — reviewers need to spot them fast                                                                          | LOW        | Fields: error type, message, first 10 lines of stack trace. Shown with red left border for visual triage.                                                                                                                                                                                                        |
| **Session metadata header**               | Without context (model, branch, working directory, initiator), the evidence trail is hard to interpret                                            | LOW        | Display in the session row expansion header: model name, git branch (from session start), working directory, initiated by (user display name), start time, duration.                                                                                                                                             |
| **Agent identity in activity feed**       | Lumo already has an activity timeline. Agent sessions must write entries to it, or the task page looks stale when only agents are working         | MEDIUM     | Each session start/end creates an activity event authored by the agent identity. Linear ships this: agents get a full user profile and appear identically to human users in activity and @mentions.                                                                                                              |
| **Launcher button on task page**          | The canonical v1 binding mechanism (per PROJECT.md). Without it, the client-side session has no task context injected and the feature is unusable | MEDIUM     | "Start Claude session" button that emits a deep-link or CLI command with task context pre-seeded (task_id, session_id, title, description, acceptance criteria). See Launcher UX section.                                                                                                                        |
| **Pusher-driven live updates**            | The task page must update as evidence events arrive, without a manual refresh                                                                     | MEDIUM     | Reuse the existing Pusher transport from agent-server. Each evidence event for an active session fires a channel event; the Sessions tab appends it to the correct session's evidence list in real-time. Already proven in agent-server; extending to client-side events is the new work.                        |
| **Workspace-scoped session visibility**   | Any workspace member can open a past session and read its evidence trail. Lumo's security model is workspace-centric                              | LOW        | No extra work if AgentSession is scoped via task → project → workspace. Read permission = workspace membership. Already how tasks/comments work.                                                                                                                                                                 |

### Differentiators (Competitive Advantage)

These make Lumo's Sessions tab meaningfully better than the status quo (terminal scrollback + manual copy-paste).

| Feature                                                        | Value Proposition                                                                                                                                                                                             | Complexity | Notes                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Unified interleaved session list (server + client)**         | No competing tool does this in 2025. Devin is server-only; GitHub Copilot is cloud-only; Claude Code is terminal-only. Lumo's `origin` discriminator makes both visible in one place                          | MEDIUM     | The interleaving by timestamp makes both origins feel like one team, not two disconnected tools. The origin badge keeps them distinguishable. This is Lumo's core differentiator for this milestone.                                                                                  |
| **Test output evidence item**                                  | Test results are the clearest signal that an agent's work actually worked. Most tools surface commits; few surface test pass/fail alongside them                                                              | MEDIUM     | Fields: pass count, fail count, failing test names, log tail (collapsed). Sourced from PostToolUse (Bash tool running test commands) or agent-server test step output.                                                                                                                |
| **File diff preview evidence item**                            | Devs reviewing agent work want to see the patch inline — not just "file changed"                                                                                                                              | HIGH       | Fields: file path, +N/-N, collapsible unified diff (highlight added/removed lines). Show first 50 lines; "expand full diff" loads the rest. Sourced from agent-server diff events or Claude Code PostToolUse on Write/Edit tools. Start with file-touched; add diff preview in v1.x.  |
| **Tool calls evidence item**                                   | Makes the agent's behavior transparent. Which tools did it use? What did it pass? What did it get back? Devin's Follow tab surfaces this; GitHub Copilot's session logs include it                            | MEDIUM     | Fields: tool name, input summary (truncated JSON), output summary (truncated). Collapsed by default. Not all tools need to be shown — filter out noise (e.g., Read-only file reads on well-known paths).                                                                              |
| **Tokens + cost evidence item**                                | Small teams care about spend. Showing cost per session closes the feedback loop on expensive sessions                                                                                                         | LOW        | Fields: input tokens, output tokens, estimated cost (USD). Source from session metadata (agent-server already has Anthropic SDK response data; client-side can be sent via SessionEnd hook). Display in session header, not inline with evidence items.                               |
| **Session search / filter**                                    | Once a workspace has 20+ sessions, finding "the session where the auth bug was fixed" requires search                                                                                                         | MEDIUM     | Filter bar above session list: by origin (server/client), by status (live/completed/failed), by date range, by initiator. Full-text search over command output and error messages is HIGH complexity — defer to v2. See Anti-features for the search trap.                            |
| **Custom session tags**                                        | Devin ships this (2025 release notes). Allows teams to label sessions by feature, sprint, or epic for later retrieval                                                                                         | LOW        | Text tags attached at session-start (via launcher or API). Filterable in session list. Low build cost, high organizational value for teams running many parallel sessions.                                                                                                            |
| **"Continue this session" launcher**                           | Enables session handoff between teammates. A reviewer can pick up a session with context pre-seeded from the evidence trail                                                                                   | MEDIUM     | Shown as a button on completed sessions. Emits the same deep-link / CLI command as the initial launcher, but pre-seeds the prompt with a summary of what the prior session did and what it left unfinished. Depends on session metadata + structured evidence being machine-readable. |
| **Session-to-commit back-link**                                | GitHub Copilot ships `Agent-Logs-Url` in commit message trailers (March 2026 changelog). Lumo can do this in reverse: show commit hashes in the session evidence trail, each linking to the GitHub commit     | LOW        | Add a `github_commit_url` field to the Commit evidence item. Since Lumo already has GitHub integration, this is a short extension. Makes it trivial to jump from session → diff → PR review.                                                                                          |
| **Differentiate human-initiated vs server-initiated sessions** | Server-initiated = agent-server ran autonomously (e.g., triggered by task state transition). Human-initiated = user clicked "Start Claude session". Both appear in the timeline but users want to distinguish | LOW        | Add an `initiated_by_type` field to AgentSession: `human`                                                                                                                                                                                                                             | `system`. Show in session row metadata. No UI rebuild required — just metadata surfacing. |

### Anti-Features (Explicitly DO NOT Build)

Categorized by source: PROJECT.md decisions + research-grounded additions.

| Feature                                                     | Why Requested                                                                      | Why Problematic                                                                                                                                                                                                             | Alternative                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Narrative / decision transcripts**                        | Devs want to know "what Claude was thinking"                                       | Hard to scan, impossible to filter, generates MB of text per session, and the information is already encoded in the structured evidence (commands, errors, tool calls)                                                      | Tool calls evidence item shows what the agent _did_; errors show where it got stuck. That's enough. _(PROJECT.md decision)_                                                                                                                                                                                               |
| **Figma-style live cursor presence**                        | "Claude is editing file X right now" feels like watching a teammate                | High complexity (sub-second event firehose), and the streaming evidence trail already conveys current activity implicitly via new evidence items appearing                                                                  | Let the evidence trail's live updates serve as the activity signal. _(PROJECT.md decision)_                                                                                                                                                                                                                               |
| **Human-in-the-loop question queue**                        | "Claude is blocked — answer A or B?" as a dedicated surface                        | Not the loudest pain for this milestone; adds real-time bidirectional state that must survive network failures                                                                                                              | Handle via existing Slack integration or PR comments until user demand proves this is the bottleneck. _(PROJECT.md decision)_                                                                                                                                                                                             |
| **Full-text search over command output and stdout**         | Devs want to grep past sessions                                                    | Very expensive to index (command output is unbounded text), and most sessions are short enough that visual scan is sufficient                                                                                               | Filter by session status, origin, and date range is enough for v1. Add search later if users report it as a blocker.                                                                                                                                                                                                      |
| **Real-time agent "thinking" stream**                       | Seeing Claude's reasoning token-by-token is compelling in demos                    | In practice, reasoning streams are noise — teams want outcomes (commits, test results, errors), not inner monologue. GitHub Copilot's session logs include this but users report scanning for actual changes, not reasoning | Tool calls and errors already surface the decision points that matter                                                                                                                                                                                                                                                     |
| **Per-evidence-item comment threads**                       | Reviewers might want to annotate individual commits or errors                      | Adds a comment data model per-evidence-item (not per-session), complicates the read model significantly, and the existing task comment system already handles discussion                                                    | Add a "Comment on session" link that opens the task comment composer pre-filled with the session reference. Reuses existing infrastructure.                                                                                                                                                                               |
| **Agent-agent collaboration surface**                       | Multiple agents working together looks powerful                                    | The pain this milestone solves is human-agent context loss, not agent-agent coordination. agent-server already composes internally via state-machine.ts without needing a UI surface                                        | Extend agent-server's internal composition; expose its output as a single AgentSession. _(PROJECT.md decision)_                                                                                                                                                                                                           |
| **Secret / credential redaction in command output**         | Command output sometimes contains tokens, passwords, or API keys captured from env | Pattern-matching redaction is necessary for _display_, but building a robust secrets scanner is scope-creep for v1.                                                                                                         | For v1: truncate stdout to last N lines (limits exposure surface), and document that users should not run Claude Code with secrets in environment variables without using a secrets manager. Add regex-based redaction for common patterns (AWS key format, `Bearer ` tokens) in v1.x once the evidence schema is stable. |
| **Multi-workspace session sharing / public session links**  | Public sharable links look useful for showcasing agent work                        | Violates Lumo's workspace-centric security model; creates unpredictable access control surface                                                                                                                              | Keep sessions scoped to workspace members only. _(PROJECT.md decision)_                                                                                                                                                                                                                                                   |
| **Inferring task_id from git branch name without launcher** | Seems ergonomic — "if the branch is LUM-42, the session must be for task 42"       | Fails for greenfield tasks (no branch yet), sessions that span multiple tasks, and branches without conventional naming. Creates silent misclassification                                                                   | Launcher-first for v1; explicit binding is the only reliable path. Add branch inference as an optional hint in v1.x. _(PROJECT.md decision)_                                                                                                                                                                              |
| **Rebuilding agent-server**                                 | New code looks cleaner                                                             | agent-server already carries MCP tool surface, task state machine, notification handlers, and Pusher wiring. Rebuild throws away working infrastructure                                                                     | Extend additively. _(PROJECT.md decision)_                                                                                                                                                                                                                                                                                |

---

## Evidence Types — Detail

These are the structured evidence item types the Sessions tab needs to render. Each type maps to one or more Claude Code hook events or agent-server events.

| Evidence Type           | Source                                                           | Required Fields                                                           | Complexity | v1?  |
| ----------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------- | ---- |
| **Commit**              | PostToolUse (git commit), agent-server                           | hash, shortHash, message, author, branch, additions, deletions, githubUrl | LOW        | YES  |
| **File touched**        | PostToolUse (Write/Edit/Read/Rename), agent-server               | path, operation (read/write/rename/delete), sizeDelta                     | LOW        | YES  |
| **Command run**         | PostToolUse (Bash), agent-server                                 | command, exitCode, stdoutTail (last 50 lines), workingDirectory           | MEDIUM     | YES  |
| **Error / stack trace** | PostToolUse (Bash non-zero exit, error output), agent-server     | errorType, message, stackTrace (first 10 lines), source (tool/test)       | LOW        | YES  |
| **Test output**         | PostToolUse (Bash running test commands), agent-server test step | passCount, failCount, failingTestNames, logTail                           | MEDIUM     | YES  |
| **Tool call**           | PostToolUse (all tool types), agent-server                       | toolName, inputSummary, outputSummary, durationMs                         | MEDIUM     | v1.x |
| **Diff preview**        | agent-server diff event, PostToolUse (Write/Edit)                | filePath, additions, deletions, patch (first 50 lines)                    | HIGH       | v1.x |
| **Session metadata**    | SessionStart hook, agent-server session open                     | model, gitBranch, workingDirectory, initiatedBy, taskId, sessionId        | LOW        | YES  |
| **Tokens / cost**       | SessionEnd hook, agent-server session close                      | inputTokens, outputTokens, estimatedCostUsd                               | LOW        | YES  |

Classification rationale: Commit, File touched, Error, and Test output are the four types that answer "did the agent make progress?" — every reviewer asks that first. Tool calls and Diff preview answer "how exactly?" — useful but secondary. Tokens/cost answers "what did this cost?" — important for small teams on usage-based billing.

---

## Launcher UX — Detail

The launcher is the canonical task-binding mechanism. It must:

1. Generate a unique `session_id`
2. Bundle task context (task_id, title, description, acceptance criteria)
3. Open Claude Code on the user's machine with that context pre-seeded

| Approach                                  | How It Works                                                                                                                   | Real-World Precedent                                                           | Complexity | Recommended?                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------- |
| **`claude://` URL scheme deep-link**      | Browser opens `claude://open?q=...&env=...` with task context as query params. Claude Code registers the URL scheme on install | Claude Code already uses `url-handler-napi` for OAuth flows; the scheme exists | LOW        | YES (primary)                                                                                        |
| **"Copy CLI command" button**             | Generates `claude --task-id LUM-42 --session-id abc123 "Work on: <title>"` command string; user pastes into terminal           | GitHub Copilot CLI (`gh agent-task`) uses this pattern                         | LOW        | YES (fallback — for users where URL scheme fails)                                                    |
| **GitHub Copilot-style issue assignment** | Assigning the agent "user" to a task triggers a session automatically                                                          | Linear + Devin integration; GitHub Copilot coding agent                        | HIGH       | NO for v1 — implicit binding via task assignment is lower priority than explicit launcher; add in v2 |

For v1: implement both `claude://` deep-link and "Copy CLI command". Show them in a launcher popover/modal on the task page. The popover also displays the session_id that will be used, so the user knows what to expect in the Sessions tab.

---

## Feature Dependencies

```
[AgentSession Prisma model + origin discriminator]
└── required by ──> [Session list / Sessions tab]
└── required by ──> [Evidence trail (all types)]
└── required by ──> [Live streaming via Pusher]
└── required by ──> [Agent identity in activity feed]

[Claude Code hook integration (PostToolUse, SessionStart, SessionEnd)]
└── required by ──> [Client-side evidence trail]
└── required by ──> [Session metadata header (git branch, model, working dir)]
└── required by ──> [Tokens / cost evidence item]

[Ingestion API endpoint]
└── required by ──> [Claude Code hook integration]
└── required by ──> [Live streaming via Pusher (ingestion triggers Pusher broadcast)]

[Launcher button + session_id generation]
└── required by ──> [Task binding (session knows which task it belongs to)]
└── required by ──> [Claude Code hook integration (hooks POST with session_id + task_id)]

[Structured evidence schema (stable JSON shape per evidence type)]
└── required by ──> [Session search / filter (depends on indexed fields)]
└── required by ──> ["Continue this session" launcher (reads evidence to pre-seed prompt)]
└── required by ──> [Diff preview evidence item (needs filePath + patch fields)]

[Agent identity (Clerk-backed, per workspace)]
└── required by ──> [Agent identity in activity feed]
└── required by ──> [Session-initiated-by display]
└── required by ──> [Future: @mention agent in comments]

[Pusher live streaming]
└── enhances ──> [Live session UX (auto-scroll, Live pill)]
└── required by ──> [Real-time evidence item append]

[Session list (stable)]
└── enables ──> [Session search / filter (add filter bar on top of list)]
└── enables ──> [Custom session tags (tag field on session row)]
└── enables ──> ["Continue this session" launcher (action on completed session row)]
```

### Dependency Notes

- **Evidence schema stability before search:** The session search filter (by file path, command, etc.) requires the evidence items to have consistent JSON shapes with indexed fields. Do not add search until at least two sessions have been ingested end-to-end and the schema is confirmed stable.
- **Launcher before client-side hooks:** Claude Code hooks cannot POST a `task_id` until the launcher has generated and surfaced that `task_id`/`session_id` pair to the user. The launcher is the dependency — hooks are the subscriber.
- **Agent identity before activity feed entries:** Activity feed entries authored by agents require the agent identity to exist in Clerk (or as a workspace-scoped synthetic user). Do not write activity events until the identity model is resolved.
- **Diff preview is independent of file-touched:** File-touched evidence items can ship without diff content. Diff preview is an enhancement that can be added to the same evidence type later — it just requires a `patch` field and a diff-rendering component.

---

## MVP Definition

### Launch With (v1)

Minimum needed to prove the core value: "work done in Claude Code flows into the bound Lumo task automatically — live, queryable, no manual ferrying."

- [ ] **AgentSession model** with `origin`, `taskId`, `sessionId`, `status`, `initiatedBy`, `startedAt`, `endedAt` — foundation everything else sits on
- [ ] **Ingestion API** — authenticated endpoint receiving evidence events from Claude Code hooks and agent-server; writes to `AgentSession` + evidence child records; broadcasts via Pusher
- [ ] **Claude Code hook integration** — `SessionStart`, `SessionEnd`, `PostToolUse` hooks POSTing to the ingestion API; packaged as installable hook config
- [ ] **Launcher button on task page** — generates `session_id`, surfaces `claude://` deep-link and "Copy CLI command" fallback
- [ ] **Sessions tab on task page** — list of all sessions for the task, grouped by day, expandable rows, origin badge, status indicator (Live pill / completed)
- [ ] **Evidence trail: Commit, File touched, Command run, Error, Test output, Session metadata, Tokens/cost** — seven evidence types cover the primary reviewer questions
- [ ] **Live streaming** — Pusher events append evidence items to the open session in real-time; auto-scroll while live; stop auto-scroll when user scrolls up
- [ ] **Agent identity in activity feed** — session start/end writes an activity event with agent actor; visible in existing activity timeline

### Add After Validation (v1.x)

Add once at least one full team is using v1 and has reported friction.

- [ ] **Tool calls evidence item** — when users ask "what exactly did the agent do?" more often than "did it succeed?"
- [ ] **Diff preview evidence item** — when reviewers report opening GitHub just to see the patch inline
- [ ] **"Continue this session" launcher** — when handoff between teammates is reported as a friction point
- [ ] **Session filter bar** — when a workspace accumulates 20+ sessions and "finding the right one" becomes a complaint
- [ ] **Custom session tags** — when teams are running parallel workstreams and need organizational labels
- [ ] **Secret redaction (regex-based)** — once evidence schema is stable and the exposure surface is clear
- [ ] **Session-to-commit back-link** — extend Commit evidence item with `githubCommitUrl` once confirmed developers click through to GitHub

### Future Consideration (v2+)

Defer until post-milestone review confirms demand.

- [ ] **Full-text search over command output** — index is expensive; validate demand first with filter bar
- [ ] **Branch-name inference as supplemental task binding** — only after launcher pattern proves insufficient
- [ ] **Agent assignment on task (triggers auto-session)** — implicit binding via task assignment; requires agent identity to be mature and users to trust the launcher flow first
- [ ] **Per-session annotation / comment** — structured review UX; validate whether task-level comments are sufficient first
- [ ] **Tokens / cost analytics roll-up** — aggregate cost per project / per week; useful once teams are running many sessions

---

## Feature Prioritization Matrix

| Feature                          | User Value | Implementation Cost | Priority |
| -------------------------------- | ---------- | ------------------- | -------- |
| AgentSession model               | HIGH       | LOW                 | P1       |
| Ingestion API                    | HIGH       | MEDIUM              | P1       |
| Claude Code hooks                | HIGH       | MEDIUM              | P1       |
| Launcher button                  | HIGH       | LOW                 | P1       |
| Sessions tab (list)              | HIGH       | MEDIUM              | P1       |
| Evidence: Commit                 | HIGH       | LOW                 | P1       |
| Evidence: Command run            | HIGH       | MEDIUM              | P1       |
| Evidence: Error                  | HIGH       | LOW                 | P1       |
| Evidence: File touched           | HIGH       | LOW                 | P1       |
| Evidence: Test output            | HIGH       | MEDIUM              | P1       |
| Evidence: Tokens/cost            | MEDIUM     | LOW                 | P1       |
| Live streaming (Pusher)          | HIGH       | MEDIUM              | P1       |
| Agent identity in activity feed  | HIGH       | MEDIUM              | P1       |
| Evidence: Tool calls             | MEDIUM     | MEDIUM              | P2       |
| Diff preview evidence item       | MEDIUM     | HIGH                | P2       |
| "Continue this session" launcher | MEDIUM     | MEDIUM              | P2       |
| Session filter bar               | MEDIUM     | MEDIUM              | P2       |
| Custom session tags              | LOW        | LOW                 | P2       |
| Session-to-commit back-link      | MEDIUM     | LOW                 | P2       |
| Secret redaction (regex)         | MEDIUM     | MEDIUM              | P2       |
| Full-text search over output     | LOW        | HIGH                | P3       |
| Per-session annotations          | LOW        | HIGH                | P3       |
| Cost analytics roll-up           | LOW        | MEDIUM              | P3       |
| Branch-name task inference       | LOW        | MEDIUM              | P3       |

**Priority key:**

- P1: Must have for v1 launch
- P2: Should have; add in v1.x once core is validated
- P3: Future consideration; revisit at next milestone

---

## Competitor Feature Analysis

| Feature              | Devin (Cognition)                                                                     | GitHub Copilot Agent                                               | Linear (for Agents)                                     | Lumo approach                                                                     |
| -------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Session list         | `/sessions` page: filter by PR status, user, playbook; consolidated analytics view    | Agents tab + CLI (`gh agent-task list`); chronological with status | Issue-level contribution tracking via user profile page | Sessions tab embedded on task page — no context-switch required                   |
| Session grouping     | Custom tags; parent/child indentation for batch sessions                              | Per-branch session (chain of commits)                              | Not session-specific; shows issue activity              | Day-grouped rows on task page; origin badge differentiates server/client          |
| Live vs. completed   | Follow tab (real-time action + thoughts); Session Insights (post-completion analysis) | CLI `--follow`; "Stop session" button; Live logs in Raycast        | Not documented as distinct UX                           | Live pill + pulsing dot; auto-scroll while live; Insights deferred                |
| Evidence types       | Actions, thoughts, editor diagnostics, PR                                             | Commit with `Agent-Logs-Url` trailer, session logs                 | Issue activity, contributions                           | Commit, file touched, command, error, test output, tool calls (v1.x), diff (v1.x) |
| Agent identity       | Devin user in Linear/GitHub; avatar + profile                                         | Commits co-authored: "Copilot + human"; verified signatures        | First-class user; assignee, @mention, user profile      | Clerk-backed workspace user; activity feed entries; @mention in comments          |
| Launcher             | In-browser IDE (Devin is the environment)                                             | Issue assignment triggers session; CLI `gh agent-task start`       | @mention agent in comment or assign to issue            | Launcher button → `claude://` deep-link + "Copy CLI command" fallback             |
| Search               | Filter by PR status, user, playbook, custom tags                                      | CLI query params; status filter in UI                              | Issue list filters                                      | Filter bar (v1.x); full-text search deferred                                      |
| Handoff / review     | Session Insights; step-through with arrow keys                                        | PR review; session logs URL in commit                              | Read via user profile page                              | Completed session evidence trail; "Continue session" launcher (v1.x)              |
| Binding to work item | Session started from a Devin task / Linear issue                                      | Issue assignment triggers session                                  | Issue is the work item; agent is assigned               | Launcher button on task page generates session_id + task_id pair                  |
| Secret redaction     | Not documented                                                                        | Not documented                                                     | Not applicable                                          | Regex-based redaction in v1.x; stdout truncation in v1                            |

---

## Sources

- Devin 2025 release notes: https://docs.devin.ai/release-notes/2025
- Devin Session Insights: https://docs.devin.ai/product-guides/session-insights
- GitHub Copilot: Trace commits to session logs (March 2026): https://github.blog/changelog/2026-03-20-trace-any-copilot-coding-agent-commit-to-its-session-logs/
- GitHub Copilot: Track Copilot sessions: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/track-copilot-sessions
- GitHub Copilot: Kick off and track sessions from CLI (Sept 2025): https://github.blog/changelog/2025-09-25-kick-off-and-track-copilot-coding-agent-sessions-from-the-github-cli/
- Linear for Agents (May 2025): https://linear.app/changelog/2025-05-20-linear-for-agents
- Linear agent docs: https://linear.app/docs/agents-in-linear
- Linear Agent Interaction SDK (July 2025): https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk
- JetBrains Junie: session history, /history command, LLM usage data: https://junie.jetbrains.com/docs/
- Atlassian Rovo: collaborate on work items: https://support.atlassian.com/rovo/docs/collaborate-with-your-rovo-agent-on-work-items/
- Claude Code hooks reference: https://code.claude.com/docs/en/hooks
- Claude Code multi-agent observability (community): https://github.com/disler/claude-code-hooks-multi-agent-observability
- Claude Code session search (community TUI, Jan 2026): https://stanislas.blog/2026/01/tui-index-search-coding-agent-sessions/
- AI agent secret redaction patterns: https://rafter.so/blog/ai-agent-data-leakage-secrets-management
- OpenTelemetry GenAI semantic conventions (agent observability): https://opentelemetry.io/blog/2025/ai-agent-observability/

---

_Feature research for: Lumo — Agent Sessions milestone (AI agent session observability)_
_Researched: 2026-04-10_
