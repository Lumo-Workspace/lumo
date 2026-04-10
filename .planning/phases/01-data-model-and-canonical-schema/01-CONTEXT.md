---
phase: 1
name: Data Model and Canonical Schema
slug: data-model-and-canonical-schema
created: 2026-04-10T17:50:22.251Z
mode: auto
---

# Phase 1 Context — Data Model and Canonical Schema

## Domain

Phase 1 is the foundation layer for the Agent Sessions milestone. The only deliverables are:

1. Two Prisma models — `AgentSession` and `AgentSessionEvent` — migrated cleanly against the live Neon instance.
2. A canonical `AgentSessionEventPayload` discriminated union in `shared/`, importable by both the main Next.js app and the `agent-server/` sidecar without circular dependencies.
3. A `lib/integrations/claude-code/` module directory with the RSC-safe barrel pattern enforced from the first commit (per the `b7bc170` lesson).
4. Zod schemas for every payload kind with size caps wired in at the schema level.

**No runtime behavior is built in this phase.** No API routes, no hooks, no UI, no ingestion logic, no token minting. If a decision looks like it belongs to a later phase (e.g. rate limiting, Pusher publish, JWT signing, launcher flow), it is explicitly deferred.

This phase is the contract that Phases 2–6 build on. Getting it wrong means rework in every downstream phase, so the bias is toward **over-specifying the shape now** so that no downstream phase has to re-open decisions about event structure, size caps, or import boundaries.

## Decisions

### Schema: AgentSession model shape

- **Primary key**: Lumo-owned `id @id @default(cuid())`. Claude Code's own `session_id` is stored separately as `claudeSessionId String` — correlation-only, never the primary key. Rationale: Claude Code's session_id is not guaranteed stable across resumes, and Lumo needs to own the identifier it ferries into the launcher command via `--session-id`.
- **Origin discriminator**: `origin AgentSessionOrigin` enum with values `server | client`. Used to distinguish agent-server executions from Claude Code launches; no polymorphic tables.
- **Status**: `status AgentSessionStatus` enum with values `pending | active | completed | failed | abandoned`. `pending` is the state after the launcher mints a session but before the first hook event arrives. `abandoned` is the escape hatch for sessions whose `SessionEnd` hook never fires (Phase 2 will add the explicit end endpoint).
- **Attribution**: `launchedByUserId String` — Clerk user ID of the human who launched the session. Never nullable; every session has a human origin for audit purposes (even server-origin sessions are launched by a user action or automation).
- **Task binding**: `taskId String` with a relation to `Task`. Non-nullable. A session always belongs to exactly one task.
- **Workspace scoping (denormalized)**: `workspaceId String` copied onto `AgentSession` at creation time. This is a deliberate denormalization — the authoritative path is still `AgentSession → Task → Project → Workspace`, but the denormalized column lets the ingestion API perform an O(1) workspace auth check without joining three tables on every event batch POST. Phase 2's bearer-token scope enforcement leans on this.
- **Metadata**: `metadata Json` — free-form bag for model name, working directory, git branch, etc. Not queryable; use event records for anything you need to query.
- **Timestamps**: `startedAt DateTime @default(now())`, `endedAt DateTime?`, `createdAt`, `updatedAt`.
- **Indexes**: `@@index([taskId, startedAt(sort: Desc)])` for the Sessions tab query. `@@index([workspaceId, startedAt(sort: Desc)])` for workspace-wide listings (future v2). `@@index([claudeSessionId])` for correlation debugging.

### Schema: AgentSessionEvent model shape

- **Single-table discriminated union**: One `AgentSessionEvent` table with a `kind AgentSessionEventKind` enum column and a `payload Json` column. **Not** one table per event kind. Per ARCHITECTURE.md research — per-kind tables would explode the schema, complicate the Sessions tab join, and double migration work every time we add an event kind.
- **Monotonic ordering**: `sequence Int` integer assigned client-side by the hook runtime (or agent-server session-recorder). Postgres `createdAt` timestamps are too coarse and can race within a single batch; `sequence` gives deterministic in-session ordering even if Postgres inserts out of timestamp order.
- **Idempotency constraint**: `@@unique([sessionId, sequence])`. Combined with `createMany({ skipDuplicates: true })` at the ingestion layer (Phase 2), this gives exactly-once semantics for free — a retried batch POST that partially landed will simply skip the already-persisted events on the retry.
- **No server-assigned timestamp for ordering**: `createdAt DateTime @default(now())` exists but is metadata-only. The Sessions tab sorts by `sequence ASC`, not `createdAt`.
- **Indexes**: `@@index([sessionId, sequence])` is implicit from the unique constraint. Add `@@index([kind])` only if a later phase needs cross-session kind filtering (deferred — not needed for Phase 1 success).

### Canonical payload union location

- **File**: `shared/src/agent-session-events.ts` — new file alongside the existing `shared/src/index.ts` domain events.
- **Export surface**: The new file defines the `AgentSessionEventKind` union type, the discriminated `AgentSessionEventPayload` union (nine variants), and one interface per variant. Re-exported from `shared/src/index.ts` so existing `@lumo/shared` (or relative `shared/`) imports keep working.
- **Nine variants** — match the Prisma enum exactly:
  1. `session-start` — model name, working directory, git branch, started_at
  2. `session-end` — ended_at, exit_reason, final_status
  3. `commit` — hash, message, author, stats {added, deleted, filesChanged}, optional github_url
  4. `file` — path, operation (`create | modify | delete | read`), bytes_delta
  5. `command` — argv, exit_code, stdout (capped), stderr (capped), duration_ms
  6. `error` — message, stack (capped), file, line
  7. `test` — framework, passed, failed, skipped, failing_tests, summary
  8. `metadata` — arbitrary key/value pairs (free-form bag for extensions)
  9. `tokens` — input_tokens, output_tokens, cache_read, cache_write, estimated_cost_usd
- **Type sharing across main app and agent-server**: Both projects import via TypeScript path alias (already configured — the existing `shared/` workspace re-exports work this way). **No runtime code in this file** — only types and Zod schemas (Zod is safe in both environments).

### RSC boundary: `lib/integrations/claude-code/` layout

Mirrors the `b7bc170` lesson from `lib/integrations/{slack,github}/` exactly:

```
lib/integrations/claude-code/
├── types.ts          CLIENT-SAFE — re-exports from @shared for the app surface
├── events.ts         CLIENT-SAFE — pure functions over payload types (e.g. eventKindLabel)
├── launcher.ts       CLIENT-SAFE — builds the copyable CLI command string
├── ingest.ts         SERVER-ONLY — imports 'server-only', will later use Prisma
├── token.ts          SERVER-ONLY — imports 'server-only', will later sign JWTs
└── index.ts          Barrel — re-exports ONLY types.ts, events.ts, launcher.ts
```

- **`index.ts` MUST NOT re-export `ingest.ts` or `token.ts`**. Server callers import those submodules directly: `import { ingestEvent } from '@/lib/integrations/claude-code/ingest'`.
- **`ingest.ts` and `token.ts` MUST start with `import 'server-only';`** so that a client-component import produces a build error, not a runtime leak.
- **Phase 1 deliverable is the skeleton**, not the implementations. `ingest.ts` and `token.ts` can export a single placeholder function each that throws `not yet implemented` — their job in Phase 1 is to prove the boundary holds. Phase 2 fills them in.
- **Test**: A `__tests__/integrations/claude-code-rsc-boundary.test.ts` imports the barrel and asserts the server-only exports are absent from its resolved export list.

### Zod validation and size caps

- **One Zod schema per event kind**, defined in `shared/src/agent-session-events.ts` alongside the types. Zod is isomorphic — safe to import in both main app and agent-server.
- **`tool_response` / `tool_result` field-name tolerance**: Use `.or()` in the `command` event schema so both field names validate. Per SUMMARY.md research gap: Claude Code's PostToolUse hook field name is ambiguous between versions; this tolerance is a documented temporary measure until Phase 3 hook runtime resolves it live.
- **Size caps at schema level**:
  - `command.stdout` and `command.stderr`: `z.string().max(4096)` (4 KB each).
  - `error.message` and `error.stack`: `z.string().max(4096)`.
  - Total event payload size cap: 16 KB enforced via a wrapper `z.string().refine(json => Buffer.byteLength(json, 'utf8') <= 16384)` applied in the parse layer that the ingestion API will call. Phase 1 defines the helper; Phase 2 invokes it.
- **No trimming or truncation in schema** — validation rejects oversized payloads outright. Truncation is the hook runtime's job (HOOK-04) and happens client-side before POST.

### Migration strategy

- **Additive only**. New enum types, new tables, new indexes. No `ALTER TABLE Task` or modifications to existing tables. Rationale: Neon production has live `Task` data; any ALTER on `Task` would risk a table lock under load (PITFALLS.md #11).
- **Enum creation first**: Create `AgentSessionOrigin`, `AgentSessionStatus`, `AgentSessionEventKind` as standalone enums before the tables that reference them. Prisma handles this automatically in the generated migration; we just verify the SQL output before applying.
- **Migration name**: `add_agent_sessions` (matches Prisma convention of `{action}_{subject}`, no timestamp prefix — Prisma adds that).
- **Apply command**: `npx prisma migrate dev --name add_agent_sessions` for local dev; the executor will run this in the Phase 1 execute step and verify `_prisma_migrations` shows it as applied.
- **Rollback plan**: The migration is safe to `prisma migrate reset` in development because all new tables are empty. Production rollback is a separate DOWN migration that drops the tables — written but not committed as part of Phase 1 (documented in the plan for human review).

### Workspace scoping traversal proof

Success criterion 1 requires that the workspace scoping path be traceable via a Prisma query. The Phase 1 deliverable includes a repository function in `lib/repositories/agent-session.repository.ts`:

```typescript
export async function findAgentSessionForAuth(sessionId: string) {
  return prisma.agentSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      workspaceId: true,
      task: { select: { project: { select: { workspaceId: true } } } },
    },
  })
}
```

The test for this function asserts that `result.workspaceId === result.task.project.workspaceId` — both the denormalized column and the traversal path return the same value. This is the single gate that proves the foundation is sound.

## Canonical Refs

**Project foundation:**

- `/Users/chaoli/Desktop/lumo/lumo/.planning/PROJECT.md` — Core Value, Constraints, Key Decisions
- `/Users/chaoli/Desktop/lumo/lumo/.planning/REQUIREMENTS.md` §DATA-01 through §DATA-07 — the seven requirements this phase delivers
- `/Users/chaoli/Desktop/lumo/lumo/.planning/ROADMAP.md` §Phase 1 — goal, success criteria, critical pitfalls

**Research:**

- `/Users/chaoli/Desktop/lumo/lumo/.planning/research/SUMMARY.md` §Phase 1 implications
- `/Users/chaoli/Desktop/lumo/lumo/.planning/research/ARCHITECTURE.md` §Single events table, §Canonical payload shape
- `/Users/chaoli/Desktop/lumo/lumo/.planning/research/PITFALLS.md` pitfalls #1 (barrel RSC leak), #4 (Claude session_id not stable), #6 (ordering via sequence), #7 (idempotency), #11 (migration lock), #13 (payload size), #22 (field-name divergence)
- `/Users/chaoli/Desktop/lumo/lumo/.planning/research/STACK.md` §Claude Code version floor

**Codebase references:**

- `/Users/chaoli/Desktop/lumo/lumo/prisma/schema.prisma` — existing `Workspace` (L137), `Project` (L277), `Task` (L325), `AgentRun` (L629), `ApiKey` (L696) models
- `/Users/chaoli/Desktop/lumo/lumo/shared/src/index.ts` — existing domain events and shared types; the canonical payload union will be re-exported from here
- `/Users/chaoli/Desktop/lumo/lumo/lib/integrations/slack/` and `lib/integrations/github/` — the barrel pattern to mirror
- `/Users/chaoli/Desktop/lumo/lumo/CLAUDE.md` §Layered Architecture — repository/service/route separation enforced
- `/Users/chaoli/Desktop/lumo/lumo/.claude/projects/-Users-chaoli-Desktop-lumo-lumo/memory/project_integrations_barrel_rsc_boundary.md` — the `b7bc170` lesson in full

## Code Context

**Reusable assets (do not rebuild):**

- **Prisma client and migration workflow** — `prisma/schema.prisma` is the single source of truth; `npx prisma migrate dev` is the workflow. Use `select` in all repository functions per CLAUDE.md ISP rule.
- **`shared/src/index.ts` export surface** — already exports `AgentErrorCode`, `DomainEvent` union, `ExecuteAgentRequest`, `SandboxDoneRequest`. Add new exports alongside; do not restructure.
- **`ApiKey` model pattern** — existing token infrastructure in `prisma/schema.prisma` L696 uses `keyHash` (SHA-256 hex) + `keyPrefix` ("lum_xxxxxxxx...") + `revokedAt`. This is the reference pattern Phase 2 will extend for session bearer tokens; Phase 1 does **not** create a new token table.
- **Layered architecture conventions** — `lib/repositories/`, `lib/services/`, `lib/api-client/`, `lib/validation/`. The one new repository file in this phase lives in `lib/repositories/agent-session.repository.ts`.
- **agent-server separate Prisma instance** — `agent-server/` has its own `prisma/` client generated from the root schema. The new models will be available there automatically after migration (no duplication).

**Patterns to follow:**

- **Barrel RSC-safety pattern** — mirror `lib/integrations/slack/index.ts` exactly. Look at what it re-exports and what it deliberately omits.
- **`import 'server-only';` as line 1** — every server-only file in the integration module starts with this import. Build error on client import is the guarantee.
- **Named exports over defaults** — per CLAUDE.md Code Style.

**Integration points:**

- `AgentSession.taskId → Task.id` — new FK. Task cascade behavior: `onDelete: Cascade` for dev-safety (deleting a test task removes its sessions); production data is never deleted.
- `AgentSessionEvent.sessionId → AgentSession.id` — new FK with `onDelete: Cascade` (deleting a session removes its events).
- `AgentSession.launchedByUserId` — stores a Clerk user ID string; no FK to `User` table (user records are managed by Clerk webhook sync; the `WorkspaceMember` table is the internal representation, but attribution lives on the Clerk ID for forward compatibility).

## Specifics

**Rules enforced in this phase:**

- **Enforce the barrel boundary from the first commit.** Writing `ingest.ts` without the `import 'server-only';` line is a bug, not a TODO. The test file that asserts the boundary holds must exist before the implementations fill in their bodies.
- **Canonicalize the payload shape before any event-producing code exists.** Phase 2 hook runtime, Phase 3 ingestion, and Phase 6 agent-server session-recorder all consume this union; if Phase 1 ships an incomplete shape, every downstream phase stalls.
- **Sequence is client-assigned, not server-assigned.** Do not add a Postgres trigger, sequence generator, or auto-increment. The hook runtime (Phase 3) and agent-server session-recorder (Phase 6) each maintain their own monotonic counter per session.
- **No raw SQL anywhere.** Prisma only, per CLAUDE.md Database constraint. The migration file generated by Prisma is fine (it contains SQL); hand-writing SQL in a query is not.
- **Workspace denormalization is a deliberate duplication, not a code smell.** Document it in a comment on the `workspaceId` field so a future linter pass doesn't try to normalize it away.

**Known gotchas:**

- Prisma's `Json` type is `Prisma.JsonValue` at the TypeScript level, which is not the same as our Zod-parsed `AgentSessionEventPayload`. Callers that need the typed payload must run the Zod schema over `event.payload` at read time. Phase 1 provides the Zod schemas; Phase 5 Sessions tab consumes them.
- Prisma enums map to Postgres enum types, which cannot be `ALTER`ed to drop values without a new migration. Adding a tenth event kind later is one `prisma migrate dev`; removing one is painful. Lock the nine now.
- `createMany({ skipDuplicates: true })` on Postgres uses `ON CONFLICT DO NOTHING`, which the `@@unique([sessionId, sequence])` constraint activates. This is the idempotency mechanism — Phase 2 will call it, but Phase 1's schema is what makes it possible.

## Deferred

Explicitly **not** in Phase 1:

- **Ephemeral bearer-token table and JWT signing** → Phase 2. Phase 1 only creates the `token.ts` skeleton file so the boundary test can assert server-only-ness.
- **Ingestion endpoint, rate limiting, secret redaction** → Phase 2. Phase 1's `ingest.ts` is a placeholder.
- **Hook runtime, `.claude/settings.json` template, hook health checks** → Phase 3.
- **Launcher UI and modal** → Phase 4.
- **Sessions tab UI, evidence renderers, Pusher subscription** → Phase 5.
- **`agent-server/` session-recorder wrapper and unified rendering** → Phase 6. Phase 1 ensures the canonical payload shape is importable from `agent-server/`, but no agent-server code is modified.
- **Pusher channel event publishing (`session:event` on `task-{taskId}`)** → Phase 2.
- **Cross-session kind filtering indexes** → deferred until the Sessions tab filter bar is built (v2 MGMT-03).
- **Activity-timeline attribution for session start/end** → Phase 6 (AGENT-03).
