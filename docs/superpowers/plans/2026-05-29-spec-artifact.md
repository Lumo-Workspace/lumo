# Spec Artifact (TaskArtifact) Implementation Plan [LUM-109]

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record Claude Code spec-engineering products (spec / plan / design …) onto a Lumo task via a generic `lumo task artifact add` CLI, surface them in the task detail page's definition layer, and inject them into `lumo task context`.

**Architecture:** A new `TaskArtifact` table sits alongside the existing `TaskWebLink` / `TaskFigmaLink` task-attached entities (same vertical slice: repository → service → dual-auth API route → API client → CLI). `onDelete: Cascade` ties artifacts to their task. The CLI writes via a bearer-auth route that resolves `LUM-N` server-side (the same `requireIdentity` + `resolveTask` pattern the Figma route uses). Context injection mirrors `renderWebLinkSection`. The UI adds a "definition layer" group above the description; when a task has ≥1 artifact the description demotes to a collapsed "背景讨论" block.

**Tech Stack:** Prisma (Neon Postgres), Next.js 14 App Router route handlers, Zod, Commander-based CLI (`cli/src`), React + Tailwind + react-intl, Jest.

**Spec:** [`docs/superpowers/specs/2026-05-29-spec-artifact-design.md`](../specs/2026-05-29-spec-artifact-design.md) · **Mockup:** [`docs/superpowers/specs/2026-05-29-spec-artifact-ui-mockup.html`](../specs/2026-05-29-spec-artifact-ui-mockup.html)

**Out of scope (do NOT build):** approve/gate/status, `isGate`, versioning, reuse of `Document`/`DocumentMention`, `kind` enumeration/translation/icons, touching `Task.spec` or the agent-server `SPEC_GENERATED`/`confirm_spec` flow.

---

## File Structure

**Create:**
- `lib/repositories/task-artifact.repository.ts` — Prisma CRUD (create, listByTask, countByTask)
- `lib/services/task-artifact.service.ts` — `addArtifact` (computes append order), `listForTask`
- `lib/validation/task-artifact.ts` — Zod body schema
- `app/api/tasks/[id]/artifacts/route.ts` — dual-auth GET/POST
- `lib/api-client/task-artifacts.ts` — fetch wrapper (imported by module path, NOT via the `@/lib/api-client` barrel — per-task clients aren't re-exported there)
- `app/workspace/[workspaceUrl]/hooks/useArtifacts.ts` — TanStack Query hook (mirrors `useWebLinks`)
- `cli/src/commands/task-artifact-add.ts` — `lumo task artifact add`
- `cli/src/commands/task-artifact-list.ts` — `lumo task artifact list`
- `app/workspace/[workspaceUrl]/components/SpecArtifactGroup.tsx` — definition-layer UI
- Test files under `__tests__/` mirroring each unit

**Modify:**
- `prisma/schema.prisma` — add `TaskArtifact` model + reverse relations on `Task` and `Workspace`
- `lib/services/task-context.service.ts` — add `renderArtifactSection` + wire `artifactSection` into `getContextForIdentifier` + `TaskContext` interface
- `cli/src/commands/task-context.ts` — inline `artifactSection`
- `lib/query/keys.ts` — add `taskArtifacts(taskId)` query key
- `cli/src/index.ts` — register the `task artifact` subcommand group
- `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx` — fetch artifacts, render group, conditional description collapse
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection.tsx` — add "仅参考资料" note
- `lib/i18n/*.json` (all 17 locales) — new UI strings
- `.claude/skills/lumo/SKILL.md` — document the new CLI commands

---

## Task 0: Branch

- [ ] **Step 1: Create the feature branch**

Run:
```bash
git checkout -b lumo/LUM-109-spec-artifact
```

(Per CLAUDE.md: never commit to `main`. All task commits below land on this branch.)

---

## Task 1: Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma` (TaskArtifact model + `Task.artifacts` at :449, `Workspace.taskArtifacts` near :194)

- [ ] **Step 1: Add the `TaskArtifact` model**

Insert immediately after the `TaskWebLink` model closes (`@@map("task_web_links")`, around line 1383):

```prisma
model TaskArtifact {
  id          String @id @default(cuid())
  taskId      String
  workspaceId String

  kind    String // "spec" | "plan" | "design" … opaque, declared by writer
  title   String
  content String  @db.Text
  source  String // "superpowers" | "claude-code" | "manual"
  order   Int     @default(0)

  createdById String? // WorkspaceMember.id; nullable, intentionally no FK relation
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  task      Task      @relation(fields: [taskId], references: [id], onDelete: Cascade)
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([taskId, order])
  @@index([workspaceId])
  @@map("task_artifacts")
}
```

Note: unlike `TaskWebLink`, `createdById` is `String?` with **no** `createdBy WorkspaceMember @relation` — keep it a plain optional string (per spec). This means no reverse relation is added to `WorkspaceMember`.

- [ ] **Step 2: Add the reverse relation on `Task`**

In `model Task`, after `figmaLinks TaskFigmaLink[]` (line 449), add:
```prisma
  artifacts         TaskArtifact[]
```

- [ ] **Step 3: Add the reverse relation on `Workspace`**

In `model Workspace`, after `taskFigmaLinks TaskFigmaLink[]` (line 194), add:
```prisma
  taskArtifacts      TaskArtifact[]
```

- [ ] **Step 4: Create + apply the migration**

Run:
```bash
npx prisma migrate dev --name add_task_artifact
```
Expected: a new `prisma/migrations/<ts>_add_task_artifact/migration.sql` creating `task_artifacts`, and `prisma generate` regenerating the client. If migrate dev hits checksum drift (P3008/P3012) on a *previously-applied* migration, follow the CLAUDE.md hand-write-SQL workaround — **never** `migrate reset`.

- [ ] **Step 5: Verify the client type exists**

Run:
```bash
npx tsc --noEmit
```
Expected: PASS (no errors). The `TaskArtifact` type is now importable from `@prisma/client`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add TaskArtifact model + migration [LUM-109]"
```

---

## Task 2: Repository

**Files:**
- Create: `lib/repositories/task-artifact.repository.ts`
- Test: `__tests__/repositories/task-artifact.repository.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/repositories/task-artifact.repository.test.ts`:
```ts
/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    taskArtifact: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { taskArtifactRepository } from '@/lib/repositories/task-artifact.repository'

const mockPrisma = prisma as unknown as {
  taskArtifact: {
    create: jest.Mock
    findMany: jest.Mock
    count: jest.Mock
  }
}

describe('taskArtifactRepository', () => {
  beforeEach(() => jest.clearAllMocks())

  it('create passes input straight through', async () => {
    mockPrisma.taskArtifact.create.mockResolvedValue({ id: 'a1' })
    const input = {
      taskId: 't1',
      workspaceId: 'w1',
      kind: 'spec',
      title: 'Spec',
      content: '## Requirements',
      source: 'claude-code',
      order: 0,
      createdById: 'm1',
    }
    const out = await taskArtifactRepository.create(input)
    expect(mockPrisma.taskArtifact.create).toHaveBeenCalledWith({ data: input })
    expect(out).toEqual({ id: 'a1' })
  })

  it('listByTask orders by order asc', async () => {
    mockPrisma.taskArtifact.findMany.mockResolvedValue([])
    await taskArtifactRepository.listByTask('t1')
    expect(mockPrisma.taskArtifact.findMany).toHaveBeenCalledWith({
      where: { taskId: 't1' },
      orderBy: { order: 'asc' },
    })
  })

  it('countByTask counts rows for the task', async () => {
    mockPrisma.taskArtifact.count.mockResolvedValue(2)
    const n = await taskArtifactRepository.countByTask('t1')
    expect(mockPrisma.taskArtifact.count).toHaveBeenCalledWith({
      where: { taskId: 't1' },
    })
    expect(n).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest task-artifact.repository -c jest.config.js`
Expected: FAIL — `Cannot find module '@/lib/repositories/task-artifact.repository'`.

- [ ] **Step 3: Write the repository**

`lib/repositories/task-artifact.repository.ts`:
```ts
import { prisma } from '@/lib/db/prisma'

export interface CreateTaskArtifactInput {
  taskId: string
  workspaceId: string
  kind: string
  title: string
  content: string
  source: string
  order: number
  createdById: string | null
}

export const taskArtifactRepository = {
  async create(input: CreateTaskArtifactInput) {
    return prisma.taskArtifact.create({ data: input })
  },

  async listByTask(taskId: string) {
    return prisma.taskArtifact.findMany({
      where: { taskId },
      orderBy: { order: 'asc' },
    })
  },

  async countByTask(taskId: string) {
    return prisma.taskArtifact.count({ where: { taskId } })
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest task-artifact.repository -c jest.config.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/task-artifact.repository.ts __tests__/repositories/task-artifact.repository.test.ts
git commit -m "feat: add taskArtifactRepository [LUM-109]"
```

---

## Task 3: Service

**Files:**
- Create: `lib/services/task-artifact.service.ts`
- Test: `__tests__/services/task-artifact.service.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/services/task-artifact.service.test.ts`:
```ts
/** @jest-environment node */
jest.mock('@/lib/repositories/task-artifact.repository', () => ({
  taskArtifactRepository: {
    create: jest.fn(),
    listByTask: jest.fn(),
    countByTask: jest.fn(),
  },
}))

import { taskArtifactRepository } from '@/lib/repositories/task-artifact.repository'
import { taskArtifactService } from '@/lib/services/task-artifact.service'

const repo = taskArtifactRepository as unknown as {
  create: jest.Mock
  listByTask: jest.Mock
  countByTask: jest.Mock
}

describe('taskArtifactService.addArtifact', () => {
  beforeEach(() => jest.clearAllMocks())

  it('appends at order = current count', async () => {
    repo.countByTask.mockResolvedValue(2)
    repo.create.mockResolvedValue({ id: 'a3' })
    await taskArtifactService.addArtifact({
      taskId: 't1',
      workspaceId: 'w1',
      kind: 'plan',
      title: 'Plan',
      content: '1. step',
      source: 'superpowers',
      actorMemberId: 'm1',
    })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ order: 2, createdById: 'm1', source: 'superpowers' })
    )
  })

  it("defaults source to 'claude-code' when omitted", async () => {
    repo.countByTask.mockResolvedValue(0)
    repo.create.mockResolvedValue({ id: 'a1' })
    await taskArtifactService.addArtifact({
      taskId: 't1',
      workspaceId: 'w1',
      kind: 'spec',
      title: 'Spec',
      content: 'x',
      source: undefined,
      actorMemberId: null,
    })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'claude-code', order: 0, createdById: null })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest task-artifact.service -c jest.config.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

`lib/services/task-artifact.service.ts`:
```ts
import { taskArtifactRepository } from '@/lib/repositories/task-artifact.repository'

export interface AddArtifactInput {
  taskId: string
  workspaceId: string
  kind: string
  title: string
  content: string
  source: string | undefined
  actorMemberId: string | null
}

export const taskArtifactService = {
  async listForTask(taskId: string) {
    return taskArtifactRepository.listByTask(taskId)
  },

  async addArtifact(input: AddArtifactInput) {
    const order = await taskArtifactRepository.countByTask(input.taskId)
    return taskArtifactRepository.create({
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      kind: input.kind,
      title: input.title,
      content: input.content,
      source: input.source ?? 'claude-code',
      order,
      createdById: input.actorMemberId,
    })
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest task-artifact.service -c jest.config.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-artifact.service.ts __tests__/services/task-artifact.service.test.ts
git commit -m "feat: add taskArtifactService [LUM-109]"
```

---

## Task 4: Context render function

**Files:**
- Modify: `lib/services/task-context.service.ts` (add `renderArtifactSection`)
- Test: `__tests__/services/task-context-service-artifacts.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/services/task-context-service-artifacts.test.ts` (mirrors the web-links render test — mock every repo so the module imports cleanly, then test the pure render fn):
```ts
/** @jest-environment node */
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: { resolveIdentifier: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { listForTask: jest.fn() },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn(),
    findActiveProjectMemories: jest.fn(),
  },
}))
jest.mock('@/lib/memory/render', () => ({
  renderMemorySection: jest.fn(() => ''),
  applyTokenBudget: jest.fn((x: unknown[]) => x),
}))

import { renderArtifactSection } from '@/lib/services/task-context.service'

describe('renderArtifactSection', () => {
  it('returns empty string when no artifacts', () => {
    expect(renderArtifactSection([])).toBe('')
  })

  it('renders each artifact as ## [kind] title + content, in array order', () => {
    const md = renderArtifactSection([
      { kind: 'spec', title: 'Spec', content: '## Requirements\n- a' },
      { kind: 'plan', title: 'Implementation plan', content: '1. step one' },
    ])
    expect(md).toContain('## [spec] Spec')
    expect(md).toContain('## Requirements')
    expect(md).toContain('## [plan] Implementation plan')
    expect(md).toContain('1. step one')
    expect(md.indexOf('[spec] Spec')).toBeLessThan(md.indexOf('[plan] Implementation plan'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest task-context-service-artifacts -c jest.config.js`
Expected: FAIL — `renderArtifactSection` is not exported.

- [ ] **Step 3: Add the render function**

In `lib/services/task-context.service.ts`, after `renderFigmaSection` (ends line 208), add:
```ts
export function renderArtifactSection(
  artifacts: Array<{ kind: string; title: string; content: string }>
): string {
  if (artifacts.length === 0) return ''
  const blocks: string[] = []
  for (const a of artifacts) {
    blocks.push(`## [${a.kind}] ${a.title}`)
    blocks.push('')
    blocks.push(a.content.trimEnd())
    blocks.push('')
  }
  return blocks.join('\n').trimEnd()
}
```

(Decision: each artifact is its own `## [kind] title` block — matches the spec's "## <title>" with kind kept visible. Artifacts are full documents, not list items, so unlike `renderWebLinkSection` there is no single wrapper header.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest task-context-service-artifacts -c jest.config.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-context.service.ts __tests__/services/task-context-service-artifacts.test.ts
git commit -m "feat: add renderArtifactSection [LUM-109]"
```

---

## Task 5: Wire artifactSection into the context payload

**Files:**
- Modify: `lib/services/task-context.service.ts` (`TaskContext` interface + `getContextForIdentifier`)
- Modify: `cli/src/commands/task-context.ts` (interface + inline)
- Test: `__tests__/cli/task-context-artifact-section.test.ts`

- [ ] **Step 1: Add `artifactSection` to the `TaskContext` interface**

In `lib/services/task-context.service.ts`, in the `TaskContext` interface (after `figmaSection: string` at line 56), add:
```ts
  /** Pre-rendered artifact section (## [kind] title + content); empty when none. */
  artifactSection: string
```

- [ ] **Step 2: Import the repository**

At the top of `lib/services/task-context.service.ts`, add to the imports:
```ts
import { taskArtifactRepository } from '@/lib/repositories/task-artifact.repository'
```

- [ ] **Step 3: Fetch + render inside `getContextForIdentifier`**

In `getContextForIdentifier`, after the `figmaLinks` block (line 306-310), add:
```ts
    const artifacts = await taskArtifactRepository.listByTask(resolved.id)
    const artifactSection = renderArtifactSection(artifacts)
```
Then in the returned object, after `figmaSection,` (line 348), add:
```ts
      artifactSection,
```

- [ ] **Step 4: Write the failing CLI inline test**

`__tests__/cli/task-context-artifact-section.test.ts`:
```ts
/** @jest-environment node */
import { formatTaskContextMarkdown } from '@/cli/src/commands/task-context'

const NOW = new Date('2026-05-29T12:00:00Z')

describe('formatTaskContextMarkdown — artifactSection', () => {
  it('omits the section when artifactSection is empty/missing', () => {
    const out = formatTaskContextMarkdown(
      {
        task: { identifier: 'LUM-1', title: 't', status: 'TODO', description: 'd' },
        artifactSection: '',
        sessions: [],
      },
      NOW
    )
    expect(out).not.toContain('[spec]')
  })

  it('inserts artifacts after figma and before sessions', () => {
    const out = formatTaskContextMarkdown(
      {
        task: { identifier: 'LUM-1', title: 't', status: 'TODO', description: 'd' },
        figmaSection: '## Figma Designs\n\n- **F**',
        artifactSection: '## [spec] Spec\n\n## Requirements',
        sessions: [],
      },
      NOW
    )
    expect(out.indexOf('Figma Designs')).toBeLessThan(out.indexOf('[spec] Spec'))
    expect(out.indexOf('[spec] Spec')).toBeLessThan(out.indexOf('Previous Sessions'))
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx jest task-context-artifact-section -c jest.config.js`
Expected: FAIL — artifact text not present (field not yet handled).

- [ ] **Step 6: Add `artifactSection` to the CLI interface + inline it**

In `cli/src/commands/task-context.ts`, in `TaskContextResponse` (after `figmaSection?: string` at line 22), add:
```ts
  artifactSection?: string
```
Then in `formatTaskContextMarkdown`, after the figma block (lines 130-133, before the `sessions.length === 0` check), add:
```ts
  if (data.artifactSection && data.artifactSection.trim().length > 0) {
    lines.push(data.artifactSection.trimEnd())
    lines.push('')
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx jest task-context-artifact-section -c jest.config.js`
Expected: PASS (2 tests).

- [ ] **Step 8: Typecheck + commit**

Run: `npx tsc --noEmit` → Expected: PASS.
```bash
git add lib/services/task-context.service.ts cli/src/commands/task-context.ts __tests__/cli/task-context-artifact-section.test.ts
git commit -m "feat: inject artifactSection into task context [LUM-109]"
```

---

## Task 6: Validation schema

**Files:**
- Create: `lib/validation/task-artifact.ts`
- Test: `__tests__/validation/task-artifact.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/validation/task-artifact.test.ts`:
```ts
/** @jest-environment node */
import { createArtifactBodySchema } from '@/lib/validation/task-artifact'

describe('createArtifactBodySchema', () => {
  it('accepts a full valid body', () => {
    const r = createArtifactBodySchema.safeParse({
      kind: 'spec',
      title: 'Spec',
      content: '## Requirements',
      source: 'superpowers',
    })
    expect(r.success).toBe(true)
  })

  it('accepts a body without source (optional)', () => {
    const r = createArtifactBodySchema.safeParse({
      kind: 'plan',
      title: 'Plan',
      content: 'x',
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty kind / title / content', () => {
    expect(createArtifactBodySchema.safeParse({ kind: '', title: 'T', content: 'c' }).success).toBe(false)
    expect(createArtifactBodySchema.safeParse({ kind: 'k', title: '', content: 'c' }).success).toBe(false)
    expect(createArtifactBodySchema.safeParse({ kind: 'k', title: 'T', content: '' }).success).toBe(false)
  })

  it('rejects unknown keys (strict)', () => {
    const r = createArtifactBodySchema.safeParse({
      kind: 'k', title: 'T', content: 'c', status: 'APPROVED',
    })
    expect(r.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest validation/task-artifact -c jest.config.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the schema**

`lib/validation/task-artifact.ts`:
```ts
import { z } from 'zod'

export const createArtifactBodySchema = z
  .object({
    kind: z.string().trim().min(1).max(64),
    title: z.string().trim().min(1).max(256),
    content: z.string().min(1).max(1_000_000),
    source: z.string().trim().min(1).max(64).optional(),
  })
  .strict()

export type CreateArtifactBody = z.infer<typeof createArtifactBodySchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest validation/task-artifact -c jest.config.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/validation/task-artifact.ts __tests__/validation/task-artifact.test.ts
git commit -m "feat: add task-artifact validation schema [LUM-109]"
```

---

## Task 7: API route (dual-auth)

**Files:**
- Create: `app/api/tasks/[id]/artifacts/route.ts`
- Test: `__tests__/api/tasks-artifacts.test.ts`

This route must accept **bearer** auth (CLI) as well as Clerk (browser), so it uses `requireIdentity` + `resolveTask` exactly like `app/api/tasks/[id]/figma/route.ts` — NOT the Clerk-only `requireAuth` that `web-links/route.ts` uses. `resolveTask` lets the CLI pass `LUM-109` straight in the URL.

- [ ] **Step 1: Write the route**

`app/api/tasks/[id]/artifacts/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskArtifactService } from '@/lib/services/task-artifact.service'
import { createArtifactBodySchema } from '@/lib/validation/task-artifact'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

/** Returns true when the segment looks like a Prisma cuid (c + 24 alphanum chars). */
function isLikelyCuid(segment: string): boolean {
  return /^c[a-z0-9]{24}$/.test(segment)
}

function parseIdentifier(
  segment: string
): { teamIdentifier: string; number: number } | null {
  const m = /^([A-Za-z]+)-(\d+)$/.exec(segment)
  if (!m) return null
  return { teamIdentifier: m[1]!.toUpperCase(), number: parseInt(m[2]!, 10) }
}

/** Resolve `[id]` (cuid or LUM-N) to a task scoped to the caller's workspace. */
async function resolveTask(rawId: string, workspaceId: string) {
  if (isLikelyCuid(rawId)) {
    return taskRepository.findByIdForMention(rawId, workspaceId)
  }
  const parsed = parseIdentifier(rawId)
  if (!parsed) return null
  return taskRepository.findByWorkspaceIdentifier(
    workspaceId,
    parsed.teamIdentifier,
    parsed.number
  )
}

export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTask(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const artifacts = await taskArtifactService.listForTask(task.id)
  return NextResponse.json({ artifacts })
}

export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTask(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = createArtifactBodySchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const artifact = await taskArtifactService.addArtifact({
    taskId: task.id,
    workspaceId: identity.workspaceId,
    kind: parsed.data.kind,
    title: parsed.data.title,
    content: parsed.data.content,
    source: parsed.data.source,
    actorMemberId: identity.memberId,
  })
  return NextResponse.json({ artifact }, { status: 201 })
}
```

- [ ] **Step 2: Write the failing test**

`__tests__/api/tasks-artifacts.test.ts`:
```ts
/** @jest-environment node */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByIdForMention: jest.fn(),
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/services/task-artifact.service', () => ({
  taskArtifactService: { listForTask: jest.fn(), addArtifact: jest.fn() },
}))

import { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskArtifactService } from '@/lib/services/task-artifact.service'
import { GET, POST } from '@/app/api/tasks/[id]/artifacts/route'

const ID = { workspaceId: 'w1', memberId: 'm1', source: 'bearer' }
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => jest.clearAllMocks())

it('POST resolves LUM-N and returns 201 with the created artifact', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue({ id: 't1' })
  ;(taskArtifactService.addArtifact as jest.Mock).mockResolvedValue({ id: 'a1', title: 'Spec' })

  const req = new NextRequest('http://x/api/tasks/LUM-9/artifacts', {
    method: 'POST',
    body: JSON.stringify({ kind: 'spec', title: 'Spec', content: '## R' }),
  })
  const res = await POST(req, params('LUM-9'))
  expect(res.status).toBe(201)
  expect(taskRepository.findByWorkspaceIdentifier).toHaveBeenCalledWith('w1', 'LUM', 9)
  expect(taskArtifactService.addArtifact).toHaveBeenCalledWith(
    expect.objectContaining({ taskId: 't1', workspaceId: 'w1', actorMemberId: 'm1' })
  )
})

it('POST returns 400 on invalid body', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue({ id: 't1' })
  const req = new NextRequest('http://x/api/tasks/LUM-9/artifacts', {
    method: 'POST',
    body: JSON.stringify({ kind: '', title: 'Spec', content: 'x' }),
  })
  const res = await POST(req, params('LUM-9'))
  expect(res.status).toBe(400)
})

it('GET returns 404 when the task does not resolve', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue(null)
  const res = await GET(new NextRequest('http://x'), params('LUM-404'))
  expect(res.status).toBe(404)
})
```

- [ ] **Step 3: Run test to verify it fails, then passes**

Run: `npx jest tasks-artifacts -c jest.config.js`
Expected: FAIL first (before route exists) → after Step 1 the route exists, so re-running: PASS (3 tests). If you wrote Step 1 before the test, run now → Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/tasks/[id]/artifacts/route.ts __tests__/api/tasks-artifacts.test.ts
git commit -m "feat: add /api/tasks/[id]/artifacts route [LUM-109]"
```

---

## Task 8: API client

**Files:**
- Create: `lib/api-client/task-artifacts.ts`

Per-task clients (`webLinksClient`, `taskFigmaLinksClient`) are NOT re-exported from the `@/lib/api-client` barrel — consumers import them directly from their module path (e.g. `import { webLinksClient } from '@/lib/api-client/task-web-links'`). Do the same here: **no barrel edit**. The hook (Task 8b) and any component import `artifactsClient` from `@/lib/api-client/task-artifacts`.

- [ ] **Step 1: Write the client**

`lib/api-client/task-artifacts.ts`:
```ts
import { apiFetch } from './base'
import type { TaskArtifact } from '@prisma/client'

export interface CreateArtifactPayload {
  kind: string
  title: string
  content: string
  source?: string
}

export const artifactsClient = {
  list(taskId: string): Promise<{ artifacts: TaskArtifact[] }> {
    return apiFetch(`/api/tasks/${taskId}/artifacts`)
  },

  add(
    taskId: string,
    payload: CreateArtifactPayload
  ): Promise<{ artifact: TaskArtifact }> {
    return apiFetch(`/api/tasks/${taskId}/artifacts`, {
      method: 'POST',
      body: payload,
    })
  },
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` → Expected: PASS.
```bash
git add lib/api-client/task-artifacts.ts
git commit -m "feat: add artifactsClient [LUM-109]"
```

---

## Task 8b: useArtifacts hook

**Files:**
- Modify: `lib/query/keys.ts` (add `taskArtifacts`)
- Create: `app/workspace/[workspaceUrl]/hooks/useArtifacts.ts`

Mirror `useWebLinks` (TanStack Query). The page consumes this; `SpecArtifactGroup` stays presentational.

- [ ] **Step 1: Add the query key**

In `lib/query/keys.ts`, after `taskFigmaLinks` (line 84), add:
```ts
  taskArtifacts: (taskId: string) => ['task-artifacts', taskId] as const,
```

- [ ] **Step 2: Write the hook**

`app/workspace/[workspaceUrl]/hooks/useArtifacts.ts`:
```ts
'use client'

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { artifactsClient } from '@/lib/api-client/task-artifacts'
import { queryKeys } from '@/lib/query/keys'
import type { TaskArtifact } from '@prisma/client'

interface UseArtifactsResult {
  artifacts: TaskArtifact[]
  loading: boolean
  refresh: () => Promise<void>
}

export function useArtifacts(taskId: string, enabled = true): UseArtifactsResult {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.taskArtifacts(taskId)

  const query = useQuery<TaskArtifact[], Error>({
    queryKey,
    queryFn: async () => {
      const { artifacts } = await artifactsClient.list(taskId)
      return artifacts
    },
    enabled,
  })

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  return {
    artifacts: query.data ?? [],
    loading: query.isLoading,
    refresh,
  }
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` → Expected: PASS.
```bash
git add lib/query/keys.ts app/workspace/[workspaceUrl]/hooks/useArtifacts.ts
git commit -m "feat: add useArtifacts query hook [LUM-109]"
```

---

## Task 9: CLI commands

**Files:**
- Create: `cli/src/commands/task-artifact-add.ts`
- Create: `cli/src/commands/task-artifact-list.ts`
- Modify: `cli/src/index.ts` (register `task artifact` subgroup)
- Test: `__tests__/cli/task-artifact-add.test.ts`

The CLI passes `LUM-N` straight into the route URL (the route resolves it). It reads file content with `readFileUtf8`. Auth = `Bearer ${creds.token}`. Mirror `task-comment.ts` for the fetch/creds boilerplate.

- [ ] **Step 1: Write `task-artifact-add.ts`**

`cli/src/commands/task-artifact-add.ts`:
```ts
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { readFileUtf8 } from '../lib/doc-input'

export interface ArtifactAddOptions {
  kind?: string
  title?: string
  file?: string
  source?: string
}

interface ArtifactResponse {
  artifact: { id: string; kind: string; title: string }
}

export async function taskArtifactAdd(
  identifier: string | undefined,
  options: ArtifactAddOptions
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <task>. Usage: lumo task artifact add <LUM-42> --kind spec --title "Spec" --file spec.md'
    )
    return 1
  }
  const kind = options.kind?.trim()
  const title = options.title?.trim()
  if (!kind) {
    console.error('Error: --kind is required and cannot be empty.')
    return 1
  }
  if (!title) {
    console.error('Error: --title is required and cannot be empty.')
    return 1
  }
  if (!options.file) {
    console.error('Error: --file <path> is required.')
    return 1
  }

  let content: string
  try {
    content = await readFileUtf8(options.file)
  } catch {
    console.error(`Error: could not read file ${options.file}`)
    return 1
  }
  if (content.trim().length === 0) {
    console.error(`Error: file ${options.file} is empty.`)
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  const payload: Record<string, string> = { kind, title, content }
  if (options.source?.trim()) payload.source = options.source.trim()

  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(identifier)}/artifacts`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (res.status !== 201) {
    let serverMsg: string | null = null
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') serverMsg = errBody.error
    } catch {
      /* not JSON */
    }
    console.error(
      serverMsg ? `Error: ${serverMsg}` : `Error: artifact add failed (HTTP ${res.status})`
    )
    return 1
  }

  const data = (await res.json()) as ArtifactResponse
  process.stdout.write(
    `Added [${data.artifact.kind}] "${data.artifact.title}" to ${identifier}\n`
  )
}
```

- [ ] **Step 2: Write `task-artifact-list.ts`**

`cli/src/commands/task-artifact-list.ts`:
```ts
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'

interface ArtifactRow {
  id: string
  kind: string
  title: string
  source: string
  order: number
}

export async function taskArtifactList(
  identifier: string | undefined
): Promise<number | void> {
  if (!identifier) {
    console.error('Error: missing <task>. Usage: lumo task artifact list <LUM-42>')
    return 1
  }
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(identifier)}/artifacts`,
      { headers: { Authorization: `Bearer ${creds.token}` } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }
  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status === 404) {
    console.error(`Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`)
    return 1
  }
  if (!res.ok) {
    console.error(`Error: artifact list failed (HTTP ${res.status})`)
    return 1
  }

  const { artifacts } = (await res.json()) as { artifacts: ArtifactRow[] }
  if (artifacts.length === 0) {
    process.stdout.write(`No artifacts on ${identifier}\n`)
    return
  }
  for (const a of artifacts) {
    process.stdout.write(
      `${a.id}  ${a.kind.padEnd(10)}  ${a.source.padEnd(12)}  ${a.title}\n`
    )
  }
}
```

- [ ] **Step 3: Register in `cli/src/index.ts`**

Add imports near the other task command imports (after line 22):
```ts
import { taskArtifactAdd } from './commands/task-artifact-add'
import { taskArtifactList } from './commands/task-artifact-list'
```
After the `taskFigma` block (ends ~line 302), add:
```ts
const taskArtifact = task
  .command('artifact')
  .description('Record spec-engineering artifacts (spec / plan / design …) on a task')

taskArtifact
  .command('add <task>')
  .description(
    'Attach an artifact to a task. --kind/--title/--source are stored verbatim; --file supplies the content.'
  )
  .requiredOption('--kind <kind>', 'Artifact kind, e.g. spec | plan | design (opaque)')
  .requiredOption('--title <title>', 'Artifact title')
  .requiredOption('--file <path>', 'File whose contents become the artifact body')
  .option('--source <source>', 'Producer label (default: claude-code)')
  .action(
    wrap((taskId: unknown, options: unknown) =>
      taskArtifactAdd(taskId as string, options as Record<string, string>)
    )
  )

taskArtifact
  .command('list <task>')
  .description('List artifacts attached to a task, in order')
  .action(wrap((taskId: unknown) => taskArtifactList(taskId as string)))
```

- [ ] **Step 4: Write the failing test for `taskArtifactAdd`**

`__tests__/cli/task-artifact-add.test.ts`:
```ts
/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('@/cli/src/lib/doc-input', () => ({
  readFileUtf8: jest.fn(async () => '## Requirements\n- a'),
}))

import { taskArtifactAdd } from '@/cli/src/commands/task-artifact-add'

const okCreated = {
  ok: true,
  status: 201,
  json: async () => ({ artifact: { id: 'a1', kind: 'spec', title: 'Spec' } }),
} as unknown as Response

describe('taskArtifactAdd', () => {
  beforeEach(() => jest.restoreAllMocks())

  it('errors when --kind is missing', async () => {
    const code = await taskArtifactAdd('LUM-9', { title: 'Spec', file: 'f.md' })
    expect(code).toBe(1)
  })

  it('POSTs to the artifacts route with kind/title/content', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(okCreated)
    const code = await taskArtifactAdd('LUM-9', {
      kind: 'spec',
      title: 'Spec',
      file: 'f.md',
    })
    expect(code).toBeUndefined()
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(String(url)).toBe('https://api.test/api/tasks/LUM-9/artifacts')
    expect((init as RequestInit).method).toBe('POST')
    const sent = JSON.parse((init as RequestInit).body as string)
    expect(sent).toEqual({ kind: 'spec', title: 'Spec', content: '## Requirements\n- a' })
  })
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest task-artifact-add -c jest.config.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Build the CLI + smoke-test**

Run: `cd cli && npm run build` (or the repo's CLI build script — check `cli/package.json`).
Expected: tsc build succeeds. Then optionally: `lumo task artifact list LUM-109` → `No artifacts on LUM-109`.

- [ ] **Step 7: Commit**

```bash
git add cli/src/commands/task-artifact-add.ts cli/src/commands/task-artifact-list.ts cli/src/index.ts __tests__/cli/task-artifact-add.test.ts
git commit -m "feat: add 'lumo task artifact add/list' CLI [LUM-109]"
```

---

## Task 10: Update SKILL.md (CLAUDE.md requires CLI↔skill sync)

**Files:**
- Modify: `.claude/skills/lumo/SKILL.md`

- [ ] **Step 1: Add the trigger words to frontmatter `description`**

Append to the `description:` trigger list: `"task artifact", "artifact add", "spec artifact", "record spec", "attach spec", "attach plan"`.

- [ ] **Step 2: Add a command section**

Under the Task Management section (near the Figma subsection), add:
````markdown
### Task ↔ Spec Artifacts

#### `lumo task artifact add <task> --kind <kind> --title <title> --file <path> [--source <source>]`

Records a spec-engineering product (spec / plan / design …) on a task. `--kind`, `--title`, `--source` are stored verbatim (no enumeration — `kind` is opaque). `--file` supplies the body. `--source` defaults to `claude-code`. Appends to the end of the task's artifact list. The route resolves `LUM-N` directly.

```bash
lumo task artifact add LUM-42 --kind spec --title "Spec" --file docs/spec.md --source superpowers
lumo task artifact add LUM-42 --kind plan --title "Implementation plan" --file docs/plan.md --source superpowers
```

Output: `Added [spec] "Spec" to LUM-42`

#### `lumo task artifact list <task>`

Lists artifacts on the task in order: `<id>  <kind>  <source>  <title>`. Prints `No artifacts on <task>` when empty.

When to suggest: after running a spec/plan workflow in Claude Code, offer to record the product(s) with `task artifact add` (one call per artifact). These show up in the task detail "规格" definition layer and are injected into `lumo task context`.
````

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/lumo/SKILL.md
git commit -m "docs: document 'task artifact' commands in SKILL.md [LUM-109]"
```

---

## Task 11: UI — SpecArtifactGroup component

**Files:**
- Create: `app/workspace/[workspaceUrl]/components/SpecArtifactGroup.tsx`
- Modify: `lib/i18n/en.json`, `lib/i18n/zh-CN.json`, + the other 15 locale files
- Test: `__tests__/components/SpecArtifactGroup.test.tsx`

This is presentational: it receives `artifacts` (already fetched by the page) and renders the definition-layer group from the mockup — group head (label + source/count pill + `＋ 添加`) and one collapsible row per artifact. No status colors / badges / approve buttons. The `＋ 添加` button posts a manual artifact (`source: 'manual'`) via `artifactsClient.add` then calls `onChanged()`.

- [ ] **Step 1: Add i18n keys to `lib/i18n/en.json`**

Add (place near other `taskDetail.*` keys):
```json
"taskArtifact.groupLabel": "Spec",
"taskArtifact.sourceCount": "{source} · {count, plural, one {# artifact} other {# artifacts}}",
"taskArtifact.add": "Add",
"taskArtifact.addTitle": "Title",
"taskArtifact.addKind": "Kind (e.g. spec, plan)",
"taskArtifact.addContent": "Content (markdown)",
"taskArtifact.save": "Save",
"taskArtifact.cancel": "Cancel",
"taskArtifact.backgroundDiscussion": "Background discussion",
"taskArtifact.originalDescription": "(original description)",
"taskArtifact.docsRefOnly": "Reference only · spec is in the definition layer above"
```

- [ ] **Step 2: Add the same keys to `lib/i18n/zh-CN.json`**

```json
"taskArtifact.groupLabel": "规格",
"taskArtifact.sourceCount": "{source} · {count} 个产物",
"taskArtifact.add": "添加",
"taskArtifact.addTitle": "标题",
"taskArtifact.addKind": "类型（如 spec、plan）",
"taskArtifact.addContent": "内容（markdown）",
"taskArtifact.save": "保存",
"taskArtifact.cancel": "取消",
"taskArtifact.backgroundDiscussion": "背景讨论",
"taskArtifact.originalDescription": "（原 description）",
"taskArtifact.docsRefOnly": "仅参考资料 · spec 在上方定义层"
```

- [ ] **Step 3: Add the same keys to the remaining 15 locales — proper translations, no English fallback**

Files: `de.json`, `en-AU.json`, `en-GB.json`, `es-419.json`, `es.json`, `fr.json`, `hi.json`, `id.json`, `ja.json`, `ko.json`, `ms.json`, `ru.json`, `vi.json`, `zh-TW.json`. (en-AU/en-GB reuse the en wording.) Each file gets all 11 keys with a correct translation for that language (CLAUDE.md: never use English as a fallback for non-English locales). Keep the ICU structure of `taskArtifact.sourceCount` intact per language's plural rules.

- [ ] **Step 4: Write the failing component test**

`__tests__/components/SpecArtifactGroup.test.tsx`:
```tsx
/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import en from '@/lib/i18n/en.json'
import { SpecArtifactGroup } from '@/app/workspace/[workspaceUrl]/components/SpecArtifactGroup'

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <IntlProvider locale="en" messages={en as Record<string, string>}>
      {ui}
    </IntlProvider>
  )
}

const artifacts = [
  { id: 'a1', kind: 'spec', title: 'Spec', content: 'body one', source: 'superpowers', order: 0 },
  { id: 'a2', kind: 'plan', title: 'Plan', content: 'body two', source: 'superpowers', order: 1 },
]

describe('SpecArtifactGroup', () => {
  it('renders nothing when there are no artifacts', () => {
    const { container } = renderWithIntl(
      <SpecArtifactGroup taskId="t1" artifacts={[]} onChanged={() => {}} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one row per artifact with its kind + title', () => {
    renderWithIntl(
      <SpecArtifactGroup taskId="t1" artifacts={artifacts} onChanged={() => {}} />
    )
    expect(screen.getByText('Spec')).toBeInTheDocument()
    expect(screen.getByText('Plan')).toBeInTheDocument()
    expect(screen.getByText('spec')).toBeInTheDocument()
  })

  it('expands a row on click to reveal content', () => {
    renderWithIntl(
      <SpecArtifactGroup taskId="t1" artifacts={artifacts} onChanged={() => {}} />
    )
    expect(screen.queryByText('body one')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Spec'))
    expect(screen.getByText('body one')).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx jest SpecArtifactGroup -c jest.config.js`
Expected: FAIL — component module not found.

- [ ] **Step 6: Write the component**

`app/workspace/[workspaceUrl]/components/SpecArtifactGroup.tsx`:
```tsx
'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronRight, ChevronDown, Plus } from 'lucide-react'
import type { TaskArtifact } from '@prisma/client'
import { artifactsClient } from '@/lib/api-client/task-artifacts'

interface Props {
  taskId: string
  artifacts: Pick<TaskArtifact, 'id' | 'kind' | 'title' | 'content' | 'source' | 'order'>[]
  onChanged: () => void | Promise<void>
}

export function SpecArtifactGroup({ taskId, artifacts, onChanged }: Props) {
  const intl = useIntl()
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)

  const sourceLabel = useMemo(() => {
    const sources = Array.from(new Set(artifacts.map(a => a.source)))
    return sources.length === 1 ? sources[0]! : sources.join(', ')
  }, [artifacts])

  if (artifacts.length === 0) return null

  const toggle = (id: string) =>
    setOpenIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">
            {intl.formatMessage({ id: 'taskArtifact.groupLabel' })}
          </span>
          <span className="text-xs text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
            {intl.formatMessage(
              { id: 'taskArtifact.sourceCount' },
              { source: sourceLabel, count: artifacts.length }
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-xs text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 rounded px-2.5 py-1 inline-flex items-center gap-1 hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          <Plus className="size-3" />
          {intl.formatMessage({ id: 'taskArtifact.add' })}
        </button>
      </div>

      <div className="space-y-2">
        {artifacts.map(a => {
          const open = openIds.has(a.id)
          return (
            <div
              key={a.id}
              className="bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 rounded-lg"
            >
              <button
                type="button"
                onClick={() => toggle(a.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
              >
                {open ? (
                  <ChevronDown className="size-3.5 text-zinc-400 shrink-0" />
                ) : (
                  <ChevronRight className="size-3.5 text-zinc-400 shrink-0" />
                )}
                <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded shrink-0">
                  {a.kind}
                </span>
                <span className="text-sm text-zinc-900 dark:text-zinc-100">{a.title}</span>
              </button>
              {open && (
                <div className="px-4 pb-3.5 pl-10">
                  <pre className="whitespace-pre-wrap break-words text-sm text-zinc-700 dark:text-zinc-300 font-sans">
                    {a.content}
                  </pre>
                  <div className="mt-3 pt-2.5 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-400">
                    {a.source}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {adding && (
        <ManualAddForm
          taskId={taskId}
          onCancel={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false)
            await onChanged()
          }}
        />
      )}
    </div>
  )
}

function ManualAddForm({
  taskId,
  onCancel,
  onSaved,
}: {
  taskId: string
  onCancel: () => void
  onSaved: () => void | Promise<void>
}) {
  const intl = useIntl()
  const [kind, setKind] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  const canSave = kind.trim() && title.trim() && content.trim() && !saving

  return (
    <div className="mt-2 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 space-y-2">
      <input
        value={kind}
        onChange={e => setKind(e.target.value)}
        placeholder={intl.formatMessage({ id: 'taskArtifact.addKind' })}
        className="w-full text-sm bg-transparent border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 outline-none"
      />
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder={intl.formatMessage({ id: 'taskArtifact.addTitle' })}
        className="w-full text-sm bg-transparent border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 outline-none"
      />
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder={intl.formatMessage({ id: 'taskArtifact.addContent' })}
        rows={5}
        className="w-full text-sm bg-transparent border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 outline-none font-mono"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-zinc-500 px-2.5 py-1"
        >
          {intl.formatMessage({ id: 'taskArtifact.cancel' })}
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={async () => {
            setSaving(true)
            try {
              await artifactsClient.add(taskId, {
                kind: kind.trim(),
                title: title.trim(),
                content,
                source: 'manual',
              })
              await onSaved()
            } finally {
              setSaving(false)
            }
          }}
          className="text-xs text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded px-2.5 py-1 disabled:opacity-40"
        >
          {intl.formatMessage({ id: 'taskArtifact.save' })}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx jest SpecArtifactGroup -c jest.config.js`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/SpecArtifactGroup.tsx lib/i18n __tests__/components/SpecArtifactGroup.test.tsx
git commit -m "feat: add SpecArtifactGroup definition-layer UI [LUM-109]"
```

---

## Task 12: Wire the group into TaskDetailPage + conditional description collapse + docs note

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection.tsx`

- [ ] **Step 1: Consume the `useArtifacts` hook in the page**

In `TaskDetailPage.tsx`, add imports:
```ts
import { SpecArtifactGroup } from '../SpecArtifactGroup'
import { useArtifacts } from '../../hooks/useArtifacts'
```
Call the hook alongside the other extracted hooks (after the `useTaskDescription` call, ~line 124):
```ts
const { artifacts, refresh: refreshArtifacts } = useArtifacts(initialTask.id)
```
This replaces any manual fetch — TanStack Query handles fetching, caching, and refetch-on-invalidate, matching `useWebLinks`/`useFigmaLinks`.

- [ ] **Step 2: Render the group above the description and demote the description**

Replace the description block (lines 277-286) with:
```tsx
            {/* Definition layer: spec artifacts */}
            <SpecArtifactGroup
              taskId={task.id}
              artifacts={artifacts}
              onChanged={refreshArtifacts}
            />

            {/* Description — demoted to "background discussion" when artifacts exist */}
            {desc.descriptionLoading ? (
              <Spinner className='size-4 text-zinc-300 dark:text-zinc-600' />
            ) : artifacts.length > 0 ? (
              <BackgroundDiscussion>
                <DescriptionEditor
                  value={desc.descriptionValue}
                  onCommit={actions.commitDescription}
                  members={mentionableMembers}
                />
              </BackgroundDiscussion>
            ) : (
              <DescriptionEditor
                value={desc.descriptionValue}
                onCommit={actions.commitDescription}
                members={mentionableMembers}
              />
            )}
```

- [ ] **Step 3: Add the `BackgroundDiscussion` collapsible**

Add this small component at the bottom of `TaskDetailPage.tsx` (below the `TaskDetailPage` function), and import `useIntl` is already in scope via the page — but this is a separate component so add its own `useState`/`useIntl`:
```tsx
function BackgroundDiscussion({ children }: { children: React.ReactNode }) {
  const intl = useIntl()
  const [open, setOpen] = useState(false) // collapsed by default when artifacts exist
  return (
    <div className='mb-2'>
      <button
        type='button'
        onClick={() => setOpen(o => !o)}
        className='flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 py-2'
      >
        <span>{open ? '⌄' : '›'}</span>
        {intl.formatMessage({ id: 'taskArtifact.backgroundDiscussion' })}
        <span className='text-zinc-400 dark:text-zinc-500'>
          {intl.formatMessage({ id: 'taskArtifact.originalDescription' })}
        </span>
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}
```
Ensure `useState` and `useIntl` are imported at the top of the file (they are: `useState` add to line 3 import if missing; `useIntl` is imported at line 4).

- [ ] **Step 4: Add the "reference only" note to DocumentsSection**

In `DocumentsSection.tsx`, render a small note near the section header so the docs row reads as reference-only. Add (inside the component's returned JSX, adjacent to the section title — match the existing `ContextSection` structure):
```tsx
<span className="text-[11px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
  {intl.formatMessage({ id: 'taskArtifact.docsRefOnly' })}
</span>
```
(Place it per the `ContextSection` API — inspect how `WebLinkSection`/`FigmaSection` pass a header/title node and add the pill there. `intl` is already in scope at DocumentsSection line ~31.)

- [ ] **Step 5: Typecheck + lint for console.log**

Run: `npx tsc --noEmit` → Expected: PASS.
Run: `grep -rn "console.log" app/workspace/\[workspaceUrl\]/components/SpecArtifactGroup.tsx app/workspace/\[workspaceUrl\]/components/pages/TaskDetailPage.tsx` → Expected: no matches.

- [ ] **Step 6: Verify in the browser (preview workflow)**

Start the dev server and open `LUM-109`. Confirm: with 0 artifacts → no 规格 group, description expanded as before. After `lumo task artifact add LUM-109 …` (twice) → 规格 group shows "… · 2 个产物" above the title's description, description collapsed under "背景讨论", expand a row shows content + source meta, docs row in 上下文 shows the reference-only note.

- [ ] **Step 7: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection.tsx
git commit -m "feat: render spec artifacts in task detail definition layer [LUM-109]"
```

---

## Task 13: Full verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all green, including the new artifact tests.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: End-to-end acceptance (against dev)**

```bash
lumo task artifact add LUM-109 --kind spec --title "Spec" --file docs/superpowers/specs/2026-05-29-spec-artifact-design.md --source superpowers
lumo task artifact add LUM-109 --kind plan --title "Implementation plan" --file docs/superpowers/plans/2026-05-29-spec-artifact.md --source superpowers
lumo task artifact list LUM-109        # → two rows, in order
lumo task context LUM-109              # → output contains "## [spec] Spec" and "## [plan] Implementation plan"
```
Then in the web UI confirm the definition-layer group renders and the description is collapsed under "背景讨论".

- [ ] **Step 4: Confirm non-regression**

- `lumo task context` on a task with **no** artifacts → no artifact section, description still shown.
- A task with no artifacts in the web UI → description expanded (not collapsed), no 规格 group.
- `Task.spec` / agent-server flow untouched (no files in `lib/agent/` or the `SPEC_GENERATED` path were modified).

---

## Self-Review (completed during planning)

**Spec coverage:** §1 data model → Task 1; §2 CLI → Tasks 7–9; §3 context injection → Tasks 4–5; §4 UI (group placement, source/count pill, collapse, ＋添加, no status chrome) → Tasks 11–12; decision #1 (conditional description collapse) → Task 12 Step 2; decision #2 (docs reference-only note) → Task 12 Step 4; SKILL.md sync → Task 10; acceptance criteria → Task 13. All covered.

**Type consistency:** `taskArtifactRepository` (create/listByTask/countByTask), `taskArtifactService` (addArtifact/listForTask), `AddArtifactInput.actorMemberId`, `renderArtifactSection`, `createArtifactBodySchema`, `artifactsClient` (list/add), and `SpecArtifactGroup` props are referenced with identical names across tasks.

**Known imperfection (accepted):** an artifact's own `## ...` headings render at the same level as the `## [kind] title` wrapper in `lumo task context`. This matches the spec's "## <title>" choice; artifacts are whole documents, so a single flat heading level is acceptable for an agent-facing handoff.
