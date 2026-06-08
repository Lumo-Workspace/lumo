# 交付卡三态化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把交付卡从 `status==='DONE'` 二态扩成三态，新增「交付中」实时 burn 态（有过 Session 即进入，展示累计 actual 相对活预测区间的落点）。

**Architecture:** 瘦编排器 `DeliveryPanel` 接管 sidebar：`DONE → RetrospectivePanel`（不动）；否则一次 `useTaskProgress` 取数，`sessionCount===0 → ForecastView`（交付前），`≥1 → ProgressView`（交付中）。服务端 `progressService.getProgress` 复用 `loadActuals` + 活 `getTaskForecast`，逐指标 `progressMetric`（只判 over，不报 below）。零 schema 变更。

**Tech Stack:** Next.js App Router、TypeScript（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes）、TanStack Query、react-intl、Jest + jsdom + Testing Library。

**Spec:** `docs/superpowers/specs/2026-06-08-delivery-card-three-states-design.md`

**前置：** 已在分支 `lumo/LUM-323-delivery-card-three-states`。所有 commit 用 `type: description [LUM-323]` 格式，结尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。每个组件测试都 mock `react-intl`（项目惯例，react-intl 是纯 ESM，jest 不转译）。注意两个测试根 `__tests__/` 与 `tests/`——本计划新测试统一放 `__tests__/`（与现有 forecast/retrospective 测试同根）。

---

### Task 1: progress 类型 + `progressMetric` 纯函数

交付中单条指标的判定逻辑。与回顾的 `metric` 不同：飞行途中 actual 是部分值还在涨，偏低（`< p25`）是正常进度而非「低于预算」，故只判 `over`（`> p75`）；`deltaPct` 也仅在 over 时给出。

**Files:**

- Create: `lib/forecast/progress-types.ts`
- Create: `lib/forecast/progress-metric.ts`
- Test: `__tests__/lib/forecast/progress-metric.test.ts`

- [ ] **Step 1: 写类型文件**（无逻辑，先建好供后续 import）

Create `lib/forecast/progress-types.ts`:

```ts
import type { Interval, TaskForecast } from './types'

/**
 * 飞行途中 actual 相对预测的落点。仅两态：
 * - `over`：actual 已越 p75（还没交付就超预算）→ 预警
 * - `on-track`：区间内或下方（部分值正常累计，不报 below）
 */
export type ProgressBand = 'on-track' | 'over'

/** 单条交付中 burn 指标。forecast 或 actual 缺失 → 行降级（band/deltaPct=null）。 */
export interface ProgressMetric {
  forecast: Interval | null
  actual: number | null
  // 仅 over 时给出（actual 超中位多少 %）；on-track / 缺失 → null。
  deltaPct: number | null
  band: ProgressBand | null
}

/** 交付中态：活预测 + 到目前为止累计 actual 的 burn 对比。 */
export interface TaskProgress {
  sessionCount: number
  forecast: TaskForecast
  tokenCost: ProgressMetric
  iterations: ProgressMetric
  clarifyRounds: ProgressMetric
}
```

- [ ] **Step 2: 写失败测试**

Create `__tests__/lib/forecast/progress-metric.test.ts`:

```ts
import { progressMetric } from '@/lib/forecast/progress-metric'

const iv = (p25: number, median: number, p75: number) => ({ p25, median, p75 })

describe('progressMetric', () => {
  it('on-track when actual is within the band, no deltaPct', () => {
    const m = progressMetric(iv(12, 22, 35), 18)
    expect(m.band).toBe('on-track')
    expect(m.deltaPct).toBeNull()
  })

  it('on-track (NOT below) when actual is under p25 — partial mid-flight value', () => {
    const m = progressMetric(iv(12, 22, 35), 8)
    expect(m.band).toBe('on-track')
    expect(m.deltaPct).toBeNull()
  })

  it('on-track at the p75 boundary (strictly greater triggers over)', () => {
    expect(progressMetric(iv(12, 22, 35), 35).band).toBe('on-track')
  })

  it('over when actual exceeds p75, with deltaPct from median', () => {
    const m = progressMetric(iv(12, 22, 35), 52)
    expect(m.band).toBe('over')
    expect(m.deltaPct).toBe(136) // round((52-22)/22*100)
  })

  it('over with median 0 yields null deltaPct (no divide-by-zero)', () => {
    expect(progressMetric(iv(0, 0, 1), 5).deltaPct).toBeNull()
  })

  it('degrades when forecast is null', () => {
    expect(progressMetric(null, 10)).toEqual({
      forecast: null,
      actual: 10,
      deltaPct: null,
      band: null,
    })
  })

  it('degrades when actual is null', () => {
    const m = progressMetric(iv(1, 2, 3), null)
    expect(m.band).toBeNull()
    expect(m.actual).toBeNull()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx jest __tests__/lib/forecast/progress-metric.test.ts`
Expected: FAIL — `Cannot find module '@/lib/forecast/progress-metric'`

- [ ] **Step 4: 写实现**

Create `lib/forecast/progress-metric.ts`:

```ts
import type { Interval } from './types'
import type { ProgressBand, ProgressMetric } from './progress-types'

/**
 * 交付中单条指标。与回顾的 metric 不同：飞行途中 actual 是部分值、还在涨，
 * 偏低（< p25）是正常进度而非「低于预算」，故只判 over（> p75）。deltaPct 也
 * 仅在 over 时给出 —— on-track 的负偏差无意义，不暴露。
 */
export function progressMetric(
  forecast: Interval | null,
  actual: number | null
): ProgressMetric {
  if (forecast === null || actual === null) {
    return { forecast, actual, deltaPct: null, band: null }
  }
  const band: ProgressBand = actual > forecast.p75 ? 'over' : 'on-track'
  const deltaPct =
    band === 'over' && forecast.median !== 0
      ? Math.round(((actual - forecast.median) / forecast.median) * 100)
      : null
  return { forecast, actual, deltaPct, band }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx jest __tests__/lib/forecast/progress-metric.test.ts`
Expected: PASS (7 passing)

- [ ] **Step 6: Commit**

```bash
git add lib/forecast/progress-types.ts lib/forecast/progress-metric.ts __tests__/lib/forecast/progress-metric.test.ts
git commit -m "feat: add progressMetric + progress types for delivery-in-progress band [LUM-323]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `progressService.getProgress`

复用 `loadActuals`（拿 sessionCount + 累计 actual）+ `getTaskForecast`（活预测），组装 `TaskProgress`。不落任何快照（DONE 快照路径独立）。`sessionCount===0` 仍返回（编排器据此判交付前）。

**Files:**

- Create: `lib/services/progress.service.ts`
- Modify: `lib/services/index.ts:24` (add export)
- Test: `__tests__/services/progress.service.test.ts`

- [ ] **Step 1: 写失败测试**

Create `__tests__/services/progress.service.test.ts`:

```ts
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: { loadActuals: jest.fn() },
}))
jest.mock('@/lib/services/forecast.service', () => ({
  forecastService: { getTaskForecast: jest.fn() },
}))

import { progressService } from '@/lib/services/progress.service'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import { forecastService } from '@/lib/services/forecast.service'

const loadActuals = retrospectiveRepository.loadActuals as jest.Mock
const getForecast = forecastService.getTaskForecast as jest.Mock

const iv = (p25: number, median: number, p75: number) => ({ p25, median, p75 })

const baseForecast = {
  insufficientData: false,
  cohortSize: 5,
  iterations: iv(1, 2, 3),
  mergedPrs: null,
  cycleHours: null,
  tokenCost: iv(12e6, 22e6, 35e6),
  tokenCostBasis: 8,
  clarifyRounds: iv(0, 1, 1),
  confidence: 'medium' as const,
  sources: [],
}

beforeEach(() => {
  loadActuals.mockReset()
  getForecast.mockReset()
})

it('returns null when the task is not found', async () => {
  loadActuals.mockResolvedValue(null)
  expect(await progressService.getProgress('t1')).toBeNull()
  expect(getForecast).not.toHaveBeenCalled()
})

it('returns forecast + sessionCount even when no sessions yet (pre-delivery)', async () => {
  loadActuals.mockResolvedValue({
    projectId: 'p1',
    tokenCost: null,
    iterations: 0,
    clarifyRounds: 0,
  })
  getForecast.mockResolvedValue(baseForecast)
  const r = await progressService.getProgress('t1')
  expect(r?.sessionCount).toBe(0)
  expect(r?.forecast).toBe(baseForecast)
})

it('computes per-metric bands against live actuals (over on token)', async () => {
  loadActuals.mockResolvedValue({
    projectId: 'p1',
    tokenCost: 52e6, // > p75 (35M) → over
    iterations: 2, // within (1..3) → on-track
    clarifyRounds: 0,
  })
  getForecast.mockResolvedValue(baseForecast)
  const r = await progressService.getProgress('t1')
  expect(r?.sessionCount).toBe(2)
  expect(r?.tokenCost.band).toBe('over')
  expect(r?.iterations.band).toBe('on-track')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest __tests__/services/progress.service.test.ts`
Expected: FAIL — `Cannot find module '@/lib/services/progress.service'`

- [ ] **Step 3: 写实现**

Create `lib/services/progress.service.ts`:

```ts
import { forecastService } from '@/lib/services/forecast.service'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import { progressMetric } from '@/lib/forecast/progress-metric'
import type { TaskProgress } from '@/lib/forecast/progress-types'

export const progressService = {
  /**
   * 交付中态数据：活预测 + 到目前为止的累计 actual。task 不存在 → null。
   * 不落任何快照（DONE 快照路径 retrospectiveService.captureSnapshot 独立）。
   * sessionCount===0 时仍返回（编排器据此渲染交付前的纯预测视图）。
   */
  async getProgress(taskId: string): Promise<TaskProgress | null> {
    const actuals = await retrospectiveRepository.loadActuals(taskId)
    if (!actuals) return null

    const forecast = await forecastService.getTaskForecast(taskId)
    return {
      sessionCount: actuals.iterations,
      forecast,
      tokenCost: progressMetric(forecast.tokenCost, actuals.tokenCost),
      iterations: progressMetric(forecast.iterations, actuals.iterations),
      clarifyRounds: progressMetric(
        forecast.clarifyRounds,
        actuals.clarifyRounds
      ),
    }
  },
}
```

- [ ] **Step 4: 导出 service**

Modify `lib/services/index.ts` — after line 24 (`export { forecastService } from './forecast.service'`) add:

```ts
export { progressService } from './progress.service'
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx jest __tests__/services/progress.service.test.ts`
Expected: PASS (3 passing)

- [ ] **Step 6: Commit**

```bash
git add lib/services/progress.service.ts lib/services/index.ts __tests__/services/progress.service.test.ts
git commit -m "feat: add progressService.getProgress for delivery-in-progress state [LUM-323]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: API 布线（endpoint + queryKey + api-client + route + hook）

机械布线，照搬 retrospective 的形状。

**Files:**

- Modify: `app/workspace/[workspaceUrl]/constants.ts:14` (add endpoint)
- Modify: `lib/query/keys.ts:29` (add queryKey)
- Modify: `lib/api-client/tasks.ts:169` (add client method)
- Create: `app/api/tasks/[id]/progress/route.ts`
- Create: `app/workspace/[workspaceUrl]/hooks/useTaskProgress.ts`
- Test: `__tests__/services/progress-hook.test.ts`

- [ ] **Step 1: 加 endpoint**

Modify `app/workspace/[workspaceUrl]/constants.ts` — after line 14 (`retrospective: ...`) add inside the `tasks` object:

```ts
    progress: (taskId: string) => `/api/tasks/${taskId}/progress`,
```

- [ ] **Step 2: 加 queryKey**

Modify `lib/query/keys.ts` — after line 29 (`retrospective: ...`) add:

```ts
    progress: (id: string) => ['tasks', 'progress', id] as const,
```

- [ ] **Step 3: 加 api-client 方法**

Modify `lib/api-client/tasks.ts` — after the `retrospective<T>` block (line ~167-169) add:

```ts
  progress<T>(taskId: string) {
    return apiFetch<T>(API.tasks.progress(taskId))
  },
```

- [ ] **Step 4: 写 route**

Create `app/api/tasks/[id]/progress/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskService, progressService } from '@/lib/services'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/progress — 交付中态：活预测 + 累计 actual 的 burn 对比。
 * task 不存在 → 404；无 session（交付前）仍返回 { progress: { sessionCount: 0, ... } }。
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

    const progress = await progressService.getProgress(id)
    return NextResponse.json({ progress })
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 5: 写 hook**

Create `app/workspace/[workspaceUrl]/hooks/useTaskProgress.ts`:

```ts
'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { TaskProgress } from '@/lib/forecast/progress-types'

/** 拉取交付中态数据。taskId 为 null（交付后 / 未知）时禁用。 */
export function useTaskProgress(taskId: string | null) {
  const enabled = !!taskId
  const query = useQuery<{ progress: TaskProgress | null }>({
    queryKey: queryKeys.tasks.progress(taskId ?? ''),
    queryFn: () =>
      tasksClient.progress<{ progress: TaskProgress | null }>(taskId as string),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
  return {
    progress: query.data?.progress ?? undefined,
    isLoading: query.isPending && enabled,
    error: query.error ?? undefined,
  }
}
```

- [ ] **Step 6: 写 hook 失败测试**

Create `__tests__/services/progress-hook.test.ts`:

```ts
/** @jest-environment jsdom */

jest.mock('@/lib/api-client', () => ({
  tasksClient: { progress: jest.fn() },
}))

import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useTaskProgress } from '@/app/workspace/[workspaceUrl]/hooks/useTaskProgress'
import { tasksClient } from '@/lib/api-client'

const fetchProgress = tasksClient.progress as jest.Mock

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => fetchProgress.mockReset())

it('is disabled (no fetch) when taskId is null', () => {
  renderHook(() => useTaskProgress(null), { wrapper: wrapper() })
  expect(fetchProgress).not.toHaveBeenCalled()
})

it('fetches and returns progress when taskId is set', async () => {
  fetchProgress.mockResolvedValue({ progress: { sessionCount: 2 } })
  const { result } = renderHook(() => useTaskProgress('t1'), {
    wrapper: wrapper(),
  })
  await waitFor(() => expect(result.current.progress).toBeDefined())
  expect(result.current.progress?.sessionCount).toBe(2)
})
```

- [ ] **Step 7: 运行 hook 测试**

Run: `npx jest __tests__/services/progress-hook.test.ts`
Expected: PASS (2 passing)

- [ ] **Step 8: Commit**

```bash
git add app/workspace/[workspaceUrl]/constants.ts lib/query/keys.ts lib/api-client/tasks.ts app/api/tasks/[id]/progress/route.ts app/workspace/[workspaceUrl]/hooks/useTaskProgress.ts __tests__/services/progress-hook.test.ts
git commit -m "feat: wire GET /api/tasks/[id]/progress + useTaskProgress hook [LUM-323]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: i18n — 新增 `progress.*` keys（全 16 locale）

组件测试 mock react-intl，不依赖真 json；但真 app 必须有 keys。先加 en + zh-CN 真译，`i18n:sync` 占位其余 14，再逐个翻译（CLAUDE.md：禁止留 `[TODO:…]` 占位与英文 fallback）。

**Files:**

- Modify: `lib/i18n/en.json` (after line 1399, the last `retrospective.*` key)
- Modify: `lib/i18n/zh-CN.json`
- Modify: 其余 14 locale json（经 `i18n:sync` 生成占位后翻译）

- [ ] **Step 1: 加 en.json keys**

Modify `lib/i18n/en.json` — after `"retrospective.flywheel": ...` (line 1399), add:

```json
  "progress.title": "Delivery in progress",
  "progress.agentRunning": "Agent running",
  "progress.tokenUsage": "Token usage · live",
  "progress.predictedMedian": "Forecast median {value}",
  "progress.usedLabel": "used",
  "progress.over": "over budget",
  "progress.onTrackNote": "within range · still accumulating",
  "progress.sectionLabel": "Progress",
  "progress.iterations": "Runs",
  "progress.clarifyRounds": "Clarification rounds",
  "progress.predictedRange": "Forecast {value}",
  "progress.soFar": "so far {value}",
```

(确保前一行 `retrospective.flywheel` 末尾有逗号，且 JSON 合法。)

- [ ] **Step 2: 加 zh-CN.json keys**

Modify `lib/i18n/zh-CN.json` — 在 `"retrospective.*"` 区块末尾加：

```json
  "progress.title": "交付进行中",
  "progress.agentRunning": "Agent 运行中",
  "progress.tokenUsage": "token 用量 · 实时",
  "progress.predictedMedian": "预测中位 {value}",
  "progress.usedLabel": "已用",
  "progress.over": "已超预算",
  "progress.onTrackNote": "区间内 · 仍在累计",
  "progress.sectionLabel": "进度",
  "progress.iterations": "运行次数",
  "progress.clarifyRounds": "澄清轮次",
  "progress.predictedRange": "预测 {value}",
  "progress.soFar": "已 {value}",
```

- [ ] **Step 3: 同步其余 14 locale 占位**

Run: `npm run i18n:sync`
Expected: 14 个非 en/zh-CN 的 locale 文件被回填 `"progress.*": "[TODO:<locale>] …"` 占位。

- [ ] **Step 4: 翻译 14 个占位**（de, en-AU, en-GB, es-419, es, fr, hi, id, ja, ko, ms, ru, vi, zh-TW）

逐个打开每个 locale 文件，把 12 条 `progress.*` 的 `[TODO:…]` 占位替换成该语言的真译。**保留 ICU 占位 `{value}` 原样不译。** 英系变体（en-AU/en-GB）直接用 en 文案。zh-TW 用繁体：

```json
  "progress.title": "交付進行中",
  "progress.agentRunning": "Agent 執行中",
  "progress.tokenUsage": "token 用量 · 即時",
  "progress.predictedMedian": "預測中位 {value}",
  "progress.usedLabel": "已用",
  "progress.over": "已超預算",
  "progress.onTrackNote": "區間內 · 仍在累計",
  "progress.sectionLabel": "進度",
  "progress.iterations": "執行次數",
  "progress.clarifyRounds": "釐清輪次",
  "progress.predictedRange": "預測 {value}",
  "progress.soFar": "已 {value}",
```

其余 11 语言同理逐条翻译（保 `{value}`）。

- [ ] **Step 5: 校验 parity 无 drift 且无残留占位**

Run: `npm run i18n:check`
Expected: 通过（全 16 locale key 集匹配、非空）。

Run: `grep -rl "\[TODO:" lib/i18n/`
Expected: 无输出（所有占位已替换）。

- [ ] **Step 6: Commit**

```bash
git add lib/i18n/
git commit -m "i18n: add progress.* keys across all 16 locales [LUM-323]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 抽出共享 `RangeBand` 组件（加 tone 支持）

`RangeBand` 目前内嵌在 `RetrospectivePanel.tsx`。抽成共享组件供 ProgressView 复用，并加 `tone` prop（over 时圆点/箭头转 warning 色）。RetrospectivePanel 行为不变（默认 `tone='info'`）。

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/RangeBand.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/RetrospectivePanel.tsx` (删本地 RangeBand + 改 import)

- [ ] **Step 1: 建共享组件**

Create `app/workspace/[workspaceUrl]/components/RangeBand.tsx`:

```tsx
'use client'

import type { Interval } from '@/lib/forecast/types'
import { rangeBandGeometry } from '@/lib/forecast/range-band'

// 静态区间带：灰段 = p25–p75，竖线 = 中位，圆点 = actual。纯定位无交互。
// tone='warning' 时圆点/溢出箭头转警告色（交付中 over 用），默认 info（回顾用）。
export function RangeBand({
  forecast,
  actual,
  tone = 'info',
}: {
  forecast: Interval
  actual: number
  tone?: 'info' | 'warning'
}) {
  const g = rangeBandGeometry(forecast, actual)
  const dotTone = tone === 'warning' ? 'bg-warning' : 'bg-info'
  const caretTone = tone === 'warning' ? 'text-warning' : 'text-info'
  return (
    <div className='relative my-3 h-1.5 rounded-full bg-muted'>
      <div
        className='absolute inset-y-0 rounded-full bg-muted-foreground/25'
        style={{ left: `${g.iqrLeft}%`, right: `${g.iqrRight}%` }}
      />
      <div
        className='absolute -top-1 h-3.5 w-0.5 rounded-sm bg-muted-foreground/50'
        style={{ left: `${g.medianPos}%` }}
      />
      {g.overflow === 'right' && (
        <svg
          className={`absolute top-1/2 right-0 h-2 w-2 -translate-y-1/2 ${caretTone}`}
          viewBox='0 0 8 8'
          fill='currentColor'
          aria-hidden
        >
          <path d='M2 0l4 4-4 4z' />
        </svg>
      )}
      {g.overflow === 'left' && (
        <svg
          className={`absolute top-1/2 left-0 h-2 w-2 -translate-y-1/2 ${caretTone}`}
          viewBox='0 0 8 8'
          fill='currentColor'
          aria-hidden
        >
          <path d='M6 0L2 4l4 4z' />
        </svg>
      )}
      <div
        className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background ${dotTone}`}
        style={{ left: `${g.actualPos}%` }}
      />
    </div>
  )
}
```

- [ ] **Step 2: RetrospectivePanel 改用共享组件**

Modify `app/workspace/[workspaceUrl]/components/RetrospectivePanel.tsx`:

1. 删除本地 `RangeBand` 函数（当前第 40-89 行整段）。
2. 删除现已无用的 import：`rangeBandGeometry`（第 6 行）、`Interval`（第 5 行，若 RangeBand 删除后不再被引用——检查文件内其它用处；`range` 辅助函数用的是 `Interval` 类型，**仍需要**，故保留 `Interval` import，仅删 `rangeBandGeometry` import）。
3. 新增 import：`import { RangeBand } from './RangeBand'`。

调用点（原 `<RangeBand forecast={...} actual={...} />`）不传 tone，默认 info，行为不变。

- [ ] **Step 3: 跑回归测试确认 RetrospectivePanel 不变**

Run: `npx jest __tests__/components/RetrospectivePanel.test.tsx`
Expected: PASS（行为未变）

- [ ] **Step 4: tsc 确认无未用 import / 类型错误**

Run: `npx tsc --noEmit`
Expected: 0 error（特别确认 RetrospectivePanel 删 import 后无 `unused`/`cannot find` 报错）

- [ ] **Step 5: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/RangeBand.tsx app/workspace/[workspaceUrl]/components/RetrospectivePanel.tsx
git commit -m "refactor: extract shared RangeBand with tone prop from RetrospectivePanel [LUM-323]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `ForecastPanel` → `ForecastView`（presentational，forecast 走 prop）

去掉自带 `useTaskForecast`，forecast 改由编排器从 progress payload 传入。保留 insufficientData 降级 + 全部渲染逻辑。

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/ForecastView.tsx`
- Delete: `app/workspace/[workspaceUrl]/components/ForecastPanel.tsx`
- Create: `__tests__/components/ForecastView.test.tsx`
- Delete: `__tests__/components/ForecastPanel.test.tsx`

- [ ] **Step 1: 建 ForecastView**（移植 ForecastPanel 渲染体，去 fetch/status）

Create `app/workspace/[workspaceUrl]/components/ForecastView.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import type {
  Interval,
  ForecastConfidence,
  TaskForecast,
} from '@/lib/forecast/types'

function ForecastRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-baseline justify-between gap-2 py-1'>
      <span className='shrink-0 text-caption text-muted-foreground'>
        {label}
      </span>
      <span className='text-right text-body-strong text-foreground tabular-nums'>
        {value}
      </span>
    </div>
  )
}

const CONFIDENCE_KEY: Record<ForecastConfidence, string> = {
  low: 'forecast.confidenceLow',
  medium: 'forecast.confidenceMedium',
  high: 'forecast.confidenceHigh',
}

// Neutral evidence-strength badge — intentionally greyscale (no status color).
function ConfidenceBadge({ level }: { level: ForecastConfidence }) {
  const intl = useIntl()
  return (
    <span className='shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground'>
      {intl.formatMessage({ id: 'forecast.confidence' })}
      {' · '}
      {intl.formatMessage({ id: CONFIDENCE_KEY[level] })}
    </span>
  )
}

/** 交付前的纯预测视图。forecast 由编排器传入（不自取数）。 */
export function ForecastView({ forecast }: { forecast: TaskForecast }) {
  const intl = useIntl()
  const [showSources, setShowSources] = useState(false)
  const title = intl.formatMessage({ id: 'forecast.title' })

  if (forecast.insufficientData) {
    return (
      <section className='mt-6 pt-6 border-t border-border'>
        <p className='text-caption font-semibold text-muted-foreground uppercase tracking-wider mb-2'>
          {title}
        </p>
        <p className='text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'forecast.insufficient' })}
        </p>
      </section>
    )
  }

  const round = (n: number) => Math.round(n)
  const numRange = (iv: Interval) =>
    intl.formatMessage(
      { id: 'forecast.range' },
      { median: round(iv.median), low: round(iv.p25), high: round(iv.p75) }
    )
  const cycleText = (iv: Interval) => {
    const useHours = iv.median < 24
    const div = useHours ? 1 : 24
    return intl.formatMessage(
      { id: useHours ? 'forecast.cycleHours' : 'forecast.cycleDays' },
      {
        median: round(iv.median / div),
        low: round(iv.p25 / div),
        high: round(iv.p75 / div),
      }
    )
  }
  const compact = (n: number) =>
    intl.formatNumber(n, { notation: 'compact', maximumFractionDigits: 1 })
  const tokenRange = (iv: Interval) =>
    intl.formatMessage(
      { id: 'forecast.range' },
      {
        median: compact(iv.median),
        low: compact(iv.p25),
        high: compact(iv.p75),
      }
    )

  const hasCohortMetrics = !!forecast.iterations

  return (
    <section className='mt-6 pt-6 border-t border-border'>
      <div className='flex items-center justify-between gap-2 mb-1'>
        <p className='text-caption font-semibold text-muted-foreground uppercase tracking-wider'>
          {title}
        </p>
        <ConfidenceBadge level={forecast.confidence} />
      </div>
      {hasCohortMetrics && (
        <p className='text-caption text-muted-foreground mb-2'>
          {intl.formatMessage(
            { id: 'forecast.basis' },
            { count: forecast.cohortSize }
          )}
        </p>
      )}

      {forecast.iterations && (
        <ForecastRow
          label={intl.formatMessage({ id: 'forecast.metricIterations' })}
          value={numRange(forecast.iterations)}
        />
      )}
      {forecast.mergedPrs && (
        <ForecastRow
          label={intl.formatMessage({ id: 'forecast.metricPrs' })}
          value={numRange(forecast.mergedPrs)}
        />
      )}
      {forecast.cycleHours && (
        <ForecastRow
          label={intl.formatMessage({ id: 'forecast.metricCycle' })}
          value={cycleText(forecast.cycleHours)}
        />
      )}

      {forecast.tokenCost && (
        <>
          <ForecastRow
            label={intl.formatMessage({ id: 'forecast.metricTokens' })}
            value={tokenRange(forecast.tokenCost)}
          />
          <p className='text-caption text-muted-foreground mt-1'>
            {intl.formatMessage(
              { id: 'forecast.tokenBasis' },
              { count: forecast.tokenCostBasis }
            )}
          </p>
        </>
      )}

      {forecast.sources.length > 0 && (
        <>
          <button
            type='button'
            onClick={() => setShowSources(v => !v)}
            className='mt-2 text-caption text-muted-foreground hover:text-foreground transition-colors'
          >
            {intl.formatMessage({ id: 'forecast.viewSources' })}
          </button>
          {showSources && (
            <ul className='mt-2 space-y-1'>
              {forecast.sources.map(s => (
                <li
                  key={s.taskId}
                  className='text-caption text-muted-foreground'
                >
                  {s.identifier} · {s.title}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 2: 删旧 ForecastPanel**

```bash
git rm app/workspace/[workspaceUrl]/components/ForecastPanel.tsx
```

- [ ] **Step 3: 写 ForecastView 测试（替换旧 Panel 测试）**

Create `__tests__/components/ForecastView.test.tsx`:

```tsx
/** @jest-environment jsdom */

const en: Record<string, string> = {
  'forecast.title': 'Delivery forecast',
  'forecast.basis': 'Based on {count} similar tasks',
  'forecast.metricIterations': 'Iterations',
  'forecast.metricTokens': 'Token cost',
  'forecast.tokenBasis': 'Based on {count} tasks with cost data',
  'forecast.range': '{median} ({low}–{high})',
  'forecast.cycleDays': '{median}d ({low}–{high}d)',
  'forecast.cycleHours': '{median}h ({low}–{high}h)',
  'forecast.insufficient': 'Not enough history for a reliable forecast',
  'forecast.confidence': 'Confidence',
  'forecast.confidenceMedium': 'Medium',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => {
      const tpl = en[id] ?? id
      if (!values) return tpl
      return tpl.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ''))
    },
    formatNumber: (n: number, opts?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en', opts).format(n),
  }),
}))

import { render, screen } from '@testing-library/react'
import { ForecastView } from '@/app/workspace/[workspaceUrl]/components/ForecastView'
import type { TaskForecast } from '@/lib/forecast/types'

const iv = (p25: number, median: number, p75: number) => ({ p25, median, p75 })

const base: TaskForecast = {
  insufficientData: false,
  cohortSize: 5,
  iterations: iv(1, 2, 3),
  mergedPrs: null,
  cycleHours: null,
  tokenCost: iv(12e6, 22e6, 35e6),
  tokenCostBasis: 8,
  clarifyRounds: iv(0, 1, 1),
  confidence: 'medium',
  sources: [],
}

it('renders the insufficient message when insufficientData', () => {
  render(<ForecastView forecast={{ ...base, insufficientData: true }} />)
  expect(screen.getByText(en['forecast.insufficient']!)).toBeInTheDocument()
})

it('renders iterations + token rows from the forecast prop', () => {
  render(<ForecastView forecast={base} />)
  expect(screen.getByText(en['forecast.title']!)).toBeInTheDocument()
  expect(screen.getByText('Iterations')).toBeInTheDocument()
  expect(screen.getByText('Token cost')).toBeInTheDocument()
})
```

- [ ] **Step 4: 删旧 Panel 测试**

```bash
git rm __tests__/components/ForecastPanel.test.tsx
```

- [ ] **Step 5: 跑 ForecastView 测试**

Run: `npx jest __tests__/components/ForecastView.test.tsx`
Expected: PASS (2 passing)

- [ ] **Step 6: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/ForecastView.tsx __tests__/components/ForecastView.test.tsx
git commit -m "refactor: ForecastPanel -> presentational ForecastView (forecast via prop) [LUM-323]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `ProgressView`（交付中 burn 视图）

活预测带 + 累计 actual。on-track 无 pill、只一行 note；over 出 warning pill + warning 圆点 + actual 标红。WORKING 时卡头脉冲。

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/ProgressView.tsx`
- Test: `__tests__/components/ProgressView.test.tsx`

- [ ] **Step 1: 写失败测试**

Create `__tests__/components/ProgressView.test.tsx`:

```tsx
/** @jest-environment jsdom */

const en: Record<string, string> = {
  'progress.title': 'Delivery in progress',
  'progress.agentRunning': 'Agent running',
  'progress.tokenUsage': 'Token usage · live',
  'progress.predictedMedian': 'Forecast median {value}',
  'progress.usedLabel': 'used',
  'progress.over': 'over budget',
  'progress.onTrackNote': 'within range · still accumulating',
  'progress.sectionLabel': 'Progress',
  'progress.iterations': 'Runs',
  'progress.clarifyRounds': 'Clarification rounds',
  'progress.predictedRange': 'Forecast {value}',
  'progress.soFar': 'so far {value}',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => {
      const tpl = en[id] ?? id
      if (!values) return tpl
      return tpl.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ''))
    },
    formatNumber: (n: number, opts?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en', opts).format(n),
  }),
}))

import { render, screen } from '@testing-library/react'
import { ProgressView } from '@/app/workspace/[workspaceUrl]/components/ProgressView'
import type { TaskProgress } from '@/lib/forecast/progress-types'

const iv = (p25: number, median: number, p75: number) => ({ p25, median, p75 })

const onTrack: TaskProgress = {
  sessionCount: 2,
  forecast: {} as TaskProgress['forecast'],
  tokenCost: {
    forecast: iv(12e6, 22e6, 35e6),
    actual: 18e6,
    deltaPct: null,
    band: 'on-track',
  },
  iterations: {
    forecast: iv(1, 2, 3),
    actual: 2,
    deltaPct: null,
    band: 'on-track',
  },
  clarifyRounds: {
    forecast: iv(0, 1, 1),
    actual: 0,
    deltaPct: null,
    band: 'on-track',
  },
}

const over: TaskProgress = {
  ...onTrack,
  tokenCost: {
    forecast: iv(12e6, 22e6, 35e6),
    actual: 52e6,
    deltaPct: 136,
    band: 'over',
  },
}

it('shows the on-track note and NO variance pill when within range', () => {
  render(<ProgressView progress={onTrack} agentStatus='WORKING' />)
  expect(screen.getByText(en['progress.onTrackNote']!)).toBeInTheDocument()
  expect(screen.queryByText(/over budget/)).not.toBeInTheDocument()
})

it('shows the over pill with deltaPct when token actual exceeds p75', () => {
  render(<ProgressView progress={over} agentStatus='WORKING' />)
  expect(screen.getByText(/over budget/)).toBeInTheDocument()
  expect(screen.getByText(/\+136%/)).toBeInTheDocument()
})

it('shows the running pulse only when agentStatus is WORKING', () => {
  const { rerender } = render(
    <ProgressView progress={onTrack} agentStatus='WORKING' />
  )
  expect(screen.getByText(en['progress.agentRunning']!)).toBeInTheDocument()
  rerender(<ProgressView progress={onTrack} agentStatus={null} />)
  expect(
    screen.queryByText(en['progress.agentRunning']!)
  ).not.toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest __tests__/components/ProgressView.test.tsx`
Expected: FAIL — `Cannot find module '.../ProgressView'`

- [ ] **Step 3: 写实现**

Create `app/workspace/[workspaceUrl]/components/ProgressView.tsx`:

```tsx
'use client'

import { useIntl } from 'react-intl'
import type {
  ProgressMetric,
  TaskProgress,
} from '@/lib/forecast/progress-types'
import { RangeBand } from './RangeBand'

function compact(intl: ReturnType<typeof useIntl>, n: number) {
  return intl.formatNumber(n, { notation: 'compact', maximumFractionDigits: 1 })
}

// over 预警 pill（warning token）。on-track 不渲染 —— 飞行途中偏低是正常进度。
function OverPill({ metric }: { metric: ProgressMetric }) {
  const intl = useIntl()
  if (metric.band !== 'over' || metric.deltaPct === null) return null
  const sign = metric.deltaPct > 0 ? '+' : ''
  return (
    <span className='inline-flex items-center gap-1.5 rounded-full bg-warning-subtle px-2.5 py-0.5 text-caption font-medium text-warning'>
      {sign}
      {metric.deltaPct}% · {intl.formatMessage({ id: 'progress.over' })}
    </span>
  )
}

// 进度行：预测区间 · 已 N。over 时 actual 标 warning 色。forecast 缺失 → 仅 actual。
function ProgressCompareRow({
  label,
  metric,
}: {
  label: string
  metric: ProgressMetric
}) {
  const intl = useIntl()
  const over = metric.band === 'over'
  const rangeText = metric.forecast
    ? intl.formatMessage(
        { id: 'progress.predictedRange' },
        {
          value: `${Math.round(metric.forecast.p25)}–${Math.round(metric.forecast.p75)}`,
        }
      )
    : null
  return (
    <div className='flex items-baseline justify-between gap-2 py-1'>
      <span className='text-caption text-foreground'>{label}</span>
      <span className='text-right text-caption text-muted-foreground tabular-nums'>
        {rangeText && (
          <>
            {rangeText}
            <span className='mx-1.5 text-muted-foreground/60'>·</span>
          </>
        )}
        <span
          className={`font-semibold ${over ? 'text-warning' : 'text-foreground'}`}
        >
          {intl.formatMessage(
            { id: 'progress.soFar' },
            { value: metric.actual ?? '—' }
          )}
        </span>
      </span>
    </div>
  )
}

/** 交付中态：活预测 + 累计 actual 的实时 burn 对比。 */
export function ProgressView({
  progress,
  agentStatus,
}: {
  progress: TaskProgress
  agentStatus?: string | null
}) {
  const intl = useIntl()
  const { tokenCost, iterations, clarifyRounds } = progress
  const running = agentStatus === 'WORKING'
  const showToken = !!tokenCost.forecast && tokenCost.actual !== null
  const tokenOver = tokenCost.band === 'over'

  return (
    <section className='mt-6 border-t border-border pt-6'>
      <div className='mb-3 flex items-center justify-between gap-2'>
        <p className='text-caption font-semibold uppercase tracking-wider text-muted-foreground'>
          {intl.formatMessage({ id: 'progress.title' })}
        </p>
        {running && (
          <span className='inline-flex shrink-0 items-center gap-1.5 rounded-full bg-info-subtle px-2.5 py-0.5 text-caption font-medium text-info'>
            <span className='size-1.5 rounded-full bg-info' aria-hidden />
            {intl.formatMessage({ id: 'progress.agentRunning' })}
          </span>
        )}
      </div>

      {showToken && tokenCost.forecast && (
        <div className='mb-4'>
          <p className='mb-2 text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'progress.tokenUsage' })}
          </p>
          <div className='flex items-baseline justify-between gap-3'>
            <span className='text-caption text-muted-foreground'>
              {intl.formatMessage(
                { id: 'progress.predictedMedian' },
                { value: compact(intl, tokenCost.forecast.median) }
              )}
            </span>
            <span className='text-right'>
              <span className='mr-1.5 text-caption text-muted-foreground'>
                {intl.formatMessage({ id: 'progress.usedLabel' })}
              </span>
              <span
                className={`text-title-strong tabular-nums ${tokenOver ? 'text-warning' : 'text-foreground'}`}
              >
                {compact(intl, tokenCost.actual as number)}
              </span>
            </span>
          </div>
          <OverPill metric={tokenCost} />
          <RangeBand
            forecast={tokenCost.forecast}
            actual={tokenCost.actual as number}
            tone={tokenOver ? 'warning' : 'info'}
          />
          {!tokenOver && (
            <p className='text-caption text-muted-foreground'>
              {intl.formatMessage({ id: 'progress.onTrackNote' })}
            </p>
          )}
        </div>
      )}

      <div className='border-t border-border pt-3'>
        <p className='mb-1 text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'progress.sectionLabel' })}
        </p>
        <ProgressCompareRow
          label={intl.formatMessage({ id: 'progress.iterations' })}
          metric={iterations}
        />
        <ProgressCompareRow
          label={intl.formatMessage({ id: 'progress.clarifyRounds' })}
          metric={clarifyRounds}
        />
      </div>
    </section>
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest __tests__/components/ProgressView.test.tsx`
Expected: PASS (3 passing)

- [ ] **Step 5: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/ProgressView.tsx __tests__/components/ProgressView.test.tsx
git commit -m "feat: add ProgressView burn card for delivery-in-progress state [LUM-323]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: `DeliveryPanel` 编排器 + 接入 sidebar

编排器接管三态路由，替换 sidebar 里 ForecastPanel/RetrospectivePanel 两个直接渲染。

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/DeliveryPanel.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx:216-217`
- Test: `__tests__/components/DeliveryPanel.test.tsx`

- [ ] **Step 1: 写失败测试（路由）**

Create `__tests__/components/DeliveryPanel.test.tsx`:

```tsx
/** @jest-environment jsdom */

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/RetrospectivePanel',
  () => ({
    RetrospectivePanel: () => <div>RETRO</div>,
  })
)
jest.mock('@/app/workspace/[workspaceUrl]/components/ForecastView', () => ({
  ForecastView: () => <div>FORECAST</div>,
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/ProgressView', () => ({
  ProgressView: () => <div>PROGRESS</div>,
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskProgress', () => ({
  useTaskProgress: jest.fn(),
}))

import { render, screen } from '@testing-library/react'
import { DeliveryPanel } from '@/app/workspace/[workspaceUrl]/components/DeliveryPanel'
import { useTaskProgress } from '@/app/workspace/[workspaceUrl]/hooks/useTaskProgress'

const useProgress = useTaskProgress as jest.Mock

beforeEach(() => useProgress.mockReset())

it('renders the retrospective when status is DONE (and disables progress fetch)', () => {
  useProgress.mockReturnValue({ progress: undefined, isLoading: false })
  render(<DeliveryPanel taskId='t1' status='DONE' />)
  expect(screen.getByText('RETRO')).toBeInTheDocument()
  expect(useProgress).toHaveBeenCalledWith(null)
})

it('renders the forecast view when no sessions yet', () => {
  useProgress.mockReturnValue({
    progress: { sessionCount: 0, forecast: {} },
    isLoading: false,
  })
  render(<DeliveryPanel taskId='t1' status='IN_PROGRESS' />)
  expect(screen.getByText('FORECAST')).toBeInTheDocument()
})

it('renders the progress view once a session exists', () => {
  useProgress.mockReturnValue({
    progress: { sessionCount: 2, forecast: {} },
    isLoading: false,
  })
  render(<DeliveryPanel taskId='t1' status='IN_PROGRESS' />)
  expect(screen.getByText('PROGRESS')).toBeInTheDocument()
})

it('renders nothing while loading', () => {
  useProgress.mockReturnValue({ progress: undefined, isLoading: true })
  const { container } = render(
    <DeliveryPanel taskId='t1' status='IN_PROGRESS' />
  )
  expect(container).toBeEmptyDOMElement()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest __tests__/components/DeliveryPanel.test.tsx`
Expected: FAIL — `Cannot find module '.../DeliveryPanel'`

- [ ] **Step 3: 写实现**

Create `app/workspace/[workspaceUrl]/components/DeliveryPanel.tsx`:

```tsx
'use client'

import { useTaskProgress } from '../hooks/useTaskProgress'
import { ForecastView } from './ForecastView'
import { ProgressView } from './ProgressView'
import { RetrospectivePanel } from './RetrospectivePanel'
import type { ApiStatus } from '../types'

/**
 * 交付卡三态编排器。
 * - 交付后（DONE）→ RetrospectivePanel（自取数，progress 取数禁用）
 * - 否则一次 useTaskProgress：sessionCount===0 → ForecastView（交付前）
 *   ；≥1 → ProgressView（交付中）
 * loading/error/无数据 → 不渲染（保持 sidebar 安静）。
 */
export function DeliveryPanel({
  taskId,
  status,
  agentStatus,
}: {
  taskId: string
  status: ApiStatus
  agentStatus?: string | null
}) {
  const isTerminal = status === 'DONE'
  const { progress, isLoading, error } = useTaskProgress(
    isTerminal ? null : taskId
  )

  if (isTerminal) return <RetrospectivePanel taskId={taskId} status={status} />
  if (isLoading || error || !progress) return null
  if (progress.sessionCount === 0)
    return <ForecastView forecast={progress.forecast} />
  return <ProgressView progress={progress} agentStatus={agentStatus} />
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest __tests__/components/DeliveryPanel.test.tsx`
Expected: PASS (4 passing)

- [ ] **Step 5: 接入 sidebar**

Modify `app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx`:

1. 删除 import：`ForecastPanel`、`RetrospectivePanel`（找到这两行 import 删掉）。
2. 新增 import：`import { DeliveryPanel } from './DeliveryPanel'`。
3. 替换第 216-217 行的两行渲染为：

```tsx
<DeliveryPanel
  taskId={task.id}
  status={task.status}
  agentStatus={task.agentStatus}
/>
```

- [ ] **Step 6: tsc 确认 sidebar 接线类型正确**

Run: `npx tsc --noEmit`
Expected: 0 error（确认 `task.agentStatus` 是 `string | null | undefined` 与 DeliveryPanel 的 `agentStatus?: string | null` 兼容；确认无遗留的 ForecastPanel import）

- [ ] **Step 7: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/DeliveryPanel.tsx __tests__/components/DeliveryPanel.test.tsx app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx
git commit -m "feat: DeliveryPanel orchestrator wires three-state delivery card into sidebar [LUM-323]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: 全量验证关口

**Files:** 无（仅运行验证）

- [ ] **Step 1: TypeScript**

Run: `npx tsc --noEmit`
Expected: 0 error

- [ ] **Step 2: 全量测试（两个测试根）**

Run: `npx jest`
Expected: 全绿，含本次新增的 progress-metric / progress.service / progress-hook / ForecastView / ProgressView / DeliveryPanel 测试，及未改动的 RetrospectivePanel 回归。

- [ ] **Step 3: token lint**

Run: `npm run lint:tokens`
Expected: 通过（ProgressView/RangeBand 仅用语义 token：`bg-warning`/`text-warning`/`bg-info`/`bg-warning-subtle`/`bg-info-subtle` 等，无裸 hex）

- [ ] **Step 4: i18n parity**

Run: `npm run i18n:check`
Expected: 无 drift。再跑 `grep -rl "\[TODO:" lib/i18n/` 确认无残留占位。

- [ ] **Step 5: build（唯一 CI gate 是 Vercel build）**

Run: `npm run build`
Expected: 成功

- [ ] **Step 6: 开 PR**

```bash
git push -u origin lumo/LUM-323-delivery-card-three-states
gh pr create --title "feat: delivery card three states — add 交付中 live-burn state [LUM-323]" --body "$(cat <<'EOF'
## What
交付卡从 status===DONE 二态扩成三态，新增「交付中」实时 burn 态。

- 交付前（0 session）→ ForecastView（纯预测）
- 交付中（≥1 session，未 DONE）→ ProgressView：活预测带 + 累计 actual，on-track 不报偏差 / over 越 p75 才警告，WORKING 时脉冲
- 交付后（DONE）→ RetrospectivePanel（不动）

瘦编排器 DeliveryPanel 一次 useTaskProgress 取数；态边界用 Session 存在（非 status、非此刻 agent 在跑）。

## Notes
- 零 schema 变更（复用 loadActuals / rangeBandGeometry）
- 新增全 16 locale 的 progress.* keys
- Spec: docs/superpowers/specs/2026-06-08-delivery-card-three-states-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage** — 逐节核对：

- 三态模型 → Task 7（ProgressView）+ Task 8（DeliveryPanel 路由）✅
- 边界 = sessionCount≥1 → Task 2（service 返 sessionCount）+ Task 8（路由判 0/≥1）✅
- 交付中用活预测（不冻结）→ Task 2（getProgress 调活 getTaskForecast，不落快照）✅
- band 语义 on-track/over，不报 below → Task 1（progressMetric）+ 测试覆盖 below→on-track ✅
- on-track 无 pill / over warning pill + warning 圆点 → Task 5（RangeBand tone）+ Task 7（OverPill/onTrackNote）✅
- WORKING 脉冲 → Task 7 + 测试 ✅
- 架构 A 瘦编排器、ForecastPanel→ForecastView → Task 6 + Task 8 ✅
- 零 schema、复用 loadActuals/rangeBandGeometry → Task 2 / Task 5 ✅
- i18n 全 16 locale → Task 4 ✅
- 测试两个根 → 新测试在 **tests**/，全量 `npx jest` 跑两根 → Task 9 ✅
- 验证关口（tsc/test/lint:tokens/i18n:check/build）→ Task 9 ✅

**Placeholder scan** — 无 TBD/TODO 式占位；唯一「翻译填充」是 Task 4 的 14 locale，已给 en+zh-CN+zh-TW 全文与明确逐条翻译指令（i18n 本质是填充步骤，非代码占位）。

**Type consistency** — `TaskProgress`（flat：sessionCount/forecast/tokenCost/iterations/clarifyRounds）在 Task 1 定义，Task 2 service 返回、Task 7 ProgressView 消费、Task 8 DeliveryPanel 路由读 `progress.sessionCount`/`progress.forecast` 一致；`ProgressMetric`/`ProgressBand` 全程一致；`progressMetric` 签名 `(Interval|null, number|null)` 在 service 三处调用匹配；`RangeBand` 的 `tone?: 'info'|'warning'` 在 Task 5 定义、Task 7 调用一致。
