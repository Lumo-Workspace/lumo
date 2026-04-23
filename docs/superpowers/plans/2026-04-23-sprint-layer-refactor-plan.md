# Sprint 域分层重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `sprint.service.ts` / `sprint-summary.service.ts` / `sprint-notifications.service.ts` 里的 20 处 Prisma 违规下沉到 repository 层；重写 2 个既有测试 + 新建 1 个，采用 mock-repository 策略；Sprint 域 `any` 归零。

**Architecture:** D2+ 事务模式 —— 大业务操作（`startAtomically` / `closeAtomically` / `addTaskAtomically` / `removeTaskAtomically`）在 `sprint.repository.ts` 内 `prisma.$transaction` 封装；跨领域查询通过 `tx?: Prisma.TransactionClient` 参数协作。Service 不再 `import { prisma }`。

**Tech Stack:** TypeScript strict, Prisma, Jest, jest.mock。

**Spec**: `docs/superpowers/specs/2026-04-23-sprint-layer-refactor-design.md`

**Branch**: `lumo/LUM-N-sprint-layer-refactor`（在 Task 0 创建）

---

## Task 0: 准备分支

**Files:** （无代码变更）

- [ ] **Step 0.1: 确认工作目录干净**

```bash
git status
```

Expected: `nothing to commit, working tree clean`（若不干净，先让用户处理）

- [ ] **Step 0.2: 基于最新 main 开分支**

```bash
git checkout main && git pull --ff-only && git checkout -b lumo/LUM-N-sprint-layer-refactor
```

Expected: `Switched to a new branch 'lumo/LUM-N-sprint-layer-refactor'`

---

## Task 1: 新建 `lib/db/errors.ts` + 单测

**Files:**

- Create: `lib/db/errors.ts`
- Create: `__tests__/lib/db/errors.test.ts`

**Rationale**: 统一封装 Prisma error code 判断，消除 `catch (err: any)` 里的 `err?.code === 'P2002'` 散点。

- [ ] **Step 1.1: Write the failing test**

Create `__tests__/lib/db/errors.test.ts`:

```typescript
import { isPrismaUniqueViolation } from '@/lib/db/errors'

describe('isPrismaUniqueViolation', () => {
  it('returns true for objects with code=P2002', () => {
    expect(isPrismaUniqueViolation({ code: 'P2002' })).toBe(true)
  })

  it('returns true for Error objects with code=P2002', () => {
    const err = Object.assign(new Error('unique'), { code: 'P2002' })
    expect(isPrismaUniqueViolation(err)).toBe(true)
  })

  it('returns false for other Prisma codes', () => {
    expect(isPrismaUniqueViolation({ code: 'P2025' })).toBe(false)
  })

  it('returns false for plain Error', () => {
    expect(isPrismaUniqueViolation(new Error('boom'))).toBe(false)
  })

  it('returns false for null/undefined/string', () => {
    expect(isPrismaUniqueViolation(null)).toBe(false)
    expect(isPrismaUniqueViolation(undefined)).toBe(false)
    expect(isPrismaUniqueViolation('P2002')).toBe(false)
  })
})
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
npx jest __tests__/lib/db/errors.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/db/errors'`

- [ ] **Step 1.3: Write minimal implementation**

Create `lib/db/errors.ts`:

```typescript
/**
 * Narrow type guards for Prisma known-request errors.
 *
 * Only P2002 is implemented because that's what the current refactor needs.
 * Extend here when other domains need P2025 / P2003 / etc.
 */
export function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  )
}
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
npx jest __tests__/lib/db/errors.test.ts
```

Expected: PASS, 5 tests passing.

- [ ] **Step 1.5: Commit**

```bash
git add lib/db/errors.ts __tests__/lib/db/errors.test.ts
git commit -m "feat(db): add isPrismaUniqueViolation type guard [LUM-N]"
```

---

## Task 2: 新建 `lib/repositories/team.repository.ts`

**Files:**

- Create: `lib/repositories/team.repository.ts`

**Rationale**: Sprint service 要查 Team 实体 3 次（`sprintsEnabled`、cadence 更新、cadence 读取）。新建专属 repository 保持按实体分层。

- [ ] **Step 2.1: 读参考模式**

Read the top 40 lines of `lib/repositories/sprint-summary.repository.ts` to match the `export const xxxRepository = { ... }` object pattern and JSDoc style.

- [ ] **Step 2.2: Write the file**

Create `lib/repositories/team.repository.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'

export interface UpdateSprintCadenceInput {
  enabled?: boolean
  durationDays?: number
  cooldownDays?: number
  startWeekday?: number
  autoCreate?: number
}

export const teamRepository = {
  /** Read only the fields needed to decide whether the team can create sprints. */
  async findSprintGatingConfig(teamId: string) {
    return prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, sprintsEnabled: true },
    })
  },

  /**
   * Read the cadence config used by sprintService.ensureFutureSprints().
   * Returns null when the team does not exist.
   */
  async findSprintCadenceConfig(teamId: string) {
    return prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        sprintsEnabled: true,
        sprintDurationDays: true,
        sprintCooldownDays: true,
        sprintStartWeekday: true,
        sprintAutoCreate: true,
      },
    })
  },

  /** Update sprint cadence fields on the team row. Only provided keys are persisted. */
  async updateSprintCadence(teamId: string, input: UpdateSprintCadenceInput) {
    return prisma.team.update({
      where: { id: teamId },
      data: {
        ...(input.enabled !== undefined
          ? { sprintsEnabled: input.enabled }
          : {}),
        ...(input.durationDays !== undefined
          ? { sprintDurationDays: input.durationDays }
          : {}),
        ...(input.cooldownDays !== undefined
          ? { sprintCooldownDays: input.cooldownDays }
          : {}),
        ...(input.startWeekday !== undefined
          ? { sprintStartWeekday: input.startWeekday }
          : {}),
        ...(input.autoCreate !== undefined
          ? { sprintAutoCreate: input.autoCreate }
          : {}),
      },
    })
  },
}
```

- [ ] **Step 2.3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors (may show pre-existing errors unrelated to this file — acceptable as long as nothing new appears).

- [ ] **Step 2.4: Commit**

```bash
git add lib/repositories/team.repository.ts
git commit -m "feat(repositories): add team.repository with sprint-cadence queries [LUM-N]"
```

---

## Task 3: 新建 `lib/repositories/sprint-notifications.repository.ts`

**Files:**

- Create: `lib/repositories/sprint-notifications.repository.ts`

- [ ] **Step 3.1: Write the file**

Create `lib/repositories/sprint-notifications.repository.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'

export const sprintNotificationsRepository = {
  /**
   * Return the deduped actor IDs for all members of the given team.
   * Used by dispatchSprintNotification() to find recipients for
   * SPRINT_STARTED / SPRINT_CLOSED notifications.
   */
  async findTeamActorIds(teamId: string): Promise<string[]> {
    const members = await prisma.teamMember.findMany({
      where: { teamId },
      select: { member: { select: { actor: { select: { id: true } } } } },
    })
    const ids = members
      .map(m => m.member.actor?.id)
      .filter((x): x is string => !!x)
    return Array.from(new Set(ids))
  },
}
```

- [ ] **Step 3.2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3.3: Commit**

```bash
git add lib/repositories/sprint-notifications.repository.ts
git commit -m "feat(repositories): add sprint-notifications.repository.findTeamActorIds [LUM-N]"
```

---

## Task 4: 扩展 `lib/repositories/task.repository.ts`（加 tx-aware 方法）

**Files:**

- Modify: `lib/repositories/task.repository.ts`

**Rationale**: Sprint domain 事务需要在 tx 内查/找 Task。既有方法只有 `bulkUpdateSprint(taskIds, sprintId, tx?)` 支持 tx，还缺 3 个。

- [ ] **Step 4.1: Read current shape**

Read `lib/repositories/task.repository.ts` (last 100 lines) to find a good insertion point. Add new methods before the final closing `}` of the `taskRepository` object.

- [ ] **Step 4.2: Add methods**

Add the following methods to `taskRepository` (before the closing `}`):

```typescript
  /**
   * Lightweight lookup returning only fields sprintService needs for gate checks.
   * Used by addTaskToSprint / removeTaskFromSprint to validate team match
   * and membership without loading unrelated fields.
   */
  async findMinimalById(
    taskId: string,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.task.findUnique({
      where: { id: taskId },
      select: { id: true, teamId: true, sprintId: true },
    })
  },

  /**
   * Return all tasks on `sprintId` whose status is not DONE.
   * Used inside sprint close to decide which tasks need a spillover decision.
   * Must be called within a transaction — no default prisma fallback.
   */
  async findUnfinishedBySprint(
    sprintId: string,
    tx: Prisma.TransactionClient
  ) {
    return tx.task.findMany({
      where: { sprintId, status: { not: 'DONE' } },
      select: { id: true, status: true },
    })
  },

  /**
   * Return the minimal task fields needed for sprint-summary stats.
   * Used by sprintSummaryRepository.computeStatsData().
   */
  async listBySprintForStats(
    sprintId: string,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.task.findMany({
      where: { sprintId },
      select: {
        id: true,
        status: true,
        priority: true,
        assigneeActorId: true,
        title: true,
      },
    })
  },
```

- [ ] **Step 4.3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4.4: Run existing task tests to verify no regression**

```bash
npm test -- __tests__/lib/services/task.service.test.ts __tests__/task.service.sprint.test.ts __tests__/lib/services/task-service-automation.test.ts __tests__/lib/services/task-service-reopen.test.ts __tests__/lib/services/task.service.link-pr.test.ts
```

Expected: all green (existing methods unchanged, new methods additive).

- [ ] **Step 4.5: Commit**

```bash
git add lib/repositories/task.repository.ts
git commit -m "refactor(repositories): add tx-aware task lookups for sprint domain [LUM-N]"
```

---

## Task 5: 扩展 `lib/repositories/activity.repository.ts`

**Files:**

- Modify: `lib/repositories/activity.repository.ts`

**Rationale**: Sprint close / add-task / remove-task 都要写 `SPRINT_CHANGED` activity；sprint-summary stats 要读 spillover activities.

- [ ] **Step 5.1: Replace the file**

Replace `lib/repositories/activity.repository.ts` entirely. The existing file is 47 lines; new methods are added and the `tx?: any` on the existing `create()` is tightened to `Prisma.TransactionClient`.

```typescript
import { prisma } from '@/lib/db/prisma'
import type { Prisma, TaskActivityType } from '@prisma/client'

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

export interface SprintChangedPayload {
  fromSprintId: string | null
  toSprintId: string | null
  reason: 'spillover' | 'planning'
}

export interface CreateSprintChangedInput {
  taskId: string
  actorId: string | null
  payload: SprintChangedPayload
}

const ACTOR_SELECT = {
  select: {
    id: true,
    type: true,
    member: { select: { id: true, clerkId: true } },
    agent: { select: { id: true, name: true, avatarColor: true } },
  },
} as const

export const activityRepository = {
  async create(data: CreateActivityData, tx?: Prisma.TransactionClient) {
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

  /**
   * Create a single SPRINT_CHANGED activity. Used inside sprintRepository
   * atomic methods (add/remove task). `tx` is required because every call
   * site is inside a transaction.
   */
  async createSprintChanged(
    input: CreateSprintChangedInput,
    tx: Prisma.TransactionClient
  ) {
    return tx.taskActivity.create({
      data: {
        taskId: input.taskId,
        actorId: input.actorId,
        type: 'SPRINT_CHANGED',
        payload: input.payload as unknown as Prisma.InputJsonValue,
      },
    })
  },

  /**
   * Bulk-create SPRINT_CHANGED activities during sprint close.
   * `skipDuplicates` matches the pre-refactor behavior.
   */
  async createManySprintChanged(
    inputs: CreateSprintChangedInput[],
    tx: Prisma.TransactionClient
  ) {
    if (inputs.length === 0) return { count: 0 }
    return tx.taskActivity.createMany({
      data: inputs.map(i => ({
        taskId: i.taskId,
        actorId: i.actorId,
        type: 'SPRINT_CHANGED' as const,
        payload: i.payload as unknown as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    })
  },

  /**
   * List SPRINT_CHANGED activities whose payload.fromSprintId matches the
   * given sprint — i.e. tasks that spilled out of this sprint. Used by
   * sprintSummaryRepository.computeStatsData() to count spillover.
   */
  async listSpilloverFromSprint(
    sprintId: string,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.taskActivity.findMany({
      where: {
        type: 'SPRINT_CHANGED',
        payload: { path: ['fromSprintId'], equals: sprintId },
      },
      select: { taskId: true, payload: true },
    })
  },
}
```

- [ ] **Step 5.2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors. If `activityRepository.create(..., tx?: any)` was called elsewhere with anything incompatible with `Prisma.TransactionClient`, fix the caller — but we did not change the runtime behavior, only tightened the type.

- [ ] **Step 5.3: Run existing tests that may touch activityRepository**

```bash
npm test -- __tests__/lib/services/comment.service.test.ts __tests__/lib/services/task.service.test.ts __tests__/task.service.sprint.test.ts __tests__/lib/services/timeline.service.test.ts
```

Expected: all green.

- [ ] **Step 5.4: Commit**

```bash
git add lib/repositories/activity.repository.ts
git commit -m "refactor(repositories): add tx-aware sprint-changed activity methods [LUM-N]"
```

---

## Task 6: 扩展 `lib/repositories/generation-job.repository.ts`

**Files:**

- Modify: `lib/repositories/generation-job.repository.ts`

**Rationale**: Sprint close 要在事务内创建 pending GenerationJob；sprint-summary generate 要查 pending / mark completed / mark failed.

- [ ] **Step 6.1: Replace the file**

```typescript
import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'

export const generationJobRepository = {
  async findRecentByTarget(targetId: string, cooldownMinutes: number) {
    const since = new Date(Date.now() - cooldownMinutes * 60 * 1000)
    return prisma.generationJob.findFirst({
      where: {
        targetId,
        status: { in: ['pending', 'completed'] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
    })
  },

  async create(type: 'project' | 'workspace', targetId: string) {
    return prisma.generationJob.create({
      data: { type, targetId },
    })
  },

  async updateStatus(
    id: string,
    status: 'completed' | 'failed',
    summaryId?: string
  ) {
    return prisma.generationJob.update({
      where: { id },
      data: { status, ...(summaryId ? { summaryId } : {}) },
    })
  },

  async findById(id: string) {
    return prisma.generationJob.findFirst({
      where: { id },
    })
  },

  async deleteOlderThan(days: number) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    return prisma.generationJob.deleteMany({
      where: { createdAt: { lt: cutoff } },
    })
  },

  // ── Sprint-domain additions ──────────────────────────────────────────────

  /**
   * Create a pending GenerationJob for a sprint retro. Called inside
   * sprintRepository.closeAtomically — tx is required.
   */
  async createSprintPending(sprintId: string, tx: Prisma.TransactionClient) {
    return tx.generationJob.create({
      data: { type: 'sprint', targetId: sprintId, status: 'pending' },
    })
  },

  /**
   * Most-recent pending GenerationJob for a sprint, if any.
   * sprintSummaryService.generate looks this up to mark completed/failed later.
   */
  async findPendingSprintJob(sprintId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.generationJob.findFirst({
      where: { type: 'sprint', targetId: sprintId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    })
  },

  /** Mark a specific GenerationJob as completed with its produced summary. */
  async markCompleted(
    jobId: string,
    summaryId: string,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.generationJob.update({
      where: { id: jobId },
      data: { status: 'completed', summaryId },
    })
  },

  /** Mark a specific GenerationJob as failed. */
  async markFailed(jobId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.generationJob.update({
      where: { id: jobId },
      data: { status: 'failed' },
    })
  },
}
```

- [ ] **Step 6.2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 6.3: Commit**

```bash
git add lib/repositories/generation-job.repository.ts
git commit -m "refactor(repositories): add tx-aware sprint generation-job methods [LUM-N]"
```

---

## Task 7: 扩展 `lib/repositories/sprint-summary.repository.ts` with `computeStatsData`

**Files:**

- Modify: `lib/repositories/sprint-summary.repository.ts`

**Rationale**: Stats 聚合是纯数据逻辑，从 service 下沉到 repository。

- [ ] **Step 7.1: Replace the file**

```typescript
import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'
import { taskRepository } from '@/lib/repositories/task.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'

export interface SprintSummaryData {
  stats: Prisma.InputJsonValue
  tldr: string
  report: string
}

export interface SprintStats {
  totalTasks: number
  done: number
  spillover: number
  byPriority: Record<string, number>
  byAssignee: Record<string, number>
}

export interface SprintStatsData {
  stats: SprintStats
  tasks: Array<{
    id: string
    status: string
    priority: string
    assigneeActorId: string | null
    title: string
  }>
}

export const sprintSummaryRepository = {
  async findBySprintId(sprintId: string) {
    return prisma.sprintSummary.findUnique({ where: { sprintId } })
  },

  async save(sprintId: string, data: SprintSummaryData) {
    return prisma.sprintSummary.upsert({
      where: { sprintId },
      create: { sprintId, ...data },
      update: { ...data, generatedAt: new Date() },
    })
  },

  /**
   * Load tasks and spillover activities for the given sprint, then aggregate
   * the stats snapshot persisted on SprintSummary. Service calls this then
   * hands tasks + stats to the LLM.
   */
  async computeStatsData(sprintId: string): Promise<SprintStatsData> {
    const tasks = await taskRepository.listBySprintForStats(sprintId)
    const spilloverActivities =
      await activityRepository.listSpilloverFromSprint(sprintId)
    const spilloverCount = spilloverActivities.length

    const stats: SprintStats = {
      totalTasks: tasks.length + spilloverCount,
      done: tasks.filter(t => t.status === 'DONE').length,
      spillover: spilloverCount,
      byPriority: tasks.reduce<Record<string, number>>((acc, t) => {
        acc[t.priority] = (acc[t.priority] ?? 0) + 1
        return acc
      }, {}),
      byAssignee: tasks.reduce<Record<string, number>>((acc, t) => {
        const key = t.assigneeActorId ?? 'unassigned'
        acc[key] = (acc[key] ?? 0) + 1
        return acc
      }, {}),
    }
    return { stats, tasks }
  },
}
```

- [ ] **Step 7.2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 7.3: Commit**

```bash
git add lib/repositories/sprint-summary.repository.ts
git commit -m "refactor(repositories): sink sprint-summary stats aggregation to repository [LUM-N]"
```

---

## Task 8: `sprint.repository.ts` — add `startAtomically`

**Files:**

- Modify: `lib/repositories/sprint.repository.ts`

**Rationale**: Wrap the `$transaction` from `sprint.service.ts:58-82` into a repository method.

- [ ] **Step 8.1: Read current sprint.repository.ts**

Re-read `lib/repositories/sprint.repository.ts` to locate the end of the `sprintRepository` object. Also note the existing `httpError` / `Object.assign(new Error(msg), { status })` pattern must be added to this file because atomic methods will throw it.

- [ ] **Step 8.2: Update imports and add helper**

At the top of `lib/repositories/sprint.repository.ts`, update the import line and add a helper. Replace:

```typescript
import { prisma } from '@/lib/db/prisma'
import type { SprintStatus, Prisma } from '@prisma/client'
```

with:

```typescript
import { prisma } from '@/lib/db/prisma'
import type { SprintStatus, Prisma } from '@prisma/client'
import { isPrismaUniqueViolation } from '@/lib/db/errors'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}
```

- [ ] **Step 8.3: Add `startAtomically` at the end of the object (before the final `})`**

```typescript
  /**
   * Transition a DRAFT sprint to ACTIVE, checking there isn't already an
   * ACTIVE sprint on the team. Throws httpError with status 404/409 on
   * pre-condition failures. P2002 from a racing peer maps to 409.
   */
  async startAtomically(sprintId: string) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')

    return prisma.$transaction(
      async tx => {
        const locked = await sprintRepository.lockForUpdate(tx, sprintId)
        if (!locked) httpError(404, 'sprint not found')
        if (locked.status !== 'DRAFT')
          httpError(409, `cannot start sprint in ${locked.status} state`)

        const active = await sprintRepository.findActiveByTeam(sprint.teamId)
        if (active && active.id !== sprintId) {
          httpError(409, `team already has ACTIVE sprint ${active.id}`)
        }

        try {
          return await sprintRepository.update(sprintId, {
            status: 'ACTIVE',
            startedAt: new Date(),
          })
        } catch (err) {
          if (isPrismaUniqueViolation(err))
            httpError(409, 'team already has ACTIVE sprint')
          throw err
        }
      },
      { timeout: 15000, maxWait: 5000 }
    )
  },
```

- [ ] **Step 8.4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 8.5: Commit**

```bash
git add lib/repositories/sprint.repository.ts lib/db/errors.ts
git commit -m "refactor(repositories): add sprintRepository.startAtomically [LUM-N]"
```

---

## Task 9: `sprint.repository.ts` — add `closeAtomically`

**Files:**

- Modify: `lib/repositories/sprint.repository.ts`

**Rationale**: Wrap the `$transaction` from `sprint.service.ts:103-203` (close + spillover + activity write + generation-job creation) into a single atomic method.

- [ ] **Step 9.1: Add imports for cross-repo calls**

At the top of `lib/repositories/sprint.repository.ts`, add:

```typescript
import { taskRepository } from '@/lib/repositories/task.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'
```

- [ ] **Step 9.2: Add the types for decisions**

Above the `httpError` helper, add:

```typescript
export type SpilloverDecision = 'moveToNext' | 'backToBacklog'
export type SprintCloseDecisions = Record<string, SpilloverDecision>
```

- [ ] **Step 9.3: Add `closeAtomically` method**

Insert after `startAtomically`:

```typescript
  /**
   * Transition an ACTIVE sprint to CLOSED, routing unfinished tasks per
   * `decisions`. Each unfinished task MUST appear in `decisions` with either
   * 'moveToNext' (goes to the next DRAFT sprint) or 'backToBacklog' (sprintId
   * cleared). Creates SPRINT_CHANGED activities and a pending GenerationJob
   * for retro summary generation.
   */
  async closeAtomically(
    sprintId: string,
    decisions: SprintCloseDecisions,
    actorId: string | null
  ) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')

    return prisma.$transaction(
      async tx => {
        const locked = await sprintRepository.lockForUpdate(tx, sprintId)
        if (!locked) httpError(404, 'sprint not found')
        if (locked.status !== 'ACTIVE')
          httpError(409, `cannot close sprint in ${locked.status} state`)

        const unfinished = await taskRepository.findUnfinishedBySprint(
          sprintId,
          tx
        )
        const unfinishedIds = new Set(unfinished.map(t => t.id))
        const decisionIds = new Set(Object.keys(decisions))

        for (const id of unfinishedIds) {
          if (!decisionIds.has(id)) {
            httpError(400, `decision missing for task ${id}`)
          }
        }
        for (const id of decisionIds) {
          if (!unfinishedIds.has(id)) {
            httpError(409, 'sprint membership changed; reopen close dialog')
          }
        }

        let nextSprintId: string | null = null
        const needsNext = Object.values(decisions).some(d => d === 'moveToNext')
        if (needsNext) {
          const drafts = await sprintRepository.listByTeam(sprint.teamId, {
            status: 'DRAFT',
            limit: 1,
          })
          if (drafts.length > 0 && drafts[0]) {
            nextSprintId = drafts[0].id
          } else {
            httpError(
              409,
              'no draft sprint to receive spillover; create one first'
            )
          }
        }

        const toNext: string[] = []
        const toBacklog: string[] = []
        for (const [taskId, d] of Object.entries(decisions)) {
          if (d === 'moveToNext') toNext.push(taskId)
          else toBacklog.push(taskId)
        }
        if (toNext.length) {
          await taskRepository.bulkUpdateSprint(toNext, nextSprintId!, tx)
        }
        if (toBacklog.length) {
          await taskRepository.bulkUpdateSprint(toBacklog, null, tx)
        }

        const activities = [
          ...toNext.map(taskId => ({
            taskId,
            actorId,
            payload: {
              fromSprintId: sprintId,
              toSprintId: nextSprintId,
              reason: 'spillover' as const,
            },
          })),
          ...toBacklog.map(taskId => ({
            taskId,
            actorId,
            payload: {
              fromSprintId: sprintId,
              toSprintId: null,
              reason: 'spillover' as const,
            },
          })),
        ]
        if (activities.length) {
          await activityRepository.createManySprintChanged(activities, tx)
        }

        const closed = await sprintRepository.update(sprintId, {
          status: 'CLOSED',
          closedAt: new Date(),
        })

        await generationJobRepository.createSprintPending(sprintId, tx)

        return closed
      },
      { timeout: 15000, maxWait: 5000 }
    )
  },
```

- [ ] **Step 9.4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 9.5: Commit**

```bash
git add lib/repositories/sprint.repository.ts
git commit -m "refactor(repositories): add sprintRepository.closeAtomically [LUM-N]"
```

---

## Task 10: `sprint.repository.ts` — add `addTaskAtomically` + `removeTaskAtomically`

**Files:**

- Modify: `lib/repositories/sprint.repository.ts`

- [ ] **Step 10.1: Add methods**

Insert after `closeAtomically`:

```typescript
  /**
   * Move `taskId` into `sprintId`, with pre-condition checks (task exists,
   * sprint exists, team matches, sprint not CLOSED). Idempotent when the
   * task is already on the target sprint. Emits a SPRINT_CHANGED activity.
   */
  async addTaskAtomically(
    taskId: string,
    sprintId: string,
    actorId: string | null
  ) {
    const task = await taskRepository.findMinimalById(taskId)
    if (!task) httpError(404, 'task not found')
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')
    if (task.teamId !== sprint.teamId)
      httpError(400, 'task and sprint belong to different teams')
    if (sprint.status === 'CLOSED') httpError(409, 'sprint is closed')

    return prisma.$transaction(
      async tx => {
        await sprintRepository.lockForUpdate(tx, sprintId)
        const fromSprintId = task.sprintId
        // No-op when the task is already in this sprint — avoids writing
        // a SPRINT_CHANGED activity with fromSprintId === toSprintId when
        // two concurrent planning actions race.
        if (fromSprintId === sprintId) return { taskId, sprintId }
        await taskRepository.bulkUpdateSprint([taskId], sprintId, tx)
        await activityRepository.createSprintChanged(
          {
            taskId,
            actorId,
            payload: {
              fromSprintId,
              toSprintId: sprintId,
              reason: 'planning',
            },
          },
          tx
        )
        return { taskId, sprintId }
      },
      { timeout: 15000, maxWait: 5000 }
    )
  },

  /**
   * Remove `taskId` from whatever sprint it's on (sets sprintId=null).
   * No-op when the task has no sprint. Refuses when the current sprint is
   * CLOSED. Emits a SPRINT_CHANGED activity when a move occurs.
   */
  async removeTaskAtomically(taskId: string, actorId: string | null) {
    const task = await taskRepository.findMinimalById(taskId)
    if (!task) httpError(404, 'task not found')
    if (!task.sprintId) return { taskId, sprintId: null }

    const sprint = await sprintRepository.findById(task.sprintId)
    if (sprint && sprint.status === 'CLOSED') {
      httpError(409, 'cannot remove task from closed sprint')
    }

    return prisma.$transaction(
      async tx => {
        if (task.sprintId)
          await sprintRepository.lockForUpdate(tx, task.sprintId)
        await taskRepository.bulkUpdateSprint([taskId], null, tx)
        await activityRepository.createSprintChanged(
          {
            taskId,
            actorId,
            payload: {
              fromSprintId: task.sprintId,
              toSprintId: null,
              reason: 'planning',
            },
          },
          tx
        )
        return { taskId, sprintId: null }
      },
      { timeout: 15000, maxWait: 5000 }
    )
  },
```

- [ ] **Step 10.2: Fix existing any in `countTasks`**

Inside `sprint.repository.ts`, locate the existing `countTasks` method:

```typescript
  async countTasks(sprintId: string, filter: { status?: string } = {}) {
    return prisma.task.count({
      where: {
        sprintId,
        ...(filter.status ? { status: filter.status as any } : {}),
      },
    })
  },
```

Replace with:

```typescript
  async countTasks(sprintId: string, filter: { status?: TaskStatus } = {}) {
    return prisma.task.count({
      where: {
        sprintId,
        ...(filter.status ? { status: filter.status } : {}),
      },
    })
  },
```

And update the existing import at top of `sprint.repository.ts`:

```typescript
import type { SprintStatus, TaskStatus, Prisma } from '@prisma/client'
```

- [ ] **Step 10.3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors. If call sites of `countTasks` pass a string that isn't a `TaskStatus`, fix the caller (but the prior type was `string` so legitimate usage should already satisfy the narrower enum).

- [ ] **Step 10.4: Verify no any in sprint.repository.ts**

```bash
grep -E ":\s*any\b|\bas\s+any\b" lib/repositories/sprint.repository.ts
```

Expected: empty.

- [ ] **Step 10.5: Commit**

```bash
git add lib/repositories/sprint.repository.ts
git commit -m "refactor(repositories): add sprint add/remove-task atomics + fix countTasks any [LUM-N]"
```

---

## Task 11: Refactor `sprint-notifications.service.ts` + create its test

**Files:**

- Modify: `lib/services/sprint-notifications.service.ts`
- Create: `__tests__/sprint-notifications.service.test.ts`

**Rationale**: Smallest of the three services — ideal warm-up for the TDD cycle.

- [ ] **Step 11.1: Write the failing test**

Create `__tests__/sprint-notifications.service.test.ts`:

```typescript
import { dispatchSprintNotification } from '@/lib/services/sprint-notifications.service'

const mockFindTeamActorIds = jest.fn()
const mockCreateMany = jest.fn()

jest.mock('@/lib/repositories/sprint-notifications.repository', () => ({
  sprintNotificationsRepository: {
    findTeamActorIds: (...a: any[]) => mockFindTeamActorIds(...a),
  },
}))

jest.mock('@/lib/repositories/notification.repository', () => ({
  notificationRepository: {
    createMany: (...a: any[]) => mockCreateMany(...a),
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('dispatchSprintNotification', () => {
  it('creates a SPRINT_STARTED notification per recipient', async () => {
    mockFindTeamActorIds.mockResolvedValueOnce(['a1', 'a2'])
    mockCreateMany.mockResolvedValueOnce({ count: 2 })

    await dispatchSprintNotification(
      'sprint-1',
      'team-1',
      'ws-1',
      'SPRINT_STARTED',
      'actor-x'
    )

    expect(mockFindTeamActorIds).toHaveBeenCalledWith('team-1')
    expect(mockCreateMany).toHaveBeenCalledWith([
      {
        workspaceId: 'ws-1',
        recipientActorId: 'a1',
        type: 'SPRINT_STARTED',
        sprintId: 'sprint-1',
        triggerActorId: 'actor-x',
      },
      {
        workspaceId: 'ws-1',
        recipientActorId: 'a2',
        type: 'SPRINT_STARTED',
        sprintId: 'sprint-1',
        triggerActorId: 'actor-x',
      },
    ])
  })

  it('creates a SPRINT_CLOSED notification per recipient', async () => {
    mockFindTeamActorIds.mockResolvedValueOnce(['a1'])
    mockCreateMany.mockResolvedValueOnce({ count: 1 })

    await dispatchSprintNotification(
      'sprint-1',
      'team-1',
      'ws-1',
      'SPRINT_CLOSED',
      null
    )

    expect(mockCreateMany).toHaveBeenCalledWith([
      {
        workspaceId: 'ws-1',
        recipientActorId: 'a1',
        type: 'SPRINT_CLOSED',
        sprintId: 'sprint-1',
        triggerActorId: null,
      },
    ])
  })

  it('is a no-op when the team has no actors', async () => {
    mockFindTeamActorIds.mockResolvedValueOnce([])

    await dispatchSprintNotification(
      'sprint-1',
      'team-1',
      'ws-1',
      'SPRINT_STARTED',
      'actor-x'
    )

    expect(mockCreateMany).not.toHaveBeenCalled()
  })

  it('handles triggerActorId=null without throwing', async () => {
    mockFindTeamActorIds.mockResolvedValueOnce(['a1'])
    mockCreateMany.mockResolvedValueOnce({ count: 1 })

    await expect(
      dispatchSprintNotification(
        'sprint-1',
        'team-1',
        'ws-1',
        'SPRINT_STARTED',
        null
      )
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 11.2: Run test to verify it fails**

```bash
npm test -- __tests__/sprint-notifications.service.test.ts
```

Expected: FAIL — service still imports `{ prisma }` and calls `prisma.teamMember.findMany`, which isn't mocked. Assertions about `findTeamActorIds` not called.

- [ ] **Step 11.3: Refactor the service**

Replace `lib/services/sprint-notifications.service.ts` entirely:

```typescript
import { notificationRepository } from '@/lib/repositories/notification.repository'
import { sprintNotificationsRepository } from '@/lib/repositories/sprint-notifications.repository'
import type { NotificationType } from '@prisma/client'

/**
 * Dispatch SPRINT_STARTED or SPRINT_CLOSED notifications to all team members.
 * Fire-and-forget — call with .catch(err => void err) from the service.
 */
export async function dispatchSprintNotification(
  sprintId: string,
  teamId: string,
  workspaceId: string,
  type: Extract<NotificationType, 'SPRINT_STARTED' | 'SPRINT_CLOSED'>,
  triggerActorId: string | null
): Promise<void> {
  const recipientActorIds =
    await sprintNotificationsRepository.findTeamActorIds(teamId)

  if (recipientActorIds.length === 0) return

  await notificationRepository.createMany(
    recipientActorIds.map(actorId => ({
      workspaceId,
      recipientActorId: actorId,
      type,
      sprintId,
      triggerActorId,
    }))
  )
}
```

- [ ] **Step 11.4: Run test to verify it passes**

```bash
npm test -- __tests__/sprint-notifications.service.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 11.5: Verify no prisma reference left**

```bash
grep -E "@/lib/db/prisma|\bprisma\." lib/services/sprint-notifications.service.ts
```

Expected: empty.

- [ ] **Step 11.6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 11.7: Commit**

```bash
git add lib/services/sprint-notifications.service.ts __tests__/sprint-notifications.service.test.ts
git commit -m "refactor(services): sprint-notifications.service.ts bypass prisma via repository [LUM-N]"
```

---

## Task 12: Refactor `sprint-summary.service.ts` + rewrite its test

**Files:**

- Modify: `lib/services/sprint-summary.service.ts`
- Modify: `__tests__/sprint-summary.service.test.ts` (complete rewrite)

**Rationale**: Medium complexity. Service shrinks to pure orchestration.

- [ ] **Step 12.1: Rewrite the test file (replace entirely)**

Replace `__tests__/sprint-summary.service.test.ts` entirely:

```typescript
import { sprintSummaryService } from '@/lib/services/sprint-summary.service'

const mockFindSprint = jest.fn()
const mockComputeStatsData = jest.fn()
const mockSave = jest.fn()
const mockLLM = jest.fn()
const mockFindPendingSprintJob = jest.fn()
const mockMarkCompleted = jest.fn()
const mockMarkFailed = jest.fn()

jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: {
    findById: (...a: any[]) => mockFindSprint(...a),
  },
}))

jest.mock('@/lib/repositories/sprint-summary.repository', () => ({
  sprintSummaryRepository: {
    save: (...a: any[]) => mockSave(...a),
    computeStatsData: (...a: any[]) => mockComputeStatsData(...a),
  },
}))

jest.mock('@/lib/repositories/generation-job.repository', () => ({
  generationJobRepository: {
    findPendingSprintJob: (...a: any[]) => mockFindPendingSprintJob(...a),
    markCompleted: (...a: any[]) => mockMarkCompleted(...a),
    markFailed: (...a: any[]) => mockMarkFailed(...a),
  },
}))

jest.mock('@/lib/llm/sprint-summary-client', () => ({
  callSprintSummaryLLM: (...a: any[]) => mockLLM(...a),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockFindPendingSprintJob.mockResolvedValue(null)
})

const CLOSED_SPRINT = {
  id: 'sprint-1',
  teamId: 'team-1',
  name: 'Sprint 3',
  status: 'CLOSED',
  startDate: new Date('2026-04-06'),
  endDate: new Date('2026-04-20'),
}

const STATS_DATA = {
  stats: {
    totalTasks: 3,
    done: 2,
    spillover: 1,
    byPriority: { HIGH: 2, LOW: 1 },
    byAssignee: { a1: 2, unassigned: 1 },
  },
  tasks: [
    {
      id: 't1',
      status: 'DONE',
      priority: 'HIGH',
      assigneeActorId: 'a1',
      title: 'one',
    },
  ],
}

describe('sprintSummaryService.generate', () => {
  it('happy path: closed sprint → computeStats → LLM → save', async () => {
    mockFindSprint.mockResolvedValueOnce(CLOSED_SPRINT)
    mockComputeStatsData.mockResolvedValueOnce(STATS_DATA)
    mockLLM.mockResolvedValueOnce({ tldr: 'tldr', report: 'report' })
    mockSave.mockResolvedValueOnce({ id: 'summary-1' })

    const result = await sprintSummaryService.generate('sprint-1')

    expect(mockFindSprint).toHaveBeenCalledWith('sprint-1')
    expect(mockComputeStatsData).toHaveBeenCalledWith('sprint-1')
    expect(mockLLM).toHaveBeenCalledWith({
      subject: 'Sprint 3',
      window: { start: CLOSED_SPRINT.startDate, end: CLOSED_SPRINT.endDate },
      stats: STATS_DATA.stats,
      tasks: STATS_DATA.tasks,
    })
    expect(mockSave).toHaveBeenCalledWith('sprint-1', {
      stats: STATS_DATA.stats,
      tldr: 'tldr',
      report: 'report',
    })
    expect(result).toEqual({ id: 'summary-1' })
    expect(mockMarkCompleted).not.toHaveBeenCalled()
    expect(mockMarkFailed).not.toHaveBeenCalled()
  })

  it('marks pending GenerationJob as completed with summaryId on success', async () => {
    mockFindSprint.mockResolvedValueOnce(CLOSED_SPRINT)
    mockFindPendingSprintJob.mockResolvedValueOnce({ id: 'job-1' })
    mockComputeStatsData.mockResolvedValueOnce(STATS_DATA)
    mockLLM.mockResolvedValueOnce({ tldr: 't', report: 'r' })
    mockSave.mockResolvedValueOnce({ id: 'summary-1' })
    mockMarkCompleted.mockResolvedValueOnce(undefined)

    await sprintSummaryService.generate('sprint-1')

    expect(mockMarkCompleted).toHaveBeenCalledWith('job-1', 'summary-1')
    expect(mockMarkFailed).not.toHaveBeenCalled()
  })

  it('throws 404 when sprint missing', async () => {
    mockFindSprint.mockResolvedValueOnce(null)
    await expect(
      sprintSummaryService.generate('missing')
    ).rejects.toMatchObject({ status: 404 })
    expect(mockComputeStatsData).not.toHaveBeenCalled()
  })

  it('throws 400 when sprint is not CLOSED', async () => {
    mockFindSprint.mockResolvedValueOnce({ ...CLOSED_SPRINT, status: 'ACTIVE' })
    await expect(
      sprintSummaryService.generate('sprint-1')
    ).rejects.toMatchObject({ status: 400 })
  })

  it('marks pending GenerationJob as failed when LLM throws', async () => {
    mockFindSprint.mockResolvedValueOnce(CLOSED_SPRINT)
    mockFindPendingSprintJob.mockResolvedValueOnce({ id: 'job-1' })
    mockComputeStatsData.mockResolvedValueOnce(STATS_DATA)
    mockLLM.mockRejectedValueOnce(new Error('llm down'))

    await expect(sprintSummaryService.generate('sprint-1')).rejects.toThrow(
      'llm down'
    )
    expect(mockMarkFailed).toHaveBeenCalledWith('job-1')
    expect(mockMarkCompleted).not.toHaveBeenCalled()
  })

  it('does not call markFailed when there is no pending job', async () => {
    mockFindSprint.mockResolvedValueOnce(CLOSED_SPRINT)
    mockFindPendingSprintJob.mockResolvedValueOnce(null)
    mockComputeStatsData.mockResolvedValueOnce(STATS_DATA)
    mockLLM.mockRejectedValueOnce(new Error('llm down'))

    await expect(sprintSummaryService.generate('sprint-1')).rejects.toThrow(
      'llm down'
    )
    expect(mockMarkFailed).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 12.2: Run test to verify it fails**

```bash
npm test -- __tests__/sprint-summary.service.test.ts
```

Expected: FAIL — service still imports prisma and directly calls it.

- [ ] **Step 12.3: Refactor the service**

Replace `lib/services/sprint-summary.service.ts` entirely:

```typescript
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import {
  sprintSummaryRepository,
  type SprintStats,
} from '@/lib/repositories/sprint-summary.repository'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'
import { callSprintSummaryLLM } from '@/lib/llm/sprint-summary-client'
import type { Prisma } from '@prisma/client'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

export type { SprintStats }

export const sprintSummaryService = {
  async generate(sprintId: string) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')
    if (sprint.status !== 'CLOSED') httpError(400, 'sprint is not closed')

    const pendingJob =
      await generationJobRepository.findPendingSprintJob(sprintId)

    try {
      const { stats, tasks } =
        await sprintSummaryRepository.computeStatsData(sprintId)

      const { tldr, report } = await callSprintSummaryLLM({
        subject: sprint.name,
        window: { start: sprint.startDate, end: sprint.endDate },
        stats,
        tasks,
      })

      const savedSummary = await sprintSummaryRepository.save(sprintId, {
        stats: stats as unknown as Prisma.InputJsonValue,
        tldr,
        report,
      })

      if (pendingJob) {
        await generationJobRepository.markCompleted(
          pendingJob.id,
          savedSummary.id
        )
      }

      return savedSummary
    } catch (err) {
      if (pendingJob) {
        await generationJobRepository.markFailed(pendingJob.id)
      }
      throw err
    }
  },
}
```

- [ ] **Step 12.4: Run tests**

```bash
npm test -- __tests__/sprint-summary.service.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 12.5: Verify no prisma reference**

```bash
grep -E "@/lib/db/prisma|\bprisma\." lib/services/sprint-summary.service.ts
```

Expected: empty (the `Prisma.InputJsonValue` import is `type-only`, via `import type { Prisma } from '@prisma/client'` — that's fine, it's not a prisma runtime import).

- [ ] **Step 12.6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 12.7: Commit**

```bash
git add lib/services/sprint-summary.service.ts __tests__/sprint-summary.service.test.ts
git commit -m "refactor(services): sprint-summary.service.ts bypass prisma via repositories [LUM-N]"
```

---

## Task 13: Refactor `sprint.service.ts` (scaffold + non-transactional methods)

**Files:**

- Modify: `lib/services/sprint.service.ts`

**Rationale**: `sprint.service.ts` is the biggest — we'll split into Task 13 (scaffold + simple methods) and Task 14 (rewrite test). The test rewrite dictates behavior; we do the service first so it type-checks, then rewrite the test to use the new mock strategy.

- [ ] **Step 13.1: Replace `sprint.service.ts` entirely**

Replace `lib/services/sprint.service.ts`:

```typescript
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { teamRepository } from '@/lib/repositories/team.repository'
import { sprintSummaryService } from '@/lib/services/sprint-summary.service'
import { dispatchSprintNotification } from '@/lib/services/sprint-notifications.service'
import { computeNextSprintWindow } from '@/lib/services/sprint-date'
import { isPrismaUniqueViolation } from '@/lib/db/errors'
import type { SprintCloseDecisions } from '@/lib/repositories/sprint.repository'

// Re-export for backward compatibility
export { nextUtcMondayMidnight, addDays } from '@/lib/services/sprint-date'
export type {
  SpilloverDecision,
  SprintCloseDecisions,
} from '@/lib/repositories/sprint.repository'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

export interface CreateDraftInput {
  name?: string
  startDate?: Date
  endDate?: Date
}

/** Minimal actor reference — the caller must have at least a memberId. */
export interface ActorRef {
  memberId: string | null
}

export const sprintService = {
  async createDraft(teamId: string, input: CreateDraftInput, _actor: ActorRef) {
    const team = await teamRepository.findSprintGatingConfig(teamId)
    if (!team) httpError(404, 'team not found')
    if (!team.sprintsEnabled) httpError(409, 'sprints not enabled for team')

    if (!input.startDate || !input.endDate) {
      httpError(400, 'startDate and endDate are required')
    }

    const number = await sprintRepository.nextNumberForTeam(teamId)
    const name = input.name?.trim() || `Sprint ${number}`

    return sprintRepository.create({
      teamId,
      number,
      name,
      startDate: input.startDate,
      endDate: input.endDate,
    })
  },

  async start(sprintId: string, actor: ActorRef & { id?: string }) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')

    const started = await sprintRepository.startAtomically(sprintId)

    dispatchSprintNotification(
      sprintId,
      sprint.teamId,
      sprint.team.workspaceId,
      'SPRINT_STARTED',
      actor.id ?? null
    ).catch(err => void err)

    return started
  },

  async close(
    sprintId: string,
    decisions: SprintCloseDecisions,
    actor: ActorRef & { id?: string }
  ) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')

    const closed = await sprintRepository.closeAtomically(
      sprintId,
      decisions,
      actor.id ?? null
    )

    // Fire-and-forget: kick off retro generation without blocking the HTTP response.
    // The GenerationJob created inside closeAtomically (status: 'pending') will be
    // updated to 'completed' or 'failed' by sprintSummaryService.generate.
    sprintSummaryService.generate(sprintId).catch(err => {
      void err
    })

    dispatchSprintNotification(
      sprintId,
      sprint.teamId,
      sprint.team.workspaceId,
      'SPRINT_CLOSED',
      actor.id ?? null
    ).catch(err => void err)

    return closed
  },

  async addTaskToSprint(
    taskId: string,
    sprintId: string,
    actor: ActorRef & { id?: string }
  ) {
    return sprintRepository.addTaskAtomically(
      taskId,
      sprintId,
      actor.id ?? null
    )
  },

  async removeTaskFromSprint(
    taskId: string,
    actor: ActorRef & { id?: string }
  ) {
    return sprintRepository.removeTaskAtomically(taskId, actor.id ?? null)
  },

  async moveTaskBetweenSprints(
    taskId: string,
    toSprintId: string,
    actor: ActorRef & { id?: string }
  ) {
    return sprintService.addTaskToSprint(taskId, toSprintId, actor)
  },

  /**
   * Update sprint metadata. Validates date ordering and checks that the new
   * date range doesn't overlap any other sprint on the same team. Two ranges
   * overlap iff `aStart <= bEnd && bStart <= aEnd` (endpoints inclusive).
   */
  async updateMeta(
    sprintId: string,
    input: { name?: string; startDate?: Date; endDate?: Date },
    _actor: ActorRef
  ) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')

    const newStart = input.startDate ?? sprint.startDate
    const newEnd = input.endDate ?? sprint.endDate
    if (newEnd <= newStart) {
      httpError(400, 'endDate must be after startDate')
    }

    if (input.startDate || input.endDate) {
      const others = await sprintRepository.listByTeam(sprint.teamId, {
        limit: 1000,
      })
      const overlap = others.find(
        s =>
          s.id !== sprintId &&
          new Date(s.startDate).getTime() <= new Date(newEnd).getTime() &&
          new Date(newStart).getTime() <= new Date(s.endDate).getTime()
      )
      if (overlap) {
        httpError(409, `dates overlap with sprint "${overlap.name}"`)
      }
    }

    return sprintRepository.update(sprintId, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
    })
  },

  async remove(sprintId: string, _actor: ActorRef) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')
    // Sprints are deletable in any state — the model is time-based, and the
    // Task FK uses onDelete: SetNull so any tasks still on the sprint simply
    // return to the backlog.
    await sprintRepository.remove(sprintId)
  },

  async configureCadence(
    teamId: string,
    input: {
      enabled: boolean
      durationDays?: number
      cooldownDays?: number
      startWeekday?: number
      autoCreate?: number
    },
    _actor: ActorRef
  ) {
    return teamRepository.updateSprintCadence(teamId, input)
  },

  /**
   * Lazily top up future DRAFT sprints to match `team.sprintAutoCreate`.
   *
   * Call from read paths (e.g. sprint list GET) so the next N future sprints
   * always exist without needing a scheduled job. Counts any DRAFT or ACTIVE
   * sprint with `startDate >= now` toward the quota — we only create new
   * sprints when there's a shortfall.
   *
   * Silent no-op when sprints are disabled or `sprintAutoCreate == 0`. Errors
   * are swallowed by callers (fire-and-forget) because this is opportunistic.
   */
  async ensureFutureSprints(teamId: string, now: Date = new Date()) {
    const team = await teamRepository.findSprintCadenceConfig(teamId)
    if (!team || !team.sprintsEnabled || team.sprintAutoCreate <= 0) return

    // Latest sprint by startDate — either it's the anchor for the next window
    // (if it's in the future or current) or we're bootstrapping from `now`.
    const all = await sprintRepository.listByTeam(teamId, { limit: 100 })
    const existingFuture = all.filter(
      s => new Date(s.startDate).getTime() >= now.getTime()
    )
    const shortfall = team.sprintAutoCreate - existingFuture.length
    if (shortfall <= 0) return

    let anchorEnd: Date | null = null
    if (all.length > 0) {
      // `listByTeam` is ordered by number desc, so [0] is the latest sprint.
      anchorEnd = new Date(all[0]!.endDate)
    }

    const cadence = {
      durationDays: team.sprintDurationDays,
      cooldownDays: team.sprintCooldownDays,
      startWeekday: team.sprintStartWeekday,
    }

    for (let i = 0; i < shortfall; i++) {
      const window = computeNextSprintWindow(cadence, anchorEnd, now)
      try {
        const number = await sprintRepository.nextNumberForTeam(teamId)
        await sprintRepository.create({
          teamId,
          number,
          name: `Sprint ${number}`,
          startDate: window.startDate,
          endDate: window.endDate,
        })
      } catch (err) {
        // P2002 = unique constraint (teamId, number) — concurrent top-up race;
        // bail out and let the other caller finish.
        if (isPrismaUniqueViolation(err)) return
        throw err
      }
      anchorEnd = window.endDate
    }
  },
}
```

- [ ] **Step 13.2: Verify no prisma reference and no any**

```bash
grep -E "@/lib/db/prisma|\bprisma\.|:\s*any\b|\bas\s+any\b" lib/services/sprint.service.ts
```

Expected: empty.

- [ ] **Step 13.3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors. If there are errors about `SprintCloseDecisions` or `SpilloverDecision` because `sprint.repository.ts` doesn't export them yet, verify Task 9 Step 9.2 was applied — those types MUST be exported from `sprint.repository.ts`.

- [ ] **Step 13.4: Run the (still-using-old-mocks) existing sprint test to confirm breakage expected**

```bash
npm test -- __tests__/sprint.service.test.ts
```

Expected: FAIL. This is the known breakage — the old test mocks `@/lib/db/prisma` which is no longer imported by the service. Task 14 rewrites it.

- [ ] **Step 13.5: Commit** (broken test is staged for rewrite in next task)

```bash
git add lib/services/sprint.service.ts
git commit -m "refactor(services): sprint.service.ts bypass prisma via repositories [LUM-N]

Test file __tests__/sprint.service.test.ts is now red because its mocks
target prisma directly; rewritten in the next commit."
```

---

## Task 14: Rewrite `__tests__/sprint.service.test.ts` (mock repository strategy)

**Files:**

- Modify: `__tests__/sprint.service.test.ts` (complete rewrite)

**Rationale**: ~43 cases covering all 9 public methods. Replaces the existing 713-line file.

- [ ] **Step 14.1: Replace the test file entirely**

Replace `__tests__/sprint.service.test.ts` with:

```typescript
import {
  sprintService,
  nextUtcMondayMidnight,
  addDays,
} from '@/lib/services/sprint.service'

// ── Repository mocks ─────────────────────────────────────────────────────────

const mockFindSprintGating = jest.fn()
const mockFindSprintCadence = jest.fn()
const mockUpdateSprintCadence = jest.fn()

const mockSprintFindById = jest.fn()
const mockSprintNextNumber = jest.fn()
const mockSprintCreate = jest.fn()
const mockSprintUpdate = jest.fn()
const mockSprintListByTeam = jest.fn()
const mockSprintRemove = jest.fn()
const mockStartAtomically = jest.fn()
const mockCloseAtomically = jest.fn()
const mockAddTaskAtomically = jest.fn()
const mockRemoveTaskAtomically = jest.fn()

jest.mock('@/lib/repositories/team.repository', () => ({
  teamRepository: {
    findSprintGatingConfig: (...a: any[]) => mockFindSprintGating(...a),
    findSprintCadenceConfig: (...a: any[]) => mockFindSprintCadence(...a),
    updateSprintCadence: (...a: any[]) => mockUpdateSprintCadence(...a),
  },
}))

jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: {
    findById: (...a: any[]) => mockSprintFindById(...a),
    nextNumberForTeam: (...a: any[]) => mockSprintNextNumber(...a),
    create: (...a: any[]) => mockSprintCreate(...a),
    update: (...a: any[]) => mockSprintUpdate(...a),
    listByTeam: (...a: any[]) => mockSprintListByTeam(...a),
    remove: (...a: any[]) => mockSprintRemove(...a),
    startAtomically: (...a: any[]) => mockStartAtomically(...a),
    closeAtomically: (...a: any[]) => mockCloseAtomically(...a),
    addTaskAtomically: (...a: any[]) => mockAddTaskAtomically(...a),
    removeTaskAtomically: (...a: any[]) => mockRemoveTaskAtomically(...a),
  },
}))

jest.mock('@/lib/services/sprint-summary.service', () => ({
  sprintSummaryService: {
    generate: jest.fn().mockResolvedValue(undefined),
  },
}))

jest.mock('@/lib/services/sprint-notifications.service', () => ({
  dispatchSprintNotification: jest.fn().mockResolvedValue(undefined),
}))

beforeEach(() => jest.clearAllMocks())

const ACTOR = { id: 'actor-x', memberId: 'm1' }

// ── createDraft ─────────────────────────────────────────────────────────────

describe('sprintService.createDraft', () => {
  it('creates DRAFT with next number and caller dates', async () => {
    mockFindSprintGating.mockResolvedValueOnce({
      id: 't1',
      sprintsEnabled: true,
    })
    mockSprintNextNumber.mockResolvedValueOnce(5)
    mockSprintCreate.mockResolvedValueOnce({ id: 's1' })

    const start = new Date('2026-05-01')
    const end = new Date('2026-05-15')
    await sprintService.createDraft(
      't1',
      { startDate: start, endDate: end },
      ACTOR
    )

    expect(mockSprintCreate).toHaveBeenCalledWith({
      teamId: 't1',
      number: 5,
      name: 'Sprint 5',
      startDate: start,
      endDate: end,
    })
  })

  it('respects a custom name when trimmed non-empty', async () => {
    mockFindSprintGating.mockResolvedValueOnce({
      id: 't1',
      sprintsEnabled: true,
    })
    mockSprintNextNumber.mockResolvedValueOnce(1)
    mockSprintCreate.mockResolvedValueOnce({})
    await sprintService.createDraft(
      't1',
      {
        name: '  Release Candidate  ',
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-05-15'),
      },
      ACTOR
    )
    expect(mockSprintCreate.mock.calls[0]![0].name).toBe('Release Candidate')
  })

  it('throws 404 when team does not exist', async () => {
    mockFindSprintGating.mockResolvedValueOnce(null)
    await expect(
      sprintService.createDraft('tX', {}, ACTOR)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 409 when team has not enabled sprints', async () => {
    mockFindSprintGating.mockResolvedValueOnce({
      id: 't1',
      sprintsEnabled: false,
    })
    await expect(
      sprintService.createDraft('t1', {}, ACTOR)
    ).rejects.toMatchObject({ status: 409 })
  })

  it('throws 400 when startDate or endDate is missing', async () => {
    mockFindSprintGating.mockResolvedValue({ id: 't1', sprintsEnabled: true })
    await expect(
      sprintService.createDraft(
        't1',
        { endDate: new Date('2026-05-01') },
        ACTOR
      )
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      sprintService.createDraft(
        't1',
        { startDate: new Date('2026-05-01') },
        ACTOR
      )
    ).rejects.toMatchObject({ status: 400 })
  })
})

// ── start ───────────────────────────────────────────────────────────────────

describe('sprintService.start', () => {
  const SPRINT = {
    id: 's1',
    teamId: 't1',
    team: { workspaceId: 'ws1' },
  }

  it('delegates to startAtomically and returns its result', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockStartAtomically.mockResolvedValueOnce({ id: 's1', status: 'ACTIVE' })

    const result = await sprintService.start('s1', ACTOR)

    expect(mockStartAtomically).toHaveBeenCalledWith('s1')
    expect(result).toEqual({ id: 's1', status: 'ACTIVE' })
  })

  it('throws 404 when sprint not found', async () => {
    mockSprintFindById.mockResolvedValueOnce(null)
    await expect(sprintService.start('sX', ACTOR)).rejects.toMatchObject({
      status: 404,
    })
    expect(mockStartAtomically).not.toHaveBeenCalled()
  })

  it('fires SPRINT_STARTED notification after successful start', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockStartAtomically.mockResolvedValueOnce({ id: 's1' })
    const { dispatchSprintNotification } = jest.requireMock(
      '@/lib/services/sprint-notifications.service'
    )

    await sprintService.start('s1', ACTOR)

    expect(dispatchSprintNotification).toHaveBeenCalledWith(
      's1',
      't1',
      'ws1',
      'SPRINT_STARTED',
      'actor-x'
    )
  })

  it('propagates repo-thrown 409 for already-ACTIVE team', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockStartAtomically.mockRejectedValueOnce(
      Object.assign(new Error('team already has ACTIVE sprint'), {
        status: 409,
      })
    )
    await expect(sprintService.start('s1', ACTOR)).rejects.toMatchObject({
      status: 409,
    })
  })

  it('propagates repo-thrown 409 for non-DRAFT state', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockStartAtomically.mockRejectedValueOnce(
      Object.assign(new Error('cannot start sprint in CLOSED state'), {
        status: 409,
      })
    )
    await expect(sprintService.start('s1', ACTOR)).rejects.toMatchObject({
      status: 409,
    })
  })
})

// ── close ───────────────────────────────────────────────────────────────────

describe('sprintService.close', () => {
  const SPRINT = {
    id: 's1',
    teamId: 't1',
    team: { workspaceId: 'ws1' },
  }

  it('delegates to closeAtomically with actorId and returns its result', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockCloseAtomically.mockResolvedValueOnce({ id: 's1', status: 'CLOSED' })
    const decisions = { t1: 'moveToNext' as const }

    const result = await sprintService.close('s1', decisions, ACTOR)

    expect(mockCloseAtomically).toHaveBeenCalledWith('s1', decisions, 'actor-x')
    expect(result).toEqual({ id: 's1', status: 'CLOSED' })
  })

  it('throws 404 when sprint not found (before entering transaction)', async () => {
    mockSprintFindById.mockResolvedValueOnce(null)
    await expect(sprintService.close('sX', {}, ACTOR)).rejects.toMatchObject({
      status: 404,
    })
    expect(mockCloseAtomically).not.toHaveBeenCalled()
  })

  it('propagates 409 for non-ACTIVE state', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockCloseAtomically.mockRejectedValueOnce(
      Object.assign(new Error('cannot close sprint in DRAFT state'), {
        status: 409,
      })
    )
    await expect(sprintService.close('s1', {}, ACTOR)).rejects.toMatchObject({
      status: 409,
    })
  })

  it('propagates 400 for missing decision', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockCloseAtomically.mockRejectedValueOnce(
      Object.assign(new Error('decision missing for task t-unfinished'), {
        status: 400,
      })
    )
    await expect(sprintService.close('s1', {}, ACTOR)).rejects.toMatchObject({
      status: 400,
    })
  })

  it('propagates 409 for stale decision set', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockCloseAtomically.mockRejectedValueOnce(
      Object.assign(
        new Error('sprint membership changed; reopen close dialog'),
        {
          status: 409,
        }
      )
    )
    await expect(
      sprintService.close('s1', { tGone: 'moveToNext' }, ACTOR)
    ).rejects.toMatchObject({ status: 409 })
  })

  it('propagates 409 when no DRAFT available for spillover', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockCloseAtomically.mockRejectedValueOnce(
      Object.assign(
        new Error('no draft sprint to receive spillover; create one first'),
        { status: 409 }
      )
    )
    await expect(
      sprintService.close('s1', { t1: 'moveToNext' }, ACTOR)
    ).rejects.toMatchObject({ status: 409 })
  })

  it('fires SPRINT_CLOSED notification after successful close', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockCloseAtomically.mockResolvedValueOnce({ id: 's1' })
    const { dispatchSprintNotification } = jest.requireMock(
      '@/lib/services/sprint-notifications.service'
    )

    await sprintService.close('s1', {}, ACTOR)

    expect(dispatchSprintNotification).toHaveBeenCalledWith(
      's1',
      't1',
      'ws1',
      'SPRINT_CLOSED',
      'actor-x'
    )
  })

  it('triggers summary generation fire-and-forget', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockCloseAtomically.mockResolvedValueOnce({ id: 's1' })
    const { sprintSummaryService: mocked } = jest.requireMock(
      '@/lib/services/sprint-summary.service'
    )

    await sprintService.close('s1', {}, ACTOR)

    expect(mocked.generate).toHaveBeenCalledWith('s1')
  })
})

// ── addTaskToSprint / moveTaskBetweenSprints ────────────────────────────────

describe('sprintService.addTaskToSprint', () => {
  it('delegates to addTaskAtomically with actor id', async () => {
    mockAddTaskAtomically.mockResolvedValueOnce({
      taskId: 't1',
      sprintId: 's1',
    })
    const result = await sprintService.addTaskToSprint('t1', 's1', ACTOR)
    expect(mockAddTaskAtomically).toHaveBeenCalledWith('t1', 's1', 'actor-x')
    expect(result).toEqual({ taskId: 't1', sprintId: 's1' })
  })

  it('propagates 404 task', async () => {
    mockAddTaskAtomically.mockRejectedValueOnce(
      Object.assign(new Error('task not found'), { status: 404 })
    )
    await expect(
      sprintService.addTaskToSprint('tX', 's1', ACTOR)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('propagates 404 sprint', async () => {
    mockAddTaskAtomically.mockRejectedValueOnce(
      Object.assign(new Error('sprint not found'), { status: 404 })
    )
    await expect(
      sprintService.addTaskToSprint('t1', 'sX', ACTOR)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('propagates 400 on team mismatch', async () => {
    mockAddTaskAtomically.mockRejectedValueOnce(
      Object.assign(new Error('task and sprint belong to different teams'), {
        status: 400,
      })
    )
    await expect(
      sprintService.addTaskToSprint('t1', 's1', ACTOR)
    ).rejects.toMatchObject({ status: 400 })
  })

  it('propagates 409 when sprint is closed', async () => {
    mockAddTaskAtomically.mockRejectedValueOnce(
      Object.assign(new Error('sprint is closed'), { status: 409 })
    )
    await expect(
      sprintService.addTaskToSprint('t1', 's1', ACTOR)
    ).rejects.toMatchObject({ status: 409 })
  })

  it('moveTaskBetweenSprints is an alias that forwards to addTaskToSprint', async () => {
    mockAddTaskAtomically.mockResolvedValueOnce({
      taskId: 't1',
      sprintId: 's2',
    })
    await sprintService.moveTaskBetweenSprints('t1', 's2', ACTOR)
    expect(mockAddTaskAtomically).toHaveBeenCalledWith('t1', 's2', 'actor-x')
  })
})

// ── removeTaskFromSprint ────────────────────────────────────────────────────

describe('sprintService.removeTaskFromSprint', () => {
  it('delegates to removeTaskAtomically with actor id', async () => {
    mockRemoveTaskAtomically.mockResolvedValueOnce({
      taskId: 't1',
      sprintId: null,
    })
    const result = await sprintService.removeTaskFromSprint('t1', ACTOR)
    expect(mockRemoveTaskAtomically).toHaveBeenCalledWith('t1', 'actor-x')
    expect(result).toEqual({ taskId: 't1', sprintId: null })
  })

  it('propagates no-op when task has no sprint', async () => {
    mockRemoveTaskAtomically.mockResolvedValueOnce({
      taskId: 't1',
      sprintId: null,
    })
    await sprintService.removeTaskFromSprint('t1', ACTOR)
    expect(mockRemoveTaskAtomically).toHaveBeenCalled()
  })

  it('propagates 404 when task not found', async () => {
    mockRemoveTaskAtomically.mockRejectedValueOnce(
      Object.assign(new Error('task not found'), { status: 404 })
    )
    await expect(
      sprintService.removeTaskFromSprint('tX', ACTOR)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('propagates 409 when current sprint is closed', async () => {
    mockRemoveTaskAtomically.mockRejectedValueOnce(
      Object.assign(new Error('cannot remove task from closed sprint'), {
        status: 409,
      })
    )
    await expect(
      sprintService.removeTaskFromSprint('t1', ACTOR)
    ).rejects.toMatchObject({ status: 409 })
  })
})

// ── updateMeta ──────────────────────────────────────────────────────────────

describe('sprintService.updateMeta', () => {
  const SPRINT = {
    id: 's1',
    teamId: 't1',
    name: 'Sprint 1',
    startDate: new Date('2026-05-01'),
    endDate: new Date('2026-05-15'),
  }

  it('renames a sprint', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockSprintUpdate.mockResolvedValueOnce({ ...SPRINT, name: 'Renamed' })
    await sprintService.updateMeta('s1', { name: 'Renamed' }, ACTOR)
    expect(mockSprintUpdate).toHaveBeenCalledWith('s1', { name: 'Renamed' })
  })

  it('updates dates when non-overlapping', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockSprintListByTeam.mockResolvedValueOnce([
      {
        id: 's2',
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-06-14'),
      },
    ])
    const newStart = new Date('2026-05-02')
    const newEnd = new Date('2026-05-16')
    mockSprintUpdate.mockResolvedValueOnce({})
    await sprintService.updateMeta(
      's1',
      { startDate: newStart, endDate: newEnd },
      ACTOR
    )
    expect(mockSprintUpdate).toHaveBeenCalledWith('s1', {
      startDate: newStart,
      endDate: newEnd,
    })
  })

  it('throws 404 when sprint not found', async () => {
    mockSprintFindById.mockResolvedValueOnce(null)
    await expect(
      sprintService.updateMeta('sX', {}, ACTOR)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 400 when endDate <= startDate', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    await expect(
      sprintService.updateMeta(
        's1',
        {
          startDate: new Date('2026-05-10'),
          endDate: new Date('2026-05-10'),
        },
        ACTOR
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('throws 409 when new dates overlap another sprint on the same team', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockSprintListByTeam.mockResolvedValueOnce([
      {
        id: 's2',
        name: 'Sprint 2',
        startDate: new Date('2026-05-10'),
        endDate: new Date('2026-05-25'),
      },
    ])
    await expect(
      sprintService.updateMeta(
        's1',
        {
          startDate: new Date('2026-05-05'),
          endDate: new Date('2026-05-20'),
        },
        ACTOR
      )
    ).rejects.toMatchObject({ status: 409 })
  })
})

// ── remove ──────────────────────────────────────────────────────────────────

describe('sprintService.remove', () => {
  it('removes a sprint regardless of status', async () => {
    mockSprintFindById.mockResolvedValueOnce({ id: 's1', status: 'CLOSED' })
    mockSprintRemove.mockResolvedValueOnce(undefined)
    await sprintService.remove('s1', ACTOR)
    expect(mockSprintRemove).toHaveBeenCalledWith('s1')
  })

  it('throws 404 when sprint is missing', async () => {
    mockSprintFindById.mockResolvedValueOnce(null)
    await expect(sprintService.remove('sX', ACTOR)).rejects.toMatchObject({
      status: 404,
    })
    expect(mockSprintRemove).not.toHaveBeenCalled()
  })
})

// ── configureCadence ────────────────────────────────────────────────────────

describe('sprintService.configureCadence', () => {
  it('passes only `enabled` when other fields are undefined', async () => {
    mockUpdateSprintCadence.mockResolvedValueOnce({})
    await sprintService.configureCadence('t1', { enabled: true }, ACTOR)
    expect(mockUpdateSprintCadence).toHaveBeenCalledWith('t1', {
      enabled: true,
    })
  })

  it('passes all cadence fields when provided', async () => {
    mockUpdateSprintCadence.mockResolvedValueOnce({})
    await sprintService.configureCadence(
      't1',
      {
        enabled: false,
        durationDays: 10,
        cooldownDays: 2,
        startWeekday: 1,
        autoCreate: 3,
      },
      ACTOR
    )
    expect(mockUpdateSprintCadence).toHaveBeenCalledWith('t1', {
      enabled: false,
      durationDays: 10,
      cooldownDays: 2,
      startWeekday: 1,
      autoCreate: 3,
    })
  })
})

// ── ensureFutureSprints ─────────────────────────────────────────────────────

describe('sprintService.ensureFutureSprints', () => {
  const NOW = new Date('2026-04-23T00:00:00Z')
  const TEAM_CFG = {
    id: 't1',
    sprintsEnabled: true,
    sprintDurationDays: 14,
    sprintCooldownDays: 0,
    sprintStartWeekday: 1,
    sprintAutoCreate: 2,
  }

  it('no-op when sprints disabled', async () => {
    mockFindSprintCadence.mockResolvedValueOnce({
      ...TEAM_CFG,
      sprintsEnabled: false,
    })
    await sprintService.ensureFutureSprints('t1', NOW)
    expect(mockSprintListByTeam).not.toHaveBeenCalled()
  })

  it('no-op when autoCreate is 0', async () => {
    mockFindSprintCadence.mockResolvedValueOnce({
      ...TEAM_CFG,
      sprintAutoCreate: 0,
    })
    await sprintService.ensureFutureSprints('t1', NOW)
    expect(mockSprintListByTeam).not.toHaveBeenCalled()
  })

  it('no-op when the quota is already met', async () => {
    mockFindSprintCadence.mockResolvedValueOnce(TEAM_CFG)
    mockSprintListByTeam.mockResolvedValueOnce([
      {
        id: 's1',
        number: 5,
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-05-15'),
      },
      {
        id: 's2',
        number: 4,
        startDate: new Date('2026-05-16'),
        endDate: new Date('2026-05-30'),
      },
    ])
    await sprintService.ensureFutureSprints('t1', NOW)
    expect(mockSprintCreate).not.toHaveBeenCalled()
  })

  it('creates the shortfall (latest future sprint seeds anchor)', async () => {
    mockFindSprintCadence.mockResolvedValueOnce(TEAM_CFG)
    mockSprintListByTeam.mockResolvedValueOnce([]) // empty → bootstrap from NOW
    mockSprintNextNumber.mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    mockSprintCreate.mockResolvedValue({})
    await sprintService.ensureFutureSprints('t1', NOW)
    expect(mockSprintCreate).toHaveBeenCalledTimes(2)
  })

  it('bails out silently on P2002 race', async () => {
    mockFindSprintCadence.mockResolvedValueOnce(TEAM_CFG)
    mockSprintListByTeam.mockResolvedValueOnce([])
    mockSprintNextNumber.mockResolvedValueOnce(1)
    mockSprintCreate.mockRejectedValueOnce(
      Object.assign(new Error('unique'), { code: 'P2002' })
    )
    await expect(
      sprintService.ensureFutureSprints('t1', NOW)
    ).resolves.toBeUndefined()
  })

  it('re-throws non-P2002 errors', async () => {
    mockFindSprintCadence.mockResolvedValueOnce(TEAM_CFG)
    mockSprintListByTeam.mockResolvedValueOnce([])
    mockSprintNextNumber.mockResolvedValueOnce(1)
    mockSprintCreate.mockRejectedValueOnce(new Error('random'))
    await expect(sprintService.ensureFutureSprints('t1', NOW)).rejects.toThrow(
      'random'
    )
  })
})

// ── re-exports from sprint-date ─────────────────────────────────────────────

describe('nextUtcMondayMidnight', () => {
  it('returns next Monday 00:00 UTC when today is Monday', () => {
    const mon = new Date('2026-04-20T10:00:00Z')
    const next = nextUtcMondayMidnight(mon)
    expect(next.getUTCDay()).toBe(1)
  })

  it('handles a Sunday', () => {
    const sun = new Date('2026-04-19T10:00:00Z')
    const next = nextUtcMondayMidnight(sun)
    expect(next.getUTCDay()).toBe(1)
  })
})

describe('addDays', () => {
  it('adds N UTC days', () => {
    const base = new Date('2026-04-23T00:00:00Z')
    const plus3 = addDays(base, 3)
    expect(plus3.toISOString()).toBe('2026-04-26T00:00:00.000Z')
  })
})
```

- [ ] **Step 14.2: Run the test**

```bash
npm test -- __tests__/sprint.service.test.ts
```

Expected: PASS. If individual cases fail, check:

- The service method actually calls the mocked repo with the exact args
- `jest.requireMock` path matches `jest.mock` path
- `sprintRepository.lockForUpdate` is NOT called by service tests anymore (it's now only called inside repository atomic methods which are mocked at service layer)

- [ ] **Step 14.3: Run coverage for sprint domain**

```bash
npm test -- --coverage --collectCoverageFrom='lib/services/sprint*.ts' --testPathPattern='sprint.*service'
```

Expected: sprint.service.ts line coverage ≥ 90%, branch ≥ 85%. If below, add more cases — common gaps are the `createDraft` name-trimming branch and `ensureFutureSprints` existing-future-sprints chaining.

- [ ] **Step 14.4: Verify no prisma mock in rewritten test**

```bash
grep -E "jest\.mock\(['\"]@/lib/db/prisma" __tests__/sprint.service.test.ts __tests__/sprint-summary.service.test.ts __tests__/sprint-notifications.service.test.ts
```

Expected: empty.

- [ ] **Step 14.5: Commit**

```bash
git add __tests__/sprint.service.test.ts
git commit -m "test(services): rewrite sprint.service.test.ts with mock-repository strategy [LUM-N]"
```

---

## Task 15: Final verification

**Files:** (no new changes, all verification steps)

- [ ] **Step 15.1: Full structural grep checks**

Run every grep assertion from spec §8:

```bash
echo "=== A. no prisma import in sprint services ==="
grep -E "from ['\"]@/lib/db/prisma['\"]" lib/services/sprint*.ts

echo "=== B. no prisma. call in sprint services ==="
grep -E "\bprisma\." lib/services/sprint*.ts

echo "=== C. no (tx as any) in sprint services ==="
grep -E "\(tx as any\)" lib/services/sprint*.ts

echo "=== D. sprint-domain any count (should be empty) ==="
grep -E ":\s*any\b|\bas\s+any\b" \
  lib/services/sprint*.ts \
  lib/repositories/sprint*.ts \
  lib/repositories/team.repository.ts \
  lib/repositories/sprint-notifications.repository.ts

echo "=== E. old prisma mock gone from rewritten tests ==="
grep -E "jest\.mock\(['\"]@/lib/db/prisma" __tests__/sprint.service.test.ts __tests__/sprint-summary.service.test.ts __tests__/sprint-notifications.service.test.ts
```

Expected: all 5 greps empty. If any return lines, go back and fix.

- [ ] **Step 15.2: Full type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 15.3: Full test run**

```bash
npm test
```

Expected: no NEW failing suites compared to `main`. If `task.service.sprint.test.ts` fails, investigate — the spec said it shouldn't break, but the task.repository changes could have shifted behavior.

To confirm a failure is pre-existing, run on main:

```bash
git stash && git checkout main && npm test -- __tests__/<failing-file> && git checkout - && git stash pop
```

- [ ] **Step 15.4: Coverage report for sprint domain**

```bash
npm test -- --coverage --collectCoverageFrom='lib/services/sprint*.ts'
```

Expected: all three sprint service files line coverage ≥ 90%, branch coverage ≥ 85%. Record the numbers for the PR body.

- [ ] **Step 15.5: Git scope audit**

```bash
git diff --stat main... | grep -v 'docs/'
```

Expected files modified (other changes are red flags to investigate):

```
__tests__/lib/db/errors.test.ts              (created)
__tests__/sprint.service.test.ts             (rewritten)
__tests__/sprint-summary.service.test.ts     (rewritten)
__tests__/sprint-notifications.service.test.ts (created)
lib/db/errors.ts                             (created)
lib/repositories/activity.repository.ts      (extended)
lib/repositories/generation-job.repository.ts (extended)
lib/repositories/sprint.repository.ts        (extended)
lib/repositories/sprint-notifications.repository.ts (created)
lib/repositories/sprint-summary.repository.ts (extended)
lib/repositories/task.repository.ts          (extended)
lib/repositories/team.repository.ts          (created)
lib/services/sprint.service.ts               (refactored)
lib/services/sprint-summary.service.ts       (refactored)
lib/services/sprint-notifications.service.ts (refactored)
```

- [ ] **Step 15.6: Service export-signature diff (byte-level equivalence)**

```bash
git diff main... -- lib/services/sprint*.ts | grep -E "^[+-]export " || echo "No export signature changes"
```

Expected: only `+export type` or `+export { ... } from '@/lib/repositories/sprint.repository'` lines (re-exports for the types that moved from service to repository); no `-export` for anything the outside world consumes (`sprintService.*`, `sprintSummaryService.*`, `dispatchSprintNotification`). If an outside export signature changed, fix before PR.

- [ ] **Step 15.7: Manual regression (browser)**

Start dev server and walk these 3 scenarios in the browser (spec §8.4):

1. **Sprint lifecycle + summary**:
   - Go to a sprints-enabled team, create a DRAFT sprint
   - Click Start → sprint goes ACTIVE
   - Add a task (use +agenda or task detail page)
   - Click Close → pick spillover decision for each unfinished task → confirm
   - Verify summary shows up (may take a few seconds while LLM runs)

2. **Cadence config**:
   - Workspace settings → Sprints → toggle `sprintsEnabled`, change `sprintDurationDays`
   - Navigate to sprint list → verify auto-created future sprints match config

3. **Notifications**:
   - Start or close a sprint with multiple team members
   - Log in as another member, verify SPRINT_STARTED / SPRINT_CLOSED notification received

Record any deviation from prior behavior — if found, compare to pre-refactor recording; differences usually indicate a bug in the atomic methods.

- [ ] **Step 15.8: Push and open PR**

```bash
git push -u origin lumo/LUM-N-sprint-layer-refactor
gh pr create --title "refactor(sprint): sink Prisma to repository layer + add service tests [LUM-N]" --body "$(cat <<'EOF'
## Summary
- Sink 20 Prisma violations from 3 sprint services to the repository layer via D2+ transaction model
- New files: `lib/db/errors.ts`, `lib/repositories/team.repository.ts`, `lib/repositories/sprint-notifications.repository.ts`
- Extended: `sprint.repository.ts` (+4 atomics), `sprint-summary.repository.ts` (+computeStatsData), `task.repository.ts`, `activity.repository.ts`, `generation-job.repository.ts` (tx-aware additions only)
- Sprint domain `any` count: 9 → 0
- Tests: rewritten `sprint.service.test.ts` (30 → 43 cases) + `sprint-summary.service.test.ts` (7 → 6 cases) with mock-repository strategy; new `sprint-notifications.service.test.ts` (4 cases)
- Service coverage: >90% line, >85% branch (numbers from Step 15.4)

Follows spec: `docs/superpowers/specs/2026-04-23-sprint-layer-refactor-design.md`

## Test plan
- [x] npx tsc --noEmit passes
- [x] npm test passes (no new red suites)
- [x] Sprint domain `any` grep returns empty
- [x] Sprint services import no prisma
- [x] Manual: sprint lifecycle (create → start → add task → close → summary)
- [x] Manual: cadence config change reflects in auto-created sprints
- [x] Manual: SPRINT_STARTED / SPRINT_CLOSED notifications delivered

## Architecture notes
- **D2+ transaction model**: Repositories own `$transaction` boundaries; cross-repo methods take `tx?: Prisma.TransactionClient` for tx-internal coordination (matches existing `task.repository.bulkUpdateSprint` / `sprint.repository.lockForUpdate` patterns).
- **HTTP errors in repository**: Repositories throw `Object.assign(new Error(msg), { status })` — pragmatic follow-on of the existing project convention rather than introducing Result types.
- **P2 / P3 coming**: `MyTasksPage.tsx` (1131 LOC) and `SprintTasksView.tsx` (1078 LOC) god-component splits are tracked as separate specs.
EOF
)"
```

Expected: PR created.

- [ ] **Step 15.9: Update Task ID placeholders in spec and plan** (if LUM-N was allocated an actual ID like LUM-42)

Optional — run only if a specific ticket ID is assigned after the PR is open. `sed -i '' 's/LUM-N/LUM-42/g'` on the spec and plan, then `git commit --amend` the last commit if desired.

---

## Plan self-review notes

- **Spec coverage** (§1-11 of spec): every requirement mapped to at least one task
  - §2.1 In Scope: Tasks 1 (errors), 2 (team repo), 3 (sprint-notif repo), 4-7 (extend 4 repos), 10 (fix countTasks any), 11-14 (3 service refactors + 3 tests)
  - §4 file list: identical in tasks
  - §5 Prisma-call mappings: each row is covered by Tasks 4-10 repository additions and Tasks 11-14 service rewrites
  - §6 any收敛: Tasks 13, 14 eliminate `catch (err: any)` via `isPrismaUniqueViolation`; Task 10 fixes `countTasks` any; service/repo additions have zero any
  - §7 test plan: Tasks 11, 12, 14 implement 4+6+43=53 cases
  - §8 验收: Task 15 runs the exact greps and checks

- **Placeholder scan**: none.

- **Type consistency**:
  - `SprintCloseDecisions` and `SpilloverDecision` exported from `sprint.repository.ts` (Task 9 Step 9.2), re-exported from `sprint.service.ts` (Task 13)
  - `UpdateSprintCadenceInput` exported from `team.repository.ts` (Task 2); used in `configureCadence` signature in Task 13 (implicitly, through `updateSprintCadence` call signature)
  - `SprintStats` defined in `sprint-summary.repository.ts` (Task 7); re-exported from `sprint-summary.service.ts` (Task 12)
  - `CreateSprintChangedInput` exported from `activity.repository.ts` (Task 5); used inside `sprint.repository.closeAtomically` + `addTaskAtomically` + `removeTaskAtomically` (Tasks 9, 10) — method names consistent throughout
