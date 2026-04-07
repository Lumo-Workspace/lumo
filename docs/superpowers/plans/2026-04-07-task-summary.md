# Task Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scheduled AI-powered task summaries with statistical dashboards at project and workspace levels.

**Architecture:** New `ProjectSummary` and `WorkspaceSummary` Prisma models store periodic snapshots of stats + AI reports. A cron-triggered API route aggregates data and calls Claude Sonnet to produce structured reports. Frontend adds a Summary tab to project detail and a Dashboard page to the workspace.

**Tech Stack:** Prisma (data model), Vercel AI SDK + Claude Sonnet (report generation), Zod (validation), React + Tailwind + shadcn/ui (frontend), react-intl (i18n), Jest (tests)

---

## File Structure

| File                                                                          | Responsibility                                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `prisma/schema.prisma`                                                        | Add `ProjectSummary`, `WorkspaceSummary` models, `SummaryFrequency` enum, workspace config fields      |
| `types/summary.ts`                                                            | `TaskSummaryStats`, `WorkspaceSummaryStats`, `ApiProjectSummary`, `ApiWorkspaceSummary` types          |
| `lib/summaries/stats.ts`                                                      | `aggregateProjectStats()`, `aggregateWorkspaceStats()` — pure Prisma queries                           |
| `lib/summaries/report.ts`                                                     | `SUMMARY_SYSTEM_PROMPT`, `SummaryReportSchema`, `generateProjectReport()`, `generateWorkspaceReport()` |
| `lib/validation/schemas.ts`                                                   | Add `generateSummarySchema`, `getSummarySchema` validation schemas                                     |
| `app/api/summaries/generate/route.ts`                                         | `POST` — cron-triggered generation endpoint                                                            |
| `app/api/summaries/project/[projectId]/route.ts`                              | `GET` — fetch project summaries                                                                        |
| `app/api/summaries/workspace/route.ts`                                        | `GET` — fetch workspace summaries                                                                      |
| `app/workspace/[workspaceUrl]/components/summary/SummaryReportCard.tsx`       | AI report card (TL;DR + expandable report)                                                             |
| `app/workspace/[workspaceUrl]/components/summary/StatsCardRow.tsx`            | 4 stat number cards                                                                                    |
| `app/workspace/[workspaceUrl]/components/summary/StatusDistributionChart.tsx` | Horizontal stacked bar                                                                                 |
| `app/workspace/[workspaceUrl]/components/summary/MemberWorkloadChart.tsx`     | Horizontal bars per member                                                                             |
| `app/workspace/[workspaceUrl]/components/summary/CompletionTrendChart.tsx`    | Vertical bar chart                                                                                     |
| `app/workspace/[workspaceUrl]/components/summary/AdditionalStats.tsx`         | Collapsible priority/subtask/agent/PR stats                                                            |
| `app/workspace/[workspaceUrl]/components/summary/SummaryHistory.tsx`          | Timeline list of historical summaries                                                                  |
| `app/workspace/[workspaceUrl]/components/summary/ProjectSummaryTab.tsx`       | Full Summary tab content (composes above)                                                              |
| `app/workspace/[workspaceUrl]/components/pages/DashboardPage.tsx`             | Workspace-level dashboard page                                                                         |
| `app/workspace/[workspaceUrl]/hooks/useSummary.ts`                            | Hook: fetch + cache summary data                                                                       |
| `lib/i18n/en.json`                                                            | Add `summary.*` and `sidebar.dashboard` keys                                                           |
| `lib/i18n/zh.json`                                                            | Add `summary.*` and `sidebar.dashboard` keys                                                           |
| `tests/lib/summaries/stats.test.ts`                                           | Unit tests for stats aggregation                                                                       |
| `tests/lib/summaries/report.test.ts`                                          | Unit tests for report generation                                                                       |
| `tests/api/summaries/generate.test.ts`                                        | API route tests for generation                                                                         |

---

### Task 1: Prisma Schema — Models and Migration

**Files:**

- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `SummaryFrequency` enum to schema**

Add after the existing enums (near `TaskStatus`, `TaskPriority`):

```prisma
enum SummaryFrequency {
  DAILY
  EVERY_TWO_DAYS
  WEEKLY
}
```

- [ ] **Step 2: Add summary config fields to Workspace model**

Add these fields to the existing `Workspace` model:

```prisma
  summaryFrequency SummaryFrequency @default(DAILY)
  summaryEnabled   Boolean          @default(true)
  summaryLocale    String           @default("en")
```

- [ ] **Step 3: Add ProjectSummary model**

Add after the existing models:

```prisma
model ProjectSummary {
  id          String   @id @default(cuid())
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  stats       Json
  tldr        String
  report      String

  generatedAt DateTime @default(now())
  createdAt   DateTime @default(now())

  @@index([projectId, generatedAt(sort: Desc)])
}
```

- [ ] **Step 4: Add WorkspaceSummary model**

```prisma
model WorkspaceSummary {
  id           String    @id @default(cuid())
  workspaceId  String
  workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  stats        Json
  tldr         String
  report       String

  generatedAt  DateTime  @default(now())
  createdAt    DateTime  @default(now())

  @@index([workspaceId, generatedAt(sort: Desc)])
}
```

- [ ] **Step 5: Add relation arrays to existing models**

Add to the `Project` model:

```prisma
  summaries ProjectSummary[]
```

Add to the `Workspace` model:

```prisma
  summaries WorkspaceSummary[]
```

- [ ] **Step 6: Run migration**

Run: `npx prisma migrate dev --name add-task-summary`
Expected: Migration created successfully, Prisma Client regenerated.

- [ ] **Step 7: Verify Prisma Client generation**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`

- [ ] **Step 8: Commit**

```bash
git add prisma/
git commit -m "feat: add ProjectSummary and WorkspaceSummary models [LUM-21]"
```

---

### Task 2: TypeScript Types

**Files:**

- Create: `types/summary.ts`

- [ ] **Step 1: Create summary types file**

```typescript
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
}

export interface WorkspaceSummaryStats extends TaskSummaryStats {
  projectBreakdown: Array<{
    projectId: string
    projectName: string
    totalTasks: number
    completedTasks: number
    overdueTasks: number
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

- [ ] **Step 2: Commit**

```bash
git add types/summary.ts
git commit -m "feat: add TaskSummaryStats and API summary types [LUM-21]"
```

---

### Task 3: Stats Aggregation — Tests

**Files:**

- Create: `tests/lib/summaries/stats.test.ts`

- [ ] **Step 1: Write test file with mocked Prisma**

```typescript
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    pullRequest: {
      count: jest.fn(),
    },
  },
}))

import { aggregateProjectStats } from '@/lib/summaries/stats'
import { prisma } from '@/lib/db/prisma'

const asMock = (fn: unknown): jest.Mock<any> => fn as jest.Mock<any>

describe('aggregateProjectStats', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns correct status distribution', async () => {
    asMock(prisma.task.groupBy).mockImplementation(async (args: any) => {
      if (args.by?.includes('status')) {
        return [
          { status: 'TODO', _count: { _all: 5 } },
          { status: 'IN_PROGRESS', _count: { _all: 8 } },
          { status: 'IN_REVIEW', _count: { _all: 3 } },
          { status: 'DONE', _count: { _all: 20 } },
        ]
      }
      if (args.by?.includes('priority')) {
        return [
          { priority: 'LOW', _count: { _all: 10 } },
          { priority: 'MEDIUM', _count: { _all: 15 } },
          { priority: 'HIGH', _count: { _all: 8 } },
          { priority: 'URGENT', _count: { _all: 3 } },
        ]
      }
      if (args.by?.includes('assigneeActorId')) {
        return [
          { assigneeActorId: 'actor-1', _count: { _all: 12 } },
          { assigneeActorId: 'actor-2', _count: { _all: 9 } },
        ]
      }
      return []
    })

    // Overdue tasks
    asMock(prisma.task.findMany).mockImplementation(async (args: any) => {
      if (args.where?.dueDate) {
        return [{ id: 'task-1' }, { id: 'task-2' }]
      }
      // Completed tasks for trend + avg time
      if (args.where?.status === 'DONE') {
        return [
          {
            id: 't1',
            createdAt: new Date('2026-04-01'),
            updatedAt: new Date('2026-04-02'),
          },
          {
            id: 't2',
            createdAt: new Date('2026-04-03'),
            updatedAt: new Date('2026-04-04'),
          },
        ]
      }
      // Assignee names
      if (args.select?.assignee) {
        return [
          {
            assigneeActorId: 'actor-1',
            assignee: { member: { clerkId: 'clerk-1' } },
          },
          {
            assigneeActorId: 'actor-2',
            assignee: { agent: { name: 'Bot: Coder' } },
          },
        ]
      }
      return []
    })

    // Subtask counts
    asMock(prisma.task.count).mockImplementation(async (args: any) => {
      if (args.where?.parentTaskId && args.where?.status === 'DONE') return 15
      if (args.where?.parentTaskId) return 20
      return 36
    })

    // PR stats
    asMock(prisma.pullRequest.count).mockImplementation(async (args: any) => {
      if (args.where?.state === 'merged') return 5
      if (args.where?.state === 'open') return 2
      return 8
    })

    const stats = await aggregateProjectStats('project-1')

    expect(stats.totalTasks).toBe(36)
    expect(stats.statusDistribution).toEqual({
      TODO: 5,
      IN_PROGRESS: 8,
      IN_REVIEW: 3,
      DONE: 20,
    })
    expect(stats.priorityDistribution).toEqual({
      LOW: 10,
      MEDIUM: 15,
      HIGH: 8,
      URGENT: 3,
    })
    expect(stats.overdueTasks.count).toBe(2)
    expect(stats.prStats).toEqual({ total: 8, merged: 5, open: 2 })
    expect(stats.subtaskCompletionRate).toBeCloseTo(0.75)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/lib/summaries/stats.test.ts --no-coverage`
Expected: FAIL — `Cannot find module '@/lib/summaries/stats'`

- [ ] **Step 3: Commit test**

```bash
git add tests/lib/summaries/stats.test.ts
git commit -m "test: add stats aggregation tests [LUM-21]"
```

---

### Task 4: Stats Aggregation — Implementation

**Files:**

- Create: `lib/summaries/stats.ts`

- [ ] **Step 1: Implement `aggregateProjectStats`**

```typescript
import { prisma } from '@/lib/db/prisma'
import type { TaskSummaryStats, WorkspaceSummaryStats } from '@/types/summary'

export async function aggregateProjectStats(
  projectId: string
): Promise<TaskSummaryStats> {
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  // Run independent queries in parallel
  const [
    statusGroups,
    priorityGroups,
    overdueTasks,
    totalTasks,
    assigneeGroups,
    completedTasks,
    subtaskTotal,
    subtaskDone,
    prTotal,
    prMerged,
    prOpen,
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
    prisma.task.count({ where: { projectId } }),
    prisma.task.groupBy({
      by: ['assigneeActorId'],
      where: { projectId, assigneeActorId: { not: null } },
      _count: { _all: true },
    }),
    prisma.task.findMany({
      where: { projectId, status: 'DONE', updatedAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true, updatedAt: true },
    }),
    prisma.task.count({
      where: { projectId, parentTaskId: { not: null } },
    }),
    prisma.task.count({
      where: { projectId, parentTaskId: { not: null }, status: 'DONE' },
    }),
    prisma.pullRequest.count({
      where: { task: { projectId } },
    }),
    prisma.pullRequest.count({
      where: { task: { projectId }, state: 'merged' },
    }),
    prisma.pullRequest.count({
      where: { task: { projectId }, state: 'open' },
    }),
  ])

  // Status distribution
  const statusDistribution: Record<string, number> = {
    TODO: 0,
    IN_PROGRESS: 0,
    IN_REVIEW: 0,
    DONE: 0,
  }
  for (const g of statusGroups) {
    statusDistribution[g.status] = g._count._all
  }

  // Priority distribution
  const priorityDistribution: Record<string, number> = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    URGENT: 0,
  }
  for (const g of priorityGroups) {
    priorityDistribution[g.priority] = g._count._all
  }

  // Member workload — fetch names for each assignee
  const assigneeIds = assigneeGroups
    .map(g => g.assigneeActorId)
    .filter((id): id is string => id !== null)

  const actors =
    assigneeIds.length > 0
      ? await prisma.task.findMany({
          where: { projectId, assigneeActorId: { in: assigneeIds } },
          select: {
            assigneeActorId: true,
            assignee: {
              select: {
                member: { select: { clerkId: true } },
                agent: { select: { name: true } },
              },
            },
          },
          distinct: ['assigneeActorId'],
        })
      : []

  // Completed tasks per assignee
  const doneByAssignee = await prisma.task.groupBy({
    by: ['assigneeActorId'],
    where: { projectId, status: 'DONE', assigneeActorId: { in: assigneeIds } },
    _count: { _all: true },
  })
  const doneMap = new Map(
    doneByAssignee.map(g => [g.assigneeActorId, g._count._all])
  )

  const memberWorkload = assigneeGroups.map(g => {
    const actor = actors.find(a => a.assigneeActorId === g.assigneeActorId)
    const name =
      actor?.assignee?.agent?.name ??
      actor?.assignee?.member?.clerkId ??
      'Unknown'
    return {
      actorId: g.assigneeActorId!,
      name,
      assigned: g._count._all,
      completed: doneMap.get(g.assigneeActorId) ?? 0,
    }
  })

  // Completion trend (last 30 days)
  const trendMap = new Map<string, number>()
  for (const task of completedTasks) {
    const dateStr = task.updatedAt.toISOString().slice(0, 10)
    trendMap.set(dateStr, (trendMap.get(dateStr) ?? 0) + 1)
  }
  const completionTrend: Array<{ date: string; completed: number }> = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    const dateStr = d.toISOString().slice(0, 10)
    completionTrend.push({
      date: dateStr,
      completed: trendMap.get(dateStr) ?? 0,
    })
  }

  // Average completion time
  let avgCompletionTime: number | null = null
  if (completedTasks.length > 0) {
    const totalHours = completedTasks.reduce((sum, t) => {
      return (
        sum + (t.updatedAt.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60)
      )
    }, 0)
    avgCompletionTime =
      Math.round((totalHours / completedTasks.length) * 10) / 10
  }

  // Agent stats
  const agentGroups = await prisma.task.groupBy({
    by: ['agentStatus'],
    where: { projectId, agentStatus: { not: null } },
    _count: { _all: true },
  })
  const agentStats = { total: 0, completed: 0, failed: 0, working: 0 }
  for (const g of agentGroups) {
    agentStats.total += g._count._all
    if (g.agentStatus === 'COMPLETED') agentStats.completed = g._count._all
    if (g.agentStatus === 'FAILED') agentStats.failed = g._count._all
    if (g.agentStatus === 'WORKING') agentStats.working = g._count._all
  }

  return {
    totalTasks,
    statusDistribution,
    priorityDistribution,
    overdueTasks: {
      count: overdueTasks.length,
      taskIds: overdueTasks.map(t => t.id),
    },
    memberWorkload,
    completionTrend,
    avgCompletionTime,
    subtaskCompletionRate: subtaskTotal > 0 ? subtaskDone / subtaskTotal : null,
    agentStats,
    prStats: { total: prTotal, merged: prMerged, open: prOpen },
  }
}

export async function aggregateWorkspaceStats(
  workspaceId: string
): Promise<WorkspaceSummaryStats> {
  const projects = await prisma.project.findMany({
    where: { workspaceId },
    select: { id: true, name: true },
  })

  // Aggregate all project stats
  const projectStatsEntries = await Promise.all(
    projects.map(async p => {
      const stats = await aggregateProjectStats(p.id)
      return { project: p, stats }
    })
  )

  // Merge into workspace-level stats
  const merged: TaskSummaryStats = {
    totalTasks: 0,
    statusDistribution: { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0 },
    priorityDistribution: { LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 },
    overdueTasks: { count: 0, taskIds: [] },
    memberWorkload: [],
    completionTrend: [],
    avgCompletionTime: null,
    subtaskCompletionRate: null,
    agentStats: { total: 0, completed: 0, failed: 0, working: 0 },
    prStats: { total: 0, merged: 0, open: 0 },
  }

  const workloadMap = new Map<
    string,
    { actorId: string; name: string; assigned: number; completed: number }
  >()
  const trendMap = new Map<string, number>()
  let totalCompTime = 0
  let compTimeCount = 0
  let subtaskTotalAll = 0
  let subtaskDoneAll = 0

  for (const { stats } of projectStatsEntries) {
    merged.totalTasks += stats.totalTasks
    for (const [k, v] of Object.entries(stats.statusDistribution)) {
      merged.statusDistribution[k] = (merged.statusDistribution[k] ?? 0) + v
    }
    for (const [k, v] of Object.entries(stats.priorityDistribution)) {
      merged.priorityDistribution[k] = (merged.priorityDistribution[k] ?? 0) + v
    }
    merged.overdueTasks.count += stats.overdueTasks.count
    merged.overdueTasks.taskIds.push(...stats.overdueTasks.taskIds)

    for (const m of stats.memberWorkload) {
      const existing = workloadMap.get(m.actorId)
      if (existing) {
        existing.assigned += m.assigned
        existing.completed += m.completed
      } else {
        workloadMap.set(m.actorId, { ...m })
      }
    }

    for (const t of stats.completionTrend) {
      trendMap.set(t.date, (trendMap.get(t.date) ?? 0) + t.completed)
    }

    if (stats.avgCompletionTime !== null) {
      totalCompTime += stats.avgCompletionTime * stats.totalTasks
      compTimeCount += stats.totalTasks
    }

    if (stats.subtaskCompletionRate !== null) {
      // Approximate: we don't have raw counts, so weight equally
      subtaskTotalAll += 1
      subtaskDoneAll += stats.subtaskCompletionRate
    }

    merged.agentStats.total += stats.agentStats.total
    merged.agentStats.completed += stats.agentStats.completed
    merged.agentStats.failed += stats.agentStats.failed
    merged.agentStats.working += stats.agentStats.working

    merged.prStats.total += stats.prStats.total
    merged.prStats.merged += stats.prStats.merged
    merged.prStats.open += stats.prStats.open
  }

  merged.memberWorkload = Array.from(workloadMap.values())
  merged.completionTrend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, completed]) => ({ date, completed }))
  merged.avgCompletionTime =
    compTimeCount > 0
      ? Math.round((totalCompTime / compTimeCount) * 10) / 10
      : null
  merged.subtaskCompletionRate =
    subtaskTotalAll > 0
      ? Math.round((subtaskDoneAll / subtaskTotalAll) * 100) / 100
      : null

  const projectBreakdown = projectStatsEntries.map(({ project, stats }) => ({
    projectId: project.id,
    projectName: project.name,
    totalTasks: stats.totalTasks,
    completedTasks: stats.statusDistribution['DONE'] ?? 0,
    overdueTasks: stats.overdueTasks.count,
  }))

  return { ...merged, projectBreakdown }
}
```

- [ ] **Step 2: Run tests**

Run: `npx jest tests/lib/summaries/stats.test.ts --no-coverage`
Expected: Tests pass (some tests may need mock adjustments — fix any mismatches between mock structure and implementation).

- [ ] **Step 3: Commit**

```bash
git add lib/summaries/stats.ts
git commit -m "feat: add stats aggregation for project and workspace summaries [LUM-21]"
```

---

### Task 5: AI Report Generation — Tests

**Files:**

- Create: `tests/lib/summaries/report.test.ts`

- [ ] **Step 1: Write test**

```typescript
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}))

jest.mock('ai', () => ({
  generateObject: jest.fn(),
}))

jest.mock('@ai-sdk/gateway', () => ({
  gateway: jest.fn().mockReturnValue('mock-model'),
}))

import { generateProjectReport } from '@/lib/summaries/report'
import { generateObject } from 'ai'
import type { TaskSummaryStats } from '@/types/summary'

const asMock = (fn: unknown): jest.Mock<any> => fn as jest.Mock<any>

const mockStats: TaskSummaryStats = {
  totalTasks: 36,
  statusDistribution: { TODO: 5, IN_PROGRESS: 8, IN_REVIEW: 3, DONE: 20 },
  priorityDistribution: { LOW: 10, MEDIUM: 15, HIGH: 8, URGENT: 3 },
  overdueTasks: { count: 2, taskIds: ['t1', 't2'] },
  memberWorkload: [{ actorId: 'a1', name: 'Chao', assigned: 12, completed: 8 }],
  completionTrend: [{ date: '2026-04-07', completed: 3 }],
  avgCompletionTime: 18.5,
  subtaskCompletionRate: 0.75,
  agentStats: { total: 5, completed: 4, failed: 1, working: 0 },
  prStats: { total: 8, merged: 5, open: 2 },
}

describe('generateProjectReport', () => {
  it('returns tldr and report from AI', async () => {
    asMock(generateObject).mockResolvedValue({
      object: {
        tldr: 'Good progress this week with 20 tasks done.',
        report:
          '## Progress\n\nTeam completed 20 tasks.\n\n## Risks\n\n2 overdue.\n\n## Actions\n\nFocus on overdue items.',
      },
    })

    const result = await generateProjectReport(mockStats, {
      projectName: 'Backend',
      projectDescription: 'Core backend services',
      locale: 'en',
    })

    expect(result.tldr).toBe('Good progress this week with 20 tasks done.')
    expect(result.report).toContain('## Progress')
    expect(asMock(generateObject)).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest tests/lib/summaries/report.test.ts --no-coverage`
Expected: FAIL — `Cannot find module '@/lib/summaries/report'`

- [ ] **Step 3: Commit**

```bash
git add tests/lib/summaries/report.test.ts
git commit -m "test: add report generation tests [LUM-21]"
```

---

### Task 6: AI Report Generation — Implementation

**Files:**

- Create: `lib/summaries/report.ts`

- [ ] **Step 1: Implement report generation**

```typescript
import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import type { TaskSummaryStats, WorkspaceSummaryStats } from '@/types/summary'

const SUMMARY_SYSTEM_PROMPT_EN = `You are a project status report generator. Given task statistics, produce a concise structured report.

Output two fields:
1. tldr: A single sentence summarizing the current state (data-driven, mention key numbers).
2. report: A Markdown report with exactly three sections:
   ## Progress Overview
   What was accomplished, key metrics, velocity.
   ## Risks & Blockers
   Overdue tasks, resource bottlenecks, failing agents.
   ## Suggested Actions
   Prioritized next steps (2-3 bullet points).

Keep the report under 200 words. Be specific — reference numbers from the data.`

const SUMMARY_SYSTEM_PROMPT_ZH = `你是一个项目状态报告生成器。根据任务统计数据，生成简洁的结构化报告。

输出两个字段：
1. tldr：一句话总结当前状态（数据驱动，提及关键数字）。
2. report：Markdown 报告，包含以下三个部分：
   ## 进展概述
   完成了什么，关键指标，交付速度。
   ## 风险与阻塞
   逾期任务、资源瓶颈、失败的 Agent 任务。
   ## 建议行动
   优先级排序的下一步行动（2-3 条要点）。

报告控制在 200 字以内。要具体——引用数据中的数字。`

export const SummaryReportSchema = z.object({
  tldr: z.string().describe('One-sentence data-driven summary'),
  report: z.string().describe('Structured Markdown report with 3 sections'),
})

export type SummaryReport = z.infer<typeof SummaryReportSchema>

interface ProjectContext {
  projectName: string
  projectDescription: string | null
  locale: string
}

interface WorkspaceContext {
  workspaceName: string
  locale: string
}

function buildProjectPrompt(
  stats: TaskSummaryStats,
  ctx: ProjectContext
): string {
  return `## Project: ${ctx.projectName}
${ctx.projectDescription ? `Description: ${ctx.projectDescription}` : ''}

## Statistics
- Total tasks: ${stats.totalTasks}
- Status: TODO=${stats.statusDistribution['TODO'] ?? 0}, In Progress=${stats.statusDistribution['IN_PROGRESS'] ?? 0}, In Review=${stats.statusDistribution['IN_REVIEW'] ?? 0}, Done=${stats.statusDistribution['DONE'] ?? 0}
- Priority: Low=${stats.priorityDistribution['LOW'] ?? 0}, Medium=${stats.priorityDistribution['MEDIUM'] ?? 0}, High=${stats.priorityDistribution['HIGH'] ?? 0}, Urgent=${stats.priorityDistribution['URGENT'] ?? 0}
- Overdue tasks: ${stats.overdueTasks.count}
- Average completion time: ${stats.avgCompletionTime !== null ? `${stats.avgCompletionTime}h` : 'N/A'}
- Subtask completion rate: ${stats.subtaskCompletionRate !== null ? `${Math.round(stats.subtaskCompletionRate * 100)}%` : 'N/A'}
- Agent tasks: ${stats.agentStats.total} total, ${stats.agentStats.completed} completed, ${stats.agentStats.failed} failed
- Pull requests: ${stats.prStats.total} total, ${stats.prStats.merged} merged, ${stats.prStats.open} open

## Team Workload
${stats.memberWorkload.map(m => `- ${m.name}: ${m.assigned} assigned, ${m.completed} completed`).join('\n')}

## Recent Completion Trend (last 7 days)
${stats.completionTrend
  .slice(-7)
  .map(t => `- ${t.date}: ${t.completed} completed`)
  .join('\n')}`
}

function buildWorkspacePrompt(
  stats: WorkspaceSummaryStats,
  ctx: WorkspaceContext
): string {
  const projectLines = stats.projectBreakdown
    .map(
      p =>
        `- ${p.projectName}: ${p.completedTasks}/${p.totalTasks} done, ${p.overdueTasks} overdue`
    )
    .join('\n')

  return `## Workspace: ${ctx.workspaceName}

## Overall Statistics
- Total tasks across all projects: ${stats.totalTasks}
- Status: TODO=${stats.statusDistribution['TODO'] ?? 0}, In Progress=${stats.statusDistribution['IN_PROGRESS'] ?? 0}, In Review=${stats.statusDistribution['IN_REVIEW'] ?? 0}, Done=${stats.statusDistribution['DONE'] ?? 0}
- Overdue tasks: ${stats.overdueTasks.count}
- Average completion time: ${stats.avgCompletionTime !== null ? `${stats.avgCompletionTime}h` : 'N/A'}
- Agent tasks: ${stats.agentStats.total} total, ${stats.agentStats.completed} completed, ${stats.agentStats.failed} failed

## Project Breakdown
${projectLines}

## Team Workload
${stats.memberWorkload.map(m => `- ${m.name}: ${m.assigned} assigned, ${m.completed} completed`).join('\n')}

## Recent Completion Trend (last 7 days)
${stats.completionTrend
  .slice(-7)
  .map(t => `- ${t.date}: ${t.completed} completed`)
  .join('\n')}`
}

export async function generateProjectReport(
  stats: TaskSummaryStats,
  ctx: ProjectContext
): Promise<SummaryReport> {
  const systemPrompt =
    ctx.locale === 'zh' ? SUMMARY_SYSTEM_PROMPT_ZH : SUMMARY_SYSTEM_PROMPT_EN
  const prompt = buildProjectPrompt(stats, ctx)

  const { object } = await generateObject({
    model: gateway('anthropic/claude-sonnet-4.5'),
    schema: SummaryReportSchema,
    system: systemPrompt,
    prompt,
  })

  return object
}

export async function generateWorkspaceReport(
  stats: WorkspaceSummaryStats,
  ctx: WorkspaceContext
): Promise<SummaryReport> {
  const systemPrompt =
    ctx.locale === 'zh' ? SUMMARY_SYSTEM_PROMPT_ZH : SUMMARY_SYSTEM_PROMPT_EN
  const prompt = buildWorkspacePrompt(stats, ctx)

  const { object } = await generateObject({
    model: gateway('anthropic/claude-sonnet-4.5'),
    schema: SummaryReportSchema,
    system: systemPrompt,
    prompt,
  })

  return object
}
```

- [ ] **Step 2: Run tests**

Run: `npx jest tests/lib/summaries/report.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add lib/summaries/report.ts
git commit -m "feat: add AI report generation for summaries [LUM-21]"
```

---

### Task 7: Validation Schemas

**Files:**

- Modify: `lib/validation/schemas.ts`

- [ ] **Step 1: Add summary validation schemas**

Add at the end of the file:

```typescript
// ─── Summaries ────────────────────────────────────────────────────────────────

export const generateSummarySchema = z.object({
  workspaceId: z.string().optional(),
  secret: z.string().min(1, 'Secret is required'),
})

export const getSummarySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(1),
  before: z.string().datetime().optional(),
})
```

- [ ] **Step 2: Commit**

```bash
git add lib/validation/schemas.ts
git commit -m "feat: add summary validation schemas [LUM-21]"
```

---

### Task 8: API Route — Generate Summaries

**Files:**

- Create: `app/api/summaries/generate/route.ts`

- [ ] **Step 1: Implement generate endpoint**

```typescript
import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db/prisma'
import { generateSummarySchema } from '@/lib/validation/schemas'
import {
  aggregateProjectStats,
  aggregateWorkspaceStats,
} from '@/lib/summaries/stats'
import {
  generateProjectReport,
  generateWorkspaceReport,
} from '@/lib/summaries/report'

function isDueForGeneration(
  frequency: string,
  lastGenerated: Date | null
): boolean {
  if (!lastGenerated) return true

  const now = new Date()
  const diffMs = now.getTime() - lastGenerated.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)

  switch (frequency) {
    case 'DAILY':
      return diffDays >= 1
    case 'EVERY_TWO_DAYS':
      return diffDays >= 2
    case 'WEEKLY':
      return diffDays >= 7
    default:
      return diffDays >= 1
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = generateSummarySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { secret, workspaceId } = parsed.data

    if (secret !== process.env.SUMMARY_CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Find workspaces to process
    const workspaces = await prisma.workspace.findMany({
      where: {
        summaryEnabled: true,
        ...(workspaceId ? { id: workspaceId } : {}),
      },
      select: {
        id: true,
        name: true,
        summaryFrequency: true,
        summaryLocale: true,
        projects: { select: { id: true, name: true, description: true } },
      },
    })

    const results: Array<{
      workspaceId: string
      projectCount: number
      status: string
    }> = []

    for (const workspace of workspaces) {
      // Check if due for generation
      const lastSummary = await prisma.workspaceSummary.findFirst({
        where: { workspaceId: workspace.id },
        orderBy: { generatedAt: 'desc' },
        select: { generatedAt: true },
      })

      if (
        !isDueForGeneration(
          workspace.summaryFrequency,
          lastSummary?.generatedAt ?? null
        )
      ) {
        results.push({
          workspaceId: workspace.id,
          projectCount: 0,
          status: 'skipped',
        })
        continue
      }

      // Generate project summaries
      for (const project of workspace.projects) {
        const stats = await aggregateProjectStats(project.id)

        let tldr = ''
        let report = ''
        try {
          const aiReport = await generateProjectReport(stats, {
            projectName: project.name,
            projectDescription: project.description,
            locale: workspace.summaryLocale,
          })
          tldr = aiReport.tldr
          report = aiReport.report
        } catch (err) {
          console.error(
            `AI report generation failed for project ${project.id}:`,
            err
          )
          tldr = 'Report generation failed'
          report = ''
        }

        await prisma.projectSummary.create({
          data: {
            projectId: project.id,
            stats: stats as any,
            tldr,
            report,
          },
        })
      }

      // Generate workspace summary
      const workspaceStats = await aggregateWorkspaceStats(workspace.id)

      let wsTldr = ''
      let wsReport = ''
      try {
        const aiReport = await generateWorkspaceReport(workspaceStats, {
          workspaceName: workspace.name,
          locale: workspace.summaryLocale,
        })
        wsTldr = aiReport.tldr
        wsReport = aiReport.report
      } catch (err) {
        console.error(
          `AI report generation failed for workspace ${workspace.id}:`,
          err
        )
        wsTldr = 'Report generation failed'
        wsReport = ''
      }

      await prisma.workspaceSummary.create({
        data: {
          workspaceId: workspace.id,
          stats: workspaceStats as any,
          tldr: wsTldr,
          report: wsReport,
        },
      })

      results.push({
        workspaceId: workspace.id,
        projectCount: workspace.projects.length,
        status: 'generated',
      })
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error('POST /api/summaries/generate error:', error)
    return NextResponse.json(
      { error: 'Failed to generate summaries' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/summaries/generate/route.ts
git commit -m "feat: add summary generation API route [LUM-21]"
```

---

### Task 9: API Route — Get Project Summaries

**Files:**

- Create: `app/api/summaries/project/[projectId]/route.ts`

- [ ] **Step 1: Implement GET endpoint**

```typescript
import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { prisma } from '@/lib/db/prisma'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const { projectId } = await params

    // Verify access
    const projectResult = await loadProjectAndMember(projectId, userId)
    if (projectResult instanceof NextResponse) return projectResult

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '1', 10), 50)
    const before = searchParams.get('before')

    const summaries = await prisma.projectSummary.findMany({
      where: {
        projectId,
        ...(before ? { generatedAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { generatedAt: 'desc' },
      take: limit,
    })

    return NextResponse.json(summaries)
  } catch (error) {
    console.error('GET /api/summaries/project/[projectId] error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch project summaries' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/summaries/project/
git commit -m "feat: add get project summary API route [LUM-21]"
```

---

### Task 10: API Route — Get Workspace Summaries

**Files:**

- Create: `app/api/summaries/workspace/route.ts`

- [ ] **Step 1: Implement GET endpoint**

```typescript
import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'

export async function GET(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    // Find user's workspace
    const member = await prisma.workspaceMember.findFirst({
      where: { clerkId: userId },
      select: { workspaceId: true },
    })

    if (!member) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      )
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '1', 10), 50)
    const before = searchParams.get('before')

    const summaries = await prisma.workspaceSummary.findMany({
      where: {
        workspaceId: member.workspaceId,
        ...(before ? { generatedAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { generatedAt: 'desc' },
      take: limit,
    })

    return NextResponse.json(summaries)
  } catch (error) {
    console.error('GET /api/summaries/workspace error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch workspace summaries' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/summaries/workspace/
git commit -m "feat: add get workspace summary API route [LUM-21]"
```

---

### Task 11: i18n Keys

**Files:**

- Modify: `lib/i18n/en.json`
- Modify: `lib/i18n/zh.json`

- [ ] **Step 1: Add English i18n keys**

Add these keys to `lib/i18n/en.json`:

```json
  "sidebar.dashboard": "Dashboard",
  "summary.title": "Summary",
  "summary.tldr": "TL;DR",
  "summary.showReport": "Show full report",
  "summary.hideReport": "Hide report",
  "summary.generatedAt": "Generated {date}",
  "summary.totalTasks": "Total Tasks",
  "summary.completed": "Completed",
  "summary.overdue": "Overdue",
  "summary.avgCompletion": "Avg Completion",
  "summary.statusDistribution": "Status Distribution",
  "summary.memberWorkload": "Member Workload",
  "summary.completionTrend": "Completion Trend",
  "summary.priorityDistribution": "Priority Distribution",
  "summary.subtaskRate": "Subtask Completion",
  "summary.agentStats": "Agent Tasks",
  "summary.prStats": "Pull Requests",
  "summary.viewHistory": "View history",
  "summary.noSummary": "Summary will be generated on the next scheduled run",
  "summary.reportFailed": "Report generation failed. Will retry on next run.",
  "summary.settings": "Summary Settings",
  "summary.enabled": "Enable Summary",
  "summary.frequency": "Generation Frequency",
  "summary.daily": "Daily",
  "summary.everyTwoDays": "Every Two Days",
  "summary.weekly": "Weekly",
  "summary.dashboard": "Dashboard",
  "summary.projectProgress": "Project Progress",
  "summary.hours": "{count}h",
  "summary.locale": "Report Language",
  "summary.additionalStats": "Additional Stats",
  "summary.todo": "TODO",
  "summary.inProgress": "In Progress",
  "summary.inReview": "In Review",
  "summary.done": "Done",
  "summary.assigned": "Assigned",
  "summary.total": "Total",
  "summary.merged": "Merged",
  "summary.open": "Open",
  "summary.failed": "Failed",
  "summary.working": "Working"
```

- [ ] **Step 2: Add Chinese i18n keys**

Add these keys to `lib/i18n/zh.json`:

```json
  "sidebar.dashboard": "仪表盘",
  "summary.title": "摘要",
  "summary.tldr": "TL;DR",
  "summary.showReport": "展开完整报告",
  "summary.hideReport": "收起报告",
  "summary.generatedAt": "生成于 {date}",
  "summary.totalTasks": "总任务数",
  "summary.completed": "已完成",
  "summary.overdue": "已逾期",
  "summary.avgCompletion": "平均完成时间",
  "summary.statusDistribution": "状态分布",
  "summary.memberWorkload": "成员工作量",
  "summary.completionTrend": "完成趋势",
  "summary.priorityDistribution": "优先级分布",
  "summary.subtaskRate": "子任务完成率",
  "summary.agentStats": "Agent 任务",
  "summary.prStats": "PR 统计",
  "summary.viewHistory": "查看历史",
  "summary.noSummary": "摘要将在下次定时任务时生成",
  "summary.reportFailed": "报告生成失败，将在下次重试",
  "summary.settings": "摘要设置",
  "summary.enabled": "启用摘要",
  "summary.frequency": "生成频率",
  "summary.daily": "每日",
  "summary.everyTwoDays": "每两天",
  "summary.weekly": "每周",
  "summary.dashboard": "仪表盘",
  "summary.projectProgress": "项目进度",
  "summary.hours": "{count}h",
  "summary.locale": "报告语言",
  "summary.additionalStats": "更多统计",
  "summary.todo": "待办",
  "summary.inProgress": "进行中",
  "summary.inReview": "评审中",
  "summary.done": "已完成",
  "summary.assigned": "已分配",
  "summary.total": "总计",
  "summary.merged": "已合并",
  "summary.open": "未关闭",
  "summary.failed": "失败",
  "summary.working": "执行中"
```

- [ ] **Step 3: Commit**

```bash
git add lib/i18n/en.json lib/i18n/zh.json
git commit -m "feat: add summary i18n keys [LUM-21]"
```

---

### Task 12: API Constants

**Files:**

- Modify: `app/workspace/[workspaceUrl]/constants.ts`

- [ ] **Step 1: Add summary API routes to constants**

Add inside the `API` object:

```typescript
  summaries: {
    generate: '/api/summaries/generate',
    project: (projectId: string) => `/api/summaries/project/${projectId}`,
    workspace: '/api/summaries/workspace',
  },
```

- [ ] **Step 2: Add cache key**

Add to `CACHE_KEY`:

```typescript
  projectSummary: (projectId: string) => `lumo:summary:project:${projectId}`,
  workspaceSummary: 'lumo:summary:workspace',
```

- [ ] **Step 3: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/constants.ts
git commit -m "feat: add summary API and cache constants [LUM-21]"
```

---

### Task 13: Page Type Update

**Files:**

- Modify: `app/workspace/[workspaceUrl]/types.ts`

- [ ] **Step 1: Add 'dashboard' to Page type**

Change the `Page` type to include `'dashboard'`:

```typescript
export type Page =
  | 'my-tasks'
  | 'projects'
  | 'project-detail'
  | 'inbox'
  | 'task-detail'
  | 'documents'
  | 'document-editor'
  | 'drafts'
  | 'dashboard'
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/types.ts
git commit -m "feat: add dashboard to Page type [LUM-21]"
```

---

### Task 14: useSummary Hook

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/useSummary.ts`

- [ ] **Step 1: Implement the hook**

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { API, CACHE_KEY } from '../constants'
import { readCache, writeCache } from '../cache'
import type { ApiProjectSummary, ApiWorkspaceSummary } from '@/types/summary'

interface UseProjectSummaryReturn {
  summary: ApiProjectSummary | null
  history: ApiProjectSummary[]
  loading: boolean
  error: string | null
  loadHistory: () => void
  historyLoading: boolean
}

export function useProjectSummary(projectId: string): UseProjectSummaryReturn {
  const [summary, setSummary] = useState<ApiProjectSummary | null>(() => {
    return (
      readCache<ApiProjectSummary>(CACHE_KEY.projectSummary(projectId)) ?? null
    )
  })
  const [history, setHistory] = useState<ApiProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchSummary() {
      try {
        const res = await fetch(`${API.summaries.project(projectId)}?limit=1`)
        if (!res.ok) throw new Error('Failed to fetch summary')
        const data: ApiProjectSummary[] = await res.json()
        if (cancelled) return
        const latest = data[0] ?? null
        setSummary(latest)
        if (latest) writeCache(CACHE_KEY.projectSummary(projectId), latest)
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchSummary()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await fetch(`${API.summaries.project(projectId)}?limit=30`)
      if (!res.ok) throw new Error('Failed to fetch history')
      const data: ApiProjectSummary[] = await res.json()
      setHistory(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setHistoryLoading(false)
    }
  }, [projectId])

  return { summary, history, loading, error, loadHistory, historyLoading }
}

interface UseWorkspaceSummaryReturn {
  summary: ApiWorkspaceSummary | null
  history: ApiWorkspaceSummary[]
  loading: boolean
  error: string | null
  loadHistory: () => void
  historyLoading: boolean
}

export function useWorkspaceSummary(): UseWorkspaceSummaryReturn {
  const [summary, setSummary] = useState<ApiWorkspaceSummary | null>(() => {
    return readCache<ApiWorkspaceSummary>(CACHE_KEY.workspaceSummary) ?? null
  })
  const [history, setHistory] = useState<ApiWorkspaceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchSummary() {
      try {
        const res = await fetch(`${API.summaries.workspace}?limit=1`)
        if (!res.ok) throw new Error('Failed to fetch summary')
        const data: ApiWorkspaceSummary[] = await res.json()
        if (cancelled) return
        const latest = data[0] ?? null
        setSummary(latest)
        if (latest) writeCache(CACHE_KEY.workspaceSummary, latest)
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchSummary()
    return () => {
      cancelled = true
    }
  }, [])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await fetch(`${API.summaries.workspace}?limit=30`)
      if (!res.ok) throw new Error('Failed to fetch history')
      const data: ApiWorkspaceSummary[] = await res.json()
      setHistory(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  return { summary, history, loading, error, loadHistory, historyLoading }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/hooks/useSummary.ts
git commit -m "feat: add useSummary hooks [LUM-21]"
```

---

### Task 15: SummaryReportCard Component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/summary/SummaryReportCard.tsx`

- [ ] **Step 1: Implement the component**

```tsx
'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Bot } from 'lucide-react'
import { useIntl } from 'react-intl'
import { cn } from '@/lib/utils'

interface SummaryReportCardProps {
  tldr: string
  report: string
  generatedAt: string
}

export function SummaryReportCard({
  tldr,
  report,
  generatedAt,
}: SummaryReportCardProps) {
  const [expanded, setExpanded] = useState(false)
  const intl = useIntl()

  const dateStr = new Date(generatedAt).toLocaleDateString()

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4'>
      <div className='flex items-center justify-between mb-2'>
        <div className='flex items-center gap-1.5 text-xs text-zinc-500'>
          <Bot size={14} />
          <span>
            {intl.formatMessage(
              { id: 'summary.generatedAt' },
              { date: dateStr }
            )}
          </span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className='flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors'
        >
          {expanded
            ? intl.formatMessage({ id: 'summary.hideReport' })
            : intl.formatMessage({ id: 'summary.showReport' })}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      <p className='text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed'>
        {tldr}
      </p>

      {expanded && report && (
        <div
          className={cn(
            'mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800',
            'prose prose-sm dark:prose-invert max-w-none',
            'prose-headings:text-sm prose-headings:font-semibold prose-headings:mb-1 prose-headings:mt-3',
            'prose-p:text-xs prose-p:text-zinc-600 dark:prose-p:text-zinc-400 prose-p:leading-relaxed',
            'prose-li:text-xs prose-li:text-zinc-600 dark:prose-li:text-zinc-400'
          )}
          dangerouslySetInnerHTML={{ __html: report.replace(/\n/g, '<br>') }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/summary/SummaryReportCard.tsx
git commit -m "feat: add SummaryReportCard component [LUM-21]"
```

---

### Task 16: StatsCardRow Component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/summary/StatsCardRow.tsx`

- [ ] **Step 1: Implement the component**

```tsx
'use client'

import { useIntl } from 'react-intl'
import type { TaskSummaryStats } from '@/types/summary'

interface StatsCardRowProps {
  stats: TaskSummaryStats
}

export function StatsCardRow({ stats }: StatsCardRowProps) {
  const intl = useIntl()

  const cards = [
    {
      value: stats.totalTasks,
      label: intl.formatMessage({ id: 'summary.totalTasks' }),
      color: 'text-zinc-900 dark:text-zinc-100',
    },
    {
      value: stats.statusDistribution['DONE'] ?? 0,
      label: intl.formatMessage({ id: 'summary.completed' }),
      color: 'text-green-500',
    },
    {
      value: stats.overdueTasks.count,
      label: intl.formatMessage({ id: 'summary.overdue' }),
      color:
        stats.overdueTasks.count > 0
          ? 'text-amber-500'
          : 'text-zinc-900 dark:text-zinc-100',
    },
    {
      value:
        stats.avgCompletionTime !== null
          ? intl.formatMessage(
              { id: 'summary.hours' },
              { count: stats.avgCompletionTime }
            )
          : 'N/A',
      label: intl.formatMessage({ id: 'summary.avgCompletion' }),
      color: 'text-indigo-400',
    },
  ]

  return (
    <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
      {cards.map(card => (
        <div
          key={card.label}
          className='rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-center'
        >
          <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
          <div className='text-xs text-zinc-500 mt-1'>{card.label}</div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/summary/StatsCardRow.tsx
git commit -m "feat: add StatsCardRow component [LUM-21]"
```

---

### Task 17: Chart Components

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/summary/StatusDistributionChart.tsx`
- Create: `app/workspace/[workspaceUrl]/components/summary/MemberWorkloadChart.tsx`
- Create: `app/workspace/[workspaceUrl]/components/summary/CompletionTrendChart.tsx`

- [ ] **Step 1: Implement StatusDistributionChart**

```tsx
'use client'

import { useIntl } from 'react-intl'

interface StatusDistributionChartProps {
  distribution: Record<string, number>
}

const STATUS_COLORS: Record<string, string> = {
  TODO: 'bg-zinc-400',
  IN_PROGRESS: 'bg-blue-500',
  IN_REVIEW: 'bg-purple-500',
  DONE: 'bg-green-400',
}

const STATUS_I18N: Record<string, string> = {
  TODO: 'summary.todo',
  IN_PROGRESS: 'summary.inProgress',
  IN_REVIEW: 'summary.inReview',
  DONE: 'summary.done',
}

export function StatusDistributionChart({
  distribution,
}: StatusDistributionChartProps) {
  const intl = useIntl()
  const total = Object.values(distribution).reduce((a, b) => a + b, 0)

  if (total === 0) return null

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4'>
      <div className='text-xs text-zinc-500 mb-3'>
        {intl.formatMessage({ id: 'summary.statusDistribution' })}
      </div>
      <div className='flex gap-0.5 h-2 rounded-full overflow-hidden'>
        {Object.entries(distribution).map(([status, count]) =>
          count > 0 ? (
            <div
              key={status}
              className={`${STATUS_COLORS[status] ?? 'bg-zinc-300'}`}
              style={{ flex: count }}
            />
          ) : null
        )}
      </div>
      <div className='flex flex-wrap gap-x-3 gap-y-1 mt-2'>
        {Object.entries(distribution).map(([status, count]) => (
          <span
            key={status}
            className='flex items-center gap-1 text-[11px] text-zinc-500'
          >
            <span
              className={`w-2 h-2 rounded-full ${STATUS_COLORS[status] ?? 'bg-zinc-300'}`}
            />
            {intl.formatMessage({ id: STATUS_I18N[status] ?? 'summary.todo' })}{' '}
            {count}
          </span>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Implement MemberWorkloadChart**

```tsx
'use client'

import { useIntl } from 'react-intl'

interface MemberWorkloadChartProps {
  workload: Array<{
    actorId: string
    name: string
    assigned: number
    completed: number
  }>
}

export function MemberWorkloadChart({ workload }: MemberWorkloadChartProps) {
  const intl = useIntl()
  const maxAssigned = Math.max(...workload.map(m => m.assigned), 1)

  if (workload.length === 0) return null

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4'>
      <div className='text-xs text-zinc-500 mb-3'>
        {intl.formatMessage({ id: 'summary.memberWorkload' })}
      </div>
      <div className='space-y-2.5'>
        {workload.slice(0, 8).map(member => (
          <div key={member.actorId}>
            <div className='flex justify-between text-[11px] text-zinc-600 dark:text-zinc-400 mb-1'>
              <span className='truncate max-w-[120px]'>{member.name}</span>
              <span>
                {member.assigned}{' '}
                {intl.formatMessage({ id: 'summary.assigned' })}
              </span>
            </div>
            <div className='h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full'>
              <div
                className='h-full bg-blue-500 rounded-full transition-all'
                style={{ width: `${(member.assigned / maxAssigned) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Implement CompletionTrendChart**

```tsx
'use client'

import { useIntl } from 'react-intl'

interface CompletionTrendChartProps {
  trend: Array<{ date: string; completed: number }>
}

export function CompletionTrendChart({ trend }: CompletionTrendChartProps) {
  const intl = useIntl()
  const recentTrend = trend.slice(-7)
  const maxCompleted = Math.max(...recentTrend.map(t => t.completed), 1)

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4'>
      <div className='text-xs text-zinc-500 mb-3'>
        {intl.formatMessage({ id: 'summary.completionTrend' })}
      </div>
      <div className='flex items-end gap-1 h-12'>
        {recentTrend.map(day => (
          <div
            key={day.date}
            className='flex-1 bg-green-400 rounded-t transition-all min-h-[2px]'
            style={{ height: `${(day.completed / maxCompleted) * 100}%` }}
            title={`${day.date}: ${day.completed}`}
          />
        ))}
      </div>
      <div className='flex justify-between mt-1'>
        {recentTrend.map(day => (
          <span
            key={day.date}
            className='text-[9px] text-zinc-400 flex-1 text-center'
          >
            {new Date(day.date)
              .toLocaleDateString(undefined, { weekday: 'short' })
              .slice(0, 3)}
          </span>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/summary/StatusDistributionChart.tsx \
       app/workspace/\[workspaceUrl\]/components/summary/MemberWorkloadChart.tsx \
       app/workspace/\[workspaceUrl\]/components/summary/CompletionTrendChart.tsx
git commit -m "feat: add summary chart components [LUM-21]"
```

---

### Task 18: AdditionalStats Component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/summary/AdditionalStats.tsx`

- [ ] **Step 1: Implement the component**

```tsx
'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useIntl } from 'react-intl'
import type { TaskSummaryStats } from '@/types/summary'

interface AdditionalStatsProps {
  stats: TaskSummaryStats
}

export function AdditionalStats({ stats }: AdditionalStatsProps) {
  const [expanded, setExpanded] = useState(false)
  const intl = useIntl()

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className='flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors'
      >
        {intl.formatMessage({ id: 'summary.additionalStats' })}
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && (
        <div className='grid grid-cols-2 md:grid-cols-4 gap-3 mt-3'>
          {/* Priority Distribution */}
          <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3'>
            <div className='text-xs text-zinc-500 mb-2'>
              {intl.formatMessage({ id: 'summary.priorityDistribution' })}
            </div>
            <div className='space-y-1 text-[11px]'>
              {Object.entries(stats.priorityDistribution).map(
                ([priority, count]) => (
                  <div
                    key={priority}
                    className='flex justify-between text-zinc-600 dark:text-zinc-400'
                  >
                    <span>{priority}</span>
                    <span>{count}</span>
                  </div>
                )
              )}
            </div>
          </div>

          {/* Subtask Completion */}
          <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3'>
            <div className='text-xs text-zinc-500 mb-2'>
              {intl.formatMessage({ id: 'summary.subtaskRate' })}
            </div>
            <div className='text-xl font-bold text-zinc-900 dark:text-zinc-100'>
              {stats.subtaskCompletionRate !== null
                ? `${Math.round(stats.subtaskCompletionRate * 100)}%`
                : 'N/A'}
            </div>
          </div>

          {/* Agent Stats */}
          <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3'>
            <div className='text-xs text-zinc-500 mb-2'>
              {intl.formatMessage({ id: 'summary.agentStats' })}
            </div>
            <div className='space-y-1 text-[11px] text-zinc-600 dark:text-zinc-400'>
              <div className='flex justify-between'>
                <span>{intl.formatMessage({ id: 'summary.total' })}</span>
                <span>{stats.agentStats.total}</span>
              </div>
              <div className='flex justify-between'>
                <span>{intl.formatMessage({ id: 'summary.completed' })}</span>
                <span>{stats.agentStats.completed}</span>
              </div>
              <div className='flex justify-between'>
                <span>{intl.formatMessage({ id: 'summary.failed' })}</span>
                <span>{stats.agentStats.failed}</span>
              </div>
              <div className='flex justify-between'>
                <span>{intl.formatMessage({ id: 'summary.working' })}</span>
                <span>{stats.agentStats.working}</span>
              </div>
            </div>
          </div>

          {/* PR Stats */}
          <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3'>
            <div className='text-xs text-zinc-500 mb-2'>
              {intl.formatMessage({ id: 'summary.prStats' })}
            </div>
            <div className='space-y-1 text-[11px] text-zinc-600 dark:text-zinc-400'>
              <div className='flex justify-between'>
                <span>{intl.formatMessage({ id: 'summary.total' })}</span>
                <span>{stats.prStats.total}</span>
              </div>
              <div className='flex justify-between'>
                <span>{intl.formatMessage({ id: 'summary.merged' })}</span>
                <span>{stats.prStats.merged}</span>
              </div>
              <div className='flex justify-between'>
                <span>{intl.formatMessage({ id: 'summary.open' })}</span>
                <span>{stats.prStats.open}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/summary/AdditionalStats.tsx
git commit -m "feat: add AdditionalStats component [LUM-21]"
```

---

### Task 19: SummaryHistory Component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/summary/SummaryHistory.tsx`

- [ ] **Step 1: Implement the component**

```tsx
'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useIntl } from 'react-intl'
import type { ApiProjectSummary, ApiWorkspaceSummary } from '@/types/summary'

interface SummaryHistoryProps {
  history: (ApiProjectSummary | ApiWorkspaceSummary)[]
  loading: boolean
  onLoad: () => void
}

export function SummaryHistory({
  history,
  loading,
  onLoad,
}: SummaryHistoryProps) {
  const intl = useIntl()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const handleLoad = () => {
    if (!loaded) {
      onLoad()
      setLoaded(true)
    }
  }

  return (
    <div>
      <button
        onClick={handleLoad}
        className='text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors'
      >
        {intl.formatMessage({ id: 'summary.viewHistory' })} →
      </button>

      {loaded && (
        <div className='mt-3 space-y-2'>
          {loading && <div className='text-xs text-zinc-400'>Loading...</div>}
          {!loading && history.length === 0 && (
            <div className='text-xs text-zinc-400'>
              {intl.formatMessage({ id: 'summary.noSummary' })}
            </div>
          )}
          {history.map(entry => (
            <div
              key={entry.id}
              className='rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3'
            >
              <button
                onClick={() =>
                  setExpandedId(expandedId === entry.id ? null : entry.id)
                }
                className='w-full flex items-center justify-between text-left'
              >
                <div>
                  <div className='text-[11px] text-zinc-400'>
                    {new Date(entry.generatedAt).toLocaleDateString()}
                  </div>
                  <div className='text-xs text-zinc-600 dark:text-zinc-400 mt-0.5'>
                    {entry.tldr}
                  </div>
                </div>
                {expandedId === entry.id ? (
                  <ChevronUp size={14} className='text-zinc-400 shrink-0' />
                ) : (
                  <ChevronDown size={14} className='text-zinc-400 shrink-0' />
                )}
              </button>

              {expandedId === entry.id && entry.report && (
                <div className='mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap'>
                  {entry.report}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/summary/SummaryHistory.tsx
git commit -m "feat: add SummaryHistory component [LUM-21]"
```

---

### Task 20: ProjectSummaryTab Component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/summary/ProjectSummaryTab.tsx`

- [ ] **Step 1: Implement the composite component**

```tsx
'use client'

import { useIntl } from 'react-intl'
import { useProjectSummary } from '../../hooks/useSummary'
import { SummaryReportCard } from './SummaryReportCard'
import { StatsCardRow } from './StatsCardRow'
import { StatusDistributionChart } from './StatusDistributionChart'
import { MemberWorkloadChart } from './MemberWorkloadChart'
import { CompletionTrendChart } from './CompletionTrendChart'
import { AdditionalStats } from './AdditionalStats'
import { SummaryHistory } from './SummaryHistory'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'

interface ProjectSummaryTabProps {
  projectId: string
}

export function ProjectSummaryTab({ projectId }: ProjectSummaryTabProps) {
  const intl = useIntl()
  const { summary, history, loading, loadHistory, historyLoading } =
    useProjectSummary(projectId)

  if (loading) {
    return (
      <div className='flex items-center justify-center py-16'>
        <div className='text-sm text-zinc-400'>Loading...</div>
      </div>
    )
  }

  if (!summary) {
    return (
      <Empty>
        <EmptyContent>
          <EmptyHeader>
            <EmptyTitle>
              {intl.formatMessage({ id: 'summary.title' })}
            </EmptyTitle>
            <EmptyDescription>
              {intl.formatMessage({ id: 'summary.noSummary' })}
            </EmptyDescription>
          </EmptyHeader>
        </EmptyContent>
      </Empty>
    )
  }

  const stats = summary.stats

  return (
    <div className='space-y-4 px-4 md:px-8 py-6'>
      {/* AI Report */}
      <SummaryReportCard
        tldr={summary.tldr}
        report={summary.report}
        generatedAt={summary.generatedAt}
      />

      {/* Stats Cards */}
      <StatsCardRow stats={stats} />

      {/* Charts */}
      <div className='grid grid-cols-1 md:grid-cols-3 gap-3'>
        <StatusDistributionChart distribution={stats.statusDistribution} />
        <MemberWorkloadChart workload={stats.memberWorkload} />
        <CompletionTrendChart trend={stats.completionTrend} />
      </div>

      {/* Additional Stats */}
      <AdditionalStats stats={stats} />

      {/* History */}
      <SummaryHistory
        history={history}
        loading={historyLoading}
        onLoad={loadHistory}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/summary/ProjectSummaryTab.tsx
git commit -m "feat: add ProjectSummaryTab component [LUM-21]"
```

---

### Task 21: Add Summary Tab to Project Detail Page

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/ProjectDetailPage.tsx`

- [ ] **Step 1: Add import**

Add at the top with other imports:

```typescript
import { ProjectSummaryTab } from '../summary/ProjectSummaryTab'
```

- [ ] **Step 2: Update tab state type**

Change line 150:

```typescript
const [tab, setTab] = useState<'overview' | 'tasks' | 'summary'>('overview')
```

- [ ] **Step 3: Update tab buttons**

Change line 384:

```typescript
{(['overview', 'tasks', 'summary'] as const).map(t => (
```

- [ ] **Step 4: Add summary tab content**

After the tasks tab block (after the closing of `{tab === 'tasks' && (...)}`) add:

```tsx
{
  tab === 'summary' && (
    <div className='flex-1 overflow-y-auto'>
      <ProjectSummaryTab projectId={project.id} />
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/pages/ProjectDetailPage.tsx
git commit -m "feat: add Summary tab to project detail page [LUM-21]"
```

---

### Task 22: DashboardPage Component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/pages/DashboardPage.tsx`

- [ ] **Step 1: Implement the dashboard page**

```tsx
'use client'

import { useIntl } from 'react-intl'
import { useWorkspaceSummary } from '../../hooks/useSummary'
import { SummaryReportCard } from '../summary/SummaryReportCard'
import { StatsCardRow } from '../summary/StatsCardRow'
import { StatusDistributionChart } from '../summary/StatusDistributionChart'
import { MemberWorkloadChart } from '../summary/MemberWorkloadChart'
import { CompletionTrendChart } from '../summary/CompletionTrendChart'
import { AdditionalStats } from '../summary/AdditionalStats'
import { SummaryHistory } from '../summary/SummaryHistory'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { TypographyH3 } from '@/components/ui/typography'

interface DashboardPageProps {
  onNavigateToProject: (projectId: string) => void
}

export function DashboardPage({ onNavigateToProject }: DashboardPageProps) {
  const intl = useIntl()
  const { summary, history, loading, loadHistory, historyLoading } =
    useWorkspaceSummary()

  if (loading) {
    return (
      <div className='flex items-center justify-center py-16'>
        <div className='text-sm text-zinc-400'>Loading...</div>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className='px-4 md:px-8 py-6'>
        <TypographyH3>
          {intl.formatMessage({ id: 'summary.dashboard' })}
        </TypographyH3>
        <Empty>
          <EmptyContent>
            <EmptyHeader>
              <EmptyTitle>
                {intl.formatMessage({ id: 'summary.title' })}
              </EmptyTitle>
              <EmptyDescription>
                {intl.formatMessage({ id: 'summary.noSummary' })}
              </EmptyDescription>
            </EmptyHeader>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  const stats = summary.stats

  return (
    <div className='space-y-4 px-4 md:px-8 py-6'>
      <TypographyH3>
        {intl.formatMessage({ id: 'summary.dashboard' })}
      </TypographyH3>

      {/* AI Report */}
      <SummaryReportCard
        tldr={summary.tldr}
        report={summary.report}
        generatedAt={summary.generatedAt}
      />

      {/* Stats Cards */}
      <StatsCardRow stats={stats} />

      {/* Project Progress Table */}
      {'projectBreakdown' in stats && (
        <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4'>
          <div className='text-xs text-zinc-500 mb-3'>
            {intl.formatMessage({ id: 'summary.projectProgress' })}
          </div>
          <div className='space-y-2'>
            {stats.projectBreakdown.map((project: any) => {
              const progress =
                project.totalTasks > 0
                  ? (project.completedTasks / project.totalTasks) * 100
                  : 0

              return (
                <button
                  key={project.projectId}
                  onClick={() => onNavigateToProject(project.projectId)}
                  className='w-full flex items-center gap-3 p-2 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors text-left'
                >
                  <span className='text-sm text-zinc-700 dark:text-zinc-300 flex-1 truncate'>
                    {project.projectName}
                  </span>
                  <span className='text-[11px] text-zinc-500 shrink-0'>
                    {project.completedTasks}/{project.totalTasks}
                  </span>
                  {project.overdueTasks > 0 && (
                    <span className='text-[11px] text-amber-500 shrink-0'>
                      {project.overdueTasks}{' '}
                      {intl.formatMessage({ id: 'summary.overdue' })}
                    </span>
                  )}
                  <div className='w-24 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full shrink-0'>
                    <div
                      className='h-full bg-green-400 rounded-full'
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className='grid grid-cols-1 md:grid-cols-3 gap-3'>
        <StatusDistributionChart distribution={stats.statusDistribution} />
        <MemberWorkloadChart workload={stats.memberWorkload} />
        <CompletionTrendChart trend={stats.completionTrend} />
      </div>

      {/* Additional Stats */}
      <AdditionalStats stats={stats} />

      {/* History */}
      <SummaryHistory
        history={history}
        loading={historyLoading}
        onLoad={loadHistory}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/pages/DashboardPage.tsx
git commit -m "feat: add DashboardPage component [LUM-21]"
```

---

### Task 23: Add Dashboard to Sidebar

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/Sidebar.tsx`

- [ ] **Step 1: Add BarChart3 icon import**

Add `BarChart3` to the lucide-react import:

```typescript
import {
  Home,
  FolderKanban,
  FileText,
  Inbox,
  LogOut,
  ChevronsUpDown,
  Users,
  Settings,
  FileEdit,
  BarChart3,
} from 'lucide-react'
```

- [ ] **Step 2: Add Dashboard sidebar item**

Add a new `SidebarMenuItem` as the first item in the top-level navigation group (before the "My Tasks" item at line 179):

```tsx
<SidebarMenuItem>
  <SidebarMenuButton
    asChild
    isActive={currentPage === 'dashboard'}
    tooltip={intl.formatMessage({ id: 'sidebar.dashboard' })}
  >
    <Link
      href={`/workspace/${workspaceUrl}/dashboard`}
      onClick={e => {
        e.preventDefault()
        onNavigate('dashboard')
      }}
    >
      <BarChart3 />
      <span>{intl.formatMessage({ id: 'sidebar.dashboard' })}</span>
    </Link>
  </SidebarMenuButton>
</SidebarMenuItem>
```

- [ ] **Step 3: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/Sidebar.tsx
git commit -m "feat: add Dashboard entry to sidebar [LUM-21]"
```

---

### Task 24: Wire Dashboard Page in WorkspaceApp

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/WorkspaceApp.tsx` (or equivalent layout component that renders pages based on `currentPage`)

- [ ] **Step 1: Import DashboardPage**

Add import:

```typescript
import { DashboardPage } from './pages/DashboardPage'
```

- [ ] **Step 2: Add dashboard page rendering**

Find the section that conditionally renders pages based on `currentPage` (e.g., `{currentPage === 'my-tasks' && ...}`) and add:

```tsx
{
  currentPage === 'dashboard' && (
    <DashboardPage
      onNavigateToProject={projectId => {
        // Navigate to project detail with summary tab
        // Use existing project navigation pattern
        setCurrentPage('project-detail')
        setCurrentProjectId(projectId)
      }}
    />
  )
}
```

Note: Adapt the navigation callback to match the existing pattern for navigating to project detail pages in WorkspaceApp.

- [ ] **Step 3: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/WorkspaceApp.tsx
git commit -m "feat: wire Dashboard page into workspace navigation [LUM-21]"
```

---

### Task 25: Summary Settings Section

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/WorkspaceSettingsPage.tsx` (or equivalent workspace settings component)

- [ ] **Step 1: Add summary settings UI**

Find the workspace settings component and add a new section after existing settings sections. Use the existing pattern for toggle and select fields:

```tsx
{
  /* Summary Settings */
}
;<div className='space-y-4'>
  <h3 className='text-sm font-medium text-zinc-900 dark:text-zinc-100'>
    {intl.formatMessage({ id: 'summary.settings' })}
  </h3>

  {/* Enable/Disable */}
  <div className='flex items-center justify-between'>
    <label className='text-sm text-zinc-600 dark:text-zinc-400'>
      {intl.formatMessage({ id: 'summary.enabled' })}
    </label>
    <button
      onClick={() => updateSummarySettings({ summaryEnabled: !summaryEnabled })}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
        summaryEnabled ? 'bg-blue-500' : 'bg-zinc-300 dark:bg-zinc-700'
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white transition-transform',
          summaryEnabled ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </button>
  </div>

  {/* Frequency */}
  <div className='flex items-center justify-between'>
    <label className='text-sm text-zinc-600 dark:text-zinc-400'>
      {intl.formatMessage({ id: 'summary.frequency' })}
    </label>
    <select
      value={summaryFrequency}
      onChange={e =>
        updateSummarySettings({ summaryFrequency: e.target.value })
      }
      className='text-sm border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1 bg-white dark:bg-zinc-900'
    >
      <option value='DAILY'>
        {intl.formatMessage({ id: 'summary.daily' })}
      </option>
      <option value='EVERY_TWO_DAYS'>
        {intl.formatMessage({ id: 'summary.everyTwoDays' })}
      </option>
      <option value='WEEKLY'>
        {intl.formatMessage({ id: 'summary.weekly' })}
      </option>
    </select>
  </div>

  {/* Locale */}
  <div className='flex items-center justify-between'>
    <label className='text-sm text-zinc-600 dark:text-zinc-400'>
      {intl.formatMessage({ id: 'summary.locale' })}
    </label>
    <select
      value={summaryLocale}
      onChange={e => updateSummarySettings({ summaryLocale: e.target.value })}
      className='text-sm border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1 bg-white dark:bg-zinc-900'
    >
      <option value='en'>English</option>
      <option value='zh'>中文</option>
    </select>
  </div>
</div>
```

The `updateSummarySettings` function should call `PATCH /api/workspaces/me` (or equivalent) with the summary fields. Follow the existing pattern for saving workspace settings.

- [ ] **Step 2: Add state and API handler**

Add state variables and the update handler using the existing workspace settings pattern:

```typescript
const [summaryEnabled, setSummaryEnabled] = useState(true)
const [summaryFrequency, setSummaryFrequency] = useState('DAILY')
const [summaryLocale, setSummaryLocale] = useState('en')

async function updateSummarySettings(updates: Record<string, any>) {
  try {
    const res = await fetch(API.workspaces.me, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (!res.ok) throw new Error('Failed to update')
    if ('summaryEnabled' in updates) setSummaryEnabled(updates.summaryEnabled)
    if ('summaryFrequency' in updates)
      setSummaryFrequency(updates.summaryFrequency)
    if ('summaryLocale' in updates) setSummaryLocale(updates.summaryLocale)
    toast.success('Settings updated')
  } catch {
    toast.error('Failed to update settings')
  }
}
```

Note: Ensure the workspace `PATCH` endpoint also accepts `summaryEnabled`, `summaryFrequency`, and `summaryLocale` fields. If it doesn't, update the endpoint to include them.

- [ ] **Step 3: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/pages/WorkspaceSettingsPage.tsx
git commit -m "feat: add summary settings to workspace settings [LUM-21]"
```

---

### Task 26: Run All Tests and Type Check

- [ ] **Step 1: Run tests**

Run: `npx jest --no-coverage`
Expected: All tests pass

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 3: Fix any failures**

Address any test failures or type errors found in steps 1-2.

- [ ] **Step 4: Commit fixes if any**

```bash
git add -A
git commit -m "fix: resolve test and type check issues [LUM-21]"
```

---

### Task 27: Final Integration Commit

- [ ] **Step 1: Verify git status is clean**

Run: `git status`
Expected: Working tree clean (all changes committed in previous tasks)

- [ ] **Step 2: Verify all tests pass**

Run: `npx jest --no-coverage && npx tsc --noEmit`
Expected: All pass with no errors
