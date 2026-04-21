# Expandable Projects Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `Projects` sidebar row into an expandable tree-like list with drag-to-reorder, current-project highlight, and a `+ New project` shortcut, mirroring the doc-tree feel.

**Architecture:**

- New `Project.order` integer drives a stable workspace-wide sort; migration backfills alphabetically, new projects go to the end, drag rewrites the values, all members stay in sync via a new `workspace-{slug}` Pusher channel (slug matches the `workspaceUrl` route param, so clients can subscribe with no extra round-trip).
- A new `ProjectsSidebarGroup` component owns expand/collapse, render, drag, and highlight. Its data comes from a dedicated `useSidebarProjects` hook so the sidebar works in both the state-routed `WorkspaceApp` pages and the standalone task/project pages.
- The `+ New project` affordance calls an `onNewProject?: () => void` prop on `AppSidebar`. `WorkspaceApp` wires it to the existing `NewProjectModal`; standalone pages omit the prop and the component falls back to `router.push('/workspace/:url/projects?new=1')`, which `WorkspaceApp` reads on mount.

**Tech Stack:** Next.js 14 App Router, Prisma + Neon Postgres, Pusher, `@dnd-kit/sortable` (already present for the kanban board), shadcn `Sidebar*` primitives, Jest.

---

## File Structure

| Path                                                                       | Change | Responsibility                                                                       |
| -------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| `prisma/schema.prisma`                                                     | Modify | Add `order` field + composite index on `Project`.                                    |
| `prisma/migrations/20260421120000_add_project_order/migration.sql`         | Create | Add column, backfill by name, create index.                                          |
| `lib/repositories/project.repository.ts`                                   | Modify | Sort by `(order, name)`; `create` accepts `order`; `reorder`; `maxOrderInWorkspace`. |
| `lib/services/project.service.ts`                                          | Modify | Compute `order` on create; add `reorderProjects` with workspace scope + pusher.      |
| `lib/validation/schemas.ts`                                                | Modify | Add `reorderProjectsSchema`.                                                         |
| `lib/integrations/pusher/types.ts`                                         | Modify | Add `WorkspaceEvent` union.                                                          |
| `lib/integrations/pusher/server.ts`                                        | Modify | Add `pushWorkspaceEvent` helper.                                                     |
| `app/api/projects/reorder/route.ts`                                        | Create | Thin handler: auth → Zod → service → response.                                       |
| `lib/api-client/projects.ts`                                               | Modify | Add `projectsClient.reorder`.                                                        |
| `app/workspace/[workspaceUrl]/constants.ts`                                | Modify | Add `API.projects.reorder` path.                                                     |
| `app/workspace/[workspaceUrl]/hooks/useSidebarProjects.ts`                 | Create | Cache-read + background refresh + pusher subscription.                               |
| `app/workspace/[workspaceUrl]/components/sidebar/ProjectsSidebarGroup.tsx` | Create | Expandable list with current-project highlight, drag, new-project row.               |
| `app/workspace/[workspaceUrl]/components/Sidebar.tsx`                      | Modify | Render `ProjectsSidebarGroup`; add `onNewProject` prop.                              |
| `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`                            | Modify | Pass `onNewProject`; read `?new=1` and open modal on the projects page.              |
| `messages/en.json`, `messages/zh-CN.json` (and any other locales)          | Modify | `sidebar.newProject`, `sidebar.noProjects`.                                          |
| `__tests__/lib/repositories/project.repository.test.ts`                    | Modify | Cover sort order and `reorder`.                                                      |
| `__tests__/lib/services/project.service.test.ts`                           | Modify | Cover create order, `reorderProjects` permission + pusher.                           |
| `__tests__/api/projects/reorder-route.test.ts`                             | Create | 400 / 403 / 200 happy path.                                                          |

---

## Task 1: Add `order` column and backfill migration

**Files:**

- Modify: `prisma/schema.prisma` (Project model, around lines 310-345)
- Create: `prisma/migrations/20260421120000_add_project_order/migration.sql`

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Find the `Project` model. Add the `order` field immediately after `isIdea`:

```prisma
model Project {
  id                String   @id @default(cuid())
  workspaceId       String
  teamId            String
  createdByMemberId String
  ownerId           String?
  name              String
  description       String?
  isIdea            Boolean  @default(false)
  order             Int      @default(0)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  // ...existing risk fields and relations unchanged...

  @@index([workspaceId])
  @@index([teamId])
  @@index([createdByMemberId])
  @@index([workspaceId, order])
  @@map("projects")
}
```

- [ ] **Step 2: Create the migration SQL file**

Create the directory and file:

```bash
mkdir -p prisma/migrations/20260421120000_add_project_order
```

File contents — `prisma/migrations/20260421120000_add_project_order/migration.sql`:

```sql
-- Add order column to projects with safe default.
ALTER TABLE "projects" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;

-- Backfill order per workspace by name ascending so existing lists render in
-- the previous alphabetical order the moment the app starts sorting by it.
UPDATE "projects" p
SET "order" = t.rn
FROM (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "workspaceId" ORDER BY name ASC) AS rn
  FROM "projects"
) t
WHERE p.id = t.id;

-- Index to speed up per-workspace ordered listing.
CREATE INDEX "projects_workspaceId_order_idx" ON "projects" ("workspaceId", "order");
```

- [ ] **Step 3: Apply migration locally and regenerate Prisma client**

```bash
npx prisma migrate deploy
npx prisma generate
```

Expected: `All migrations have been successfully applied.` and Prisma client regenerated.

If dev DB is empty or out of sync, use `npx prisma migrate dev --name add_project_order --create-only` to scaffold then replace its `migration.sql` with the content from Step 2.

- [ ] **Step 4: Run type check**

```bash
npx tsc --noEmit
```

Expected: no errors. `Project` now has an `order` property usable across the codebase.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260421120000_add_project_order
git commit -m "feat(db): add Project.order field for sidebar reordering [LUM-33]"
```

---

## Task 2: Repository — sort by (order, name), add `reorder` and `maxOrderInWorkspace`

**Files:**

- Modify: `lib/repositories/project.repository.ts`
- Modify: `__tests__/lib/repositories/project.repository.test.ts`

- [ ] **Step 1: Write failing test for the new sort order**

Open `__tests__/lib/repositories/project.repository.test.ts`. Replace the existing `orderBy: { updatedAt: 'desc' }` expectation and add new tests. The `findByWorkspace` assertion becomes:

```ts
expect(mockFindMany).toHaveBeenCalledWith(
  expect.objectContaining({
    where: {
      workspaceId: 'ws-1',
      OR: [{ isIdea: false }, { isIdea: true, createdByMemberId: 'member-1' }],
    },
    include: expect.objectContaining({
      _count: { select: { tasks: true } },
      owner: {
        select: {
          id: true,
          clerkId: true,
          actor: { select: { id: true } },
        },
      },
    }),
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  })
)
```

Append two new `describe` blocks at the end of the file:

```ts
// ── reorder ────────────────────────────────────────────────────────────────

describe('reorder', () => {
  it('updates order sequentially in a transaction', async () => {
    const mockUpdate = jest.fn()
    const txProject = { update: mockUpdate }
    const mockTx = jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ project: txProject })
    )
    ;(prisma as unknown as { $transaction: jest.Mock }).$transaction = mockTx

    await projectRepository.reorder('ws-1', ['p2', 'p1', 'p3'])

    expect(mockUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 'p2' },
      data: { order: 1 },
    })
    expect(mockUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 'p1' },
      data: { order: 2 },
    })
    expect(mockUpdate).toHaveBeenNthCalledWith(3, {
      where: { id: 'p3' },
      data: { order: 3 },
    })
  })
})

// ── maxOrderInWorkspace ────────────────────────────────────────────────────

describe('maxOrderInWorkspace', () => {
  it('returns the current max order for the workspace or 0 when empty', async () => {
    const aggregate = jest.fn().mockResolvedValue({ _max: { order: 7 } })
    ;(prisma as unknown as { project: { aggregate: jest.Mock } }).project = {
      ...(prisma.project as unknown as object),
      aggregate,
    } as never

    const result = await projectRepository.maxOrderInWorkspace('ws-1')

    expect(result).toBe(7)
    expect(aggregate).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1' },
      _max: { order: true },
    })
  })

  it('returns 0 when the workspace has no projects', async () => {
    const aggregate = jest.fn().mockResolvedValue({ _max: { order: null } })
    ;(prisma as unknown as { project: { aggregate: jest.Mock } }).project = {
      ...(prisma.project as unknown as object),
      aggregate,
    } as never

    const result = await projectRepository.maxOrderInWorkspace('ws-1')

    expect(result).toBe(0)
  })
})
```

Also update the top-level `jest.mock('@/lib/db/prisma', ...)` at the top of the file to include `aggregate`:

```ts
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
    },
    task: {
      groupBy: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npx jest __tests__/lib/repositories/project.repository.test.ts -t 'findByWorkspace|reorder|maxOrderInWorkspace'
```

Expected: failing assertions for the new `orderBy` value and missing methods (`projectRepository.reorder` / `maxOrderInWorkspace` are `undefined`).

- [ ] **Step 3: Update the repository**

In `lib/repositories/project.repository.ts`:

(a) Change `findByWorkspace` orderBy:

```ts
orderBy: [{ order: 'asc' as const }, { name: 'asc' as const }],
```

(b) Extend the `create` method signature to accept `order`:

```ts
async create(data: {
  workspaceId: string
  teamId: string
  name: string
  description?: string | undefined
  isIdea?: boolean | undefined
  createdByMemberId: string
  order: number
}) {
  return prisma.$transaction(async tx => {
    const project = await tx.project.create({
      data: {
        workspaceId: data.workspaceId,
        teamId: data.teamId,
        createdByMemberId: data.createdByMemberId,
        name: data.name,
        description: data.description ?? null,
        isIdea: data.isIdea ?? false,
        order: data.order,
      },
    })

    await tx.view.create({
      data: {
        workspaceId: data.workspaceId,
        projectId: project.id,
        name: 'Document',
        type: 'DOCUMENT',
        isDefault: true,
      },
    })

    return project
  })
},
```

(c) Append two new methods at the end of the object (before the final closing `}`):

```ts
  /**
   * Replace the `order` field on a sequence of projects to match the given array
   * (1-based). Runs in a transaction. Caller is expected to validate ownership.
   */
  async reorder(_workspaceId: string, orderedIds: string[]) {
    return prisma.$transaction(async tx => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.project.update({
          where: { id: orderedIds[i]! },
          data: { order: i + 1 },
        })
      }
    })
  },

  /**
   * Max `order` currently in use for a workspace. Returns 0 when there are no
   * projects (safe to pass `max + 1` as the next order).
   */
  async maxOrderInWorkspace(workspaceId: string): Promise<number> {
    const row = await prisma.project.aggregate({
      where: { workspaceId },
      _max: { order: true },
    })
    return row._max.order ?? 0
  },
```

(d) `_workspaceId` is prefixed with `_` because the transaction doesn't use it yet — it exists in the signature so the service can pass context for logging / future scoping.

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx jest __tests__/lib/repositories/project.repository.test.ts
```

Expected: all tests pass (including the original `findByWorkspace` and `findById`, `countTasksByStatus` tests; only the orderBy assertion was updated).

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/project.repository.ts __tests__/lib/repositories/project.repository.test.ts
git commit -m "feat(projects): repo-layer sort by order + reorder/maxOrder methods [LUM-33]"
```

---

## Task 3: Service — compute order on create, add `reorderProjects`

**Files:**

- Modify: `lib/services/project.service.ts`
- Modify: `__tests__/lib/services/project.service.test.ts`

- [ ] **Step 1: Write failing tests**

In `__tests__/lib/services/project.service.test.ts`, update the top-level `jest.mock` for the project repository to include the new methods:

```ts
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findByWorkspace: jest.fn(),
    countTasksByStatus: jest.fn(),
    findById: jest.fn(),
    findByIdSimple: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    reorder: jest.fn(),
    maxOrderInWorkspace: jest.fn(),
  },
}))
```

Add new mocks for `memberRepository.findWorkspaceMember` and the pusher helper. Above `import { projectService } from ...`:

```ts
jest.mock('@/lib/integrations/pusher/server', () => ({
  pushWorkspaceEvent: jest.fn().mockResolvedValue(undefined),
}))
```

Then at the bottom of the file (after the existing describe blocks), add:

```ts
// ── createProject ──────────────────────────────────────────────────────────

describe('createProject', () => {
  it('passes order = maxOrder + 1 to the repository', async () => {
    mockGetDefaultTeam.mockResolvedValue({ id: 'team-1' })
    ;(projectRepository.maxOrderInWorkspace as jest.Mock).mockResolvedValue(4)
    mockCreate.mockResolvedValue({ id: 'p-new' })

    await projectService.createProject('ws-1', 'member-1', {
      name: 'New project',
    })

    expect(projectRepository.maxOrderInWorkspace).toHaveBeenCalledWith('ws-1')
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        teamId: 'team-1',
        createdByMemberId: 'member-1',
        name: 'New project',
        order: 5,
      })
    )
  })

  it('defaults to order = 1 when the workspace has no projects', async () => {
    mockGetDefaultTeam.mockResolvedValue({ id: 'team-1' })
    ;(projectRepository.maxOrderInWorkspace as jest.Mock).mockResolvedValue(0)
    mockCreate.mockResolvedValue({ id: 'p-new' })

    await projectService.createProject('ws-1', 'member-1', { name: 'First' })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ order: 1 })
    )
  })
})

// ── reorderProjects ────────────────────────────────────────────────────────

describe('reorderProjects', () => {
  const { pushWorkspaceEvent } = jest.requireMock(
    '@/lib/integrations/pusher/server'
  ) as { pushWorkspaceEvent: jest.Mock }

  beforeEach(() => {
    pushWorkspaceEvent.mockClear()
  })

  it('rejects when any id belongs to a different workspace', async () => {
    mockFindByWorkspace.mockResolvedValue([
      { id: 'p1', workspaceId: 'ws-1' },
      { id: 'p2', workspaceId: 'ws-1' },
    ])

    await expect(
      projectService.reorderProjects('ws-1', 'acme', 'member-1', [
        'p1',
        'p-other',
      ])
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects when orderedIds is empty', async () => {
    await expect(
      projectService.reorderProjects('ws-1', 'acme', 'member-1', [])
    ).rejects.toMatchObject({ status: 400 })
  })

  it('writes the new order and publishes the pusher event on success', async () => {
    mockFindByWorkspace.mockResolvedValue([
      { id: 'p1', workspaceId: 'ws-1' },
      { id: 'p2', workspaceId: 'ws-1' },
      { id: 'p3', workspaceId: 'ws-1' },
    ])
    ;(projectRepository.reorder as jest.Mock).mockResolvedValue(undefined)

    await projectService.reorderProjects('ws-1', 'acme', 'member-1', [
      'p2',
      'p1',
      'p3',
    ])

    expect(projectRepository.reorder).toHaveBeenCalledWith('ws-1', [
      'p2',
      'p1',
      'p3',
    ])
    expect(pushWorkspaceEvent).toHaveBeenCalledWith('acme', {
      type: 'projects-reordered',
      orderedIds: ['p2', 'p1', 'p3'],
    })
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npx jest __tests__/lib/services/project.service.test.ts -t 'createProject|reorderProjects'
```

Expected: failures — `reorderProjects` does not exist; `createProject` does not call `maxOrderInWorkspace`.

- [ ] **Step 3: Update the service**

In `lib/services/project.service.ts`:

(a) Add the pusher import at the top:

```ts
import { pushWorkspaceEvent } from '@/lib/integrations/pusher/server'
```

(b) Update `createProject`:

```ts
async createProject(
  workspaceId: string,
  memberId: string,
  data: {
    name: string
    description?: string | undefined
    isIdea?: boolean | undefined
  }
) {
  const defaultTeam = await getDefaultTeam(workspaceId)
  const maxOrder = await projectRepository.maxOrderInWorkspace(workspaceId)

  return projectRepository.create({
    workspaceId,
    teamId: defaultTeam!.id,
    createdByMemberId: memberId,
    name: data.name,
    description: data.description,
    isIdea: data.isIdea,
    order: maxOrder + 1,
  })
},
```

(c) Add `reorderProjects` at the end of `projectService`, before the closing `}`:

```ts
  /**
   * Reorder a workspace's projects. Caller must pass ids that all belong to
   * `workspaceId`; any mismatch throws 400. Publishes a pusher event so other
   * members' sidebars can re-sort in real time.
   */
  async reorderProjects(
    workspaceId: string,
    workspaceSlug: string,
    memberId: string,
    orderedIds: string[]
  ) {
    if (orderedIds.length === 0) {
      throw Object.assign(new Error('orderedIds must not be empty'), {
        status: 400,
      })
    }

    const workspaceProjects = await projectRepository.findByWorkspace(
      workspaceId,
      memberId
    )
    const workspaceProjectIds = new Set(workspaceProjects.map(p => p.id))
    const unknownId = orderedIds.find(id => !workspaceProjectIds.has(id))
    if (unknownId) {
      throw Object.assign(
        new Error('One or more projects do not belong to this workspace'),
        { status: 400 }
      )
    }

    await projectRepository.reorder(workspaceId, orderedIds)

    await pushWorkspaceEvent(workspaceSlug, {
      type: 'projects-reordered',
      orderedIds,
    })
  },
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx jest __tests__/lib/services/project.service.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/services/project.service.ts __tests__/lib/services/project.service.test.ts
git commit -m "feat(projects): service-layer createProject order + reorderProjects [LUM-33]"
```

---

## Task 4: Zod schema for reorder

**Files:**

- Modify: `lib/validation/schemas.ts`

- [ ] **Step 1: Add the schema near the other project schemas**

In `lib/validation/schemas.ts`, directly after `updateProjectSchema`:

```ts
export const reorderProjectsSchema = z.object({
  orderedIds: z
    .array(z.string().cuid())
    .min(1, 'orderedIds must contain at least one id')
    .max(500, 'orderedIds is limited to 500 entries'),
})
```

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/validation/schemas.ts
git commit -m "feat(projects): zod reorderProjectsSchema [LUM-33]"
```

---

## Task 5: Pusher — WorkspaceEvent type + server helper

**Files:**

- Modify: `lib/integrations/pusher/types.ts`
- Modify: `lib/integrations/pusher/server.ts`

- [ ] **Step 1: Extend types**

Append to `lib/integrations/pusher/types.ts`:

```ts
// ── Workspace events (cross-member sidebar, etc.) ──────────────────────────

export type WorkspaceEvent = {
  type: 'projects-reordered'
  orderedIds: string[]
}
```

- [ ] **Step 2: Add `pushWorkspaceEvent` to server.ts**

In `lib/integrations/pusher/server.ts`, import the new type and append the helper:

```ts
import Pusher from 'pusher'
import type {
  AgentEvent,
  TaskEvent,
  ProjectEvent,
  UserEvent,
  WorkspaceEvent,
} from './types'

// ... existing helpers unchanged ...

export async function pushWorkspaceEvent(
  workspaceSlug: string,
  event: WorkspaceEvent
): Promise<void> {
  try {
    await getPusher().trigger(
      `workspace-${workspaceSlug}`,
      'workspace-update',
      event
    )
  } catch (err) {
    console.error('[pusher] Failed to push workspace event:', err)
  }
}
```

- [ ] **Step 3: Run type check and service tests**

```bash
npx tsc --noEmit
npx jest __tests__/lib/services/project.service.test.ts -t reorderProjects
```

Expected: no errors; `reorderProjects` tests still green.

- [ ] **Step 4: Commit**

```bash
git add lib/integrations/pusher/types.ts lib/integrations/pusher/server.ts
git commit -m "feat(pusher): add WorkspaceEvent + pushWorkspaceEvent [LUM-33]"
```

---

## Task 6: API route `PATCH /api/projects/reorder`

**Files:**

- Create: `app/api/projects/reorder/route.ts`
- Create: `__tests__/api/projects/reorder-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/projects/reorder-route.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
}))

jest.mock('@/lib/api/helpers', () => ({
  requireUserWorkspace: jest.fn(),
  zodError: (parsed: { error: { issues: { message: string }[] } }) => {
    const { NextResponse } = require('next/server')
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  },
}))

jest.mock('@/lib/services', () => ({
  projectService: {
    reorderProjects: jest.fn(),
  },
}))

import { PATCH } from '@/app/api/projects/reorder/route'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { projectService } from '@/lib/services'

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/projects/reorder', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => jest.clearAllMocks())

describe('PATCH /api/projects/reorder', () => {
  it('returns 401 when unauthenticated', async () => {
    const { NextResponse } = require('next/server')
    ;(requireAuth as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    )

    const res = await PATCH(req({ orderedIds: ['abc'] }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when body is malformed', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'u1' })
    ;(requireUserWorkspace as jest.Mock).mockResolvedValue({
      workspaceId: 'ws-1',
      workspace: { slug: 'acme' },
      member: { id: 'm1' },
    })

    const res = await PATCH(req({ orderedIds: [] }))
    expect(res.status).toBe(400)
    expect(projectService.reorderProjects).not.toHaveBeenCalled()
  })

  it('returns 200 and calls the service on success', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'u1' })
    ;(requireUserWorkspace as jest.Mock).mockResolvedValue({
      workspaceId: 'ws-1',
      workspace: { slug: 'acme' },
      member: { id: 'm1' },
    })
    ;(projectService.reorderProjects as jest.Mock).mockResolvedValue(undefined)

    const res = await PATCH(
      req({
        orderedIds: ['cjlds5g4h00014z0ab1c2d3e4', 'cjlds5g4h00024z0ab1c2d3e5'],
      })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(projectService.reorderProjects).toHaveBeenCalledWith(
      'ws-1',
      'acme',
      'm1',
      ['cjlds5g4h00014z0ab1c2d3e4', 'cjlds5g4h00024z0ab1c2d3e5']
    )
  })

  it('forwards service status codes (e.g. 400 for mixed workspace)', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'u1' })
    ;(requireUserWorkspace as jest.Mock).mockResolvedValue({
      workspaceId: 'ws-1',
      workspace: { slug: 'acme' },
      member: { id: 'm1' },
    })
    ;(projectService.reorderProjects as jest.Mock).mockRejectedValue(
      Object.assign(new Error('mixed'), { status: 400 })
    )

    const res = await PATCH(req({ orderedIds: ['cjlds5g4h00014z0ab1c2d3e4'] }))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the test — expect it to fail because the route does not exist**

```bash
npx jest __tests__/api/projects/reorder-route.test.ts
```

Expected: `Cannot find module '@/app/api/projects/reorder/route'`.

- [ ] **Step 3: Implement the route**

Create `app/api/projects/reorder/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { reorderProjectsSchema } from '@/lib/validation/schemas'
import { projectService } from '@/lib/services'

/**
 * PATCH /api/projects/reorder
 * Body: { orderedIds: string[] }
 * Rewrites the Project.order field for every id listed, in the supplied
 * order. All ids must belong to the caller's workspace.
 */
export async function PATCH(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    const body = await request.json()
    const parsed = reorderProjectsSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    await projectService.reorderProjects(
      ws.workspaceId,
      ws.workspace.slug,
      ws.member.id,
      parsed.data.orderedIds
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    const status =
      typeof err === 'object' && err !== null && 'status' in err
        ? (err as { status: number }).status
        : 500
    const message = err instanceof Error ? err.message : 'Internal Server Error'
    return NextResponse.json({ error: message }, { status })
  }
}
```

- [ ] **Step 4: Run the test**

```bash
npx jest __tests__/api/projects/reorder-route.test.ts
```

Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/projects/reorder/route.ts __tests__/api/projects/reorder-route.test.ts
git commit -m "feat(projects): PATCH /api/projects/reorder route [LUM-33]"
```

---

## Task 7: API client and path constant

**Files:**

- Modify: `app/workspace/[workspaceUrl]/constants.ts`
- Modify: `lib/api-client/projects.ts`

- [ ] **Step 1: Add the path constant**

In `app/workspace/[workspaceUrl]/constants.ts`, find the `projects:` section and append:

```ts
  projects: {
    list: '/api/projects',
    byId: (id: string) => `/api/projects/${id}`,
    tasks: (projectId: string) => `/api/projects/${projectId}/tasks`,
    reorder: '/api/projects/reorder',
  },
```

- [ ] **Step 2: Add the client method**

In `lib/api-client/projects.ts`, append a new method inside `projectsClient`:

```ts
  reorder<T>(orderedIds: string[]) {
    return apiFetch<T>(API.projects.reorder, {
      method: 'PATCH',
      body: { orderedIds },
    })
  },
```

- [ ] **Step 3: Run type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/constants.ts lib/api-client/projects.ts
git commit -m "feat(projects): api-client reorder method [LUM-33]"
```

---

## Task 8: `useSidebarProjects` hook

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/useSidebarProjects.ts`

- [ ] **Step 1: Write the hook**

Create `app/workspace/[workspaceUrl]/hooks/useSidebarProjects.ts`:

```ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiProject } from '../types'
import { readCache, writeCache } from '../cache'
import { CACHE_KEY } from '../constants'
import { projectsClient } from '@/lib/api-client'
import { usePusherEvent } from './usePusher'

/**
 * Read-and-refresh hook shared by `ProjectsSidebarGroup`. It works in every
 * shell that renders `<AppSidebar>` — `WorkspaceApp`, `TaskDetailPage`,
 * `ProjectDetailStandalonePage` — without hoisting `useProjects` into each.
 *
 * - Seeds from the same `lumo:projects` localStorage cache that `useProjects`
 *   writes to, so the list is visible on first render when available.
 * - Fetches in the background on mount to pick up fresh data.
 * - Subscribes to Pusher `workspace-{id}` `workspace-update` events and
 *   re-sorts locally when another member reorders.
 */
export function useSidebarProjects(workspaceSlug: string | null) {
  const [projects, setProjects] = useState<ApiProject[]>(
    () => readCache<ApiProject[]>(CACHE_KEY.projects) ?? []
  )
  const didInit = useRef(false)

  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    projectsClient
      .list<{ projects: ApiProject[] }>()
      .then(data => {
        setProjects(data.projects)
        writeCache(CACHE_KEY.projects, data.projects)
      })
      .catch(() => {
        // keep the cached list; error is non-fatal for the sidebar.
      })
  }, [])

  // Apply a remote reorder: reshuffle the known projects to match the event.
  const applyRemoteOrder = useCallback(
    (event: { type: string; orderedIds?: string[] }) => {
      if (event.type !== 'projects-reordered' || !event.orderedIds) return
      setProjects(prev => {
        const byId = new Map(prev.map(p => [p.id, p]))
        const sorted: ApiProject[] = []
        const seen = new Set<string>()
        for (const id of event.orderedIds!) {
          const p = byId.get(id)
          if (p) {
            sorted.push(p)
            seen.add(id)
          }
        }
        // Append any project the server did not reorder (e.g., local-only
        // optimistic entry) at the end so nothing disappears.
        for (const p of prev) {
          if (!seen.has(p.id)) sorted.push(p)
        }
        writeCache(CACHE_KEY.projects, sorted)
        return sorted
      })
    },
    []
  )

  usePusherEvent<{ type: string; orderedIds?: string[] }>(
    workspaceSlug ? `workspace-${workspaceSlug}` : null,
    'workspace-update',
    applyRemoteOrder
  )

  return { projects, setProjects }
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors. The hook uses only existing exports.

- [ ] **Step 3: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/hooks/useSidebarProjects.ts
git commit -m "feat(sidebar): useSidebarProjects hook [LUM-33]"
```

---

## Task 9: `ProjectsSidebarGroup` component (static list, no drag yet)

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/sidebar/ProjectsSidebarGroup.tsx`

- [ ] **Step 1: Scaffold directory**

```bash
mkdir -p app/workspace/\[workspaceUrl\]/components/sidebar
```

- [ ] **Step 2: Implement the component**

Create `app/workspace/[workspaceUrl]/components/sidebar/ProjectsSidebarGroup.tsx`:

```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useIntl } from 'react-intl'
import { ChevronRight, FolderKanban, Folder, Plus } from 'lucide-react'
import {
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from '@/components/ui/sidebar'
import { Page, ApiProject } from '../../types'
import { slugify } from '@/lib/utils/slugify'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'lumo:sidebarProjectsExpanded'

/** Extract the project slug when the URL is /workspace/:ws/project/:slug[/...]
 *  or /workspace/:ws/projects/:slug. Returns null otherwise. */
function extractProjectSlug(
  pathname: string,
  workspaceUrl: string
): string | null {
  const base = `/workspace/${workspaceUrl}`
  if (!pathname.startsWith(base)) return null
  const rest = pathname.slice(base.length)
  const singular = rest.match(/^\/project\/([^/]+)/)
  if (singular) return singular[1]!
  const plural = rest.match(/^\/projects\/([^/]+)/)
  if (plural) return plural[1]!
  return null
}

interface Props {
  currentPage: Page
  projects: ApiProject[]
  workspaceUrl: string
  onNavigate: (page: Page) => void
  /** Provided by WorkspaceApp to open the NewProjectModal directly. Optional:
   *  when absent (standalone pages), the `+ New project` row navigates to
   *  `/projects?new=1` instead so ProjectsPage can host the modal. */
  onNewProject?: () => void
}

export function ProjectsSidebarGroup({
  currentPage,
  projects,
  workspaceUrl,
  onNavigate,
  onNewProject,
}: Props) {
  const intl = useIntl()
  const router = useRouter()
  const pathname = usePathname()

  // Stored user preference — starts collapsed on first use.
  const [storedExpanded, setStoredExpanded] = useState(false)
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    setStoredExpanded(raw === '1')
  }, [])
  const toggleStored = () => {
    setStoredExpanded(prev => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      return next
    })
  }

  // Auto-expand while inside a project page; do not mutate localStorage.
  const currentSlug = extractProjectSlug(pathname, workspaceUrl)
  const isOnProjectRoute =
    currentPage === 'project-detail' || currentSlug !== null
  const expanded = storedExpanded || isOnProjectRoute

  const visibleProjects = useMemo(
    () => projects.filter(p => !p.isIdea),
    [projects]
  )

  const handleCaretClick: React.MouseEventHandler<HTMLButtonElement> = e => {
    e.preventDefault()
    e.stopPropagation()
    toggleStored()
  }

  const handleNewProject = () => {
    if (onNewProject) {
      onNewProject()
    } else {
      router.push(`/workspace/${workspaceUrl}/projects?new=1`)
    }
  }

  return (
    <>
      <SidebarMenuItem>
        <div className='relative'>
          <SidebarMenuButton
            asChild
            isActive={
              currentPage === 'projects' || currentPage === 'project-detail'
            }
            tooltip={intl.formatMessage({ id: 'sidebar.projects' })}
          >
            <Link
              href={`/workspace/${workspaceUrl}/projects`}
              onClick={e => {
                e.preventDefault()
                onNavigate('projects')
              }}
            >
              <button
                type='button'
                onClick={handleCaretClick}
                aria-label={
                  expanded
                    ? intl.formatMessage({ id: 'sidebar.collapseProjects' })
                    : intl.formatMessage({ id: 'sidebar.expandProjects' })
                }
                className='flex items-center justify-center size-4 -ml-1 rounded text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
              >
                <ChevronRight
                  size={12}
                  className={cn(
                    'transition-transform',
                    expanded && 'rotate-90'
                  )}
                />
              </button>
              <FolderKanban />
              <span>{intl.formatMessage({ id: 'sidebar.projects' })}</span>
            </Link>
          </SidebarMenuButton>
        </div>
      </SidebarMenuItem>

      {expanded && (
        <SidebarMenuSub>
          {visibleProjects.length === 0 ? (
            <SidebarMenuSubItem>
              <span className='block px-2 py-1 text-xs text-sidebar-foreground/50'>
                {intl.formatMessage({ id: 'sidebar.noProjects' })}
              </span>
            </SidebarMenuSubItem>
          ) : (
            visibleProjects.map(p => {
              const slug = slugify(p.name)
              const isActive = slug === currentSlug
              return (
                <SidebarMenuSubItem key={p.id}>
                  <SidebarMenuSubButton asChild isActive={isActive}>
                    <Link href={`/workspace/${workspaceUrl}/project/${slug}`}>
                      <Folder size={12} className='shrink-0' />
                      <span>{p.name}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              )
            })
          )}

          <SidebarMenuSubItem>
            <button
              type='button'
              onClick={handleNewProject}
              className='flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            >
              <Plus size={12} className='shrink-0' />
              <span>{intl.formatMessage({ id: 'sidebar.newProject' })}</span>
            </button>
          </SidebarMenuSubItem>
        </SidebarMenuSub>
      )}
    </>
  )
}
```

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit
```

Expected: type errors only for the new i18n keys (`sidebar.newProject`, `sidebar.noProjects`, `sidebar.expandProjects`, `sidebar.collapseProjects`). If the i18n message lookup uses `FormattedMessage` with untyped keys, there may be no compile errors — verify via `react-intl` runtime warnings later.

If compile fails on these keys, skip ahead to Task 13 and come back; otherwise continue.

- [ ] **Step 4: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/sidebar/ProjectsSidebarGroup.tsx
git commit -m "feat(sidebar): ProjectsSidebarGroup static list [LUM-33]"
```

---

## Task 10: Wire `ProjectsSidebarGroup` into `AppSidebar`, pass data + `onNewProject`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/Sidebar.tsx`

- [ ] **Step 1: Add new imports and prop**

At the top of `Sidebar.tsx`, add imports:

```ts
import { useSidebarProjects } from '../hooks/useSidebarProjects'
import { ProjectsSidebarGroup } from './sidebar/ProjectsSidebarGroup'
```

Extend `AppSidebarProps` (the interface):

```ts
interface AppSidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  unreadCount: number
  draftCount: number
  /** See existing doc. */
  onOpenAskLumo?: () => void
  /** Open NewProjectModal. Omit on pages that don't host the modal — the
   *  sidebar will navigate to `/projects?new=1` instead. */
  onNewProject?: () => void
}
```

Update the `AppSidebar` function signature to destructure `onNewProject`.

- [ ] **Step 2: Use the hook**

`workspaceUrl` is already available locally via the existing `useParams<{ workspaceUrl: string }>()` call. Feed it straight to the hook — the pusher channel is keyed on the slug. Inside `AppSidebar`, add:

```ts
const { projects } = useSidebarProjects(workspaceUrl ?? null)
```

Place this immediately after the existing `useWorkspaceTeams()` call.

- [ ] **Step 3: Replace the Projects row with `ProjectsSidebarGroup`**

Locate the `SidebarMenuItem` that renders the Projects link (currently around lines 292-314). Replace it with a single call:

```tsx
<ProjectsSidebarGroup
  currentPage={currentPage}
  projects={projects}
  workspaceUrl={workspaceUrl}
  onNavigate={onNavigate}
  onNewProject={onNewProject}
/>
```

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit
```

Expected: errors in `WorkspaceApp`, `TaskDetailPage`, `ProjectDetailStandalonePage` if they pass through props — none of those should error yet because the new props are optional. Confirm.

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/Sidebar.tsx
git commit -m "feat(sidebar): mount ProjectsSidebarGroup in AppSidebar [LUM-33]"
```

---

## Task 11: Wire `onNewProject` and `workspaceId` from callers; handle `?new=1`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/pages/ProjectDetailStandalonePage.tsx`
- Modify: `app/workspace/[workspaceUrl]/hooks/useCurrentUser.ts` (_only if needed for workspaceId_)

> Note: the standalone pages already fetch workspace membership via various hooks. If retrieving `workspaceId` requires a new API call, skip passing it — the sidebar still works without real-time reorder sync on those pages.

- [ ] **Step 1: WorkspaceApp — wire `onNewProject` and read `?new=1`**

In `WorkspaceApp.tsx`, locate the `<AppSidebar>` render (~line 753) and add:

```tsx
<AppSidebar
  currentPage={currentPage}
  onNavigate={navigateTo}
  unreadCount={unreadCount}
  draftCount={draftCount}
  onOpenAskLumo={() => setIsQuickDispatchOpen(true)}
  onNewProject={() => setIsNewProjectModalOpen(true)}
/>
```

No `workspaceId` prop needed — the sidebar subscribes to the `workspace-{slug}` Pusher channel using the `workspaceUrl` route param it already reads via `useParams`.

Also add a new `useEffect` immediately after the existing URL-sync effects (around line 505):

```tsx
// When arriving at /workspace/:ws/projects?new=1 (e.g. from the sidebar on a
// standalone page), open the NewProjectModal and strip the param so the URL
// stays clean.
useEffect(() => {
  if (currentPage !== 'projects') return
  const params = new URLSearchParams(window.location.search)
  if (params.get('new') !== '1') return
  setIsNewProjectModalOpen(true)
  params.delete('new')
  const search = params.toString()
  const url = `${window.location.pathname}${
    search ? `?${search}` : ''
  }${window.location.hash}`
  window.history.replaceState(null, '', url)
}, [currentPage])
```

- [ ] **Step 2: Standalone pages — no new props needed**

`TaskDetailPage.tsx` and `ProjectDetailStandalonePage.tsx` already render `<AppSidebar currentPage=... onNavigate=... unreadCount=... draftCount=... />` with no `onNewProject`. Leave those call sites unchanged — the new props are optional and the sidebar falls back to `router.push('/projects?new=1')`.

- [ ] **Step 3: Type check + existing tests**

```bash
npx tsc --noEmit
npx jest --bail
```

Expected: no type errors; all existing unit tests green.

- [ ] **Step 4: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/WorkspaceApp.tsx
git commit -m "feat(sidebar): wire onNewProject from WorkspaceApp + ?new=1 handler [LUM-33]"
```

---

## Task 12: Drag-to-reorder with `@dnd-kit/sortable`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/sidebar/ProjectsSidebarGroup.tsx`

- [ ] **Step 1: Add imports**

At the top of the component file:

```tsx
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { projectsClient } from '@/lib/api-client'
import { toast } from 'sonner'
```

- [ ] **Step 2: Extend props to accept a setter**

Update `Props`:

```ts
interface Props {
  currentPage: Page
  projects: ApiProject[]
  setProjects: (next: ApiProject[]) => void
  workspaceUrl: string
  onNavigate: (page: Page) => void
  onNewProject?: () => void
}
```

And update the destructuring + the `AppSidebar` call site in `Sidebar.tsx` to pass `setProjects`:

```tsx
const { projects, setProjects } = useSidebarProjects(workspaceId ?? null)
// ...
<ProjectsSidebarGroup
  currentPage={currentPage}
  projects={projects}
  setProjects={updater => {
    if (typeof updater === 'function') {
      // Prevent stale refs — not exposed here; passing the next array only.
      return
    }
    setProjects(updater)
  }}
  workspaceUrl={workspaceUrl}
  onNavigate={onNavigate}
  onNewProject={onNewProject}
/>
```

(If the simpler "always pass a direct array" API feels awkward, expose `setProjects: React.Dispatch<React.SetStateAction<ApiProject[]>>` directly from the hook and pass it straight through.)

- [ ] **Step 3: Add the draggable row subcomponent**

Inside `ProjectsSidebarGroup.tsx`, above the main component, add:

```tsx
function DraggableProjectRow({
  project,
  workspaceUrl,
  isActive,
}: {
  project: ApiProject
  workspaceUrl: string
  isActive: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <SidebarMenuSubItem ref={setNodeRef} style={style} {...attributes}>
      <div className='group/row relative flex items-center'>
        <button
          type='button'
          {...listeners}
          className='absolute -left-4 top-1/2 -translate-y-1/2 size-4 flex items-center justify-center text-sidebar-foreground/30 opacity-0 group-hover/row:opacity-100 cursor-grab active:cursor-grabbing'
          aria-label='Drag to reorder'
        >
          <GripVertical size={10} />
        </button>
        <SidebarMenuSubButton asChild isActive={isActive}>
          <Link
            href={`/workspace/${workspaceUrl}/project/${slugify(project.name)}`}
          >
            <Folder size={12} className='shrink-0' />
            <span>{project.name}</span>
          </Link>
        </SidebarMenuSubButton>
      </div>
    </SidebarMenuSubItem>
  )
}
```

- [ ] **Step 4: Wrap the list with DndContext + SortableContext**

Replace the `visibleProjects.map(...)` block with:

```tsx
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
)

const handleDragEnd = async (e: DragEndEvent) => {
  const { active, over } = e
  if (!over || active.id === over.id) return
  const ids = visibleProjects.map(p => p.id)
  const oldIdx = ids.indexOf(String(active.id))
  const newIdx = ids.indexOf(String(over.id))
  if (oldIdx < 0 || newIdx < 0) return

  const reorderedVisible = arrayMove(visibleProjects, oldIdx, newIdx)
  // Merge back with the full projects list (ideas stay in place).
  const visibleById = new Map(reorderedVisible.map(p => [p.id, p]))
  let cursor = 0
  const merged = projects.map(p => {
    if (p.isIdea) return p
    const next = reorderedVisible[cursor++]
    return visibleById.has(p.id) ? next! : p
  })
  const previous = projects
  setProjects(merged)

  try {
    await projectsClient.reorder(reorderedVisible.map(p => p.id))
  } catch {
    setProjects(previous)
    toast.error('Could not save the new project order')
  }
}

return (
  /* …existing top row unchanged… */
  expanded && (
    <SidebarMenuSub>
      {visibleProjects.length === 0 ? (
        /* …existing empty state row… */
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={visibleProjects.map(p => p.id)}
            strategy={verticalListSortingStrategy}
          >
            {visibleProjects.map(p => (
              <DraggableProjectRow
                key={p.id}
                project={p}
                workspaceUrl={workspaceUrl}
                isActive={slugify(p.name) === currentSlug}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
      {/* …existing + New project row unchanged… */}
    </SidebarMenuSub>
  )
)
```

- [ ] **Step 5: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Manual smoke — start dev server and drag**

Ask the user to reload the page, expand Projects, and drag a row. Confirm:

- Rows reorder immediately.
- A network request `PATCH /api/projects/reorder` is made.
- A refresh preserves the new order.

- [ ] **Step 7: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/sidebar/ProjectsSidebarGroup.tsx app/workspace/\[workspaceUrl\]/components/Sidebar.tsx
git commit -m "feat(sidebar): drag-to-reorder projects [LUM-33]"
```

---

## Task 13: i18n strings

**Files:**

- Modify: every file under `messages/` (likely `en.json`, `zh-CN.json`, possibly more)

- [ ] **Step 1: Locate existing sidebar keys**

```bash
grep -l "sidebar.projects" messages/
```

Expected: at least `en.json` and `zh-CN.json`.

- [ ] **Step 2: Add keys to each locale**

For each messages file, add the four new keys alongside the existing `sidebar.*` group. Example for `en.json`:

```json
"sidebar.newProject": "New project",
"sidebar.noProjects": "No projects yet",
"sidebar.expandProjects": "Expand projects",
"sidebar.collapseProjects": "Collapse projects",
```

For `zh-CN.json`:

```json
"sidebar.newProject": "新建项目",
"sidebar.noProjects": "暂无项目",
"sidebar.expandProjects": "展开项目",
"sidebar.collapseProjects": "折叠项目",
```

Match the surrounding JSON punctuation (trailing commas are usually required only in JSON5; this repo uses plain JSON, so ensure the last key in the file does not have a trailing comma).

- [ ] **Step 3: Type check + run the app briefly**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add messages
git commit -m "feat(i18n): sidebar projects tree labels [LUM-33]"
```

---

## Task 14: Manual QA sweep

Create a short manual checklist and run each item. This step does not modify code but must be executed before calling the feature done.

- [ ] **Default collapsed + persistence**: open the app fresh — Projects row is collapsed. Click caret, expand, reload: stays expanded. Click caret to collapse, reload: stays collapsed.
- [ ] **Click-text vs click-caret**: clicking the "Projects" text goes to the list page regardless of expansion state. Clicking the caret toggles without navigating.
- [ ] **Auto-expand on project page**: collapse Projects. Navigate to any project detail (via list page or direct URL). Sidebar shows the list expanded with the current project highlighted. Navigate away (e.g., My Tasks). Projects row collapses back (no localStorage write).
- [ ] **+ New project on WorkspaceApp pages**: expand Projects from My Tasks → `+ New project` opens the modal directly.
- [ ] **+ New project on standalone pages**: expand Projects from inside a task detail (`/project/:slug/tasks/:id`) → click `+ New project`. URL changes to `/workspace/:ws/projects?new=1`; ProjectsPage loads with the modal open; after closing, URL shows `/workspace/:ws/projects` (no `?new=1`).
- [ ] **Drag reorder**: drag a project up or down. Order persists across reload. A second browser/tab sees the update within 1-2 seconds (Pusher sync).
- [ ] **Empty workspace**: in a brand-new workspace with zero projects, expanding Projects shows `No projects yet` + the `+ New project` row.
- [ ] **`isIdea` filter**: create an idea project (via Drafts). It does not appear in the sidebar list.
- [ ] **Long project names**: a 50-character name truncates with ellipsis; the caret, icon, and drag grip stay aligned.
- [ ] **Highlight precision**: with three projects, visit each one and confirm only the matching row is highlighted.

If any item fails, file the defect, return to the relevant task, and re-run this list.

---

## Self-Review Notes

- Spec coverage: Tasks 1-6 cover schema/migration, repo sort, repo reorder, repo `maxOrderInWorkspace`, service create-order, service reorder, zod schema, pusher. Tasks 7-11 cover API client, sidebar hook, sidebar component, sidebar integration, `?new=1` handling. Tasks 12-13 cover drag-reorder and i18n. Task 14 is manual QA per the spec.
- Placeholder scan: no TBD/TODO; every code step shows the code to write.
- Type consistency: `projectRepository.reorder(workspaceId, orderedIds)` matches service caller and test; `projectsClient.reorder(orderedIds)` matches component caller; `WorkspaceEvent` type name is used consistently in types/server/hook.
- Known risk: `setProjects` plumbing through `useSidebarProjects → AppSidebar → ProjectsSidebarGroup` is awkward. If type errors surface in Task 12, change `useSidebarProjects` to return `React.Dispatch<React.SetStateAction<ApiProject[]>>` and pass it through unchanged; that's a one-line adjustment, not a redesign.
