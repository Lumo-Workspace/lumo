# Spec Artifact `agent` Field — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a required `agent` enum field to `TaskArtifact` (the coding tool that produced the artifact: Claude Code / Codex / Cursor / Gemini CLI / GitHub Copilot / Windsurf), rendered as a brand-icon badge in the task-detail spec layer and settable from the CLI.

**Architecture:** New Prisma enum `TaskArtifactAgent`, backfilled `NOT NULL DEFAULT 'CLAUDE_CODE'`. The value threads through the existing layers unchanged in shape (validation → repository → service → API route → API client). UI gains hand-authored brand-icon SVG components and an `AgentBadge`, following the repo's existing `components/icons/` convention (no new npm dependency). CLI gains a `--agent` flag with a local token→enum map (CLI stays HTTP-only, no `@prisma/client` dependency).

**Tech Stack:** Prisma + Neon Postgres, Next.js App Router, Zod, react-intl, Jest, Commander (CLI).

**Spec:** `docs/superpowers/specs/2026-05-29-spec-artifact-agent-field-design.md`

---

## File Structure

**Create:**

- `components/icons/agents/ClaudeCodeIcon.tsx` … `WindsurfIcon.tsx` (6 brand-icon components)
- `app/workspace/[workspaceUrl]/components/AgentBadge.tsx` (enum → {label, Icon, color} + badge UI)
- `cli/src/lib/agent.ts` (token↔enum map + normalize helper)
- `__tests__/components/AgentBadge.test.tsx`
- `__tests__/cli/agent-normalize.test.ts`

**Modify:**

- `prisma/schema.prisma:1391` (TaskArtifact model + new enum)
- `lib/validation/task-artifact.ts`
- `lib/repositories/task-artifact.repository.ts`
- `lib/services/task-artifact.service.ts`
- `app/api/tasks/[id]/artifacts/route.ts:76`
- `lib/api-client/task-artifacts.ts`
- `lib/services/task-context.service.ts:213,329`
- `cli/src/commands/task-artifact-add.ts`, `task-artifact-update.ts`, `task-artifact-list.ts`, `task-artifact-show.ts`
- `cli/src/index.ts:357,381` (register `--agent`)
- `app/workspace/[workspaceUrl]/components/SpecArtifactGroup.tsx`
- `lib/i18n/*.json` (16 files)
- `.claude/skills/lumo/SKILL.md`
- corresponding `__tests__/` files

---

## Task 1: Prisma enum + migration

**Files:**

- Modify: `prisma/schema.prisma:1391-1410`

- [ ] **Step 1: Add the enum and field to the schema**

In `prisma/schema.prisma`, immediately **before** `model TaskArtifact {` (line 1391), insert:

```prisma
enum TaskArtifactAgent {
  CLAUDE_CODE
  CODEX
  CURSOR
  GEMINI_CLI
  GITHUB_COPILOT
  WINDSURF
}

```

Then inside the model, add the `agent` field right after the `source` line (line 1399):

```prisma
  source  String // "superpowers" | "claude-code" | "manual"
  agent   TaskArtifactAgent @default(CLAUDE_CODE)
  order   Int     @default(0)
```

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name add_task_artifact_agent`
Expected: creates `prisma/migrations/<ts>_add_task_artifact_agent/migration.sql` and applies it. The generated SQL should match:

```sql
-- CreateEnum
CREATE TYPE "TaskArtifactAgent" AS ENUM ('CLAUDE_CODE', 'CODEX', 'CURSOR', 'GEMINI_CLI', 'GITHUB_COPILOT', 'WINDSURF');

-- AlterTable
ALTER TABLE "task_artifacts" ADD COLUMN "agent" "TaskArtifactAgent" NOT NULL DEFAULT 'CLAUDE_CODE';
```

The `NOT NULL DEFAULT 'CLAUDE_CODE'` on `ADD COLUMN` backfills every existing row to `CLAUDE_CODE` in one step — no separate UPDATE needed.

> If `migrate dev` hits Prisma checksum drift (P3008/P3012), follow the CLAUDE.md workaround: hand-write the SQL above into the migration dir, `npx prisma db execute --file <path>`, `npx prisma migrate resolve --applied <name>`. **Do not** reset the DB.

- [ ] **Step 3: Regenerate the client**

Run: `npx prisma generate`
Expected: `TaskArtifactAgent` is now exported from `@prisma/client`.

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors (existing code still compiles; `agent` is defaulted so nothing breaks yet).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add TaskArtifactAgent enum + agent column [LUM-115]"
```

---

## Task 2: Validation schema

**Files:**

- Modify: `lib/validation/task-artifact.ts`
- Test: `__tests__/validation/task-artifact.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/validation/task-artifact.test.ts` inside `describe('createArtifactBodySchema', …)`:

```typescript
it('rejects a body without agent (now required)', () => {
  const r = createArtifactBodySchema.safeParse({
    kind: 'spec',
    title: 'Spec',
    content: 'x',
    source: 'superpowers',
  })
  expect(r.success).toBe(false)
})

it('rejects an invalid agent value', () => {
  const r = createArtifactBodySchema.safeParse({
    kind: 'spec',
    title: 'Spec',
    content: 'x',
    source: 'superpowers',
    agent: 'COPILOT_X',
  })
  expect(r.success).toBe(false)
})

it('accepts a valid agent value', () => {
  const r = createArtifactBodySchema.safeParse({
    kind: 'spec',
    title: 'Spec',
    content: 'x',
    source: 'superpowers',
    agent: 'CODEX',
  })
  expect(r.success).toBe(true)
})
```

And inside `describe('updateArtifactBodySchema', …)`:

```typescript
it('accepts agent as a sole editable field', () => {
  expect(updateArtifactBodySchema.safeParse({ agent: 'CURSOR' }).success).toBe(
    true
  )
})

it('rejects an invalid agent on update', () => {
  expect(updateArtifactBodySchema.safeParse({ agent: 'nope' }).success).toBe(
    false
  )
})
```

Also update the existing test `'accepts a full valid body'` to include `agent: 'CLAUDE_CODE'` so it keeps passing.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/validation/task-artifact.test.ts`
Expected: FAIL — the new agent assertions fail (schema has no `agent` yet).

- [ ] **Step 3: Implement**

Replace `lib/validation/task-artifact.ts` with:

```typescript
import { z } from 'zod'
import { TaskArtifactAgent } from '@prisma/client'

export const createArtifactBodySchema = z
  .object({
    kind: z.string().trim().min(1).max(64),
    title: z.string().trim().min(1).max(256),
    content: z.string().min(1).max(1_000_000),
    source: z.string().trim().min(1).max(64),
    agent: z.nativeEnum(TaskArtifactAgent),
  })
  .strict()

export type CreateArtifactBody = z.infer<typeof createArtifactBodySchema>

/**
 * Patch body for editing an artifact's metadata. Content is intentionally
 * immutable here — to change the body, remove and re-add the artifact.
 * At least one field must be present.
 */
export const updateArtifactBodySchema = z
  .object({
    kind: z.string().trim().min(1).max(64),
    title: z.string().trim().min(1).max(256),
    source: z.string().trim().min(1).max(64),
    agent: z.nativeEnum(TaskArtifactAgent),
  })
  .partial()
  .strict()
  .refine(obj => Object.keys(obj).length > 0, {
    message:
      'At least one field (kind, title, source, or agent) must be provided',
  })

export type UpdateArtifactBody = z.infer<typeof updateArtifactBodySchema>
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest __tests__/validation/task-artifact.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/validation/task-artifact.ts __tests__/validation/task-artifact.test.ts
git commit -m "feat: validate artifact agent field [LUM-115]"
```

---

## Task 3: Repository

**Files:**

- Modify: `lib/repositories/task-artifact.repository.ts`
- Test: `__tests__/repositories/task-artifact.repository.test.ts`

- [ ] **Step 1: Write the failing tests**

In `__tests__/repositories/task-artifact.repository.test.ts`, update the `'create passes input straight through'` test's `input` object to include `agent: 'CLAUDE_CODE'` (it asserts the whole object flows through, so it must include the new field). Then add:

```typescript
it('updateById includes agent in the patch when provided', async () => {
  mockPrisma.taskArtifact.updateMany.mockResolvedValue({ count: 1 })
  await taskArtifactRepository.updateById('a1', 't1', { agent: 'CODEX' })
  expect(mockPrisma.taskArtifact.updateMany).toHaveBeenCalledWith({
    where: { id: 'a1', taskId: 't1' },
    data: { agent: 'CODEX' },
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/repositories/task-artifact.repository.test.ts`
Expected: FAIL — `updateById` doesn't forward `agent`; the create test fails type/shape if not updated.

- [ ] **Step 3: Implement**

In `lib/repositories/task-artifact.repository.ts`:

Add the import at the top:

```typescript
import { prisma } from '@/lib/db/prisma'
import type { TaskArtifactAgent } from '@prisma/client'
```

Add `agent` to both interfaces:

```typescript
export interface CreateTaskArtifactInput {
  taskId: string
  workspaceId: string
  kind: string
  title: string
  content: string
  source: string
  agent: TaskArtifactAgent
  order: number
  createdById: string | null
}

export interface UpdateTaskArtifactInput {
  kind?: string | undefined
  title?: string | undefined
  source?: string | undefined
  agent?: TaskArtifactAgent | undefined
}
```

Add the conditional spread inside `updateById`'s `data`:

```typescript
      data: {
        ...(data.kind !== undefined ? { kind: data.kind } : {}),
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.source !== undefined ? { source: data.source } : {}),
        ...(data.agent !== undefined ? { agent: data.agent } : {}),
      },
```

(`create` already does `prisma.taskArtifact.create({ data: input })`, so `agent` flows automatically.)

- [ ] **Step 4: Run to verify pass**

Run: `npx jest __tests__/repositories/task-artifact.repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/task-artifact.repository.ts __tests__/repositories/task-artifact.repository.test.ts
git commit -m "feat: thread agent through artifact repository [LUM-115]"
```

---

## Task 4: Service

**Files:**

- Modify: `lib/services/task-artifact.service.ts`
- Test: `__tests__/services/task-artifact.service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `__tests__/services/task-artifact.service.test.ts` (matching the file's existing mock style — it mocks `taskArtifactRepository`):

```typescript
it('addArtifact forwards agent to the repository', async () => {
  mockRepo.countByTask.mockResolvedValue(0)
  mockRepo.create.mockResolvedValue({ id: 'a1' })
  await taskArtifactService.addArtifact({
    taskId: 't1',
    workspaceId: 'w1',
    kind: 'spec',
    title: 'Spec',
    content: 'x',
    source: 'superpowers',
    agent: 'CURSOR',
    actorMemberId: 'm1',
  })
  expect(mockRepo.create).toHaveBeenCalledWith(
    expect.objectContaining({ agent: 'CURSOR' })
  )
})
```

> If the service test file does not yet exist or uses a different mock variable name, mirror its existing pattern; the assertion (`create` called with `agent`) is the load-bearing part.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/services/task-artifact.service.test.ts`
Expected: FAIL — `addArtifact` doesn't accept/forward `agent`.

- [ ] **Step 3: Implement**

In `lib/services/task-artifact.service.ts`:

```typescript
import { taskArtifactRepository } from '@/lib/repositories/task-artifact.repository'
import type { TaskArtifactAgent } from '@prisma/client'

export interface AddArtifactInput {
  taskId: string
  workspaceId: string
  kind: string
  title: string
  content: string
  source: string
  agent: TaskArtifactAgent
  actorMemberId: string | null
}

export interface UpdateArtifactInput {
  kind?: string | undefined
  title?: string | undefined
  source?: string | undefined
  agent?: TaskArtifactAgent | undefined
}
```

And in `addArtifact`, add `agent` to the `create` call:

```typescript
return taskArtifactRepository.create({
  taskId: input.taskId,
  workspaceId: input.workspaceId,
  kind: input.kind,
  title: input.title,
  content: input.content,
  source: input.source,
  agent: input.agent,
  order,
  createdById: input.actorMemberId,
})
```

(`updateArtifact` passes `patch` straight to the repo, so `agent` flows automatically once `UpdateArtifactInput` allows it.)

- [ ] **Step 4: Run to verify pass**

Run: `npx jest __tests__/services/task-artifact.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-artifact.service.ts __tests__/services/task-artifact.service.test.ts
git commit -m "feat: thread agent through artifact service [LUM-115]"
```

---

## Task 5: API route + API client

**Files:**

- Modify: `app/api/tasks/[id]/artifacts/route.ts:76-84`
- Modify: `lib/api-client/task-artifacts.ts`
- Test: `__tests__/api/tasks-artifacts.test.ts`

- [ ] **Step 1: Write the failing test**

In `__tests__/api/tasks-artifacts.test.ts`, the POST test payload currently includes `source: 'superpowers'`. Add `agent: 'CODEX'` to that payload, and assert the service was called with it. Add a new test that a POST missing `agent` returns 400:

```typescript
it('rejects a POST without agent (400)', async () => {
  const res = await POST(
    makeRequest({
      kind: 'spec',
      title: 'Spec',
      content: 'x',
      source: 'superpowers',
    }),
    { params: Promise.resolve({ id: 'LUM-1' }) }
  )
  expect(res.status).toBe(400)
})
```

> Match the file's existing request-builder / mock helpers (`makeRequest`, mocked `taskArtifactService`, mocked `requireIdentity`). The two load-bearing assertions: (a) the service receives `agent`, (b) a missing `agent` is a 400.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/api/tasks-artifacts.test.ts`
Expected: FAIL — route doesn't pass `agent`; missing-agent currently succeeds.

- [ ] **Step 3: Implement the route**

In `app/api/tasks/[id]/artifacts/route.ts`, add `agent` to the `addArtifact` call (after `source:`):

```typescript
const artifact = await taskArtifactService.addArtifact({
  taskId: task.id,
  workspaceId: identity.workspaceId,
  kind: parsed.data.kind,
  title: parsed.data.title,
  content: parsed.data.content,
  source: parsed.data.source,
  agent: parsed.data.agent,
  actorMemberId: identity.memberId,
})
```

(The PATCH route forwards `parsed.data` wholesale — no change needed; the schema from Task 2 now lets `agent` through.)

- [ ] **Step 4: Update the API client**

In `lib/api-client/task-artifacts.ts`:

```typescript
import { apiFetch } from './base'
import type { TaskArtifact, TaskArtifactAgent } from '@prisma/client'

export interface CreateArtifactPayload {
  kind: string
  title: string
  content: string
  source: string
  agent: TaskArtifactAgent
}
```

(The `add` method body is unchanged — it already forwards the payload.)

- [ ] **Step 5: Run to verify pass**

Run: `npx jest __tests__/api/tasks-artifacts.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/tasks/[id]/artifacts/route.ts lib/api-client/task-artifacts.ts __tests__/api/tasks-artifacts.test.ts
git commit -m "feat: accept agent on artifact create API [LUM-115]"
```

---

## Task 6: CLI agent token map + normalize helper

**Files:**

- Create: `cli/src/lib/agent.ts`
- Test: `__tests__/cli/agent-normalize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/cli/agent-normalize.test.ts`:

```typescript
/** @jest-environment node */
import {
  normalizeAgent,
  AGENT_LABELS,
  VALID_AGENT_TOKENS,
} from '@/cli/src/lib/agent'

describe('normalizeAgent', () => {
  it('maps canonical tokens to enum values', () => {
    expect(normalizeAgent('claude-code')).toBe('CLAUDE_CODE')
    expect(normalizeAgent('codex')).toBe('CODEX')
    expect(normalizeAgent('cursor')).toBe('CURSOR')
    expect(normalizeAgent('gemini-cli')).toBe('GEMINI_CLI')
    expect(normalizeAgent('github-copilot')).toBe('GITHUB_COPILOT')
    expect(normalizeAgent('windsurf')).toBe('WINDSURF')
  })

  it('accepts aliases and is case/space insensitive', () => {
    expect(normalizeAgent('Gemini')).toBe('GEMINI_CLI')
    expect(normalizeAgent('Copilot')).toBe('GITHUB_COPILOT')
    expect(normalizeAgent('Claude Code')).toBe('CLAUDE_CODE')
  })

  it('returns null for unknown tokens', () => {
    expect(normalizeAgent('devin')).toBeNull()
    expect(normalizeAgent('')).toBeNull()
  })

  it('exposes labels and a sorted token hint', () => {
    expect(AGENT_LABELS.CODEX).toBe('Codex')
    expect(VALID_AGENT_TOKENS).toContain('claude-code')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/cli/agent-normalize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `cli/src/lib/agent.ts`:

```typescript
/**
 * CLI-local agent enum support. The CLI talks to the API over HTTP only and
 * does not depend on @prisma/client, so the enum values + accepted tokens are
 * mirrored here. Keep in sync with prisma `enum TaskArtifactAgent`.
 */

/** enum value → display label (matches lib/i18n en.json taskArtifact.agent.*) */
export const AGENT_LABELS: Record<string, string> = {
  CLAUDE_CODE: 'Claude Code',
  CODEX: 'Codex',
  CURSOR: 'Cursor',
  GEMINI_CLI: 'Gemini CLI',
  GITHUB_COPILOT: 'GitHub Copilot',
  WINDSURF: 'Windsurf',
}

/** accepted CLI token (normalized) → enum value */
const TOKEN_TO_ENUM: Record<string, string> = {
  'claude-code': 'CLAUDE_CODE',
  codex: 'CODEX',
  cursor: 'CURSOR',
  'gemini-cli': 'GEMINI_CLI',
  gemini: 'GEMINI_CLI',
  'github-copilot': 'GITHUB_COPILOT',
  copilot: 'GITHUB_COPILOT',
  windsurf: 'WINDSURF',
}

/** Canonical tokens shown in error/usage hints (aliases omitted). */
export const VALID_AGENT_TOKENS = [
  'claude-code',
  'codex',
  'cursor',
  'gemini-cli',
  'github-copilot',
  'windsurf',
]

/**
 * Normalize a user-supplied agent string to its enum value, or null if
 * unknown. Case-insensitive; spaces and underscores are treated as hyphens.
 */
export function normalizeAgent(input: string): string | null {
  const key = input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
  return TOKEN_TO_ENUM[key] ?? null
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest __tests__/cli/agent-normalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/agent.ts __tests__/cli/agent-normalize.test.ts
git commit -m "feat: cli agent token normalizer [LUM-115]"
```

---

## Task 7: CLI `artifact add --agent`

**Files:**

- Modify: `cli/src/commands/task-artifact-add.ts`
- Modify: `cli/src/index.ts:357-369`
- Test: `__tests__/cli/task-artifact-add.test.ts`

- [ ] **Step 1: Write the failing tests**

In `__tests__/cli/task-artifact-add.test.ts`: update the existing success test to pass `agent: 'claude-code'` and assert the sent body includes `agent: 'CLAUDE_CODE'`. Add:

```typescript
it('errors when --agent is missing', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okCreated)
  const code = await taskArtifactAdd('LUM-9', {
    kind: 'spec',
    title: 'Spec',
    file: 'f.md',
    source: 'superpowers',
  })
  expect(code).toBe(1)
  expect(fetchSpy).not.toHaveBeenCalled()
})

it('errors on an invalid --agent without calling the API', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okCreated)
  const code = await taskArtifactAdd('LUM-9', {
    kind: 'spec',
    title: 'Spec',
    file: 'f.md',
    source: 'superpowers',
    agent: 'devin',
  })
  expect(code).toBe(1)
  expect(fetchSpy).not.toHaveBeenCalled()
})
```

Update the existing `'POSTs … with kind/title/content/source'` test: add `agent: 'claude-code'` to the call and change the `toEqual` to include `agent: 'CLAUDE_CODE'`.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/cli/task-artifact-add.test.ts`
Expected: FAIL — `agent` not required/validated/sent.

- [ ] **Step 3: Implement the command**

In `cli/src/commands/task-artifact-add.ts`:

Add the import and the option type:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { readFileUtf8 } from '../lib/doc-input'
import { normalizeAgent, VALID_AGENT_TOKENS } from '../lib/agent'

export interface ArtifactAddOptions {
  kind?: string
  title?: string
  file?: string
  source?: string
  agent?: string
}
```

After the `source` validation block (the `if (!source) { … return 1 }`), add agent validation:

```typescript
const agentRaw = options.agent?.trim()
if (!agentRaw) {
  console.error(
    `Error: --agent is required. Valid values: ${VALID_AGENT_TOKENS.join(', ')}.`
  )
  return 1
}
const agent = normalizeAgent(agentRaw)
if (!agent) {
  console.error(
    `Error: invalid --agent "${agentRaw}". Valid values: ${VALID_AGENT_TOKENS.join(', ')}.`
  )
  return 1
}
```

Change the payload line to include `agent`:

```typescript
const payload: Record<string, string> = { kind, title, content, source, agent }
```

- [ ] **Step 4: Register the flag**

In `cli/src/index.ts`, in the `artifact add` command (after the `--source` requiredOption, line ~369), add:

```typescript
  .requiredOption(
    '--agent <agent>',
    'Coding tool that produced the artifact: claude-code | codex | cursor | gemini-cli | github-copilot | windsurf'
  )
```

- [ ] **Step 5: Run to verify pass**

Run: `npx jest __tests__/cli/task-artifact-add.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/task-artifact-add.ts cli/src/index.ts __tests__/cli/task-artifact-add.test.ts
git commit -m "feat: cli artifact add --agent [LUM-115]"
```

---

## Task 8: CLI `artifact update --agent`

**Files:**

- Modify: `cli/src/commands/task-artifact-update.ts`
- Modify: `cli/src/index.ts:381-386`
- Test: `__tests__/cli/task-artifact-update.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/cli/task-artifact-update.test.ts`:

```typescript
it('sends normalized agent in the PATCH body', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okUpdated)
  const code = await taskArtifactUpdate('LUM-9', 'cma_x', { agent: 'Codex' })
  expect(code).toBeUndefined()
  const [, init] = fetchSpy.mock.calls[0]!
  const sent = JSON.parse((init as RequestInit).body as string)
  expect(sent).toEqual({ agent: 'CODEX' })
})

it('errors on invalid --agent without calling the API', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okUpdated)
  const code = await taskArtifactUpdate('LUM-9', 'cma_x', { agent: 'devin' })
  expect(code).toBe(1)
  expect(fetchSpy).not.toHaveBeenCalled()
})
```

> If the test file lacks an `okUpdated` fixture, add one mirroring `okCreated` but with `status: 200` and a `json` returning `{ artifact: { id: 'cma_x', kind: 'spec', title: 'Spec', source: 'superpowers' } }`.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/cli/task-artifact-update.test.ts`
Expected: FAIL — `agent` not handled.

- [ ] **Step 3: Implement**

In `cli/src/commands/task-artifact-update.ts`:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { normalizeAgent, VALID_AGENT_TOKENS } from '../lib/agent'

export interface ArtifactUpdateOptions {
  kind?: string
  title?: string
  source?: string
  agent?: string
}
```

After the `source` block (after the `if (options.source !== undefined) { … }` block, before the "at least one" check), add:

```typescript
if (options.agent !== undefined) {
  const agent = normalizeAgent(options.agent)
  if (!agent) {
    console.error(
      `Error: invalid --agent "${options.agent}". Valid values: ${VALID_AGENT_TOKENS.join(', ')}.`
    )
    return 1
  }
  payload.agent = agent
}
```

Update the "at least one" error message:

```typescript
console.error(
  'Error: provide at least one of --kind, --title, --source, or --agent to update.'
)
```

- [ ] **Step 4: Register the flag**

In `cli/src/index.ts`, in the `artifact update` command (after the `--source` option, line ~386), add:

```typescript
  .option(
    '--agent <agent>',
    'New coding tool: claude-code | codex | cursor | gemini-cli | github-copilot | windsurf'
  )
```

- [ ] **Step 5: Run to verify pass**

Run: `npx jest __tests__/cli/task-artifact-update.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/task-artifact-update.ts cli/src/index.ts __tests__/cli/task-artifact-update.test.ts
git commit -m "feat: cli artifact update --agent [LUM-115]"
```

---

## Task 9: CLI `artifact list` + `show` output

**Files:**

- Modify: `cli/src/commands/task-artifact-list.ts`
- Modify: `cli/src/commands/task-artifact-show.ts`
- Test: `__tests__/cli/task-artifact-show.test.ts`

- [ ] **Step 1: Write the failing test**

In `__tests__/cli/task-artifact-show.test.ts`, the mocked artifact response should include `agent: 'CODEX'`. Assert the printed output contains an agent line. Add (matching the file's stdout-capture style):

```typescript
it('prints the agent label in the header', async () => {
  const writeSpy = jest.spyOn(process.stdout, 'write').mockReturnValue(true)
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      artifact: {
        id: 'cma_x',
        kind: 'spec',
        title: 'Spec',
        source: 'superpowers',
        agent: 'CODEX',
        order: 0,
        content: 'body',
      },
    }),
  } as unknown as Response)
  await taskArtifactShow('LUM-9', 'cma_x')
  const out = writeSpy.mock.calls.map(c => String(c[0])).join('')
  expect(out).toContain('agent:  Codex')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/cli/task-artifact-show.test.ts`
Expected: FAIL — no agent line printed.

- [ ] **Step 3: Implement `show`**

In `cli/src/commands/task-artifact-show.ts`:

Add import and `agent` to the `Artifact` interface:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { AGENT_LABELS } from '../lib/agent'

interface Artifact {
  id: string
  kind: string
  title: string
  source: string
  agent: string
  order: number
  content: string
  createdAt?: string
  updatedAt?: string
}
```

Add the agent line after the `source:` line:

```typescript
process.stdout.write(`source: ${artifact.source}\n`)
process.stdout.write(
  `agent:  ${AGENT_LABELS[artifact.agent] ?? artifact.agent}\n`
)
process.stdout.write(`order:  ${artifact.order}\n`)
```

- [ ] **Step 4: Implement `list`**

In `cli/src/commands/task-artifact-list.ts`:

Add the import, add `agent` to `ArtifactRow`, and print an agent column:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { AGENT_LABELS } from '../lib/agent'

interface ArtifactRow {
  id: string
  kind: string
  title: string
  source: string
  agent: string
  order: number
}
```

Change the print line:

```typescript
for (const a of artifacts) {
  const agentLabel = AGENT_LABELS[a.agent] ?? a.agent
  process.stdout.write(
    `${a.id}  ${a.kind.padEnd(10)}  ${agentLabel.padEnd(15)}  ${a.source.padEnd(12)}  ${a.title}\n`
  )
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx jest __tests__/cli/task-artifact-show.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/task-artifact-list.ts cli/src/commands/task-artifact-show.ts __tests__/cli/task-artifact-show.test.ts
git commit -m "feat: show agent column in cli artifact list/show [LUM-115]"
```

---

## Task 10: Task context injection

**Files:**

- Modify: `lib/services/task-context.service.ts:213-225,329`
- Test: `__tests__/services/task-context.service.test.ts` (or wherever `renderArtifactSection` is tested)

- [ ] **Step 1: Write the failing test**

Find the existing `renderArtifactSection` test (search: `grep -rn renderArtifactSection __tests__`). If none exists, create `__tests__/services/render-artifact-section.test.ts`:

```typescript
/** @jest-environment node */
import { renderArtifactSection } from '@/lib/services/task-context.service'

describe('renderArtifactSection', () => {
  it('appends the agent label to each heading', () => {
    const out = renderArtifactSection([
      { kind: 'spec', title: 'My Spec', content: 'body', agent: 'CODEX' },
    ])
    expect(out).toContain('## [spec] My Spec · Codex')
    expect(out).toContain('body')
  })

  it('returns empty string for no artifacts', () => {
    expect(renderArtifactSection([])).toBe('')
  })
})
```

> Importing `task-context.service` in jest can pull heavy deps. If the import fails (e.g. `@ai-sdk/gateway` TransformStream trap — see project memory), move `renderArtifactSection` + its label map into a small leaf module `lib/services/render-artifact-section.ts` and re-export it from `task-context.service.ts`, then import the leaf module in the test.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest -t "agent label to each heading"`
Expected: FAIL — heading has no agent suffix; type lacks `agent`.

- [ ] **Step 3: Implement**

In `lib/services/task-context.service.ts`, add a label map near the top (after imports):

```typescript
const ARTIFACT_AGENT_LABELS: Record<string, string> = {
  CLAUDE_CODE: 'Claude Code',
  CODEX: 'Codex',
  CURSOR: 'Cursor',
  GEMINI_CLI: 'Gemini CLI',
  GITHUB_COPILOT: 'GitHub Copilot',
  WINDSURF: 'Windsurf',
}
```

Replace `renderArtifactSection`:

```typescript
export function renderArtifactSection(
  artifacts: Array<{
    kind: string
    title: string
    content: string
    agent?: string
  }>
): string {
  if (artifacts.length === 0) return ''
  const blocks: string[] = []
  for (const a of artifacts) {
    const label = a.agent ? (ARTIFACT_AGENT_LABELS[a.agent] ?? a.agent) : null
    const heading = label
      ? `## [${a.kind}] ${a.title} · ${label}`
      : `## [${a.kind}] ${a.title}`
    blocks.push(heading)
    blocks.push('')
    blocks.push(a.content.trimEnd())
    blocks.push('')
  }
  return blocks.join('\n').trimEnd()
}
```

The caller at line 329 passes `taskArtifactRepository.listByTask(...)` results, which now include `agent` — no change needed there.

- [ ] **Step 4: Run to verify pass**

Run: `npx jest -t "agent label to each heading"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-context.service.ts __tests__/services
git commit -m "feat: include agent in task context artifact headings [LUM-115]"
```

---

## Task 11: Brand-icon SVG components

**Files:**

- Create: `components/icons/agents/{ClaudeCodeIcon,CodexIcon,CursorIcon,GeminiIcon,GitHubCopilotIcon,WindsurfIcon}.tsx`

These follow the exact pattern of `components/icons/SlackIcon.tsx` / `GithubIcon.tsx` (`size` prop default 14, `aria-hidden`). Monochrome marks use `fill='currentColor'` so `AgentBadge` controls color via the wrapper; the multi-color Gemini mark keeps its own fills. The SVGs below are complete and compile; if you have a tool's **official** SVG, you may swap the inner markup keeping the same component shape and `viewBox`.

- [ ] **Step 1: Create the 6 components**

`components/icons/agents/ClaudeCodeIcon.tsx` (Anthropic-style sunburst, monochrome):

```tsx
interface Props {
  size?: number
  className?: string
}

export function ClaudeCodeIcon({
  size = 14,
  className,
}: Props): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 16 16'
      fill='currentColor'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      aria-hidden='true'
    >
      <path d='M8 1.2l1.2 4 4-1.2-2.4 3.4 3.4 2.4-4-1.2-1.2 4-1.2-4-4 1.2 3.4-2.4-3.4-2.4 4 1.2z' />
    </svg>
  )
}
```

`components/icons/agents/CodexIcon.tsx` (OpenAI-style ring, monochrome):

```tsx
interface Props {
  size?: number
  className?: string
}

export function CodexIcon({ size = 14, className }: Props): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 16 16'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.4'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      aria-hidden='true'
    >
      <circle cx='8' cy='8' r='5.5' />
      <path
        d='M5.5 8.5l1.8 1.8 3.2-3.6'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
```

`components/icons/agents/CursorIcon.tsx` (cursor caret, monochrome):

```tsx
interface Props {
  size?: number
  className?: string
}

export function CursorIcon({
  size = 14,
  className,
}: Props): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 16 16'
      fill='currentColor'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      aria-hidden='true'
    >
      <path d='M3 1.5l9.5 5.2-4 1 -1 4z' />
    </svg>
  )
}
```

`components/icons/agents/GeminiIcon.tsx` (Gemini spark — keep brand blue, multi-color allowed):

```tsx
interface Props {
  size?: number
  className?: string
}

export function GeminiIcon({
  size = 14,
  className,
}: Props): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 16 16'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      aria-hidden='true'
    >
      <path
        d='M8 0c.3 4.2 3.8 7.7 8 8-4.2.3-7.7 3.8-8 8-.3-4.2-3.8-7.7-8-8 4.2-.3 7.7-3.8 8-8z'
        fill='#3186FF'
      />
    </svg>
  )
}
```

`components/icons/agents/GitHubCopilotIcon.tsx` (Copilot-style head, monochrome):

```tsx
interface Props {
  size?: number
  className?: string
}

export function GitHubCopilotIcon({
  size = 14,
  className,
}: Props): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 16 16'
      fill='currentColor'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      aria-hidden='true'
    >
      <path d='M8 2c2.2 0 3 1.2 3 3 1.1 0 2 .9 2 2v2.5c0 2-2.2 3.5-5 3.5s-5-1.5-5-3.5V7c0-1.1.9-2 2-2 0-1.8.8-3 3-3zM6 8.2a.9.9 0 100 1.8.9.9 0 000-1.8zm4 0a.9.9 0 100 1.8.9.9 0 000-1.8z' />
    </svg>
  )
}
```

`components/icons/agents/WindsurfIcon.tsx` (wind/sail, monochrome):

```tsx
interface Props {
  size?: number
  className?: string
}

export function WindsurfIcon({
  size = 14,
  className,
}: Props): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 16 16'
      fill='currentColor'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      aria-hidden='true'
    >
      <path d='M3 13.5L11 1.5l1 11-9 1zm1.6-1.3l5.6-.6-.6-6.9z' />
    </svg>
  )
}
```

- [ ] **Step 2: Verify they compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/icons/agents
git commit -m "feat: add agent brand icon components [LUM-115]"
```

---

## Task 12: `AgentBadge` component + metadata map

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/AgentBadge.tsx`
- Test: `__tests__/components/AgentBadge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/AgentBadge.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import en from '@/lib/i18n/en.json'
import {
  AGENT_META,
  AgentBadge,
} from '@/app/workspace/[workspaceUrl]/components/AgentBadge'
import { TaskArtifactAgent } from '@prisma/client'

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <IntlProvider locale='en' messages={en as Record<string, string>}>
      {ui}
    </IntlProvider>
  )
}

describe('AgentBadge', () => {
  it('has metadata (Icon + color) for every enum value', () => {
    for (const value of Object.values(TaskArtifactAgent)) {
      expect(AGENT_META[value]).toBeDefined()
      expect(AGENT_META[value].Icon).toBeDefined()
      expect(typeof AGENT_META[value].color).toBe('string')
    }
  })

  it('renders the localized label', () => {
    const { getByText } = renderWithIntl(
      <AgentBadge agent={TaskArtifactAgent.CODEX} />
    )
    expect(getByText('Codex')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/components/AgentBadge.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `app/workspace/[workspaceUrl]/components/AgentBadge.tsx`:

```tsx
'use client'

import { useIntl } from 'react-intl'
import { TaskArtifactAgent } from '@prisma/client'
import { ClaudeCodeIcon } from '@/components/icons/agents/ClaudeCodeIcon'
import { CodexIcon } from '@/components/icons/agents/CodexIcon'
import { CursorIcon } from '@/components/icons/agents/CursorIcon'
import { GeminiIcon } from '@/components/icons/agents/GeminiIcon'
import { GitHubCopilotIcon } from '@/components/icons/agents/GitHubCopilotIcon'
import { WindsurfIcon } from '@/components/icons/agents/WindsurfIcon'

type IconComponent = (props: {
  size?: number
  className?: string
}) => React.ReactElement

interface AgentMeta {
  Icon: IconComponent
  /** brand color applied to the icon (and the chip tint) */
  color: string
}

export const AGENT_META: Record<TaskArtifactAgent, AgentMeta> = {
  [TaskArtifactAgent.CLAUDE_CODE]: { Icon: ClaudeCodeIcon, color: '#D97757' },
  [TaskArtifactAgent.CODEX]: { Icon: CodexIcon, color: '#111827' },
  [TaskArtifactAgent.CURSOR]: { Icon: CursorIcon, color: '#475569' },
  [TaskArtifactAgent.GEMINI_CLI]: { Icon: GeminiIcon, color: '#3186FF' },
  [TaskArtifactAgent.GITHUB_COPILOT]: {
    Icon: GitHubCopilotIcon,
    color: '#1F2937',
  },
  [TaskArtifactAgent.WINDSURF]: { Icon: WindsurfIcon, color: '#0D9488' },
}

/** Localized label for an agent (taskArtifact.agent.<ENUM>). */
export function useAgentLabel(agent: TaskArtifactAgent): string {
  const intl = useIntl()
  return intl.formatMessage({ id: `taskArtifact.agent.${agent}` })
}

/** Row badge: brand icon + label. */
export function AgentBadge({ agent }: { agent: TaskArtifactAgent }) {
  const { Icon, color } = AGENT_META[agent]
  const label = useAgentLabel(agent)
  return (
    <span className='inline-flex items-center gap-1.5 text-xs text-muted-foreground shrink-0'>
      <span
        className='inline-flex size-5 items-center justify-center rounded-full'
        style={{ backgroundColor: `${color}1A`, color }}
      >
        <Icon size={12} />
      </span>
      {label}
    </span>
  )
}

/** Icon-only avatar for the header stack. */
export function AgentAvatar({ agent }: { agent: TaskArtifactAgent }) {
  const { Icon, color } = AGENT_META[agent]
  return (
    <span
      className='inline-flex size-5 items-center justify-center rounded-full ring-2 ring-background'
      style={{ backgroundColor: `${color}1A`, color }}
    >
      <Icon size={12} />
    </span>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest __tests__/components/AgentBadge.test.tsx`
Expected: PASS.

> The `taskArtifact.agent.*` keys are added in Task 14. If running this test before Task 14, `useAgentLabel` returns the key id and `getByText('Codex')` fails — do Task 14's `en.json` entry first, or run Tasks 12 and 14 together. (The completeness test does not depend on i18n.)

- [ ] **Step 5: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/AgentBadge.tsx __tests__/components/AgentBadge.test.tsx
git commit -m "feat: AgentBadge component + enum metadata [LUM-115]"
```

---

## Task 13: Wire `AgentBadge` into `SpecArtifactGroup`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/SpecArtifactGroup.tsx`

- [ ] **Step 1: Add `agent` to the Props Pick and imports**

At the top of `SpecArtifactGroup.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronRight, ChevronDown, Plus, Sparkle } from 'lucide-react'
import type { TaskArtifact } from '@prisma/client'
import { TaskArtifactAgent } from '@prisma/client'
import { artifactsClient } from '@/lib/api-client/task-artifacts'
import { markdownToHtml } from '@/lib/utils/markdown-tiptap'
import { RichTextViewer } from './RichTextViewer'
import { AgentBadge, AgentAvatar } from './AgentBadge'
```

Update the Pick:

```tsx
artifacts: (Pick < TaskArtifact,
  'id' |
    'kind' |
    'title' |
    'content' |
    'source' |
    'agent' |
    'order' |
    ('createdAt' > []))
```

- [ ] **Step 2: Compute the distinct-agents summary**

Add next to the existing `sourceLabel` useMemo:

```tsx
const distinctAgents = useMemo(
  () => Array.from(new Set(artifacts.map(a => a.agent))),
  [artifacts]
)
```

- [ ] **Step 3: Render the header avatar stack + cross-agent hint**

In the header `<div className='flex items-center gap-2.5'>`, before the `sourceCount` span, add the avatar stack and (when >1 distinct agent) the "跨 agent" label:

```tsx
<div className='flex items-center gap-2.5'>
  <span className='text-xs font-semibold tracking-wide text-muted-foreground'>
    {intl.formatMessage({ id: 'taskArtifact.groupLabel' })}
  </span>
  <span className='flex -space-x-1.5'>
    {distinctAgents.map(agent => (
      <AgentAvatar key={agent} agent={agent} />
    ))}
  </span>
  {distinctAgents.length > 1 && (
    <span className='text-xs text-muted-foreground'>
      {intl.formatMessage({ id: 'taskArtifact.crossAgent' })}
    </span>
  )}
  <span className='text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded inline-flex items-center gap-1'>
    <Sparkle className='size-3 fill-current' />
    {intl.formatMessage(
      { id: 'taskArtifact.sourceCount' },
      { source: sourceLabel, count: artifacts.length }
    )}
  </span>
</div>
```

- [ ] **Step 4: Render the per-row badge**

In the row header `<button>`, after the title span (line ~83), add the badge pushed to the right:

```tsx
                <span className='text-sm text-foreground'>{a.title}</span>
                <span className='ml-auto'>
                  <AgentBadge agent={a.agent} />
                </span>
```

- [ ] **Step 5: Add an agent selector to `ManualAddForm`**

In `ManualAddForm`, add agent state (default `CLAUDE_CODE`):

```tsx
const [kind, setKind] = useState('')
const [title, setTitle] = useState('')
const [content, setContent] = useState('')
const [agent, setAgent] = useState<TaskArtifactAgent>(
  TaskArtifactAgent.CLAUDE_CODE
)
const [saving, setSaving] = useState(false)
```

Add a `<select>` before the `<textarea>`:

```tsx
<select
  value={agent}
  onChange={e => setAgent(e.target.value as TaskArtifactAgent)}
  className='w-full text-sm bg-transparent border border-input rounded px-2 py-1 outline-none'
  aria-label={intl.formatMessage({ id: 'taskArtifact.selectAgent' })}
>
  {Object.values(TaskArtifactAgent).map(value => (
    <option key={value} value={value}>
      {intl.formatMessage({ id: `taskArtifact.agent.${value}` })}
    </option>
  ))}
</select>
```

Include `agent` in the create payload:

```tsx
await artifactsClient.add(taskId, {
  kind: kind.trim(),
  title: title.trim(),
  content,
  source: 'manual',
  agent,
})
```

- [ ] **Step 6: Verify compile + manual smoke**

Run: `npx tsc --noEmit`
Expected: no errors.

Then verify in the browser preview (the spec layer renders only when a task has artifacts): open a task with artifacts, confirm each row shows the brand-icon badge and the header shows stacked avatars (+ "跨 agent" when artifacts differ). Add a new artifact via the form and confirm the agent selector persists.

- [ ] **Step 7: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/SpecArtifactGroup.tsx
git commit -m "feat: render agent badges in spec artifact group [LUM-115]"
```

---

## Task 14: i18n (16 locales)

**Files:**

- Modify: all 16 `lib/i18n/*.json`

Add these 8 keys to **every** locale file (next to the existing `taskArtifact.*` keys), translated per language — no English fallback for non-English locales. The agent **product names** (Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, Windsurf) are proper nouns and stay in their canonical Latin form across all locales; only `selectAgent` and `crossAgent` get translated.

- [ ] **Step 1: Add keys to `en.json`** (and the en-AU / en-GB variants identically):

```json
  "taskArtifact.agent.CLAUDE_CODE": "Claude Code",
  "taskArtifact.agent.CODEX": "Codex",
  "taskArtifact.agent.CURSOR": "Cursor",
  "taskArtifact.agent.GEMINI_CLI": "Gemini CLI",
  "taskArtifact.agent.GITHUB_COPILOT": "GitHub Copilot",
  "taskArtifact.agent.WINDSURF": "Windsurf",
  "taskArtifact.selectAgent": "Agent",
  "taskArtifact.crossAgent": "Cross-agent",
```

- [ ] **Step 2: Add to `zh-CN.json`** (keep product names Latin):

```json
  "taskArtifact.agent.CLAUDE_CODE": "Claude Code",
  "taskArtifact.agent.CODEX": "Codex",
  "taskArtifact.agent.CURSOR": "Cursor",
  "taskArtifact.agent.GEMINI_CLI": "Gemini CLI",
  "taskArtifact.agent.GITHUB_COPILOT": "GitHub Copilot",
  "taskArtifact.agent.WINDSURF": "Windsurf",
  "taskArtifact.selectAgent": "Agent",
  "taskArtifact.crossAgent": "跨 agent",
```

- [ ] **Step 3: Add to `zh-TW.json`** (`crossAgent` → `跨 agent`, `selectAgent` → `Agent`); the 6 agent names stay Latin.

- [ ] **Step 4: Add to the remaining 11 locales** (`es`, `es-419`, `fr`, `de`, `ja`, `ko`, `ru`, `vi`, `hi`, `id`, `ms`), translating only `selectAgent` and `crossAgent`:

| locale | selectAgent  | crossAgent        |
| ------ | ------------ | ----------------- |
| es     | Agente       | Multiagente       |
| es-419 | Agente       | Multiagente       |
| fr     | Agent        | Multi-agent       |
| de     | Agent        | Agentübergreifend |
| ja     | エージェント | エージェント横断  |
| ko     | 에이전트     | 에이전트 통합     |
| ru     | Агент        | Меж-агентный      |
| vi     | Tác nhân     | Đa tác nhân       |
| hi     | एजेंट        | क्रॉस-एजेंट       |
| id     | Agen         | Lintas-agen       |
| ms     | Ejen         | Merentas-ejen     |

The 6 `taskArtifact.agent.*` product-name keys are identical (Latin) in all of these.

- [ ] **Step 5: Verify JSON validity**

Run: `node -e "for (const f of require('fs').readdirSync('lib/i18n').filter(x=>x.endsWith('.json'))) { JSON.parse(require('fs').readFileSync('lib/i18n/'+f,'utf8')); } console.log('all locale JSON valid')"`
Expected: `all locale JSON valid`.

- [ ] **Step 6: Commit**

```bash
git add lib/i18n
git commit -m "feat: i18n for artifact agent labels (16 locales) [LUM-115]"
```

---

## Task 15: Update SKILL.md (CLI doc sync)

**Files:**

- Modify: `.claude/skills/lumo/SKILL.md`

Mandated by CLAUDE.md: any `cli/src/commands/` change must update SKILL.md.

- [ ] **Step 1: Document `--agent` on `artifact add`**

In the `artifact add` section, change the command signature line to include `--agent`:

```
lumo task artifact add <task> --kind <kind> --title <title> --file <path> --source <source> --agent <agent>
```

Add a sentence: `--agent` is **required** and names the coding tool that produced the artifact. Valid values: `claude-code | codex | cursor | gemini-cli | github-copilot | windsurf` (case-insensitive; `gemini` and `copilot` are accepted aliases). Update the example commands to include `--agent`, e.g.:

```bash
lumo task artifact add LUM-42 --kind spec --title "Spec" --file docs/spec.md --source Superpowers --agent claude-code
```

- [ ] **Step 2: Document `--agent` on `artifact update`**

In the `artifact update` section, add `--agent <agent>` to the editable-fields list (optional; same valid values/aliases as add). Note editable fields are now **kind, title, source, and agent** (content still immutable).

- [ ] **Step 3: Update `artifact list` / `show` output description**

Note that `artifact list` now prints `<id>  <kind>  <agent>  <source>  <title>` and `artifact show` includes an `agent:` line.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/lumo/SKILL.md
git commit -m "docs: sync SKILL.md with artifact --agent flag [LUM-115]"
```

---

## Task 16: Full verification

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all pass, including the new agent tests.

- [ ] **Step 3: Lint check for `console.log`**

Run: `grep -rn "console.log" lib/services lib/repositories lib/validation app/api/tasks/\[id\]/artifacts components/icons/agents app/workspace/\[workspaceUrl\]/components/AgentBadge.tsx`
Expected: no matches (production code uses no `console.log`; CLI uses `console.error`/`process.stdout`, which is fine).

- [ ] **Step 4: Confirm migration applied locally**

Run: `npx prisma migrate status`
Expected: `Database schema is up to date!` with `add_task_artifact_agent` listed.

- [ ] **Step 5: Open the PR**

Branch is `lumo/LUM-115-spec-artifact-agent`. PR title: `feat: spec artifact agent enum field [LUM-115]`. In the PR description, note:

- New Prisma migration `add_task_artifact_agent` — **requires `prisma migrate deploy` on next deploy**. Non-destructive: adds a `NOT NULL DEFAULT 'CLAUDE_CODE'` column (existing rows backfilled to Claude Code).
- No new npm dependencies (brand icons are hand-authored SVGs).

---

## Self-Review (completed during plan authoring)

- **Spec coverage:** schema/enum (T1), validation (T2), repository (T3), service (T4), API route + client (T5), CLI add/update/list/show (T6–T9), task-context injection (T10), brand icons (T11), AgentBadge (T12), SpecArtifactGroup UI incl. cross-agent header + ManualAddForm selector (T13), i18n 16 locales (T14), SKILL.md (T15) — every spec section maps to a task.
- **Type consistency:** `TaskArtifactAgent` (Prisma enum) used server-side; CLI uses string enum values via `normalizeAgent`; `AGENT_META` keyed by `TaskArtifactAgent`; `agent` is `TaskArtifactAgent` (required) in Create inputs, `TaskArtifactAgent | undefined` in Update inputs, `agent?: string` in the context-render type (tolerant of legacy callers).
- **Backfill:** single migration `NOT NULL DEFAULT 'CLAUDE_CODE'` — no separate UPDATE.
