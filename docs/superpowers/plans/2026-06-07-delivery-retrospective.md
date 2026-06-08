# 交付回顾（Delivery Retrospective）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DONE 任务在侧栏渲染「交付回顾」卡，把交付时固化的预测快照与真实结果（token / 运行次数 / 澄清轮次）并排对比，并以「已计入参考库（现 N 个）」收尾。

**Architecture:** 复用现有 forecast 栈（service/repository/percentile）。新增一条「澄清轮次」预测线（按任务 count `AGENT_CLARIFY` notification）。任务转 DONE 时 fire-and-forget 把 forecast 固化进新表 `TaskForecastSnapshot`（keep-first）；渲染时读快照 + 实算 actual，逐指标算偏差/区间带。老任务无快照 → 不渲染。

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma + Neon Postgres, React Query, react-intl, Jest + jsdom, Tailwind/shadcn。

参考 spec：[docs/superpowers/specs/2026-06-07-delivery-retrospective-design.md](../specs/2026-06-07-delivery-retrospective-design.md)

---

## File Structure

**Schema**

- Modify `prisma/schema.prisma` — 新 model `TaskForecastSnapshot` + `Task.forecastSnapshot` 反向 relation
- Create `prisma/migrations/<ts>_add_task_forecast_snapshot/migration.sql`

**Forecast 栈扩展（澄清轮次 track）**

- Modify `lib/forecast/types.ts` — `ForecastCandidate.clarifyRounds`、`CandidateMetrics.clarifyRounds`、`TaskForecast.clarifyRounds`
- Modify `lib/forecast/metrics.ts` — 透传 clarifyRounds
- Modify `lib/repositories/forecast.repository.ts` — 用 `notification.groupBy` 计数 clarify
- Modify `lib/services/forecast.service.ts` — 产出 clarifyRounds 区间

**Retrospective 栈（新）**

- Create `lib/forecast/retrospective-types.ts` — `VarianceBand`、`RetrospectiveMetric`、`TaskRetrospective`
- Create `lib/repositories/retrospective.repository.ts` — 快照 CRUD + actual + referenceLibrarySize
- Create `lib/services/retrospective.service.ts` — `captureSnapshot` / `getRetrospective` / 后台包装
- Modify `lib/services/index.ts` — 导出 retrospectiveService
- Modify `lib/services/task-state.service.ts:295` 块 — 挂捕获钩子

**API / Client / Hook**

- Create `app/api/tasks/[id]/retrospective/route.ts`
- Modify `app/workspace/[workspaceUrl]/constants.ts` — `API.tasks.retrospective`
- Modify `lib/api-client/tasks.ts` — `retrospective<T>()`
- Modify `lib/query/keys.ts` — `tasks.retrospective`
- Create `app/workspace/[workspaceUrl]/hooks/useTaskRetrospective.ts`

**UI**

- Create `app/workspace/[workspaceUrl]/components/RetrospectivePanel.tsx`
- Modify `app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx` — 挂载

**i18n**

- Modify `lib/i18n/en.json` + 全 16 locale（`npm run i18n:sync` 后补真翻译）

**Cleanup（末尾）**

- Delete `.mock/retrospective.html`；还原 `.claude/launch.json` 的 `mock-static` 配置

---

## Task 1: Schema — TaskForecastSnapshot 表

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_add_task_forecast_snapshot/migration.sql`

- [x] **Step 1: 加 model + 反向 relation**

在 `prisma/schema.prisma` 的 `model Task { ... }` 内，`sessions Session[]` 那一组 relation 旁加：

```prisma
  forecastSnapshot  TaskForecastSnapshot?
```

在文件末尾（任意 model 之后）加新 model：

```prisma
/// 交付时固化的 forecast 快照（LUM-319）。只存预测区间；actual 渲染时实算。
/// keep-first：taskId 唯一，reopen 重交付不覆盖，留住首次交付的真实预测。
model TaskForecastSnapshot {
  id             String   @id @default(cuid())
  taskId         String   @unique
  iterations     Json? // { p25, median, p75 } | null
  clarifyRounds  Json?
  tokenCost      Json?
  cohortSize     Int // 相似 cohort 大小（喂 iterations/clarify）
  tokenCostBasis Int // 项目级样本数（喂 token）
  capturedAt     DateTime @default(now())

  task Task @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@map("task_forecast_snapshots")
}
```

- [x] **Step 2: 生成并应用迁移**

Run: `npx prisma migrate dev --name add_task_forecast_snapshot`
Expected: 新建 `task_forecast_snapshots` 表，`prisma generate` 自动跑。

> 若遇 P3008/P3012 漂移（CLAUDE.md「Database Migrations」）：手写 SQL 到 migration.sql，`npx prisma db execute --file <path>` 应用，`npx prisma migrate resolve --applied add_task_forecast_snapshot`，再 `npx prisma generate`。**不要** `migrate reset`。

migration.sql 应等价于：

```sql
CREATE TABLE "task_forecast_snapshots" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "iterations" JSONB,
  "clarifyRounds" JSONB,
  "tokenCost" JSONB,
  "cohortSize" INTEGER NOT NULL,
  "tokenCostBasis" INTEGER NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_forecast_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "task_forecast_snapshots_taskId_key" ON "task_forecast_snapshots"("taskId");
ALTER TABLE "task_forecast_snapshots" ADD CONSTRAINT "task_forecast_snapshots_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [x] **Step 3: 确认 client 生成**

Run: `npx prisma generate && npx tsc --noEmit -p tsconfig.json 2>&1 | head -5`
Expected: 无 `TaskForecastSnapshot does not exist` 类报错。

- [x] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add TaskForecastSnapshot model [LUM-319]"
```

---

## Task 2: Forecast 类型 + metrics 透传 clarifyRounds

**Files:**

- Modify: `lib/forecast/types.ts`
- Modify: `lib/forecast/metrics.ts`
- Test: `__tests__/lib/forecast/metrics.test.ts`（若不存在则 Create）

- [x] **Step 1: 扩展类型**

`lib/forecast/types.ts`：

`ForecastCandidate` 内 `tokenCost: number | null` 之后加：

```ts
// Count of AGENT_CLARIFY notifications raised for this task (LUM-319).
// The clarify forecast track; 0 for tasks that never needed clarification.
clarifyRounds: number
```

`CandidateMetrics` 内 `tokenCost: number | null` 之后加：

```ts
clarifyRounds: number
```

`TaskForecast` 内 `cycleHours: Interval | null` 之后加：

```ts
// Clarification-rounds forecast over the similarity cohort (LUM-319), same
// cohort + MIN_COHORT gating as iterations. null when the cohort is too thin.
clarifyRounds: Interval | null
```

- [x] **Step 2: 写失败测试（metrics 透传）**

`__tests__/lib/forecast/metrics.test.ts` 加（文件已存在则追加一个 it）：

```ts
import { extractMetrics } from '@/lib/forecast/metrics'
import type { ForecastCandidate } from '@/lib/forecast/types'

it('passes clarifyRounds through from the candidate', () => {
  const c: ForecastCandidate = {
    id: 'a',
    title: 'X',
    identifier: 'LUM-1',
    tags: [],
    runs: [],
    mergedPrAt: [],
    tokenCost: null,
    clarifyRounds: 4,
  }
  expect(extractMetrics(c).clarifyRounds).toBe(4)
})
```

- [x] **Step 3: 运行测试确认失败**

Run: `npx jest __tests__/lib/forecast/metrics.test.ts -t clarifyRounds`
Expected: FAIL（`clarifyRounds` 未在返回值 / 类型不匹配）。

- [x] **Step 4: 实现透传**

`lib/forecast/metrics.ts` 的 `return { ... }` 改为：

```ts
return {
  iterations,
  mergedPrs,
  cycleHours,
  tokenCost: c.tokenCost,
  clarifyRounds: c.clarifyRounds,
}
```

- [x] **Step 5: 运行测试确认通过**

Run: `npx jest __tests__/lib/forecast/metrics.test.ts -t clarifyRounds`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add lib/forecast/types.ts lib/forecast/metrics.ts __tests__/lib/forecast/metrics.test.ts
git commit -m "feat: thread clarifyRounds through forecast metrics [LUM-319]"
```

---

## Task 3: Forecast repository — 计数 clarify

**Files:**

- Modify: `lib/repositories/forecast.repository.ts`
- Test: `__tests__/repositories/forecast.repository.test.ts`

Notification 与 Task **无 relation**（裸 `taskId`），用 `prisma.notification.groupBy` 计数，不能走 Task select 的 `_count`。

- [x] **Step 1: 写失败测试**

`__tests__/repositories/forecast.repository.test.ts` 顶部 mock 加 `notification`：

```ts
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn(), findMany: jest.fn() },
    notification: { groupBy: jest.fn() },
  },
}))
```

取 mock 句柄（与 findUnique/findMany 同处）：

```ts
const groupBy = prisma.notification.groupBy as unknown as jest.Mock
```

`beforeEach` 加 `groupBy.mockReset()`。新增 it：

```ts
it('counts AGENT_CLARIFY notifications per candidate', async () => {
  findUnique.mockResolvedValue({
    id: 't1',
    title: 'Target',
    projectId: 'p1',
    taskTags: [{ tag: { name: 'auth' } }],
  })
  findMany.mockResolvedValue([
    {
      id: 't2',
      title: 'Older',
      number: 42,
      team: { identifier: 'LUM' },
      taskTags: [{ tag: { name: 'auth' } }],
      sessions: [],
      pullRequests: [],
    },
  ])
  groupBy.mockResolvedValue([{ taskId: 't2', _count: { _all: 3 } }])

  const res = await forecastRepository.loadForecastInputs('t1')
  expect(res!.candidates[0].clarifyRounds).toBe(3)
})

it('defaults clarifyRounds to 0 when a candidate has no clarify notifications', async () => {
  findUnique.mockResolvedValue({
    id: 't1',
    title: 'Target',
    projectId: 'p1',
    taskTags: [],
  })
  findMany.mockResolvedValue([
    {
      id: 't2',
      title: 'Older',
      number: 42,
      team: { identifier: 'LUM' },
      taskTags: [],
      sessions: [],
      pullRequests: [],
    },
  ])
  groupBy.mockResolvedValue([])

  const res = await forecastRepository.loadForecastInputs('t1')
  expect(res!.candidates[0].clarifyRounds).toBe(0)
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `npx jest __tests__/repositories/forecast.repository.test.ts -t clarify`
Expected: FAIL（`clarifyRounds` 为 undefined / groupBy 未调用）。

- [x] **Step 3: 实现计数**

`lib/repositories/forecast.repository.ts`，在 `const rows = await prisma.task.findMany(...)` 之后、`const candidates = rows.map(...)` 之前插入：

```ts
// Clarification rounds per candidate = count of AGENT_CLARIFY notifications
// (LUM-319). Notification has only a bare taskId (no Task relation), so we
// aggregate separately and map back. Tasks with none simply stay at 0.
const clarifyCounts = await prisma.notification.groupBy({
  by: ['taskId'],
  where: { taskId: { in: rows.map(r => r.id) }, type: 'AGENT_CLARIFY' },
  _count: { _all: true },
})
const clarifyByTask = new Map<string, number>(
  clarifyCounts.map(c => [c.taskId as string, c._count._all])
)
```

`candidates` 的 `return { ... }` 内 `tokenCost,` 之后加：

```ts
        clarifyRounds: clarifyByTask.get(r.id) ?? 0,
```

> 注：`groupBy` 在 `rows` 为空时传 `taskId: { in: [] }`，Prisma 返回 `[]`，安全。

- [x] **Step 4: 运行测试确认通过**

Run: `npx jest __tests__/repositories/forecast.repository.test.ts`
Expected: PASS（含原有用例 —— 它们构造的候选行没有 notifications，groupBy mock 默认需返回 `[]`；在已存在用例的 mock 里补 `groupBy.mockResolvedValue([])`，见下）。

> 若原有用例因 `groupBy` 未 mock 而报 `groupBy is not a function`：在那些 it 里、`findMany.mockResolvedValue(...)` 之后加一行 `groupBy.mockResolvedValue([])`。

- [x] **Step 5: Commit**

```bash
git add lib/repositories/forecast.repository.ts __tests__/repositories/forecast.repository.test.ts
git commit -m "feat: count AGENT_CLARIFY notifications per forecast candidate [LUM-319]"
```

---

## Task 4: Forecast service — clarifyRounds 区间

**Files:**

- Modify: `lib/services/forecast.service.ts`
- Test: `__tests__/services/forecast.service.test.ts`

- [x] **Step 1: 更新测试 helper + 写失败断言**

`__tests__/services/forecast.service.test.ts` 的 `cand(...)` helper 加可选参 `clarify` 并写入返回对象：

```ts
function cand(
  id: string,
  runs: number,
  prs: number,
  end: number,
  tokenCost: number | null = null,
  clarify = 0
): ForecastCandidate {
  return {
    id,
    title: 'Add OAuth login',
    identifier: `LUM-${id}`,
    tags: ['auth'],
    runs: Array.from({ length: runs }, (_, i) => ({
      startedAt: h(i),
      finishedAt: h(i + 1),
    })),
    mergedPrAt: Array.from({ length: prs }, () => h(end)),
    tokenCost,
    clarifyRounds: clarify,
  }
}
```

新增 it：

```ts
it('produces a clarifyRounds interval from the cohort', async () => {
  load.mockResolvedValue({
    target,
    candidates: [
      cand('1', 2, 1, 5, null, 1),
      cand('2', 3, 1, 6, null, 2),
      cand('3', 2, 1, 5, null, 3),
    ],
  })
  const f = await forecastService.getTaskForecast('tgt')
  expect(f.clarifyRounds).not.toBeNull()
  expect(f.clarifyRounds!.median).toBe(2)
})

it('returns null clarifyRounds when the cohort is too thin', async () => {
  load.mockResolvedValue({ target, candidates: [cand('1', 2, 1, 5, null, 1)] })
  const f = await forecastService.getTaskForecast('tgt')
  expect(f.clarifyRounds).toBeNull()
})
```

> 任何直接断言整个 `TaskForecast` 形状 / 使用 `EMPTY` 的既有用例，给期望值补 `clarifyRounds: null`。

- [x] **Step 2: 运行测试确认失败**

Run: `npx jest __tests__/services/forecast.service.test.ts -t clarifyRounds`
Expected: FAIL（`clarifyRounds` 不存在于返回值）。

- [x] **Step 3: 实现区间**

`lib/services/forecast.service.ts`：

`EMPTY` 常量加 `clarifyRounds: null,`（在 `cycleHours: null,` 之后）。

`sources.length < MIN_COHORT` 早返回分支的对象加 `clarifyRounds: null,`（在 `cycleHours: null,` 之后）。

主返回分支：在 `const cycleValues = ...` 之后加：

```ts
const clarifyValues = sources.map((_, i) => cohort[i]!.candidate.clarifyRounds)
```

主 `return { ... }` 内 `cycleHours: ...,` 之后加：

```ts
      clarifyRounds: interval(clarifyValues),
```

> `clarifyValues` 长度 = `sources.length ≥ MIN_COHORT`，故 `interval` 永不空数组。`cohort` 与 `sources` 同序同长（sources 由 cohort.map 生成）。

- [x] **Step 4: 运行测试确认通过**

Run: `npx jest __tests__/services/forecast.service.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add lib/services/forecast.service.ts __tests__/services/forecast.service.test.ts
git commit -m "feat: forecast clarifyRounds interval over cohort [LUM-319]"
```

---

## Task 5: Retrospective 类型

**Files:**

- Create: `lib/forecast/retrospective-types.ts`

- [x] **Step 1: 写类型**

```ts
import type { Interval } from './types'

/** actual 相对预测区间的落点。forecast 为 null 时整体为 null（行降级）。 */
export type VarianceBand = 'within' | 'above' | 'below'

/** 单条「预测 vs 实际」指标。 */
export interface RetrospectiveMetric {
  forecast: Interval | null
  actual: number | null // token 可能无 usage → null；计数类恒为 number
  deltaPct: number | null // null：无预测、actual 缺失、或 median 为 0
  band: VarianceBand | null // null：无预测或 actual 缺失
}

/** 一个已交付任务的回顾。snapshot 缺失时 service 返回 null（不构造此对象）。 */
export interface TaskRetrospective {
  tokenCost: RetrospectiveMetric
  iterations: RetrospectiveMetric
  clarifyRounds: RetrospectiveMetric
  referenceLibrarySize: number
  capturedAt: Date
}
```

- [x] **Step 2: tsc 校验**

Run: `npx tsc --noEmit 2>&1 | grep retrospective-types | head`
Expected: 无输出。

- [x] **Step 3: Commit**

```bash
git add lib/forecast/retrospective-types.ts
git commit -m "feat: retrospective domain types [LUM-319]"
```

---

## Task 6: Retrospective repository

**Files:**

- Create: `lib/repositories/retrospective.repository.ts`
- Test: `__tests__/repositories/retrospective.repository.test.ts`

- [x] **Step 1: 写失败测试**

```ts
/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    taskForecastSnapshot: { findUnique: jest.fn(), create: jest.fn() },
    task: { findUnique: jest.fn(), count: jest.fn() },
    notification: { count: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'

const snapFind = prisma.taskForecastSnapshot.findUnique as jest.Mock
const snapCreate = prisma.taskForecastSnapshot.create as jest.Mock
const taskFind = prisma.task.findUnique as jest.Mock
const taskCount = prisma.task.count as jest.Mock
const notifCount = prisma.notification.count as jest.Mock

beforeEach(() => {
  ;[snapFind, snapCreate, taskFind, taskCount, notifCount].forEach(m =>
    m.mockReset()
  )
})

it('loadActuals sums session usage, counts sessions and clarify notifications', async () => {
  taskFind.mockResolvedValue({
    projectId: 'p1',
    sessions: [
      {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 5,
        cacheCreationTokens: 0,
      },
      {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    ],
  })
  notifCount.mockResolvedValue(2)

  const a = await retrospectiveRepository.loadActuals('t1')
  expect(a).toEqual({
    projectId: 'p1',
    tokenCost: 38,
    iterations: 2,
    clarifyRounds: 2,
  })
})

it('loadActuals returns tokenCost null when no session carries usage', async () => {
  taskFind.mockResolvedValue({
    projectId: 'p1',
    sessions: [
      {
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheCreationTokens: null,
      },
    ],
  })
  notifCount.mockResolvedValue(0)
  const a = await retrospectiveRepository.loadActuals('t1')
  expect(a).toEqual({
    projectId: 'p1',
    tokenCost: null,
    iterations: 1,
    clarifyRounds: 0,
  })
})

it('loadActuals returns null when the task is missing', async () => {
  taskFind.mockResolvedValue(null)
  expect(await retrospectiveRepository.loadActuals('nope')).toBeNull()
})

it('createSnapshotIfAbsent swallows unique-violation (keep-first)', async () => {
  snapCreate.mockRejectedValue(
    Object.assign(new Error('unique'), { code: 'P2002' })
  )
  await expect(
    retrospectiveRepository.createSnapshotIfAbsent('t1', {
      iterations: null,
      clarifyRounds: null,
      tokenCost: null,
      cohortSize: 0,
      tokenCostBasis: 0,
    })
  ).resolves.toBeUndefined()
})

it('createSnapshotIfAbsent rethrows non-P2002 errors', async () => {
  snapCreate.mockRejectedValue(
    Object.assign(new Error('boom'), { code: 'P2003' })
  )
  await expect(
    retrospectiveRepository.createSnapshotIfAbsent('t1', {
      iterations: null,
      clarifyRounds: null,
      tokenCost: null,
      cohortSize: 0,
      tokenCostBasis: 0,
    })
  ).rejects.toThrow('boom')
})

it('countReferenceLibrary counts DONE tasks with sessions', async () => {
  taskCount.mockResolvedValue(27)
  expect(await retrospectiveRepository.countReferenceLibrary('p1')).toBe(27)
  expect(taskCount).toHaveBeenCalledWith({
    where: { projectId: 'p1', status: 'DONE', sessions: { some: {} } },
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `npx jest __tests__/repositories/retrospective.repository.test.ts`
Expected: FAIL（模块不存在）。

- [x] **Step 3: 实现 repository**

```ts
import { prisma } from '@/lib/db/prisma'
import type { Interval } from '@/lib/forecast/types'

export interface SnapshotRow {
  iterations: Interval | null
  clarifyRounds: Interval | null
  tokenCost: Interval | null
  cohortSize: number
  tokenCostBasis: number
  capturedAt: Date
}

export interface SnapshotPayload {
  iterations: Interval | null
  clarifyRounds: Interval | null
  tokenCost: Interval | null
  cohortSize: number
  tokenCostBasis: number
}

export interface RetrospectiveActuals {
  projectId: string
  tokenCost: number | null
  iterations: number
  clarifyRounds: number
}

export const retrospectiveRepository = {
  /** 读快照（已转 domain 形状）。无则 null。 */
  async findSnapshot(taskId: string): Promise<SnapshotRow | null> {
    const row = await prisma.taskForecastSnapshot.findUnique({
      where: { taskId },
    })
    if (!row) return null
    return {
      iterations: row.iterations as Interval | null,
      clarifyRounds: row.clarifyRounds as Interval | null,
      tokenCost: row.tokenCost as Interval | null,
      cohortSize: row.cohortSize,
      tokenCostBasis: row.tokenCostBasis,
      capturedAt: row.capturedAt,
    }
  },

  /** keep-first 落库：唯一冲突（P2002）静默吞掉，其他错误抛出。 */
  async createSnapshotIfAbsent(
    taskId: string,
    p: SnapshotPayload
  ): Promise<void> {
    try {
      await prisma.taskForecastSnapshot.create({
        data: {
          taskId,
          iterations: p.iterations ?? undefined,
          clarifyRounds: p.clarifyRounds ?? undefined,
          tokenCost: p.tokenCost ?? undefined,
          cohortSize: p.cohortSize,
          tokenCostBasis: p.tokenCostBasis,
        },
      })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return
      throw e
    }
  },

  /** 实算 actual：token 求和（无 usage→null）、session 数、AGENT_CLARIFY 数。 */
  async loadActuals(taskId: string): Promise<RetrospectiveActuals | null> {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        projectId: true,
        sessions: {
          select: {
            inputTokens: true,
            outputTokens: true,
            cacheReadTokens: true,
            cacheCreationTokens: true,
          },
        },
      },
    })
    if (!task) return null

    const hasUsage = task.sessions.some(s => s.outputTokens !== null)
    const tokenCost = hasUsage
      ? task.sessions.reduce(
          (sum, s) =>
            sum +
            (s.inputTokens ?? 0) +
            (s.outputTokens ?? 0) +
            (s.cacheReadTokens ?? 0) +
            (s.cacheCreationTokens ?? 0),
          0
        )
      : null

    const clarifyRounds = await prisma.notification.count({
      where: { taskId, type: 'AGENT_CLARIFY' },
    })

    return {
      projectId: task.projectId,
      tokenCost,
      iterations: task.sessions.length,
      clarifyRounds,
    }
  },

  /** 参考库规模 = 项目内 DONE 且有 session 的任务数（= forecast 候选 universe）。 */
  async countReferenceLibrary(projectId: string): Promise<number> {
    return prisma.task.count({
      where: { projectId, status: 'DONE', sessions: { some: {} } },
    })
  },
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `npx jest __tests__/repositories/retrospective.repository.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add lib/repositories/retrospective.repository.ts __tests__/repositories/retrospective.repository.test.ts
git commit -m "feat: retrospective repository (snapshot + actuals + ref-library) [LUM-319]"
```

---

## Task 7: Retrospective service — capture + get

**Files:**

- Create: `lib/services/retrospective.service.ts`
- Modify: `lib/services/index.ts`
- Test: `__tests__/services/retrospective.service.test.ts`

- [x] **Step 1: 写失败测试**

```ts
/** @jest-environment node */
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    findSnapshot: jest.fn(),
    createSnapshotIfAbsent: jest.fn(),
    loadActuals: jest.fn(),
    countReferenceLibrary: jest.fn(),
  },
}))
jest.mock('@/lib/services/forecast.service', () => ({
  forecastService: { getTaskForecast: jest.fn() },
}))

import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import { forecastService } from '@/lib/services/forecast.service'
import { retrospectiveService } from '@/lib/services/retrospective.service'

const findSnapshot = retrospectiveRepository.findSnapshot as jest.Mock
const createSnap = retrospectiveRepository.createSnapshotIfAbsent as jest.Mock
const loadActuals = retrospectiveRepository.loadActuals as jest.Mock
const countRef = retrospectiveRepository.countReferenceLibrary as jest.Mock
const getForecast = forecastService.getTaskForecast as jest.Mock

beforeEach(() =>
  [findSnapshot, createSnap, loadActuals, countRef, getForecast].forEach(m =>
    m.mockReset()
  )
)

const iv = (p25: number, median: number, p75: number) => ({ p25, median, p75 })

describe('captureSnapshot', () => {
  it('skips when a snapshot already exists (keep-first)', async () => {
    findSnapshot.mockResolvedValue({ capturedAt: new Date() })
    await retrospectiveService.captureSnapshot('t1')
    expect(getForecast).not.toHaveBeenCalled()
    expect(createSnap).not.toHaveBeenCalled()
  })

  it('does not persist when every track is null', async () => {
    findSnapshot.mockResolvedValue(null)
    getForecast.mockResolvedValue({
      iterations: null,
      clarifyRounds: null,
      tokenCost: null,
      cohortSize: 0,
      tokenCostBasis: 0,
    })
    await retrospectiveService.captureSnapshot('t1')
    expect(createSnap).not.toHaveBeenCalled()
  })

  it('persists the forecast intervals when at least one track is present', async () => {
    findSnapshot.mockResolvedValue(null)
    getForecast.mockResolvedValue({
      iterations: iv(2, 3, 3),
      clarifyRounds: iv(1, 1, 2),
      tokenCost: iv(2e7, 2.6e7, 3e7),
      cohortSize: 5,
      tokenCostBasis: 8,
    })
    await retrospectiveService.captureSnapshot('t1')
    expect(createSnap).toHaveBeenCalledWith('t1', {
      iterations: iv(2, 3, 3),
      clarifyRounds: iv(1, 1, 2),
      tokenCost: iv(2e7, 2.6e7, 3e7),
      cohortSize: 5,
      tokenCostBasis: 8,
    })
  })
})

describe('getRetrospective', () => {
  it('returns null when there is no snapshot', async () => {
    findSnapshot.mockResolvedValue(null)
    expect(await retrospectiveService.getRetrospective('t1')).toBeNull()
  })

  it('computes deltaPct and band per metric', async () => {
    const capturedAt = new Date('2026-06-01')
    findSnapshot.mockResolvedValue({
      iterations: iv(2, 3, 3),
      clarifyRounds: iv(1, 1, 2),
      tokenCost: iv(2.4e7, 2.6e7, 3e7),
      cohortSize: 5,
      tokenCostBasis: 8,
      capturedAt,
    })
    loadActuals.mockResolvedValue({
      projectId: 'p1',
      tokenCost: 2.95e7,
      iterations: 3,
      clarifyRounds: 2,
    })
    countRef.mockResolvedValue(27)

    const r = await retrospectiveService.getRetrospective('t1')
    expect(r!.tokenCost.band).toBe('within') // 2.95e7 ∈ [2.4e7, 3e7]
    expect(r!.tokenCost.deltaPct).toBe(13) // round((2.95-2.6)/2.6*100)
    expect(r!.iterations.band).toBe('within') // 3 ∈ [2,3]
    expect(r!.clarifyRounds.band).toBe('above') // 2 > p75 1... no: p75=2 → within
    expect(r!.referenceLibrarySize).toBe(27)
    expect(r!.capturedAt).toBe(capturedAt)
  })

  it('degrades a metric to actual-only when its forecast is null', async () => {
    findSnapshot.mockResolvedValue({
      iterations: iv(1, 2, 2),
      clarifyRounds: null,
      tokenCost: null,
      cohortSize: 4,
      tokenCostBasis: 0,
      capturedAt: new Date(),
    })
    loadActuals.mockResolvedValue({
      projectId: 'p1',
      tokenCost: null,
      iterations: 4,
      clarifyRounds: 3,
    })
    countRef.mockResolvedValue(10)

    const r = await retrospectiveService.getRetrospective('t1')
    expect(r!.clarifyRounds).toEqual({
      forecast: null,
      actual: 3,
      deltaPct: null,
      band: null,
    })
    expect(r!.tokenCost).toEqual({
      forecast: null,
      actual: null,
      deltaPct: null,
      band: null,
    })
    expect(r!.iterations.band).toBe('above') // 4 > p75 2
  })

  it('returns null when actuals cannot be loaded', async () => {
    findSnapshot.mockResolvedValue({
      iterations: iv(1, 2, 2),
      clarifyRounds: null,
      tokenCost: null,
      cohortSize: 4,
      tokenCostBasis: 0,
      capturedAt: new Date(),
    })
    loadActuals.mockResolvedValue(null)
    expect(await retrospectiveService.getRetrospective('t1')).toBeNull()
  })
})
```

> 上面 `clarifyRounds.band` 的注释更正：p75=2、actual=2 → `within`。把该断言写成 `expect(r!.clarifyRounds.band).toBe('within')`。

- [x] **Step 2: 运行测试确认失败**

Run: `npx jest __tests__/services/retrospective.service.test.ts`
Expected: FAIL（模块不存在）。

- [x] **Step 3: 实现 service**

`lib/services/retrospective.service.ts`：

```ts
import { waitUntil } from '@vercel/functions'
import { forecastService } from '@/lib/services/forecast.service'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import type { Interval } from '@/lib/forecast/types'
import type {
  RetrospectiveMetric,
  TaskRetrospective,
  VarianceBand,
} from '@/lib/forecast/retrospective-types'

/** 单条指标：算 deltaPct + band。forecast 或 actual 缺失 → 行降级。 */
function metric(
  forecast: Interval | null,
  actual: number | null
): RetrospectiveMetric {
  if (forecast === null || actual === null) {
    return { forecast, actual, deltaPct: null, band: null }
  }
  const deltaPct =
    forecast.median === 0
      ? null
      : Math.round(((actual - forecast.median) / forecast.median) * 100)
  const band: VarianceBand =
    actual < forecast.p25 ? 'below' : actual > forecast.p75 ? 'above' : 'within'
  return { forecast, actual, deltaPct, band }
}

export const retrospectiveService = {
  /**
   * 交付时固化 forecast 快照（LUM-319）。keep-first：已存在则跳过，保住首次交付
   * 的真实预测；全空 track 不落库（项目早期无 cohort → 该任务无回顾卡）。
   */
  async captureSnapshot(taskId: string): Promise<void> {
    const existing = await retrospectiveRepository.findSnapshot(taskId)
    if (existing) return

    const f = await forecastService.getTaskForecast(taskId)
    if (
      f.iterations === null &&
      f.clarifyRounds === null &&
      f.tokenCost === null
    )
      return

    await retrospectiveRepository.createSnapshotIfAbsent(taskId, {
      iterations: f.iterations,
      clarifyRounds: f.clarifyRounds,
      tokenCost: f.tokenCost,
      cohortSize: f.cohortSize,
      tokenCostBasis: f.tokenCostBasis,
    })
  },

  /** 读快照 + 实算 actual + 参考库规模，逐指标算偏差。无快照/无 actual → null。 */
  async getRetrospective(taskId: string): Promise<TaskRetrospective | null> {
    const snap = await retrospectiveRepository.findSnapshot(taskId)
    if (!snap) return null

    const actuals = await retrospectiveRepository.loadActuals(taskId)
    if (!actuals) return null

    const referenceLibrarySize =
      await retrospectiveRepository.countReferenceLibrary(actuals.projectId)

    return {
      tokenCost: metric(snap.tokenCost, actuals.tokenCost),
      iterations: metric(snap.iterations, actuals.iterations),
      clarifyRounds: metric(snap.clarifyRounds, actuals.clarifyRounds),
      referenceLibrarySize,
      capturedAt: snap.capturedAt,
    }
  },
}

/**
 * Fire-and-forget 包装，挂在任务转 DONE 处（task-state.service）。失败自吞，
 * 绝不回滚 completion。forecast 链仅依赖 prisma，可静态 import。
 */
export function captureRetrospectiveSnapshotInBackground(taskId: string): void {
  waitUntil(retrospectiveService.captureSnapshot(taskId).catch(() => {}))
}
```

- [x] **Step 4: 导出 service**

`lib/services/index.ts`，在 `export { forecastService } from './forecast.service'` 之后加：

```ts
export {
  retrospectiveService,
  captureRetrospectiveSnapshotInBackground,
} from './retrospective.service'
```

- [x] **Step 5: 运行测试确认通过**

Run: `npx jest __tests__/services/retrospective.service.test.ts`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add lib/services/retrospective.service.ts lib/services/index.ts __tests__/services/retrospective.service.test.ts
git commit -m "feat: retrospective service capture + get [LUM-319]"
```

---

## Task 8: 捕获钩子接进 DONE 转换

**Files:**

- Modify: `lib/services/task-state.service.ts`
- Test: `__tests__/services/retrospective-hook.test.ts`

- [x] **Step 1: 写失败测试（后台包装调用 captureSnapshot）**

```ts
/** @jest-environment node */
const waitUntil = jest.fn((p: Promise<unknown>) => p)
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => waitUntil(p),
}))
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    findSnapshot: jest.fn().mockResolvedValue({ capturedAt: new Date() }),
    createSnapshotIfAbsent: jest.fn(),
    loadActuals: jest.fn(),
    countReferenceLibrary: jest.fn(),
  },
}))
jest.mock('@/lib/services/forecast.service', () => ({
  forecastService: { getTaskForecast: jest.fn() },
}))

import { captureRetrospectiveSnapshotInBackground } from '@/lib/services/retrospective.service'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'

it('schedules captureSnapshot via waitUntil', async () => {
  captureRetrospectiveSnapshotInBackground('t1')
  expect(waitUntil).toHaveBeenCalledTimes(1)
  await Promise.resolve()
  expect(retrospectiveRepository.findSnapshot).toHaveBeenCalledWith('t1')
})
```

- [x] **Step 2: 运行测试确认失败/通过基线**

Run: `npx jest __tests__/services/retrospective-hook.test.ts`
Expected: PASS（验证后台包装已能工作 —— Task 7 已实现）。若 FAIL 说明导出/包装有误，修正后再继续。

- [x] **Step 3: 接进 task-state.service**

`lib/services/task-state.service.ts` 顶部 import 区，在 `import { stampLineageInBackground } from ...` 之后加：

```ts
import { captureRetrospectiveSnapshotInBackground } from '@/lib/services/retrospective.service'
```

在 `if (result.changedFields.includes('status') && input.status === 'DONE') {` 块内、`stampLineageInBackground(s => s.stampForTaskDone(taskId))` 之后加：

```ts
// LUM-319: 固化交付时 forecast 快照，供「交付回顾」卡对比。keep-first，
// fire-and-forget，失败不回滚 completion。
captureRetrospectiveSnapshotInBackground(taskId)
```

- [x] **Step 4: 回归 task-state 测试**

Run: `npx jest __tests__/lib/services/task-state.service.test.ts`
Expected: PASS（既有用例不受影响；retrospective import 仅 prisma 依赖，不破 jest 环境）。

- [x] **Step 5: Commit**

```bash
git add lib/services/task-state.service.ts __tests__/services/retrospective-hook.test.ts
git commit -m "feat: capture forecast snapshot on task DONE [LUM-319]"
```

---

## Task 9: API route + client + query key + hook

**Files:**

- Create: `app/api/tasks/[id]/retrospective/route.ts`
- Modify: `app/workspace/[workspaceUrl]/constants.ts`
- Modify: `lib/api-client/tasks.ts`
- Modify: `lib/query/keys.ts`
- Create: `app/workspace/[workspaceUrl]/hooks/useTaskRetrospective.ts`

- [x] **Step 1: 路由**（仿 forecast route，瘦）

`app/api/tasks/[id]/retrospective/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskService, retrospectiveService } from '@/lib/services'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/retrospective — 交付回顾：交付时固化的预测 vs 实际。
 * 无快照（老任务 / 项目早期）返回 { retrospective: null }。
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

    const retrospective = await retrospectiveService.getRetrospective(id)
    return NextResponse.json({ retrospective })
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [x] **Step 2: API path**

`app/workspace/[workspaceUrl]/constants.ts`，`tasks:` 内 `forecast:` 那行之后加：

```ts
    retrospective: (taskId: string) => `/api/tasks/${taskId}/retrospective`,
```

- [x] **Step 3: client 方法**

`lib/api-client/tasks.ts`，`forecast<T>` 方法之后加：

```ts
  retrospective<T>(taskId: string) {
    return apiFetch<T>(API.tasks.retrospective(taskId))
  },
```

- [x] **Step 4: query key**

`lib/query/keys.ts`，`tasks:` 内 `forecast:` 那行之后加：

```ts
    retrospective: (id: string) => ['tasks', 'retrospective', id] as const,
```

- [x] **Step 5: hook**（仿 useTaskForecast）

`app/workspace/[workspaceUrl]/hooks/useTaskRetrospective.ts`：

```ts
'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { TaskRetrospective } from '@/lib/forecast/retrospective-types'

/** 拉取已交付任务的回顾。taskId 为 null（未交付）时禁用。 */
export function useTaskRetrospective(taskId: string | null) {
  const enabled = !!taskId
  const query = useQuery<{ retrospective: TaskRetrospective | null }>({
    queryKey: queryKeys.tasks.retrospective(taskId ?? ''),
    queryFn: () =>
      tasksClient.retrospective<{ retrospective: TaskRetrospective | null }>(
        taskId as string
      ),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
  return {
    retrospective: query.data?.retrospective ?? undefined,
    isLoading: query.isPending && enabled,
    error: query.error ?? undefined,
  }
}
```

- [x] **Step 6: tsc 校验**

Run: `npx tsc --noEmit 2>&1 | grep -i retrospective | head`
Expected: 无输出。

- [x] **Step 7: Commit**

```bash
git add "app/api/tasks/[id]/retrospective/route.ts" "app/workspace/[workspaceUrl]/constants.ts" lib/api-client/tasks.ts lib/query/keys.ts "app/workspace/[workspaceUrl]/hooks/useTaskRetrospective.ts"
git commit -m "feat: retrospective API route + client + hook [LUM-319]"
```

---

## Task 10: RetrospectivePanel 组件 + 挂载

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/RetrospectivePanel.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx`
- Test: `__tests__/components/RetrospectivePanel.test.tsx`

i18n key 在 Task 11 补；本任务先用 key 调用 `intl.formatMessage`，Task 11 落英文 + 全 locale。

- [ ] **Step 1: 写失败测试（jsdom，带 QueryClientProvider）**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import en from '@/lib/i18n/en.json'
import { RetrospectivePanel } from '@/app/workspace/[workspaceUrl]/components/RetrospectivePanel'
import { tasksClient } from '@/lib/api-client'

jest.mock('@/lib/api-client', () => ({
  tasksClient: { retrospective: jest.fn() },
}))
const fetchRetro = tasksClient.retrospective as jest.Mock

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <IntlProvider locale='en' messages={en}>
        {ui}
      </IntlProvider>
    </QueryClientProvider>
  )
}

const iv = (p25: number, median: number, p75: number) => ({ p25, median, p75 })

beforeEach(() => fetchRetro.mockReset())

it('renders nothing for a non-DONE task (no fetch)', () => {
  const { container } = wrap(
    <RetrospectivePanel taskId='t1' status='IN_PROGRESS' />
  )
  expect(container).toBeEmptyDOMElement()
  expect(fetchRetro).not.toHaveBeenCalled()
})

it('renders nothing when retrospective is null', async () => {
  fetchRetro.mockResolvedValue({ retrospective: null })
  const { container } = wrap(<RetrospectivePanel taskId='t1' status='DONE' />)
  await waitFor(() => expect(fetchRetro).toHaveBeenCalled())
  expect(container).toBeEmptyDOMElement()
})

it('renders token compare + delivery rows + flywheel count', async () => {
  fetchRetro.mockResolvedValue({
    retrospective: {
      tokenCost: {
        forecast: iv(2.4e7, 2.6e7, 3e7),
        actual: 2.95e7,
        deltaPct: 13,
        band: 'within',
      },
      iterations: {
        forecast: iv(2, 3, 3),
        actual: 3,
        deltaPct: 0,
        band: 'within',
      },
      clarifyRounds: {
        forecast: iv(1, 1, 2),
        actual: 2,
        deltaPct: 100,
        band: 'within',
      },
      referenceLibrarySize: 27,
      capturedAt: '2026-06-01',
    },
  })
  wrap(<RetrospectivePanel taskId='t1' status='DONE' />)
  await screen.findByText(en['retrospective.title'])
  expect(screen.getByText('+13%', { exact: false })).toBeInTheDocument()
  expect(screen.getByText('27', { exact: false })).toBeInTheDocument()
})

it('degrades a row to actual-only when its forecast is null', async () => {
  fetchRetro.mockResolvedValue({
    retrospective: {
      tokenCost: { forecast: null, actual: null, deltaPct: null, band: null },
      iterations: {
        forecast: iv(1, 2, 2),
        actual: 4,
        deltaPct: 100,
        band: 'above',
      },
      clarifyRounds: { forecast: null, actual: 3, deltaPct: null, band: null },
      referenceLibrarySize: 10,
      capturedAt: '2026-06-01',
    },
  })
  wrap(<RetrospectivePanel taskId='t1' status='DONE' />)
  await screen.findByText(en['retrospective.title'])
  // clarify 行降级文案出现，token hero 区不渲染
  expect(
    screen.getByText(en['retrospective.noForecast'], { exact: false })
  ).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest __tests__/components/RetrospectivePanel.test.tsx`
Expected: FAIL（组件不存在 / key 未定义）。

- [ ] **Step 3: 实现组件**

`app/workspace/[workspaceUrl]/components/RetrospectivePanel.tsx`：

```tsx
'use client'

import { useIntl } from 'react-intl'
import { useTaskRetrospective } from '../hooks/useTaskRetrospective'
import type { Interval } from '@/lib/forecast/types'
import type {
  RetrospectiveMetric,
  VarianceBand,
} from '@/lib/forecast/retrospective-types'
import type { ApiStatus } from '../types'

const BAND_KEY: Record<VarianceBand, string> = {
  within: 'retrospective.bandWithin',
  above: 'retrospective.bandAbove',
  below: 'retrospective.bandBelow',
}

// 偏差 pill：克制配色（layered tokens / feedback subtle）。within → success subtle，
// above/below → warning subtle。颜色仅轻状态暗示，层级靠数字字重。
function VariancePill({ metric }: { metric: RetrospectiveMetric }) {
  const intl = useIntl()
  if (metric.band === null || metric.deltaPct === null) return null
  const tone =
    metric.band === 'within'
      ? 'bg-success-subtle text-success'
      : 'bg-warning-subtle text-warning'
  const sign = metric.deltaPct > 0 ? '+' : ''
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-medium ${tone}`}
    >
      {sign}
      {metric.deltaPct}% · {intl.formatMessage({ id: BAND_KEY[metric.band] })}
    </span>
  )
}

// 静态区间带：灰条 = p25–p75，竖刻度 = median，圆点 = actual 落点。
// 纯位置指示、无交互。区间宽度按 [min(p25,actual), max(p75,actual)] 归一化。
function RangeBand({
  forecast,
  actual,
}: {
  forecast: Interval
  actual: number
}) {
  const lo = Math.min(forecast.p25, actual)
  const hi = Math.max(forecast.p75, actual)
  const span = hi - lo || 1
  const pct = (v: number) => ((v - lo) / span) * 100
  return (
    <div className='relative my-3 h-1.5 rounded-full bg-muted'>
      <div
        className='absolute inset-y-0 rounded-full bg-muted-foreground/25'
        style={{
          left: `${pct(forecast.p25)}%`,
          right: `${100 - pct(forecast.p75)}%`,
        }}
      />
      <div
        className='absolute -top-1 h-3.5 w-0.5 rounded bg-muted-foreground/50'
        style={{ left: `${pct(forecast.median)}%` }}
      />
      <div
        className='absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-info'
        style={{ left: `${pct(actual)}%` }}
      />
    </div>
  )
}

function compact(intl: ReturnType<typeof useIntl>, n: number) {
  return intl.formatNumber(n, { notation: 'compact', maximumFractionDigits: 1 })
}

function range(
  intl: ReturnType<typeof useIntl>,
  iv: Interval,
  fmt: (n: number) => string
) {
  return intl.formatMessage(
    { id: 'forecast.range' },
    { median: fmt(iv.median), low: fmt(iv.p25), high: fmt(iv.p75) }
  )
}

// 交付区一行：预测 range · 实际 N；forecast 缺失 → 实际 N · 无足量历史预测。
function CompareRow({
  label,
  metric,
}: {
  label: string
  metric: RetrospectiveMetric
}) {
  const intl = useIntl()
  const fmt = (n: number) => String(Math.round(n))
  return (
    <div className='flex items-baseline justify-between gap-2 py-1'>
      <span className='text-caption text-foreground'>{label}</span>
      <span className='text-right text-caption text-muted-foreground tabular-nums'>
        {metric.forecast ? (
          <>
            {intl.formatMessage(
              { id: 'retrospective.predicted' },
              { value: range(intl, metric.forecast, fmt) }
            )}
            <span className='mx-1.5 text-muted-foreground/60'>·</span>
            <span className='font-semibold text-foreground'>
              {intl.formatMessage(
                { id: 'retrospective.actual' },
                { value: metric.actual ?? '—' }
              )}
            </span>
          </>
        ) : (
          <>
            <span className='font-semibold text-foreground'>
              {intl.formatMessage(
                { id: 'retrospective.actual' },
                { value: metric.actual ?? '—' }
              )}
            </span>
            <span className='mx-1.5 text-muted-foreground/60'>·</span>
            {intl.formatMessage({ id: 'retrospective.noForecast' })}
          </>
        )}
      </span>
    </div>
  )
}

export function RetrospectivePanel({
  taskId,
  status,
}: {
  taskId: string
  status: ApiStatus
}) {
  const intl = useIntl()
  const isTerminal = status === 'DONE'
  const { retrospective, isLoading, error } = useTaskRetrospective(
    isTerminal ? taskId : null
  )

  if (!isTerminal) return null
  if (isLoading || error || !retrospective) return null

  const { tokenCost, iterations, clarifyRounds, referenceLibrarySize } =
    retrospective
  const showToken = !!tokenCost.forecast && tokenCost.actual !== null

  return (
    <section className='mt-6 border-t border-border pt-6'>
      <div className='mb-3 flex items-center justify-between gap-2'>
        <p className='text-caption font-semibold uppercase tracking-wider text-muted-foreground'>
          {intl.formatMessage({ id: 'retrospective.title' })}
        </p>
        <span className='shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'retrospective.done' })}
        </span>
      </div>

      {showToken && tokenCost.forecast && (
        <div className='mb-4'>
          <p className='mb-2 text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'retrospective.tokenUsage' })}
          </p>
          <div className='flex items-baseline justify-between gap-3'>
            <span className='text-caption text-muted-foreground'>
              {intl.formatMessage(
                { id: 'retrospective.predicted' },
                { value: compact(intl, tokenCost.forecast.median) }
              )}
            </span>
            <span className='text-right'>
              <span className='mr-1.5 text-caption text-muted-foreground'>
                {intl.formatMessage({ id: 'retrospective.actualLabel' })}
              </span>
              <span className='text-title-strong text-foreground tabular-nums'>
                {compact(intl, tokenCost.actual as number)}
              </span>
            </span>
          </div>
          <VariancePill metric={tokenCost} />
          <RangeBand
            forecast={tokenCost.forecast}
            actual={tokenCost.actual as number}
          />
        </div>
      )}

      <div className='border-t border-border pt-3'>
        <p className='mb-1 text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'retrospective.delivery' })}
        </p>
        <CompareRow
          label={intl.formatMessage({ id: 'retrospective.iterations' })}
          metric={iterations}
        />
        <CompareRow
          label={intl.formatMessage({ id: 'retrospective.clarifyRounds' })}
          metric={clarifyRounds}
        />
      </div>

      <div className='mt-4 flex items-start gap-2.5 rounded-xl bg-muted/50 px-3 py-3'>
        <span className='mt-0.5 text-info' aria-hidden>
          ↻
        </span>
        <p className='text-caption leading-relaxed text-muted-foreground'>
          {intl.formatMessage(
            { id: 'retrospective.flywheel' },
            { count: referenceLibrarySize }
          )}
        </p>
      </div>
    </section>
  )
}
```

> 配色 class（`bg-success-subtle`/`text-success`/`bg-warning-subtle`/`text-warning`/`bg-info`/`text-info`）须已存在于设计系统 token（见 memory「Semantic feedback tokens」）。若某 class 不存在，用 `bg-[color-mix(...)]` 或就近的 feedback token 替代，**勿引入裸 hex**（会触发 token-lint）。先 `grep -rn "success-subtle\|text-success\|bg-info" app components` 确认命名，对不上则按实际 token 名调整。

- [ ] **Step 4: 挂载到侧栏**

`app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx`：

import 区加：

```ts
import { RetrospectivePanel } from './RetrospectivePanel'
```

`<ForecastPanel taskId={task.id} status={task.status} />` 之后加：

```tsx
<RetrospectivePanel taskId={task.id} status={task.status} />
```

> 二者按 status 互斥（ForecastPanel 在 DONE 返回 null，RetrospectivePanel 在非 DONE 返回 null），可安全并列。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx jest __tests__/components/RetrospectivePanel.test.tsx`
Expected: PASS（依赖 Task 11 的 key；若此刻 key 未落，先在 Task 11 完成后回跑。建议顺序：先做 Task 11 的 en.json，再回本步）。

- [ ] **Step 6: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/RetrospectivePanel.tsx" "app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx" __tests__/components/RetrospectivePanel.test.tsx
git commit -m "feat: RetrospectivePanel + sidebar mount [LUM-319]"
```

---

## Task 11: i18n —— retrospective.\* 全 16 locale

**Files:**

- Modify: `lib/i18n/en.json`
- Modify: 其余 15 locale（`npm run i18n:sync` 起手）

- [ ] **Step 1: 加 en.json key**

`lib/i18n/en.json` 加（放在 `forecast.*` 附近）：

```json
  "retrospective.title": "Delivery retrospective",
  "retrospective.done": "Done",
  "retrospective.tokenUsage": "Token usage",
  "retrospective.predicted": "Forecast {value}",
  "retrospective.actual": "actual {value}",
  "retrospective.actualLabel": "actual",
  "retrospective.delivery": "Delivery",
  "retrospective.iterations": "Runs",
  "retrospective.clarifyRounds": "Clarification rounds",
  "retrospective.noForecast": "no forecast history yet",
  "retrospective.bandWithin": "within the usual range",
  "retrospective.bandAbove": "above the usual range",
  "retrospective.bandBelow": "below the usual range",
  "retrospective.flywheel": "Added to the reference library for forecasting future similar tasks ({count} now)"
```

- [ ] **Step 2: scaffold 其余 locale**

Run: `npm run i18n:sync`
Expected: 15 个 locale 文件被回填 `[TODO:<locale>] …` 占位，parity 测可过。

- [ ] **Step 3: 替换占位为真翻译**

逐个 locale 把 `retrospective.*` 的 `[TODO:…]` 换成真翻译（zh-CN 用截图原文："交付回顾 / 已完成 / token 用量 / 预测 {value} / 实际 {value} / 实际 / 交付 / 运行次数 / 澄清轮次 / 无足量历史预测 / 落在常见区间内 / 高于常见区间 / 低于常见区间 / 已计入参考库，将用于未来同类任务的预测（现 {count} 个）"）。**不留任何 `[TODO:` 标记**。

- [ ] **Step 4: parity + drift 校验**

Run: `npm run i18n:check && npx jest -t "locale" 2>&1 | tail -5`
Expected: 无 drift；locale parity 测 PASS。

- [ ] **Step 5: 回跑组件测试**

Run: `npx jest __tests__/components/RetrospectivePanel.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/i18n
git commit -m "feat: retrospective i18n keys across all locales [LUM-319]"
```

---

## Task 12: 全量校验 + 清理 mock

**Files:**

- Delete: `.mock/retrospective.html`
- Modify: `.claude/launch.json`（移除 `mock-static`）

- [ ] **Step 1: 全量类型 + 测试**

Run: `npx tsc --noEmit && npx jest 2>&1 | tail -15`
Expected: tsc 零错误；两个测试根（`__tests__/` 与 `tests/`）全绿。

- [ ] **Step 2: token-lint（UI 文件）**

Run: `npm run lint:tokens 2>&1 | tail -10`
Expected: 无新增违规（RetrospectivePanel 无裸 hex）。

- [ ] **Step 3: 删 mock 临时物**

```bash
rm -rf .mock
```

`.claude/launch.json` 删掉 `mock-static` 配置块，恢复为仅 `lumo-dev`。

- [ ] **Step 4: build 兜底（唯一 CI gate 是 Vercel build）**

Run: `npm run build 2>&1 | tail -15`
Expected: 构建成功。

- [ ] **Step 5: Commit + PR**

```bash
git add -A
git commit -m "chore: drop mock scaffolding, finalize retrospective [LUM-319]"
git push -u origin lumo/LUM-319-delivery-retrospective
gh pr create --title "feat: delivery retrospective — forecast-vs-actual card [LUM-319]" --body "$(cat <<'EOF'
## 交付回顾（Delivery Retrospective）

DONE 任务侧栏渲染回顾卡：交付时固化的 forecast 快照 vs 实际（token / 运行次数 / 澄清轮次），以「已计入参考库（现 N 个）」收尾。

### 改动
- 新表 `TaskForecastSnapshot`（交付时快照，keep-first）—— **prod 下次 deploy 需 `prisma migrate deploy`，无数据销毁**
- 新增「澄清轮次」forecast track（按任务 count `AGENT_CLARIFY` notification）
- retrospective service/repository/route/hook + `RetrospectivePanel`
- DONE 转换处 fire-and-forget 捕获快照
- i18n 全 16 locale
- 老任务无快照 → 不渲染（不做 post-hoc 回填）

### 测试
- metrics/repository/service/component(jsdom) 全覆盖；`npx tsc --noEmit` + 全量 `npx jest` 绿

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage：**

- 快照表 + keep-first → Task 1/6/7 ✓
- 澄清轮次预测线（AGENT_CLARIFY count）→ Task 2/3/4 ✓
- capture at DONE（fire-and-forget）→ Task 8 ✓
- getRetrospective + band/deltaPct → Task 7 ✓
- referenceLibrarySize 口径 → Task 6 ✓
- API/client/hook → Task 9 ✓
- RetrospectivePanel（互斥挂载、降级、静态区间带、克制 pill、飞轮行）→ Task 10 ✓
- 老任务不显卡 → Task 7（无快照→null）+ Task 10（null→不渲染）✓
- i18n 全 locale → Task 11 ✓
- 边界 reopen/项目早期/clarify 稀疏 → Task 7 测试 ✓

**类型一致性：** `RetrospectiveMetric`/`TaskRetrospective`/`VarianceBand`（Task 5）在 service（7）、hook（9）、组件（10）一致；`SnapshotRow`/`SnapshotPayload`/`RetrospectiveActuals`（Task 6）在 service（7）一致；`forecast.clarifyRounds`（Task 4）→ snapshot payload（7）一致。

**已知顺序依赖：** Task 10 组件测试依赖 Task 11 的 en.json key——执行时建议先落 Task 11 Step 1（en.json）再跑 Task 10 Step 5，或接受 Task 10 Step 5 在 Task 11 后回跑（已在步骤注明）。

**配色 token 假设：** Task 10 的 `success-subtle`/`warning`/`info` class 名是按 memory「Semantic feedback tokens」推断；Step 3 注明执行时先 grep 校名，对不上按实际 token 调整，禁裸 hex。

```

```
