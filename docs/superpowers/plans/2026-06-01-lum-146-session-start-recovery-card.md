# session-start "续上次进度"恢复卡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Claude Code 新 session 绑定到任务时,自动注入一张"续上次进度"恢复卡(上一段有 summary 的同任务 session 的 headline + unresolved + 时长),覆盖 resume 与 git-自动绑定两条路径。

**Architecture:** 服务端新增一个 service 方法返回结构化的 `previousSession` 数据(复用现成的 `summaryHeadline`/`summaryUnresolved` + `sessionRepository.listForTask`),分别接进 session-start 路由(resume 路径)和 `bindSessionToTask`(auto-bind 路径)的响应。CLI 端把 `formatDuration`/`relativeTime` 抽到共享 `format.ts`,新增 `renderRecoveryCard` 渲染成 markdown(走 `sanitizeField`),插到 SessionStart `additionalContext` 最前。

**Tech Stack:** TypeScript (strict), Next.js App Router API routes, Prisma, Jest (node env), CLI under `cli/src/`。

**Spec:** `docs/superpowers/specs/2026-06-01-lum-146-session-start-recovery-card-design.md`

---

## 并行冲突预警(LUM-147)

`.worktrees/LUM-147-session-start-linked-resources/` 正在并行开发,**也动 session-start 链路**(`hook-runner.ts`、`session-start/route.ts`、`formatHookStdoutLines` 的 envelope、`SessionStartBody` 类型)。本任务往同样的文件加**新字段/新分支**,不改既有字段。执行时若收到 parallel-edit collision 警告(LUM-150),核对一下两边对 `sessionContextEnvelope` 参数数组的改动是否冲突,合并时保留双方新增的 part。

## 文件结构

| 文件                                   | 动作   | 职责                                                                             |
| -------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| `lib/services/task-context.service.ts` | Modify | 新增 `buildPreviousSessionRecoveryForTask` + 导出 `PreviousSessionRecovery` 类型 |
| `app/api/hooks/session-start/route.ts` | Modify | afterRecord 加进 Promise.all,响应返回 `previousSession`(resume 路径①)            |
| `lib/services/session.service.ts`      | Modify | `bindSessionToTask` 返回 `previousSession`(auto-bind 路径②)+ result 类型加字段   |
| `cli/src/lib/format.ts`                | Create | 从 task-context.ts 抽出的 `formatDuration` / `relativeTime`                      |
| `cli/src/commands/task-context.ts`     | Modify | 删本地两函数,改 import `../lib/format`                                           |
| `cli/src/lib/hook-runner.ts`           | Modify | `renderRecoveryCard` + 两条路径注入 + 类型加 `previousSession` + `now` 参数      |
| `cli/package.json`                     | Modify | minor 版本 bump(user-facing CLI 行为变更)                                        |

**测试文件**
| 文件 | 动作 |
| ---- | ---- |
| `__tests__/lib/services/task-context-previous-session.test.ts` | Create |
| `__tests__/lib/services/session-service-bind.test.ts` | Modify(加 previousSession 透传断言) |
| `__tests__/cli/format.test.ts` | Create(抽取后的纯函数) |
| `__tests__/cli/hook-runner-recovery-card.test.ts` | Create(formatHookStdoutLines + 渲染) |
| `__tests__/cli/session-start-auto-bind.test.ts` | Modify(auto-bind 路径注入卡) |

**SKILL.md 同步**:本任务**不需要**改 `.claude/skills/lumo/SKILL.md`——`cli/src/commands/task-context.ts` 只是把两个私有函数移走(纯重构,不改 flag/输出格式/触发条件),`hook-runner.ts` 是内部 hook stdout 行为。按 CLAUDE.md「纯内部重构、不影响调用方式」属例外。

---

## Task 1: 服务端 — `buildPreviousSessionRecoveryForTask`

**Files:**

- Modify: `lib/services/task-context.service.ts`
- Test: `__tests__/lib/services/task-context-previous-session.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `__tests__/lib/services/task-context-previous-session.test.ts`。mock 头部照搬 `__tests__/lib/services/task-context-build-memory.test.ts` 的 repo mock(task-context.service 会传递性 import 一堆集成,必须 stub 才能加载),只需在其基础上确保 `session.repository` mock 暴露 `listForTask`:

```ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findById: jest.fn(), findByWorkspaceIdentifier: jest.fn() },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn(),
    findActiveProjectMemories: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { listForTask: jest.fn() },
}))
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {},
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {},
}))
jest.mock('@/lib/repositories/tag.repository', () => ({ tagRepository: {} }))
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {},
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {},
}))
jest.mock('@/lib/services/task-pr-sync.service', () => ({
  syncPullRequestStatus: jest.fn(),
}))
jest.mock('@/lib/services/task-notifications.service', () => ({
  dispatchCreateTaskSideEffects: jest.fn(),
  dispatchUpdateTaskSideEffects: jest.fn(),
}))

import { taskContextService } from '@/lib/services/task-context.service'
import { sessionRepository } from '@/lib/repositories/session.repository'

const mockListForTask = sessionRepository.listForTask as jest.Mock

// Helper: a session row as listForTask returns it (Date objects, raw summary JSON).
function row(
  over: Partial<{
    id: string
    startedAt: Date
    lastActivityAt: Date
    summary: unknown
  }>
) {
  return {
    id: over.id ?? 's-x',
    startedAt: over.startedAt ?? new Date('2026-06-01T10:00:00Z'),
    lastActivityAt: over.lastActivityAt ?? new Date('2026-06-01T10:23:00Z'),
    eventCount: 1,
    summary: over.summary ?? null,
    summaryType: 'implementation',
    summaryGeneratedAt: new Date('2026-06-01T10:23:00Z'),
  }
}

describe('buildPreviousSessionRecoveryForTask', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns null when the task has no sessions', async () => {
    mockListForTask.mockResolvedValue([])
    const out = await taskContextService.buildPreviousSessionRecoveryForTask(
      't1',
      'cur'
    )
    expect(out).toBeNull()
  })

  it('returns null when no session has a summary', async () => {
    mockListForTask.mockResolvedValue([
      row({ id: 'a', summary: null }),
      row({ id: 'b', summary: {} }),
    ])
    const out = await taskContextService.buildPreviousSessionRecoveryForTask(
      't1',
      'cur'
    )
    expect(out).toBeNull()
  })

  it('excludes the current session and picks the next one with a summary', async () => {
    mockListForTask.mockResolvedValue([
      row({
        id: 'cur',
        summary: { goal: 'should be skipped', unresolved: ['x'] },
      }),
      row({
        id: 'prev',
        summary: { goal: 'real headline', unresolved: ['finish API'] },
      }),
    ])
    const out = await taskContextService.buildPreviousSessionRecoveryForTask(
      't1',
      'cur'
    )
    expect(out).toEqual({
      headline: 'real headline',
      unresolved: ['finish API'],
      durationMs: 23 * 60_000,
      lastActivityAt: '2026-06-01T10:23:00.000Z',
    })
  })

  it('walks back past a summary-less recent session to an older one with a summary', async () => {
    mockListForTask.mockResolvedValue([
      row({ id: 'recent', summary: null }),
      row({ id: 'older', summary: { goal: 'older headline', unresolved: [] } }),
    ])
    const out = await taskContextService.buildPreviousSessionRecoveryForTask(
      't1',
      'cur'
    )
    expect(out?.headline).toBe('older headline')
    expect(out?.unresolved).toEqual([])
  })

  it('computes durationMs as lastActivityAt - startedAt (floored at 0)', async () => {
    mockListForTask.mockResolvedValue([
      row({
        id: 'prev',
        startedAt: new Date('2026-06-01T09:00:00Z'),
        lastActivityAt: new Date('2026-06-01T09:05:00Z'),
        summary: { goal: 'g', unresolved: [] },
      }),
    ])
    const out = await taskContextService.buildPreviousSessionRecoveryForTask(
      't1',
      'cur'
    )
    expect(out?.durationMs).toBe(5 * 60_000)
  })
})
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `npx jest __tests__/lib/services/task-context-previous-session.test.ts`
Expected: FAIL — `taskContextService.buildPreviousSessionRecoveryForTask is not a function`

- [ ] **Step 3: 实现方法**

在 `lib/services/task-context.service.ts`,在 `export interface SessionContext { ... }` 之后加导出类型:

```ts
export interface PreviousSessionRecovery {
  headline: string
  unresolved: string[]
  durationMs: number
  lastActivityAt: string
}
```

在 `taskContextService` 对象里(放在 `buildReviewTodosSectionForTask` 之后)新增方法:

```ts
  /**
   * Build the "续上次进度" recovery payload for a task: the most recent prior
   * session (newest-first) that actually produced a summary, reduced to
   * headline + unresolved + duration. Walks back past summary-less sessions
   * (still generating / too short) and excludes `currentSessionId` so the
   * brand-new session doesn't echo itself. Returns null when no prior session
   * with a summary exists. Keyed on taskId, so it spans branches (squash-merge
   * continuation). Rendered CLI-side; this returns structured data only.
   */
  async buildPreviousSessionRecoveryForTask(
    taskId: string,
    currentSessionId: string
  ): Promise<PreviousSessionRecovery | null> {
    const sessions = await sessionRepository.listForTask(taskId, 5)
    for (const s of sessions) {
      if (s.id === currentSessionId) continue
      const headline = summaryHeadline(s.summary)
      if (headline === '(no summary)') continue
      return {
        headline,
        unresolved: summaryUnresolved(s.summary),
        durationMs: Math.max(
          0,
          s.lastActivityAt.getTime() - s.startedAt.getTime()
        ),
        lastActivityAt: s.lastActivityAt.toISOString(),
      }
    }
    return null
  },
```

(`summaryHeadline` / `summaryUnresolved` are already module-private functions in this file — reuse them directly. `'(no summary)'` is exactly what `summaryHeadline` returns for an absent/empty summary, so it doubles as the "has a real summary" filter.)

- [ ] **Step 4: 跑测试,确认通过**

Run: `npx jest __tests__/lib/services/task-context-previous-session.test.ts`
Expected: PASS (5 passed)

- [ ] **Step 5: 提交**

```bash
git add lib/services/task-context.service.ts __tests__/lib/services/task-context-previous-session.test.ts
git commit -m "feat: buildPreviousSessionRecoveryForTask service method [LUM-146]"
```

---

## Task 2: 服务端 — session-start 路由返回 `previousSession`(路径①)

**Files:**

- Modify: `app/api/hooks/session-start/route.ts`

(纯 glue:afterRecord 把新方法加进 Promise.all。逻辑已在 Task 1 测过;此路由当前无单测,行为由 Task 5 的 CLI 测试端到端覆盖。)

- [ ] **Step 1: 改 afterRecord**

把 `app/api/hooks/session-start/route.ts` 整体替换为:

```ts
import { handleHookRequest } from '@/app/api/hooks/_handler'
import { sessionRepository } from '@/lib/repositories/session.repository'
import {
  taskContextService,
  type PreviousSessionRecovery,
} from '@/lib/services/task-context.service'

export async function POST(request: Request) {
  return handleHookRequest(request, 'SESSION_START', {
    afterRecord: async ctx => {
      if (!ctx.sessionId) return
      const binding = await sessionRepository.findTaskBinding(ctx.sessionId)
      let memorySection = ''
      let reviewTodosSection = ''
      let previousSession: PreviousSessionRecovery | null = null
      if (binding.bound === true) {
        ;[memorySection, reviewTodosSection, previousSession] =
          await Promise.all([
            taskContextService.buildMemorySectionForTask(binding.taskId),
            taskContextService.buildReviewTodosSectionForTask(binding.taskId),
            taskContextService.buildPreviousSessionRecoveryForTask(
              binding.taskId,
              ctx.sessionId
            ),
          ])
      }
      return {
        sessionId: ctx.sessionId,
        taskBinding: binding,
        memorySection,
        reviewTodosSection,
        previousSession,
      }
    },
  })
}
```

- [ ] **Step 2: 类型检查**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: 无新增错误(`previousSession` 类型对齐 `PreviousSessionRecovery | null`)

- [ ] **Step 3: 提交**

```bash
git add app/api/hooks/session-start/route.ts
git commit -m "feat: return previousSession from session-start hook [LUM-146]"
```

---

## Task 3: 服务端 — `bindSessionToTask` 返回 `previousSession`(路径②)

**Files:**

- Modify: `lib/services/session.service.ts`
- Test: `__tests__/lib/services/session-service-bind.test.ts`

- [ ] **Step 1: 改 mock 头部 + beforeEach 默认值,再写失败测试**

该文件已 mock `@/lib/services/task-context.service`,但只暴露 `buildMemorySectionForTask`。先把新方法加进 mock 工厂:

```ts
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: {
    buildMemorySectionForTask: jest.fn(),
    buildPreviousSessionRecoveryForTask: jest.fn(),
  },
}))
```

在 `beforeEach` 末尾给它一个默认返回值(`null`),让既有用例拿到 `previousSession: null`:

```ts
;(
  taskContextService.buildPreviousSessionRecoveryForTask as jest.Mock
).mockResolvedValue(null)
```

既有 happy-path 用例(`'upserts session to task and re-tags null events'`)用 `expect(result).toEqual({...})` 断言完整对象——**给那个对象补一行** `previousSession: null,`,否则它会因多出字段而失败。

然后在 `describe('sessionService.bindSessionToTask', ...)` 内追加新用例(沿用文件里既有的 `identity` 常量):

```ts
it('includes previousSession from taskContextService in the result', async () => {
  ;(
    taskContextService.buildPreviousSessionRecoveryForTask as jest.Mock
  ).mockResolvedValue({
    headline: 'prev headline',
    unresolved: ['carry over'],
    durationMs: 60_000,
    lastActivityAt: '2026-06-01T10:00:00.000Z',
  })

  const result = await sessionService.bindSessionToTask({
    identity,
    sessionId: 'sess_1',
    taskIdentifier: 'LUM-42',
  })

  expect(
    taskContextService.buildPreviousSessionRecoveryForTask
  ).toHaveBeenCalledWith(
    'task_1', // task.id from the resolveIdentifier mock
    'sess_1'
  )
  expect(result.previousSession).toEqual({
    headline: 'prev headline',
    unresolved: ['carry over'],
    durationMs: 60_000,
    lastActivityAt: '2026-06-01T10:00:00.000Z',
  })
})
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `npx jest __tests__/lib/services/session-service-bind.test.ts`
Expected: FAIL — `result.previousSession` is undefined / mock 未被调用

- [ ] **Step 3: 实现**

在 `lib/services/session.service.ts`:

a) 给 result 类型加字段。找到 `BindSessionToTaskResult` 接口,加(import 类型于文件顶部):

```ts
import type { PreviousSessionRecovery } from '@/lib/services/task-context.service'
```

```ts
export interface BindSessionToTaskResult {
  // ...existing fields...
  previousSession: PreviousSessionRecovery | null
}
```

b) 在 `bindSessionToTask` 里,`memorySection` 那行之后并行取 previousSession,并加进返回对象:

```ts
const [memorySection, previousSession] = await Promise.all([
  taskContextService.buildMemorySectionForTask(task.id),
  taskContextService.buildPreviousSessionRecoveryForTask(task.id, sessionId),
])

return {
  taskId: task.id,
  taskIdentifier: task.identifier,
  taskTitle: task.title,
  retaggedEventCount: count,
  memorySection,
  previousSession,
}
```

(替换原来单独 `const memorySection = await ...` 那行 + 原 return。)

- [ ] **Step 4: 跑测试,确认通过**

Run: `npx jest __tests__/lib/services/session-service-bind.test.ts`
Expected: PASS(含新用例 + 既有用例不回归;若既有用例断言了完整 result 对象,补上 `previousSession: null` 期望)

- [ ] **Step 5: 提交**

```bash
git add lib/services/session.service.ts __tests__/lib/services/session-service-bind.test.ts
git commit -m "feat: return previousSession from bindSessionToTask (auto-bind path) [LUM-146]"
```

---

## Task 4: CLI — 抽取 `formatDuration` / `relativeTime` 到 `cli/src/lib/format.ts`

**Files:**

- Create: `cli/src/lib/format.ts`
- Modify: `cli/src/commands/task-context.ts`
- Test: `__tests__/cli/format.test.ts`

- [ ] **Step 1: 写失败测试(锁定抽取后行为)**

创建 `__tests__/cli/format.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { formatDuration, relativeTime } from '@/cli/src/lib/format'

describe('formatDuration', () => {
  it('floors sub-minute at 1s and rounds seconds', () => {
    expect(formatDuration(500)).toBe('1s')
    expect(formatDuration(45_000)).toBe('45s')
  })
  it('renders minutes under an hour', () => {
    expect(formatDuration(23 * 60_000)).toBe('23min')
  })
  it('renders hours and h+min', () => {
    expect(formatDuration(60 * 60_000)).toBe('1h')
    expect(formatDuration(90 * 60_000)).toBe('1h 30min')
  })
})

describe('relativeTime', () => {
  const now = new Date('2026-06-01T12:00:00Z')
  it('just now under a minute', () => {
    expect(relativeTime(new Date('2026-06-01T11:59:30Z'), now)).toBe('just now')
  })
  it('minutes / hours / days', () => {
    expect(relativeTime(new Date('2026-06-01T11:30:00Z'), now)).toBe(
      '30min ago'
    )
    expect(relativeTime(new Date('2026-06-01T10:00:00Z'), now)).toBe('2h ago')
    expect(relativeTime(new Date('2026-05-30T12:00:00Z'), now)).toBe(
      '2 days ago'
    )
    expect(relativeTime(new Date('2026-05-31T12:00:00Z'), now)).toBe(
      'yesterday'
    )
  })
})
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `npx jest __tests__/cli/format.test.ts`
Expected: FAIL — Cannot find module `@/cli/src/lib/format`

- [ ] **Step 3: 创建 format.ts(原样移动两函数,加 export)**

创建 `cli/src/lib/format.ts`:

```ts
/**
 * Shared CLI time/duration formatters. Extracted from task-context.ts so the
 * session-start recovery card (hook-runner.ts) can reuse the exact same shape.
 */

export function formatDuration(ms: number): string {
  if (ms < 60_000) {
    return `${Math.max(1, Math.round(ms / 1000))}s`
  }
  const totalMinutes = Math.round(ms / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}min`
}

export function relativeTime(then: Date, now: Date): string {
  const diffMs = now.getTime() - then.getTime()
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}
```

- [ ] **Step 4: 改 task-context.ts 引用共享版本**

在 `cli/src/commands/task-context.ts`:

- 顶部 import 区加:`import { formatDuration, relativeTime } from '../lib/format'`
- **删除**文件末尾本地的 `function formatDuration(...) { ... }` 和 `function relativeTime(...) { ... }`(第 195–221 行那两个)。

- [ ] **Step 5: 跑测试,确认通过(含既有 task-context 测试不回归)**

Run: `npx jest __tests__/cli/format.test.ts __tests__/cli/task-context-format.test.ts`
Expected: PASS(两个文件都绿)

- [ ] **Step 6: 提交**

```bash
git add cli/src/lib/format.ts cli/src/commands/task-context.ts __tests__/cli/format.test.ts
git commit -m "refactor: extract formatDuration/relativeTime to cli/src/lib/format [LUM-146]"
```

---

## Task 5: CLI — `renderRecoveryCard` + 接进 `formatHookStdoutLines`(路径①)

**Files:**

- Modify: `cli/src/lib/hook-runner.ts`
- Test: `__tests__/cli/hook-runner-recovery-card.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `__tests__/cli/hook-runner-recovery-card.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { formatHookStdoutLines } from '@/cli/src/lib/hook-runner'

const NOW = new Date('2026-06-01T12:00:00Z')

function boundBody(previousSession: unknown) {
  return {
    ok: true,
    sessionId: 's-1',
    taskBinding: { bound: true, taskIdentifier: 'LUM-146', taskTitle: 'T' },
    previousSession,
  }
}

describe('hook-runner recovery card (formatHookStdoutLines, session-start)', () => {
  it('renders the card first in additionalContext, before memorySection', () => {
    const body = {
      ...boundBody({
        headline: 'wired up the service',
        unresolved: ['finish CLI render', 'add tests'],
        durationMs: 23 * 60_000,
        lastActivityAt: '2026-06-01T10:00:00Z',
      }),
      memorySection: '## Relevant Memory\n- x',
    }
    const lines = formatHookStdoutLines('session-start', body, NOW)
    const ctx = JSON.parse(lines[1]!).hookSpecificOutput
      .additionalContext as string

    expect(ctx).toContain('## 续上次进度 (上一段 session · 2h ago · 23min)')
    expect(ctx).toContain('上次干到：wired up the service')
    expect(ctx).toContain('- finish CLI render')
    expect(ctx).toContain('- add tests')
    // card precedes memory
    expect(ctx.indexOf('续上次进度')).toBeLessThan(
      ctx.indexOf('Relevant Memory')
    )
  })

  it('omits the "未完成" block when unresolved is empty', () => {
    const lines = formatHookStdoutLines(
      'session-start',
      boundBody({
        headline: 'just headline',
        unresolved: [],
        durationMs: 60_000,
        lastActivityAt: '2026-06-01T11:59:30Z',
      }),
      NOW
    )
    const ctx = JSON.parse(lines[1]!).hookSpecificOutput
      .additionalContext as string
    expect(ctx).toContain('## 续上次进度 (上一段 session · just now · 1min)')
    expect(ctx).not.toContain('未完成：')
  })

  it('caps unresolved at 5 and appends a "+M more" pointer', () => {
    const lines = formatHookStdoutLines(
      'session-start',
      boundBody({
        headline: 'h',
        unresolved: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        durationMs: 60_000,
        lastActivityAt: '2026-06-01T11:00:00Z',
      }),
      NOW
    )
    const ctx = JSON.parse(lines[1]!).hookSpecificOutput
      .additionalContext as string
    expect(ctx).toContain('- e')
    expect(ctx).not.toContain('- f')
    expect(ctx).toContain('…(+2 more, 跑 lumo task context LUM-146 查看全部)')
  })

  it('sanitizes ANSI/control chars in headline and unresolved', () => {
    const lines = formatHookStdoutLines(
      'session-start',
      boundBody({
        headline: 'evil[31mred',
        unresolved: ['badbell'],
        durationMs: 60_000,
        lastActivityAt: '2026-06-01T11:00:00Z',
      }),
      NOW
    )
    const ctx = JSON.parse(lines[1]!).hookSpecificOutput
      .additionalContext as string
    expect(ctx).not.toContain('')
    expect(ctx).not.toContain('')
  })

  it('injects no card when previousSession is null (memory still emitted)', () => {
    const body = {
      ...boundBody(null),
      memorySection: '## Relevant Memory\n- x',
    }
    const lines = formatHookStdoutLines('session-start', body, NOW)
    const ctx = JSON.parse(lines[1]!).hookSpecificOutput
      .additionalContext as string
    expect(ctx).not.toContain('续上次进度')
    expect(ctx).toContain('Relevant Memory')
  })
})
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `npx jest __tests__/cli/hook-runner-recovery-card.test.ts`
Expected: FAIL — 卡片文本未出现 / `formatHookStdoutLines` 第三参 `now` 未生效

- [ ] **Step 3: 实现**

在 `cli/src/lib/hook-runner.ts`:

a) 顶部 import 加共享 formatter:

```ts
import { formatDuration, relativeTime } from './format'
```

b) `SessionStartBody` 类型加字段:

```ts
type SessionStartBody = {
  sessionId?: string
  taskBinding?: {
    bound: boolean
    taskIdentifier?: string
    taskTitle?: string
  }
  memorySection?: string
  reviewTodosSection?: string
  previousSession?: PreviousSessionCard | null
}
```

c) 新增卡片类型 + 渲染函数(放在 `sessionContextEnvelope` 附近):

```ts
const MAX_UNRESOLVED = 5

type PreviousSessionCard = {
  headline: string
  unresolved: string[]
  durationMs: number
  lastActivityAt: string
}

/**
 * Render the "续上次进度" recovery card from the structured previousSession
 * payload. Returns undefined when there's nothing to show (null payload or an
 * empty headline). Free text (headline / unresolved) is sanitized here — it's
 * LLM-generated and routed to Claude Code stdout. unresolved is capped at
 * MAX_UNRESOLVED with a "+M more" pointer to `lumo task context`.
 */
function renderRecoveryCard(
  prev: PreviousSessionCard | null | undefined,
  taskIdentifier: string,
  now: Date
): string | undefined {
  if (!prev || typeof prev.headline !== 'string' || prev.headline === '') {
    return undefined
  }
  const ago = relativeTime(new Date(prev.lastActivityAt), now)
  const dur = formatDuration(prev.durationMs)
  const lines: string[] = [
    `## 续上次进度 (上一段 session · ${ago} · ${dur})`,
    `上次干到：${sanitizeField(prev.headline)}`,
  ]
  const unresolved = Array.isArray(prev.unresolved) ? prev.unresolved : []
  if (unresolved.length > 0) {
    lines.push('未完成：')
    const shown = unresolved.slice(0, MAX_UNRESOLVED)
    for (const u of shown) lines.push(`- ${sanitizeField(u)}`)
    const extra = unresolved.length - shown.length
    if (extra > 0) {
      lines.push(
        `- …(+${extra} more, 跑 lumo task context ${taskIdentifier} 查看全部)`
      )
    }
  }
  return lines.join('\n')
}
```

d) 给 `formatHookStdoutLines` 加 `now` 参数,并把卡片插到 envelope 最前:

```ts
export function formatHookStdoutLines(
  path: string,
  responseBody: unknown,
  now: Date = new Date()
): string[] {
```

把现有的:

```ts
const envelope = sessionContextEnvelope([
  body.memorySection,
  body.reviewTodosSection,
])
```

改为:

```ts
const card = renderRecoveryCard(
  body.previousSession,
  tb?.taskIdentifier ?? '',
  now
)
const envelope = sessionContextEnvelope([
  card,
  body.memorySection,
  body.reviewTodosSection,
])
```

(`sessionContextEnvelope` 的入参类型已是 `Array<string | undefined>`,`card` 为 `string | undefined` 直接兼容,null/空会被现有 filter 丢弃。)

- [ ] **Step 4: 跑测试,确认通过(含既有 additional-context 测试不回归)**

Run: `npx jest __tests__/cli/hook-runner-recovery-card.test.ts __tests__/cli/hook-runner-additional-context.test.ts`
Expected: PASS(两文件都绿;既有测试不传 `now`,走默认值,卡片字段缺省→不渲染,行为不变)

- [ ] **Step 5: 提交**

```bash
git add cli/src/lib/hook-runner.ts __tests__/cli/hook-runner-recovery-card.test.ts
git commit -m "feat: renderRecoveryCard + inject into session-start stdout (resume path) [LUM-146]"
```

---

## Task 6: CLI — auto-bind 路径注入卡片(路径②)

**Files:**

- Modify: `cli/src/lib/hook-runner.ts`
- Test: `__tests__/cli/session-start-auto-bind.test.ts`

- [ ] **Step 1: 写失败测试**

`resolveSessionStartStdout` 的 auto-bind 用例在 `__tests__/cli/session-start-auto-bind.test.ts`(已 `import { resolveSessionStartStdout }`,deps 形状:`extractTask: () => ({ identifier, source: 'branch'|'commit' }) | null`,`bindTask: async () => AutoBindAttempt`)。在该文件的 `describe('resolveSessionStartStdout', ...)` 内追加:

```ts
it('injects the recovery card on the auto-bind path', async () => {
  const lines = await resolveSessionStartStdout(
    { ok: true, sessionId: 'sess_abc', taskBinding: { bound: false } },
    {
      extractTask: () => ({ identifier: 'LUM-146', source: 'branch' }),
      bindTask: async () => ({
        ok: true,
        taskIdentifier: 'LUM-146',
        taskTitle: 'T',
        memorySection: '## Relevant Memory\n- x',
        previousSession: {
          headline: 'cross-branch carry-over',
          unresolved: ['ship it'],
          durationMs: 60_000,
          lastActivityAt: '2026-06-01T10:00:00Z',
        },
      }),
    },
    new Date('2026-06-01T12:00:00Z')
  )

  // lines[0] = auto-bind 状态行; lines[1] = additionalContext envelope
  const ctx = JSON.parse(lines[1]!).hookSpecificOutput
    .additionalContext as string
  expect(ctx).toContain('## 续上次进度')
  expect(ctx).toContain('上次干到：cross-branch carry-over')
  expect(ctx).toContain('- ship it')
  expect(ctx.indexOf('续上次进度')).toBeLessThan(ctx.indexOf('Relevant Memory'))
})
```

> 既有用例不传第三参 `now` → 走默认 `new Date()`,且其 `bindTask` mock 不返回 `previousSession` → 无卡,行为不回归。

- [ ] **Step 2: 跑测试,确认失败**

Run: `npx jest __tests__/cli/session-start-auto-bind.test.ts`
Expected: FAIL — 卡片未出现 / `resolveSessionStartStdout` 不接受第三参 `now`

- [ ] **Step 3: 实现**

在 `cli/src/lib/hook-runner.ts`:

a) `AutoBindAttempt` 接口加字段:

```ts
export interface AutoBindAttempt {
  ok: boolean
  taskIdentifier?: string | undefined
  taskTitle?: string | undefined
  memorySection?: string | undefined
  previousSession?: PreviousSessionCard | null | undefined
}
```

b) `postBindTask` 读取响应里的 previousSession 并透传:

```ts
const body = (await res.json()) as {
  taskIdentifier?: string
  taskTitle?: string
  memorySection?: string
  previousSession?: PreviousSessionCard | null
}
return {
  ok: true,
  taskIdentifier: body.taskIdentifier,
  taskTitle: body.taskTitle,
  memorySection: body.memorySection,
  previousSession: body.previousSession ?? undefined,
}
```

c) `resolveSessionStartStdout` 加 `now` 参数,bound 路径透传给 `formatHookStdoutLines`,auto-bind 路径渲染卡片插最前:

```ts
export async function resolveSessionStartStdout(
  responseBody: unknown,
  deps: AutoBindDeps,
  now: Date = new Date()
): Promise<string[]> {
```

把 bound 分支:

```ts
if (tb && tb.bound === true) {
  return formatHookStdoutLines('session-start', responseBody, now)
}
```

把 auto-bind 收尾:

```ts
const lines = [formatAutoBindLine(sessionId, match, result)]
const card = renderRecoveryCard(
  result.previousSession,
  result.taskIdentifier ?? match.identifier,
  now
)
const envelope = sessionContextEnvelope([card, result.memorySection])
if (envelope) lines.push(envelope)
return lines
```

- [ ] **Step 4: 跑测试,确认通过**

Run: `npx jest __tests__/cli/session-start-auto-bind.test.ts`
Expected: PASS(新用例 + 既有 auto-bind 用例不回归;既有用例不传 `now` 走默认,`previousSession` 缺省→无卡,行为不变)

- [ ] **Step 5: 提交**

```bash
git add cli/src/lib/hook-runner.ts __tests__/cli/hook-runner-session-start-stdout.test.ts
git commit -m "feat: inject recovery card on auto-bind path [LUM-146]"
```

---

## Task 7: 收尾 — 全量校验 + CLI 版本 bump

**Files:**

- Modify: `cli/package.json`

- [ ] **Step 1: 全量类型检查 + 测试**

Run: `npx prisma generate && npx tsc --noEmit && npm test`
Expected: tsc 零错误;Jest 全绿。
(若 tsc 报 `PreviousSessionRecovery` / `previousSession` 相关"找不到":多半是 stale generated client,`npx prisma generate` 后重试 —— 见项目记忆。)

- [ ] **Step 2: 扫 console.log**

Run: `git diff main --stat && grep -rn "console.log" lib/services/task-context.service.ts lib/services/session.service.ts cli/src/lib/hook-runner.ts cli/src/lib/format.ts cli/src/commands/task-context.ts`
Expected: 无 `console.log` 命中(既有 `console.error` 不算)。

- [ ] **Step 3: CLI 版本 bump**

`cli/src/` 有 user-facing 行为变更(session-start 注入恢复卡),按项目惯例 minor bump。编辑 `cli/package.json` 的 `version`(如 `1.6.0` → `1.7.0`)。

```bash
git add cli/package.json
git commit -m "chore: bump CLI to <new-version> for session-start recovery card [LUM-146]"
```

- [ ] **Step 4: 提示用户 publish**

`lumo update` 只能交付已 publish 的版本,本仓库无 CI 发布。**提醒用户**:合并后需手动 `cd cli && npm publish` 才能让恢复卡随 CLI 下发。(写进 PR 描述。)

---

## 验收对照(spec 覆盖自检)

- ✅ item 1 `previousSession`(headline + unresolved + 时长)→ Task 1/2/3 + 5/6
- ✅ "上一段 session"= 同任务最近一条有 summary、排除当前 session、跨分支 → Task 1
- ✅ 没 summary 往回找 / 全无则不渲染 → Task 1
- ✅ 固定上限 N=5 + "+M more" → Task 5(`MAX_UNRESOLVED`)
- ✅ 服务端结构化、CLI 渲染 + sanitize → Task 1(结构化)+ Task 5(渲染/sanitize)
- ✅ 卡片排 memory/review 之前 → Task 5/6
- ✅ resume 路径① + auto-bind 路径②(squash-merge 跨分支)→ Task 2 + Task 3/6
- ✅ format.ts 小重构、task-context.ts 不回归 → Task 4
- ✅ 边界:未绑定不构建 / null 不渲染 / unresolved 空不渲染 → Task 1 + Task 5
- ✅ 无 schema 变更 → 全程无 migration
- ✅ 测试齐全、tsc、无 console.log、CLI bump → Task 7
- ✅ SKILL.md 无需同步(纯内部重构 + hook 内部行为)→ 文件结构小节已说明
