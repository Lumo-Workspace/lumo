# Projects List — Status Columns, Owner & Bulk Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the workspace Projects list page to parity with the new design — per-status task counts (To Do / In Progress / In Review / Done), Owner column from `defaultReviewer`, row-selection checkboxes, and bulk-delete with confirmation.

**Architecture:** Repository fans out (one project query + one `groupBy` aggregation), service flattens for UI, types widen, table renders 4 new columns + a checkbox column, optimistic update logic generalizes from one count to four.

**Tech Stack:** Prisma (groupBy), Next.js 14 App Router, React, TypeScript, Tailwind, shadcn/ui (Checkbox, AlertDialog), Jest.

**Spec:** [`docs/superpowers/specs/2026-04-18-projects-list-status-columns-design.md`](../specs/2026-04-18-projects-list-status-columns-design.md)

---

## File Map

| Path                                                                | Change | Responsibility                                                                    |
| ------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------- |
| `lib/repositories/project.repository.ts`                            | modify | Add `countTasksByStatus`, extend `findByWorkspace` include                        |
| `lib/services/project.service.ts`                                   | modify | Orchestrate two queries, flatten reviewer, derive counts                          |
| `app/workspace/[workspaceUrl]/types.ts`                             | modify | Widen `ApiProject`                                                                |
| `app/workspace/[workspaceUrl]/hooks/useWorkspaceTaskHandlers.ts`    | modify | Generalize optimistic count update to all 4 statuses                              |
| `app/workspace/[workspaceUrl]/hooks/useWorkspaceProjectHandlers.ts` | modify | Set initial counts on optimistic create + add `handleBulkDeleteProjects`          |
| `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`                     | modify | Wire `fetchProjects` into project handlers, pass `onBulkDelete` to `ProjectsPage` |
| `app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx`    | modify | New columns, selection state, bulk delete bar                                     |
| `__tests__/lib/repositories/project.repository.test.ts`             | modify | Cover new method + extended include                                               |
| `__tests__/lib/services/project.service.test.ts`                    | modify | Cover new shape (counts + reviewer flatten)                                       |

---

### Task 1: Add `countTasksByStatus` to project repository

**Files:**

- Modify: `lib/repositories/project.repository.ts`
- Test: `__tests__/lib/repositories/project.repository.test.ts`

- [ ] **Step 1: Write failing test**

Add to the bottom of `__tests__/lib/repositories/project.repository.test.ts`:

```ts
// ── countTasksByStatus ─────────────────────────────────────────────────────

describe('countTasksByStatus', () => {
  it('returns map of project id → status count buckets, filling zeros', async () => {
    // mock prisma.task.groupBy
    ;(prisma as unknown as { task: { groupBy: jest.Mock } }).task = {
      groupBy: jest.fn().mockResolvedValue([
        { projectId: 'p1', status: 'TODO', _count: { _all: 3 } },
        { projectId: 'p1', status: 'IN_PROGRESS', _count: { _all: 1 } },
        { projectId: 'p2', status: 'DONE', _count: { _all: 7 } },
      ]),
    }

    const result = await projectRepository.countTasksByStatus(
      'ws-1',
      'member-1'
    )

    expect(result.get('p1')).toEqual({
      TODO: 3,
      IN_PROGRESS: 1,
      IN_REVIEW: 0,
      DONE: 0,
    })
    expect(result.get('p2')).toEqual({
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 7,
    })
  })

  it('passes the workspace + idea-visibility filter to groupBy', async () => {
    const groupBy = jest.fn().mockResolvedValue([])
    ;(prisma as unknown as { task: { groupBy: jest.Mock } }).task = { groupBy }

    await projectRepository.countTasksByStatus('ws-1', 'member-1')

    expect(groupBy).toHaveBeenCalledWith({
      by: ['projectId', 'status'],
      where: {
        project: {
          workspaceId: 'ws-1',
          OR: [
            { isIdea: false },
            { isIdea: true, createdByMemberId: 'member-1' },
          ],
        },
      },
      _count: { _all: true },
    })
  })
})
```

You will also need to extend the mock at the top of the file. Replace the existing `jest.mock('@/lib/db/prisma', ...)` block with:

```ts
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    task: {
      groupBy: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/lib/repositories/project.repository.test.ts -t countTasksByStatus
```

Expected: `TypeError: projectRepository.countTasksByStatus is not a function`

- [ ] **Step 3: Implement `countTasksByStatus` in the repository**

Add to `lib/repositories/project.repository.ts` inside the `projectRepository` object (e.g. just below `findByWorkspace`):

```ts
/** Group tasks by (projectId, status) for the workspace, return buckets per project. */
async countTasksByStatus(workspaceId: string, memberId: string) {
  const rows = await prisma.task.groupBy({
    by: ['projectId', 'status'],
    where: {
      project: {
        workspaceId,
        OR: [{ isIdea: false }, { isIdea: true, createdByMemberId: memberId }],
      },
    },
    _count: { _all: true },
  })

  const map = new Map<
    string,
    { TODO: number; IN_PROGRESS: number; IN_REVIEW: number; DONE: number }
  >()
  for (const row of rows) {
    if (!row.projectId) continue
    const bucket = map.get(row.projectId) ?? {
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 0,
    }
    bucket[row.status] = row._count._all
    map.set(row.projectId, bucket)
  }
  return map
},
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/lib/repositories/project.repository.test.ts -t countTasksByStatus
```

Expected: 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/project.repository.ts __tests__/lib/repositories/project.repository.test.ts
git commit -m "feat: add countTasksByStatus to project repository [LUM-TBD]"
```

---

### Task 2: Extend `findByWorkspace` to include defaultReviewer + drop inline tasks count

**Files:**

- Modify: `lib/repositories/project.repository.ts:12-32`
- Test: `__tests__/lib/repositories/project.repository.test.ts:27-65`

- [ ] **Step 1: Update the existing `findByWorkspace` test**

Replace the existing `findByWorkspace` describe block in `__tests__/lib/repositories/project.repository.test.ts` (lines 27–65) with:

```ts
describe('findByWorkspace', () => {
  it('returns projects with defaultReviewer reference and repositories', async () => {
    const mockProjects = [
      {
        id: 'p1',
        name: 'Public Project',
        isIdea: false,
        _count: { tasks: 5 },
        defaultReviewer: { id: 'm1', clerkId: 'user_alice' },
        repositories: [],
      },
      {
        id: 'p2',
        name: 'My Idea',
        isIdea: true,
        createdByMemberId: 'member-1',
        _count: { tasks: 2 },
        defaultReviewer: null,
        repositories: [],
      },
    ]
    mockFindMany.mockResolvedValue(mockProjects)

    const result = await projectRepository.findByWorkspace('ws-1', 'member-1')

    expect(result).toEqual(mockProjects)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'ws-1',
          OR: [
            { isIdea: false },
            { isIdea: true, createdByMemberId: 'member-1' },
          ],
        },
        include: expect.objectContaining({
          _count: { select: { tasks: true } },
          defaultReviewer: { select: { id: true, clerkId: true } },
        }),
        orderBy: { updatedAt: 'desc' },
      })
    )
    // No inline tasks include — counts come from countTasksByStatus
    const call = mockFindMany.mock.calls[0][0] as {
      include: Record<string, unknown>
    }
    expect(call.include.tasks).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/lib/repositories/project.repository.test.ts -t findByWorkspace
```

Expected: assertion fails — `tasks` is still in `include`, `defaultReviewer` is missing.

- [ ] **Step 3: Update `findByWorkspace` in the repository**

Replace the body of `findByWorkspace` with (uses the `projectVisibilityWhere` helper added in Task 1's follow-up):

```ts
async findByWorkspace(workspaceId: string, memberId: string) {
  return prisma.project.findMany({
    where: projectVisibilityWhere(workspaceId, memberId),
    include: {
      _count: { select: { tasks: true } },
      defaultReviewer: { select: { id: true, clerkId: true } },
      repositories: {
        orderBy: [
          { isDefault: 'desc' as const },
          { createdAt: 'asc' as const },
        ] as unknown as { isDefault: 'desc'; createdAt: 'asc' }[],
      },
    },
    orderBy: { updatedAt: 'desc' },
  })
},
```

> **Schema note:** `WorkspaceMember` has no `user` relation in the Prisma schema. Display names live in Clerk. The repository fetches `clerkId`; the service resolves names via `clerkClient` (see Task 3, mirroring `lib/services/quick-dispatch.service.ts:213-218`).

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/lib/repositories/project.repository.test.ts -t findByWorkspace
```

Expected: 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/project.repository.ts __tests__/lib/repositories/project.repository.test.ts
git commit -m "refactor: extend project findByWorkspace include, drop inline tasks [LUM-TBD]"
```

---

### Task 3: Update `listProjects` service to derive counts + flatten reviewer

**Files:**

- Modify: `lib/services/project.service.ts:18-28`
- Test: `__tests__/lib/services/project.service.test.ts:5-75`

- [ ] **Step 1: Update the service test setup**

In `__tests__/lib/services/project.service.test.ts`, extend the repository mock (lines 13–21) so `countTasksByStatus` is mockable:

```ts
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findByWorkspace: jest.fn(),
    countTasksByStatus: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}))
```

Add the corresponding mock handle near the other mocks (line ~32):

```ts
const mockCountTasksByStatus = projectRepository.countTasksByStatus as jest.Mock
```

- [ ] **Step 2: Replace the existing `listProjects` describe block**

Replace lines 44–75 with:

```ts
describe('listProjects', () => {
  it('returns projects with all 4 status counts and flattened defaultReviewer (name resolved from Clerk)', async () => {
    mockFindByWorkspace.mockResolvedValue([
      {
        id: 'p1',
        name: 'Project A',
        _count: { tasks: 6 },
        defaultReviewer: { id: 'm1', clerkId: 'user_alice' },
        repositories: [],
      },
      {
        id: 'p2',
        name: 'Project B',
        _count: { tasks: 0 },
        defaultReviewer: null,
        repositories: [],
      },
    ])
    mockCountTasksByStatus.mockResolvedValue(
      new Map([['p1', { TODO: 2, IN_PROGRESS: 3, IN_REVIEW: 1, DONE: 0 }]])
    )
    // Clerk batch lookup mock — defined alongside the other top-of-file mocks
    mockClerkGetUserList.mockResolvedValue({
      data: [
        {
          id: 'user_alice',
          firstName: 'Alice',
          lastName: 'Liddell',
          emailAddresses: [{ emailAddress: 'alice@example.com' }],
        },
      ],
    })

    const result = await projectService.listProjects('ws-1', 'member-1')

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'p1',
        todoCount: 2,
        inProgressCount: 3,
        inReviewCount: 1,
        doneCount: 0,
        defaultReviewer: { id: 'm1', name: 'Alice Liddell' },
      })
    )
    // p2 had no entry in the map → all zeros, reviewer null
    expect(result[1]).toEqual(
      expect.objectContaining({
        id: 'p2',
        todoCount: 0,
        inProgressCount: 0,
        inReviewCount: 0,
        doneCount: 0,
        defaultReviewer: null,
      })
    )
    // Clerk should only be called when at least one reviewer exists
    expect(mockClerkGetUserList).toHaveBeenCalledWith({
      userId: ['user_alice'],
      limit: 1,
    })
  })

  it('skips Clerk lookup when no project has a reviewer', async () => {
    mockFindByWorkspace.mockResolvedValue([
      { id: 'p1', name: 'X', _count: { tasks: 0 }, defaultReviewer: null, repositories: [] },
    ])
    mockCountTasksByStatus.mockResolvedValue(new Map())

    const result = await projectService.listProjects('ws-1', 'member-1')

    expect(result[0].defaultReviewer).toBeNull()
    expect(mockClerkGetUserList).not.toHaveBeenCalled()
  })
})```

> **Top-of-file additions for the test setup**: alongside the other `jest.mock` blocks, mock `@clerk/nextjs/server`:
>
> ```ts
> jest.mock('@clerk/nextjs/server', () => {
>   const getUserList = jest.fn()
>   return {
>     clerkClient: jest.fn().mockResolvedValue({
>       users: { getUserList },
>     }),
>   }
> })
>
> // Near other mock handles (line ~32):
> import { clerkClient } from '@clerk/nextjs/server'
> const mockClerkGetUserList = (await (clerkClient as jest.Mock)()).users
>   .getUserList as jest.Mock
> ```
>
> Note: the `await` in the handle initializer needs to live inside `beforeEach` since top-level `await` won't work in a Jest test file. Use:
>
> ```ts
> let mockClerkGetUserList: jest.Mock
> beforeEach(async () => {
>   jest.clearAllMocks()
>   const c = await (clerkClient as unknown as jest.Mock)()
>   mockClerkGetUserList = c.users.getUserList as jest.Mock
> })
> ```
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx jest __tests__/lib/services/project.service.test.ts -t listProjects
```

Expected: assertion fails — service still emits `inProgressCount` only and unflattened reviewer.

- [ ] **Step 4: Update the service**

Replace `listProjects` in `lib/services/project.service.ts:18-28` with the version below. It batch-resolves reviewer display names from Clerk in a single API call (mirrors `lib/services/quick-dispatch.service.ts:213-218`).

```ts
async listProjects(workspaceId: string, memberId: string) {
  const [projects, statusCounts] = await Promise.all([
    projectRepository.findByWorkspace(workspaceId, memberId),
    projectRepository.countTasksByStatus(workspaceId, memberId),
  ])

  // Batch-resolve reviewer display names from Clerk (one call for all reviewers).
  const clerkIds = Array.from(
    new Set(
      projects
        .map(p => p.defaultReviewer?.clerkId)
        .filter((c): c is string => !!c)
    )
  )
  const nameByClerkId = new Map<string, string>()
  if (clerkIds.length > 0) {
    const { clerkClient } = await import('@clerk/nextjs/server')
    const clerk = await clerkClient()
    const { data: users } = await clerk.users.getUserList({
      userId: clerkIds,
      limit: clerkIds.length,
    })
    for (const u of users) {
      const trimmed = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()
      nameByClerkId.set(
        u.id,
        trimmed || u.emailAddresses[0]?.emailAddress || 'Unknown'
      )
    }
  }

  return projects.map(p => {
    const counts = statusCounts.get(p.id) ?? {
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 0,
    }
    const { defaultReviewer, ...rest } = p
    return {
      ...rest,
      todoCount: counts.TODO,
      inProgressCount: counts.IN_PROGRESS,
      inReviewCount: counts.IN_REVIEW,
      doneCount: counts.DONE,
      defaultReviewer: defaultReviewer
        ? {
            id: defaultReviewer.id,
            name: nameByClerkId.get(defaultReviewer.clerkId) ?? 'Unknown',
          }
        : null,
    }
  })
},
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest __tests__/lib/services/project.service.test.ts
```

Expected: all `project.service.test.ts` tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/services/project.service.ts __tests__/lib/services/project.service.test.ts
git commit -m "feat: list projects with all status counts + reviewer [LUM-TBD]"
```

---

### Task 4: Widen `ApiProject` type + fix optimistic-create call sites

**Files:**

- Modify: `app/workspace/[workspaceUrl]/types.ts:113-132`
- Modify: `app/workspace/[workspaceUrl]/hooks/useWorkspaceProjectHandlers.ts:52-62, 84-88`

- [ ] **Step 1: Add the new fields to `ApiProject`**

In `app/workspace/[workspaceUrl]/types.ts`, find `ApiProject` (line ~113) and add four lines next to `inProgressCount`:

```ts
  _count: { tasks: number }
  todoCount: number
  inProgressCount: number
  inReviewCount: number
  doneCount: number
  defaultReviewer: { id: string; name: string } | null
```

- [ ] **Step 2: Run TypeScript to surface call sites**

```bash
npx tsc --noEmit
```

Expected: errors in `useWorkspaceProjectHandlers.ts` (two object literals missing the new required fields).

- [ ] **Step 3: Fix the optimistic-create call sites**

In `app/workspace/[workspaceUrl]/hooks/useWorkspaceProjectHandlers.ts`, update the two object literals.

At line 52–62 (the `optimistic` constant), change:

```ts
const optimistic: ApiProject = {
  id: tempId,
  name,
  description: description.trim() || null,
  isIdea: false,
  defaultReviewerId: null,
  createdAt: now,
  updatedAt: now,
  _count: { tasks: 0 },
  inProgressCount: 0,
}
```

to:

```ts
const optimistic: ApiProject = {
  id: tempId,
  name,
  description: description.trim() || null,
  isIdea: false,
  defaultReviewerId: null,
  createdAt: now,
  updatedAt: now,
  _count: { tasks: 0 },
  todoCount: 0,
  inProgressCount: 0,
  inReviewCount: 0,
  doneCount: 0,
  defaultReviewer: null,
}
```

At line 84–88 (the `confirmed` constant), change:

```ts
const confirmed: ApiProject = {
  ...project,
  _count: { tasks: 0 },
  inProgressCount: 0,
}
```

to:

```ts
const confirmed: ApiProject = {
  ...project,
  _count: { tasks: 0 },
  todoCount: 0,
  inProgressCount: 0,
  inReviewCount: 0,
  doneCount: 0,
  defaultReviewer: null,
}
```

- [ ] **Step 4: Run TypeScript again**

```bash
npx tsc --noEmit
```

Expected: no errors related to `ApiProject`.

- [ ] **Step 5: Commit**

```bash
git add app/workspace/[workspaceUrl]/types.ts app/workspace/[workspaceUrl]/hooks/useWorkspaceProjectHandlers.ts
git commit -m "feat: widen ApiProject with status counts + reviewer [LUM-TBD]"
```

---

### Task 5: Generalize optimistic status-change update to all 4 counts

**Files:**

- Modify: `app/workspace/[workspaceUrl]/hooks/useWorkspaceTaskHandlers.ts:301-322`

- [ ] **Step 1: Replace `handleProjectTaskStatusChanged`**

In `useWorkspaceTaskHandlers.ts`, replace lines 301–322 with:

```ts
// ─── Status change tracking for per-status counts ──────────────────────
const handleProjectTaskStatusChanged = useCallback(
  (_taskId: string, oldStatus: string, newStatus: string) => {
    if (!selectedProject) return
    const KEY: Record<
      string,
      'todoCount' | 'inProgressCount' | 'inReviewCount' | 'doneCount'
    > = {
      TODO: 'todoCount',
      IN_PROGRESS: 'inProgressCount',
      IN_REVIEW: 'inReviewCount',
      DONE: 'doneCount',
    }
    const oldKey = KEY[oldStatus]
    const newKey = KEY[newStatus]
    if (!oldKey || !newKey || oldKey === newKey) return

    setProjects(prev =>
      prev.map(p =>
        p.id === selectedProject.id
          ? {
              ...p,
              [oldKey]: Math.max(0, p[oldKey] - 1),
              [newKey]: p[newKey] + 1,
            }
          : p
      )
    )
  },
  [selectedProject, setProjects]
)
```

- [ ] **Step 2: Verify TypeScript stays clean**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/workspace/[workspaceUrl]/hooks/useWorkspaceTaskHandlers.ts
git commit -m "refactor: track all 4 task-status counts on project list [LUM-TBD]"
```

---

### Task 6: Add `handleBulkDeleteProjects` and wire `fetchProjects`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/hooks/useWorkspaceProjectHandlers.ts`
- Modify: `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`

- [ ] **Step 1: Add `fetchProjects` to the hook options + the new handler**

In `app/workspace/[workspaceUrl]/hooks/useWorkspaceProjectHandlers.ts`:

(a) Extend `UseWorkspaceProjectHandlersOptions` (line 12) with one new field:

```ts
interface UseWorkspaceProjectHandlersOptions {
  setProjects: Dispatch<SetStateAction<ApiProject[]>>
  setSelectedProject: Dispatch<SetStateAction<ApiProject | null>>
  navigateTo: (page: Page, project?: ApiProject) => void
  /** Cleanup task data when deleting a project */
  onDeleteProjectTasks: (projectId: string) => void
  setSelectedTask: Dispatch<SetStateAction<unknown>>
  /** Re-fetch the project list (used to reconcile partial bulk-delete failures) */
  fetchProjects: () => Promise<void> | void
}
```

(b) Pull the new dependency from the hook arguments (line ~23):

```ts
export function useWorkspaceProjectHandlers({
  setProjects,
  setSelectedProject,
  navigateTo,
  onDeleteProjectTasks,
  setSelectedTask,
  fetchProjects,
}: UseWorkspaceProjectHandlersOptions) {
```

(c) Add a new handler immediately after `handleDeleteProject` (line ~140):

```ts
const handleBulkDeleteProjects = useCallback(
  async (projectIds: string[]) => {
    if (projectIds.length === 0) return

    const idSet = new Set(projectIds)

    // Optimistic local cleanup
    projectIds.forEach(id => onDeleteProjectTasks(id))
    setSelectedProject(prev => (prev && idSet.has(prev.id) ? null : prev))
    setSelectedTask((prev: unknown) => {
      const t = prev as { id?: string; projectId?: string } | null
      return t && t.projectId && idSet.has(t.projectId) ? null : prev
    })
    setProjects(prev => prev.filter(p => !idSet.has(p.id)))

    const results = await Promise.allSettled(
      projectIds.map(id => projectsClient.delete(id))
    )
    const failed = results.filter(r => r.status === 'rejected').length

    if (failed > 0) {
      // Reconcile by re-fetching from the server
      await fetchProjects()
      toast.error(
        `Failed to delete ${failed} of ${projectIds.length} project${projectIds.length === 1 ? '' : 's'}`
      )
    } else {
      toast.success(
        `${projectIds.length} project${projectIds.length === 1 ? '' : 's'} deleted`
      )
    }
  },
  [
    fetchProjects,
    onDeleteProjectTasks,
    setProjects,
    setSelectedProject,
    setSelectedTask,
  ]
)
```

(d) Add it to the returned object (line ~142):

```ts
return {
  handleSelectProject,
  handleBack,
  openNewProject,
  handleCreateProject,
  handleUpdateProject,
  handleDeleteProject,
  handleBulkDeleteProjects,
}
```

- [ ] **Step 2: Pass `fetchProjects` from `WorkspaceApp.tsx`**

In `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`, find the `useWorkspaceProjectHandlers({...})` call and add `fetchProjects` to the options object. Search for the existing call:

```bash
grep -n "useWorkspaceProjectHandlers" app/workspace/[workspaceUrl]/WorkspaceApp.tsx
```

The call site already destructures `fetchProjects` from `useProjects` (line 155), so just add it to the options. Example diff (the surrounding code may differ slightly — match the destructured name):

```ts
const projectHandlers = useWorkspaceProjectHandlers({
  setProjects,
  setSelectedProject,
  navigateTo,
  onDeleteProjectTasks,
  setSelectedTask,
  fetchProjects, // ← add this
})
```

- [ ] **Step 3: Wire the handler into the `<ProjectsPage>` props**

In the same `WorkspaceApp.tsx`, replace the `case 'projects':` branch at lines 533–543 with:

```tsx
case 'projects':
  return (
    <ProjectsPage
      projects={projects}
      loading={projectsLoading}
      error={projectsError}
      onRetry={fetchProjects}
      onSelectProject={projectHandlers.handleSelectProject}
      onNewProject={() => setIsNewProjectModalOpen(true)}
      onBulkDelete={projectHandlers.handleBulkDeleteProjects}
    />
  )
```

(`useWorkspaceProjectHandlers` has only one caller — this file — so there are no other call sites to update.)

- [ ] **Step 4: Run TypeScript**

```bash
npx tsc --noEmit
```

Expected: one error in `ProjectsPage.tsx` saying `onBulkDelete` is unknown — that gets fixed in the next task. Acceptable for this commit.

- [ ] **Step 5: Commit**

```bash
git add app/workspace/[workspaceUrl]/hooks/useWorkspaceProjectHandlers.ts app/workspace/[workspaceUrl]/WorkspaceApp.tsx
git commit -m "feat: add bulk delete handler for projects [LUM-TBD]"
```

---

### Task 7: Add new columns (To Do / In Review / Done / Owner) to `ProjectsPage`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx`

- [ ] **Step 1: Widen `ProjectSortKey` and the sort switch**

Replace line 36:

```ts
type ProjectSortKey =
  | 'name'
  | 'tasks'
  | 'todo'
  | 'inProgress'
  | 'inReview'
  | 'done'
  | 'owner'
  | 'updatedAt'
```

In the `useMemo` sort function (lines 66–85), add cases for the new keys. Replace the body of the `switch` with:

```ts
switch (sort.key) {
  case 'name':
    return applyDir(cmpString(a.name, b.name), sort.dir)
  case 'tasks':
    return applyDir(cmpNumber(a._count.tasks, b._count.tasks), sort.dir)
  case 'todo':
    return applyDir(cmpNumber(a.todoCount, b.todoCount), sort.dir)
  case 'inProgress':
    return applyDir(cmpNumber(a.inProgressCount, b.inProgressCount), sort.dir)
  case 'inReview':
    return applyDir(cmpNumber(a.inReviewCount, b.inReviewCount), sort.dir)
  case 'done':
    return applyDir(cmpNumber(a.doneCount, b.doneCount), sort.dir)
  case 'owner':
    return applyDir(
      cmpString(a.defaultReviewer?.name ?? '', b.defaultReviewer?.name ?? ''),
      sort.dir
    )
  case 'updatedAt':
    return applyDir(cmpDate(a.updatedAt, b.updatedAt), sort.dir)
  default:
    return 0
}
```

- [ ] **Step 2: Add the new headers**

In `<thead>` (lines 191–220), insert three new `SortableHeader`s for `todo`, `inReview`, `done`, and an `owner` header, alongside the existing ones. Replace the `<tr>` block with:

```tsx
<tr>
  <SortableHeader
    col='name'
    label='Project'
    sort={sort}
    onToggle={toggle}
    className='text-left py-3 px-6'
  />
  <SortableHeader
    col='tasks'
    label='Tasks'
    sort={sort}
    onToggle={toggle}
    className='text-left py-3 px-6 w-24'
  />
  <SortableHeader
    col='todo'
    label='To Do'
    sort={sort}
    onToggle={toggle}
    className='text-left py-3 px-6 w-24'
  />
  <SortableHeader
    col='inProgress'
    label='In Progress'
    sort={sort}
    onToggle={toggle}
    className='text-left py-3 px-6 w-28'
  />
  <SortableHeader
    col='inReview'
    label='In Review'
    sort={sort}
    onToggle={toggle}
    className='text-left py-3 px-6 w-28'
  />
  <SortableHeader
    col='done'
    label='Done'
    sort={sort}
    onToggle={toggle}
    className='text-left py-3 px-6 w-24'
  />
  <SortableHeader
    col='owner'
    label='Owner'
    sort={sort}
    onToggle={toggle}
    className='text-left py-3 px-6 w-32'
  />
  <SortableHeader
    col='updatedAt'
    label='Updated'
    sort={sort}
    onToggle={toggle}
    className='text-right py-3 px-6'
  />
</tr>
```

- [ ] **Step 3: Add a small status-cell helper above the component**

Above `export function ProjectsPage` (around line 47), add:

```tsx
const STATUS_DOT_CLS = {
  TODO: 'bg-zinc-300 dark:bg-zinc-600',
  IN_PROGRESS: 'bg-blue-500',
  IN_REVIEW: 'bg-purple-500',
  DONE: 'bg-green-500',
} as const

function StatusCell({
  count,
  status,
}: {
  count: number
  status: keyof typeof STATUS_DOT_CLS
}) {
  return (
    <td className='py-4 px-6 border-b border-zinc-200 dark:border-zinc-800'>
      <div className='flex items-center gap-2'>
        <div className={`size-2 rounded-full ${STATUS_DOT_CLS[status]}`} />
        <span className='text-xs text-zinc-700 dark:text-zinc-300'>
          {count}
        </span>
      </div>
    </td>
  )
}
```

- [ ] **Step 4: Replace the row body to include all 4 status cells + Owner**

In the row `<tr>` (lines 223–275), replace the existing `In Progress` cell with four sequential cells, and insert an Owner cell before `Updated`. The full row body becomes:

```tsx
<tr
  key={project.id}
  onClick={() => onSelectProject(project)}
  className='hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors cursor-pointer group'
>
  <td className='py-4 px-6 border-b border-zinc-200 dark:border-zinc-800'>
    <div className='flex items-center gap-3'>
      <span className='font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors'>
        {project.name}
      </span>
      {project.isIdea && <span className={IDEA_BADGE_CLS}>Draft</span>}
    </div>
  </td>
  <td className='py-4 px-6 border-b border-zinc-200 dark:border-zinc-800'>
    <span className='px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] font-medium text-zinc-600 dark:text-zinc-400'>
      {project._count.tasks}
    </span>
  </td>
  <StatusCell count={project.todoCount} status='TODO' />
  <StatusCell count={project.inProgressCount} status='IN_PROGRESS' />
  <StatusCell count={project.inReviewCount} status='IN_REVIEW' />
  <StatusCell count={project.doneCount} status='DONE' />
  <td className='py-4 px-6 border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300'>
    {project.defaultReviewer?.name ?? '—'}
  </td>
  <td className='py-4 px-6 text-right text-zinc-500 dark:text-zinc-400 text-xs border-b border-zinc-200 dark:border-zinc-800'>
    <div className='flex items-center justify-end gap-2'>
      <span>{new Date(project.updatedAt).toLocaleDateString()}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-300 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100'
            onClick={e => {
              e.stopPropagation()
              copyLink(
                `${window.location.origin}/workspace/${workspaceUrl}/project/${slugify(project.name)}`
              )
            }}
          >
            <LinkIcon size={12} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Copy link</TooltipContent>
      </Tooltip>
    </div>
  </td>
</tr>
```

(The `Tasks` cell loses the trailing word "tasks" — only the number remains, matching the screenshot.)

- [ ] **Step 5: Verify in the browser**

Start (or reload) the preview server and open `/workspace/<slug>/projects`. Confirm:

- 8 columns visible: Project / Tasks / To Do / In Progress / In Review / Done / Owner / Updated
- Each status cell shows the correct color dot
- Owner column shows the reviewer name or `—`
- Sorting works on every column

- [ ] **Step 6: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx
git commit -m "feat: add status + owner columns to projects list [LUM-TBD]"
```

---

### Task 8: Add row-selection checkboxes (header tri-state + per-row)

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx`

- [ ] **Step 1: Import `Checkbox` and add selection state**

At the top of the file, add to the existing imports:

```tsx
import { Checkbox } from '@/components/ui/checkbox'
```

Inside the component (right after the existing `useTableSort` line), add:

```tsx
const [selected, setSelected] = useState<Set<string>>(new Set())

const visibleIds = useMemo(() => sorted.map(p => p.id), [sorted])
const selectedVisibleCount = useMemo(
  () => visibleIds.filter(id => selected.has(id)).length,
  [visibleIds, selected]
)
const headerCheckboxState: boolean | 'indeterminate' =
  selectedVisibleCount === 0
    ? false
    : selectedVisibleCount === visibleIds.length
      ? true
      : 'indeterminate'

const toggleAll = () => {
  setSelected(prev => {
    if (selectedVisibleCount === visibleIds.length) {
      // All selected → clear those
      const next = new Set(prev)
      visibleIds.forEach(id => next.delete(id))
      return next
    }
    // Otherwise select all visible
    const next = new Set(prev)
    visibleIds.forEach(id => next.add(id))
    return next
  })
}

const toggleOne = (id: string) => {
  setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
}
```

- [ ] **Step 2: Add the header checkbox cell**

Inside the `<tr>` in `<thead>` (the one you edited in Task 7), prepend a `<th>` before the `Project` header:

```tsx
<th className='py-3 px-4 w-10'>
  <Checkbox
    checked={headerCheckboxState}
    onCheckedChange={toggleAll}
    aria-label='Select all projects'
  />
</th>
```

- [ ] **Step 3: Add the row checkbox cell**

Inside each `<tr>` in `<tbody>`, prepend a `<td>` before the `Project` cell:

```tsx
<td
  className='py-4 px-4 border-b border-zinc-200 dark:border-zinc-800'
  onClick={e => e.stopPropagation()}
>
  <Checkbox
    checked={selected.has(project.id)}
    onCheckedChange={() => toggleOne(project.id)}
    aria-label={`Select ${project.name}`}
  />
</td>
```

(The `onClick` stop on the `<td>` prevents row navigation when the checkbox area is clicked.)

- [ ] **Step 4: Verify in browser**

- Click a row's checkbox → row stays on the page (no navigation), checkbox toggles
- Click the header checkbox → all visible rows toggle
- Click some but not all rows → header checkbox shows indeterminate state
- Click row name area → still navigates into project

- [ ] **Step 5: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx
git commit -m "feat: add row selection checkboxes to projects list [LUM-TBD]"
```

---

### Task 9: Add bulk-delete bar + confirmation dialog

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx`

- [ ] **Step 1: Extend the prop interface**

In `ProjectsPage.tsx`, update the props (lines 38–45):

```tsx
interface ProjectsPageProps {
  projects: ApiProject[]
  loading: boolean
  error: string | null
  onRetry: () => void
  onSelectProject: (project: ApiProject) => void
  onNewProject: () => void
  onBulkDelete: (projectIds: string[]) => Promise<void> | void
}
```

Destructure the new prop in the component signature:

```tsx
export function ProjectsPage({
  projects,
  loading,
  error,
  onRetry,
  onSelectProject,
  onNewProject,
  onBulkDelete,
}: ProjectsPageProps) {
```

- [ ] **Step 2: Import AlertDialog + Button (if not already), add local dialog state**

Add to imports:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Trash2 } from 'lucide-react'
```

Inside the component, add:

```tsx
const [confirmOpen, setConfirmOpen] = useState(false)
const [deleting, setDeleting] = useState(false)

const selectedIds = useMemo(() => Array.from(selected), [selected])
const selectedCount = selectedIds.length

const runBulkDelete = async () => {
  setDeleting(true)
  try {
    await onBulkDelete(selectedIds)
    setSelected(new Set())
  } finally {
    setDeleting(false)
    setConfirmOpen(false)
  }
}
```

- [ ] **Step 3: Render the selection bar above the table**

Inside `<div className='flex-1 overflow-auto'>` (currently wrapping `<AsyncContent>`), prepend a sticky bar:

```tsx
{
  selectedCount > 0 && (
    <div className='sticky top-0 z-20 flex items-center justify-between gap-3 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-2.5'>
      <span className='text-xs font-medium text-zinc-700 dark:text-zinc-300'>
        {selectedCount} selected
      </span>
      <div className='flex items-center gap-2'>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => setSelected(new Set())}
        >
          Cancel
        </Button>
        <Button
          variant='destructive'
          size='sm'
          className='gap-1.5'
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 size={14} />
          Delete {selectedCount} project{selectedCount === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Render the AlertDialog**

Just before the closing `</div>` of the outermost wrapper (line ~281), add:

```tsx
<AlertDialog
  open={confirmOpen}
  onOpenChange={open => !deleting && setConfirmOpen(open)}
>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>
        Delete {selectedCount} project{selectedCount === 1 ? '' : 's'}?
      </AlertDialogTitle>
      <AlertDialogDescription>
        This action cannot be undone. All tasks, views, and documents in{' '}
        {selectedCount === 1
          ? 'this project'
          : `these ${selectedCount} projects`}{' '}
        will be permanently removed.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
      <AlertDialogAction
        disabled={deleting}
        onClick={runBulkDelete}
        className='bg-red-600 hover:bg-red-700 focus:ring-red-600'
      >
        {deleting ? 'Deleting…' : 'Delete'}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 5: Verify in browser**

- Select 2+ projects → top bar appears with `{N} selected · Cancel · Delete N projects`
- Click `Cancel` → bar disappears, selection cleared
- Click `Delete N projects` → AlertDialog opens
- Confirm → projects disappear from list, toast `{N} projects deleted`, selection cleared
- (Manually break the network in devtools and try again to confirm the partial-failure path: error toast + list reconciles after `fetchProjects`)

- [ ] **Step 6: Run type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx
git commit -m "feat: bulk delete projects with confirmation [LUM-TBD]"
```

---

### Task 10: Run full test suite + final type check

**Files:** none (verification only)

- [ ] **Step 1: Run all tests**

```bash
npm test -- --testPathPattern='project'
```

Expected: all `project.repository.test.ts` and `project.service.test.ts` tests pass.

- [ ] **Step 2: Run full type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run lint**

```bash
npx eslint 'app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx' 'app/workspace/[workspaceUrl]/hooks/useWorkspace*.ts' 'lib/repositories/project.repository.ts' 'lib/services/project.service.ts'
```

Expected: no errors.

- [ ] **Step 4: Open the preview and run the happy path one more time**

Confirm:

- Visit `/workspace/<slug>/projects`
- All 8 columns render correct counts and owner
- Sort by each column works
- Select all → 3 selected → confirm-delete → 3 rows disappear
- Toast shows success
- Refresh the page → same state persists

- [ ] **Step 5: No commit** (this task is verification only)

---

## Out-of-Scope Reminder

Do not implement in this plan: grid view, large `Projects` page title, `Create Project` rename, batch endpoint, archive concept, Owner avatars. The spec defers all of these.
