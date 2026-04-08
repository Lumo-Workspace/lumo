# Backend Layered Architecture — Task & Comment Domains

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Repository and Service layers from Task and Comment API routes, establishing the architectural pattern for all domains.

**Architecture:** API routes become thin handlers (~50 lines) that delegate to Service layer for business logic and Repository layer for data access. Services depend on Repositories (never Prisma directly). Repositories encapsulate all Prisma queries and return domain models.

**Tech Stack:** TypeScript, Prisma, Next.js API Routes, Jest, Zod

---

## File Structure

### New files to create:

- `lib/repositories/task.repository.ts` — Task data access (Prisma queries)
- `lib/repositories/comment.repository.ts` — Comment data access
- `lib/repositories/pull-request.repository.ts` — PR data access (sync logic)
- `lib/repositories/index.ts` — Re-exports
- `lib/services/task.service.ts` — Task business logic
- `lib/services/comment.service.ts` — Comment business logic
- `lib/services/index.ts` — Re-exports
- `__tests__/lib/repositories/task.repository.test.ts` — Repository tests
- `__tests__/lib/repositories/comment.repository.test.ts` — Repository tests
- `__tests__/lib/services/task.service.test.ts` — Service tests
- `__tests__/lib/services/comment.service.test.ts` — Service tests

### Files to modify:

- `app/api/tasks/[id]/route.ts` — Slim down to ~60 lines
- `app/api/tasks/[id]/comments/route.ts` — Slim down to ~40 lines
- `lib/task/state-machine.ts` — Remove direct Prisma dependency, accept update function

---

### Task 1: Create TaskRepository

**Files:**

- Create: `lib/repositories/task.repository.ts`
- Create: `__tests__/lib/repositories/task.repository.test.ts`
- Create: `lib/repositories/index.ts`

- [ ] **Step 1: Write the failing test for `findById`**

```typescript
// __tests__/lib/repositories/task.repository.test.ts
/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { taskRepository } from '@/lib/repositories/task.repository'

const mockFindUnique = prisma.task.findUnique as jest.Mock
const mockFindMany = prisma.task.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskRepository.findById', () => {
  it('returns task with full relations when found', async () => {
    const mockTask = {
      id: 'task-1',
      title: 'Test task',
      status: 'TODO',
      project: { id: 'proj-1', name: 'Project', workspaceId: 'ws-1' },
      team: { identifier: 'LUM' },
    }
    mockFindUnique.mockResolvedValue(mockTask)

    const result = await taskRepository.findById('task-1')

    expect(result).toEqual(mockTask)
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'task-1' } })
    )
  })

  it('returns null when task not found', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await taskRepository.findById('nonexistent')

    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/repositories/task.repository.test.ts --no-coverage`
Expected: FAIL with "Cannot find module '@/lib/repositories/task.repository'"

- [ ] **Step 3: Write `findById` implementation**

```typescript
// lib/repositories/task.repository.ts
import { prisma } from '@/lib/db/prisma'

/**
 * Full detail include for single task view.
 * Used by GET /api/tasks/[id] and task detail pages.
 */
const TASK_DETAIL_INCLUDE = {
  project: {
    select: {
      id: true,
      name: true,
      workspaceId: true,
      defaultReviewerId: true,
      repositories: {
        orderBy: [
          { isDefault: 'desc' as const },
          { createdAt: 'asc' as const },
        ],
      },
    },
  },
  team: { select: { identifier: true } },
  assignee: {
    select: {
      id: true,
      type: true,
      member: { select: { id: true, clerkId: true } },
      agent: { select: { id: true, name: true, avatarColor: true } },
    },
  },
  reviewer: {
    select: {
      id: true,
      type: true,
      member: { select: { id: true, clerkId: true } },
    },
  },
  pullRequests: {
    select: {
      id: true,
      number: true,
      title: true,
      url: true,
      state: true,
      authorLogin: true,
      headBranch: true,
      ciStatus: true,
      mergedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
  },
  branches: {
    select: {
      id: true,
      repo: true,
      branchName: true,
      lastCommitSha: true,
      lastCommitMessage: true,
      lastCommitAuthor: true,
      lastPushedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
  },
  clarifies: {
    select: {
      id: true,
      question: true,
      context: true,
      reply: true,
      repliedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
  },
  parent: {
    select: {
      id: true,
      title: true,
      number: true,
      team: { select: { identifier: true } },
    },
  },
  children: {
    select: { id: true, title: true, number: true, status: true },
    orderBy: { number: 'asc' as const },
  },
  agentRuns: {
    select: {
      id: true,
      runNumber: true,
      status: true,
      trigger: true,
      errorCode: true,
      errorMessage: true,
      summary: true,
      steps: true,
      changedFiles: true,
      durationMs: true,
      prNumber: true,
      prUrl: true,
      branchName: true,
      startedAt: true,
      finishedAt: true,
    },
    orderBy: { runNumber: 'desc' as const },
  },
} as const

/**
 * Include for task update operations (lighter than full detail).
 */
const TASK_UPDATE_INCLUDE = {
  project: {
    include: {
      defaultReviewer: { select: { id: true, clerkId: true } },
      workspace: { select: { slug: true } },
    },
  },
  team: { select: { identifier: true } },
} as const

export const taskRepository = {
  /**
   * Find a task by ID with full detail relations.
   */
  async findById(id: string) {
    return prisma.task.findUnique({
      where: { id },
      include: TASK_DETAIL_INCLUDE,
    })
  },

  /**
   * Find a task by ID with update-related relations (project + team).
   */
  async findForUpdate(id: string) {
    return prisma.task.findUnique({
      where: { id },
      include: TASK_UPDATE_INCLUDE,
    })
  },

  /**
   * Find a task by ID with only the project relation (for auth checks).
   */
  async findWithProject(id: string) {
    return prisma.task.findUnique({
      where: { id },
      include: { project: true },
    })
  },

  /**
   * Update a task's fields.
   */
  async update(id: string, data: Record<string, unknown>) {
    return prisma.task.update({
      where: { id },
      data,
      include: {
        project: { select: { id: true, name: true } },
        team: { select: { identifier: true } },
      },
    })
  },

  /**
   * Delete a task by ID.
   */
  async delete(id: string) {
    await prisma.task.delete({ where: { id } })
  },

  /**
   * Find all children of a task (direct descendants only).
   */
  async findChildren(parentId: string) {
    return prisma.task.findMany({
      where: { parentTaskId: parentId },
      select: { id: true },
    })
  },

  /**
   * Check if targetId is a descendant of ancestorId (recursive).
   * Used to prevent circular parent references.
   */
  async isDescendant(ancestorId: string, targetId: string): Promise<boolean> {
    const children = await prisma.task.findMany({
      where: { parentTaskId: ancestorId },
      select: { id: true },
    })
    for (const child of children) {
      if (child.id === targetId) return true
      if (await this.isDescendant(child.id, targetId)) return true
    }
    return false
  },

  /**
   * Find task status by ID (lightweight query for state machine).
   */
  async findStatus(id: string) {
    return prisma.task.findUnique({
      where: { id },
      select: { status: true },
    })
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/repositories/task.repository.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Add tests for `isDescendant`**

Add to `__tests__/lib/repositories/task.repository.test.ts`:

```typescript
describe('taskRepository.isDescendant', () => {
  it('returns true when target is direct child', async () => {
    mockFindMany.mockResolvedValueOnce([{ id: 'child-1' }, { id: 'child-2' }])

    const result = await taskRepository.isDescendant('parent', 'child-2')

    expect(result).toBe(true)
  })

  it('returns true when target is nested descendant', async () => {
    // First call: children of 'parent'
    mockFindMany.mockResolvedValueOnce([{ id: 'child-1' }])
    // Second call: children of 'child-1'
    mockFindMany.mockResolvedValueOnce([{ id: 'grandchild-1' }])

    const result = await taskRepository.isDescendant('parent', 'grandchild-1')

    expect(result).toBe(true)
  })

  it('returns false when target is not a descendant', async () => {
    mockFindMany.mockResolvedValueOnce([{ id: 'child-1' }])
    mockFindMany.mockResolvedValueOnce([]) // child-1 has no children

    const result = await taskRepository.isDescendant('parent', 'unrelated')

    expect(result).toBe(false)
  })

  it('returns false when parent has no children', async () => {
    mockFindMany.mockResolvedValueOnce([])

    const result = await taskRepository.isDescendant('parent', 'target')

    expect(result).toBe(false)
  })
})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest __tests__/lib/repositories/task.repository.test.ts --no-coverage`
Expected: PASS (all 6 tests)

- [ ] **Step 7: Create repository index**

```typescript
// lib/repositories/index.ts
export { taskRepository } from './task.repository'
```

- [ ] **Step 8: Commit**

```bash
git add lib/repositories/task.repository.ts lib/repositories/index.ts __tests__/lib/repositories/task.repository.test.ts
git commit -m "feat: add TaskRepository with data access layer [LUM-0]"
```

---

### Task 2: Create PullRequestRepository

**Files:**

- Create: `lib/repositories/pull-request.repository.ts`
- Create: `__tests__/lib/repositories/pull-request.repository.test.ts`
- Modify: `lib/repositories/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/repositories/pull-request.repository.test.ts
/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    pullRequest: {
      update: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

const mockUpdate = prisma.pullRequest.update as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('pullRequestRepository.updateState', () => {
  it('updates PR state and timestamps', async () => {
    const mergedAt = new Date('2026-04-07T10:00:00Z')
    mockUpdate.mockResolvedValue({ id: 'pr-1', state: 'merged' })

    await pullRequestRepository.updateState('pr-1', {
      state: 'merged',
      mergedAt,
      closedAt: null,
      isDraft: false,
    })

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'pr-1' },
      data: { state: 'merged', mergedAt, closedAt: null, isDraft: false },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/repositories/pull-request.repository.test.ts --no-coverage`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write implementation**

```typescript
// lib/repositories/pull-request.repository.ts
import { prisma } from '@/lib/db/prisma'

interface PrStateUpdate {
  state: string
  mergedAt: Date | null
  closedAt: Date | null
  isDraft: boolean
}

export const pullRequestRepository = {
  async updateState(id: string, data: PrStateUpdate) {
    return prisma.pullRequest.update({
      where: { id },
      data,
    })
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/repositories/pull-request.repository.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Update index**

```typescript
// lib/repositories/index.ts
export { taskRepository } from './task.repository'
export { pullRequestRepository } from './pull-request.repository'
```

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/pull-request.repository.ts lib/repositories/index.ts __tests__/lib/repositories/pull-request.repository.test.ts
git commit -m "feat: add PullRequestRepository [LUM-0]"
```

---

### Task 3: Create CommentRepository

**Files:**

- Create: `lib/repositories/comment.repository.ts`
- Create: `__tests__/lib/repositories/comment.repository.test.ts`
- Modify: `lib/repositories/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/repositories/comment.repository.test.ts
/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    comment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    notification: {
      createMany: jest.fn(),
    },
    workspaceMember: {
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { commentRepository } from '@/lib/repositories/comment.repository'

const mockFindMany = prisma.comment.findMany as jest.Mock
const mockFindUnique = prisma.comment.findUnique as jest.Mock
const mockCreate = prisma.comment.create as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('commentRepository.findByTaskId', () => {
  it('returns top-level comments with replies', async () => {
    const mockComments = [
      { id: 'c1', body: 'Hello', replies: [{ id: 'r1', body: 'Reply' }] },
    ]
    mockFindMany.mockResolvedValue(mockComments)

    const result = await commentRepository.findByTaskId('task-1')

    expect(result).toEqual(mockComments)
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { taskId: 'task-1', parentId: null },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    })
  })
})

describe('commentRepository.findById', () => {
  it('returns comment when found', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'c1',
      taskId: 'task-1',
      parentId: null,
    })

    const result = await commentRepository.findById('c1')

    expect(result).toEqual({ id: 'c1', taskId: 'task-1', parentId: null })
  })
})

describe('commentRepository.create', () => {
  it('creates comment with all fields', async () => {
    const input = {
      taskId: 'task-1',
      authorActorId: 'actor-1',
      body: 'Test comment',
      parentId: null,
      quotedCommentId: null,
    }
    mockCreate.mockResolvedValue({ id: 'c1', ...input })

    const result = await commentRepository.create(input)

    expect(result).toEqual({ id: 'c1', ...input })
    expect(mockCreate).toHaveBeenCalledWith({ data: input })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/repositories/comment.repository.test.ts --no-coverage`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write implementation**

```typescript
// lib/repositories/comment.repository.ts
import { prisma } from '@/lib/db/prisma'

interface CreateCommentData {
  taskId: string
  authorActorId: string
  body: string
  parentId: string | null
  quotedCommentId: string | null
}

export const commentRepository = {
  async findByTaskId(taskId: string) {
    return prisma.comment.findMany({
      where: { taskId, parentId: null },
      include: { replies: { orderBy: { createdAt: 'asc' as const } } },
      orderBy: { createdAt: 'asc' as const },
    })
  },

  async findById(id: string) {
    return prisma.comment.findUnique({ where: { id } })
  },

  async create(data: CreateCommentData) {
    return prisma.comment.create({ data })
  },
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/repositories/comment.repository.test.ts --no-coverage`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Update index**

```typescript
// lib/repositories/index.ts
export { taskRepository } from './task.repository'
export { pullRequestRepository } from './pull-request.repository'
export { commentRepository } from './comment.repository'
```

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/comment.repository.ts lib/repositories/index.ts __tests__/lib/repositories/comment.repository.test.ts
git commit -m "feat: add CommentRepository [LUM-0]"
```

---

### Task 4: Create TaskService

**Files:**

- Create: `lib/services/task.service.ts`
- Create: `__tests__/lib/services/task.service.test.ts`
- Create: `lib/services/index.ts`

- [ ] **Step 1: Write the failing test for `getTaskDetail`**

```typescript
// __tests__/lib/services/task.service.test.ts
/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findById: jest.fn(),
    findForUpdate: jest.fn(),
    findWithProject: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    isDescendant: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    updateState: jest.fn(),
  },
}))

jest.mock('@/lib/github/auth', () => ({
  getGithubInstallationToken: jest.fn(),
}))

jest.mock('@/lib/task/state-machine', () => ({
  isValidTaskTransition: jest.fn(),
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    actor: { findUnique: jest.fn() },
    project: { findUnique: jest.fn() },
  },
}))

import { taskRepository } from '@/lib/repositories/task.repository'
import { taskService } from '@/lib/services/task.service'
import { isValidTaskTransition } from '@/lib/task/state-machine'

const mockFindById = taskRepository.findById as jest.Mock
const mockFindForUpdate = taskRepository.findForUpdate as jest.Mock
const mockUpdate = taskRepository.update as jest.Mock
const mockIsDescendant = taskRepository.isDescendant as jest.Mock
const mockIsValidTransition = isValidTaskTransition as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskService.getTaskDetail', () => {
  it('returns task detail when found and authorized', async () => {
    const mockTask = {
      id: 'task-1',
      title: 'Test',
      status: 'TODO',
      project: { id: 'proj-1', workspaceId: 'ws-1' },
      team: { identifier: 'LUM' },
      pullRequests: [],
      parent: null,
    }
    mockFindById.mockResolvedValue(mockTask)

    const result = await taskService.getTaskDetail('task-1')

    expect(result).toBeDefined()
    expect(result!.id).toBe('task-1')
    expect(result!.teamIdentifier).toBe('LUM')
  })

  it('returns null when task not found', async () => {
    mockFindById.mockResolvedValue(null)

    const result = await taskService.getTaskDetail('nonexistent')

    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/services/task.service.test.ts --no-coverage`
Expected: FAIL with "Cannot find module '@/lib/services/task.service'"

- [ ] **Step 3: Write `getTaskDetail` implementation**

```typescript
// lib/services/task.service.ts
import { prisma } from '@/lib/db/prisma'
import { taskRepository } from '@/lib/repositories/task.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { getGithubInstallationToken } from '@/lib/github/auth'
import {
  isValidTaskTransition,
  type TaskStatusValue,
} from '@/lib/task/state-machine'

// ── Types ───────────────────────────────────────────────────────────────────

interface PrStatusUpdate {
  state: string
  mergedAt: Date | null
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  spec?: string
  status?: string
  priority?: string
  order?: number
  dueDate?: string
  parentTaskId?: string | null
  assigneeActorId?: string | null
  reviewerActorId?: string | null
  projectId?: string
  repositoryId?: string | null
}

export interface TaskUpdateResult {
  task: Record<string, unknown>
  changedFields: string[]
  oldStatus: string
  oldAssigneeActorId: string | null
}

// ── PR Sync (private) ───────────────────────────────────────────────────────

async function syncPullRequestStatus(
  openPrs: { id: string; number: number; url: string; state: string }[]
): Promise<Map<string, PrStatusUpdate>> {
  const updates = new Map<string, PrStatusUpdate>()
  try {
    const token = await getGithubInstallationToken()

    for (const pr of openPrs) {
      const match = pr.url.match(/github\.com\/([^/]+\/[^/]+)\/pull/)
      if (!match) continue
      const repo = match[1]

      const res = await fetch(
        `https://api.github.com/repos/${repo}/pulls/${pr.number}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      )
      if (!res.ok) continue

      const ghPr = (await res.json()) as {
        state: string
        merged: boolean
        merged_at: string | null
        closed_at: string | null
        draft: boolean
      }

      const newState = ghPr.merged
        ? 'merged'
        : ghPr.state === 'closed'
          ? 'closed'
          : 'open'

      if (newState === pr.state) continue

      const mergedAt = ghPr.merged_at ? new Date(ghPr.merged_at) : null

      await pullRequestRepository.updateState(pr.id, {
        state: newState,
        mergedAt,
        closedAt: ghPr.closed_at ? new Date(ghPr.closed_at) : null,
        isDraft: ghPr.draft,
      })

      updates.set(pr.id, { state: newState, mergedAt })
    }
  } catch (err) {
    console.error('[sync-pr] Failed to sync PR status:', err)
  }
  return updates
}

// ── Task Service ────────────────────────────────────────────────────────────

export const taskService = {
  /**
   * Get full task detail with PR status sync.
   * Returns null if task not found.
   */
  async getTaskDetail(taskId: string) {
    const task = await taskRepository.findById(taskId)
    if (!task) return null

    // Sync PR status from GitHub
    const openPrs = task.pullRequests.filter(pr => pr.state === 'open')
    let taskStatus = task.status
    let pullRequests = task.pullRequests

    if (openPrs.length > 0) {
      const updates = await syncPullRequestStatus(openPrs)
      if (updates.size > 0) {
        pullRequests = task.pullRequests.map(pr => {
          const update = updates.get(pr.id)
          return update
            ? { ...pr, state: update.state, mergedAt: update.mergedAt }
            : pr
        })
        if ([...updates.values()].some(u => u.state === 'merged')) {
          taskStatus = 'DONE'
        }
      }
    }

    return {
      ...task,
      status: taskStatus,
      pullRequests,
      teamIdentifier: task.team.identifier,
      parent: task.parent
        ? {
            id: task.parent.id,
            title: task.parent.title,
            number: task.parent.number,
            teamIdentifier: task.parent.team.identifier,
          }
        : null,
    }
  },

  /**
   * Update a task with validation.
   * Returns the updated task and metadata for notification dispatch.
   * Throws on validation errors with { status, error } shape.
   */
  async updateTask(
    taskId: string,
    input: UpdateTaskInput
  ): Promise<TaskUpdateResult> {
    const task = await taskRepository.findForUpdate(taskId)
    if (!task) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }

    const {
      parentTaskId,
      assigneeActorId,
      reviewerActorId,
      projectId,
      repositoryId,
      ...rest
    } = input

    // Validate status transition
    if (rest.status !== undefined && rest.status !== task.status) {
      if (
        !isValidTaskTransition(
          task.status as TaskStatusValue,
          rest.status as TaskStatusValue
        )
      ) {
        throw Object.assign(
          new Error(
            `Invalid status transition: ${task.status} → ${rest.status}`
          ),
          { status: 409 }
        )
      }
    }

    // Validate parent task
    if (parentTaskId !== undefined) {
      if (parentTaskId !== null) {
        if (parentTaskId === taskId) {
          throw Object.assign(new Error('A task cannot be its own parent'), {
            status: 400,
          })
        }
        const parent = await prisma.task.findUnique({
          where: { id: parentTaskId },
        })
        if (!parent || parent.projectId !== task.projectId) {
          throw Object.assign(
            new Error('Parent task not found in this project'),
            { status: 400 }
          )
        }
        if (await taskRepository.isDescendant(taskId, parentTaskId)) {
          throw Object.assign(
            new Error('Cannot create circular parent reference'),
            { status: 400 }
          )
        }
      }
    }

    // Validate project
    if (projectId !== undefined) {
      const newProject = await prisma.project.findUnique({
        where: { id: projectId },
      })
      if (!newProject || newProject.workspaceId !== task.project.workspaceId) {
        throw Object.assign(new Error('Project not found in this workspace'), {
          status: 400,
        })
      }
    }

    // Validate assignee
    let newAssigneeType: 'HUMAN' | 'AGENT' | null = null
    if (assigneeActorId !== undefined && assigneeActorId !== null) {
      const actor = await prisma.actor.findUnique({
        where: { id: assigneeActorId },
        select: { type: true, workspaceId: true },
      })
      if (!actor || actor.workspaceId !== task.project.workspaceId) {
        throw Object.assign(
          new Error('Assignee is not part of this workspace'),
          { status: 400 }
        )
      }
      newAssigneeType = actor.type as 'HUMAN' | 'AGENT'
    }

    // Validate reviewer
    if (reviewerActorId !== undefined && reviewerActorId !== null) {
      const actor = await prisma.actor.findUnique({
        where: { id: reviewerActorId },
      })
      if (!actor || actor.workspaceId !== task.project.workspaceId) {
        throw Object.assign(
          new Error('Reviewer is not part of this workspace'),
          { status: 400 }
        )
      }
    }

    // Build update data
    const data: Record<string, unknown> = {}
    if (rest.title !== undefined) data.title = rest.title
    if (rest.description !== undefined) data.description = rest.description
    if (rest.spec !== undefined) data.spec = rest.spec
    if (rest.status !== undefined) data.status = rest.status
    if (rest.priority !== undefined) data.priority = rest.priority
    if (rest.order !== undefined) data.order = rest.order
    if (rest.dueDate !== undefined) data.dueDate = rest.dueDate
    if (parentTaskId !== undefined) data.parentTaskId = parentTaskId
    if (assigneeActorId !== undefined) {
      data.assigneeActorId = assigneeActorId
      if (newAssigneeType === 'AGENT') {
        data.agentStatus = 'SUBMITTED'
        data.agentError = null
      } else {
        data.agentStatus = null
        data.agentError = null
      }
    }
    if (reviewerActorId !== undefined) data.reviewerActorId = reviewerActorId
    if (projectId !== undefined) data.projectId = projectId
    if (repositoryId !== undefined) data.repositoryId = repositoryId

    const updated = await taskRepository.update(taskId, data)

    return {
      task: { ...updated, teamIdentifier: updated.team.identifier },
      changedFields: Object.keys(data),
      oldStatus: task.status,
      oldAssigneeActorId: task.assigneeActorId ?? null,
    }
  },

  /**
   * Delete a task.
   * Returns the task's project info (for auth check by caller).
   */
  async deleteTask(taskId: string) {
    const task = await taskRepository.findWithProject(taskId)
    if (!task) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }

    await taskRepository.delete(taskId)

    return { workspaceId: task.project.workspaceId }
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/services/task.service.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Add test for `updateTask` validation**

Add to `__tests__/lib/services/task.service.test.ts`:

```typescript
describe('taskService.updateTask', () => {
  it('throws 404 when task not found', async () => {
    mockFindForUpdate.mockResolvedValue(null)

    await expect(
      taskService.updateTask('nonexistent', { title: 'New' })
    ).rejects.toMatchObject({ message: 'Task not found', status: 404 })
  })

  it('throws 409 for invalid status transition', async () => {
    mockFindForUpdate.mockResolvedValue({
      id: 'task-1',
      status: 'DONE',
      project: { workspaceId: 'ws-1' },
      assigneeActorId: null,
    })
    mockIsValidTransition.mockReturnValue(false)

    await expect(
      taskService.updateTask('task-1', { status: 'IN_REVIEW' })
    ).rejects.toMatchObject({ status: 409 })
  })

  it('throws 400 for self-parent', async () => {
    mockFindForUpdate.mockResolvedValue({
      id: 'task-1',
      status: 'TODO',
      projectId: 'proj-1',
      project: { workspaceId: 'ws-1' },
      assigneeActorId: null,
    })

    await expect(
      taskService.updateTask('task-1', { parentTaskId: 'task-1' })
    ).rejects.toMatchObject({
      message: 'A task cannot be its own parent',
      status: 400,
    })
  })

  it('updates task successfully with valid data', async () => {
    mockFindForUpdate.mockResolvedValue({
      id: 'task-1',
      status: 'TODO',
      project: { workspaceId: 'ws-1' },
      assigneeActorId: null,
    })
    mockIsValidTransition.mockReturnValue(true)
    mockUpdate.mockResolvedValue({
      id: 'task-1',
      title: 'Updated',
      status: 'IN_PROGRESS',
      projectId: 'proj-1',
      project: { id: 'proj-1', name: 'Project' },
      team: { identifier: 'LUM' },
    })

    const result = await taskService.updateTask('task-1', {
      title: 'Updated',
      status: 'IN_PROGRESS',
    })

    expect(result.task).toMatchObject({
      title: 'Updated',
      teamIdentifier: 'LUM',
    })
    expect(result.changedFields).toContain('title')
    expect(result.changedFields).toContain('status')
    expect(result.oldStatus).toBe('TODO')
  })
})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest __tests__/lib/services/task.service.test.ts --no-coverage`
Expected: PASS (all 6 tests)

- [ ] **Step 7: Create service index**

```typescript
// lib/services/index.ts
export { taskService } from './task.service'
export type { UpdateTaskInput, TaskUpdateResult } from './task.service'
```

- [ ] **Step 8: Commit**

```bash
git add lib/services/task.service.ts lib/services/index.ts __tests__/lib/services/task.service.test.ts
git commit -m "feat: add TaskService with business logic layer [LUM-0]"
```

---

### Task 5: Create CommentService

**Files:**

- Create: `lib/services/comment.service.ts`
- Create: `__tests__/lib/services/comment.service.test.ts`
- Modify: `lib/services/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/services/comment.service.test.ts
/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/comment.repository', () => ({
  commentRepository: {
    findByTaskId: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
  },
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn() },
    workspaceMember: { findMany: jest.fn() },
    notification: { createMany: jest.fn() },
  },
}))

jest.mock('@/lib/actor', () => ({
  getHumanActorId: jest.fn(),
}))

import { commentRepository } from '@/lib/repositories/comment.repository'
import { commentService } from '@/lib/services/comment.service'

const mockFindByTaskId = commentRepository.findByTaskId as jest.Mock
const mockFindById = commentRepository.findById as jest.Mock
const mockCreate = commentRepository.create as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('commentService.getComments', () => {
  it('returns comments for task', async () => {
    const mockComments = [{ id: 'c1', body: 'Hello', replies: [] }]
    mockFindByTaskId.mockResolvedValue(mockComments)

    const result = await commentService.getComments('task-1')

    expect(result).toEqual(mockComments)
    expect(mockFindByTaskId).toHaveBeenCalledWith('task-1')
  })
})

describe('commentService.createComment', () => {
  it('creates a top-level comment', async () => {
    const mockComment = {
      id: 'c1',
      taskId: 'task-1',
      authorActorId: 'actor-1',
      body: 'Hello',
      parentId: null,
      quotedCommentId: null,
    }
    mockCreate.mockResolvedValue(mockComment)

    const result = await commentService.createComment({
      taskId: 'task-1',
      authorActorId: 'actor-1',
      body: 'Hello',
      parentId: null,
      quotedCommentId: null,
    })

    expect(result).toEqual(mockComment)
  })

  it('throws 404 when parent comment not found', async () => {
    mockFindById.mockResolvedValue(null)

    await expect(
      commentService.createComment({
        taskId: 'task-1',
        authorActorId: 'actor-1',
        body: 'Reply',
        parentId: 'nonexistent',
        quotedCommentId: null,
      })
    ).rejects.toMatchObject({
      message: 'Parent comment not found',
      status: 404,
    })
  })

  it('throws 400 when replying to a reply', async () => {
    mockFindById.mockResolvedValue({
      id: 'c1',
      taskId: 'task-1',
      parentId: 'c0', // c1 is itself a reply
    })

    await expect(
      commentService.createComment({
        taskId: 'task-1',
        authorActorId: 'actor-1',
        body: 'Nested reply',
        parentId: 'c1',
        quotedCommentId: null,
      })
    ).rejects.toMatchObject({
      message: 'Cannot reply to a reply',
      status: 400,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/services/comment.service.test.ts --no-coverage`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write implementation**

```typescript
// lib/services/comment.service.ts
import { commentRepository } from '@/lib/repositories/comment.repository'

interface CreateCommentInput {
  taskId: string
  authorActorId: string
  body: string
  parentId: string | null
  quotedCommentId: string | null
}

export const commentService = {
  /**
   * Get all top-level comments with replies for a task.
   */
  async getComments(taskId: string) {
    return commentRepository.findByTaskId(taskId)
  },

  /**
   * Create a comment or reply with validation.
   * Throws on validation errors with { status, message }.
   */
  async createComment(input: CreateCommentInput) {
    // Validate parent comment if replying
    if (input.parentId) {
      const parent = await commentRepository.findById(input.parentId)
      if (!parent || parent.taskId !== input.taskId) {
        throw Object.assign(new Error('Parent comment not found'), {
          status: 404,
        })
      }
      if (parent.parentId !== null) {
        throw Object.assign(new Error('Cannot reply to a reply'), {
          status: 400,
        })
      }
    }

    return commentRepository.create(input)
  },

  /**
   * Parse @mention clerkIds from comment body HTML.
   * Excludes the author's clerkId and the __agent__ pseudo-ID.
   */
  parseMentionedClerkIds(body: string, authorClerkId: string): string[] {
    const mentionRegex = /data-type="mention"[^>]*data-id="([^"]+)"/g
    const ids: string[] = []
    let match: RegExpExecArray | null
    while ((match = mentionRegex.exec(body)) !== null) {
      const clerkId = match[1]
      if (
        clerkId &&
        clerkId !== authorClerkId &&
        clerkId !== '__agent__' &&
        !ids.includes(clerkId)
      ) {
        ids.push(clerkId)
      }
    }
    return ids
  },

  /**
   * Check if comment body contains an @agent mention.
   */
  hasAgentMention(body: string): boolean {
    return body.includes('data-id="__agent__"')
  },
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/services/comment.service.test.ts --no-coverage`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Add tests for mention parsing**

Add to `__tests__/lib/services/comment.service.test.ts`:

```typescript
describe('commentService.parseMentionedClerkIds', () => {
  it('extracts unique clerkIds from mention chips', () => {
    const body =
      '<span data-type="mention" data-id="user-1">@Alice</span> and <span data-type="mention" data-id="user-2">@Bob</span>'

    const result = commentService.parseMentionedClerkIds(body, 'author-id')

    expect(result).toEqual(['user-1', 'user-2'])
  })

  it('excludes the author clerkId', () => {
    const body = '<span data-type="mention" data-id="author-id">@Me</span>'

    const result = commentService.parseMentionedClerkIds(body, 'author-id')

    expect(result).toEqual([])
  })

  it('excludes __agent__ pseudo-ID', () => {
    const body = '<span data-type="mention" data-id="__agent__">@Agent</span>'

    const result = commentService.parseMentionedClerkIds(body, 'user-1')

    expect(result).toEqual([])
  })

  it('deduplicates clerkIds', () => {
    const body =
      '<span data-type="mention" data-id="user-1">@A</span> <span data-type="mention" data-id="user-1">@A</span>'

    const result = commentService.parseMentionedClerkIds(body, 'author')

    expect(result).toEqual(['user-1'])
  })
})

describe('commentService.hasAgentMention', () => {
  it('returns true when body contains agent mention', () => {
    const body = '<span data-type="mention" data-id="__agent__">@Agent</span>'
    expect(commentService.hasAgentMention(body)).toBe(true)
  })

  it('returns false when no agent mention', () => {
    const body = '<span data-type="mention" data-id="user-1">@Alice</span>'
    expect(commentService.hasAgentMention(body)).toBe(false)
  })
})
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `npx jest __tests__/lib/services/comment.service.test.ts --no-coverage`
Expected: PASS (all 8 tests)

- [ ] **Step 7: Update service index**

```typescript
// lib/services/index.ts
export { taskService } from './task.service'
export type { UpdateTaskInput, TaskUpdateResult } from './task.service'
export { commentService } from './comment.service'
```

- [ ] **Step 8: Commit**

```bash
git add lib/services/comment.service.ts lib/services/index.ts __tests__/lib/services/comment.service.test.ts
git commit -m "feat: add CommentService with validation [LUM-0]"
```

---

### Task 6: Refactor Task API Route — GET

**Files:**

- Modify: `app/api/tasks/[id]/route.ts`

- [ ] **Step 1: Replace GET handler with service call**

Replace the GET handler (lines 44-207) in `app/api/tasks/[id]/route.ts` with:

```typescript
import { taskService } from '@/lib/services'

/**
 * GET /api/tasks/[id] — Fetch a single task with full details.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const taskDetail = await taskService.getTaskDetail(id)
    if (!taskDetail) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      taskDetail.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    return NextResponse.json({ task: taskDetail })
  } catch (error) {
    console.error('GET /api/tasks/[id] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Remove the old `syncPullRequestStatus` function and `PrStatusUpdate` interface**

Delete the standalone `syncPullRequestStatus` function (lines 218-276) and `PrStatusUpdate` interface (lines 209-212) from the route file — these now live in `taskService`.

- [ ] **Step 3: Remove the old `isDescendant` function**

Delete the `isDescendant` function (lines 24-39) from the route file — this now lives in `taskRepository`.

- [ ] **Step 4: Clean up unused imports**

Remove these imports that are no longer needed in the route file:

- `getGithubInstallationToken` (used by taskService internally)
- `prisma` (no longer used directly)

Add the new import:

- `import { taskService } from '@/lib/services'`

- [ ] **Step 5: Verify the app compiles**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add app/api/tasks/[id]/route.ts
git commit -m "refactor: slim down GET /api/tasks/[id] using TaskService [LUM-0]"
```

---

### Task 7: Refactor Task API Route — PATCH

**Files:**

- Modify: `app/api/tasks/[id]/route.ts`

- [ ] **Step 1: Replace PATCH handler with service call**

Replace the PATCH handler in `app/api/tasks/[id]/route.ts` with:

```typescript
/**
 * PATCH /api/tasks/[id] — Update a task.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    // Pre-check: load task for auth
    const taskCheck = await taskService.getTaskDetail(id)
    if (!taskCheck) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      taskCheck.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const body = await request.json()
    const parsed = updateTaskSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const result = await taskService.updateTask(id, parsed.data)

    // Push real-time events (fire-and-forget)
    waitUntil(
      Promise.all([
        pushTaskEvent(id, {
          type: 'task:updated',
          fields: result.changedFields,
        }),
        pushProjectEvent(result.task.projectId as string, {
          type: 'task:updated',
          taskId: id,
          fields: result.changedFields,
          patch: result.task,
        }),
      ])
    )

    // Notification side-effects (fire-and-forget)
    const triggerActorId = await getHumanActorId(memberResult.id)
    const ctx = buildTaskNotificationCtx(
      {
        ...taskCheck,
        assigneeActorId: result.oldAssigneeActorId,
      } as Parameters<typeof buildTaskNotificationCtx>[0],
      result.task as Parameters<typeof buildTaskNotificationCtx>[1],
      triggerActorId,
      userId
    )
    dispatchTaskUpdateNotifications({
      ctx,
      taskId: id,
      oldStatus: result.oldStatus,
      newStatus: parsed.data.status,
      oldAssigneeActorId: result.oldAssigneeActorId,
      newAssigneeActorId: parsed.data.assigneeActorId,
      updatedReviewerActorId: (result.task.reviewerActorId as string) ?? null,
      workspaceId: taskCheck.project.workspaceId,
      triggerActorId,
    })

    return NextResponse.json({ task: result.task })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error('PATCH /api/tasks/[id] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Verify the app compiles**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add app/api/tasks/[id]/route.ts
git commit -m "refactor: slim down PATCH /api/tasks/[id] using TaskService [LUM-0]"
```

---

### Task 8: Refactor Task API Route — DELETE

**Files:**

- Modify: `app/api/tasks/[id]/route.ts`

- [ ] **Step 1: Replace DELETE handler with service call**

Replace the DELETE handler with:

```typescript
/**
 * DELETE /api/tasks/[id] — Delete a task.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    // Load task for auth check before deleting
    const taskDetail = await taskService.getTaskDetail(id)
    if (!taskDetail) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      taskDetail.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    await taskService.deleteTask(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error('DELETE /api/tasks/[id] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Clean up all remaining unused imports**

The final `app/api/tasks/[id]/route.ts` imports should be:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { updateTaskSchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import {
  buildTaskNotificationCtx,
  dispatchTaskUpdateNotifications,
} from '@/lib/notifications/notifyTaskChange'
import { getHumanActorId } from '@/lib/actor'
import { pushTaskEvent, pushProjectEvent } from '@/lib/pusher/server'
import { taskService } from '@/lib/services'
```

- [ ] **Step 3: Verify the app compiles**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add app/api/tasks/[id]/route.ts
git commit -m "refactor: slim down DELETE /api/tasks/[id] using TaskService [LUM-0]"
```

---

### Task 9: Refactor Comment API Route

**Files:**

- Modify: `app/api/tasks/[id]/comments/route.ts`

- [ ] **Step 1: Replace GET handler**

Replace the GET handler in comments route:

```typescript
import { commentService } from '@/lib/services'

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await prisma.task.findUnique({
      where: { id },
      include: { project: { select: { workspaceId: true } } },
    })
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const comments = await commentService.getComments(id)

    return NextResponse.json({ comments })
  } catch (error) {
    console.error('GET /api/tasks/[id]/comments error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Replace POST handler**

Replace the POST handler. The notification logic stays in the route (it's an infrastructure concern that will move to the notification service in a future plan):

```typescript
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await prisma.task.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        number: true,
        title: true,
        team: { select: { identifier: true } },
        project: {
          select: {
            workspaceId: true,
            workspace: { select: { slug: true } },
          },
        },
      },
    })
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const authorActorId = await getHumanActorId(memberResult.id)
    if (!authorActorId) {
      return NextResponse.json({ error: 'Actor not found' }, { status: 500 })
    }

    const body = await request.json()
    const parsed = createCommentSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { body: commentBody, parentId, quotedCommentId } = parsed.data

    const comment = await commentService.createComment({
      taskId: id,
      authorActorId,
      body: commentBody,
      parentId: parentId ?? null,
      quotedCommentId: quotedCommentId ?? null,
    })

    // Push real-time comment event
    waitUntil(
      pushTaskEvent(id, { type: 'comment:created', commentId: comment.id })
    )

    // Handle @agent mention
    if (commentService.hasAgentMention(commentBody)) {
      const { handleAgentComment } = await import('@/lib/agent/comment-handler')
      waitUntil(
        handleAgentComment({
          taskId: id,
          commentId: comment.id,
          commentBody,
          actorClerkId: userId,
        }).catch(err =>
          console.error('[comment/@agent] handleAgentComment failed:', err)
        )
      )
    }

    // Fire-and-forget: @mention notifications
    const mentionedIds = commentService.parseMentionedClerkIds(
      commentBody,
      userId
    )

    if (mentionedIds.length > 0) {
      const workspaceId = task.project.workspaceId
      prisma.workspaceMember
        .findMany({
          where: { workspaceId, clerkId: { in: mentionedIds } },
          select: { clerkId: true, actor: { select: { id: true } } },
        })
        .then(async members => {
          if (members.length === 0) return
          const workspaceSlug = task.project.workspace?.slug ?? ''
          const mentionPayload = {
            taskId: id,
            taskTitle: task.title,
            commentBody: commentBody.replace(/<[^>]+>/g, '').slice(0, 200),
            taskUrl: buildTaskUrl(
              workspaceSlug,
              task.team?.identifier ?? '',
              task.number
            ),
          }

          const recipientActors = members
            .map(m => m.actor?.id)
            .filter((actorId): actorId is string => !!actorId)

          const [inAppAllowed, slackAllowed] = await Promise.all([
            shouldNotifyBatch(recipientActors, 'inApp', 'TASK_MENTIONED'),
            shouldNotifyBatch(recipientActors, 'slack', 'TASK_MENTIONED'),
          ])

          for (const m of members) {
            if (m.actor?.id && slackAllowed.has(m.actor.id)) {
              waitUntil(
                sendDMNotification(
                  workspaceId,
                  m.clerkId,
                  'comment_mention',
                  mentionPayload
                )
              )
            }
          }

          waitUntil(
            sendChannelNotification(
              workspaceId,
              'comment_mention',
              {
                ...mentionPayload,
                taskId: task.id,
                taskIdentifier: `${task.team?.identifier ?? ''}-${task.number}`,
              },
              task.projectId
            )
          )

          const inAppRecipients = recipientActors.filter(actorId =>
            inAppAllowed.has(actorId)
          )
          if (inAppRecipients.length === 0) return

          for (const m of members) {
            if (m.clerkId && m.actor?.id && inAppAllowed.has(m.actor.id)) {
              waitUntil(pushUserEvent(m.clerkId, { type: 'notification:new' }))
            }
          }
          return prisma.notification.createMany({
            data: inAppRecipients.map(recipientActorId => ({
              workspaceId,
              recipientActorId,
              type: 'TASK_MENTIONED' as const,
              taskId: id,
              commentId: comment.id,
              triggerActorId: authorActorId,
            })),
          })
        })
        .catch(err => console.error('[notify] TASK_MENTIONED failed:', err))
    }

    return NextResponse.json({ comment }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error('POST /api/tasks/[id]/comments error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 3: Update imports**

Add: `import { commentService } from '@/lib/services'`

- [ ] **Step 4: Verify the app compiles**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 5: Run all tests**

Run: `npx jest --no-coverage`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add app/api/tasks/[id]/comments/route.ts
git commit -m "refactor: use CommentService in comments route [LUM-0]"
```

---

### Task 10: Run Full Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npx jest --no-coverage`
Expected: All tests pass

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 3: Verify final file structure**

Run: `ls -la lib/repositories/ lib/services/`

Expected output should show:

```
lib/repositories/
├── comment.repository.ts
├── index.ts
├── pull-request.repository.ts
└── task.repository.ts

lib/services/
├── comment.service.ts
├── index.ts
└── task.service.ts
```

- [ ] **Step 4: Verify route file sizes reduced**

Run: `wc -l app/api/tasks/\[id\]/route.ts app/api/tasks/\[id\]/comments/route.ts`

Expected: Both files significantly reduced from original (534 → ~120, 262 → ~140)

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git status
# If there are remaining changes:
git add -A
git commit -m "chore: cleanup after repository/service refactoring [LUM-0]"
```
