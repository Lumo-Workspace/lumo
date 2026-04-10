# Lumo

## What This Is

Lumo is a project management tool for small dev teams where humans and AI agents collaborate on tasks as equals. It already runs Claude agents server-side (via the `agent-server` workspace) that execute work against tasks using MCP tools and stream progress back through Pusher. The current milestone extends that model to **client-side Claude Code sessions** — when a dev runs Claude Code in their terminal, that session becomes a first-class participant in the bound Lumo task, streaming commits, diffs, test output, errors, commands, and file changes back to Lumo live.

## Core Value

**Work done in Claude Code flows into the bound Lumo task automatically — live, queryable, no manual ferrying.**

Whether Claude runs server-side (agent-server) or client-side (Claude Code in the user's terminal), every session leaves a durable, structured trail attached to the task it's working on. The task is the system of record; the session is never lost to terminal scrollback.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Inferred from existing codebase (see .planning/codebase/). -->

- ✓ **Workspaces** with multi-tenant Clerk authentication and workspace-centric security — existing
- ✓ **Projects** scoped to workspaces — existing
- ✓ **Tasks** with state machine (pending → in-progress → review → done) — existing
- ✓ **Task comments** with @mentions and rich text editor — existing
- ✓ **Activity timeline** with visual components, date groups, filters, and actor mentions — existing
- ✓ **Subtasks** with edit and delete — existing
- ✓ **Task assignment** (owner, reviewer) with notification routing — existing
- ✓ **GitHub integration**: branch creation, PR linking, webhook handlers, signature verification — existing
- ✓ **Slack integration**: channel notifications, DM notifications, slash commands, bot adapter — existing
- ✓ **Server-side Claude agent execution** via `agent-server/` workspace — existing
  - Isolated Node workspace with its own Prisma instance and Anthropic SDK
  - MCP-based tool surface (`agent-server/src/agent/sandbox-mcp.ts`, `auth/mcp-auth.ts`)
  - Agent orchestration: `execute.ts`, `state-machine.ts`, `task-state-machine.ts`, `resume.ts`, `context-builder.ts`, `generate-spec.ts`
  - Sandboxed code execution (`sandbox-done` route)
- ✓ **Real-time transport via Pusher** from `agent-server` to the main app — existing
- ✓ **Agent notification machinery**: `notifyAgentActions`, `notifyReviewerOrOwners`, `notifyTaskInReview`, `broadcast` — existing
- ✓ **i18n for 16 locales** with locale-aware date formatting — existing
- ✓ **Layered architecture**: Component → API Client → API Route → Service → Repository → Prisma — enforced via `CLAUDE.md` and the recent modular refactoring (commit `474ec21`)

### Active

<!-- Current scope. Building toward these. Collectively referred to as the "Agent Sessions" milestone. -->

- [ ] **AgentSession entity** — new first-class Prisma model with `origin` discriminator (`server` | `client`), bound to a `Task` via `taskId`, carrying a session identifier that the client provides
- [ ] **Client-side Claude Code ingestion API** — authenticated endpoint(s) that receive evidence events from Claude Code hooks running on the user's machine
- [ ] **Claude Code hook integration** — hooks (likely `PostToolUse`, `SessionStart`, `SessionEnd`) that POST events to the Lumo ingestion API, tagged with the (`session_id`, `task_id`) pair
- [ ] **"Start Claude session" launcher on the task page** — button that opens Claude Code (or emits a deep-link / CLI invocation) with task context pre-seeded: task ID, title, description, acceptance criteria, and a session ID
- [ ] **Live streaming to the Sessions UI** — evidence events flow through the existing Pusher transport so the Lumo task page updates in real time as the session runs
- [ ] **Sessions tab on the task page** — interleaved view of all `AgentSession`s (server + client) for a task, each expandable to show its evidence trail
- [ ] **Evidence trail per session**: commits, diffs, test output, errors, commands run, files touched — captured structurally and queryably, not as free-text narrative
- [ ] **Agent-as-teammate identity** — Claude Code sessions appear in activity feeds, @mentions, and assignment UI the same way human users do; identity is scoped per workspace and tied to the human who launched the session
- [ ] **Small-team visibility** — any workspace member can open a teammate's past session and read its evidence trail; review and handoff are first-class
- [ ] **Unification with agent-server** — the existing server-side agent execution path writes to the same `AgentSession` model so the Sessions tab shows both origins interleaved

### Out of Scope

<!-- Explicit boundaries. Revisited only with explicit discussion. -->

- **Narrative + decision transcripts** — explicitly traded away in favor of structured artifacts/evidence. Reasoning: the user wants a queryable audit log, not a teammate monologue. Can be revisited in a later milestone if the evidence trail proves insufficient.
- **Figma-style live cursor presence** — "Claude is editing file X right now" indicators beyond the natural liveness of streamed events. Reasoning: cost/complexity vs. value; the streaming trail already shows current activity implicitly.
- **Human-in-the-loop question queue** — "Claude is blocked waiting on A or B?" as a dedicated UI surface. Reasoning: not the loudest pain; users can reach for it in a later milestone if friction emerges.
- **Agent-agent collaboration as a UI surface** — mentioned in the original project framing but not the immediate pain. Reasoning: server-side agents already compose internally via `state-machine.ts`; the user's own wording ("I keep context-switching between Lumo and Claude Code") is about human-agent friction, not agent-agent.
- **Rebuilding `agent-server`** — the existing server stays; this milestone _extends_ it, doesn't replace it. Reasoning: it already works and carries the MCP, state machine, and Pusher infrastructure we need.
- **New Claude identity or inference billing model** — client-side Claude Code sessions run on the user's existing Claude Code subscription; server-side sessions keep using `agent-server`'s Anthropic SDK credentials. Reasoning: unnecessary scope; the seam we're closing is about _visibility_, not billing.
- **Multi-workspace session sharing** — a session belongs to exactly one workspace. Reasoning: aligns with Lumo's existing workspace-centric security model.
- **Inferring `task_id` from git branch without a launcher** — the launched-from-Lumo flow is the canonical path for v1. Reasoning: explicit binding avoids the ambiguity of unnamed branches, greenfield sessions, and sessions spanning multiple tasks; we can add branch inference later if the launcher proves insufficient.

## Context

**Brownfield extension, not a new product.** Lumo is already a mature Next.js 14 App Router codebase. The codebase map in `.planning/codebase/` (committed `b49864f`) captures its current state: layered architecture, Clerk-backed workspaces, Prisma + Neon Postgres, GitHub + Slack integrations, and the `agent-server` sidecar that already runs Claude against tasks server-side.

**The agent-server is half of the product — the other half is what we're building.** `agent-server/` already has everything we need to model an "agent doing work on a task": a task state machine, an MCP tool surface, a Pusher-based real-time transport, notification handlers, and its own Anthropic SDK integration. What it doesn't model is the other place Claude runs every day: the user's own terminal, inside Claude Code, while they're coding. That session is currently invisible to Lumo. The Agent Sessions milestone unifies the two origins under one data model.

**The pain is concrete, personal, and daily.** The founder's own workflow — running Claude Code alongside Lumo and manually ferrying commit hashes, PR links, test output, and status back into tasks — is the motivating use case. Every context-switch currently loses signal; after a few days the Lumo task looks idle even though real work happened.

**Recent architectural work matters.** The modular refactoring (commit `474ec21`) established a barrel-based integrations layer under `lib/integrations/{slack,github}/`. A follow-up fix (commit `b7bc170`) showed that these barrels leak server-only modules into client components when imported from `'use client'` code. The new `lib/integrations/claude-code/` (or equivalent) work must follow the same pattern: client-safe submodules imported directly, server-only modules kept behind the barrel for server callers. A memory file at `.claude/projects/-Users-chaoli-Desktop-lumo-lumo/memory/project_integrations_barrel_rsc_boundary.md` documents this constraint.

**The small-team audience is real.** The user runs a small dev team on Lumo; review and handoff are first-class concerns. An agent session written by one teammate's Claude must be readable later by any workspace member — evidence is shared state, not private context.

## Constraints

- **Tech stack**: Must extend the existing Next.js 14 + TypeScript strict + Prisma + Clerk + Tailwind + shadcn/ui stack. No new frameworks. — enforced by `CLAUDE.md`
- **Architecture**: All new code must follow the layered architecture — Component → API Client → API Route → Service → Repository → Prisma. No business logic in routes or components. — enforced by `CLAUDE.md`
- **Database**: Prisma only, no raw SQL. New models go through the existing migration workflow under `prisma/`. — enforced by `CLAUDE.md`
- **Real-time transport**: Must reuse the existing Pusher integration in `agent-server/src/pusher/server.ts`. Do not introduce a second real-time layer. — existing infra decision
- **Agent execution origin (server)**: Must not rebuild `agent-server/`. Extend it additively; keep its state machine, context builder, and MCP tool surface intact. — existing infra decision
- **Agent identity**: Agents-as-teammates must integrate with Clerk-backed identity, not a parallel bot identity system. — aligns with existing auth model
- **Client/server boundary**: New integration modules must respect Next.js RSC boundaries; client components must import from client-safe submodules, not barrels that re-export server code. — per `b7bc170` lesson
- **Testing**: Every new function gets at least one Jest test. Test files under `__tests__/` named `*.test.ts`. — enforced by `CLAUDE.md`
- **Git**: Branch naming `lumo/LUM-N-description`; commit/PR titles `type: description [LUM-N]`. No direct pushes to `main` or `develop`. — enforced by `CLAUDE.md`
- **No console.log in production code**: use proper logging. — enforced by `CLAUDE.md`
- **Workspace isolation**: `AgentSession` is scoped to a single workspace via its task's project's workspace; cross-workspace session sharing is out of scope.

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision                                                                         | Rationale                                                                                                                                                                                  | Outcome   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| Unified `AgentSession` entity with `origin` discriminator (`server` \| `client`) | Same data model, same transport, same UI surface — server-side (`agent-server`) and client-side (Claude Code) sessions are the same thing from Lumo's perspective; only the origin differs | — Pending |
| Launched from Lumo (vs. git-branch inference) for v1 binding                     | Solves greenfield tasks with no branch yet; gives us a deterministic moment to inject task context into the session; branch inference can be layered on later if needed                    | — Pending |
| Live streaming via existing Pusher transport                                     | The infrastructure is already wired for `agent-server` → main-app updates; reusing it avoids building a second real-time layer and keeps the two session origins symmetric                 | — Pending |
| Artifacts + evidence over narrative / decisions                                  | The user explicitly wants a structured, queryable trail (commits, diffs, tests, errors, commands, files), not a teammate monologue; less burden on the agent to "write about" its work     | — Pending |
| Extend `agent-server`, do not rebuild it                                         | It already carries the MCP tool surface, task state machine, notification handlers, and Pusher wiring the new milestone needs; rebuilding would throw away working infrastructure          | — Pending |
| Agents-as-teammates via Clerk identity (not a parallel bot identity)             | Avoids a second auth system; agents integrate naturally with existing @mentions, assignment, activity feeds, and workspace-centric security                                                | — Pending |
| Scoped to `small team` visibility (workspace members) for v1                     | Matches the user's audience answer; defers multi-workspace session sharing and public session links                                                                                        | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):

1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):

1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---

_Last updated: 2026-04-10 after initialization (Agent Sessions milestone)_
