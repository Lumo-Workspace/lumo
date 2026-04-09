# Task Activities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete activity tracking system and unified timeline UI to Lumo tasks, recording all field changes, comments, Agent events, and Git/PR events.

**Architecture:** Extend the existing `lib/events/` domain event system with new task activity event types and a dedicated activity listener. Activity records are stored in the existing `TaskActivity` table (migrated from String type to enum). The timeline API merges activities and comments at query time, and the frontend renders a tabbed Activity/Comments view with mixed compact + card layout.

**Tech Stack:** Prisma (migration + repository), Next.js API routes, existing domain event dispatcher, Pusher realtime, React hooks + components, Jest tests.

---

## File Structure

### New Files

| File                                                                                       | Responsibility                                            |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `prisma/migrations/YYYYMMDD_task_activity_type_enum/migration.sql`                         | Migrate `type` from String to enum, add composite index   |
| `lib/events/types/task-activity.ts`                                                        | New activity event type definitions extending DomainEvent |
| `lib/events/handlers/record-activity.ts`                                                   | Activity listener — writes TaskActivity on domain events  |
| `lib/repositories/activity.repository.ts`                                                  | Prisma queries for TaskActivity (create, paginated find)  |
| `lib/services/timeline.service.ts`                                                         | Merge activities + comments into unified timeline         |
| `app/api/tasks/[id]/timeline/route.ts`                                                     | GET endpoint for paginated timeline                       |
| `lib/api-client/timeline.ts`                                                               | Frontend API client for timeline                          |
| `app/workspace/[workspaceUrl]/hooks/useTimeline.ts`                                        | Data fetching hook with pagination + Pusher               |
| `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineTabs.tsx`              | Tab switcher (Activity / Comments)                        |
| `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ActivityTimeline.tsx`          | Activity tab main body                                    |
| `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineEntryRenderer.tsx`     | Dispatch rendering by entry type                          |
| `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/CompactActivityItem.tsx` | Compact single-line activity                              |
| `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/CommentTimelineItem.tsx` | Comment card in timeline                                  |
| `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/AgentRunItem.tsx`        | Agent run card                                            |
| `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/PrItem.tsx`              | PR event card                                             |
| `__tests__/lib/repositories/activity.repository.test.ts`                                   | Repository tests                                          |
| `__tests__/lib/services/timeline.service.test.ts`                                          | Timeline merge logic tests                                |
| `__tests__/lib/events/handlers/record-activity.test.ts`                                    | Activity listener tests                                   |

### Modified Files

| File                                                               | Change                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `prisma/schema.prisma`                                             | Add `TaskActivityType` enum, change `TaskActivity.type` to enum, add composite index |
| `lib/events/types.ts`                                              | Import and re-export new activity event types into DomainEvent union                 |
| `lib/events/dispatcher.ts`                                         | Add dispatch cases for new event types                                               |
| `lib/events/handlers/index.ts`                                     | Register activity listener in handler registry                                       |
| `lib/repositories/index.ts`                                        | Export activityRepository                                                            |
| `lib/services/index.ts`                                            | Export timelineService                                                               |
| `lib/services/task.service.ts`                                     | Emit activity events from updateTask                                                 |
| `lib/services/comment.service.ts`                                  | Emit comment_added event                                                             |
| `app/api/tasks/[id]/route.ts`                                      | Dispatch activity events after task update                                           |
| `app/api/tasks/[id]/comments/route.ts`                             | Dispatch comment activity events                                                     |
| `lib/api-client/tasks.ts`                                          | Add timeline method                                                                  |
| `app/workspace/[workspaceUrl]/constants.ts`                        | Add timeline API URL constant                                                        |
| `lib/pusher/server.ts`                                             | Add `ActivityEvent` type and push function                                           |
| `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx` | Replace `TaskDetailComments` with `TimelineTabs`                                     |
| `app/workspace/[workspaceUrl]/types.ts`                            | Add timeline entry types                                                             |

---

## Task 1: Prisma Schema Migration

**Files:**

- Modify: `prisma/schema.prisma:438-451`
- Create: `prisma/migrations/YYYYMMDD_task_activity_type_enum/migration.sql`

- [ ] **Step 1: Write failing test — verify enum values exist in Prisma client**

```typescript
// __tests__/lib/repositories/activity.repository.test.ts
/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    taskActivity: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'

const mockCreate = prisma.taskActivity.create as jest.Mock
const mockFindMany = prisma.taskActivity.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('activityRepository', () => {
  // Placeholder — will be filled in Task 3
  it('placeholder', () => {
    expect(true).toBe(true)
  })
})
```

- [ ] **Step 2: Update Prisma schema — add enum and modify model**

In `prisma/schema.prisma`, add the `TaskActivityType` enum after the existing enums (after line ~93, after `ActorType`):

```prisma
enum TaskActivityType {
  TASK_CREATED
  STATUS_CHANGED
  PRIORITY_CHANGED
  ASSIGNEE_CHANGED
  REVIEWER_CHANGED
  TITLE_CHANGED
  DESCRIPTION_CHANGED
  DUE_DATE_CHANGED
  PARENT_CHANGED
  TAGS_CHANGED
  REPOSITORY_CHANGED
  COMMENT_ADDED
  COMMENT_DELETED
  SUBTASK_ADDED
  SUBTASK_REMOVED
  SPEC_GENERATED
  BRANCH_CREATED
  PR_LINKED
  PR_UNLINKED
  PR_CREATED
  PR_MERGED
  AGENT_RUN_STARTED
  AGENT_RUN_COMPLETED
  AGENT_RUN_FAILED
  AGENT_INPUT_REQUIRED
}
```

Modify the existing `TaskActivity` model (around line 438):

```prisma
model TaskActivity {
  id        String           @id @default(cuid())
  taskId    String
  actorId   String?
  type      TaskActivityType  // changed from String
  payload   Json?
  createdAt DateTime         @default(now())

  task  Task   @relation(fields: [taskId], references: [id], onDelete: Cascade)
  actor Actor? @relation(fields: [actorId], references: [id], onDelete: SetNull)

  @@index([taskId, createdAt])
  @@index([taskId])
  @@map("task_activities")
}
```

- [ ] **Step 3: Generate and run migration**

Run: `npx prisma migrate dev --name task_activity_type_enum`

This will:

1. Create a migration that adds the enum type
2. Convert the existing `type` column from String to enum
3. Add the composite index `[taskId, createdAt]`

Note: The existing `task_activities` table may have string data. The migration SQL needs to cast existing string values. If the table is empty, it's straightforward. If not, manually edit the migration to `ALTER TYPE` or recreate.

- [ ] **Step 4: Verify migration applied**

Run: `npx prisma generate`
Run: `npx prisma migrate status`
Expected: All migrations applied, no pending changes.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add TaskActivityType enum and composite index [LUM-0]"
```

---

## Task 2: Activity Event Types

**Files:**

- Create: `lib/events/types/task-activity.ts`
- Modify: `lib/events/types.ts`

- [ ] **Step 1: Create activity event type definitions**

```typescript
// lib/events/types/task-activity.ts

export type TaskCreatedEvent = {
  type: 'task:created'
  taskId: string
  projectId: string
  actorId: string
}

export type TaskFieldChangedEvent = {
  type:
    | 'task:status_changed_activity'
    | 'task:priority_changed'
    | 'task:title_changed'
    | 'task:description_changed'
    | 'task:due_date_changed'
  taskId: string
  projectId: string
  actorId: string
  from: string | null
  to: string | null
}

export type TaskActorChangedEvent = {
  type: 'task:assignee_changed' | 'task:reviewer_changed'
  taskId: string
  projectId: string
  actorId: string
  fromActorId: string | null
  toActorId: string | null
  toName: string | null
}

export type TaskParentChangedEvent = {
  type: 'task:parent_changed'
  taskId: string
  projectId: string
  actorId: string
  fromTaskId: string | null
  toTaskId: string | null
  toTitle: string | null
}

export type TaskTagsChangedEvent = {
  type: 'task:tags_changed'
  taskId: string
  projectId: string
  actorId: string
  added: string[]
  removed: string[]
}

export type TaskRepositoryChangedEvent = {
  type: 'task:repository_changed'
  taskId: string
  projectId: string
  actorId: string
  fromRepoId: string | null
  toRepoId: string | null
  toName: string | null
}

export type TaskCommentEvent = {
  type: 'task:comment_added' | 'task:comment_deleted'
  taskId: string
  projectId: string
  actorId: string
  commentId: string
}

export type TaskSubtaskEvent = {
  type: 'task:subtask_added' | 'task:subtask_removed'
  taskId: string
  projectId: string
  actorId: string
  childTaskId: string
  childTitle: string
  childNumber: number
}

export type TaskSpecEvent = {
  type: 'task:spec_generated'
  taskId: string
  projectId: string
  actorId: string
}

export type TaskBranchEvent = {
  type: 'task:branch_created'
  taskId: string
  projectId: string
  actorId: string
  branchName: string
}

export type TaskPrEvent = {
  type:
    | 'task:pr_linked'
    | 'task:pr_unlinked'
    | 'task:pr_created'
    | 'task:pr_merged'
  taskId: string
  projectId: string
  actorId: string | null
  prId?: string
  prNumber: number
  prUrl?: string
  prTitle?: string
}

export type TaskAgentRunEvent = {
  type:
    | 'task:agent_run_started'
    | 'task:agent_run_completed'
    | 'task:agent_run_failed'
    | 'task:agent_input_required'
  taskId: string
  projectId: string
  actorId: string | null
  runId: string
  runNumber: number
  errorCode?: string
  reason?: string
}

export type TaskActivityEvent =
  | TaskCreatedEvent
  | TaskFieldChangedEvent
  | TaskActorChangedEvent
  | TaskParentChangedEvent
  | TaskTagsChangedEvent
  | TaskRepositoryChangedEvent
  | TaskCommentEvent
  | TaskSubtaskEvent
  | TaskSpecEvent
  | TaskBranchEvent
  | TaskPrEvent
  | TaskAgentRunEvent
```

- [ ] **Step 2: Extend DomainEvent union in types.ts**

In `lib/events/types.ts`, add the import and extend the union:

```typescript
import type { TaskActivityEvent } from './types/task-activity'

// ... existing types ...

export type DomainEvent =
  | AgentStatusChangedEvent
  | TaskStatusChangedEvent
  | TaskActivityEvent
```

Also add to `EventHandlerRegistry`:

```typescript
export type TaskActivityEventHandler = (
  event: TaskActivityEvent
) => Promise<void>

export type EventHandlerRegistry = {
  'agent:status_changed': AgentEventHandler[]
  'task:status_changed': TaskEventHandler[]
  'task:activity': TaskActivityEventHandler[]
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add lib/events/types/task-activity.ts lib/events/types.ts
git commit -m "feat: add task activity domain event types [LUM-0]"
```

---

## Task 3: Activity Repository

**Files:**

- Create: `lib/repositories/activity.repository.ts`
- Modify: `lib/repositories/index.ts`
- Test: `__tests__/lib/repositories/activity.repository.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/lib/repositories/activity.repository.test.ts
/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    taskActivity: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { activityRepository } from '@/lib/repositories/activity.repository'

const mockCreate = prisma.taskActivity.create as jest.Mock
const mockFindMany = prisma.taskActivity.findMany as jest.Mock
const mockCount = prisma.taskActivity.count as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('activityRepository.create', () => {
  it('creates an activity record', async () => {
    const data = {
      taskId: 'task-1',
      actorId: 'actor-1',
      type: 'STATUS_CHANGED' as const,
      payload: { from: 'TODO', to: 'IN_PROGRESS' },
    }
    mockCreate.mockResolvedValue({
      id: 'act-1',
      ...data,
      createdAt: new Date(),
    })

    const result = await activityRepository.create(data)

    expect(mockCreate).toHaveBeenCalledWith({ data })
    expect(result.id).toBe('act-1')
  })

  it('creates with a transaction client', async () => {
    const txCreate = jest.fn().mockResolvedValue({ id: 'act-2' })
    const tx = { taskActivity: { create: txCreate } }
    const data = {
      taskId: 'task-1',
      actorId: null,
      type: 'TASK_CREATED' as const,
      payload: {},
    }

    await activityRepository.create(data, tx as any)

    expect(txCreate).toHaveBeenCalledWith({ data })
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('activityRepository.findByTaskId', () => {
  it('returns activities ordered by createdAt ASC with limit', async () => {
    const activities = [
      { id: 'a1', createdAt: new Date('2026-01-01') },
      { id: 'a2', createdAt: new Date('2026-01-02') },
    ]
    mockFindMany.mockResolvedValue(activities)

    const result = await activityRepository.findByTaskId('task-1', {
      limit: 30,
    })

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { taskId: 'task-1' },
      include: {
        actor: {
          select: {
            id: true,
            type: true,
            member: { select: { id: true, clerkId: true } },
            agent: { select: { id: true, name: true, avatarColor: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 31,
    })
    expect(result).toEqual(activities)
  })

  it('applies cursor filter when provided', async () => {
    mockFindMany.mockResolvedValue([])

    await activityRepository.findByTaskId('task-1', {
      limit: 30,
      cursor: { timestamp: '2026-01-01T00:00:00.000Z', id: 'a1' },
    })

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          taskId: 'task-1',
          OR: [
            { createdAt: { gt: new Date('2026-01-01T00:00:00.000Z') } },
            {
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              id: { gt: 'a1' },
            },
          ],
        },
      })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/repositories/activity.repository.test.ts --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement activity repository**

```typescript
// lib/repositories/activity.repository.ts
import { prisma } from '@/lib/db/prisma'
import type { TaskActivityType } from '@prisma/client'

interface CreateActivityData {
  taskId: string
  actorId: string | null
  type: TaskActivityType
  payload: Record<string, unknown> | null
}

interface FindOptions {
  limit: number
  cursor?: { timestamp: string; id: string }
}

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

const ACTOR_SELECT = {
  select: {
    id: true,
    type: true,
    member: { select: { id: true, clerkId: true } },
    agent: { select: { id: true, name: true, avatarColor: true } },
  },
} as const

export const activityRepository = {
  async create(data: CreateActivityData, tx?: PrismaTx) {
    const client = tx ?? prisma
    return client.taskActivity.create({ data })
  },

  async findByTaskId(taskId: string, options: FindOptions) {
    const { limit, cursor } = options

    const where: Record<string, unknown> = { taskId }

    if (cursor) {
      where.OR = [
        { createdAt: { gt: new Date(cursor.timestamp) } },
        { createdAt: new Date(cursor.timestamp), id: { gt: cursor.id } },
      ]
    }

    return prisma.taskActivity.findMany({
      where,
      include: { actor: ACTOR_SELECT },
      orderBy: { createdAt: 'asc' },
      take: limit + 1,
    })
  },
}
```

- [ ] **Step 4: Export from repositories index**

Add to `lib/repositories/index.ts`:

```typescript
export { activityRepository } from './activity.repository'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/lib/repositories/activity.repository.test.ts --no-coverage`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/activity.repository.ts lib/repositories/index.ts __tests__/lib/repositories/activity.repository.test.ts
git commit -m "feat: add activity repository with cursor-based pagination [LUM-0]"
```

---

## Task 4: Activity Event Listener (record-activity handler)

**Files:**

- Create: `lib/events/handlers/record-activity.ts`
- Modify: `lib/events/handlers/index.ts`
- Modify: `lib/events/dispatcher.ts`
- Test: `__tests__/lib/events/handlers/record-activity.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/lib/events/handlers/record-activity.test.ts
/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: jest.fn(),
  },
}))

jest.mock('@/lib/pusher/server', () => ({
  pushTaskEvent: jest.fn().mockResolvedValue(undefined),
}))

import { activityRepository } from '@/lib/repositories/activity.repository'
import { handleRecordActivity } from '@/lib/events/handlers/record-activity'
import type { TaskActivityEvent } from '@/lib/events/types/task-activity'

const mockCreate = activityRepository.create as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('handleRecordActivity', () => {
  it('records STATUS_CHANGED activity with from/to payload', async () => {
    mockCreate.mockResolvedValue({ id: 'act-1' })

    const event: TaskActivityEvent = {
      type: 'task:status_changed_activity',
      taskId: 'task-1',
      projectId: 'proj-1',
      actorId: 'actor-1',
      from: 'TODO',
      to: 'IN_PROGRESS',
    }

    await handleRecordActivity(event)

    expect(mockCreate).toHaveBeenCalledWith({
      taskId: 'task-1',
      actorId: 'actor-1',
      type: 'STATUS_CHANGED',
      payload: { from: 'TODO', to: 'IN_PROGRESS' },
    })
  })

  it('records ASSIGNEE_CHANGED activity', async () => {
    mockCreate.mockResolvedValue({ id: 'act-2' })

    const event: TaskActivityEvent = {
      type: 'task:assignee_changed',
      taskId: 'task-1',
      projectId: 'proj-1',
      actorId: 'actor-1',
      fromActorId: null,
      toActorId: 'actor-2',
      toName: 'Bob',
    }

    await handleRecordActivity(event)

    expect(mockCreate).toHaveBeenCalledWith({
      taskId: 'task-1',
      actorId: 'actor-1',
      type: 'ASSIGNEE_CHANGED',
      payload: { fromActorId: null, toActorId: 'actor-2', toName: 'Bob' },
    })
  })

  it('records TASK_CREATED activity with empty payload', async () => {
    mockCreate.mockResolvedValue({ id: 'act-3' })

    const event: TaskActivityEvent = {
      type: 'task:created',
      taskId: 'task-1',
      projectId: 'proj-1',
      actorId: 'actor-1',
    }

    await handleRecordActivity(event)

    expect(mockCreate).toHaveBeenCalledWith({
      taskId: 'task-1',
      actorId: 'actor-1',
      type: 'TASK_CREATED',
      payload: {},
    })
  })

  it('records COMMENT_ADDED activity', async () => {
    mockCreate.mockResolvedValue({ id: 'act-4' })

    const event: TaskActivityEvent = {
      type: 'task:comment_added',
      taskId: 'task-1',
      projectId: 'proj-1',
      actorId: 'actor-1',
      commentId: 'cmt-1',
    }

    await handleRecordActivity(event)

    expect(mockCreate).toHaveBeenCalledWith({
      taskId: 'task-1',
      actorId: 'actor-1',
      type: 'COMMENT_ADDED',
      payload: { commentId: 'cmt-1' },
    })
  })

  it('records PR_CREATED activity', async () => {
    mockCreate.mockResolvedValue({ id: 'act-5' })

    const event: TaskActivityEvent = {
      type: 'task:pr_created',
      taskId: 'task-1',
      projectId: 'proj-1',
      actorId: null,
      prNumber: 42,
      prUrl: 'https://github.com/org/repo/pull/42',
      prTitle: 'Fix bug',
    }

    await handleRecordActivity(event)

    expect(mockCreate).toHaveBeenCalledWith({
      taskId: 'task-1',
      actorId: null,
      type: 'PR_CREATED',
      payload: {
        prNumber: 42,
        prUrl: 'https://github.com/org/repo/pull/42',
        prTitle: 'Fix bug',
      },
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/events/handlers/record-activity.test.ts --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the activity listener**

```typescript
// lib/events/handlers/record-activity.ts
import { activityRepository } from '@/lib/repositories/activity.repository'
import type { TaskActivityEvent } from '@/lib/events/types/task-activity'
import type { TaskActivityType } from '@prisma/client'

/**
 * Maps domain event type to TaskActivityType enum and extracts payload.
 */
function toActivityRecord(event: TaskActivityEvent): {
  type: TaskActivityType
  payload: Record<string, unknown>
} {
  switch (event.type) {
    case 'task:created':
      return { type: 'TASK_CREATED', payload: {} }

    case 'task:status_changed_activity':
      return {
        type: 'STATUS_CHANGED',
        payload: { from: event.from, to: event.to },
      }
    case 'task:priority_changed':
      return {
        type: 'PRIORITY_CHANGED',
        payload: { from: event.from, to: event.to },
      }
    case 'task:title_changed':
      return {
        type: 'TITLE_CHANGED',
        payload: { from: event.from, to: event.to },
      }
    case 'task:description_changed':
      return { type: 'DESCRIPTION_CHANGED', payload: {} }
    case 'task:due_date_changed':
      return {
        type: 'DUE_DATE_CHANGED',
        payload: { from: event.from, to: event.to },
      }

    case 'task:assignee_changed':
      return {
        type: 'ASSIGNEE_CHANGED',
        payload: {
          fromActorId: event.fromActorId,
          toActorId: event.toActorId,
          toName: event.toName,
        },
      }
    case 'task:reviewer_changed':
      return {
        type: 'REVIEWER_CHANGED',
        payload: {
          fromActorId: event.fromActorId,
          toActorId: event.toActorId,
          toName: event.toName,
        },
      }

    case 'task:parent_changed':
      return {
        type: 'PARENT_CHANGED',
        payload: {
          fromTaskId: event.fromTaskId,
          toTaskId: event.toTaskId,
          toTitle: event.toTitle,
        },
      }

    case 'task:tags_changed':
      return {
        type: 'TAGS_CHANGED',
        payload: { added: event.added, removed: event.removed },
      }

    case 'task:repository_changed':
      return {
        type: 'REPOSITORY_CHANGED',
        payload: {
          fromRepoId: event.fromRepoId,
          toRepoId: event.toRepoId,
          toName: event.toName,
        },
      }

    case 'task:comment_added':
      return { type: 'COMMENT_ADDED', payload: { commentId: event.commentId } }
    case 'task:comment_deleted':
      return {
        type: 'COMMENT_DELETED',
        payload: { commentId: event.commentId },
      }

    case 'task:subtask_added':
      return {
        type: 'SUBTASK_ADDED',
        payload: {
          childTaskId: event.childTaskId,
          childTitle: event.childTitle,
          childNumber: event.childNumber,
        },
      }
    case 'task:subtask_removed':
      return {
        type: 'SUBTASK_REMOVED',
        payload: {
          childTaskId: event.childTaskId,
          childTitle: event.childTitle,
        },
      }

    case 'task:spec_generated':
      return { type: 'SPEC_GENERATED', payload: {} }

    case 'task:branch_created':
      return {
        type: 'BRANCH_CREATED',
        payload: { branchName: event.branchName },
      }

    case 'task:pr_linked':
      return {
        type: 'PR_LINKED',
        payload: {
          prId: event.prId,
          prNumber: event.prNumber,
          prUrl: event.prUrl,
        },
      }
    case 'task:pr_unlinked':
      return {
        type: 'PR_UNLINKED',
        payload: { prId: event.prId, prNumber: event.prNumber },
      }
    case 'task:pr_created':
      return {
        type: 'PR_CREATED',
        payload: {
          prNumber: event.prNumber,
          prUrl: event.prUrl,
          prTitle: event.prTitle,
        },
      }
    case 'task:pr_merged':
      return {
        type: 'PR_MERGED',
        payload: { prNumber: event.prNumber, prUrl: event.prUrl },
      }

    case 'task:agent_run_started':
      return {
        type: 'AGENT_RUN_STARTED',
        payload: { runId: event.runId, runNumber: event.runNumber },
      }
    case 'task:agent_run_completed':
      return {
        type: 'AGENT_RUN_COMPLETED',
        payload: { runId: event.runId, runNumber: event.runNumber },
      }
    case 'task:agent_run_failed':
      return {
        type: 'AGENT_RUN_FAILED',
        payload: {
          runId: event.runId,
          runNumber: event.runNumber,
          errorCode: event.errorCode,
        },
      }
    case 'task:agent_input_required':
      return {
        type: 'AGENT_INPUT_REQUIRED',
        payload: { runId: event.runId, reason: event.reason },
      }
  }
}

/** Record a TaskActivity row for every task activity event. */
export async function handleRecordActivity(
  event: TaskActivityEvent
): Promise<void> {
  const { type, payload } = toActivityRecord(event)

  await activityRepository.create({
    taskId: event.taskId,
    actorId: 'actorId' in event ? (event.actorId ?? null) : null,
    type,
    payload,
  })
}
```

- [ ] **Step 4: Register handler in registry and dispatcher**

In `lib/events/handlers/index.ts`:

```typescript
import type { EventHandlerRegistry } from '../types'
import { handleAgentBroadcast } from './broadcast'
import { handleNotifySpecReady } from './notify-spec-ready'
import { handleTaskBroadcast } from './broadcast'
import { handleNotifyTaskInReview } from './notify-task-in-review'
import { handleRecordActivity } from './record-activity'

export const registry: EventHandlerRegistry = {
  'agent:status_changed': [handleAgentBroadcast, handleNotifySpecReady],
  'task:status_changed': [handleTaskBroadcast, handleNotifyTaskInReview],
  'task:activity': [handleRecordActivity],
}
```

In `lib/events/dispatcher.ts`, add a new case in `dispatchEvents`:

```typescript
case 'task:activity': {
  // This won't match — activity events have their own type strings.
  // Instead, check if the event type starts with 'task:' and is NOT the existing ones.
  break
}
```

Actually, the dispatcher switches on `event.type`. Since activity events have types like `'task:created'`, `'task:priority_changed'`, etc., we need a different approach. Add a default case or check for activity event patterns:

```typescript
export async function dispatchEvents(events: DomainEvent[]): Promise<void> {
  for (const event of events) {
    switch (event.type) {
      case 'agent:status_changed': {
        const handlers = registry['agent:status_changed']
        await Promise.all(handlers.map(h => runWithRetry(h, event)))
        break
      }
      case 'task:status_changed': {
        const handlers = registry['task:status_changed']
        await Promise.all(handlers.map(h => runWithRetry(h, event)))
        break
      }
      default: {
        // All other task:* events are activity events
        if ('task:activity' in registry) {
          const handlers = registry['task:activity']
          await Promise.all(
            handlers.map(h => runWithRetry(h, event as TaskActivityEvent))
          )
        }
        break
      }
    }
  }
}
```

Add the import at the top of `dispatcher.ts`:

```typescript
import type { TaskActivityEvent } from './types/task-activity'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/lib/events/handlers/record-activity.test.ts --no-coverage`
Expected: All tests PASS.

Run: `npx jest tests/lib/events/dispatcher.test.ts --no-coverage`
Expected: Existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/events/handlers/record-activity.ts lib/events/handlers/index.ts lib/events/dispatcher.ts __tests__/lib/events/handlers/record-activity.test.ts
git commit -m "feat: add activity event listener and dispatcher integration [LUM-0]"
```

---

## Task 5: Timeline Service

**Files:**

- Create: `lib/services/timeline.service.ts`
- Modify: `lib/services/index.ts`
- Test: `__tests__/lib/services/timeline.service.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/lib/services/timeline.service.test.ts
/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    findByTaskId: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/comment.repository', () => ({
  commentRepository: {
    findByTaskId: jest.fn(),
  },
}))

import { activityRepository } from '@/lib/repositories/activity.repository'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { timelineService } from '@/lib/services/timeline.service'

const mockFindActivities = activityRepository.findByTaskId as jest.Mock
const mockFindComments = commentRepository.findByTaskId as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('timelineService.getTimeline', () => {
  it('merges activities and comments sorted by createdAt ASC', async () => {
    mockFindActivities.mockResolvedValue([
      {
        id: 'a1',
        type: 'STATUS_CHANGED',
        createdAt: new Date('2026-01-01T10:00:00Z'),
        payload: { from: 'TODO', to: 'IN_PROGRESS' },
        actor: null,
      },
      {
        id: 'a2',
        type: 'ASSIGNEE_CHANGED',
        createdAt: new Date('2026-01-01T12:00:00Z'),
        payload: {},
        actor: null,
      },
    ])
    mockFindComments.mockResolvedValue([
      {
        id: 'c1',
        body: 'Hello',
        createdAt: new Date('2026-01-01T11:00:00Z'),
        authorActorId: 'actor-1',
        parentId: null,
        replies: [],
      },
    ])

    const result = await timelineService.getTimeline('task-1', { limit: 30 })

    expect(result.items).toHaveLength(3)
    expect(result.items[0].id).toBe('a1')
    expect(result.items[0].kind).toBe('activity')
    expect(result.items[1].id).toBe('c1')
    expect(result.items[1].kind).toBe('comment')
    expect(result.items[2].id).toBe('a2')
    expect(result.items[2].kind).toBe('activity')
    expect(result.hasMore).toBe(false)
  })

  it('returns hasMore=true when activities exceed limit', async () => {
    // Return limit+1 items (31) to indicate more exist
    const activities = Array.from({ length: 31 }, (_, i) => ({
      id: `a${i}`,
      type: 'STATUS_CHANGED',
      createdAt: new Date(
        `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`
      ),
      payload: {},
      actor: null,
    }))
    mockFindActivities.mockResolvedValue(activities)
    mockFindComments.mockResolvedValue([])

    const result = await timelineService.getTimeline('task-1', { limit: 30 })

    expect(result.items.length).toBeLessThanOrEqual(30)
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBeDefined()
  })

  it('returns empty timeline for task with no activities or comments', async () => {
    mockFindActivities.mockResolvedValue([])
    mockFindComments.mockResolvedValue([])

    const result = await timelineService.getTimeline('task-1', { limit: 30 })

    expect(result.items).toEqual([])
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/services/timeline.service.test.ts --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement timeline service**

```typescript
// lib/services/timeline.service.ts
import { activityRepository } from '@/lib/repositories/activity.repository'
import { commentRepository } from '@/lib/repositories/comment.repository'

export interface TimelineEntry {
  id: string
  kind: 'activity' | 'comment'
  createdAt: Date
  data: Record<string, unknown>
}

interface TimelineOptions {
  limit: number
  cursor?:
    | { timestamp: string; id: string; source: 'activity' | 'comment' }
    | undefined
}

interface TimelineResult {
  items: TimelineEntry[]
  hasMore: boolean
  nextCursor: string | null
}

export const timelineService = {
  async getTimeline(
    taskId: string,
    options: TimelineOptions
  ): Promise<TimelineResult> {
    const { limit, cursor } = options

    // Build cursor filters per source
    const activityCursor =
      cursor && (cursor.source === 'activity' || !cursor.source)
        ? { timestamp: cursor.timestamp, id: cursor.id }
        : cursor
          ? { timestamp: cursor.timestamp, id: '' }
          : undefined

    // Fetch from both sources (limit+1 each for hasMore detection)
    const [activities, comments] = await Promise.all([
      activityRepository.findByTaskId(taskId, {
        limit,
        cursor: activityCursor,
      }),
      commentRepository.findByTaskId(taskId),
    ])

    // Convert to unified entries
    const activityEntries: TimelineEntry[] = activities.map(
      (a: Record<string, unknown>) => ({
        id: a.id as string,
        kind: 'activity' as const,
        createdAt: a.createdAt as Date,
        data: a as Record<string, unknown>,
      })
    )

    const commentEntries: TimelineEntry[] = (
      comments as Record<string, unknown>[]
    ).map(c => ({
      id: c.id as string,
      kind: 'comment' as const,
      createdAt: c.createdAt as Date,
      data: c as Record<string, unknown>,
    }))

    // Filter comments by cursor if needed
    let filteredComments = commentEntries
    if (cursor) {
      const cursorTime = new Date(cursor.timestamp).getTime()
      filteredComments = commentEntries.filter(c => {
        const cTime = c.createdAt.getTime()
        return cTime > cursorTime || (cTime === cursorTime && c.id > cursor.id)
      })
    }

    // Merge and sort by createdAt ASC, then id ASC for ties
    const merged = [...activityEntries, ...filteredComments].sort((a, b) => {
      const timeDiff = a.createdAt.getTime() - b.createdAt.getTime()
      if (timeDiff !== 0) return timeDiff
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })

    // Determine hasMore: if either source returned more than limit, there's more
    const hasMore = merged.length > limit
    const items = merged.slice(0, limit)

    let nextCursor: string | null = null
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1]!
      nextCursor = JSON.stringify({
        timestamp: last.createdAt.toISOString(),
        id: last.id,
        source: last.kind,
      })
    }

    return { items, hasMore, nextCursor }
  },
}
```

- [ ] **Step 4: Export from services index**

Add to `lib/services/index.ts`:

```typescript
export { timelineService } from './timeline.service'
export type { TimelineEntry } from './timeline.service'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/lib/services/timeline.service.test.ts --no-coverage`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/services/timeline.service.ts lib/services/index.ts __tests__/lib/services/timeline.service.test.ts
git commit -m "feat: add timeline service with activity/comment merge [LUM-0]"
```

---

## Task 6: Timeline API Route

**Files:**

- Create: `app/api/tasks/[id]/timeline/route.ts`
- Modify: `app/workspace/[workspaceUrl]/constants.ts`

- [ ] **Step 1: Create the timeline API route**

```typescript
// app/api/tasks/[id]/timeline/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { timelineService } from '@/lib/services'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/timeline — Fetch paginated timeline (activities + comments).
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await taskRepository.findWithProjectWorkspaceId(id)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const url = new URL(request.url)
    const cursorParam = url.searchParams.get('cursor')
    const limitParam = url.searchParams.get('limit')
    const limit = Math.min(
      Math.max(parseInt(limitParam ?? '30', 10) || 30, 1),
      100
    )

    let cursor:
      | { timestamp: string; id: string; source: 'activity' | 'comment' }
      | undefined
    if (cursorParam) {
      try {
        cursor = JSON.parse(cursorParam)
      } catch {
        return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 })
      }
    }

    const result = await timelineService.getTimeline(id, { limit, cursor })

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Add timeline URL to constants**

In `app/workspace/[workspaceUrl]/constants.ts`, add to the `tasks` section:

```typescript
tasks: {
  // ... existing entries ...
  timeline: (taskId: string) => `/api/tasks/${taskId}/timeline`,
},
```

- [ ] **Step 3: Add timeline method to API client**

In `lib/api-client/tasks.ts`, add:

```typescript
getTimeline<T>(taskId: string, cursor?: string | null, limit?: number) {
  const params = new URLSearchParams()
  if (cursor) params.set('cursor', cursor)
  if (limit) params.set('limit', String(limit))
  const qs = params.toString()
  const url = `/api/tasks/${taskId}/timeline${qs ? `?${qs}` : ''}`
  return apiFetch<T>(url)
},
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/tasks/[id]/timeline/route.ts app/workspace/[workspaceUrl]/constants.ts lib/api-client/tasks.ts
git commit -m "feat: add GET /api/tasks/:id/timeline endpoint [LUM-0]"
```

---

## Task 7: Emit Activity Events from Task Service

**Files:**

- Modify: `app/api/tasks/[id]/route.ts`
- Modify: `app/api/tasks/[id]/comments/route.ts`
- Modify: `app/api/projects/[id]/tasks/route.ts`

This task integrates activity event emission into the existing API routes. Events are dispatched via the existing `dispatchEvents` function after the main operation succeeds.

- [ ] **Step 1: Add activity events to task PATCH route**

In `app/api/tasks/[id]/route.ts`, after the `taskService.updateTask` call and before the Pusher push, build and dispatch activity events:

```typescript
// After: const result = await taskService.updateTask(id, parsed.data)
// Before: waitUntil(Promise.all([...]))

// Build activity events from changed fields
import { dispatchEvents } from '@/lib/events/dispatcher'
import type { TaskActivityEvent } from '@/lib/events/types/task-activity'

const activityEvents: TaskActivityEvent[] = []
const projectId = result.task.projectId as string

if (
  parsed.data.status !== undefined &&
  result.changedFields.includes('status')
) {
  activityEvents.push({
    type: 'task:status_changed_activity',
    taskId: id,
    projectId,
    actorId: triggerActorId ?? '',
    from: result.oldStatus,
    to: parsed.data.status,
  })
}
if (
  parsed.data.priority !== undefined &&
  result.changedFields.includes('priority')
) {
  activityEvents.push({
    type: 'task:priority_changed',
    taskId: id,
    projectId,
    actorId: triggerActorId ?? '',
    from: (taskCheck as any).priority ?? null,
    to: parsed.data.priority,
  })
}
if (parsed.data.title !== undefined && result.changedFields.includes('title')) {
  activityEvents.push({
    type: 'task:title_changed',
    taskId: id,
    projectId,
    actorId: triggerActorId ?? '',
    from: (taskCheck as any).title ?? null,
    to: parsed.data.title,
  })
}
if (
  parsed.data.assigneeActorId !== undefined &&
  result.changedFields.includes('assigneeActorId')
) {
  activityEvents.push({
    type: 'task:assignee_changed',
    taskId: id,
    projectId,
    actorId: triggerActorId ?? '',
    fromActorId: result.oldAssigneeActorId,
    toActorId: parsed.data.assigneeActorId ?? null,
    toName: null, // Will be resolved from actor later if needed
  })
}
if (
  parsed.data.reviewerActorId !== undefined &&
  result.changedFields.includes('reviewerActorId')
) {
  activityEvents.push({
    type: 'task:reviewer_changed',
    taskId: id,
    projectId,
    actorId: triggerActorId ?? '',
    fromActorId: (taskCheck as any).reviewerActorId ?? null,
    toActorId: parsed.data.reviewerActorId ?? null,
    toName: null,
  })
}
if (
  parsed.data.description !== undefined &&
  result.changedFields.includes('description')
) {
  activityEvents.push({
    type: 'task:description_changed',
    taskId: id,
    projectId,
    actorId: triggerActorId ?? '',
    from: null,
    to: null,
  })
}
if (
  parsed.data.dueDate !== undefined &&
  result.changedFields.includes('dueDate')
) {
  activityEvents.push({
    type: 'task:due_date_changed',
    taskId: id,
    projectId,
    actorId: triggerActorId ?? '',
    from: (taskCheck as any).dueDate ?? null,
    to: parsed.data.dueDate ?? null,
  })
}
if (
  parsed.data.parentTaskId !== undefined &&
  result.changedFields.includes('parentTaskId')
) {
  activityEvents.push({
    type: 'task:parent_changed',
    taskId: id,
    projectId,
    actorId: triggerActorId ?? '',
    fromTaskId: (taskCheck as any).parentTaskId ?? null,
    toTaskId: parsed.data.parentTaskId ?? null,
    toTitle: null,
  })
}
if (
  parsed.data.repositoryId !== undefined &&
  result.changedFields.includes('repositoryId')
) {
  activityEvents.push({
    type: 'task:repository_changed',
    taskId: id,
    projectId,
    actorId: triggerActorId ?? '',
    fromRepoId: (taskCheck as any).repositoryId ?? null,
    toRepoId: parsed.data.repositoryId ?? null,
    toName: null,
  })
}

// Fire-and-forget activity recording
if (activityEvents.length > 0) {
  waitUntil(dispatchEvents(activityEvents))
}
```

Note: `triggerActorId` is already computed a few lines later in the existing code. Move the `const triggerActorId = await getHumanActorId(memberResult.id)` line to BEFORE the activity events block.

- [ ] **Step 2: Add comment_added activity event to POST comments route**

In `app/api/tasks/[id]/comments/route.ts`, after creating the comment:

```typescript
// After: const comment = await commentService.createComment({...})

import { dispatchEvents } from '@/lib/events/dispatcher'
import type { TaskActivityEvent } from '@/lib/events/types/task-activity'

waitUntil(
  dispatchEvents([
    {
      type: 'task:comment_added',
      taskId: id,
      projectId: task.projectId,
      actorId: authorActorId,
      commentId: comment.id,
    } satisfies TaskActivityEvent,
  ])
)
```

- [ ] **Step 3: Add task_created activity event to POST tasks route**

Check `app/api/projects/[id]/tasks/route.ts` for the task creation endpoint and add:

```typescript
// After task creation
waitUntil(
  dispatchEvents([
    {
      type: 'task:created',
      taskId: task.id,
      projectId: projectId,
      actorId: triggerActorId,
    } satisfies TaskActivityEvent,
  ])
)
```

- [ ] **Step 4: Add comment_deleted activity event to DELETE comment route**

In `app/api/tasks/[id]/comments/[commentId]/route.ts`, add after deleting the comment:

```typescript
import { dispatchEvents } from '@/lib/events/dispatcher'
import type { TaskActivityEvent } from '@/lib/events/types/task-activity'

// After delete
waitUntil(
  dispatchEvents([
    {
      type: 'task:comment_deleted',
      taskId: id,
      projectId: task.projectId,
      actorId: authorActorId,
      commentId: commentId,
    } satisfies TaskActivityEvent,
  ])
)
```

- [ ] **Step 5: Add PR link/unlink activity events**

In `app/api/tasks/[id]/pull-requests/link/route.ts`, after linking:

```typescript
waitUntil(
  dispatchEvents([
    {
      type: 'task:pr_linked',
      taskId: id,
      projectId: task.projectId,
      actorId: triggerActorId,
      prId: pr.id,
      prNumber: pr.number,
      prUrl: pr.url,
    } satisfies TaskActivityEvent,
  ])
)
```

In `app/api/tasks/[id]/pull-requests/[prId]/unlink/route.ts`, after unlinking:

```typescript
waitUntil(
  dispatchEvents([
    {
      type: 'task:pr_unlinked',
      taskId: id,
      projectId: task.projectId,
      actorId: triggerActorId,
      prId: prId,
      prNumber: pr.number,
    } satisfies TaskActivityEvent,
  ])
)
```

- [ ] **Step 6: Add branch_created activity event**

In `app/api/tasks/[id]/branch/route.ts`, after creating a branch:

```typescript
waitUntil(
  dispatchEvents([
    {
      type: 'task:branch_created',
      taskId: id,
      projectId: task.projectId,
      actorId: triggerActorId,
      branchName: branch.branchName,
    } satisfies TaskActivityEvent,
  ])
)
```

- [ ] **Step 7: Add tags_changed activity event**

In the PATCH route (`app/api/tasks/[id]/route.ts`), after the existing tag-related block, add:

```typescript
if (parsed.data.tagIds !== undefined) {
  // Need to compute added/removed tags by comparing old and new
  const oldTagIds = (taskCheck as any).tags?.map((t: any) => t.name) ?? []
  const newTagIds = parsed.data.tagIds
  // Simplified: just record that tags changed
  activityEvents.push({
    type: 'task:tags_changed',
    taskId: id,
    projectId,
    actorId: triggerActorId ?? '',
    added: [],
    removed: [],
  })
}
```

- [ ] **Step 8: Verify existing tests still pass**

Run: `npx jest --no-coverage`
Expected: All existing tests PASS.

- [ ] **Step 9: Commit**

```bash
git add app/api/tasks/[id]/route.ts app/api/tasks/[id]/comments/route.ts app/api/tasks/[id]/comments/[commentId]/route.ts app/api/projects/[id]/tasks/route.ts app/api/tasks/[id]/pull-requests/ app/api/tasks/[id]/branch/route.ts
git commit -m "feat: emit activity events from all task-related API routes [LUM-0]"
```

---

## Task 8: Pusher Integration for Timeline

**Files:**

- Modify: `lib/pusher/server.ts`

- [ ] **Step 1: Add activity event type to Pusher**

In `lib/pusher/server.ts`, add a new event type and push function:

```typescript
// ── Activity events (timeline updates) ──────────────────────────────────────

export type ActivityPusherEvent = {
  type: 'activity:created'
  entry: Record<string, unknown>
}

export async function pushActivityEvent(
  taskId: string,
  entry: Record<string, unknown>
): Promise<void> {
  try {
    await getPusher().trigger(`task-${taskId}`, 'activity-created', {
      type: 'activity:created',
      entry,
    })
  } catch (err) {
    console.error('[pusher] Failed to push activity event:', err)
  }
}
```

- [ ] **Step 2: Call pushActivityEvent from record-activity handler**

In `lib/events/handlers/record-activity.ts`, after creating the activity record, push via Pusher:

```typescript
import { pushActivityEvent } from '@/lib/pusher/server'

export async function handleRecordActivity(
  event: TaskActivityEvent
): Promise<void> {
  const { type, payload } = toActivityRecord(event)

  const activity = await activityRepository.create({
    taskId: event.taskId,
    actorId: 'actorId' in event ? (event.actorId ?? null) : null,
    type,
    payload,
  })

  // Push realtime update (fire-and-forget, already in async handler)
  void pushActivityEvent(event.taskId, {
    id: activity.id,
    kind: 'activity',
    type: activity.type,
    payload: activity.payload,
    createdAt: activity.createdAt,
    actorId: activity.actorId,
  })
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add lib/pusher/server.ts lib/events/handlers/record-activity.ts
git commit -m "feat: push activity events via Pusher for realtime timeline [LUM-0]"
```

---

## Task 9: Frontend Timeline Types

**Files:**

- Modify: `app/workspace/[workspaceUrl]/types.ts`

- [ ] **Step 1: Add timeline entry types to frontend types**

In `app/workspace/[workspaceUrl]/types.ts`, add:

```typescript
// ── Timeline ─────────────────────────────────────────────────────────────────

export interface TimelineActivityEntry {
  id: string
  kind: 'activity'
  type: string
  payload: Record<string, unknown> | null
  actorId: string | null
  actor?: {
    id: string
    type: string
    member?: { id: string; clerkId: string } | null
    agent?: { id: string; name: string; avatarColor: string } | null
  } | null
  createdAt: string
}

export interface TimelineCommentEntry {
  id: string
  kind: 'comment'
  body: string
  authorActorId: string | null
  parentId: string | null
  quotedCommentId: string | null
  type: string
  createdAt: string
  updatedAt: string
  replies?: TimelineCommentEntry[]
}

export type TimelineEntry = TimelineActivityEntry | TimelineCommentEntry

export interface TimelineResponse {
  items: TimelineEntry[]
  hasMore: boolean
  nextCursor: string | null
}
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/[workspaceUrl]/types.ts
git commit -m "feat: add frontend timeline entry types [LUM-0]"
```

---

## Task 10: useTimeline Hook

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/useTimeline.ts`

- [ ] **Step 1: Implement the hook**

```typescript
// app/workspace/[workspaceUrl]/hooks/useTimeline.ts
'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { TimelineEntry, TimelineResponse } from '../types'
import { tasksClient } from '@/lib/api-client'
import { usePusherEvent } from './usePusher'

interface UseTimelineOptions {
  taskId: string
  enabled?: boolean
}

export function useTimeline({ taskId, enabled = true }: UseTimelineOptions) {
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const initialFetched = useRef(false)

  const fetchTimeline = useCallback(
    async (cursor?: string | null) => {
      try {
        const data = await tasksClient.getTimeline<TimelineResponse>(
          taskId,
          cursor,
          30
        )
        return data
      } catch {
        return null
      }
    },
    [taskId]
  )

  // Initial load
  useEffect(() => {
    if (!enabled || initialFetched.current) return
    initialFetched.current = true

    setLoading(true)
    fetchTimeline().then(data => {
      if (data) {
        setEntries(data.items)
        setHasMore(data.hasMore)
        setNextCursor(data.nextCursor)
      }
      setLoading(false)
    })
  }, [enabled, fetchTimeline])

  // Load more (earlier entries)
  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !nextCursor) return
    setLoadingMore(true)

    const data = await fetchTimeline(nextCursor)
    if (data) {
      setEntries(prev => [...data.items, ...prev])
      setHasMore(data.hasMore)
      setNextCursor(data.nextCursor)
    }
    setLoadingMore(false)
  }, [hasMore, loadingMore, nextCursor, fetchTimeline])

  // Realtime: append new activities
  usePusherEvent<{ type: string; entry: TimelineEntry }>(
    `task-${taskId}`,
    'activity-created',
    event => {
      if (event.entry) {
        setEntries(prev => {
          // Deduplicate by id
          if (prev.some(e => e.id === event.entry.id)) return prev
          return [...prev, event.entry]
        })
      }
    }
  )

  // Refresh all entries (for comment updates via existing pusher events)
  const refresh = useCallback(async () => {
    const data = await fetchTimeline()
    if (data) {
      setEntries(data.items)
      setHasMore(data.hasMore)
      setNextCursor(data.nextCursor)
    }
  }, [fetchTimeline])

  return {
    entries,
    loading,
    hasMore,
    loadingMore,
    loadMore,
    refresh,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/[workspaceUrl]/hooks/useTimeline.ts
git commit -m "feat: add useTimeline hook with pagination and Pusher [LUM-0]"
```

---

## Task 11: Timeline UI Components

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineTabs.tsx`
- Create: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ActivityTimeline.tsx`
- Create: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineEntryRenderer.tsx`
- Create: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/CompactActivityItem.tsx`
- Create: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/CommentTimelineItem.tsx`
- Create: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/AgentRunItem.tsx`
- Create: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/PrItem.tsx`

This is the largest task. Each component is small and focused.

- [ ] **Step 1: Create CompactActivityItem**

```typescript
// app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/CompactActivityItem.tsx
'use client'

import { useIntl } from 'react-intl'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { TimelineActivityEntry } from '../../../types'
import type { WorkspaceMemberInfo } from '../../../types'

interface CompactActivityItemProps {
  entry: TimelineActivityEntry
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
}

function resolveActorName(
  entry: TimelineActivityEntry,
  members: WorkspaceMemberInfo[],
  agentActors: { actorId: string; name: string }[]
): string {
  if (!entry.actorId) return 'System'
  if (entry.actor?.type === 'AGENT') {
    return entry.actor.agent?.name ?? 'Agent'
  }
  const member = members.find(m => m.actorId === entry.actorId)
  return member?.name ?? 'Unknown'
}

function formatActivityText(type: string, payload: Record<string, unknown> | null, intl: ReturnType<typeof useIntl>): string {
  const p = payload ?? {}
  switch (type) {
    case 'TASK_CREATED': return intl.formatMessage({ id: 'activity.taskCreated', defaultMessage: 'created this task' })
    case 'STATUS_CHANGED': return intl.formatMessage({ id: 'activity.statusChanged', defaultMessage: 'changed status from {from} to {to}' }, { from: p.from, to: p.to })
    case 'PRIORITY_CHANGED': return intl.formatMessage({ id: 'activity.priorityChanged', defaultMessage: 'changed priority from {from} to {to}' }, { from: p.from, to: p.to })
    case 'ASSIGNEE_CHANGED': return p.toName
      ? intl.formatMessage({ id: 'activity.assigneeChanged', defaultMessage: 'assigned to {name}' }, { name: p.toName })
      : intl.formatMessage({ id: 'activity.assigneeRemoved', defaultMessage: 'removed assignee' })
    case 'REVIEWER_CHANGED': return p.toName
      ? intl.formatMessage({ id: 'activity.reviewerChanged', defaultMessage: 'set reviewer to {name}' }, { name: p.toName })
      : intl.formatMessage({ id: 'activity.reviewerRemoved', defaultMessage: 'removed reviewer' })
    case 'TITLE_CHANGED': return intl.formatMessage({ id: 'activity.titleChanged', defaultMessage: 'changed title' })
    case 'DESCRIPTION_CHANGED': return intl.formatMessage({ id: 'activity.descriptionChanged', defaultMessage: 'updated description' })
    case 'DUE_DATE_CHANGED': return p.to
      ? intl.formatMessage({ id: 'activity.dueDateChanged', defaultMessage: 'set due date to {date}' }, { date: p.to })
      : intl.formatMessage({ id: 'activity.dueDateRemoved', defaultMessage: 'removed due date' })
    case 'PARENT_CHANGED': return p.toTitle
      ? intl.formatMessage({ id: 'activity.parentChanged', defaultMessage: 'set parent to {title}' }, { title: p.toTitle })
      : intl.formatMessage({ id: 'activity.parentRemoved', defaultMessage: 'removed parent task' })
    case 'TAGS_CHANGED': return intl.formatMessage({ id: 'activity.tagsChanged', defaultMessage: 'updated tags' })
    case 'REPOSITORY_CHANGED': return intl.formatMessage({ id: 'activity.repositoryChanged', defaultMessage: 'changed repository' })
    case 'COMMENT_DELETED': return intl.formatMessage({ id: 'activity.commentDeleted', defaultMessage: 'deleted a comment' })
    case 'SUBTASK_ADDED': return intl.formatMessage({ id: 'activity.subtaskAdded', defaultMessage: 'added subtask {title}' }, { title: p.childTitle })
    case 'SUBTASK_REMOVED': return intl.formatMessage({ id: 'activity.subtaskRemoved', defaultMessage: 'removed subtask {title}' }, { title: p.childTitle })
    case 'SPEC_GENERATED': return intl.formatMessage({ id: 'activity.specGenerated', defaultMessage: 'generated spec' })
    case 'BRANCH_CREATED': return intl.formatMessage({ id: 'activity.branchCreated', defaultMessage: 'created branch {name}' }, { name: p.branchName })
    default: return type.toLowerCase().replace(/_/g, ' ')
  }
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function CompactActivityItem({ entry, members, agentActors }: CompactActivityItemProps) {
  const intl = useIntl()
  const actorName = resolveActorName(entry, members, agentActors)
  const text = formatActivityText(entry.type, entry.payload, intl)

  return (
    <div className="flex items-center gap-2 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
      <div className="size-5 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
        <span className="text-[9px] font-semibold text-zinc-400">
          {actorName.charAt(0).toUpperCase()}
        </span>
      </div>
      <span>
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{actorName}</span>
        {' '}
        {text}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="ml-auto shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">
            {formatTimeAgo(entry.createdAt)}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {new Date(entry.createdAt).toLocaleString()}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
```

- [ ] **Step 2: Create CommentTimelineItem**

This component wraps the existing comment rendering logic but in a timeline context. It shows the comment as a card.

```typescript
// app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/CommentTimelineItem.tsx
'use client'

import type { TimelineCommentEntry } from '../../../types'
import type { WorkspaceMemberInfo } from '../../../types'
import { CommentAvatar } from '../../CommentAvatar'
import { resolveCommentAuthor } from '../../comment-utils'
import { formatTimestamp } from '../../../utils'

interface CommentTimelineItemProps {
  entry: TimelineCommentEntry
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
}

export function CommentTimelineItem({ entry, members, agentActors }: CommentTimelineItemProps) {
  const ca = resolveCommentAuthor(entry as any, members, agentActors)

  return (
    <div className="flex gap-2.5 py-2">
      <CommentAvatar
        isAgent={ca.isAgent}
        imageUrl={ca.imageUrl}
        initials={ca.initials}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
            {ca.name}
          </span>
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            {formatTimestamp(entry.createdAt)}
          </span>
        </div>
        <div
          className="prose prose-sm dark:prose-invert max-w-none text-zinc-700 dark:text-zinc-300"
          dangerouslySetInnerHTML={{ __html: entry.body }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create AgentRunItem**

```typescript
// app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/AgentRunItem.tsx
'use client'

import { useIntl } from 'react-intl'
import { Bot, CheckCircle2, XCircle, Clock, MessageCircleQuestion } from 'lucide-react'
import type { TimelineActivityEntry } from '../../../types'

interface AgentRunItemProps {
  entry: TimelineActivityEntry
}

export function AgentRunItem({ entry }: AgentRunItemProps) {
  const intl = useIntl()
  const payload = entry.payload ?? {}
  const runNumber = payload.runNumber as number | undefined

  const config: Record<string, { icon: typeof Bot; color: string; label: string }> = {
    AGENT_RUN_STARTED: {
      icon: Bot,
      color: 'text-blue-500',
      label: intl.formatMessage({ id: 'activity.agentRunStarted', defaultMessage: 'Agent run #{n} started' }, { n: runNumber }),
    },
    AGENT_RUN_COMPLETED: {
      icon: CheckCircle2,
      color: 'text-green-500',
      label: intl.formatMessage({ id: 'activity.agentRunCompleted', defaultMessage: 'Agent run #{n} completed' }, { n: runNumber }),
    },
    AGENT_RUN_FAILED: {
      icon: XCircle,
      color: 'text-red-500',
      label: intl.formatMessage({ id: 'activity.agentRunFailed', defaultMessage: 'Agent run #{n} failed' }, { n: runNumber }),
    },
    AGENT_INPUT_REQUIRED: {
      icon: MessageCircleQuestion,
      color: 'text-amber-500',
      label: intl.formatMessage({ id: 'activity.agentInputRequired', defaultMessage: 'Agent run #{n} needs input' }, { n: runNumber }),
    },
  }

  const c = config[entry.type] ?? { icon: Bot, color: 'text-zinc-400', label: entry.type }
  const Icon = c.icon

  return (
    <div className="flex items-start gap-2.5 py-2 px-3 rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800">
      <Icon size={16} className={`mt-0.5 shrink-0 ${c.color}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{c.label}</p>
        {payload.errorCode && (
          <p className="text-[11px] text-red-500 mt-0.5">{payload.errorCode as string}</p>
        )}
        {payload.reason && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">{payload.reason as string}</p>
        )}
      </div>
      <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">
        {new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Create PrItem**

```typescript
// app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/PrItem.tsx
'use client'

import { useIntl } from 'react-intl'
import { GitPullRequest, GitMerge, Link2, Unlink } from 'lucide-react'
import type { TimelineActivityEntry } from '../../../types'

interface PrItemProps {
  entry: TimelineActivityEntry
}

export function PrItem({ entry }: PrItemProps) {
  const intl = useIntl()
  const payload = entry.payload ?? {}
  const prNumber = payload.prNumber as number | undefined
  const prUrl = payload.prUrl as string | undefined
  const prTitle = payload.prTitle as string | undefined

  const config: Record<string, { icon: typeof GitPullRequest; color: string; label: string }> = {
    PR_CREATED: {
      icon: GitPullRequest,
      color: 'text-green-600',
      label: intl.formatMessage({ id: 'activity.prCreated', defaultMessage: 'PR #{n} created' }, { n: prNumber }),
    },
    PR_MERGED: {
      icon: GitMerge,
      color: 'text-purple-600',
      label: intl.formatMessage({ id: 'activity.prMerged', defaultMessage: 'PR #{n} merged' }, { n: prNumber }),
    },
    PR_LINKED: {
      icon: Link2,
      color: 'text-blue-500',
      label: intl.formatMessage({ id: 'activity.prLinked', defaultMessage: 'PR #{n} linked' }, { n: prNumber }),
    },
    PR_UNLINKED: {
      icon: Unlink,
      color: 'text-zinc-400',
      label: intl.formatMessage({ id: 'activity.prUnlinked', defaultMessage: 'PR #{n} unlinked' }, { n: prNumber }),
    },
  }

  const c = config[entry.type] ?? { icon: GitPullRequest, color: 'text-zinc-400', label: entry.type }
  const Icon = c.icon

  return (
    <div className="flex items-start gap-2.5 py-2 px-3 rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800">
      <Icon size={16} className={`mt-0.5 shrink-0 ${c.color}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{c.label}</p>
        {prTitle && (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">{prTitle}</p>
        )}
      </div>
      {prUrl && (
        <a
          href={prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-blue-500 hover:underline shrink-0"
        >
          View
        </a>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Create TimelineEntryRenderer**

```typescript
// app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineEntryRenderer.tsx
'use client'

import type { TimelineEntry, WorkspaceMemberInfo } from '../../types'
import { CompactActivityItem } from './items/CompactActivityItem'
import { CommentTimelineItem } from './items/CommentTimelineItem'
import { AgentRunItem } from './items/AgentRunItem'
import { PrItem } from './items/PrItem'

interface TimelineEntryRendererProps {
  entry: TimelineEntry
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
}

const AGENT_TYPES = new Set(['AGENT_RUN_STARTED', 'AGENT_RUN_COMPLETED', 'AGENT_RUN_FAILED', 'AGENT_INPUT_REQUIRED'])
const PR_TYPES = new Set(['PR_CREATED', 'PR_MERGED', 'PR_LINKED', 'PR_UNLINKED'])

export function TimelineEntryRenderer({ entry, members, agentActors }: TimelineEntryRendererProps) {
  if (entry.kind === 'comment') {
    return <CommentTimelineItem entry={entry} members={members} agentActors={agentActors} />
  }

  // Activity entry
  if (AGENT_TYPES.has(entry.type)) {
    return <AgentRunItem entry={entry} />
  }
  if (PR_TYPES.has(entry.type)) {
    return <PrItem entry={entry} />
  }

  // All other activities use compact rendering
  return <CompactActivityItem entry={entry} members={members} agentActors={agentActors} />
}
```

- [ ] **Step 6: Create ActivityTimeline**

```typescript
// app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ActivityTimeline.tsx
'use client'

import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { TimelineEntry, WorkspaceMemberInfo } from '../../types'
import { TimelineEntryRenderer } from './TimelineEntryRenderer'

interface ActivityTimelineProps {
  entries: TimelineEntry[]
  loading: boolean
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
}

export function ActivityTimeline({
  entries,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  members,
  agentActors,
}: ActivityTimelineProps) {
  const intl = useIntl()

  if (loading) {
    return (
      <div className="space-y-3 py-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-2.5">
            <div className="size-5 rounded-full bg-zinc-100 dark:bg-zinc-800 animate-pulse shrink-0" />
            <div className="flex-1 space-y-1.5 pt-0.5">
              <div className="h-2.5 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse w-2/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <p className="text-xs text-zinc-400 dark:text-zinc-500 py-4">
        {intl.formatMessage({ id: 'activity.empty', defaultMessage: 'No activity yet' })}
      </p>
    )
  }

  return (
    <div className="py-2">
      {hasMore && (
        <div className="flex justify-center mb-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-zinc-400 hover:text-zinc-600"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? (
              <Spinner className="size-3 mr-1" />
            ) : null}
            {intl.formatMessage({ id: 'activity.loadEarlier', defaultMessage: 'Load earlier activity' })}
          </Button>
        </div>
      )}
      <div className="space-y-0.5">
        {entries.map(entry => (
          <TimelineEntryRenderer
            key={`${entry.kind}-${entry.id}`}
            entry={entry}
            members={members}
            agentActors={agentActors}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Create TimelineTabs**

```typescript
// app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineTabs.tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import type { WorkspaceMemberInfo } from '../../types'
import { useTimeline } from '../../hooks/useTimeline'
import { ActivityTimeline } from './ActivityTimeline'
import { TaskDetailComments } from '../TaskDetailComments'
import type { TaskDetailComments as TDCType } from '../TaskDetailComments'

type TabValue = 'activity' | 'comments'

interface TimelineTabsProps {
  taskId: string
  /** All props needed by TaskDetailComments — pass through unchanged */
  commentsProps: React.ComponentProps<typeof TaskDetailComments>
}

export function TimelineTabs({ taskId, commentsProps }: TimelineTabsProps) {
  const intl = useIntl()
  const [activeTab, setActiveTab] = useState<TabValue>('activity')

  const timeline = useTimeline({
    taskId,
    enabled: activeTab === 'activity',
  })

  return (
    <div className="mt-8">
      {/* Tab bar */}
      <div className="flex gap-4 border-b border-zinc-100 dark:border-zinc-800 mb-4">
        <button
          className={`pb-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
            activeTab === 'activity'
              ? 'text-zinc-800 dark:text-zinc-200 border-b-2 border-zinc-800 dark:border-zinc-200'
              : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600'
          }`}
          onClick={() => setActiveTab('activity')}
        >
          {intl.formatMessage({ id: 'task.activity', defaultMessage: 'Activity' })}
        </button>
        <button
          className={`pb-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
            activeTab === 'comments'
              ? 'text-zinc-800 dark:text-zinc-200 border-b-2 border-zinc-800 dark:border-zinc-200'
              : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600'
          }`}
          onClick={() => setActiveTab('comments')}
        >
          {intl.formatMessage({ id: 'task.comments', defaultMessage: 'Comments' })}
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'activity' ? (
        <ActivityTimeline
          entries={timeline.entries}
          loading={timeline.loading}
          hasMore={timeline.hasMore}
          loadingMore={timeline.loadingMore}
          onLoadMore={timeline.loadMore}
          members={commentsProps.members}
          agentActors={commentsProps.agentActors}
        />
      ) : (
        <TaskDetailComments {...commentsProps} />
      )}
    </div>
  )
}
```

- [ ] **Step 8: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/TaskDetailTimeline/
git commit -m "feat: add timeline UI components (tabs, activity feed, cards) [LUM-0]"
```

---

## Task 12: Integrate Timeline into Task Detail Page

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`

- [ ] **Step 1: Replace TaskDetailComments with TimelineTabs**

In `TaskDetailPage.tsx`:

1. Add import:

```typescript
import { TimelineTabs } from '../TaskDetailTimeline/TimelineTabs'
```

2. Replace the `<TaskDetailComments .../>` block (around line 332-344) with:

```typescript
{/* Activity / Comments Timeline */}
<TimelineTabs
  taskId={task.id}
  commentsProps={{
    workspaceUrl,
    projectName: task.project.name,
    teamIdentifier: task.teamIdentifier,
    taskNumber: task.number,
    members,
    agentActors,
    mentionableMembers,
    currentActorId: currentMember?.actorId,
    user,
    tc,
  }}
/>
```

3. Remove the direct `TaskDetailComments` import if it's no longer used elsewhere in this file (it's now imported inside `TimelineTabs`).

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx
git commit -m "feat: integrate timeline tabs into task detail page [LUM-0]"
```

---

## Task 13: Final Integration Test

- [ ] **Step 1: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests PASS.

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run linter**

Run: `npx next lint`
Expected: No errors.

- [ ] **Step 4: Manual verification checklist**

- Start dev server: `npm run dev`
- Navigate to a task detail page
- Verify Activity/Comments tabs appear
- Verify Activity tab shows existing data (may be empty if no events recorded yet)
- Verify Comments tab shows existing comments
- Make a status change on the task, refresh Activity tab — should show the change
- Add a comment — should appear in both tabs
- Verify no console errors

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address integration issues from task activities [LUM-0]"
```
