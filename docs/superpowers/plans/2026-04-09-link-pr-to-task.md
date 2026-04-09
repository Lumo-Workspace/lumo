# Link PR to Task — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to manually link/unlink existing GitHub PRs to tasks via search or URL paste.

**Architecture:** Three new repository methods (search, findByRepoAndNumber, updateTaskId) → two new service methods (linkPullRequest, unlinkPullRequest) → three new API routes (link, unlink, search) → UI updates to TaskDetailSidebar with a LinkPrPopover component.

**Tech Stack:** Next.js API Routes, Prisma, Zod, React (shadcn/ui Popover + Command), existing `apiFetch` client.

---

## File Map

| Action | File                                                              | Responsibility                                                 |
| ------ | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| Modify | `lib/repositories/pull-request.repository.ts`                     | Add `searchByWorkspace`, `findByRepoAndNumber`, `updateTaskId` |
| Modify | `lib/validation/schemas.ts`                                       | Add `linkPullRequestSchema`, `searchPullRequestsSchema`        |
| Modify | `lib/services/task.service.ts`                                    | Add `linkPullRequest`, `unlinkPullRequest`                     |
| Create | `app/api/tasks/[id]/pull-requests/link/route.ts`                  | POST handler for linking                                       |
| Create | `app/api/tasks/[id]/pull-requests/[prId]/unlink/route.ts`         | POST handler for unlinking                                     |
| Create | `app/api/pull-requests/search/route.ts`                           | GET handler for PR search                                      |
| Modify | `app/workspace/[workspaceUrl]/constants.ts`                       | Add API route constants                                        |
| Modify | `lib/api-client/tasks.ts`                                         | Add `linkPr`, `unlinkPr`, `searchPrs` methods                  |
| Create | `app/workspace/[workspaceUrl]/components/LinkPrPopover.tsx`       | Search/URL input popover                                       |
| Modify | `app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx`   | Add link button + unlink button                                |
| Modify | `app/workspace/[workspaceUrl]/types.ts`                           | Add `ApiPullRequestSearchResult` type                          |
| Create | `__tests__/lib/repositories/pull-request.repository.link.test.ts` | Repository tests                                               |
| Create | `__tests__/lib/services/task.service.link-pr.test.ts`             | Service tests                                                  |

---

### Task 1: Repository Layer — PR Search & Link Queries

**Files:**

- Modify: `lib/repositories/pull-request.repository.ts`
- Test: `__tests__/lib/repositories/pull-request.repository.link.test.ts`

- [ ] **Step 1: Write failing tests for new repository methods**

Create `__tests__/lib/repositories/pull-request.repository.link.test.ts`:

```typescript
/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    pullRequest: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

const mockFindMany = prisma.pullRequest.findMany as jest.Mock
const mockFindUnique = prisma.pullRequest.findUnique as jest.Mock
const mockUpdate = prisma.pullRequest.update as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('pullRequestRepository.searchByWorkspace', () => {
  it('searches by PR number when query is numeric', async () => {
    mockFindMany.mockResolvedValue([])

    await pullRequestRepository.searchByWorkspace('ws-1', '42', 20)

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: 'ws-1',
          number: 42,
        }),
      })
    )
  })

  it('searches by title when query is non-numeric', async () => {
    mockFindMany.mockResolvedValue([])

    await pullRequestRepository.searchByWorkspace('ws-1', 'fix login', 20)

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: 'ws-1',
          title: { contains: 'fix login', mode: 'insensitive' },
        }),
      })
    )
  })

  it('respects limit parameter', async () => {
    mockFindMany.mockResolvedValue([])

    await pullRequestRepository.searchByWorkspace('ws-1', 'test', 5)

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 })
    )
  })
})

describe('pullRequestRepository.findByRepoAndNumber', () => {
  it('finds PR by compound key', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'pr-1',
      repo: 'org/repo',
      number: 42,
    })

    const result = await pullRequestRepository.findByRepoAndNumber(
      'org/repo',
      42
    )

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { repo_number: { repo: 'org/repo', number: 42 } },
      include: {
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
    expect(result).toEqual({ id: 'pr-1', repo: 'org/repo', number: 42 })
  })

  it('returns null when PR not found', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await pullRequestRepository.findByRepoAndNumber(
      'org/repo',
      999
    )

    expect(result).toBeNull()
  })
})

describe('pullRequestRepository.updateTaskId', () => {
  it('updates taskId on a PR', async () => {
    mockUpdate.mockResolvedValue({ id: 'pr-1', taskId: 'task-1' })

    await pullRequestRepository.updateTaskId('pr-1', 'task-1')

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'pr-1' },
      data: { taskId: 'task-1' },
    })
  })

  it('sets taskId to null for unlink', async () => {
    mockUpdate.mockResolvedValue({ id: 'pr-1', taskId: null })

    await pullRequestRepository.updateTaskId('pr-1', null)

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'pr-1' },
      data: { taskId: null },
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/repositories/pull-request.repository.link.test.ts --no-coverage`
Expected: FAIL — `pullRequestRepository.searchByWorkspace is not a function`

- [ ] **Step 3: Implement repository methods**

Add to `lib/repositories/pull-request.repository.ts`, inside the `pullRequestRepository` object:

```typescript
  /** Search PRs in a workspace by number or title. */
  async searchByWorkspace(workspaceId: string, query: string, limit: number) {
    const numericQuery = /^\d+$/.test(query) ? Number(query) : null

    return prisma.pullRequest.findMany({
      where: {
        workspaceId,
        ...(numericQuery !== null
          ? { number: numericQuery }
          : { title: { contains: query, mode: 'insensitive' as const } }),
      },
      select: {
        id: true,
        repo: true,
        number: true,
        title: true,
        url: true,
        state: true,
        ciStatus: true,
        authorLogin: true,
        headBranch: true,
        createdAt: true,
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            team: { select: { identifier: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  },

  /** Find a PR by repo + number compound key, with task info. */
  async findByRepoAndNumber(repo: string, number: number) {
    return prisma.pullRequest.findUnique({
      where: { repo_number: { repo, number } },
      include: {
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
  },

  /** Update the task association for a PR. Pass null to unlink. */
  async updateTaskId(prId: string, taskId: string | null) {
    return prisma.pullRequest.update({
      where: { id: prId },
      data: { taskId },
    })
  },
```

Also add `findMany` and `findUnique` to the existing mock at the top of the existing test file `__tests__/lib/repositories/pull-request.repository.test.ts` — update the mock to include the new Prisma methods:

```typescript
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    pullRequest: {
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/repositories/pull-request.repository.link.test.ts --no-coverage`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/pull-request.repository.ts __tests__/lib/repositories/pull-request.repository.link.test.ts __tests__/lib/repositories/pull-request.repository.test.ts
git commit -m "feat: add PR search and link repository methods [LUM-0]"
```

---

### Task 2: Validation Schemas

**Files:**

- Modify: `lib/validation/schemas.ts`

- [ ] **Step 1: Add Zod schemas to `lib/validation/schemas.ts`**

Add at the end of the file:

```typescript
// ── Pull Request Link ────────────────────────────────────────────────────────

export const linkPullRequestSchema = z
  .object({
    prId: z.string().min(1).optional(),
    url: z.string().url().optional(),
    force: z.boolean().default(false),
  })
  .refine(data => (data.prId ? !data.url : !!data.url), {
    message: 'Provide exactly one of prId or url',
  })

export const searchPullRequestsSchema = z.object({
  q: z.string().min(1).max(100),
  workspaceId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
```

- [ ] **Step 2: Commit**

```bash
git add lib/validation/schemas.ts
git commit -m "feat: add Zod schemas for PR link and search [LUM-0]"
```

---

### Task 3: Service Layer — Link & Unlink PR

**Files:**

- Modify: `lib/services/task.service.ts`
- Test: `__tests__/lib/services/task.service.link-pr.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/services/task.service.link-pr.test.ts`:

```typescript
/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findWithProject: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findByRepoAndNumber: jest.fn(),
    updateTaskId: jest.fn(),
    updateState: jest.fn(),
    findActivePr: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findIntegrationByRepo: jest.fn(),
  },
}))

jest.mock('@/lib/crypto', () => ({
  decrypt: jest.fn().mockReturnValue('fake-token'),
}))

jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: { findByTask: jest.fn().mockResolvedValue([]) },
}))

jest.mock('@/lib/github/auth', () => ({
  getGithubInstallationToken: jest.fn(),
}))

jest.mock('@/lib/task/state-machine', () => ({
  isValidTaskTransition: jest.fn(),
}))

import { taskRepository } from '@/lib/repositories/task.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { githubRepository } from '@/lib/repositories/github.repository'
import { taskService } from '@/lib/services/task.service'

const mockFindWithProject = taskRepository.findWithProject as jest.Mock
const mockFindByRepoAndNumber =
  pullRequestRepository.findByRepoAndNumber as jest.Mock
const mockUpdateTaskId = pullRequestRepository.updateTaskId as jest.Mock
const mockFindIntegrationByRepo =
  githubRepository.findIntegrationByRepo as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskService.linkPullRequest', () => {
  const taskWithProject = {
    id: 'task-1',
    project: { workspaceId: 'ws-1' },
  }

  beforeEach(() => {
    mockFindWithProject.mockResolvedValue(taskWithProject)
  })

  it('links PR by prId when PR has no existing task', async () => {
    mockFindByRepoAndNumber.mockResolvedValue(null) // not used for prId mode
    mockUpdateTaskId.mockResolvedValue({ id: 'pr-1', taskId: 'task-1' })

    // For prId mode, we need a different mock — the service will use
    // a direct prisma query. Let's mock it via the repository approach.
    // Actually the service will use pullRequestRepository.findByRepoAndNumber
    // only for URL mode. For prId mode it needs a findById-like method.
    // We'll adjust the test after implementing the service.
  })

  it('throws 404 when task not found', async () => {
    mockFindWithProject.mockResolvedValue(null)

    await expect(
      taskService.linkPullRequest('nonexistent', {
        url: 'https://github.com/org/repo/pull/1',
      })
    ).rejects.toMatchObject({ message: 'Task not found', status: 404 })
  })

  it('links PR by URL when PR exists locally', async () => {
    mockFindByRepoAndNumber.mockResolvedValue({
      id: 'pr-1',
      workspaceId: 'ws-1',
      taskId: null,
      task: null,
    })
    mockUpdateTaskId.mockResolvedValue({ id: 'pr-1', taskId: 'task-1' })

    const result = await taskService.linkPullRequest('task-1', {
      url: 'https://github.com/org/repo/pull/42',
    })

    expect(mockUpdateTaskId).toHaveBeenCalledWith('pr-1', 'task-1')
    expect(result).toEqual({ id: 'pr-1', taskId: 'task-1' })
  })

  it('returns conflict when PR is linked to another task and force is false', async () => {
    mockFindByRepoAndNumber.mockResolvedValue({
      id: 'pr-1',
      workspaceId: 'ws-1',
      taskId: 'task-other',
      task: {
        id: 'task-other',
        number: 45,
        title: 'Other task',
        team: { identifier: 'ENG' },
      },
    })

    await expect(
      taskService.linkPullRequest('task-1', {
        url: 'https://github.com/org/repo/pull/42',
        force: false,
      })
    ).rejects.toMatchObject({ status: 409 })
  })

  it('overwrites existing link when force is true', async () => {
    mockFindByRepoAndNumber.mockResolvedValue({
      id: 'pr-1',
      workspaceId: 'ws-1',
      taskId: 'task-other',
      task: {
        id: 'task-other',
        number: 45,
        title: 'Other',
        team: { identifier: 'ENG' },
      },
    })
    mockUpdateTaskId.mockResolvedValue({ id: 'pr-1', taskId: 'task-1' })

    const result = await taskService.linkPullRequest('task-1', {
      url: 'https://github.com/org/repo/pull/42',
      force: true,
    })

    expect(mockUpdateTaskId).toHaveBeenCalledWith('pr-1', 'task-1')
    expect(result).toEqual({ id: 'pr-1', taskId: 'task-1' })
  })

  it('throws 400 for invalid GitHub PR URL', async () => {
    await expect(
      taskService.linkPullRequest('task-1', {
        url: 'https://example.com/not-a-pr',
      })
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('taskService.unlinkPullRequest', () => {
  it('throws 404 when task not found', async () => {
    mockFindWithProject.mockResolvedValue(null)

    await expect(
      taskService.unlinkPullRequest('nonexistent', 'pr-1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 400 when PR is not linked to the given task', async () => {
    mockFindWithProject.mockResolvedValue({
      id: 'task-1',
      project: { workspaceId: 'ws-1' },
    })
    mockFindByRepoAndNumber.mockResolvedValue(null) // not used here
    // We need to mock a findById for the PR — will refine after implementation

    await expect(
      taskService.unlinkPullRequest('task-1', 'pr-wrong')
    ).rejects.toMatchObject({ status: 400 })
  })

  it('sets taskId to null on successful unlink', async () => {
    mockFindWithProject.mockResolvedValue({
      id: 'task-1',
      project: { workspaceId: 'ws-1' },
    })
    mockUpdateTaskId.mockResolvedValue({ id: 'pr-1', taskId: null })

    // This test will be refined once we know the exact mock shape
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/services/task.service.link-pr.test.ts --no-coverage`
Expected: FAIL — `taskService.linkPullRequest is not a function`

- [ ] **Step 3: Add `findById` to pull-request repository**

Add to `lib/repositories/pull-request.repository.ts`:

```typescript
  /** Find a PR by ID with task info. */
  async findById(id: string) {
    return prisma.pullRequest.findUnique({
      where: { id },
      include: {
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
  },
```

- [ ] **Step 4: Implement service methods**

Add to `lib/services/task.service.ts`.

First, add imports at the top:

```typescript
import { githubRepository } from '@/lib/repositories/github.repository'
import { decrypt } from '@/lib/crypto'
```

Then add these methods to the `taskService` object:

```typescript
  /**
   * Parse a GitHub PR URL into repo and number.
   * Accepts formats: https://github.com/owner/repo/pull/123
   */
  parsePrUrl(url: string): { repo: string; number: number } | null {
    const match = url.match(
      /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/
    )
    if (!match) return null
    return { repo: match[1]!, number: Number(match[2]) }
  },

  /**
   * Link a PR to a task.
   * Supports two modes: by prId (from search) or by URL (paste).
   */
  async linkPullRequest(
    taskId: string,
    input: { prId?: string; url?: string; force?: boolean }
  ) {
    const task = await taskRepository.findWithProject(taskId)
    if (!task) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }
    const workspaceId = task.project.workspaceId

    let pr: Awaited<ReturnType<typeof pullRequestRepository.findById>>

    if (input.prId) {
      // Mode 1: Link by PR ID
      pr = await pullRequestRepository.findById(input.prId)
      if (!pr) {
        throw Object.assign(new Error('Pull request not found'), { status: 404 })
      }
      if (pr.workspaceId !== workspaceId) {
        throw Object.assign(new Error('Pull request belongs to a different workspace'), { status: 403 })
      }
    } else if (input.url) {
      // Mode 2: Link by URL
      const parsed = this.parsePrUrl(input.url)
      if (!parsed) {
        throw Object.assign(new Error('Invalid GitHub PR URL'), { status: 400 })
      }

      // Check if PR exists locally
      const existing = await pullRequestRepository.findByRepoAndNumber(
        parsed.repo,
        parsed.number
      )

      if (existing) {
        if (existing.workspaceId !== workspaceId) {
          throw Object.assign(new Error('Pull request belongs to a different workspace'), { status: 403 })
        }
        pr = existing
      } else {
        // Fetch from GitHub and upsert
        const integration = await githubRepository.findIntegrationByRepo(
          workspaceId,
          parsed.repo
        )
        if (!integration) {
          throw Object.assign(
            new Error('GitHub integration not configured for this repository'),
            { status: 400 }
          )
        }

        const token = decrypt(integration.accessToken)
        const res = await fetch(
          `https://api.github.com/repos/${parsed.repo}/pulls/${parsed.number}`,
          {
            headers: {
              Authorization: `token ${token}`,
              Accept: 'application/vnd.github.v3+json',
            },
          }
        )
        if (!res.ok) {
          throw Object.assign(new Error('PR not found on GitHub'), { status: 404 })
        }

        const ghPr = (await res.json()) as {
          number: number
          title: string
          html_url: string
          state: string
          merged: boolean
          draft: boolean
          user: { login: string }
          head: { ref: string }
          base: { ref: string }
          merged_at: string | null
          closed_at: string | null
        }

        const state = ghPr.merged
          ? 'merged'
          : ghPr.state === 'closed'
            ? 'closed'
            : 'open'

        const upserted = await githubRepository.upsertPullRequest({
          workspaceId,
          taskId: null,
          integrationId: integration.id,
          repo: parsed.repo,
          number: ghPr.number,
          title: ghPr.title,
          url: ghPr.html_url,
          state,
          authorLogin: ghPr.user.login,
          headBranch: ghPr.head.ref,
          baseBranch: ghPr.base.ref,
          isDraft: ghPr.draft,
          mergedAt: ghPr.merged_at ? new Date(ghPr.merged_at) : null,
          closedAt: ghPr.closed_at ? new Date(ghPr.closed_at) : null,
        })

        // Wrap upserted in the shape expected (with task: null)
        pr = { ...upserted, workspaceId, task: null } as typeof pr
      }
    } else {
      throw Object.assign(new Error('Provide prId or url'), { status: 400 })
    }

    // Check for conflict
    if (pr!.taskId && pr!.taskId !== taskId && !input.force) {
      const conflictTask = pr!.task
      throw Object.assign(new Error('PR already linked to another task'), {
        status: 409,
        conflictTask: conflictTask
          ? {
              id: conflictTask.id,
              number: conflictTask.number,
              title: conflictTask.title,
              teamIdentifier: conflictTask.team.identifier,
            }
          : null,
      })
    }

    return pullRequestRepository.updateTaskId(pr!.id, taskId)
  },

  /**
   * Unlink a PR from a task.
   */
  async unlinkPullRequest(taskId: string, prId: string) {
    const task = await taskRepository.findWithProject(taskId)
    if (!task) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }

    const pr = await pullRequestRepository.findById(prId)
    if (!pr || pr.taskId !== taskId) {
      throw Object.assign(
        new Error('Pull request is not linked to this task'),
        { status: 400 }
      )
    }

    return pullRequestRepository.updateTaskId(prId, null)
  },
```

- [ ] **Step 5: Update tests to match actual implementation, then run**

Refine the test mocks (add `findById` mock to the pull-request repository mock, update test expectations to match the exact implementation). Then run:

Run: `npx jest __tests__/lib/services/task.service.link-pr.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 6: Run all existing tests to ensure nothing broke**

Run: `npx jest --no-coverage`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add lib/repositories/pull-request.repository.ts lib/services/task.service.ts __tests__/lib/services/task.service.link-pr.test.ts
git commit -m "feat: add linkPullRequest and unlinkPullRequest service methods [LUM-0]"
```

---

### Task 4: API Routes

**Files:**

- Create: `app/api/tasks/[id]/pull-requests/link/route.ts`
- Create: `app/api/tasks/[id]/pull-requests/[prId]/unlink/route.ts`
- Create: `app/api/pull-requests/search/route.ts`

- [ ] **Step 1: Create the link route**

Create `app/api/tasks/[id]/pull-requests/link/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { linkPullRequestSchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import { taskService } from '@/lib/services'
import { taskRepository } from '@/lib/repositories/task.repository'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/tasks/[id]/pull-requests/link — Link a PR to a task.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    // Auth check
    const task = await taskRepository.findWithProject(id)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const body = await request.json()
    const parsed = linkPullRequestSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const result = await taskService.linkPullRequest(id, parsed.data)

    return NextResponse.json({ pullRequest: result })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      const status = (error as Error & { status: number }).status
      const response: Record<string, unknown> = { error: error.message }
      if ('conflictTask' in error) {
        response.conflictTask = (
          error as Error & { conflictTask: unknown }
        ).conflictTask
      }
      return NextResponse.json(response, { status })
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Create the unlink route**

Create `app/api/tasks/[id]/pull-requests/[prId]/unlink/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskService } from '@/lib/services'
import { taskRepository } from '@/lib/repositories/task.repository'

type Params = { params: Promise<{ id: string; prId: string }> }

/**
 * POST /api/tasks/[id]/pull-requests/[prId]/unlink — Unlink a PR from a task.
 */
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id, prId } = await params

    // Auth check
    const task = await taskRepository.findWithProject(id)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    await taskService.unlinkPullRequest(id, prId)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 3: Create the search route**

Create `app/api/pull-requests/search/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { searchPullRequestsSchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

/**
 * GET /api/pull-requests/search?q=...&workspaceId=...&limit=20
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const { searchParams } = new URL(request.url)
    const parsed = searchPullRequestsSchema.safeParse({
      q: searchParams.get('q'),
      workspaceId: searchParams.get('workspaceId'),
      limit: searchParams.get('limit'),
    })
    if (!parsed.success) return zodError(parsed)

    // Verify user is a member of this workspace
    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws
    if (ws.workspace.id !== parsed.data.workspaceId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const results = await pullRequestRepository.searchByWorkspace(
      parsed.data.workspaceId,
      parsed.data.q,
      parsed.data.limit
    )

    return NextResponse.json({ pullRequests: results })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/tasks/[id]/pull-requests/link/route.ts app/api/tasks/[id]/pull-requests/\[prId\]/unlink/route.ts app/api/pull-requests/search/route.ts
git commit -m "feat: add API routes for PR link, unlink, and search [LUM-0]"
```

---

### Task 5: API Client & Constants

**Files:**

- Modify: `app/workspace/[workspaceUrl]/constants.ts`
- Modify: `lib/api-client/tasks.ts`
- Modify: `app/workspace/[workspaceUrl]/types.ts`

- [ ] **Step 1: Add route constants**

Add to `app/workspace/[workspaceUrl]/constants.ts` inside the `API` object:

```typescript
  pullRequests: {
    search: '/api/pull-requests/search',
    link: (taskId: string) => `/api/tasks/${taskId}/pull-requests/link`,
    unlink: (taskId: string, prId: string) =>
      `/api/tasks/${taskId}/pull-requests/${prId}/unlink`,
  },
```

- [ ] **Step 2: Add API client methods**

Add to `lib/api-client/tasks.ts` (also add `ApiClientError` to the import from `./base`):

```typescript
  searchPrs<T>(workspaceId: string, query: string, limit?: number) {
    const params = new URLSearchParams({ q: query, workspaceId })
    if (limit) params.set('limit', String(limit))
    return apiFetch<T>(`${API.pullRequests.search}?${params}`)
  },

  async linkPr(taskId: string, data: { prId?: string; url?: string; force?: boolean }) {
    const url = API.pullRequests.link(taskId)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const json = await res.json()
    if (!res.ok) {
      const err = new ApiClientError(json.error ?? 'Link failed', res.status)
      // Attach conflict info if present
      if (json.conflictTask) {
        ;(err as ApiClientError & { conflictTask: unknown }).conflictTask = json.conflictTask
      }
      throw err
    }
    return json
  },

  unlinkPr(taskId: string, prId: string) {
    return apiFetch<void>(API.pullRequests.unlink(taskId, prId), {
      method: 'POST',
    })
  },
```

Also add the `API` import for `pullRequests` — it's already imported from constants.

- [ ] **Step 3: Add search result type**

Add to `app/workspace/[workspaceUrl]/types.ts`:

```typescript
export interface ApiPullRequestSearchResult {
  id: string
  repo: string
  number: number
  title: string
  url: string
  state: string
  ciStatus: string | null
  authorLogin: string
  headBranch: string
  createdAt: string
  task: {
    id: string
    number: number
    title: string
    teamIdentifier: string
  } | null
}
```

- [ ] **Step 4: Commit**

```bash
git add app/workspace/[workspaceUrl]/constants.ts lib/api-client/tasks.ts app/workspace/[workspaceUrl]/types.ts
git commit -m "feat: add API client and types for PR link/unlink/search [LUM-0]"
```

---

### Task 6: UI — LinkPrPopover Component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/LinkPrPopover.tsx`

- [ ] **Step 1: Create the LinkPrPopover component**

Create `app/workspace/[workspaceUrl]/components/LinkPrPopover.tsx`:

```tsx
'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useIntl } from 'react-intl'
import { Plus, Search, Loader2 } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
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
import { PrStateBadge } from './pr-helpers'
import { tasksClient } from '@/lib/api-client/tasks'
import { ApiClientError } from '@/lib/api-client/base'
import type { ApiPullRequestSearchResult } from '../types'

interface LinkPrPopoverProps {
  taskId: string
  workspaceId: string
  onLinked: () => void
}

const GITHUB_PR_URL_RE = /github\.com\/[^/]+\/[^/]+\/pull\/\d+/

export function LinkPrPopover({
  taskId,
  workspaceId,
  onLinked,
}: LinkPrPopoverProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ApiPullRequestSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [linking, setLinking] = useState(false)
  const [conflict, setConflict] = useState<{
    prId?: string
    url?: string
    task: { number: number; title: string; teamIdentifier: string }
  } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when popover opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setQuery('')
      setResults([])
    }
  }, [open])

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([])
        return
      }
      setLoading(true)
      try {
        const data = await tasksClient.searchPrs<{
          pullRequests: ApiPullRequestSearchResult[]
        }>(workspaceId, q.trim(), 20)
        setResults(data.pullRequests)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    },
    [workspaceId]
  )

  const handleInputChange = (value: string) => {
    setQuery(value)

    if (debounceRef.current) clearTimeout(debounceRef.current)

    // If it looks like a GitHub PR URL, don't search — wait for Enter/submit
    if (GITHUB_PR_URL_RE.test(value)) {
      setResults([])
      return
    }

    debounceRef.current = setTimeout(() => doSearch(value), 300)
  }

  const linkPr = async (input: {
    prId?: string
    url?: string
    force?: boolean
  }) => {
    setLinking(true)
    try {
      await tasksClient.linkPr(taskId, input)
      setOpen(false)
      onLinked()
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        const conflictTask = (
          err as ApiClientError & {
            conflictTask?: {
              number: number
              title: string
              teamIdentifier: string
            }
          }
        ).conflictTask
        if (conflictTask) {
          setConflict({ prId: input.prId, url: input.url, task: conflictTask })
        }
      }
    } finally {
      setLinking(false)
    }
  }

  const handleSelect = (pr: ApiPullRequestSearchResult) => {
    linkPr({ prId: pr.id })
  }

  const handleSubmitUrl = () => {
    if (GITHUB_PR_URL_RE.test(query)) {
      linkPr({ url: query.trim() })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmitUrl()
    }
  }

  const handleForceLink = () => {
    if (!conflict) return
    linkPr({
      prId: conflict.prId,
      url: conflict.url,
      force: true,
    })
    setConflict(null)
  }

  const isUrlMode = GITHUB_PR_URL_RE.test(query)

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className='text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors'
            title='Link a pull request'
          >
            <Plus size={12} />
          </button>
        </PopoverTrigger>
        <PopoverContent className='w-80 p-0' align='start' side='bottom'>
          <div className='flex items-center gap-2 px-3 py-2 border-b border-zinc-100 dark:border-zinc-800'>
            <Search size={14} className='text-zinc-400 shrink-0' />
            <input
              ref={inputRef}
              type='text'
              value={query}
              onChange={e => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='Search PRs or paste GitHub URL...'
              className='flex-1 text-sm bg-transparent outline-none placeholder:text-zinc-400'
            />
            {(loading || linking) && (
              <Loader2
                size={14}
                className='text-zinc-400 animate-spin shrink-0'
              />
            )}
          </div>

          <div className='max-h-64 overflow-y-auto'>
            {isUrlMode && (
              <button
                onClick={handleSubmitUrl}
                disabled={linking}
                className='w-full text-left px-3 py-2 text-xs text-blue-600 dark:text-blue-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
              >
                Link PR from URL:{' '}
                {query.match(/pull\/(\d+)/)?.[1]
                  ? `#${query.match(/pull\/(\d+)/)![1]}`
                  : query}
              </button>
            )}

            {!isUrlMode && results.length === 0 && query.trim() && !loading && (
              <p className='px-3 py-4 text-xs text-zinc-400 text-center'>
                No pull requests found
              </p>
            )}

            {!isUrlMode &&
              results.map(pr => (
                <button
                  key={pr.id}
                  onClick={() => handleSelect(pr)}
                  disabled={linking}
                  className='w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 flex items-start gap-2'
                >
                  <div className='min-w-0 flex-1'>
                    <div className='text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate'>
                      <span className='text-zinc-400'>{pr.repo}</span> #
                      {pr.number} {pr.title}
                    </div>
                    <div className='flex items-center gap-1.5 mt-0.5'>
                      <PrStateBadge state={pr.state} />
                      {pr.task && (
                        <span className='text-[10px] text-zinc-400'>
                          Linked to {pr.task.teamIdentifier}-{pr.task.number}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </PopoverContent>
      </Popover>

      <AlertDialog
        open={conflict !== null}
        onOpenChange={open => !open && setConflict(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>PR already linked</AlertDialogTitle>
            <AlertDialogDescription>
              This PR is currently linked to{' '}
              <strong>
                {conflict?.task.teamIdentifier}-{conflict?.task.number}:{' '}
                {conflict?.task.title}
              </strong>
              . Link it to this task instead?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleForceLink}>
              Link to this task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/LinkPrPopover.tsx
git commit -m "feat: add LinkPrPopover component for searching and linking PRs [LUM-0]"
```

---

### Task 7: UI — Integrate into TaskDetailSidebar

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx`

- [ ] **Step 1: Add props and imports**

Add to the imports in `TaskDetailSidebar.tsx`:

```typescript
import { X } from 'lucide-react'
import { LinkPrPopover } from './LinkPrPopover'
```

Add two new props to `TaskDetailSidebarProps`:

```typescript
  workspaceId: string
  onUnlinkPr: (prId: string) => void
  onLinkPr: () => void
```

Add the new props to the function destructuring.

- [ ] **Step 2: Update the Pull Requests section**

Replace the Pull Requests section (the conditional `{task.pullRequests && task.pullRequests.length > 0 && (` block, lines 251–305) with:

```tsx
{
  /* ── Pull Requests ───────────────────────────────────────────── */
}
;<div className='pt-3 border-t border-zinc-100 dark:border-zinc-800'>
  <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5'>
    <GitPullRequest size={12} />
    Pull Requests
    <span className='ml-auto'>
      <LinkPrPopover
        taskId={task.id}
        workspaceId={workspaceId}
        onLinked={onLinkPr}
      />
    </span>
  </p>
  {task.pullRequests && task.pullRequests.length > 0 ? (
    <ul className='space-y-2.5'>
      {task.pullRequests.map(pr => {
        const relatedRun = task.agentRuns?.find(r => r.prNumber === pr.number)
        const runLabel = relatedRun ? `Session #${relatedRun.runNumber}` : null
        const runStatusLabel =
          relatedRun?.status === 'FAILED'
            ? ' · Failed'
            : relatedRun?.status === 'CANCELED'
              ? ' · Canceled'
              : relatedRun?.errorCode === 'TIMEOUT'
                ? ' · Timed out'
                : null

        return (
          <li key={pr.id} className='flex items-start gap-2 group'>
            <CiIcon status={pr.ciStatus} />
            <div className='min-w-0 flex-1'>
              <a
                href={pr.url}
                target='_blank'
                rel='noopener noreferrer'
                className='text-xs text-zinc-700 dark:text-zinc-300 hover:underline font-medium leading-snug block'
              >
                #{pr.number} {pr.title}
              </a>
              <div className='flex items-center gap-1.5 mt-1'>
                <PrStateBadge state={pr.state} />
                {runLabel && (
                  <span className='text-[10px] text-zinc-400'>
                    {runLabel}
                    {runStatusLabel && (
                      <span className='text-zinc-400'>{runStatusLabel}</span>
                    )}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => onUnlinkPr(pr.id)}
              className='shrink-0 opacity-0 group-hover:opacity-100 text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400 transition-all mt-0.5'
              title='Unlink PR'
            >
              <X size={12} />
            </button>
          </li>
        )
      })}
    </ul>
  ) : (
    <p className='text-xs text-zinc-400 italic'>No pull requests</p>
  )}
</div>
```

Key changes from original:

- PR section always renders (not only when `pullRequests.length > 0`)
- Section header includes `LinkPrPopover` with `+` button
- Each PR item has a hover `×` button calling `onUnlinkPr`
- Empty state shows "No pull requests" text

- [ ] **Step 3: Wire up props in parent component**

Find the parent that renders `TaskDetailSidebar` (likely `TaskDetailPage.tsx` or `TaskDetailPanel.tsx`) and pass the new props:

- `workspaceId` — from `task.project.workspaceId`
- `onUnlinkPr` — calls `tasksClient.unlinkPr(task.id, prId)` then refetches task
- `onLinkPr` — refetches task detail data

This step requires reading the parent component to find the exact integration point. The implementor should:

1. Read the parent component that renders `<TaskDetailSidebar>`
2. Add the `workspaceId` prop (likely already available via task or workspace context)
3. Add `onUnlinkPr` handler that calls the API client and triggers data refresh
4. Add `onLinkPr` handler that triggers data refresh

- [ ] **Step 4: Verify the UI works**

Run the dev server: `npm run dev`

- Navigate to a task detail page
- Verify the PR section shows with a `+` button
- Click `+` → popover opens with search input
- Type a search term → results appear after debounce
- Paste a GitHub PR URL → "Link PR from URL" button appears
- Hover over a PR → `×` unlink button appears

- [ ] **Step 5: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx app/workspace/[workspaceUrl]/components/LinkPrPopover.tsx
git commit -m "feat: integrate PR link/unlink UI into task detail sidebar [LUM-0]"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run all tests**

Run: `npx jest --no-coverage`
Expected: All tests pass

- [ ] **Step 2: Run TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run linter**

Run: `npx next lint`
Expected: No errors

- [ ] **Step 4: Commit any fixes**

If any test/type/lint issues were found and fixed:

```bash
git add -A
git commit -m "fix: address lint and type issues for PR link feature [LUM-0]"
```
