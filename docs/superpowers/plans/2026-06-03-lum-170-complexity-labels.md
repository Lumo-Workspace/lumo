# 事后复杂度标签(LUM-170)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 任务转 DONE 时,从其 AgentRun 执行数据沉淀不可变复杂度信号(总时长 + 变更文件数),并提供读时相对分位分桶纯函数,作为 LUM-171 检索预测的数据底座。

**Architecture:** 写时只沉淀 per-task 原始信号(独立 `TaskComplexity` 表,1:1 Task),在 `task-state.service` 现有 DONE 钩子旁 `waitUntil()` 后台聚合写入;复合分数与 low/med/high 桶都由纯函数在读时对当前 team 分布(percentile rank 等权平均)算出。无 UI / CLI / API route。

**Tech Stack:** Next.js 14、TypeScript(strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`)、Prisma + Neon Postgres、Jest(SWC,mock Prisma)。

**工作目录:** 所有命令在 worktree 内执行 —— 先 `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-170`(jest 必须在此 cwd 跑,否则撞 cli/package.json haste collision 跑错树)。分支必须是 `lumo/LUM-170-complexity-labels`。

**关键约定(踩坑预防):**
- Repository 测试 mock `@/lib/db/prisma`;Service 测试 mock repository 模块。测试放 `__tests__/`,命名 `*.test.ts`。
- `noUncheckedIndexedAccess` 开启:`arr[i]` 是 `T|undefined`,用 `for..of` 或先 capture+guard,别裸索引。jest/SWC 不报,只有 `tsc --noEmit` 抓。
- `exactOptionalPropertyTypes` 开启:可选字段若要接受 `undefined`,声明 `field?: T | undefined`。
- 本计划的 service 只触 Prisma,**不引入 AI SDK gateway**,用静态 import(无 jest TransformStream 陷阱)。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `prisma/schema.prisma`(改) | 新增 `TaskComplexity` model + Task 反向关系 |
| `lib/complexity/bucket.ts`(建) | 纯函数:`percentileRank` + `bucketComplexity`(本任务的"大脑",无 IO) |
| `lib/repositories/task-complexity.repository.ts`(建) | Prisma 封装:读 AgentRun 信号、upsert/findByTaskId/listByTeam |
| `lib/services/task-complexity.service.ts`(建) | `sedimentForTask`:聚合信号 → 资格判定 → upsert,自捕获错误 |
| `lib/services/task-state.service.ts`(改) | DONE 钩子旁 `waitUntil()` 接线 |
| `__tests__/complexity-bucket.test.ts`(建) | 分桶纯函数测试 |
| `__tests__/task-complexity.repository.test.ts`(建) | repository 测试 |
| `__tests__/task-complexity.service.test.ts`(建) | service 聚合/资格/覆盖测试 |
| `__tests__/task-state.complexity-trigger.test.ts`(建) | DONE 触发接线测试 |

---

## Task 1: Prisma schema —— TaskComplexity 表

**Files:**
- Modify: `prisma/schema.prisma`(Task model 内 `~465` 行 relations 区;AgentRun model 之后 `~859` 行)

- [ ] **Step 1: 在 Task model 的 relations 区加反向关系**

在 `prisma/schema.prisma` Task model 里,`artifacts TaskArtifact[]` 那一行之后加:

```prisma
  complexity        TaskComplexity?
```

- [ ] **Step 2: 在 AgentRun model 之后新增 TaskComplexity model**

在 `model AgentRun { ... }` 闭合大括号之后插入:

```prisma
model TaskComplexity {
  id               String   @id @default(cuid())
  taskId           String   @unique
  teamId           String // 分位分布的范围键
  totalDurationMs  Int // 所有 finished AgentRun 的 durationMs 求和
  changedFileCount Int // 各 run changedFiles 去重并集的大小
  agentRunCount    Int // 上下文用,不进复合分
  computedAt       DateTime @default(now())

  task Task @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([teamId])
  @@map("task_complexities")
}
```

- [ ] **Step 3: 生成迁移并重生成 client**

Run:
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-170
npx prisma migrate dev --name add_task_complexity
npx prisma generate
```
Expected: 新建 `prisma/migrations/<ts>_add_task_complexity/migration.sql`(`CREATE TABLE "task_complexities" ...`),client 重新生成成功。
> 若 dev DB 报 P3008/P3012 checksum drift:按 CLAUDE.md 手写 SQL → `npx prisma db execute --file <path>` → `npx prisma migrate resolve --applied add_task_complexity` → `npx prisma generate`。**禁止** `migrate reset`。

- [ ] **Step 4: 确认类型可见**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -i "taskComplexity\|TaskComplexity" || echo "no taskComplexity type errors"
```
Expected: `no taskComplexity type errors`(client 已认得 `prisma.taskComplexity` 与 `TaskComplexity` 类型)。

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add TaskComplexity model + migration [LUM-170]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 分桶纯函数 `lib/complexity/bucket.ts`

**Files:**
- Create: `lib/complexity/bucket.ts`
- Test: `__tests__/complexity-bucket.test.ts`

- [ ] **Step 1: 写失败测试**

Create `__tests__/complexity-bucket.test.ts`:

```ts
import { bucketComplexity } from '@/lib/complexity/bucket'
import type { ComplexitySignals } from '@/lib/complexity/bucket'

// 一个 9 元 cohort,duration 与 files 同序递增,便于推断分位
const COHORT: ComplexitySignals[] = [
  { totalDurationMs: 1, changedFileCount: 1 },
  { totalDurationMs: 2, changedFileCount: 2 },
  { totalDurationMs: 3, changedFileCount: 3 },
  { totalDurationMs: 4, changedFileCount: 4 },
  { totalDurationMs: 5, changedFileCount: 5 },
  { totalDurationMs: 6, changedFileCount: 6 },
  { totalDurationMs: 7, changedFileCount: 7 },
  { totalDurationMs: 8, changedFileCount: 8 },
  { totalDurationMs: 9, changedFileCount: 9 },
]

describe('bucketComplexity', () => {
  it('cohort 样本不足 minSample 时返回 insufficient_data', () => {
    const small = COHORT.slice(0, 4)
    expect(bucketComplexity(small[0]!, small)).toEqual({
      bucket: null,
      reason: 'insufficient_data',
    })
  })

  it('最低信号落 low', () => {
    const r = bucketComplexity({ totalDurationMs: 1, changedFileCount: 1 }, COHORT)
    expect(r.bucket).toBe('low')
  })

  it('中位信号落 med', () => {
    const r = bucketComplexity({ totalDurationMs: 5, changedFileCount: 5 }, COHORT)
    expect(r.bucket).toBe('med')
  })

  it('最高信号落 high', () => {
    const r = bucketComplexity({ totalDurationMs: 9, changedFileCount: 9 }, COHORT)
    expect(r.bucket).toBe('high')
  })

  it('单信号极端被等权中和:时长 top 但文件 bottom → 不落 high', () => {
    // duration rank≈高, file rank≈低, 平均 ≈ 中
    const r = bucketComplexity({ totalDurationMs: 9, changedFileCount: 1 }, COHORT)
    expect(r.bucket).toBe('med')
  })

  it('并列值用中点分位,落桶稳定', () => {
    const tie: ComplexitySignals[] = [
      { totalDurationMs: 5, changedFileCount: 5 },
      { totalDurationMs: 5, changedFileCount: 5 },
      { totalDurationMs: 5, changedFileCount: 5 },
      { totalDurationMs: 5, changedFileCount: 5 },
      { totalDurationMs: 5, changedFileCount: 5 },
    ]
    const r = bucketComplexity(tie[0]!, tie)
    // 全并列 → rank = 0.5 → med
    expect(r).toEqual({ bucket: 'med', score: 0.5 })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-170
npx jest __tests__/complexity-bucket.test.ts
```
Expected: FAIL —— `Cannot find module '@/lib/complexity/bucket'`。

- [ ] **Step 3: 写实现**

Create `lib/complexity/bucket.ts`:

```ts
export type Bucket = 'low' | 'med' | 'high'

export interface ComplexitySignals {
  totalDurationMs: number
  changedFileCount: number
}

export type BucketResult =
  | { bucket: Bucket; score: number }
  | { bucket: null; reason: 'insufficient_data' }

/**
 * value 在 values 中的 percentile rank ∈ [0,1]。
 * 并列取中点((less + 0.5·equal) / n),避免边界突变。
 */
function percentileRank(value: number, values: number[]): number {
  const n = values.length
  if (n === 0) return 0
  let less = 0
  let equal = 0
  for (const v of values) {
    if (v < value) less++
    else if (v === value) equal++
  }
  return (less + 0.5 * equal) / n
}

/**
 * 相对分位分桶。cohort 应包含 target 自身(target 是已沉淀行之一)。
 * 两信号各自算 percentile rank → 等权平均 → P33/P66 落桶。
 * cohort 不足 minSample(默认 5)时不编桶,返回 insufficient_data。
 */
export function bucketComplexity(
  target: ComplexitySignals,
  cohort: ComplexitySignals[],
  opts: { minSample?: number } = {}
): BucketResult {
  const minSample = opts.minSample ?? 5
  if (cohort.length < minSample) {
    return { bucket: null, reason: 'insufficient_data' }
  }
  const durations = cohort.map(c => c.totalDurationMs)
  const files = cohort.map(c => c.changedFileCount)
  const durRank = percentileRank(target.totalDurationMs, durations)
  const fileRank = percentileRank(target.changedFileCount, files)
  const score = (durRank + fileRank) / 2
  const bucket: Bucket = score < 1 / 3 ? 'low' : score < 2 / 3 ? 'med' : 'high'
  return { bucket, score }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
npx jest __tests__/complexity-bucket.test.ts
```
Expected: PASS(6 个用例全绿)。

- [ ] **Step 5: Commit**

```bash
git add lib/complexity/bucket.ts __tests__/complexity-bucket.test.ts
git commit -m "feat: relative percentile complexity bucketing [LUM-170]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Repository `lib/repositories/task-complexity.repository.ts`

**Files:**
- Create: `lib/repositories/task-complexity.repository.ts`
- Test: `__tests__/task-complexity.repository.test.ts`

- [ ] **Step 1: 写失败测试**

Create `__tests__/task-complexity.repository.test.ts`:

```ts
import { taskComplexityRepository } from '@/lib/repositories/task-complexity.repository'

const mockAgentRunFindMany = jest.fn()
const mockUpsert = jest.fn()
const mockFindUnique = jest.fn()
const mockFindMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    agentRun: {
      findMany: (...a: any[]) => mockAgentRunFindMany(...a),
    },
    taskComplexity: {
      upsert: (...a: any[]) => mockUpsert(...a),
      findUnique: (...a: any[]) => mockFindUnique(...a),
      findMany: (...a: any[]) => mockFindMany(...a),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('taskComplexityRepository', () => {
  it('listRunSignalsForTask 只取已完成 run 的信号字段', async () => {
    mockAgentRunFindMany.mockResolvedValueOnce([])
    await taskComplexityRepository.listRunSignalsForTask('t1')
    expect(mockAgentRunFindMany).toHaveBeenCalledWith({
      where: { taskId: 't1', finishedAt: { not: null } },
      select: { durationMs: true, changedFiles: true },
    })
  })

  it('upsert 按 taskId,update 路径刷新 computedAt', async () => {
    mockUpsert.mockResolvedValueOnce({ id: 'c1' })
    await taskComplexityRepository.upsert({
      taskId: 't1',
      teamId: 'team1',
      totalDurationMs: 100,
      changedFileCount: 3,
      agentRunCount: 2,
    })
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { taskId: 't1' },
      create: {
        taskId: 't1',
        teamId: 'team1',
        totalDurationMs: 100,
        changedFileCount: 3,
        agentRunCount: 2,
      },
      update: {
        teamId: 'team1',
        totalDurationMs: 100,
        changedFileCount: 3,
        agentRunCount: 2,
        computedAt: expect.any(Date),
      },
    })
  })

  it('findByTaskId 按 taskId 查唯一行', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    await taskComplexityRepository.findByTaskId('t1')
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { taskId: 't1' } })
  })

  it('listByTeam 取 cohort 的信号字段', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await taskComplexityRepository.listByTeam('team1')
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { teamId: 'team1' },
      select: { taskId: true, totalDurationMs: true, changedFileCount: true },
    })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-170
npx jest __tests__/task-complexity.repository.test.ts
```
Expected: FAIL —— `Cannot find module '@/lib/repositories/task-complexity.repository'`。

- [ ] **Step 3: 写实现**

Create `lib/repositories/task-complexity.repository.ts`:

```ts
import { prisma } from '@/lib/db/prisma'

export interface TaskComplexityUpsert {
  taskId: string
  teamId: string
  totalDurationMs: number
  changedFileCount: number
  agentRunCount: number
}

export const taskComplexityRepository = {
  /** 该 task 所有已完成 AgentRun 的复杂度信号字段。 */
  async listRunSignalsForTask(taskId: string) {
    return prisma.agentRun.findMany({
      where: { taskId, finishedAt: { not: null } },
      select: { durationMs: true, changedFiles: true },
    })
  },

  async upsert(data: TaskComplexityUpsert) {
    const { taskId, ...rest } = data
    return prisma.taskComplexity.upsert({
      where: { taskId },
      create: { taskId, ...rest },
      update: { ...rest, computedAt: new Date() },
    })
  },

  async findByTaskId(taskId: string) {
    return prisma.taskComplexity.findUnique({ where: { taskId } })
  },

  /** team 内全部已沉淀行,作为读时分桶的 cohort。 */
  async listByTeam(teamId: string) {
    return prisma.taskComplexity.findMany({
      where: { teamId },
      select: { taskId: true, totalDurationMs: true, changedFileCount: true },
    })
  },
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
npx jest __tests__/task-complexity.repository.test.ts
```
Expected: PASS(4 个用例全绿)。

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/task-complexity.repository.ts __tests__/task-complexity.repository.test.ts
git commit -m "feat: TaskComplexity repository [LUM-170]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Service `lib/services/task-complexity.service.ts`

**Files:**
- Create: `lib/services/task-complexity.service.ts`
- Test: `__tests__/task-complexity.service.test.ts`

- [ ] **Step 1: 写失败测试**

Create `__tests__/task-complexity.service.test.ts`:

```ts
import { taskComplexityService } from '@/lib/services/task-complexity.service'

const mockListRunSignals = jest.fn()
const mockUpsert = jest.fn()

jest.mock('@/lib/repositories/task-complexity.repository', () => ({
  taskComplexityRepository: {
    listRunSignalsForTask: (...a: any[]) => mockListRunSignals(...a),
    upsert: (...a: any[]) => mockUpsert(...a),
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('taskComplexityService.sedimentForTask', () => {
  it('求和 durationMs,changedFiles 跨 run 去重并集计数', async () => {
    mockListRunSignals.mockResolvedValueOnce([
      { durationMs: 100, changedFiles: ['a.ts', 'b.ts'] },
      { durationMs: 50, changedFiles: ['b.ts', 'c.ts'] },
    ])
    await taskComplexityService.sedimentForTask('t1', 'team1')
    expect(mockUpsert).toHaveBeenCalledWith({
      taskId: 't1',
      teamId: 'team1',
      totalDurationMs: 150,
      changedFileCount: 3, // {a,b,c}
      agentRunCount: 2,
    })
  })

  it('durationMs 为 null 的 run 计入 run 数但不加时长', async () => {
    mockListRunSignals.mockResolvedValueOnce([
      { durationMs: null, changedFiles: ['a.ts'] },
      { durationMs: 80, changedFiles: ['a.ts'] },
    ])
    await taskComplexityService.sedimentForTask('t1', 'team1')
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: 80, changedFileCount: 1, agentRunCount: 2 })
    )
  })

  it('changedFiles 非数组(null/非法)被安全跳过', async () => {
    mockListRunSignals.mockResolvedValueOnce([
      { durationMs: 20, changedFiles: null },
      { durationMs: 30, changedFiles: 'oops' },
    ])
    await taskComplexityService.sedimentForTask('t1', 'team1')
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: 50, changedFileCount: 0, agentRunCount: 2 })
    )
  })

  it('无任何 run → 不 upsert(纯人工任务不沉淀)', async () => {
    mockListRunSignals.mockResolvedValueOnce([])
    await taskComplexityService.sedimentForTask('t1', 'team1')
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('有 run 但两信号皆为空 → 不 upsert(无信号不污染分布)', async () => {
    mockListRunSignals.mockResolvedValueOnce([
      { durationMs: null, changedFiles: null },
    ])
    await taskComplexityService.sedimentForTask('t1', 'team1')
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('repository 抛错被自捕获,不向上抛(fire-and-forget)', async () => {
    mockListRunSignals.mockRejectedValueOnce(new Error('db down'))
    await expect(
      taskComplexityService.sedimentForTask('t1', 'team1')
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-170
npx jest __tests__/task-complexity.service.test.ts
```
Expected: FAIL —— `Cannot find module '@/lib/services/task-complexity.service'`。

- [ ] **Step 3: 写实现**

Create `lib/services/task-complexity.service.ts`:

```ts
import { taskComplexityRepository } from '@/lib/repositories/task-complexity.repository'

export const taskComplexityService = {
  /**
   * 任务转 DONE 时调用(fire-and-forget,见 task-state.service)。
   * 聚合该任务所有已完成 AgentRun 的执行信号并 upsert。
   * 无执行数据(无 run / 两信号皆空)的任务不沉淀,以免污染 team 分布。
   * 错误自捕获并记日志,绝不向上抛。
   */
  async sedimentForTask(taskId: string, teamId: string): Promise<void> {
    try {
      const runs =
        await taskComplexityRepository.listRunSignalsForTask(taskId)

      let totalDurationMs = 0
      const files = new Set<string>()
      for (const run of runs) {
        if (typeof run.durationMs === 'number') {
          totalDurationMs += run.durationMs
        }
        const cf = run.changedFiles
        if (Array.isArray(cf)) {
          for (const f of cf) {
            if (typeof f === 'string') files.add(f)
          }
        }
      }
      const agentRunCount = runs.length
      const changedFileCount = files.size

      // 资格:必须有真实执行数据,否则不沉淀
      if (
        agentRunCount === 0 ||
        (totalDurationMs === 0 && changedFileCount === 0)
      ) {
        return
      }

      await taskComplexityRepository.upsert({
        taskId,
        teamId,
        totalDurationMs,
        changedFileCount,
        agentRunCount,
      })
    } catch (error) {
      // fire-and-forget:与 layer2.service 同款,失败只记日志不回灌响应
      console.error(
        `[complexity] sedimentForTask failed task=${taskId}`,
        error
      )
    }
  },
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
npx jest __tests__/task-complexity.service.test.ts
```
Expected: PASS(6 个用例全绿;"自捕获"用例中 `console.error` 会打印一行,属预期)。

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-complexity.service.ts __tests__/task-complexity.service.test.ts
git commit -m "feat: sedimentForTask aggregates execution signals [LUM-170]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 接线 —— DONE 转换触发沉淀

**Files:**
- Modify: `lib/services/task-state.service.ts`(import 区 + `~278` 行 DONE 钩子内)
- Test: `__tests__/task-state.complexity-trigger.test.ts`

- [ ] **Step 1: 写失败测试**

Create `__tests__/task-state.complexity-trigger.test.ts`:

```ts
import { updateTaskWithSideEffects } from '@/lib/services/task-state.service'

const mockUpdateTask = jest.fn()
const mockSediment = jest.fn()

// updateTask 是同模块导出;mock 掉其依赖,直接桩 updateTask 的返回。
// 这里走「mock 依赖 + 真跑 updateTaskWithSideEffects」:桩 updateTask via 内部调用难,
// 改为 mock 下游服务,断言触发条件。
jest.mock('@/lib/services/task-notifications.service', () => ({
  dispatchUpdateTaskSideEffects: jest.fn(),
}))
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))
jest.mock('@/lib/services/task-complexity.service', () => ({
  taskComplexityService: {
    sedimentForTask: (...a: any[]) => mockSediment(...a),
  },
}))
// layer2 是动态 import,mock 掉避免拉 AI SDK
jest.mock('@/lib/services/memory/layer2.service', () => ({
  layer2Service: { triggerForTaskCompletion: jest.fn() },
}))
// 桩同模块的 updateTask:用 spyOn 截获
import * as taskState from '@/lib/services/task-state.service'

beforeEach(() => jest.clearAllMocks())

function fakeResult(status: string, changed: string[]) {
  return {
    task: { id: 't1', teamId: 'team1', projectId: 'p1' },
    changedFields: changed,
  }
}

describe('updateTaskWithSideEffects → complexity 触发', () => {
  it('状态变为 DONE 时调用 sedimentForTask(taskId, teamId)', async () => {
    jest
      .spyOn(taskState, 'updateTask')
      .mockResolvedValueOnce(fakeResult('DONE', ['status']) as any)
    await taskState.updateTaskWithSideEffects(
      't1',
      { status: 'DONE' } as any,
      {} as any,
      'actor1',
      'clerk1'
    )
    expect(mockSediment).toHaveBeenCalledWith('t1', 'team1')
  })

  it('非 DONE 转换不触发', async () => {
    jest
      .spyOn(taskState, 'updateTask')
      .mockResolvedValueOnce(fakeResult('IN_PROGRESS', ['status']) as any)
    await taskState.updateTaskWithSideEffects(
      't1',
      { status: 'IN_PROGRESS' } as any,
      {} as any,
      'actor1',
      'clerk1'
    )
    expect(mockSediment).not.toHaveBeenCalled()
  })
})
```

> 注:`jest.spyOn(taskState, 'updateTask')` 截获同模块函数,前提是 `updateTaskWithSideEffects` 内部以 `updateTask(...)` 直接调用(当前即是)。若 spy 不生效(SWC 下同模块调用可能绑定到本地引用),回退方案:改为 mock `@/lib/repositories/task.repository` 等 `updateTask` 的下游依赖、构造一个真会转 DONE 的输入。实现侧逻辑不变。

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-170
npx jest __tests__/task-state.complexity-trigger.test.ts
```
Expected: FAIL —— `sedimentForTask` 未被调用(接线尚未加)。

- [ ] **Step 3: 加 import**

在 `lib/services/task-state.service.ts` 顶部 import 区(`dispatchUpdateTaskSideEffects` 那行之后)加:

```ts
import { taskComplexityService } from '@/lib/services/task-complexity.service'
```

- [ ] **Step 4: 在 DONE 钩子内加触发**

在 `lib/services/task-state.service.ts` 现有 DONE 区块内(`if (result.changedFields.includes('status') && input.status === 'DONE') {` … `}` 之间,既有 layer2 `waitUntil(...)` 之后)加:

```ts
    // 复杂度沉淀:DONE 是执行数据的终态点,聚合本任务所有 AgentRun 的
    // 时长/变更文件信号写入 TaskComplexity,供 LUM-171 检索预测。
    // fire-and-forget;service 内部自捕获错误。
    waitUntil(
      taskComplexityService.sedimentForTask(
        taskId,
        result.task.teamId as string
      )
    )
```

- [ ] **Step 5: 跑测试确认通过**

Run:
```bash
npx jest __tests__/task-state.complexity-trigger.test.ts
```
Expected: PASS(2 个用例)。若遇上 Step 1 注里的 spy 失效,按回退方案调测试,实现不动。

- [ ] **Step 6: Commit**

```bash
git add lib/services/task-state.service.ts __tests__/task-state.complexity-trigger.test.ts
git commit -m "feat: trigger complexity sediment on task DONE [LUM-170]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 全量验证

**Files:** 无(只跑校验)

- [ ] **Step 1: 重生成 client(确保 schema 改动已反映)**

Run:
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-170
npx prisma generate
```
Expected: 成功。

- [ ] **Step 2: tsc 全量类型检查**

Run:
```bash
npx tsc --noEmit
```
Expected: 无错误。重点盯 `noUncheckedIndexedAccess`(本计划用 `for..of` 已规避裸索引)与 `exactOptionalPropertyTypes`。

- [ ] **Step 3: 跑本任务全部测试**

Run:
```bash
npx jest __tests__/complexity-bucket.test.ts __tests__/task-complexity.repository.test.ts __tests__/task-complexity.service.test.ts __tests__/task-state.complexity-trigger.test.ts
```
Expected: 4 个文件全 PASS。

- [ ] **Step 4: 确认无遗留 console.log(允许 console.error 的 fire-and-forget,与 layer2 同款)**

Run:
```bash
grep -rn "console.log" lib/complexity lib/repositories/task-complexity.repository.ts lib/services/task-complexity.service.ts || echo "no stray console.log"
```
Expected: `no stray console.log`。

- [ ] **Step 5: push + 开 PR**

```bash
git push -u origin lumo/LUM-170-complexity-labels
```
PR 标题:`feat: 事后复杂度标签从执行数据沉淀 [LUM-170]`
PR 描述须含:
- 概述:DONE 时沉淀 per-task 执行信号(总时长 + 去重变更文件数),读时相对分位分桶;无 UI/CLI(检索归 LUM-171)。
- ⚠️ **Migration**:新增 `task_complexities` 表,`requires \`prisma migrate deploy\` on next deploy`;合并后须确认生产已迁移(本仓库有 CI 跳过 migrate 的历史漂移坑)。
- 无新 npm 包。

---

## Self-Review(已对照 spec)

- **Spec 覆盖**:数据模型→T1;写路径聚合+资格→T4;触发点→T5;读路径/分桶(percentile+等权+小样本守卫)→T2;分层归属→T1-T5;测试矩阵→T2/T4 全覆盖 spec §5。`listByTeam`(cohort 读)在 T3 建好供 LUM-171 消费。
- **占位符**:无 TBD/TODO;每步含完整代码与可执行命令。
- **类型一致**:`ComplexitySignals`/`Bucket`/`BucketResult`(T2)、`TaskComplexityUpsert`(T3)、`sedimentForTask(taskId, teamId)`(T4/T5)签名跨任务一致。
- **缺口**:spec §3 提及 `findByTaskId`,T3 已含;分桶函数 cohort 含 target 的约定在 T2 注释与测试中体现。
