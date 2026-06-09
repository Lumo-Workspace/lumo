# Delivery-Progress Empty-State Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the "交付进行中" (`ProgressView`) card has no forecast, render a neutral in-progress summary of signal-bearing cumulative actuals instead of collapsing to bare `运行次数 已1 / 澄清轮次 已0`.

**Architecture:** Single presentational component change. Each metric renders one of three ways — compare (forecast present, unchanged), summary line (no forecast but actual has signal), or hidden (no signal). Cohort metrics (`iterations`/`clarifyRounds`) are present-or-absent together; `tokenCost` is an independent track. No service/API/type/data changes — `progress.forecast` and `progress.*.actual` already carry everything.

**Tech Stack:** Next.js client component, react-intl, Jest + jsdom + @testing-library/react.

**Working dir:** `/Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-331-progress-empty-state` (branch `lumo/LUM-331-progress-empty-state`). Run all `git`/`jest`/`tsc` commands from INSIDE this worktree.

---

## File Structure

- Modify: `app/workspace/[workspaceUrl]/components/ProgressView.tsx` — add the no-forecast summary branch; keep the band + compare paths byte-for-byte behaviourally identical.
- Modify: `__tests__/components/ProgressView.test.tsx` — extend the inline `en` mock map with 3 new keys; add 4 test cases.
- Modify: all 16 `lib/i18n/*.json` — add `progress.summaryRuns` / `progress.summaryTokens` / `progress.summaryClarify`.

No new files. No new dependencies.

---

### Task 1: Failing tests for the no-forecast summary

**Files:**

- Test: `__tests__/components/ProgressView.test.tsx`

- [ ] **Step 1: Extend the inline `en` mock map**

In `__tests__/components/ProgressView.test.tsx`, add three entries to the `en` object (after `'progress.soFar'`):

```ts
  'progress.summaryRuns': '{value} runs so far',
  'progress.summaryTokens': '{value} tokens used',
  'progress.summaryClarify': '{value} clarification rounds',
```

- [ ] **Step 2: Add no-forecast fixtures + test cases**

Append to the end of the file:

```tsx
const noForecastWithToken: TaskProgress = {
  sessionCount: 1,
  forecast: {} as TaskProgress['forecast'],
  tokenCost: { forecast: null, actual: 12000, deltaPct: null, band: null },
  iterations: { forecast: null, actual: 1, deltaPct: null, band: null },
  clarifyRounds: { forecast: null, actual: 0, deltaPct: null, band: null },
}

const noForecastMinimal: TaskProgress = {
  ...noForecastWithToken,
  tokenCost: { forecast: null, actual: null, deltaPct: null, band: null },
}

const noForecastWithClarify: TaskProgress = {
  ...noForecastMinimal,
  clarifyRounds: { forecast: null, actual: 2, deltaPct: null, band: null },
}

it('renders an in-progress summary (runs + token) when there is no forecast', () => {
  render(<ProgressView progress={noForecastWithToken} agentStatus={null} />)
  expect(screen.getByText('1 runs so far')).toBeInTheDocument()
  expect(screen.getByText('12K tokens used')).toBeInTheDocument()
  // no compare framing
  expect(screen.queryByText('Progress')).not.toBeInTheDocument()
  expect(screen.queryByText('so far 1')).not.toBeInTheDocument()
  expect(screen.queryByText(/Forecast/)).not.toBeInTheDocument()
})

it('hides zero/no-signal metrics in summary mode (LUM-324 case)', () => {
  render(<ProgressView progress={noForecastMinimal} agentStatus={null} />)
  expect(screen.getByText('1 runs so far')).toBeInTheDocument()
  expect(screen.queryByText(/tokens used/)).not.toBeInTheDocument()
  expect(screen.queryByText(/clarification rounds/)).not.toBeInTheDocument()
  expect(screen.queryByText('Progress')).not.toBeInTheDocument()
})

it('shows the clarify summary line only when actual > 0', () => {
  render(<ProgressView progress={noForecastWithClarify} agentStatus={null} />)
  expect(screen.getByText('2 clarification rounds')).toBeInTheDocument()
})

it('does NOT render summary lines when a forecast is present', () => {
  render(<ProgressView progress={onTrack} agentStatus='WORKING' />)
  expect(screen.queryByText(/runs so far/)).not.toBeInTheDocument()
  expect(screen.queryByText(/tokens used/)).not.toBeInTheDocument()
  expect(screen.getByText('Progress')).toBeInTheDocument()
})
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-331-progress-empty-state && npx jest __tests__/components/ProgressView.test.tsx`
Expected: the 3 new "summary" tests FAIL (current `ProgressView` renders bare compare rows / the `Progress` section label, so `queryByText('Progress')` finds it and `getByText('1 runs so far')` finds nothing). The 4th ("does NOT render summary") and the 3 pre-existing tests PASS.

---

### Task 2: Implement the no-forecast summary branch in ProgressView

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/ProgressView.tsx`

- [ ] **Step 1: Replace the file with the summary-aware version**

Overwrite `app/workspace/[workspaceUrl]/components/ProgressView.tsx` with:

```tsx
'use client'

import type { ReactNode } from 'react'
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

// 无预测时的中性进行态摘要行：左对齐自然语言事实句，不走 forecast 对比框架。
function SummaryLine({ children }: { children: ReactNode }) {
  return (
    <li className='py-1 text-body-strong text-foreground tabular-nums'>
      {children}
    </li>
  )
}

/** 交付中态：活预测 + 累计 actual 的实时 burn 对比；无预测时降级为中性进行态摘要。 */
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
  const tokenOver = tokenCost.band === 'over'

  // token 是独立轨道；cohort 指标 iterations/clarifyRounds 同生同灭（判一个即可）。
  const hasTokenBand = !!tokenCost.forecast && tokenCost.actual !== null
  const hasCohortForecast = !!iterations.forecast
  const showTokenSummary =
    !hasTokenBand && tokenCost.actual !== null && tokenCost.actual > 0
  const showClarifySummary =
    clarifyRounds.actual !== null && clarifyRounds.actual > 0

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

      {hasTokenBand && tokenCost.forecast && (
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

      {hasCohortForecast ? (
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
      ) : (
        <ul className='border-t border-border pt-3'>
          <SummaryLine>
            {intl.formatMessage(
              { id: 'progress.summaryRuns' },
              { value: iterations.actual ?? 0 }
            )}
          </SummaryLine>
          {showTokenSummary && (
            <SummaryLine>
              {intl.formatMessage(
                { id: 'progress.summaryTokens' },
                { value: compact(intl, tokenCost.actual as number) }
              )}
            </SummaryLine>
          )}
          {showClarifySummary && (
            <SummaryLine>
              {intl.formatMessage(
                { id: 'progress.summaryClarify' },
                { value: clarifyRounds.actual as number }
              )}
            </SummaryLine>
          )}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Run the component tests to verify they pass**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-331-progress-empty-state && npx jest __tests__/components/ProgressView.test.tsx`
Expected: all 7 tests PASS.

- [ ] **Step 3: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-331-progress-empty-state add app/workspace/\[workspaceUrl\]/components/ProgressView.tsx __tests__/components/ProgressView.test.tsx
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-331-progress-empty-state commit -m "feat: in-progress summary fallback when delivery card has no forecast [LUM-331]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Add the 3 i18n keys across all 16 locales

**Files:**

- Modify: every `lib/i18n/*.json`

- [ ] **Step 1: Add keys to `en.json` and `zh-CN.json`**

In `lib/i18n/en.json`, after `"progress.soFar"`, add:

```json
  "progress.summaryRuns": "{value} runs so far",
  "progress.summaryTokens": "{value} tokens used",
  "progress.summaryClarify": "{value} clarification rounds",
```

In `lib/i18n/zh-CN.json`, after `"progress.soFar"`, add:

```json
  "progress.summaryRuns": "已运行 {value} 次",
  "progress.summaryTokens": "已用 {value} token",
  "progress.summaryClarify": "已澄清 {value} 轮",
```

> Watch JSON comma hygiene: if `progress.soFar` was the last key before a `}`, it needs a trailing comma added; the last of the 3 new keys must match the surrounding style.

- [ ] **Step 2: Add real translations to the other 14 locales**

Add the same 3 keys (place them next to the other `progress.*` keys) to each file with these values (`{value}` is a placeholder — keep it verbatim):

| locale        | summaryRuns                         | summaryTokens                  | summaryClarify                   |
| ------------- | ----------------------------------- | ------------------------------ | -------------------------------- |
| `de.json`     | `Bisher {value} Durchläufe`         | `{value} Tokens verwendet`     | `{value} Klärungsrunden`         |
| `en-AU.json`  | `{value} runs so far`               | `{value} tokens used`          | `{value} clarification rounds`   |
| `en-GB.json`  | `{value} runs so far`               | `{value} tokens used`          | `{value} clarification rounds`   |
| `es.json`     | `{value} ejecuciones hasta ahora`   | `{value} tokens usados`        | `{value} rondas de aclaración`   |
| `es-419.json` | `{value} ejecuciones hasta ahora`   | `{value} tokens usados`        | `{value} rondas de aclaración`   |
| `fr.json`     | `{value} exécutions jusqu'ici`      | `{value} tokens utilisés`      | `{value} tours de clarification` |
| `hi.json`     | `अब तक {value} रन`                  | `{value} टोकन उपयोग किए गए`    | `{value} स्पष्टीकरण दौर`         |
| `id.json`     | `{value} proses sejauh ini`         | `{value} token terpakai`       | `{value} putaran klarifikasi`    |
| `ja.json`     | `これまで {value} 回実行`           | `{value} トークン使用`         | `確認 {value} 回`                |
| `ko.json`     | `지금까지 {value}회 실행`           | `{value} 토큰 사용`            | `확인 {value}회`                 |
| `ms.json`     | `{value} larian setakat ini`        | `{value} token digunakan`      | `{value} pusingan penjelasan`    |
| `ru.json`     | `{value} запусков на данный момент` | `Использовано {value} токенов` | `{value} раундов уточнений`      |
| `vi.json`     | `{value} lần chạy đến nay`          | `Đã dùng {value} token`        | `{value} vòng làm rõ`            |
| `zh-TW.json`  | `已執行 {value} 次`                 | `已用 {value} token`           | `已澄清 {value} 輪`              |

- [ ] **Step 3: Verify locale parity (no drift, no missing keys, no `[TODO:…]`)**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-331-progress-empty-state && npm run i18n:check`
Expected: passes (all 16 locales have the 3 keys, none empty, no `[TODO]` markers).

Then run the parity Jest test:
Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-331-progress-empty-state && npx jest i18n`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-331-progress-empty-state add lib/i18n/
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-331-progress-empty-state commit -m "i18n: add progress.summary* keys across all 16 locales [LUM-331]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full Jest run from inside the worktree**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-331-progress-empty-state && npx jest`
Expected: all suites PASS (ProgressView + i18n parity + everything else green).

- [ ] **Step 2: Typecheck**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-331-progress-empty-state && npx tsc --noEmit`
Expected: no errors. (If it reports `TaskProgress`/Prisma-client phantom errors, run `npx prisma generate` once, then re-run — stale shared client, see project memory.)

- [ ] **Step 3: Token lint**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-331-progress-empty-state && npm run lint:tokens`
Expected: PASS (summary lines reuse existing `text-foreground` / `text-body-strong` tokens; no raw colors added).

- [ ] **Step 4: Update the mock to reflect the shipped order (optional sanity)**

The mock at `/tmp/lum-331-mock.html` shows runs-first; the implementation renders runs → token → clarify in summary mode, matching it. No action unless the rendered order diverges.

---

## Self-Review

**Spec coverage:**

- "无预测时丢掉 forecast 对比框架，改中性摘要" → Task 2 mode-B `<ul>` summary branch. ✓
- "只展示有真实信号的累计值，0 值/无信号不渲染" → `showTokenSummary` / `showClarifySummary` guards; runs always shown (≥1 invariant). ✓
- "有 forecast 时维持原有 band + over 行为不变" → band block + `hasCohortForecast` compare branch are byte-identical to current; Task 1 test 4 guards it. ✓
- "交付前/交付后/service/API 不动" → only ProgressView + tests + i18n touched. ✓
- "3 个 i18n key 全 16 locale，非 ICU plural" → Task 3 table covers all 16; values use plain `{value}`. ✓
- "四个测试用例" → Task 1 adds 4 (token summary / minimal / clarify / forecast-present negative). ✓

**Placeholder scan:** none — all code and translations are concrete.

**Type consistency:** `hasTokenBand`/`hasCohortForecast`/`showTokenSummary`/`showClarifySummary` defined once and used as written; `SummaryLine` takes `ReactNode`; `TaskProgress`/`ProgressMetric` match `progress-types.ts`. ✓
