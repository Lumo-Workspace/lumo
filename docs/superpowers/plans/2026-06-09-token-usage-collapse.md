# LUM-351 Token 用量整卡折叠 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent 运行 tab 的 token 用量汇总卡改为默认收起的整卡 disclosure,并清理共享 `TokenCostBreakdown` 的微标题与组间横线。

**Architecture:** 折叠状态只活在 `AgentRunTab` 本地 `useState`;`TokenCostBreakdown` 加 `showTitle` 可选 prop(默认 true,Lineage/Run 卡零改动),组间 `border-t` 改留白;`fmtCompact`/`modelLabel` 从 `AgentRunCard` 抽到共享模块供收起行复用。零 schema、零 API、零新 i18n key。

**Tech Stack:** Next.js 14 client components, react-intl, Tailwind, Jest + RTL (jsdom)。

**Spec:** `docs/superpowers/specs/2026-06-09-token-usage-collapse-design.md`
**验收合约:** LUM-351 AGENT_DRAFT r0(5 条)— 测试名必须含 `collapsed by default` / `toggle` / `in-flight`(checkpointer 用 `-t` 匹配)。

---

### Task 0: Worktree + 分支

**Files:** none(环境准备)

- [ ] **Step 1: 从主 checkout 建 worktree**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && git fetch origin && lumo worktree add LUM-351 token-usage-collapse
```

Expected: `.worktrees/LUM-351` 就绪,分支 `lumo/LUM-351-token-usage-collapse` 基于 origin/main,node_modules symlink 建好。后续所有命令 cwd 都在 `.worktrees/LUM-351` 内;每条改状态的 git 命令用 `git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-351`(下文简写 `git -C <wt>`)。

- [ ] **Step 2: 把 spec + plan 拷进 worktree 并提交**

```bash
WT=/Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-351
mkdir -p $WT/docs/superpowers/specs $WT/docs/superpowers/plans
cp docs/superpowers/specs/2026-06-09-token-usage-collapse-design.md $WT/docs/superpowers/specs/
cp docs/superpowers/plans/2026-06-09-token-usage-collapse.md $WT/docs/superpowers/plans/
git -C $WT add docs/superpowers && git -C $WT commit -m "docs: spec + plan for token usage collapse [LUM-351]"
```

---

### Task 1: 抽共享格式化模块 `model-cost-format.ts`

**Files:**
- Create: `app/workspace/[workspaceUrl]/components/AgentRunTimeline/model-cost-format.ts`
- Modify: `app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunCard.tsx`(删本地 `fmtCompact`/`modelLabel`,改 import)
- Test: 既有 `__tests__/components/AgentRunCard.test.tsx`(纯搬移,行为不变)

- [ ] **Step 1: 新建共享模块**

```ts
// app/workspace/[workspaceUrl]/components/AgentRunTimeline/model-cost-format.ts
import type { IntlShape } from 'react-intl'
import { IN_FLIGHT_MODEL } from '@/types/model-cost'

export function fmtCompact(intl: IntlShape, n: number): string {
  return intl.formatNumber(n, { notation: 'compact', maximumFractionDigits: 1 })
}

export function modelLabel(intl: IntlShape, model: string): string {
  if (model === IN_FLIGHT_MODEL)
    return intl.formatMessage({
      id: 'tokenCost.inFlight',
      defaultMessage: 'in progress',
    })
  return model.replace(/^claude-/, '')
}
```

- [ ] **Step 2: AgentRunCard 改用共享模块**

删除 `AgentRunCard.tsx` 底部的 `fmtCompact` / `modelLabel` 两个函数定义(`formatDuration` 留下),顶部加:

```ts
import { fmtCompact, modelLabel } from './model-cost-format'
```

若删除后 `IN_FLIGHT_MODEL` import 在该文件再无使用,把它一并删掉(tsc noUnusedLocals 会抓)。

- [ ] **Step 3: 跑既有测试确认无回归**

Run: `cd $WT && npx jest AgentRunCard`
Expected: PASS(纯搬移)

- [ ] **Step 4: Commit**

```bash
git -C $WT add -A && git -C $WT commit -m "refactor: extract shared model cost formatters [LUM-351]"
```

---

### Task 2: TokenCostBreakdown — showTitle prop + 标题升级 + 去横线(含 LineageTab 空态)

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/TokenCostBreakdown.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/LineageTab.tsx`(仅空态 label 的 className)
- Test: `__tests__/components/TokenCostBreakdown.test.tsx`

- [ ] **Step 1: 先改测试(TDD)**

`TokenCostBreakdown.test.tsx` 中替换原 `labels the section "Token usage"` 测试,并在同一 `describe('TokenCostBreakdown')` 内新增两个:

```tsx
it('labels the section "Token usage" by default, without the uppercase micro-label style', () => {
  render(<TokenCostBreakdown variant='full' models={[opus]} loopCount={1} />)
  const title = screen.getByText('Token usage')
  expect(title).toBeInTheDocument()
  expect(title).not.toHaveClass('uppercase')
  expect(screen.queryByText('Cost')).not.toBeInTheDocument()
})

it('hides the title when showTitle is false (consumer header carries it)', () => {
  render(
    <TokenCostBreakdown
      variant='full'
      models={[opus]}
      loopCount={1}
      showTitle={false}
    />
  )
  expect(screen.queryByText('Token usage')).not.toBeInTheDocument()
})

it('separates multi-model groups with whitespace, not border-t dividers', () => {
  const { container } = render(
    <TokenCostBreakdown variant='full' models={[opus, sonnet]} loopCount={null} />
  )
  expect(container.querySelector('.border-t')).toBeNull()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd $WT && npx jest TokenCostBreakdown`
Expected: FAIL —— 新增 3 个测试红(`uppercase` class 存在 / `showTitle` prop 不存在仍渲染标题 / `.border-t` 命中)。

- [ ] **Step 3: 实现**

`TokenCostBreakdown.tsx` 三处改动:

(a) Props 加 `showTitle`:

```ts
interface TokenCostBreakdownProps {
  models: ModelCost[]
  loopCount?: number | null
  variant: 'full' | 'compact'
  chips?: CostChip[]
  perMember?: AgentRunMemberStat[]
  /**
   * Render the "Token usage" heading (default). The run-tab summary card
   * passes false because its disclosure header already carries the title.
   */
  showTitle?: boolean
}
```

函数签名解构加 `showTitle = true`。

(b) 标题渲染替换(原 10px 大写微标题):

```tsx
{showTitle && (
  <div className='mb-2 text-caption font-medium text-muted-foreground'>
    {intl.formatMessage({
      id: 'tokenCost.label',
      defaultMessage: 'Token usage',
    })}
  </div>
)}
```

(c) `ModelGroup` 根元素去横线改留白 —— old:

```
'py-2 first:pt-0 border-t border-border/60 first:border-t-0'
```

new:

```
'mt-3 first:mt-0'
```

(d) `LineageTab.tsx` 空态 label(`lineage.cost.label` 那个 div)className 由 `text-[10px] uppercase tracking-wider text-muted-foreground/60` 改为 `mb-1 text-caption font-medium text-muted-foreground`(下方 `mt-1` 行保持)。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd $WT && npx jest TokenCostBreakdown LineageTab AgentRunCard TimelineTabs`
Expected: 全 PASS(LineageTab/AgentRunCard 无标题断言,不受影响)

- [ ] **Step 5: Commit**

```bash
git -C $WT add -A && git -C $WT commit -m "feat: optional title + whitespace dividers in TokenCostBreakdown [LUM-351]"
```

---

### Task 3: AgentRunTab 整卡 disclosure(默认收起)

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunTab.tsx`
- Test: Create `__tests__/components/AgentRunTimeline/AgentRunTab.test.tsx`

- [ ] **Step 1: 写失败测试**(测试名必须含 `collapsed by default` / `toggle` / `in-flight`,对应验收 checkpointer)

```tsx
/** @jest-environment jsdom */

// Same react-intl mock shape as TokenCostBreakdown.test.tsx: interpolated
// defaultMessage with ICU plural handling, formatNumber = String(n).
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      d: { id?: string; defaultMessage?: string },
      values?: Record<string, string | number>
    ) => {
      let s = d.defaultMessage ?? d.id ?? ''
      if (values) {
        s = s.replace(
          /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
          (_: string, key: string, one: string, other: string) => {
            const n = Number(values[key] ?? 0)
            const branch = n === 1 ? one : other
            return branch.replace('#', String(n))
          }
        )
        for (const [k, v] of Object.entries(values)) {
          s = s.split(`{${k}}`).join(String(v))
        }
      }
      return s
    },
    formatNumber: (n: number) => String(n),
  }),
}))

const mockUseAgentRuns = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useAgentRuns', () => ({
  useAgentRuns: (...args: unknown[]) => mockUseAgentRuns(...args),
}))
// Run cards are out of scope here — LUM-345 tests cover them.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunCard',
  () => ({ AgentRunCard: () => null })
)

import { render, screen, fireEvent } from '@testing-library/react'
import { AgentRunTab } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunTab'
import type { ModelCost } from '@/app/workspace/[workspaceUrl]/types'

const opus: ModelCost = {
  model: 'claude-opus-4-8',
  input: 95,
  output: 180,
  cacheRead: 10_900_000,
  cacheCreation: 1_200_000,
  total: 12_300_000,
}
const sonnetLive: ModelCost = {
  model: 'claude-sonnet-4-6',
  input: 48,
  output: 92,
  cacheRead: 2_900_000,
  cacheCreation: 410_000,
  total: 3_300_000,
  inFlight: { input: 10, output: 5, cacheRead: 80, cacheCreation: 5, total: 100 },
}

function arm(byModel: ModelCost[]) {
  mockUseAgentRuns.mockReturnValue({
    data: {
      runs: [{ sessionId: 's1', runNumber: 1 }],
      totals: { runCount: 1, turnCount: 2, loopCount: 4, byModel },
      perMember: [],
    },
    loading: false,
    error: null,
  })
}

function renderTab() {
  return render(
    <AgentRunTab taskId='t1' taskIdentifier='LUM-351' enabled={true} />
  )
}

describe('AgentRunTab token usage card', () => {
  beforeEach(() => mockUseAgentRuns.mockReset())

  it('is collapsed by default: details out of the DOM, header summary carries title + per-model totals', () => {
    arm([opus, sonnetLive])
    renderTab()
    const toggle = screen.getByTestId('token-usage-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Token usage')).toBeInTheDocument()
    expect(screen.getByText('1 run · 2 turns · 2 models')).toBeInTheDocument()
    expect(
      screen.getByText('opus-4-8 12300000 · sonnet-4-6 3300000')
    ).toBeInTheDocument()
    // Breakdown details (segment rows) absent while collapsed.
    expect(screen.queryByText('output')).not.toBeInTheDocument()
    expect(screen.queryByText('cache-read')).not.toBeInTheDocument()
  })

  it('toggle expands to the full breakdown and collapses back', () => {
    arm([opus, sonnetLive])
    renderTab()
    const toggle = screen.getByTestId('token-usage-toggle')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('output')).toBeInTheDocument()
    expect(screen.getByText('claude-opus-4-8')).toBeInTheDocument()
    // The shared breakdown renders without its own title (header carries it).
    expect(screen.getAllByText('Token usage')).toHaveLength(1)
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('output')).not.toBeInTheDocument()
  })

  it('keeps a pulse indicator in the collapsed row while any model has in-flight burn', () => {
    arm([opus, sonnetLive])
    renderTab()
    expect(screen.getByTestId('collapsed-in-flight-dot')).toBeInTheDocument()
  })

  it('shows no in-flight indicator when all models are settled', () => {
    arm([opus])
    renderTab()
    expect(
      screen.queryByTestId('collapsed-in-flight-dot')
    ).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd $WT && npx jest __tests__/components/AgentRunTimeline/AgentRunTab.test.tsx`
Expected: FAIL —— `token-usage-toggle` testid 不存在。

- [ ] **Step 3: 实现 AgentRunTab**

`AgentRunTab.tsx` 完整新内容(loading/error/empty 三段不变,只列出变化的头部与 return):

```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Bot, ChevronRight } from 'lucide-react'
import { useAgentRuns } from '../../hooks/useAgentRuns'
import { AgentRunCard } from './AgentRunCard'
import { TokenCostBreakdown } from '../TokenCostBreakdown'
import { fmtCompact, modelLabel } from './model-cost-format'
import { IN_FLIGHT_MODEL } from '@/types/model-cost'
```

组件体内,hooks 必须全部在三个早返回之前(React hook 规则):

```tsx
const intl = useIntl()
const { data, loading, error } = useAgentRuns({ taskId, enabled })
// Collapsed by default (LUM-351) — the header row already carries per-model
// totals, and live burn has its own card in the sidebar.
const [costOpen, setCostOpen] = useState(false)
```

(loading / error / runs.length === 0 三个早返回原样保留。)

主 return 中,汇总卡块整体替换为:

```tsx
const { totals } = data!
const hasInFlight = totals.byModel.some(
  m => m.inFlight || m.model === IN_FLIGHT_MODEL
)
const modelSummary = totals.byModel
  .map(m => `${modelLabel(intl, m.model)} ${fmtCompact(intl, m.total)}`)
  .join(' · ')

return (
  <div className='space-y-3'>
    {totals.byModel.length > 0 && (
      <div className='rounded-lg border border-border'>
        <button
          type='button'
          onClick={() => setCostOpen(v => !v)}
          aria-expanded={costOpen}
          data-testid='token-usage-toggle'
          className='flex w-full items-center gap-2 rounded-lg px-3 py-2 text-caption transition-colors hover:bg-muted/60'
        >
          <ChevronRight
            className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${costOpen ? 'rotate-90' : ''}`}
            aria-hidden
          />
          <span className='shrink-0 font-medium'>
            {intl.formatMessage({
              id: 'tokenCost.label',
              defaultMessage: 'Token usage',
            })}
          </span>
          <span className='shrink-0 text-muted-foreground'>
            {intl.formatMessage(
              {
                id: 'agentRun.summary',
                defaultMessage:
                  '{runs, plural, one {# run} other {# runs}} · {turns, plural, one {# turn} other {# turns}} · {models, plural, one {# model} other {# models}}',
              },
              {
                runs: totals.runCount,
                turns: totals.turnCount,
                models: totals.byModel.length,
              }
            )}
          </span>
          {!costOpen && (
            <span className='ml-auto flex min-w-0 items-center gap-2 text-muted-foreground'>
              {hasInFlight && (
                <span
                  data-testid='collapsed-in-flight-dot'
                  className='size-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/60'
                  aria-hidden
                />
              )}
              <span className='truncate tabular-nums'>{modelSummary}</span>
            </span>
          )}
        </button>
        {costOpen && (
          <TokenCostBreakdown
            variant='full'
            showTitle={false}
            models={totals.byModel}
            loopCount={totals.loopCount}
            perMember={data?.perMember ?? []}
          />
        )}
      </div>
    )}
    {runs.map(run => (
      <AgentRunCard
        key={run.sessionId ?? `unlinked-${run.runNumber}`}
        run={run}
        defaultExpanded={false}
      />
    ))}
  </div>
)
```

注意:原卡片头的 `border-b` 行整个删除(标题行即卡片头);`agentRun.summary` i18n key 原样复用。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd $WT && npx jest __tests__/components/AgentRunTimeline/AgentRunTab.test.tsx`
Expected: 4 个测试全 PASS。

- [ ] **Step 5: Commit**

```bash
git -C $WT add -A && git -C $WT commit -m "feat: collapsible token usage card on agent run tab [LUM-351]"
```

---

### Task 4: 全量验证

- [ ] **Step 1: 相关套件 + 两个测试根全量**

```bash
cd $WT && npx jest TokenCostBreakdown AgentRunTab AgentRunCard LineageTab TimelineTabs && npx jest
```

Expected: 全 PASS(`tests/` 第二根一并被全量覆盖;若遇 stale Prisma client 报错,先 `npx prisma generate` 再 tsc/jest,工作中只信 jest——见 memory)。

- [ ] **Step 2: tsc + console.log 检查**

```bash
cd $WT && npx tsc --noEmit
cd $WT && grep -rn "console.log" "app/workspace/[workspaceUrl]/components/AgentRunTimeline/" "app/workspace/[workspaceUrl]/components/TokenCostBreakdown.tsx"
```

Expected: tsc 0 错误;grep 无输出。

- [ ] **Step 3: 验收合约 MACHINE 项逐条跑**

```bash
cd $WT && npx jest __tests__/components/AgentRunTimeline/AgentRunTab.test.tsx -t 'collapsed by default'
cd $WT && npx jest __tests__/components/AgentRunTimeline/AgentRunTab.test.tsx -t 'toggle'
cd $WT && npx jest __tests__/components/AgentRunTimeline/AgentRunTab.test.tsx -t 'in-flight'
cd $WT && npx jest TokenCostBreakdown TimelineTabs AgentRunCard
```

Expected: 各自 PASS。HUMAN 项(typography-not-color / 1440px 单行)留给用户在 PR preview 上确认 —— preview_* 工具连不上 localhost(见 memory),不要在本地硬验。

---

### Task 5: PR

- [ ] **Step 1: push(colon-refspec 锁远端分支名,防并行 session 干扰)**

```bash
git -C $WT push -u origin HEAD:lumo/LUM-351-token-usage-collapse
```

- [ ] **Step 2: 开 PR**

标题:`feat: collapsible token usage card on agent run tab [LUM-351]`
正文要点:零 schema、零新依赖、零新 i18n key;`TokenCostBreakdown` 加 `showTitle`(默认 true,Lineage/Run 卡视觉仅去横线+标题字体升级);默认收起的决策依据(用户拍板);HUMAN 验收项请在 preview 上看 1440px 收起行。PR checklist 全项核对。

```bash
gh pr create --title "feat: collapsible token usage card on agent run tab [LUM-351]" --body "..."
```

---

## Self-Review

- Spec coverage:折叠(Task 3)、微标题/横线清理含 Lineage 空态(Task 2)、共享 helper(Task 1)、不变式(零 key/零 schema,无新增 i18n)、测试两根全量(Task 4)——全覆盖。
- Placeholder:PR body 的 `"..."` 为执行时按要点现写,非代码占位。
- 类型一致性:`showTitle` 在 Task 2 定义、Task 3 以 `showTitle={false}` 消费;`fmtCompact`/`modelLabel` 签名(IntlShape)在 Task 1 定义、Task 3 消费,一致。
