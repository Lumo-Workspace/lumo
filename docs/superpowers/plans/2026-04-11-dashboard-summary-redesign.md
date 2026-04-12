# Dashboard & Project Summary Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Dashboard and Project Summary tab with a risk-aware briefing view backed by a deterministic rules engine and LLM narration, with workspace/project-level configurable risk thresholds.

**Architecture:** A new pure risk engine (`lib/summaries/risk.ts`) scores each project `healthy/watch/at-risk` from hard rules; aggregation (`lib/summaries/stats.ts`) injects the score and `topBlockers` into the summary stats blob; the LLM prompt shrinks to "narrate the pre-computed risk" producing a fixed two-section markdown (`## Today's Focus` / `## Risk`); a new `parseReport` helper feeds a new `BriefingCard` that replaces `SummaryReportCard`; Dashboard gains a `ProjectsAtGlanceList` (risk-sorted projects with filters), Project tab gains a `TopBlockersList`; both pages keep existing charts/stat cards/history. Workspace settings get a new "Risk thresholds" card, Project Overview sidebar gets an override card.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma (Neon Postgres), Jest (`__tests__/`), `generateObject` + `@ai-sdk/gateway`, react-intl, Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-04-11-dashboard-summary-redesign-design.md`

---

## Task Order Overview

Phase 1 — Foundation (types + Prisma migrations)
Phase 2 — Risk engine (pure, TDD)
Phase 3 — Stats integration (config threading)
Phase 4 — Report parsing (pure, TDD)
Phase 5 — LLM prompt rewrite
Phase 6 — Cron route update
Phase 7 — Validation schemas + workspace PATCH route
Phase 8 — Shared UI primitives (RiskBadge, BriefingCard)
Phase 9 — Dashboard components + page rewrite
Phase 10 — Project tab components + rewrite
Phase 11 — Settings UIs (Workspace + Project)
Phase 12 — i18n keys
Phase 13 — Cleanup (delete superseded components)

---

## Phase 1 — Foundation

### Task 1: Extend `types/summary.ts` with risk types

**Files:**

- Modify: `types/summary.ts`

- [ ] **Step 1: Replace the file with extended types**

Full new content of `types/summary.ts`:

```ts
export type RiskLevel = 'healthy' | 'watch' | 'at-risk'

export type RiskReasonCode =
  | 'overdue_ratio_high'
  | 'stalled_tasks'
  | 'agent_failure_rate'
  | 'stale_open_prs'
  | 'throughput_drop'

export interface RiskReason {
  code: RiskReasonCode
  detail: string
}

export interface RiskAssessment {
  level: RiskLevel
  score: number
  reasons: RiskReason[]
}

export interface TopBlockers {
  overdueTaskIds: string[]
  stalledTaskIds: string[]
  failingAgentTaskIds: string[]
  staleOpenPrNumbers: number[]
}

export interface TaskSummaryStats {
  totalTasks: number
  statusDistribution: Record<string, number>
  priorityDistribution: Record<string, number>
  overdueTasks: { count: number; taskIds: string[] }
  memberWorkload: Array<{
    actorId: string
    name: string
    assigned: number
    completed: number
  }>
  completionTrend: Array<{ date: string; completed: number }>
  avgCompletionTime: number | null
  subtaskCompletionRate: number | null
  agentStats: {
    total: number
    completed: number
    failed: number
    working: number
  }
  prStats: { total: number; merged: number; open: number }
  risk: RiskAssessment
  topBlockers: TopBlockers
}

export interface WorkspaceSummaryStats extends TaskSummaryStats {
  projectBreakdown: Array<{
    projectId: string
    projectName: string
    totalTasks: number
    completedTasks: number
    overdueTasks: number
    risk: RiskAssessment
  }>
}

export interface ApiProjectSummary {
  id: string
  projectId: string
  stats: TaskSummaryStats
  tldr: string
  report: string
  generatedAt: string
}

export interface ApiWorkspaceSummary {
  id: string
  workspaceId: string
  stats: WorkspaceSummaryStats
  tldr: string
  report: string
  generatedAt: string
}
```

- [ ] **Step 2: Verify compile (expect downstream breaks)**

Run: `npx tsc --noEmit 2>&1 | head -40`
Expected: several errors in `lib/summaries/stats.ts`, `lib/summaries/report.ts`, and UI files that reference `stats` — these will be fixed in later tasks. This step is to confirm the types file itself parses.

- [ ] **Step 3: Commit**

```bash
git add types/summary.ts
git commit -m "feat: add risk types to summary domain [LUM-SUMMARY]"
```

---

### Task 2: Prisma migration — workspace risk thresholds

**Files:**

- Modify: `prisma/schema.prisma` (Workspace model, after line 162)
- Create: `prisma/migrations/20260411000000_add_workspace_risk_thresholds/migration.sql`

- [ ] **Step 1: Add 6 columns to `Workspace` model**

In `prisma/schema.prisma`, after the existing `summaryLocale` line inside `model Workspace`:

```prisma
  summaryFrequency SummaryFrequency @default(DAILY)
  summaryEnabled   Boolean          @default(true)
  summaryLocale    String           @default("en")

  riskOverdueRatio    Float @default(0.25)
  riskStalledDays     Int   @default(7)
  riskStalledMinCount Int   @default(3)
  riskAgentFailRatio  Float @default(0.30)
  riskStalePrDays     Int   @default(3)
  riskThroughputDrop  Float @default(0.50)
```

- [ ] **Step 2: Create migration directory and SQL**

Create `prisma/migrations/20260411000000_add_workspace_risk_thresholds/migration.sql`:

```sql
ALTER TABLE "workspaces" ADD COLUMN "riskOverdueRatio"    DOUBLE PRECISION NOT NULL DEFAULT 0.25;
ALTER TABLE "workspaces" ADD COLUMN "riskStalledDays"     INTEGER          NOT NULL DEFAULT 7;
ALTER TABLE "workspaces" ADD COLUMN "riskStalledMinCount" INTEGER          NOT NULL DEFAULT 3;
ALTER TABLE "workspaces" ADD COLUMN "riskAgentFailRatio"  DOUBLE PRECISION NOT NULL DEFAULT 0.30;
ALTER TABLE "workspaces" ADD COLUMN "riskStalePrDays"     INTEGER          NOT NULL DEFAULT 3;
ALTER TABLE "workspaces" ADD COLUMN "riskThroughputDrop"  DOUBLE PRECISION NOT NULL DEFAULT 0.50;
```

- [ ] **Step 3: Apply migration locally**

Run: `npx prisma migrate deploy && npx prisma generate`
Expected: "1 migration applied" and client regenerated.

- [ ] **Step 4: Verify client has new fields**

Run: `grep -c "riskOverdueRatio" node_modules/.prisma/client/index.d.ts`
Expected: a number > 0.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260411000000_add_workspace_risk_thresholds
git commit -m "feat: add workspace risk threshold columns [LUM-SUMMARY]"
```

---

### Task 3: Prisma migration — project risk overrides

**Files:**

- Modify: `prisma/schema.prisma` (Project model)
- Create: `prisma/migrations/20260411000100_add_project_risk_overrides/migration.sql`

- [ ] **Step 1: Add 6 nullable columns to `Project` model**

In `prisma/schema.prisma`, inside `model Project`, after the `updatedAt` line (line 287):

```prisma
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  riskOverdueRatio    Float?
  riskStalledDays     Int?
  riskStalledMinCount Int?
  riskAgentFailRatio  Float?
  riskStalePrDays     Int?
  riskThroughputDrop  Float?
```

- [ ] **Step 2: Create migration directory and SQL**

Create `prisma/migrations/20260411000100_add_project_risk_overrides/migration.sql`:

```sql
ALTER TABLE "projects" ADD COLUMN "riskOverdueRatio"    DOUBLE PRECISION;
ALTER TABLE "projects" ADD COLUMN "riskStalledDays"     INTEGER;
ALTER TABLE "projects" ADD COLUMN "riskStalledMinCount" INTEGER;
ALTER TABLE "projects" ADD COLUMN "riskAgentFailRatio"  DOUBLE PRECISION;
ALTER TABLE "projects" ADD COLUMN "riskStalePrDays"     INTEGER;
ALTER TABLE "projects" ADD COLUMN "riskThroughputDrop"  DOUBLE PRECISION;
```

- [ ] **Step 3: Apply migration and regenerate client**

Run: `npx prisma migrate deploy && npx prisma generate`
Expected: "1 migration applied".

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260411000100_add_project_risk_overrides
git commit -m "feat: add project risk override columns [LUM-SUMMARY]"
```

---

## Phase 2 — Risk Engine (pure, TDD)

### Task 4: Scaffold `lib/summaries/risk.ts` with constants and `resolveEffectiveRiskConfig`

**Files:**

- Create: `lib/summaries/risk.ts`
- Create: `__tests__/summaries/resolve-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/summaries/resolve-config.test.ts`:

```ts
import {
  DEFAULT_RISK_CONFIG,
  resolveEffectiveRiskConfig,
  type RiskConfig,
} from '@/lib/summaries/risk'

const workspace = {
  riskOverdueRatio: 0.2,
  riskStalledDays: 5,
  riskStalledMinCount: 2,
  riskAgentFailRatio: 0.35,
  riskStalePrDays: 4,
  riskThroughputDrop: 0.4,
}

describe('resolveEffectiveRiskConfig', () => {
  it('returns workspace values when project is null', () => {
    expect(resolveEffectiveRiskConfig(workspace, null)).toEqual<RiskConfig>({
      overdueRatio: 0.2,
      stalledDays: 5,
      stalledMinCount: 2,
      agentFailRatio: 0.35,
      stalePrDays: 4,
      throughputDrop: 0.4,
    })
  })

  it('returns workspace values when project has all nulls', () => {
    const project = {
      riskOverdueRatio: null,
      riskStalledDays: null,
      riskStalledMinCount: null,
      riskAgentFailRatio: null,
      riskStalePrDays: null,
      riskThroughputDrop: null,
    }
    expect(resolveEffectiveRiskConfig(workspace, project)).toEqual({
      overdueRatio: 0.2,
      stalledDays: 5,
      stalledMinCount: 2,
      agentFailRatio: 0.35,
      stalePrDays: 4,
      throughputDrop: 0.4,
    })
  })

  it('per-field project override wins over workspace value', () => {
    const project = {
      riskOverdueRatio: 0.8,
      riskStalledDays: null,
      riskStalledMinCount: null,
      riskAgentFailRatio: null,
      riskStalePrDays: null,
      riskThroughputDrop: 0.1,
    }
    const resolved = resolveEffectiveRiskConfig(workspace, project)
    expect(resolved.overdueRatio).toBe(0.8)
    expect(resolved.throughputDrop).toBe(0.1)
    expect(resolved.stalledDays).toBe(5)
  })

  it('DEFAULT_RISK_CONFIG matches the documented defaults', () => {
    expect(DEFAULT_RISK_CONFIG).toEqual({
      overdueRatio: 0.25,
      stalledDays: 7,
      stalledMinCount: 3,
      agentFailRatio: 0.3,
      stalePrDays: 3,
      throughputDrop: 0.5,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/summaries/resolve-config.test.ts`
Expected: FAIL — cannot resolve `@/lib/summaries/risk`.

- [ ] **Step 3: Create `lib/summaries/risk.ts` with scaffolding**

Create `lib/summaries/risk.ts`:

```ts
import type {
  RiskAssessment,
  RiskLevel,
  RiskReason,
  RiskReasonCode,
  TaskSummaryStats,
  TopBlockers,
} from '@/types/summary'

export interface RiskConfig {
  overdueRatio: number
  stalledDays: number
  stalledMinCount: number
  agentFailRatio: number
  stalePrDays: number
  throughputDrop: number
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  overdueRatio: 0.25,
  stalledDays: 7,
  stalledMinCount: 3,
  agentFailRatio: 0.3,
  stalePrDays: 3,
  throughputDrop: 0.5,
}

const RISK_WEIGHTS: Record<RiskReasonCode, number> = {
  overdue_ratio_high: 3,
  stalled_tasks: 2,
  agent_failure_rate: 2,
  stale_open_prs: 1,
  throughput_drop: 2,
}

const RISK_BANDS = { HEALTHY_MAX: 2, WATCH_MAX: 4 } as const

interface WorkspaceRiskFields {
  riskOverdueRatio: number
  riskStalledDays: number
  riskStalledMinCount: number
  riskAgentFailRatio: number
  riskStalePrDays: number
  riskThroughputDrop: number
}

interface ProjectRiskFields {
  riskOverdueRatio: number | null
  riskStalledDays: number | null
  riskStalledMinCount: number | null
  riskAgentFailRatio: number | null
  riskStalePrDays: number | null
  riskThroughputDrop: number | null
}

export function resolveEffectiveRiskConfig(
  workspace: WorkspaceRiskFields,
  project: ProjectRiskFields | null
): RiskConfig {
  return {
    overdueRatio: project?.riskOverdueRatio ?? workspace.riskOverdueRatio,
    stalledDays: project?.riskStalledDays ?? workspace.riskStalledDays,
    stalledMinCount:
      project?.riskStalledMinCount ?? workspace.riskStalledMinCount,
    agentFailRatio: project?.riskAgentFailRatio ?? workspace.riskAgentFailRatio,
    stalePrDays: project?.riskStalePrDays ?? workspace.riskStalePrDays,
    throughputDrop: project?.riskThroughputDrop ?? workspace.riskThroughputDrop,
  }
}

// Placeholder exports — implemented in subsequent tasks.
export interface RiskSignals {
  stalledTaskCount: number
  staleOpenPrCount: number
  last7dCompleted: number
  prev7dCompleted: number
}

export function computeRisk(
  _stats: TaskSummaryStats,
  _signals: RiskSignals,
  _config: RiskConfig
): RiskAssessment {
  throw new Error('computeRisk not implemented')
}

export function collectTopBlockers(_input: {
  tasks: Array<{
    id: string
    status: string
    dueDate: Date | null
    updatedAt: Date
  }>
  agents: Array<{ taskId: string; agentStatus: string | null }>
  prs: Array<{ number: number; state: string; createdAt: Date }>
  now: Date
  config: RiskConfig
}): TopBlockers {
  throw new Error('collectTopBlockers not implemented')
}

// Exported helpers used by aggregate workspace risk computation
export function worseLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  const order: Record<RiskLevel, number> = {
    healthy: 0,
    watch: 1,
    'at-risk': 2,
  }
  return order[a] >= order[b] ? a : b
}

export function levelFromScore(score: number): RiskLevel {
  if (score <= RISK_BANDS.HEALTHY_MAX) return 'healthy'
  if (score <= RISK_BANDS.WATCH_MAX) return 'watch'
  return 'at-risk'
}

// Internal utilities (exported so tests can exercise weighted rule list)
export const INTERNAL = { RISK_WEIGHTS, RISK_BANDS }

// Re-exports for convenience
export type { RiskReason, RiskReasonCode, RiskAssessment, TopBlockers }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/summaries/resolve-config.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/summaries/risk.ts __tests__/summaries/resolve-config.test.ts
git commit -m "feat: scaffold risk engine with resolveEffectiveRiskConfig [LUM-SUMMARY]"
```

---

### Task 5: Implement `computeRisk` with all 5 rules

**Files:**

- Create: `__tests__/summaries/risk.test.ts`
- Modify: `lib/summaries/risk.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/summaries/risk.test.ts`:

```ts
import {
  computeRisk,
  DEFAULT_RISK_CONFIG,
  levelFromScore,
  type RiskSignals,
} from '@/lib/summaries/risk'
import type { TaskSummaryStats } from '@/types/summary'

function makeStats(
  overrides: Partial<TaskSummaryStats> = {}
): TaskSummaryStats {
  return {
    totalTasks: 20,
    statusDistribution: {},
    priorityDistribution: {},
    overdueTasks: { count: 0, taskIds: [] },
    memberWorkload: [],
    completionTrend: [],
    avgCompletionTime: null,
    subtaskCompletionRate: null,
    agentStats: { total: 0, completed: 0, failed: 0, working: 0 },
    prStats: { total: 0, merged: 0, open: 0 },
    risk: { level: 'healthy', score: 0, reasons: [] },
    topBlockers: {
      overdueTaskIds: [],
      stalledTaskIds: [],
      failingAgentTaskIds: [],
      staleOpenPrNumbers: [],
    },
    ...overrides,
  }
}

const emptySignals: RiskSignals = {
  stalledTaskCount: 0,
  staleOpenPrCount: 0,
  last7dCompleted: 0,
  prev7dCompleted: 0,
}

describe('computeRisk', () => {
  it('returns healthy with no reasons when nothing triggers', () => {
    const result = computeRisk(makeStats(), emptySignals, DEFAULT_RISK_CONFIG)
    expect(result.level).toBe('healthy')
    expect(result.score).toBe(0)
    expect(result.reasons).toEqual([])
  })

  it('triggers overdue_ratio_high at exactly the threshold', () => {
    const stats = makeStats({
      totalTasks: 20,
      overdueTasks: { count: 5, taskIds: [] }, // 5/20 = 0.25
    })
    const result = computeRisk(stats, emptySignals, DEFAULT_RISK_CONFIG)
    expect(result.reasons.map(r => r.code)).toContain('overdue_ratio_high')
    expect(result.score).toBe(3)
    expect(result.level).toBe('watch')
  })

  it('does not trigger overdue_ratio_high below threshold', () => {
    const stats = makeStats({
      totalTasks: 20,
      overdueTasks: { count: 4, taskIds: [] }, // 0.20
    })
    const result = computeRisk(stats, emptySignals, DEFAULT_RISK_CONFIG)
    expect(result.reasons.map(r => r.code)).not.toContain('overdue_ratio_high')
  })

  it('guards against totalTasks=0 for overdue_ratio_high', () => {
    const stats = makeStats({
      totalTasks: 0,
      overdueTasks: { count: 0, taskIds: [] },
    })
    const result = computeRisk(stats, emptySignals, DEFAULT_RISK_CONFIG)
    expect(result.level).toBe('healthy')
  })

  it('triggers stalled_tasks when stalledTaskCount >= stalledMinCount', () => {
    const result = computeRisk(
      makeStats(),
      { ...emptySignals, stalledTaskCount: 3 },
      DEFAULT_RISK_CONFIG
    )
    expect(result.reasons.map(r => r.code)).toContain('stalled_tasks')
    expect(result.score).toBe(2)
  })

  it('does not trigger stalled_tasks below stalledMinCount', () => {
    const result = computeRisk(
      makeStats(),
      { ...emptySignals, stalledTaskCount: 2 },
      DEFAULT_RISK_CONFIG
    )
    expect(result.reasons.map(r => r.code)).not.toContain('stalled_tasks')
  })

  it('triggers agent_failure_rate when total >= 3 and failed/total >= ratio', () => {
    const stats = makeStats({
      agentStats: { total: 10, completed: 5, failed: 3, working: 2 }, // 30%
    })
    const result = computeRisk(stats, emptySignals, DEFAULT_RISK_CONFIG)
    expect(result.reasons.map(r => r.code)).toContain('agent_failure_rate')
  })

  it('does not trigger agent_failure_rate when total < 3', () => {
    const stats = makeStats({
      agentStats: { total: 2, completed: 0, failed: 2, working: 0 },
    })
    const result = computeRisk(stats, emptySignals, DEFAULT_RISK_CONFIG)
    expect(result.reasons.map(r => r.code)).not.toContain('agent_failure_rate')
  })

  it('triggers stale_open_prs when staleOpenPrCount >= 1', () => {
    const result = computeRisk(
      makeStats(),
      { ...emptySignals, staleOpenPrCount: 1 },
      DEFAULT_RISK_CONFIG
    )
    expect(result.reasons.map(r => r.code)).toContain('stale_open_prs')
    expect(result.score).toBe(1)
  })

  it('triggers throughput_drop when last7 <= prev7 * throughputDrop', () => {
    const result = computeRisk(
      makeStats(),
      {
        ...emptySignals,
        prev7dCompleted: 10,
        last7dCompleted: 5, // 50% of 10, at threshold
      },
      DEFAULT_RISK_CONFIG
    )
    expect(result.reasons.map(r => r.code)).toContain('throughput_drop')
  })

  it('does not trigger throughput_drop when prev7 is zero', () => {
    const result = computeRisk(
      makeStats(),
      { ...emptySignals, prev7dCompleted: 0, last7dCompleted: 0 },
      DEFAULT_RISK_CONFIG
    )
    expect(result.reasons.map(r => r.code)).not.toContain('throughput_drop')
  })

  it('escalates to at-risk when total score >= 5', () => {
    // overdue (3) + stalled (2) = 5
    const stats = makeStats({
      totalTasks: 20,
      overdueTasks: { count: 10, taskIds: [] },
    })
    const result = computeRisk(
      stats,
      { ...emptySignals, stalledTaskCount: 3 },
      DEFAULT_RISK_CONFIG
    )
    expect(result.score).toBe(5)
    expect(result.level).toBe('at-risk')
  })

  it('detail string cites specific numbers for overdue_ratio_high', () => {
    const stats = makeStats({
      totalTasks: 20,
      overdueTasks: { count: 7, taskIds: [] },
    })
    const result = computeRisk(stats, emptySignals, DEFAULT_RISK_CONFIG)
    const reason = result.reasons.find(r => r.code === 'overdue_ratio_high')
    expect(reason?.detail).toContain('7/20')
    expect(reason?.detail).toContain('35%')
  })
})

describe('levelFromScore', () => {
  it('maps 0,1,2 to healthy', () => {
    expect(levelFromScore(0)).toBe('healthy')
    expect(levelFromScore(2)).toBe('healthy')
  })
  it('maps 3,4 to watch', () => {
    expect(levelFromScore(3)).toBe('watch')
    expect(levelFromScore(4)).toBe('watch')
  })
  it('maps 5+ to at-risk', () => {
    expect(levelFromScore(5)).toBe('at-risk')
    expect(levelFromScore(99)).toBe('at-risk')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/summaries/risk.test.ts`
Expected: FAIL — `computeRisk not implemented`.

- [ ] **Step 3: Replace `computeRisk` implementation in `lib/summaries/risk.ts`**

Replace the placeholder `computeRisk` function:

```ts
export function computeRisk(
  stats: TaskSummaryStats,
  signals: RiskSignals,
  config: RiskConfig
): RiskAssessment {
  const reasons: RiskReason[] = []

  // Rule 1: overdue_ratio_high
  if (stats.totalTasks > 0) {
    const ratio = stats.overdueTasks.count / stats.totalTasks
    if (ratio >= config.overdueRatio) {
      const pct = Math.round(ratio * 100)
      reasons.push({
        code: 'overdue_ratio_high',
        detail: `${stats.overdueTasks.count}/${stats.totalTasks} tasks overdue (${pct}%)`,
      })
    }
  }

  // Rule 2: stalled_tasks
  if (signals.stalledTaskCount >= config.stalledMinCount) {
    reasons.push({
      code: 'stalled_tasks',
      detail: `${signals.stalledTaskCount} tasks with no progress in ${config.stalledDays} days`,
    })
  }

  // Rule 3: agent_failure_rate
  if (stats.agentStats.total >= 3) {
    const failRatio = stats.agentStats.failed / stats.agentStats.total
    if (failRatio >= config.agentFailRatio) {
      const pct = Math.round(failRatio * 100)
      reasons.push({
        code: 'agent_failure_rate',
        detail: `Agent failure rate ${pct}% (${stats.agentStats.failed}/${stats.agentStats.total})`,
      })
    }
  }

  // Rule 4: stale_open_prs
  if (signals.staleOpenPrCount >= 1) {
    reasons.push({
      code: 'stale_open_prs',
      detail: `${signals.staleOpenPrCount} PRs waiting > ${config.stalePrDays} days for review`,
    })
  }

  // Rule 5: throughput_drop
  if (signals.prev7dCompleted > 0) {
    const threshold = signals.prev7dCompleted * config.throughputDrop
    if (signals.last7dCompleted <= threshold) {
      const dropPct = Math.round(
        (1 - signals.last7dCompleted / signals.prev7dCompleted) * 100
      )
      reasons.push({
        code: 'throughput_drop',
        detail: `Completion dropped ${dropPct}% week-over-week`,
      })
    }
  }

  const score = reasons.reduce((sum, r) => sum + RISK_WEIGHTS[r.code], 0)
  return { level: levelFromScore(score), score, reasons }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/summaries/risk.test.ts`
Expected: PASS — all 14 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/summaries/risk.ts __tests__/summaries/risk.test.ts
git commit -m "feat: implement computeRisk with 5 deterministic rules [LUM-SUMMARY]"
```

---

### Task 6: Config-override test — verify per-workspace thresholds bend the outcome

**Files:**

- Create: `__tests__/summaries/risk-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/summaries/risk-config.test.ts`:

```ts
import {
  computeRisk,
  DEFAULT_RISK_CONFIG,
  type RiskConfig,
  type RiskSignals,
} from '@/lib/summaries/risk'
import type { TaskSummaryStats } from '@/types/summary'

function statsWithOverdue(total: number, overdue: number): TaskSummaryStats {
  return {
    totalTasks: total,
    statusDistribution: {},
    priorityDistribution: {},
    overdueTasks: { count: overdue, taskIds: [] },
    memberWorkload: [],
    completionTrend: [],
    avgCompletionTime: null,
    subtaskCompletionRate: null,
    agentStats: { total: 0, completed: 0, failed: 0, working: 0 },
    prStats: { total: 0, merged: 0, open: 0 },
    risk: { level: 'healthy', score: 0, reasons: [] },
    topBlockers: {
      overdueTaskIds: [],
      stalledTaskIds: [],
      failingAgentTaskIds: [],
      staleOpenPrNumbers: [],
    },
  }
}

const emptySignals: RiskSignals = {
  stalledTaskCount: 0,
  staleOpenPrCount: 0,
  last7dCompleted: 0,
  prev7dCompleted: 0,
}

describe('computeRisk with custom config', () => {
  it('same stats become healthy under lenient overdueRatio', () => {
    const stats = statsWithOverdue(20, 5) // 25%
    const lenient: RiskConfig = { ...DEFAULT_RISK_CONFIG, overdueRatio: 0.5 }
    expect(computeRisk(stats, emptySignals, lenient).level).toBe('healthy')
  })

  it('same stats become watch under strict overdueRatio', () => {
    const stats = statsWithOverdue(20, 3) // 15%
    const strict: RiskConfig = { ...DEFAULT_RISK_CONFIG, overdueRatio: 0.1 }
    expect(computeRisk(stats, emptySignals, strict).level).toBe('watch')
  })

  it('stalledMinCount override changes whether rule triggers', () => {
    const lax: RiskConfig = { ...DEFAULT_RISK_CONFIG, stalledMinCount: 10 }
    const result = computeRisk(
      statsWithOverdue(20, 0),
      { ...emptySignals, stalledTaskCount: 5 },
      lax
    )
    expect(result.reasons.map(r => r.code)).not.toContain('stalled_tasks')
  })

  it('custom throughputDrop changes when rule triggers', () => {
    const strict: RiskConfig = { ...DEFAULT_RISK_CONFIG, throughputDrop: 0.9 }
    // last7=8, prev7=10, ratio=0.8, strict threshold=0.9 → triggers
    const result = computeRisk(
      statsWithOverdue(20, 0),
      { ...emptySignals, prev7dCompleted: 10, last7dCompleted: 8 },
      strict
    )
    expect(result.reasons.map(r => r.code)).toContain('throughput_drop')
  })
})
```

- [ ] **Step 2: Run test to verify it passes immediately**

Run: `npx jest __tests__/summaries/risk-config.test.ts`
Expected: PASS — 4 tests (implementation already handles config correctly, this test locks in the contract).

- [ ] **Step 3: Commit**

```bash
git add __tests__/summaries/risk-config.test.ts
git commit -m "test: verify per-workspace risk config overrides [LUM-SUMMARY]"
```

---

### Task 7: Implement `collectTopBlockers`

**Files:**

- Modify: `lib/summaries/risk.ts`
- Create: `__tests__/summaries/top-blockers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/summaries/top-blockers.test.ts`:

```ts
import { collectTopBlockers, DEFAULT_RISK_CONFIG } from '@/lib/summaries/risk'

const NOW = new Date('2026-04-11T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000)

describe('collectTopBlockers', () => {
  it('returns empty groups when nothing triggers', () => {
    const result = collectTopBlockers({
      tasks: [],
      agents: [],
      prs: [],
      now: NOW,
      config: DEFAULT_RISK_CONFIG,
    })
    expect(result).toEqual({
      overdueTaskIds: [],
      stalledTaskIds: [],
      failingAgentTaskIds: [],
      staleOpenPrNumbers: [],
    })
  })

  it('collects overdue tasks (dueDate < now && status != DONE)', () => {
    const result = collectTopBlockers({
      tasks: [
        {
          id: 't1',
          status: 'IN_PROGRESS',
          dueDate: daysAgo(2),
          updatedAt: daysAgo(1),
        },
        {
          id: 't2',
          status: 'DONE',
          dueDate: daysAgo(5),
          updatedAt: daysAgo(1),
        },
        {
          id: 't3',
          status: 'TODO',
          dueDate: null,
          updatedAt: daysAgo(1),
        },
      ],
      agents: [],
      prs: [],
      now: NOW,
      config: DEFAULT_RISK_CONFIG,
    })
    expect(result.overdueTaskIds).toEqual(['t1'])
  })

  it('collects stalled tasks (not DONE/CANCELLED and updatedAt older than stalledDays)', () => {
    const result = collectTopBlockers({
      tasks: [
        {
          id: 'a',
          status: 'IN_PROGRESS',
          dueDate: null,
          updatedAt: daysAgo(10),
        },
        { id: 'b', status: 'TODO', dueDate: null, updatedAt: daysAgo(3) },
        { id: 'c', status: 'DONE', dueDate: null, updatedAt: daysAgo(20) },
      ],
      agents: [],
      prs: [],
      now: NOW,
      config: DEFAULT_RISK_CONFIG, // stalledDays = 7
    })
    expect(result.stalledTaskIds).toEqual(['a'])
  })

  it('collects failing agent task ids', () => {
    const result = collectTopBlockers({
      tasks: [],
      agents: [
        { taskId: 'x', agentStatus: 'FAILED' },
        { taskId: 'y', agentStatus: 'COMPLETED' },
        { taskId: 'z', agentStatus: 'FAILED' },
      ],
      prs: [],
      now: NOW,
      config: DEFAULT_RISK_CONFIG,
    })
    expect(result.failingAgentTaskIds).toEqual(['x', 'z'])
  })

  it('collects stale open PR numbers by age', () => {
    const result = collectTopBlockers({
      tasks: [],
      agents: [],
      prs: [
        { number: 1, state: 'open', createdAt: daysAgo(5) },
        { number: 2, state: 'open', createdAt: daysAgo(1) },
        { number: 3, state: 'merged', createdAt: daysAgo(30) },
      ],
      now: NOW,
      config: DEFAULT_RISK_CONFIG, // stalePrDays = 3
    })
    expect(result.staleOpenPrNumbers).toEqual([1])
  })

  it('caps each group at 10 items', () => {
    const tasks = Array.from({ length: 15 }, (_, i) => ({
      id: `t${i}`,
      status: 'IN_PROGRESS',
      dueDate: daysAgo(2),
      updatedAt: daysAgo(1),
    }))
    const result = collectTopBlockers({
      tasks,
      agents: [],
      prs: [],
      now: NOW,
      config: DEFAULT_RISK_CONFIG,
    })
    expect(result.overdueTaskIds).toHaveLength(10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/summaries/top-blockers.test.ts`
Expected: FAIL — `collectTopBlockers not implemented`.

- [ ] **Step 3: Implement `collectTopBlockers`**

Replace the placeholder in `lib/summaries/risk.ts`:

```ts
export function collectTopBlockers(input: {
  tasks: Array<{
    id: string
    status: string
    dueDate: Date | null
    updatedAt: Date
  }>
  agents: Array<{ taskId: string; agentStatus: string | null }>
  prs: Array<{ number: number; state: string; createdAt: Date }>
  now: Date
  config: RiskConfig
}): TopBlockers {
  const { tasks, agents, prs, now, config } = input
  const cap = <T>(arr: T[]) => arr.slice(0, 10)

  const stalledCutoff = new Date(
    now.getTime() - config.stalledDays * 24 * 60 * 60 * 1000
  )
  const stalePrCutoff = new Date(
    now.getTime() - config.stalePrDays * 24 * 60 * 60 * 1000
  )

  const overdueTaskIds = cap(
    tasks
      .filter(t => t.dueDate !== null && t.dueDate < now && t.status !== 'DONE')
      .map(t => t.id)
  )

  const stalledTaskIds = cap(
    tasks
      .filter(
        t =>
          t.status !== 'DONE' &&
          t.status !== 'CANCELLED' &&
          t.updatedAt < stalledCutoff
      )
      .map(t => t.id)
  )

  const failingAgentTaskIds = cap(
    agents.filter(a => a.agentStatus === 'FAILED').map(a => a.taskId)
  )

  const staleOpenPrNumbers = cap(
    prs
      .filter(p => p.state === 'open' && p.createdAt < stalePrCutoff)
      .map(p => p.number)
  )

  return {
    overdueTaskIds,
    stalledTaskIds,
    failingAgentTaskIds,
    staleOpenPrNumbers,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/summaries/top-blockers.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/summaries/risk.ts __tests__/summaries/top-blockers.test.ts
git commit -m "feat: implement collectTopBlockers helper [LUM-SUMMARY]"
```

---

## Phase 3 — Stats Integration

### Task 8: Thread `RiskConfig` through `aggregateProjectStats`

**Files:**

- Modify: `lib/summaries/stats.ts`
- Create: `__tests__/summaries/stats.test.ts`

Design note: For v1 we use `task.updatedAt` as a proxy for "no status change in N days" because there is no `statusChangedAt` column on `Task`. This matches the spec's accepted degradation pattern and keeps the rule transparent.

- [ ] **Step 1: Write the failing test**

Create `__tests__/summaries/stats.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { aggregateProjectStats } from '@/lib/summaries/stats'
import { DEFAULT_RISK_CONFIG } from '@/lib/summaries/risk'

// We exercise the signature only, without a real DB — mock prisma.
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    pullRequest: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    actor: { findMany: jest.fn().mockResolvedValue([]) },
  },
}))

describe('aggregateProjectStats signature', () => {
  it('accepts a RiskConfig argument and returns risk+topBlockers in result', async () => {
    const result = await aggregateProjectStats('proj_1', DEFAULT_RISK_CONFIG)
    expect(result.risk).toBeDefined()
    expect(result.risk.level).toBe('healthy')
    expect(result.topBlockers).toBeDefined()
    expect(result.topBlockers.overdueTaskIds).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/summaries/stats.test.ts`
Expected: FAIL — either signature mismatch or missing risk field.

- [ ] **Step 3: Update `aggregateProjectStats` signature and implementation**

Edit `lib/summaries/stats.ts`. Change the function signature and add risk/topBlockers assembly. Full replacement of the `aggregateProjectStats` function:

```ts
export async function aggregateProjectStats(
  projectId: string,
  config: RiskConfig
): Promise<TaskSummaryStats> {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

  const [
    statusGroups,
    priorityGroups,
    overdueTasks,
    assigneeGroups,
    doneTasks,
    subtasks,
    agentGroups,
    prTotal,
    prMerged,
    prOpen,
    completedRecently,
    // New queries for risk signals and top blockers
    stalledCandidates,
    failingAgentTasks,
    openPrs,
  ] = await Promise.all([
    prisma.task.groupBy({
      by: ['status'],
      where: { projectId },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['priority'],
      where: { projectId },
      _count: { _all: true },
    }),
    prisma.task.findMany({
      where: {
        projectId,
        dueDate: { lt: now },
        status: { not: 'DONE' },
      },
      select: { id: true },
    }),
    prisma.task.groupBy({
      by: ['assigneeActorId', 'status'],
      where: {
        projectId,
        assigneeActorId: { not: null },
      },
      _count: { _all: true },
    }),
    prisma.task.findMany({
      where: { projectId, status: 'DONE' },
      select: { createdAt: true, updatedAt: true },
    }),
    prisma.task.findMany({
      where: {
        projectId,
        parentTaskId: { not: null },
      },
      select: { status: true },
    }),
    prisma.task.groupBy({
      by: ['agentStatus'],
      where: {
        projectId,
        agentStatus: { not: null },
      },
      _count: { _all: true },
    }),
    prisma.pullRequest.count({ where: { task: { projectId } } }),
    prisma.pullRequest.count({
      where: { task: { projectId }, state: 'merged' },
    }),
    prisma.pullRequest.count({
      where: { task: { projectId }, state: 'open' },
    }),
    prisma.task.findMany({
      where: {
        projectId,
        status: 'DONE',
        updatedAt: {
          gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      select: { updatedAt: true },
    }),
    // Stalled candidates: not done/cancelled, updated before stalledDays cutoff
    prisma.task.findMany({
      where: {
        projectId,
        status: { notIn: ['DONE'] },
        updatedAt: {
          lt: new Date(
            now.getTime() - config.stalledDays * 24 * 60 * 60 * 1000
          ),
        },
      },
      select: {
        id: true,
        status: true,
        dueDate: true,
        updatedAt: true,
      },
    }),
    // Failing agent tasks (for top blockers)
    prisma.task.findMany({
      where: { projectId, agentStatus: 'FAILED' },
      select: { id: true, agentStatus: true },
    }),
    // Open PRs (for stale PR signal + top blockers)
    prisma.pullRequest.findMany({
      where: { task: { projectId }, state: 'open' },
      select: { number: true, state: true, createdAt: true },
    }),
  ])

  const statusDistribution: Record<string, number> = {}
  let totalTasks = 0
  for (const g of statusGroups) {
    const count = g._count._all
    statusDistribution[g.status] = count
    totalTasks += count
  }

  const priorityDistribution: Record<string, number> = {}
  for (const g of priorityGroups) {
    priorityDistribution[g.priority] = g._count._all
  }

  const overdueTaskIds = overdueTasks.map(t => t.id)

  const actorIdSet = new Set(
    (assigneeGroups as Array<{ assigneeActorId: string | null }>)
      .map(g => g.assigneeActorId)
      .filter((id): id is string => id !== null)
  )

  const actors =
    actorIdSet.size > 0
      ? await prisma.actor.findMany({
          where: { id: { in: Array.from(actorIdSet) } },
          select: {
            id: true,
            type: true,
            member: { select: { clerkId: true } },
            agent: { select: { name: true } },
          },
        })
      : []

  const actorNameMap = new Map<string, string>()
  for (const actor of actors) {
    const name =
      actor.type === 'AGENT' && actor.agent
        ? actor.agent.name
        : (actor.member?.clerkId ?? actor.id)
    actorNameMap.set(actor.id, name)
  }

  const workloadMap = new Map<string, { assigned: number; completed: number }>()
  for (const g of assigneeGroups as Array<{
    assigneeActorId: string | null
    status: string
    _count: { _all: number }
  }>) {
    if (!g.assigneeActorId) continue
    const entry = workloadMap.get(g.assigneeActorId) ?? {
      assigned: 0,
      completed: 0,
    }
    entry.assigned += g._count._all
    if (g.status === 'DONE') entry.completed += g._count._all
    workloadMap.set(g.assigneeActorId, entry)
  }

  const memberWorkload = Array.from(workloadMap.entries()).map(
    ([actorId, counts]) => ({
      actorId,
      name: actorNameMap.get(actorId) ?? actorId,
      ...counts,
    })
  )

  // Completion trend + week-over-week throughput
  const trendMap = new Map<string, number>()
  let last7dCompleted = 0
  let prev7dCompleted = 0
  for (const t of completedRecently) {
    const dateKey = t.updatedAt.toISOString().slice(0, 10)
    trendMap.set(dateKey, (trendMap.get(dateKey) ?? 0) + 1)
    if (t.updatedAt >= sevenDaysAgo) {
      last7dCompleted++
    } else if (t.updatedAt >= fourteenDaysAgo) {
      prev7dCompleted++
    }
  }
  const completionTrend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, completed]) => ({ date, completed }))

  let avgCompletionTime: number | null = null
  if (doneTasks.length > 0) {
    const totalMs = doneTasks.reduce(
      (sum, t) => sum + (t.updatedAt.getTime() - t.createdAt.getTime()),
      0
    )
    avgCompletionTime = totalMs / doneTasks.length / (1000 * 60 * 60)
  }

  let subtaskCompletionRate: number | null = null
  if (subtasks.length > 0) {
    const doneSubtasks = subtasks.filter(t => t.status === 'DONE').length
    subtaskCompletionRate = doneSubtasks / subtasks.length
  }

  const agentStats = { total: 0, completed: 0, failed: 0, working: 0 }
  for (const g of agentGroups as Array<{
    agentStatus: string | null
    _count: { _all: number }
  }>) {
    const count = g._count._all
    agentStats.total += count
    if (g.agentStatus === 'COMPLETED') agentStats.completed += count
    else if (g.agentStatus === 'FAILED') agentStats.failed += count
    else if (g.agentStatus === 'WORKING') agentStats.working += count
  }

  // Assemble the "base" stats (without risk yet)
  const baseStats: Omit<TaskSummaryStats, 'risk' | 'topBlockers'> = {
    totalTasks,
    statusDistribution,
    priorityDistribution,
    overdueTasks: { count: overdueTaskIds.length, taskIds: overdueTaskIds },
    memberWorkload,
    completionTrend,
    avgCompletionTime,
    subtaskCompletionRate,
    agentStats,
    prStats: { total: prTotal, merged: prMerged, open: prOpen },
  }

  const stalePrCutoff = new Date(
    now.getTime() - config.stalePrDays * 24 * 60 * 60 * 1000
  )
  const staleOpenPrCount = openPrs.filter(
    p => p.createdAt < stalePrCutoff
  ).length

  const signals: RiskSignals = {
    stalledTaskCount: stalledCandidates.length,
    staleOpenPrCount,
    last7dCompleted,
    prev7dCompleted,
  }

  const risk = computeRisk(
    { ...baseStats, risk: EMPTY_RISK, topBlockers: EMPTY_BLOCKERS },
    signals,
    config
  )

  const topBlockers = collectTopBlockers({
    tasks: stalledCandidates.map(t => ({
      id: t.id,
      status: t.status,
      dueDate: t.dueDate,
      updatedAt: t.updatedAt,
    })),
    agents: failingAgentTasks.map(t => ({
      taskId: t.id,
      agentStatus: t.agentStatus,
    })),
    prs: openPrs,
    now,
    config,
  })

  // Re-populate overdue blockers from the overdue query (collectTopBlockers
  // only saw the stalled subset)
  topBlockers.overdueTaskIds = overdueTaskIds.slice(0, 10)

  return { ...baseStats, risk, topBlockers }
}
```

Add the necessary imports at the top of `lib/summaries/stats.ts`:

```ts
import { prisma } from '@/lib/db/prisma'
import type {
  TaskSummaryStats,
  WorkspaceSummaryStats,
  RiskAssessment,
  TopBlockers,
} from '@/types/summary'
import {
  computeRisk,
  collectTopBlockers,
  type RiskConfig,
  type RiskSignals,
} from './risk'

const EMPTY_RISK: RiskAssessment = { level: 'healthy', score: 0, reasons: [] }
const EMPTY_BLOCKERS: TopBlockers = {
  overdueTaskIds: [],
  stalledTaskIds: [],
  failingAgentTaskIds: [],
  staleOpenPrNumbers: [],
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/summaries/stats.test.ts`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add lib/summaries/stats.ts __tests__/summaries/stats.test.ts
git commit -m "feat: thread RiskConfig through aggregateProjectStats [LUM-SUMMARY]"
```

---

### Task 9: Update `aggregateWorkspaceStats` to accept `RiskConfig` and propagate project risks

**Files:**

- Modify: `lib/summaries/stats.ts`

- [ ] **Step 1: Replace `aggregateWorkspaceStats` implementation**

Replace the existing `aggregateWorkspaceStats` and `mergeStats` in `lib/summaries/stats.ts`:

```ts
export async function aggregateWorkspaceStats(
  workspaceId: string,
  workspaceConfig: RiskConfig,
  projectRiskOverrides: Map<string, ProjectRiskOverride | null>
): Promise<WorkspaceSummaryStats> {
  const projects = await prisma.project.findMany({
    where: { workspaceId },
    select: { id: true, name: true },
  })

  // Build per-project effective configs via the overrides map
  const projectStatsList = await Promise.all(
    projects.map(async p => {
      const override = projectRiskOverrides.get(p.id) ?? null
      const effective = override
        ? {
            overdueRatio:
              override.riskOverdueRatio ?? workspaceConfig.overdueRatio,
            stalledDays:
              override.riskStalledDays ?? workspaceConfig.stalledDays,
            stalledMinCount:
              override.riskStalledMinCount ?? workspaceConfig.stalledMinCount,
            agentFailRatio:
              override.riskAgentFailRatio ?? workspaceConfig.agentFailRatio,
            stalePrDays:
              override.riskStalePrDays ?? workspaceConfig.stalePrDays,
            throughputDrop:
              override.riskThroughputDrop ?? workspaceConfig.throughputDrop,
          }
        : workspaceConfig
      return { project: p, stats: await aggregateProjectStats(p.id, effective) }
    })
  )

  const projectCounts = await Promise.all(
    projects.map(async p => {
      const [total, completed, overdue] = await Promise.all([
        prisma.task.count({ where: { projectId: p.id } }),
        prisma.task.count({ where: { projectId: p.id, status: 'DONE' } }),
        prisma.task.count({
          where: {
            projectId: p.id,
            dueDate: { lt: new Date() },
            status: { not: 'DONE' },
          },
        }),
      ])
      return {
        projectId: p.id,
        projectName: p.name,
        totalTasks: total,
        completedTasks: completed,
        overdueTasks: overdue,
      }
    })
  )

  const merged = mergeStats(projectStatsList.map(ps => ps.stats))

  // Project breakdown enriched with risk
  const riskByProject = new Map<string, RiskAssessment>()
  for (const { project, stats } of projectStatsList) {
    riskByProject.set(project.id, stats.risk)
  }
  const projectBreakdown = projectCounts.map(pc => ({
    ...pc,
    risk: riskByProject.get(pc.projectId) ?? EMPTY_RISK,
  }))

  // Workspace-level risk = max-of-projects (dominant level wins)
  const levels = Array.from(riskByProject.values()).map(r => r.level)
  let workspaceLevel: RiskLevel = 'healthy'
  for (const l of levels) {
    if (l === 'at-risk') {
      workspaceLevel = 'at-risk'
      break
    }
    if (l === 'watch') workspaceLevel = 'watch'
  }

  // Aggregate workspace reasons: top 3 at-risk project names as synthetic reasons
  const atRiskProjects = projectBreakdown
    .filter(p => p.risk.level === 'at-risk')
    .slice(0, 3)
  const aggregateReasons: RiskReason[] = atRiskProjects.map(p => ({
    code: 'overdue_ratio_high', // reuse existing code; narrator will summarize
    detail: `Project "${p.projectName}" is at risk (${p.overdueTasks} overdue)`,
  }))

  const workspaceRisk: RiskAssessment = {
    level: workspaceLevel,
    score: 0,
    reasons: aggregateReasons,
  }

  return {
    ...merged,
    risk: workspaceRisk,
    topBlockers: EMPTY_BLOCKERS, // workspace-level: project tab only
    projectBreakdown,
  }
}

// Helper type to describe project-level override columns (all nullable)
export interface ProjectRiskOverride {
  riskOverdueRatio: number | null
  riskStalledDays: number | null
  riskStalledMinCount: number | null
  riskAgentFailRatio: number | null
  riskStalePrDays: number | null
  riskThroughputDrop: number | null
}

function mergeStats(
  statsList: TaskSummaryStats[]
): Omit<TaskSummaryStats, 'risk' | 'topBlockers'> {
  const statusDistribution: Record<string, number> = {}
  const priorityDistribution: Record<string, number> = {}
  let totalTasks = 0
  const overdueTaskIds: string[] = []
  const memberWorkloadMap = new Map<
    string,
    { name: string; assigned: number; completed: number }
  >()
  const trendMap = new Map<string, number>()
  let totalCompletionMs = 0
  let completionCount = 0
  let totalSubtasks = 0
  let doneSubtasks = 0
  const agentStats = { total: 0, completed: 0, failed: 0, working: 0 }
  let prTotal = 0
  let prMerged = 0
  let prOpen = 0

  for (const s of statsList) {
    totalTasks += s.totalTasks
    for (const [k, v] of Object.entries(s.statusDistribution)) {
      statusDistribution[k] = (statusDistribution[k] ?? 0) + v
    }
    for (const [k, v] of Object.entries(s.priorityDistribution)) {
      priorityDistribution[k] = (priorityDistribution[k] ?? 0) + v
    }
    overdueTaskIds.push(...s.overdueTasks.taskIds)
    for (const m of s.memberWorkload) {
      const existing = memberWorkloadMap.get(m.actorId)
      if (existing) {
        existing.assigned += m.assigned
        existing.completed += m.completed
      } else {
        memberWorkloadMap.set(m.actorId, {
          name: m.name,
          assigned: m.assigned,
          completed: m.completed,
        })
      }
    }
    for (const t of s.completionTrend) {
      trendMap.set(t.date, (trendMap.get(t.date) ?? 0) + t.completed)
    }
    if (s.avgCompletionTime !== null) {
      totalCompletionMs += s.avgCompletionTime
      completionCount++
    }
    if (s.subtaskCompletionRate !== null) {
      doneSubtasks += s.subtaskCompletionRate
      totalSubtasks++
    }
    agentStats.total += s.agentStats.total
    agentStats.completed += s.agentStats.completed
    agentStats.failed += s.agentStats.failed
    agentStats.working += s.agentStats.working
    prTotal += s.prStats.total
    prMerged += s.prStats.merged
    prOpen += s.prStats.open
  }

  const memberWorkload = Array.from(memberWorkloadMap.entries()).map(
    ([actorId, v]) => ({ actorId, ...v })
  )
  const completionTrend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, completed]) => ({ date, completed }))

  return {
    totalTasks,
    statusDistribution,
    priorityDistribution,
    overdueTasks: { count: overdueTaskIds.length, taskIds: overdueTaskIds },
    memberWorkload,
    completionTrend,
    avgCompletionTime:
      completionCount > 0 ? totalCompletionMs / completionCount : null,
    subtaskCompletionRate:
      totalSubtasks > 0 ? doneSubtasks / totalSubtasks : null,
    agentStats,
    prStats: { total: prTotal, merged: prMerged, open: prOpen },
  }
}
```

Add imports at the top of `lib/summaries/stats.ts`:

```ts
import type { RiskLevel, RiskReason } from '@/types/summary'
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "lib/summaries" | head -20`
Expected: no errors from `lib/summaries/*`. Errors from `app/api/summaries/generate/route.ts` are expected (fixed in Task 12).

- [ ] **Step 3: Commit**

```bash
git add lib/summaries/stats.ts
git commit -m "feat: extend aggregateWorkspaceStats with risk propagation [LUM-SUMMARY]"
```

---

## Phase 4 — Report Parsing

### Task 10: Implement `parseReport`

**Files:**

- Create: `lib/summaries/parse-report.ts`
- Create: `__tests__/summaries/parse-report.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/summaries/parse-report.test.ts`:

```ts
import { parseReport } from '@/lib/summaries/parse-report'

describe('parseReport', () => {
  it('parses a full English two-section report', () => {
    const input = `## Today's Focus

- Unblock PR #42 review
- Reassign stalled AUTH task
- Ship billing fix by Friday

## Risk

Project is at risk: 7/20 tasks overdue and 3 stalled tasks blocking the team.`
    const parsed = parseReport(input, 'en')
    expect(parsed.todayFocus).toEqual([
      'Unblock PR #42 review',
      'Reassign stalled AUTH task',
      'Ship billing fix by Friday',
    ])
    expect(parsed.riskNarrative).toContain('7/20 tasks overdue')
    expect(parsed.raw).toBe(input)
  })

  it('parses Chinese headers', () => {
    const input = `## 今日关注

- 解除 PR #42 的审核阻塞
- 重新分配 AUTH 停滞任务

## 风险

项目处于关注状态：5/20 任务逾期。`
    const parsed = parseReport(input, 'zh')
    expect(parsed.todayFocus).toHaveLength(2)
    expect(parsed.riskNarrative).toContain('5/20 任务逾期')
  })

  it('tolerates asterisk bullets', () => {
    const input = `## Today's Focus

* First bullet
* Second bullet

## Risk

No blockers detected.`
    const parsed = parseReport(input, 'en')
    expect(parsed.todayFocus).toEqual(['First bullet', 'Second bullet'])
  })

  it('returns empty sections for old-format report', () => {
    const input = `## Progress Overview
Some old content.

## Risks & Blockers
Some old content.`
    const parsed = parseReport(input, 'en')
    expect(parsed.todayFocus).toEqual([])
    expect(parsed.riskNarrative).toBe('')
    expect(parsed.raw).toBe(input)
  })

  it('handles missing Risk section gracefully', () => {
    const input = `## Today's Focus

- Only one bullet`
    const parsed = parseReport(input, 'en')
    expect(parsed.todayFocus).toEqual(['Only one bullet'])
    expect(parsed.riskNarrative).toBe('')
  })

  it('handles empty string input', () => {
    const parsed = parseReport('', 'en')
    expect(parsed.todayFocus).toEqual([])
    expect(parsed.riskNarrative).toBe('')
    expect(parsed.raw).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/summaries/parse-report.test.ts`
Expected: FAIL — cannot resolve `@/lib/summaries/parse-report`.

- [ ] **Step 3: Create the implementation**

Create `lib/summaries/parse-report.ts`:

```ts
export interface ParsedReport {
  todayFocus: string[]
  riskNarrative: string
  raw: string
}

const HEADERS = {
  focus: ["## Today's Focus", '## 今日关注'],
  risk: ['## Risk', '## 风险'],
}

const BULLET_RE = /^[-*]\s+/

function normalizeHeader(line: string): string {
  return line.trim()
}

export function parseReport(report: string, _locale: string): ParsedReport {
  const raw = report
  if (!report) {
    return { todayFocus: [], riskNarrative: '', raw }
  }

  const lines = report.split('\n')
  const sections: Array<{ header: string; body: string[] }> = []
  let current: { header: string; body: string[] } | null = null

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current)
      current = { header: normalizeHeader(line), body: [] }
    } else if (current) {
      current.body.push(line)
    }
  }
  if (current) sections.push(current)

  let todayFocus: string[] = []
  let riskNarrative = ''

  for (const section of sections) {
    if (HEADERS.focus.includes(section.header)) {
      todayFocus = section.body
        .map(l => l.trim())
        .filter(l => BULLET_RE.test(l))
        .map(l => l.replace(BULLET_RE, '').trim())
        .filter(Boolean)
    } else if (HEADERS.risk.includes(section.header)) {
      riskNarrative = section.body
        .map(l => l.trim())
        .filter(Boolean)
        .join(' ')
    }
  }

  return { todayFocus, riskNarrative, raw }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/summaries/parse-report.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/summaries/parse-report.ts __tests__/summaries/parse-report.test.ts
git commit -m "feat: add parseReport for fixed-section markdown [LUM-SUMMARY]"
```

---

## Phase 5 — LLM Prompt Rewrite

### Task 11: Rewrite `lib/summaries/report.ts` prompts and inject risk assessment

**Files:**

- Modify: `lib/summaries/report.ts`
- Create: `__tests__/summaries/report.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/summaries/report.test.ts`:

```ts
import {
  buildProjectPrompt,
  formatReasonsForPrompt,
} from '@/lib/summaries/report'
import type { TaskSummaryStats } from '@/types/summary'

function makeStats(): TaskSummaryStats {
  return {
    totalTasks: 20,
    statusDistribution: { TODO: 5, IN_PROGRESS: 10, DONE: 5 },
    priorityDistribution: { HIGH: 3 },
    overdueTasks: { count: 7, taskIds: [] },
    memberWorkload: [],
    completionTrend: [],
    avgCompletionTime: 24,
    subtaskCompletionRate: null,
    agentStats: { total: 5, completed: 3, failed: 2, working: 0 },
    prStats: { total: 4, merged: 2, open: 2 },
    risk: {
      level: 'watch',
      score: 4,
      reasons: [
        { code: 'overdue_ratio_high', detail: '7/20 tasks overdue (35%)' },
        { code: 'stalled_tasks', detail: '3 tasks with no progress in 7 days' },
      ],
    },
    topBlockers: {
      overdueTaskIds: [],
      stalledTaskIds: [],
      failingAgentTaskIds: [],
      staleOpenPrNumbers: [],
    },
  }
}

describe('formatReasonsForPrompt', () => {
  it('returns "(no triggered rules)" for empty in English', () => {
    expect(formatReasonsForPrompt([], 'en')).toBe('(no triggered rules)')
  })
  it('returns Chinese fallback when locale starts with zh', () => {
    expect(formatReasonsForPrompt([], 'zh')).toBe('(无触发规则)')
  })
  it('formats each reason on its own indented line', () => {
    const out = formatReasonsForPrompt(
      [{ code: 'stalled_tasks', detail: '3 tasks stuck' }],
      'en'
    )
    expect(out).toBe('  - [stalled_tasks] 3 tasks stuck')
  })
})

describe('buildProjectPrompt', () => {
  it('includes Risk Assessment section with level, score, and reasons', () => {
    const prompt = buildProjectPrompt(makeStats(), {
      projectName: 'Test',
      projectDescription: null,
      locale: 'en',
    })
    expect(prompt).toContain('Risk Assessment (pre-computed)')
    expect(prompt).toContain('Level: watch')
    expect(prompt).toContain('Score: 4')
    expect(prompt).toContain('[overdue_ratio_high]')
    expect(prompt).toContain('7/20 tasks overdue (35%)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/summaries/report.test.ts`
Expected: FAIL — `formatReasonsForPrompt` not exported / missing Risk Assessment in prompt.

- [ ] **Step 3: Rewrite `lib/summaries/report.ts`**

Replace the full content of `lib/summaries/report.ts`:

```ts
import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import type {
  RiskReason,
  TaskSummaryStats,
  WorkspaceSummaryStats,
} from '@/types/summary'
import { parseReport } from './parse-report'

// ─── System Prompts ──────────────────────────────────────────────────────────

export const SUMMARY_SYSTEM_PROMPT_EN = `You are a project management analyst writing a briefing for an engineering lead's daily standup.

A rules engine has already assessed the project's risk level. Your job is NOT to re-assess risk — use the pre-computed level and triggered rules as ground truth.

Produce:
- tldr: One sentence (≤ 25 words) capturing the single most important thing the lead needs to know today.
- report: A Markdown document with EXACTLY these two sections, in this order:

## Today's Focus
2–4 bullet points. Each bullet must:
- Start with an imperative verb (Unblock, Review, Reassign, Fix, Ship…)
- Be ≤ 15 words
- Reference a specific person, task, or number from the stats when possible
- Be immediately actionable this week
- Be ordered by priority (first bullet is most urgent)

## Risk
1–2 sentences. State the risk level in plain language and explain it by citing at least ONE specific number from the triggered rules. Do not list all rules — synthesize.

Rules:
- Be factual. Every number you cite must come from the stats or the triggered rules.
- No preamble, no headings other than the two above, no emoji.
- If the project is healthy with no triggered rules, Today's Focus can be lighter ("Keep momentum on X") and Risk says "No blockers detected."`

export const SUMMARY_SYSTEM_PROMPT_ZH = `你是一位项目管理分析师，正在为工程负责人撰写每日站会的简报。

规则引擎已对项目的风险等级做出评估。你的任务**不是**重新评估风险——请将预先计算的等级和触发的规则视为事实依据。

请输出：
- tldr: 一句话（≤ 35 字），概括负责人今天最需要知道的一件事。
- report: 一份 Markdown 报告，必须**严格包含以下两个章节**，按此顺序：

## 今日关注
2–4 条要点，每条必须：
- 以动词开头（解除阻塞 / 审核 / 重新分配 / 修复 / 交付……）
- ≤ 20 字
- 尽量引用具体的人、任务或数字
- 本周可立即行动
- 按优先级排序（第一条最紧急）

## 风险
1–2 句话。用平实的语言说明风险等级，并至少引用触发规则中的一个具体数字来解释，不要罗列所有规则——请综合概括。

规则：
- 坚持事实。你引用的每一个数字都必须来自统计数据或触发的规则。
- 不写前言，不使用上述两个之外的任何小标题，不使用 emoji。
- 如果项目健康无触发规则，"今日关注"可以较轻量（如"继续推进 X"），"风险"写"未发现阻碍"即可。`

// ─── Zod Schema ──────────────────────────────────────────────────────────────

export const SummaryReportSchema = z.object({
  tldr: z.string().describe('One sentence data-driven summary'),
  report: z
    .string()
    .describe("Markdown report with two sections: Today's Focus and Risk"),
})

export type SummaryReport = z.infer<typeof SummaryReportSchema>

// ─── Context interfaces ───────────────────────────────────────────────────────

interface ProjectContext {
  projectName: string
  projectDescription: string | null
  locale: string
}

interface WorkspaceContext {
  workspaceName: string
  locale: string
}

// ─── Reason formatter ────────────────────────────────────────────────────────

export function formatReasonsForPrompt(
  reasons: RiskReason[],
  locale: string
): string {
  if (reasons.length === 0) {
    return locale.startsWith('zh') ? '(无触发规则)' : '(no triggered rules)'
  }
  return reasons.map(r => `  - [${r.code}] ${r.detail}`).join('\n')
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildRiskAssessmentBlock(
  stats: TaskSummaryStats,
  locale: string
): string {
  return `## Risk Assessment (pre-computed)
Level: ${stats.risk.level}
Score: ${stats.risk.score}
Triggered rules:
${formatReasonsForPrompt(stats.risk.reasons, locale)}`
}

export function buildProjectPrompt(
  stats: TaskSummaryStats,
  ctx: ProjectContext
): string {
  const { projectName, projectDescription, locale } = ctx

  const statusLines = Object.entries(stats.statusDistribution)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')

  const priorityLines = Object.entries(stats.priorityDistribution)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')

  const workloadLines =
    stats.memberWorkload.length > 0
      ? stats.memberWorkload
          .map(
            m => `  ${m.name}: assigned=${m.assigned}, completed=${m.completed}`
          )
          .join('\n')
      : '  No assignees'

  const trendLines =
    stats.completionTrend.length > 0
      ? stats.completionTrend.map(t => `  ${t.date}: ${t.completed}`).join('\n')
      : '  No data'

  return `## Project: ${projectName}
Description: ${projectDescription ?? 'Not provided'}

## Task Statistics
Total Tasks: ${stats.totalTasks}

Status Distribution:
${statusLines}

Priority Distribution:
${priorityLines}

Overdue Tasks: ${stats.overdueTasks.count}

Member Workload:
${workloadLines}

Completion Trend (last 30 days):
${trendLines}

Average Completion Time: ${stats.avgCompletionTime !== null ? `${stats.avgCompletionTime.toFixed(1)} hours` : 'N/A'}
Subtask Completion Rate: ${stats.subtaskCompletionRate !== null ? `${(stats.subtaskCompletionRate * 100).toFixed(1)}%` : 'N/A'}

Agent Stats: total=${stats.agentStats.total}, completed=${stats.agentStats.completed}, failed=${stats.agentStats.failed}, working=${stats.agentStats.working}
PR Stats: total=${stats.prStats.total}, merged=${stats.prStats.merged}, open=${stats.prStats.open}

${buildRiskAssessmentBlock(stats, locale)}`
}

export function buildWorkspacePrompt(
  stats: WorkspaceSummaryStats,
  ctx: WorkspaceContext
): string {
  const { workspaceName, locale } = ctx

  const statusLines = Object.entries(stats.statusDistribution)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')

  const priorityLines = Object.entries(stats.priorityDistribution)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')

  const workloadLines =
    stats.memberWorkload.length > 0
      ? stats.memberWorkload
          .map(
            m => `  ${m.name}: assigned=${m.assigned}, completed=${m.completed}`
          )
          .join('\n')
      : '  No assignees'

  const trendLines =
    stats.completionTrend.length > 0
      ? stats.completionTrend.map(t => `  ${t.date}: ${t.completed}`).join('\n')
      : '  No data'

  const projectBreakdownLines = stats.projectBreakdown
    .map(
      p =>
        `  ${p.projectName} [${p.risk.level}]: total=${p.totalTasks}, completed=${p.completedTasks}, overdue=${p.overdueTasks}`
    )
    .join('\n')

  return `## Workspace: ${workspaceName}

## Aggregate Statistics
Total Tasks: ${stats.totalTasks}

Status Distribution:
${statusLines}

Priority Distribution:
${priorityLines}

Overdue Tasks: ${stats.overdueTasks.count}

Member Workload:
${workloadLines}

Completion Trend (last 30 days):
${trendLines}

Average Completion Time: ${stats.avgCompletionTime !== null ? `${stats.avgCompletionTime.toFixed(1)} hours` : 'N/A'}
Subtask Completion Rate: ${stats.subtaskCompletionRate !== null ? `${(stats.subtaskCompletionRate * 100).toFixed(1)}%` : 'N/A'}

Agent Stats: total=${stats.agentStats.total}, completed=${stats.agentStats.completed}, failed=${stats.agentStats.failed}, working=${stats.agentStats.working}
PR Stats: total=${stats.prStats.total}, merged=${stats.prStats.merged}, open=${stats.prStats.open}

## Project Breakdown
${projectBreakdownLines}

${buildRiskAssessmentBlock(stats, locale)}`
}

// ─── Report generators ────────────────────────────────────────────────────────

export async function generateProjectReport(
  stats: TaskSummaryStats,
  ctx: ProjectContext
): Promise<SummaryReport> {
  const systemPrompt = ctx.locale.startsWith('zh')
    ? SUMMARY_SYSTEM_PROMPT_ZH
    : SUMMARY_SYSTEM_PROMPT_EN
  const prompt = buildProjectPrompt(stats, ctx)

  const { object } = await generateObject({
    model: gateway('anthropic/claude-sonnet-4.5'),
    schema: SummaryReportSchema,
    system: systemPrompt,
    prompt,
  })

  const parsed = parseReport(object.report, ctx.locale)
  if (parsed.todayFocus.length === 0 && !parsed.riskNarrative) {
    console.warn(
      'generateProjectReport: report did not match two-section format',
      { locale: ctx.locale, projectName: ctx.projectName }
    )
  }

  return object
}

export async function generateWorkspaceReport(
  stats: WorkspaceSummaryStats,
  ctx: WorkspaceContext
): Promise<SummaryReport> {
  const systemPrompt = ctx.locale.startsWith('zh')
    ? SUMMARY_SYSTEM_PROMPT_ZH
    : SUMMARY_SYSTEM_PROMPT_EN
  const prompt = buildWorkspacePrompt(stats, ctx)

  const { object } = await generateObject({
    model: gateway('anthropic/claude-sonnet-4.5'),
    schema: SummaryReportSchema,
    system: systemPrompt,
    prompt,
  })

  const parsed = parseReport(object.report, ctx.locale)
  if (parsed.todayFocus.length === 0 && !parsed.riskNarrative) {
    console.warn(
      'generateWorkspaceReport: report did not match two-section format',
      { locale: ctx.locale, workspaceName: ctx.workspaceName }
    )
  }

  return object
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/summaries/report.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/summaries/report.ts __tests__/summaries/report.test.ts
git commit -m "feat: rewrite summary prompts to narrate pre-computed risk [LUM-SUMMARY]"
```

---

## Phase 6 — Cron Route

### Task 12: Update cron route to assemble effective config per project

**Files:**

- Modify: `app/api/summaries/generate/route.ts`
- Modify: `lib/repositories/summary.repository.ts` (to select risk fields)

- [ ] **Step 1: Extend repository query to include risk fields**

Replace `findSummaryEnabledWorkspaces` in `lib/repositories/summary.repository.ts`:

```ts
  async findSummaryEnabledWorkspaces(workspaceId?: string) {
    return prisma.workspace.findMany({
      where: {
        summaryEnabled: true,
        ...(workspaceId ? { id: workspaceId } : {}),
      },
      include: {
        projects: {
          select: {
            id: true,
            name: true,
            description: true,
            riskOverdueRatio: true,
            riskStalledDays: true,
            riskStalledMinCount: true,
            riskAgentFailRatio: true,
            riskStalePrDays: true,
            riskThroughputDrop: true,
          },
        },
        summaries: {
          orderBy: { generatedAt: 'desc' },
          take: 1,
        },
      },
    })
  },
```

- [ ] **Step 2: Rewrite the cron route**

Replace the full content of `app/api/summaries/generate/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { summaryService } from '@/lib/services/summary.service'
import {
  aggregateProjectStats,
  aggregateWorkspaceStats,
  type ProjectRiskOverride,
} from '@/lib/summaries/stats'
import {
  generateProjectReport,
  generateWorkspaceReport,
} from '@/lib/summaries/report'
import { resolveEffectiveRiskConfig } from '@/lib/summaries/risk'

/**
 * GET /api/summaries/generate
 * Called daily by Vercel Cron. Iterates summary-enabled workspaces and
 * generates project + workspace summaries for any that are due based on
 * their configured frequency.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const workspaces = await summaryService.findSummaryEnabledWorkspaces()

    const results = []

    for (const workspace of workspaces) {
      const lastGenerated = workspace.summaries[0]?.generatedAt ?? null

      if (
        !summaryService.isDueForGeneration(
          workspace.summaryFrequency,
          lastGenerated
        )
      ) {
        results.push({ workspaceId: workspace.id, skipped: true })
        continue
      }

      const workspaceConfig = {
        riskOverdueRatio: workspace.riskOverdueRatio,
        riskStalledDays: workspace.riskStalledDays,
        riskStalledMinCount: workspace.riskStalledMinCount,
        riskAgentFailRatio: workspace.riskAgentFailRatio,
        riskStalePrDays: workspace.riskStalePrDays,
        riskThroughputDrop: workspace.riskThroughputDrop,
      }

      const projectSummaries = []
      const projectOverrides = new Map<string, ProjectRiskOverride | null>()

      for (const project of workspace.projects) {
        const override: ProjectRiskOverride = {
          riskOverdueRatio: project.riskOverdueRatio,
          riskStalledDays: project.riskStalledDays,
          riskStalledMinCount: project.riskStalledMinCount,
          riskAgentFailRatio: project.riskAgentFailRatio,
          riskStalePrDays: project.riskStalePrDays,
          riskThroughputDrop: project.riskThroughputDrop,
        }
        projectOverrides.set(project.id, override)

        const effective = resolveEffectiveRiskConfig(workspaceConfig, override)

        try {
          const stats = await aggregateProjectStats(project.id, effective)
          const { tldr, report } = await generateProjectReport(stats, {
            projectName: project.name,
            projectDescription: project.description ?? null,
            locale: workspace.summaryLocale,
          })

          const summary = await summaryService.createProjectSummary(
            project.id,
            stats as unknown as Prisma.InputJsonValue,
            tldr,
            report
          )

          projectSummaries.push({
            projectId: project.id,
            summaryId: summary.id,
          })
        } catch (err) {
          console.error(
            `GET /api/summaries/generate project error [${project.id}]:`,
            err
          )
          projectSummaries.push({ projectId: project.id, error: true })
        }
      }

      const workspaceEffective = resolveEffectiveRiskConfig(
        workspaceConfig,
        null
      )
      const workspaceStats = await aggregateWorkspaceStats(
        workspace.id,
        workspaceEffective,
        projectOverrides
      )
      const { tldr, report } = await generateWorkspaceReport(workspaceStats, {
        workspaceName: workspace.name,
        locale: workspace.summaryLocale,
      })

      const workspaceSummary = await summaryService.createWorkspaceSummary(
        workspace.id,
        workspaceStats as unknown as Prisma.InputJsonValue,
        tldr,
        report
      )

      results.push({
        workspaceId: workspace.id,
        workspaceSummaryId: workspaceSummary.id,
        projects: projectSummaries,
      })
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error('GET /api/summaries/generate error:', error)
    return NextResponse.json(
      { error: 'Failed to generate summaries' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npx tsc --noEmit 2>&1 | grep -E "summaries/generate|repositories/summary" | head`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/repositories/summary.repository.ts app/api/summaries/generate/route.ts
git commit -m "feat: thread risk config through summaries cron route [LUM-SUMMARY]"
```

---

## Phase 7 — Validation + Settings API

### Task 13: Add `updateWorkspaceSchema` and extend `updateProjectSchema`

**Files:**

- Modify: `lib/validation/schemas.ts`
- Modify: `app/api/workspaces/me/route.ts`

- [ ] **Step 1: Add risk fields to schemas**

In `lib/validation/schemas.ts`, replace the `createWorkspaceSchema` block with an additional `updateWorkspaceSchema` export (keep `createWorkspaceSchema` as-is):

```ts
// ─── Workspace ──────────────────────────────────────────────────────────────

export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters')
    .regex(
      /^[A-Za-z0-9 _-]+$/,
      'Name can only contain English letters, numbers, spaces, hyphens, and underscores'
    ),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(50, 'Slug must be at most 50 characters')
    .regex(
      /^[a-z0-9-]+$/,
      'Slug can only contain lowercase letters, numbers, and hyphens'
    )
    .refine(
      s => !s.startsWith('-') && !s.endsWith('-'),
      'Slug cannot start or end with a hyphen'
    )
    .refine(s => !RESERVED_SLUGS.includes(s), 'This slug is reserved')
    .optional(),
  summaryEnabled: z.boolean().optional(),
  summaryFrequency: z.enum(['DAILY', 'EVERY_TWO_DAYS', 'WEEKLY']).optional(),
  summaryLocale: z.string().max(10).optional(),
})

export const updateWorkspaceSchema = createWorkspaceSchema.partial().extend({
  riskOverdueRatio: z.number().min(0).max(1).optional(),
  riskStalledDays: z.number().int().min(1).max(30).optional(),
  riskStalledMinCount: z.number().int().min(1).max(50).optional(),
  riskAgentFailRatio: z.number().min(0).max(1).optional(),
  riskStalePrDays: z.number().int().min(1).max(30).optional(),
  riskThroughputDrop: z.number().min(0).max(1).optional(),
})
```

- [ ] **Step 2: Extend `updateProjectSchema`**

Replace the existing `updateProjectSchema`:

```ts
export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  isIdea: z.boolean().optional(),
  defaultReviewerId: z.string().nullable().optional(),
  riskOverdueRatio: z.number().min(0).max(1).nullable().optional(),
  riskStalledDays: z.number().int().min(1).max(30).nullable().optional(),
  riskStalledMinCount: z.number().int().min(1).max(50).nullable().optional(),
  riskAgentFailRatio: z.number().min(0).max(1).nullable().optional(),
  riskStalePrDays: z.number().int().min(1).max(30).nullable().optional(),
  riskThroughputDrop: z.number().min(0).max(1).nullable().optional(),
})
```

- [ ] **Step 3: Update `PATCH /api/workspaces/me` to use `updateWorkspaceSchema`**

In `app/api/workspaces/me/route.ts`:

Change the import line:

```ts
import { updateWorkspaceSchema } from '@/lib/validation/schemas'
```

Change the `parsed` line inside `PATCH`:

```ts
const parsed = updateWorkspaceSchema.safeParse(body)
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "validation|workspaces/me" | head`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/validation/schemas.ts app/api/workspaces/me/route.ts
git commit -m "feat: add risk threshold fields to validation schemas [LUM-SUMMARY]"
```

---

### Task 14: Verify `workspaceService.updateWorkspace` passes risk fields to Prisma

**Files:**

- Read: `lib/services/workspace.service.ts`
- Modify (if needed): `lib/services/workspace.service.ts`

- [ ] **Step 1: Inspect the existing update method**

Run: `grep -n "updateWorkspace" lib/services/workspace.service.ts`

- [ ] **Step 2: Ensure the data argument is passed through to Prisma**

The function should use `data` as a spread or direct assignment so that new optional fields flow through without an explicit allowlist. If the service filters fields explicitly, add the 6 risk columns to the allowlist. Read the file and confirm. If a change is needed, add the fields.

- [ ] **Step 3: If no change is needed, skip; otherwise commit**

```bash
git add lib/services/workspace.service.ts
git commit -m "chore: allow risk threshold fields in workspace service update [LUM-SUMMARY]"
```

(If the service already passes `data` through, this commit is skipped entirely.)

---

## Phase 8 — Shared UI Primitives

### Task 15: Create `RiskBadge` component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/summary/RiskBadge.tsx`
- Create: `__tests__/components/summary/RiskBadge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/summary/RiskBadge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { RiskBadge } from '@/app/workspace/[workspaceUrl]/components/summary/RiskBadge'

const messages = {
  'summary.riskLevel.healthy': 'Healthy',
  'summary.riskLevel.watch': 'Watch',
  'summary.riskLevel.atRisk': 'At risk',
  'summary.riskLevel.unassessed': 'Not assessed',
}

function wrap(ui: React.ReactElement) {
  return (
    <IntlProvider locale='en' messages={messages}>
      {ui}
    </IntlProvider>
  )
}

describe('RiskBadge', () => {
  it('renders healthy label', () => {
    render(wrap(<RiskBadge level='healthy' showLabel />))
    expect(screen.getByText('Healthy')).toBeInTheDocument()
  })
  it('renders watch label', () => {
    render(wrap(<RiskBadge level='watch' showLabel />))
    expect(screen.getByText('Watch')).toBeInTheDocument()
  })
  it('renders at-risk label', () => {
    render(wrap(<RiskBadge level='at-risk' showLabel />))
    expect(screen.getByText('At risk')).toBeInTheDocument()
  })
  it('renders null state as Not assessed', () => {
    render(wrap(<RiskBadge level={null} showLabel />))
    expect(screen.getByText('Not assessed')).toBeInTheDocument()
  })
  it('hides label when showLabel is false', () => {
    render(wrap(<RiskBadge level='healthy' showLabel={false} />))
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/summary/RiskBadge.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `RiskBadge.tsx`**

Create `app/workspace/[workspaceUrl]/components/summary/RiskBadge.tsx`:

```tsx
'use client'

import { useIntl } from 'react-intl'
import type { RiskLevel } from '@/types/summary'

interface RiskBadgeProps {
  level: RiskLevel | null
  size?: 'sm' | 'md'
  showLabel?: boolean
}

const STYLES: Record<
  RiskLevel | 'null',
  { dot: string; bg: string; text: string; labelKey: string }
> = {
  healthy: {
    dot: 'bg-emerald-500',
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    text: 'text-emerald-700 dark:text-emerald-300',
    labelKey: 'summary.riskLevel.healthy',
  },
  watch: {
    dot: 'bg-amber-500',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    text: 'text-amber-700 dark:text-amber-300',
    labelKey: 'summary.riskLevel.watch',
  },
  'at-risk': {
    dot: 'bg-red-500',
    bg: 'bg-red-50 dark:bg-red-900/20',
    text: 'text-red-700 dark:text-red-300',
    labelKey: 'summary.riskLevel.atRisk',
  },
  null: {
    dot: 'bg-zinc-400',
    bg: 'bg-transparent',
    text: 'text-zinc-500 dark:text-zinc-400',
    labelKey: 'summary.riskLevel.unassessed',
  },
}

export function RiskBadge({
  level,
  size = 'md',
  showLabel = true,
}: RiskBadgeProps) {
  const intl = useIntl()
  const style = STYLES[level ?? 'null']
  const dotSize = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5'
  const padding = size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-1'

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full ${padding} ${style.bg}`}
    >
      <span className={`${dotSize} rounded-full ${style.dot}`} aria-hidden />
      {showLabel && (
        <span className={`text-xs font-medium ${style.text}`}>
          {intl.formatMessage({ id: style.labelKey })}
        </span>
      )}
    </span>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/components/summary/RiskBadge.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/summary/RiskBadge.tsx __tests__/components/summary/RiskBadge.test.tsx
git commit -m "feat: add RiskBadge component [LUM-SUMMARY]"
```

---

### Task 16: Create `BriefingCard` component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/summary/BriefingCard.tsx`
- Create: `__tests__/components/summary/BriefingCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/summary/BriefingCard.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { BriefingCard } from '@/app/workspace/[workspaceUrl]/components/summary/BriefingCard'

const messages = {
  'summary.todayFocus': "Today's Focus",
  'summary.showFullReport': 'Show full report',
  'summary.hideFullReport': 'Hide full report',
  'summary.riskLevel.healthy': 'Healthy',
  'summary.riskLevel.watch': 'Watch',
  'summary.riskLevel.atRisk': 'At risk',
  'summary.riskLevel.unassessed': 'Not assessed',
}

function wrap(ui: React.ReactElement) {
  return (
    <IntlProvider locale='en' messages={messages}>
      {ui}
    </IntlProvider>
  )
}

const fullReport = `## Today's Focus

- Unblock PR #42
- Reassign AUTH task

## Risk

Project at risk: 7/20 overdue.`

describe('BriefingCard', () => {
  it('renders tldr, bullets, and risk narrative', () => {
    render(
      wrap(
        <BriefingCard
          tldr='Critical week ahead'
          report={fullReport}
          generatedAt={new Date('2026-04-11').toISOString()}
          risk={{ level: 'at-risk', score: 5, reasons: [] }}
        />
      )
    )
    expect(screen.getByText('Critical week ahead')).toBeInTheDocument()
    expect(screen.getByText('Unblock PR #42')).toBeInTheDocument()
    expect(
      screen.getByText(/Project at risk: 7\/20 overdue/)
    ).toBeInTheDocument()
    expect(screen.getByText('At risk')).toBeInTheDocument()
  })

  it('falls back to raw markdown when no sections match (old data)', () => {
    const oldReport = `## Progress Overview\nOld content body.`
    render(
      wrap(
        <BriefingCard
          tldr='Old summary'
          report={oldReport}
          generatedAt={new Date('2026-04-01').toISOString()}
          risk={null}
        />
      )
    )
    expect(screen.getByText(/Old content body/)).toBeInTheDocument()
    expect(screen.getByText('Not assessed')).toBeInTheDocument()
  })

  it('toggles full report visibility', () => {
    render(
      wrap(
        <BriefingCard
          tldr='x'
          report={fullReport}
          generatedAt={new Date().toISOString()}
          risk={{ level: 'healthy', score: 0, reasons: [] }}
        />
      )
    )
    const toggle = screen.getByText('Show full report')
    fireEvent.click(toggle)
    expect(screen.getByText('Hide full report')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/summary/BriefingCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `BriefingCard.tsx`**

Create `app/workspace/[workspaceUrl]/components/summary/BriefingCard.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import type { RiskAssessment } from '@/types/summary'
import { parseReport } from '@/lib/summaries/parse-report'
import { RiskBadge } from './RiskBadge'

interface BriefingCardProps {
  tldr: string
  report: string
  generatedAt: string
  risk: RiskAssessment | null
}

export function BriefingCard({
  tldr,
  report,
  generatedAt,
  risk,
}: BriefingCardProps) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState(false)

  const parsed = useMemo(
    () => parseReport(report, intl.locale),
    [report, intl.locale]
  )

  const hasStructured =
    parsed.todayFocus.length > 0 || parsed.riskNarrative.length > 0

  const formattedDate = new Date(generatedAt).toLocaleDateString(intl.locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-3'>
      <header className='flex items-center justify-between'>
        <RiskBadge level={risk?.level ?? null} showLabel />
        <span className='text-xs text-zinc-400 dark:text-zinc-500'>
          {formattedDate}
        </span>
      </header>

      <p className='text-base font-medium text-zinc-800 dark:text-zinc-200'>
        {tldr}
      </p>

      {hasStructured ? (
        <>
          {parsed.todayFocus.length > 0 && (
            <section>
              <h3 className='text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2'>
                {intl.formatMessage({ id: 'summary.todayFocus' })}
              </h3>
              <ul className='space-y-1.5'>
                {parsed.todayFocus.map((item, i) => (
                  <li
                    key={i}
                    className='flex gap-2 text-sm text-zinc-700 dark:text-zinc-300'
                  >
                    <span className='text-zinc-400'>•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {parsed.riskNarrative && (
            <section className='rounded bg-zinc-50 dark:bg-zinc-900/50 p-3 text-xs text-zinc-600 dark:text-zinc-400'>
              {parsed.riskNarrative}
            </section>
          )}
        </>
      ) : (
        <pre className='whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300 font-sans'>
          {parsed.raw}
        </pre>
      )}

      {hasStructured && (
        <>
          <button
            type='button'
            onClick={() => setExpanded(v => !v)}
            className='text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
          >
            {expanded
              ? intl.formatMessage({ id: 'summary.hideFullReport' })
              : intl.formatMessage({ id: 'summary.showFullReport' })}
          </button>
          {expanded && (
            <pre className='whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400 border-t border-zinc-100 dark:border-zinc-800 pt-3 font-sans'>
              {parsed.raw}
            </pre>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/components/summary/BriefingCard.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/summary/BriefingCard.tsx __tests__/components/summary/BriefingCard.test.tsx
git commit -m "feat: add BriefingCard component [LUM-SUMMARY]"
```

---

## Phase 9 — Dashboard

### Task 17: Create `ProjectsAtGlanceList`

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/summary/ProjectsAtGlanceList.tsx`
- Create: `__tests__/components/summary/ProjectsAtGlanceList.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/summary/ProjectsAtGlanceList.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { ProjectsAtGlanceList } from '@/app/workspace/[workspaceUrl]/components/summary/ProjectsAtGlanceList'
import type { WorkspaceSummaryStats } from '@/types/summary'

const messages = {
  'summary.projectsAtGlance': 'Projects at a glance',
  'summary.filterAll': 'All',
  'summary.riskLevel.healthy': 'Healthy',
  'summary.riskLevel.watch': 'Watch',
  'summary.riskLevel.atRisk': 'At risk',
  'summary.riskLevel.unassessed': 'Not assessed',
  'summary.overdue': 'Overdue',
}

const projects: WorkspaceSummaryStats['projectBreakdown'] = [
  {
    projectId: 'p1',
    projectName: 'Alpha',
    totalTasks: 20,
    completedTasks: 12,
    overdueTasks: 7,
    risk: {
      level: 'at-risk',
      score: 5,
      reasons: [
        { code: 'overdue_ratio_high', detail: '7/20 tasks overdue (35%)' },
      ],
    },
  },
  {
    projectId: 'p2',
    projectName: 'Bravo',
    totalTasks: 10,
    completedTasks: 9,
    overdueTasks: 0,
    risk: { level: 'healthy', score: 0, reasons: [] },
  },
  {
    projectId: 'p3',
    projectName: 'Charlie',
    totalTasks: 15,
    completedTasks: 10,
    overdueTasks: 2,
    risk: { level: 'watch', score: 3, reasons: [] },
  },
]

function wrap(ui: React.ReactElement) {
  return (
    <IntlProvider locale='en' messages={messages}>
      {ui}
    </IntlProvider>
  )
}

describe('ProjectsAtGlanceList', () => {
  it('renders projects sorted with at-risk first', () => {
    render(
      wrap(<ProjectsAtGlanceList projects={projects} onNavigate={() => {}} />)
    )
    const names = screen
      .getAllByTestId('project-row-name')
      .map(n => n.textContent)
    expect(names).toEqual(['Alpha', 'Charlie', 'Bravo'])
  })

  it('calls onNavigate when a row is clicked', () => {
    const onNavigate = jest.fn()
    render(
      wrap(<ProjectsAtGlanceList projects={projects} onNavigate={onNavigate} />)
    )
    fireEvent.click(screen.getAllByTestId('project-row')[0])
    expect(onNavigate).toHaveBeenCalledWith('p1')
  })

  it('renders nothing when projects array is empty', () => {
    const { container } = render(
      wrap(<ProjectsAtGlanceList projects={[]} onNavigate={() => {}} />)
    )
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/summary/ProjectsAtGlanceList.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `ProjectsAtGlanceList.tsx`**

Create `app/workspace/[workspaceUrl]/components/summary/ProjectsAtGlanceList.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import type { WorkspaceSummaryStats, RiskLevel } from '@/types/summary'
import { RiskBadge } from './RiskBadge'

interface ProjectsAtGlanceListProps {
  projects: WorkspaceSummaryStats['projectBreakdown']
  onNavigate: (projectId: string) => void
}

type FilterKey = 'all' | RiskLevel

const SORT_ORDER: Record<string, number> = {
  'at-risk': 0,
  watch: 1,
  healthy: 2,
  null: 3,
}

export function ProjectsAtGlanceList({
  projects,
  onNavigate,
}: ProjectsAtGlanceListProps) {
  const intl = useIntl()
  const [filter, setFilter] = useState<FilterKey>('all')

  const sorted = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const d =
          SORT_ORDER[a.risk?.level ?? 'null'] -
          SORT_ORDER[b.risk?.level ?? 'null']
        return d !== 0 ? d : b.overdueTasks - a.overdueTasks
      }),
    [projects]
  )

  const counts = useMemo(
    () => ({
      'at-risk': projects.filter(p => p.risk?.level === 'at-risk').length,
      watch: projects.filter(p => p.risk?.level === 'watch').length,
      healthy: projects.filter(p => p.risk?.level === 'healthy').length,
    }),
    [projects]
  )

  const visible =
    filter === 'all' ? sorted : sorted.filter(p => p.risk?.level === filter)

  if (projects.length === 0) return null

  const filters: Array<{ key: FilterKey; labelKey: string; count: number }> = [
    {
      key: 'all',
      labelKey: 'summary.filterAll',
      count: projects.length,
    },
    {
      key: 'at-risk',
      labelKey: 'summary.riskLevel.atRisk',
      count: counts['at-risk'],
    },
    {
      key: 'watch',
      labelKey: 'summary.riskLevel.watch',
      count: counts.watch,
    },
    {
      key: 'healthy',
      labelKey: 'summary.riskLevel.healthy',
      count: counts.healthy,
    },
  ]

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden'>
      <div className='flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800'>
        <p className='text-sm font-semibold text-zinc-800 dark:text-zinc-200'>
          {intl.formatMessage({ id: 'summary.projectsAtGlance' })}
        </p>
        <div className='flex gap-1'>
          {filters.map(f => (
            <button
              key={f.key}
              type='button'
              onClick={() => setFilter(f.key)}
              className={`text-xs px-2 py-1 rounded-md ${
                filter === f.key
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {intl.formatMessage({ id: f.labelKey })} ({f.count})
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className='px-4 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400'>
          {intl.formatMessage({
            id: 'summary.noProjectsMatchFilter',
            defaultMessage: 'No projects match this filter',
          })}
        </div>
      ) : (
        <div className='divide-y divide-zinc-100 dark:divide-zinc-800'>
          {visible.map(p => {
            const pct =
              p.totalTasks > 0
                ? Math.round((p.completedTasks / p.totalTasks) * 100)
                : 0
            const reasonLine = p.risk?.reasons
              .slice(0, 2)
              .map(r => r.detail)
              .join(', ')
            return (
              <button
                key={p.projectId}
                type='button'
                data-testid='project-row'
                onClick={() => onNavigate(p.projectId)}
                className='w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors'
              >
                <RiskBadge
                  level={p.risk?.level ?? null}
                  size='sm'
                  showLabel={false}
                />
                <div className='flex-1 min-w-0'>
                  <p
                    data-testid='project-row-name'
                    className='text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate'
                  >
                    {p.projectName}
                  </p>
                  {reasonLine && (
                    <p className='text-xs text-zinc-500 dark:text-zinc-400 truncate'>
                      {reasonLine}
                    </p>
                  )}
                  <div className='mt-1.5 h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden'>
                    <div
                      className='h-full rounded-full bg-indigo-500'
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <div className='shrink-0 text-right text-xs text-zinc-500 dark:text-zinc-400 w-20'>
                  <span className='font-medium text-zinc-700 dark:text-zinc-300'>
                    {p.completedTasks}/{p.totalTasks}
                  </span>
                </div>
                {p.overdueTasks > 0 && (
                  <div className='shrink-0 text-xs text-amber-500 font-medium w-24 text-right'>
                    {p.overdueTasks}{' '}
                    {intl
                      .formatMessage({ id: 'summary.overdue' })
                      .toLowerCase()}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/components/summary/ProjectsAtGlanceList.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/summary/ProjectsAtGlanceList.tsx __tests__/components/summary/ProjectsAtGlanceList.test.tsx
git commit -m "feat: add ProjectsAtGlanceList component [LUM-SUMMARY]"
```

---

### Task 18: Rewrite `DashboardPage.tsx`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/DashboardPage.tsx`

- [ ] **Step 1: Replace the component body**

Full replacement of `DashboardPage.tsx`:

```tsx
'use client'

import { useIntl } from 'react-intl'
import { BarChart2 } from 'lucide-react'
import { useWorkspaceSummary } from '../../hooks/useSummary'
import { BriefingCard } from '../summary/BriefingCard'
import { ProjectsAtGlanceList } from '../summary/ProjectsAtGlanceList'
import { StatsCardRow } from '../summary/StatsCardRow'
import { StatusDistributionChart } from '../summary/StatusDistributionChart'
import { MemberWorkloadChart } from '../summary/MemberWorkloadChart'
import { CompletionTrendChart } from '../summary/CompletionTrendChart'
import { SummaryHistory } from '../summary/SummaryHistory'
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import { PageBreadcrumb } from '../PageBreadcrumb'

interface DashboardPageProps {
  onNavigateToProject: (projectId: string) => void
}

export function DashboardPage({ onNavigateToProject }: DashboardPageProps) {
  const intl = useIntl()
  const { summary, history, loading, error, loadHistory, historyLoading } =
    useWorkspaceSummary()

  if (loading && !summary) {
    return (
      <div className='flex-1 flex flex-col overflow-hidden'>
        <PageBreadcrumb
          title={intl.formatMessage({ id: 'summary.dashboard' })}
        />
        <div className='flex items-center justify-center py-16'>
          <p className='text-sm text-zinc-400 dark:text-zinc-500'>
            {intl.formatMessage({
              id: 'common.loading',
              defaultMessage: 'Loading…',
            })}
          </p>
        </div>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className='flex-1 flex flex-col overflow-hidden'>
        <PageBreadcrumb
          title={intl.formatMessage({ id: 'summary.dashboard' })}
        />
        <div className='flex-1 overflow-y-auto'>
          <div className='px-4 md:px-8 py-6 space-y-4'>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <BarChart2 />
                </EmptyMedia>
                <EmptyTitle>
                  {intl.formatMessage({ id: 'summary.title' })}
                </EmptyTitle>
                <EmptyDescription>
                  {error
                    ? intl.formatMessage({ id: 'summary.reportFailed' })
                    : intl.formatMessage({ id: 'summary.noSummary' })}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent />
            </Empty>
          </div>
        </div>
      </div>
    )
  }

  const stats = summary.stats
  const projectBreakdown = stats?.projectBreakdown ?? []

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      <PageBreadcrumb title={intl.formatMessage({ id: 'summary.dashboard' })} />
      <div className='flex-1 overflow-y-auto'>
        <div className='px-4 md:px-8 py-6 space-y-4'>
          <BriefingCard
            tldr={summary.tldr}
            report={summary.report}
            generatedAt={summary.generatedAt}
            risk={stats?.risk ?? null}
          />

          <ProjectsAtGlanceList
            projects={projectBreakdown}
            onNavigate={onNavigateToProject}
          />

          {stats && (
            <>
              <StatsCardRow stats={stats} />

              <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
                <StatusDistributionChart
                  distribution={stats.statusDistribution}
                />
                <MemberWorkloadChart workload={stats.memberWorkload} />
                <CompletionTrendChart trend={stats.completionTrend} />
              </div>
            </>
          )}

          <SummaryHistory
            history={history}
            loading={historyLoading}
            onLoad={loadHistory}
          />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit 2>&1 | grep DashboardPage`
Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/pages/DashboardPage.tsx
git commit -m "feat: rewrite DashboardPage around BriefingCard and ProjectsAtGlance [LUM-SUMMARY]"
```

---

## Phase 10 — Project Summary Tab

### Task 19: Create `TopBlockersList`

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/summary/TopBlockersList.tsx`
- Create: `__tests__/components/summary/TopBlockersList.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/summary/TopBlockersList.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { TopBlockersList } from '@/app/workspace/[workspaceUrl]/components/summary/TopBlockersList'
import type { TopBlockers } from '@/types/summary'

const messages = {
  'summary.topBlockers': 'Top blockers',
  'summary.blockerGroup.overdue': 'Overdue tasks',
  'summary.blockerGroup.stalled': 'Stalled tasks',
  'summary.blockerGroup.failingAgents': 'Failing agents',
  'summary.blockerGroup.stalePrs': 'Stale PRs',
  'summary.noBlockers': 'No blockers',
  'summary.showMore': '+{n} more',
}

function wrap(ui: React.ReactElement) {
  return (
    <IntlProvider locale='en' messages={messages}>
      {ui}
    </IntlProvider>
  )
}

const allEmpty: TopBlockers = {
  overdueTaskIds: [],
  stalledTaskIds: [],
  failingAgentTaskIds: [],
  staleOpenPrNumbers: [],
}

describe('TopBlockersList', () => {
  it('renders "No blockers" when everything is empty', () => {
    render(wrap(<TopBlockersList blockers={allEmpty} onOpenTask={() => {}} />))
    expect(screen.getByText('No blockers')).toBeInTheDocument()
  })

  it('renders overdue and stalled groups with clickable items', () => {
    const onOpenTask = jest.fn()
    render(
      wrap(
        <TopBlockersList
          blockers={{
            overdueTaskIds: ['t1', 't2'],
            stalledTaskIds: ['t3'],
            failingAgentTaskIds: [],
            staleOpenPrNumbers: [],
          }}
          onOpenTask={onOpenTask}
        />
      )
    )
    expect(screen.getByText('Overdue tasks')).toBeInTheDocument()
    expect(screen.getByText('Stalled tasks')).toBeInTheDocument()
    fireEvent.click(screen.getByText('t1'))
    expect(onOpenTask).toHaveBeenCalledWith('t1')
  })

  it('caps items at 5 and shows +N more', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    render(
      wrap(
        <TopBlockersList
          blockers={{ ...allEmpty, overdueTaskIds: ids }}
          onOpenTask={() => {}}
        />
      )
    )
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('e')).toBeInTheDocument()
    expect(screen.queryByText('f')).not.toBeInTheDocument()
    expect(screen.getByText('+2 more')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/summary/TopBlockersList.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `TopBlockersList.tsx`**

Create `app/workspace/[workspaceUrl]/components/summary/TopBlockersList.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { AlertTriangle, Clock, Bot, GitPullRequest } from 'lucide-react'
import type { TopBlockers } from '@/types/summary'

interface TopBlockersListProps {
  blockers: TopBlockers
  onOpenTask: (taskId: string) => void
}

interface BlockerGroup {
  key: string
  labelKey: string
  Icon: typeof AlertTriangle
  items: Array<{ id: string; label: string; href?: string }>
  kind: 'task' | 'pr'
}

function useBlockerGroups(blockers: TopBlockers): BlockerGroup[] {
  return [
    {
      key: 'overdue',
      labelKey: 'summary.blockerGroup.overdue',
      Icon: AlertTriangle,
      items: blockers.overdueTaskIds.map(id => ({ id, label: id })),
      kind: 'task',
    },
    {
      key: 'stalled',
      labelKey: 'summary.blockerGroup.stalled',
      Icon: Clock,
      items: blockers.stalledTaskIds.map(id => ({ id, label: id })),
      kind: 'task',
    },
    {
      key: 'failing-agents',
      labelKey: 'summary.blockerGroup.failingAgents',
      Icon: Bot,
      items: blockers.failingAgentTaskIds.map(id => ({ id, label: id })),
      kind: 'task',
    },
    {
      key: 'stale-prs',
      labelKey: 'summary.blockerGroup.stalePrs',
      Icon: GitPullRequest,
      items: blockers.staleOpenPrNumbers.map(n => ({
        id: String(n),
        label: `#${n}`,
      })),
      kind: 'pr',
    },
  ]
}

const MAX_PER_GROUP = 5

export function TopBlockersList({
  blockers,
  onOpenTask,
}: TopBlockersListProps) {
  const intl = useIntl()
  const groups = useBlockerGroups(blockers)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const allEmpty = groups.every(g => g.items.length === 0)

  if (allEmpty) {
    return (
      <div className='rounded-lg border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/50 dark:bg-emerald-900/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300'>
        {intl.formatMessage({ id: 'summary.noBlockers' })}
      </div>
    )
  }

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden'>
      <div className='px-4 py-3 border-b border-zinc-100 dark:border-zinc-800'>
        <p className='text-sm font-semibold text-zinc-800 dark:text-zinc-200'>
          {intl.formatMessage({ id: 'summary.topBlockers' })}
        </p>
      </div>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-zinc-100 dark:divide-zinc-800'>
        {groups
          .filter(g => g.items.length > 0)
          .map(g => {
            const showAll = expanded[g.key] ?? false
            const visible = showAll ? g.items : g.items.slice(0, MAX_PER_GROUP)
            const hidden = g.items.length - visible.length
            return (
              <div key={g.key} className='p-4 space-y-2'>
                <div className='flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400'>
                  <g.Icon className='h-3.5 w-3.5' />
                  {intl.formatMessage({ id: g.labelKey })} ({g.items.length})
                </div>
                <ul className='space-y-1'>
                  {visible.map(item => (
                    <li key={item.id}>
                      {g.kind === 'task' ? (
                        <button
                          type='button'
                          onClick={() => onOpenTask(item.id)}
                          className='text-sm text-indigo-600 dark:text-indigo-400 hover:underline'
                        >
                          {item.label}
                        </button>
                      ) : (
                        <span className='text-sm text-zinc-700 dark:text-zinc-300'>
                          {item.label}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {hidden > 0 && (
                  <button
                    type='button'
                    onClick={() =>
                      setExpanded(prev => ({ ...prev, [g.key]: true }))
                    }
                    className='text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                  >
                    {intl.formatMessage(
                      { id: 'summary.showMore' },
                      { n: hidden }
                    )}
                  </button>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/components/summary/TopBlockersList.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/summary/TopBlockersList.tsx __tests__/components/summary/TopBlockersList.test.tsx
git commit -m "feat: add TopBlockersList component [LUM-SUMMARY]"
```

---

### Task 20: Rewrite `ProjectSummaryTab.tsx`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/summary/ProjectSummaryTab.tsx`

- [ ] **Step 1: Replace the component body**

Full replacement of `ProjectSummaryTab.tsx`:

```tsx
'use client'

import { useIntl } from 'react-intl'
import { BarChart2 } from 'lucide-react'
import { useProjectSummary } from '../../hooks/useSummary'
import { BriefingCard } from './BriefingCard'
import { TopBlockersList } from './TopBlockersList'
import { StatsCardRow } from './StatsCardRow'
import { StatusDistributionChart } from './StatusDistributionChart'
import { MemberWorkloadChart } from './MemberWorkloadChart'
import { CompletionTrendChart } from './CompletionTrendChart'
import { SummaryHistory } from './SummaryHistory'
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'

interface ProjectSummaryTabProps {
  projectId: string
  onOpenTask?: (taskId: string) => void
}

export function ProjectSummaryTab({
  projectId,
  onOpenTask,
}: ProjectSummaryTabProps) {
  const intl = useIntl()
  const { summary, history, loading, error, loadHistory, historyLoading } =
    useProjectSummary(projectId)

  if (loading && !summary) {
    return (
      <div className='flex items-center justify-center py-16'>
        <p className='text-sm text-zinc-400 dark:text-zinc-500'>
          {intl.formatMessage({
            id: 'common.loading',
            defaultMessage: 'Loading…',
          })}
        </p>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className='space-y-4 px-4 md:px-8 py-6'>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <BarChart2 />
            </EmptyMedia>
            <EmptyTitle>
              {intl.formatMessage({ id: 'summary.title' })}
            </EmptyTitle>
            <EmptyDescription>
              {error
                ? intl.formatMessage({ id: 'summary.reportFailed' })
                : intl.formatMessage({ id: 'summary.noSummary' })}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent />
        </Empty>
      </div>
    )
  }

  const stats = summary.stats

  return (
    <div className='space-y-4 px-4 md:px-8 py-6'>
      <BriefingCard
        tldr={summary.tldr}
        report={summary.report}
        generatedAt={summary.generatedAt}
        risk={stats?.risk ?? null}
      />

      {stats?.topBlockers && (
        <TopBlockersList
          blockers={stats.topBlockers}
          onOpenTask={onOpenTask ?? (() => {})}
        />
      )}

      <StatsCardRow stats={stats} />

      <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
        <StatusDistributionChart distribution={stats.statusDistribution} />
        <MemberWorkloadChart workload={stats.memberWorkload} />
        <CompletionTrendChart trend={stats.completionTrend} />
      </div>

      <SummaryHistory
        history={history}
        loading={historyLoading}
        onLoad={loadHistory}
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit 2>&1 | grep ProjectSummaryTab`
Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/summary/ProjectSummaryTab.tsx
git commit -m "feat: rewrite ProjectSummaryTab around BriefingCard and TopBlockers [LUM-SUMMARY]"
```

---

## Phase 11 — Settings UIs

### Task 21: Add "Risk thresholds" card to `WorkspaceSettingsPage`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/WorkspaceSettingsPage.tsx`

- [ ] **Step 1: Add state + handler**

In the state block near the existing summary settings state (~line 78), add:

```tsx
// Risk thresholds
const DEFAULT_RISK = {
  riskOverdueRatio: 0.25,
  riskStalledDays: 7,
  riskStalledMinCount: 3,
  riskAgentFailRatio: 0.3,
  riskStalePrDays: 3,
  riskThroughputDrop: 0.5,
}
const [riskForm, setRiskForm] = useState(DEFAULT_RISK)
const [savingRisk, setSavingRisk] = useState(false)
```

In the `fetchWorkspace` hydration block (after `setSummaryLocale`), add:

```tsx
setRiskForm({
  riskOverdueRatio:
    data.workspace.riskOverdueRatio ?? DEFAULT_RISK.riskOverdueRatio,
  riskStalledDays:
    data.workspace.riskStalledDays ?? DEFAULT_RISK.riskStalledDays,
  riskStalledMinCount:
    data.workspace.riskStalledMinCount ?? DEFAULT_RISK.riskStalledMinCount,
  riskAgentFailRatio:
    data.workspace.riskAgentFailRatio ?? DEFAULT_RISK.riskAgentFailRatio,
  riskStalePrDays:
    data.workspace.riskStalePrDays ?? DEFAULT_RISK.riskStalePrDays,
  riskThroughputDrop:
    data.workspace.riskThroughputDrop ?? DEFAULT_RISK.riskThroughputDrop,
})
```

Also extend the local `Workspace` type at the top of the file (near the existing `summaryFrequency?` entry) to include the 6 `riskXxx?` fields as optional numbers.

After `handleSaveSummarySettings`, add:

```tsx
const handleSaveRiskThresholds = async () => {
  if (!assertOwner()) return
  setSavingRisk(true)
  try {
    await workspacesClient.updateMe({ ...riskForm })
    toast.success(intl.formatMessage({ id: 'workspaceSettings.riskUpdated' }))
  } catch (err) {
    toast.error(
      err instanceof Error
        ? err.message
        : intl.formatMessage({ id: 'workspaceSettings.riskUpdateFailed' })
    )
  } finally {
    setSavingRisk(false)
  }
}

const handleRestoreRiskDefaults = () => setRiskForm(DEFAULT_RISK)
```

- [ ] **Step 2: Add the card to JSX**

Directly after the closing brace of the existing "Summary settings" card (line ~461, after `{isOwner && ( ... Summary settings ... )}`), add a new card:

```tsx
{
  /* Risk thresholds */
}
{
  isOwner && (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden mb-8'>
      <div className='px-5 py-3 border-b border-zinc-100 dark:border-zinc-800'>
        <p className='text-sm font-semibold text-zinc-800 dark:text-zinc-200'>
          {intl.formatMessage({ id: 'summary.riskThresholds' })}
        </p>
        <p className='text-xs text-zinc-400 mt-0.5'>
          {intl.formatMessage({ id: 'summary.riskThresholds.description' })}
        </p>
      </div>

      {(
        [
          [
            'riskOverdueRatio',
            'summary.riskThresholds.overdueRatio',
            'number',
            0,
            1,
            0.01,
          ],
          [
            'riskStalledDays',
            'summary.riskThresholds.stalledDays',
            'int',
            1,
            30,
            1,
          ],
          [
            'riskStalledMinCount',
            'summary.riskThresholds.stalledMinCount',
            'int',
            1,
            50,
            1,
          ],
          [
            'riskAgentFailRatio',
            'summary.riskThresholds.agentFailRatio',
            'number',
            0,
            1,
            0.01,
          ],
          [
            'riskStalePrDays',
            'summary.riskThresholds.stalePrDays',
            'int',
            1,
            30,
            1,
          ],
          [
            'riskThroughputDrop',
            'summary.riskThresholds.throughputDrop',
            'number',
            0,
            1,
            0.01,
          ],
        ] as const
      ).map(([key, labelId, kind, min, max, step]) => (
        <div
          key={key}
          className='flex items-center justify-between gap-4 px-5 py-3 border-b border-zinc-100 dark:border-zinc-800'
        >
          <label className='text-sm font-medium text-zinc-800 dark:text-zinc-200'>
            {intl.formatMessage({ id: labelId })}
          </label>
          <input
            type='number'
            min={min}
            max={max}
            step={step}
            value={riskForm[key]}
            onChange={e => {
              const raw = e.target.value
              const parsed =
                kind === 'int' ? parseInt(raw, 10) : parseFloat(raw)
              setRiskForm(f => ({
                ...f,
                [key]: isNaN(parsed) ? f[key] : parsed,
              }))
            }}
            disabled={savingRisk}
            className='w-24 h-8 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 text-sm text-right text-zinc-800 dark:text-zinc-200 outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 disabled:opacity-50'
          />
        </div>
      ))}

      <div className='flex justify-between px-5 py-4'>
        <Button
          size='sm'
          variant='ghost'
          onClick={handleRestoreRiskDefaults}
          disabled={savingRisk}
        >
          {intl.formatMessage({
            id: 'summary.riskThresholds.restoreDefaults',
          })}
        </Button>
        <Button
          size='sm'
          onClick={handleSaveRiskThresholds}
          disabled={savingRisk}
        >
          {savingRisk
            ? intl.formatMessage({ id: 'common.saving' })
            : intl.formatMessage({ id: 'common.save' })}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit 2>&1 | grep WorkspaceSettingsPage`
Expected: empty (assuming the local `Workspace` type extension is in place).

- [ ] **Step 4: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/pages/WorkspaceSettingsPage.tsx
git commit -m "feat: add risk threshold settings card to workspace page [LUM-SUMMARY]"
```

---

### Task 22: Add "Risk thresholds" override card to Project Overview sidebar

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/ProjectDetailPage.tsx`
- Create: `app/workspace/[workspaceUrl]/components/summary/ProjectRiskOverrideCard.tsx`

- [ ] **Step 1: Create the override card component**

Create `app/workspace/[workspaceUrl]/components/summary/ProjectRiskOverrideCard.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { projectsClient } from '@/lib/api-client/projects'
import { toast } from 'sonner'

interface RiskDefaults {
  riskOverdueRatio: number
  riskStalledDays: number
  riskStalledMinCount: number
  riskAgentFailRatio: number
  riskStalePrDays: number
  riskThroughputDrop: number
}

interface ProjectRiskOverrides {
  riskOverdueRatio: number | null
  riskStalledDays: number | null
  riskStalledMinCount: number | null
  riskAgentFailRatio: number | null
  riskStalePrDays: number | null
  riskThroughputDrop: number | null
}

interface ProjectRiskOverrideCardProps {
  projectId: string
  workspaceDefaults: RiskDefaults
  initialOverrides: ProjectRiskOverrides
}

type FieldKey = keyof ProjectRiskOverrides
type FieldState = { value: string; dirty: boolean }

const FIELDS: Array<{
  key: FieldKey
  labelId: string
  kind: 'int' | 'number'
}> = [
  {
    key: 'riskOverdueRatio',
    labelId: 'summary.riskThresholds.overdueRatio',
    kind: 'number',
  },
  {
    key: 'riskStalledDays',
    labelId: 'summary.riskThresholds.stalledDays',
    kind: 'int',
  },
  {
    key: 'riskStalledMinCount',
    labelId: 'summary.riskThresholds.stalledMinCount',
    kind: 'int',
  },
  {
    key: 'riskAgentFailRatio',
    labelId: 'summary.riskThresholds.agentFailRatio',
    kind: 'number',
  },
  {
    key: 'riskStalePrDays',
    labelId: 'summary.riskThresholds.stalePrDays',
    kind: 'int',
  },
  {
    key: 'riskThroughputDrop',
    labelId: 'summary.riskThresholds.throughputDrop',
    kind: 'number',
  },
]

function initialState(
  overrides: ProjectRiskOverrides
): Record<FieldKey, FieldState> {
  return Object.fromEntries(
    FIELDS.map(f => [
      f.key,
      {
        value: overrides[f.key] === null ? '' : String(overrides[f.key]),
        dirty: false,
      },
    ])
  ) as Record<FieldKey, FieldState>
}

export function ProjectRiskOverrideCard({
  projectId,
  workspaceDefaults,
  initialOverrides,
}: ProjectRiskOverrideCardProps) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState(() =>
    FIELDS.some(f => initialOverrides[f.key] !== null)
  )
  const [form, setForm] = useState<Record<FieldKey, FieldState>>(() =>
    initialState(initialOverrides)
  )
  const [saving, setSaving] = useState(false)

  const update = (key: FieldKey, value: string) =>
    setForm(f => ({ ...f, [key]: { value, dirty: true } }))

  const resetAll = () =>
    setForm(
      Object.fromEntries(
        FIELDS.map(f => [f.key, { value: '', dirty: true }])
      ) as Record<FieldKey, FieldState>
    )

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload: Record<string, number | null> = {}
      for (const f of FIELDS) {
        const entry = form[f.key]
        if (!entry.dirty) continue
        if (entry.value === '') {
          payload[f.key] = null
        } else {
          payload[f.key] =
            f.kind === 'int'
              ? parseInt(entry.value, 10)
              : parseFloat(entry.value)
        }
      }
      if (Object.keys(payload).length > 0) {
        await projectsClient.update(projectId, payload)
      }
      // Reset dirty flags
      setForm(
        prev =>
          Object.fromEntries(
            FIELDS.map(f => [f.key, { value: prev[f.key].value, dirty: false }])
          ) as Record<FieldKey, FieldState>
      )
      toast.success(intl.formatMessage({ id: 'summary.riskThresholds.saved' }))
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: 'summary.riskThresholds.saveFailed' })
      )
    } finally {
      setSaving(false)
    }
  }

  if (!expanded) {
    return (
      <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-2'>
        <p className='text-xs font-semibold text-zinc-800 dark:text-zinc-200'>
          {intl.formatMessage({ id: 'summary.riskThresholds' })}
        </p>
        <p className='text-xs text-zinc-500 dark:text-zinc-400'>
          {intl.formatMessage({ id: 'summary.riskThresholds.usingDefaults' })}
        </p>
        <button
          type='button'
          onClick={() => setExpanded(true)}
          className='text-xs text-indigo-600 dark:text-indigo-400 hover:underline'
        >
          {intl.formatMessage({
            id: 'summary.riskThresholds.overrideDefaults',
          })}
        </button>
      </div>
    )
  }

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-3'>
      <p className='text-xs font-semibold text-zinc-800 dark:text-zinc-200'>
        {intl.formatMessage({ id: 'summary.riskThresholds' })}
      </p>
      <div className='space-y-2'>
        {FIELDS.map(f => (
          <div key={f.key} className='flex items-center justify-between gap-2'>
            <label className='text-xs text-zinc-600 dark:text-zinc-400'>
              {intl.formatMessage({ id: f.labelId })}
            </label>
            <input
              type='number'
              value={form[f.key].value}
              placeholder={String(workspaceDefaults[f.key])}
              onChange={e => update(f.key, e.target.value)}
              disabled={saving}
              className='w-20 h-7 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 text-xs text-right text-zinc-800 dark:text-zinc-200 outline-none focus:ring-1 focus:ring-zinc-400 disabled:opacity-50'
            />
          </div>
        ))}
      </div>
      <div className='flex justify-between pt-2'>
        <button
          type='button'
          onClick={resetAll}
          disabled={saving}
          className='text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
        >
          {intl.formatMessage({
            id: 'summary.riskThresholds.resetToWorkspace',
          })}
        </button>
        <button
          type='button'
          onClick={handleSave}
          disabled={saving}
          className='text-xs bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 rounded px-2 py-1 disabled:opacity-50'
        >
          {saving
            ? intl.formatMessage({ id: 'common.saving' })
            : intl.formatMessage({ id: 'common.save' })}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Mount the card in `ProjectDetailPage.tsx` Overview sidebar**

Read `app/workspace/[workspaceUrl]/components/pages/ProjectDetailPage.tsx` to locate the Overview sidebar (search for the existing "Lead"/defaultReviewer block). Then:

1. Add import: `import { ProjectRiskOverrideCard } from '../summary/ProjectRiskOverrideCard'`
2. In the sidebar JSX, after the existing properties, mount:

```tsx
{
  workspaceDefaults && project && (
    <ProjectRiskOverrideCard
      projectId={project.id}
      workspaceDefaults={workspaceDefaults}
      initialOverrides={{
        riskOverdueRatio: project.riskOverdueRatio ?? null,
        riskStalledDays: project.riskStalledDays ?? null,
        riskStalledMinCount: project.riskStalledMinCount ?? null,
        riskAgentFailRatio: project.riskAgentFailRatio ?? null,
        riskStalePrDays: project.riskStalePrDays ?? null,
        riskThroughputDrop: project.riskThroughputDrop ?? null,
      }}
    />
  )
}
```

3. Fetch `workspaceDefaults` via the existing workspace `me` call or reuse a context if one exists. If neither is available, call `workspacesClient.getMe` once in a `useEffect` and store the 6 defaults in local state.
4. Extend the local `Project` type used by the page to include the 6 `riskXxx?: number | null` optional fields.

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit 2>&1 | grep ProjectDetailPage | head`
Expected: empty.

- [ ] **Step 4: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/summary/ProjectRiskOverrideCard.tsx app/workspace/\[workspaceUrl\]/components/pages/ProjectDetailPage.tsx
git commit -m "feat: add project risk threshold override card [LUM-SUMMARY]"
```

---

## Phase 12 — i18n

### Task 23: Add new i18n keys to `en.json` and `zh.json`

**Files:**

- Modify: `messages/en.json`
- Modify: `messages/zh.json`

- [ ] **Step 1: Add English keys**

In `messages/en.json`, add the following keys (locate the existing `summary.*` block and insert alongside):

```json
"summary.todayFocus": "Today's Focus",
"summary.risk": "Risk",
"summary.riskLevel.healthy": "Healthy",
"summary.riskLevel.watch": "Watch",
"summary.riskLevel.atRisk": "At risk",
"summary.riskLevel.unassessed": "Not assessed",
"summary.projectsAtGlance": "Projects at a glance",
"summary.filterAll": "All",
"summary.noProjectsMatchFilter": "No projects match this filter",
"summary.topBlockers": "Top blockers",
"summary.blockerGroup.overdue": "Overdue tasks",
"summary.blockerGroup.stalled": "Stalled tasks",
"summary.blockerGroup.failingAgents": "Failing agents",
"summary.blockerGroup.stalePrs": "Stale PRs",
"summary.noBlockers": "No blockers",
"summary.showMore": "+{n} more",
"summary.showFullReport": "Show full report",
"summary.hideFullReport": "Hide full report",
"summary.riskThresholds": "Risk thresholds",
"summary.riskThresholds.description": "Tune how we flag project health.",
"summary.riskThresholds.overdueRatio": "Overdue ratio",
"summary.riskThresholds.stalledDays": "Stalled days",
"summary.riskThresholds.stalledMinCount": "Stalled min count",
"summary.riskThresholds.agentFailRatio": "Agent failure ratio",
"summary.riskThresholds.stalePrDays": "Stale PR days",
"summary.riskThresholds.throughputDrop": "Throughput drop ratio",
"summary.riskThresholds.restoreDefaults": "Restore defaults",
"summary.riskThresholds.usingDefaults": "Using workspace defaults",
"summary.riskThresholds.overrideDefaults": "Override defaults",
"summary.riskThresholds.resetToWorkspace": "Reset all to workspace",
"summary.riskThresholds.saved": "Risk thresholds saved",
"summary.riskThresholds.saveFailed": "Failed to save risk thresholds",
"workspaceSettings.riskUpdated": "Risk thresholds updated",
"workspaceSettings.riskUpdateFailed": "Failed to update risk thresholds",
```

- [ ] **Step 2: Add Chinese translations**

In `messages/zh.json`, add:

```json
"summary.todayFocus": "今日关注",
"summary.risk": "风险",
"summary.riskLevel.healthy": "健康",
"summary.riskLevel.watch": "关注",
"summary.riskLevel.atRisk": "有风险",
"summary.riskLevel.unassessed": "未评估",
"summary.projectsAtGlance": "项目一览",
"summary.filterAll": "全部",
"summary.noProjectsMatchFilter": "没有项目符合该筛选",
"summary.topBlockers": "主要阻碍",
"summary.blockerGroup.overdue": "逾期任务",
"summary.blockerGroup.stalled": "停滞任务",
"summary.blockerGroup.failingAgents": "失败的 Agent",
"summary.blockerGroup.stalePrs": "积压的 PR",
"summary.noBlockers": "无阻碍",
"summary.showMore": "再显示 {n} 项",
"summary.showFullReport": "查看完整报告",
"summary.hideFullReport": "隐藏完整报告",
"summary.riskThresholds": "风险阈值",
"summary.riskThresholds.description": "调整项目健康度的判定方式。",
"summary.riskThresholds.overdueRatio": "逾期比例",
"summary.riskThresholds.stalledDays": "停滞天数",
"summary.riskThresholds.stalledMinCount": "停滞任务下限",
"summary.riskThresholds.agentFailRatio": "Agent 失败率",
"summary.riskThresholds.stalePrDays": "PR 积压天数",
"summary.riskThresholds.throughputDrop": "吞吐下跌比例",
"summary.riskThresholds.restoreDefaults": "恢复默认",
"summary.riskThresholds.usingDefaults": "使用工作区默认",
"summary.riskThresholds.overrideDefaults": "覆盖默认值",
"summary.riskThresholds.resetToWorkspace": "全部重置为工作区值",
"summary.riskThresholds.saved": "风险阈值已保存",
"summary.riskThresholds.saveFailed": "保存风险阈值失败",
"workspaceSettings.riskUpdated": "风险阈值已更新",
"workspaceSettings.riskUpdateFailed": "更新风险阈值失败",
```

- [ ] **Step 3: Verify JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/en.json'))" && node -e "JSON.parse(require('fs').readFileSync('messages/zh.json'))"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add messages/en.json messages/zh.json
git commit -m "feat: add risk and briefing i18n keys [LUM-SUMMARY]"
```

---

## Phase 13 — Cleanup

### Task 24: Delete superseded components and stale imports

**Files:**

- Delete: `app/workspace/[workspaceUrl]/components/summary/SummaryReportCard.tsx`
- Delete: `app/workspace/[workspaceUrl]/components/summary/AdditionalStats.tsx`

- [ ] **Step 1: Verify no remaining imports**

Run: `grep -rn "SummaryReportCard\|AdditionalStats" app/ __tests__/ lib/ 2>&1 | grep -v "\.map$" | head`
Expected: no matches (both DashboardPage and ProjectSummaryTab were already rewritten).

- [ ] **Step 2: Delete both files**

```bash
rm app/workspace/\[workspaceUrl\]/components/summary/SummaryReportCard.tsx
rm app/workspace/\[workspaceUrl\]/components/summary/AdditionalStats.tsx
```

- [ ] **Step 3: Run full test suite and typecheck**

Run: `npx tsc --noEmit && npm test -- --passWithNoTests`
Expected: no TypeScript errors; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove SummaryReportCard and AdditionalStats [LUM-SUMMARY]"
```

---

## Final Validation

### Task 25: End-to-end smoke

**Files:** none

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all existing + new tests pass.

- [ ] **Step 3: Local dev smoke**

Run: `npm run dev` (if server not already running), then manually:

- Visit `/workspace/<slug>` — Dashboard renders BriefingCard + ProjectsAtGlance
- Visit `/workspace/<slug>/projects/<id>` → Summary tab — BriefingCard + TopBlockers
- Visit Workspace settings — Risk thresholds card present
- Visit Project Overview sidebar — Risk thresholds override card present

Note: Until the next cron run, old summaries display the fallback rendering (raw markdown + "Not assessed" badge). After the next cron run, new briefings will appear.

- [ ] **Step 4: Final commit (if any stray fixes)**

```bash
git status
# Only commit if there are uncommitted fixes
```

---

## Summary

- **13 phases, 25 tasks**, covering schema, risk engine, stats integration, report rewrite, cron route, validation, 4 new UI components, 2 page rewrites, 2 settings extensions, i18n, and cleanup.
- **10 new test files** (6 backend, 4 frontend) following TDD where feasible.
- **2 Prisma migrations** (pure column additions, fully backward compatible).
- **Backward compatible:** old summaries render via fallback (`BriefingCard` shows raw markdown, `RiskBadge` shows "Not assessed", `ProjectsAtGlance` sorts unassessed last).
- **Philosophy shift:** risk becomes a deterministic rule-based property; the LLM shrinks to narration role.
