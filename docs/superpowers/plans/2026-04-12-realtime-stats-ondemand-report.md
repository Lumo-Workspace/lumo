# Realtime Stats & On-Demand Report Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split summary data into real-time stats (DB aggregation on page load) and cached LLM reports (on-demand + cron generation), with async generation, polling, and 5-minute cooldown.

**Architecture:** New `/api/stats/` routes serve live aggregated data. New `/api/summaries/generate/{project|workspace}` POST routes trigger async LLM report generation via `waitUntil`. A `GenerationJob` Prisma model tracks job status for frontend polling. Existing cron is retained with skip-if-recent logic.

**Tech Stack:** Next.js 14 App Router, Prisma, `@vercel/functions` (waitUntil), Clerk auth, Zod, Jest

---

## File Structure

| File                                                                      | Action | Responsibility                                                         |
| ------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| `prisma/schema.prisma`                                                    | Modify | Add `GenerationJob` model                                              |
| `lib/repositories/generation-job.repository.ts`                           | Create | CRUD + cooldown query + cleanup for GenerationJob                      |
| `lib/services/stats.service.ts`                                           | Create | Resolve risk config → call aggregation → return stats                  |
| `lib/services/summary.service.ts`                                         | Modify | Add `requestGeneration`, `getJobStatus` methods                        |
| `app/api/stats/project/[projectId]/route.ts`                              | Create | GET — real-time project stats                                          |
| `app/api/stats/workspace/route.ts`                                        | Create | GET — real-time workspace stats                                        |
| `app/api/summaries/generate/project/[projectId]/route.ts`                 | Create | POST — trigger async project report                                    |
| `app/api/summaries/generate/workspace/route.ts`                           | Create | POST — trigger async workspace report                                  |
| `app/api/summaries/generate/status/[jobId]/route.ts`                      | Create | GET — poll job status                                                  |
| `app/api/summaries/generate/route.ts`                                     | Modify | Cron: skip recent + write GenerationJob + cleanup                      |
| `app/workspace/[workspaceUrl]/constants.ts`                               | Modify | Add stats + generation endpoint constants                              |
| `lib/api-client/stats.ts`                                                 | Create | `statsClient.getProjectStats`, `getWorkspaceStats`                     |
| `lib/api-client/summaries.ts`                                             | Create | `summariesClient.generateProject`, `generateWorkspace`, `getJobStatus` |
| `app/workspace/[workspaceUrl]/hooks/useRealtimeStats.ts`                  | Create | Real-time stats hook                                                   |
| `app/workspace/[workspaceUrl]/hooks/useLatestReport.ts`                   | Create | Latest cached report hook                                              |
| `app/workspace/[workspaceUrl]/hooks/useGenerationPoller.ts`               | Create | Job status polling hook                                                |
| `app/workspace/[workspaceUrl]/hooks/useReportRefresh.ts`                  | Create | Orchestrator: trigger + poll + refetch report                          |
| `app/workspace/[workspaceUrl]/components/summary/RefreshReportButton.tsx` | Create | Button with idle/generating/cooldown states                            |
| `app/workspace/[workspaceUrl]/components/pages/DashboardPage.tsx`         | Modify | Wire real-time stats + report + refresh button                         |
| `app/workspace/[workspaceUrl]/components/summary/ProjectSummaryTab.tsx`   | Modify | Wire real-time stats + report + refresh button                         |
| `lib/i18n/en.json`                                                        | Modify | Add i18n keys for refresh UI                                           |
| `lib/i18n/zh-CN.json`                                                     | Modify | Add i18n keys for refresh UI                                           |
| `lib/i18n/zh-TW.json`                                                     | Modify | Add i18n keys for refresh UI                                           |

---

### Task 1: Add GenerationJob Prisma Model

**Files:**

- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the GenerationJob model to schema**

Append before the closing of the file (after `WorkspaceSummary` model):

```prisma
model GenerationJob {
  id        String   @id @default(cuid())
  type      String   // 'project' | 'workspace'
  targetId  String   // projectId or workspaceId
  status    String   @default("pending") // pending | completed | failed
  summaryId String?  // populated on success
  createdAt DateTime @default(now())

  @@index([targetId, createdAt(sort: Desc)])
}
```

- [ ] **Step 2: Generate Prisma migration**

Run: `npx prisma migrate dev --name add-generation-job`
Expected: Migration created successfully, `prisma/migrations/` has a new directory.

- [ ] **Step 3: Verify Prisma client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add GenerationJob model for async report tracking [LUM-SUMMARY]"
```

---

### Task 2: Create GenerationJob Repository

**Files:**

- Create: `lib/repositories/generation-job.repository.ts`
- Create: `__tests__/lib/repositories/generation-job.repository.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
const mockFindFirst = jest.fn()
const mockCreate = jest.fn()
const mockUpdate = jest.fn()
const mockDeleteMany = jest.fn()

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    generationJob: {
      findFirst: (...args: any[]) => mockFindFirst(...args),
      create: (...args: any[]) => mockCreate(...args),
      update: (...args: any[]) => mockUpdate(...args),
      deleteMany: (...args: any[]) => mockDeleteMany(...args),
    },
  },
}))

import { generationJobRepository } from '@/lib/repositories/generation-job.repository'

beforeEach(() => jest.clearAllMocks())

describe('generationJobRepository', () => {
  describe('findRecentByTarget', () => {
    it('queries for pending or completed jobs within cooldown window', async () => {
      mockFindFirst.mockResolvedValue(null)

      const result = await generationJobRepository.findRecentByTarget(
        'proj-1',
        5
      )

      expect(result).toBeNull()
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            targetId: 'proj-1',
            status: { in: ['pending', 'completed'] },
          }),
          orderBy: { createdAt: 'desc' },
        })
      )
    })

    it('returns the job when one exists within window', async () => {
      const job = {
        id: 'job-1',
        targetId: 'proj-1',
        status: 'completed',
        createdAt: new Date(),
      }
      mockFindFirst.mockResolvedValue(job)

      const result = await generationJobRepository.findRecentByTarget(
        'proj-1',
        5
      )

      expect(result).toEqual(job)
    })
  })

  describe('create', () => {
    it('creates a new job with pending status', async () => {
      const created = {
        id: 'job-1',
        type: 'project',
        targetId: 'proj-1',
        status: 'pending',
      }
      mockCreate.mockResolvedValue(created)

      const result = await generationJobRepository.create('project', 'proj-1')

      expect(result).toEqual(created)
      expect(mockCreate).toHaveBeenCalledWith({
        data: { type: 'project', targetId: 'proj-1' },
      })
    })
  })

  describe('updateStatus', () => {
    it('updates status and optional summaryId', async () => {
      mockUpdate.mockResolvedValue({ id: 'job-1', status: 'completed' })

      await generationJobRepository.updateStatus('job-1', 'completed', 'sum-1')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { status: 'completed', summaryId: 'sum-1' },
      })
    })
  })

  describe('findById', () => {
    it('returns the job by id', async () => {
      const job = { id: 'job-1', status: 'pending' }
      mockFindFirst.mockResolvedValue(job)

      const result = await generationJobRepository.findById('job-1')

      expect(result).toEqual(job)
    })
  })

  describe('deleteOlderThan', () => {
    it('deletes jobs older than specified days', async () => {
      mockDeleteMany.mockResolvedValue({ count: 5 })

      await generationJobRepository.deleteOlderThan(7)

      expect(mockDeleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: expect.objectContaining({ lt: expect.any(Date) }),
        },
      })
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/repositories/generation-job.repository.test.ts --no-coverage`
Expected: FAIL — `Cannot find module '@/lib/repositories/generation-job.repository'`

- [ ] **Step 3: Implement the repository**

Create `lib/repositories/generation-job.repository.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'

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
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/repositories/generation-job.repository.test.ts --no-coverage`
Expected: PASS — 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/generation-job.repository.ts __tests__/lib/repositories/generation-job.repository.test.ts
git commit -m "feat: add generation job repository [LUM-SUMMARY]"
```

---

### Task 3: Create Stats Service

**Files:**

- Create: `lib/services/stats.service.ts`
- Create: `tests/lib/services/stats.service.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspace: { findUnique: jest.fn() },
    project: { findUnique: jest.fn(), findMany: jest.fn() },
  },
}))

jest.mock('@/lib/summaries/stats', () => ({
  aggregateProjectStats: jest.fn(),
  aggregateWorkspaceStats: jest.fn(),
}))

jest.mock('@/lib/summaries/risk', () => ({
  resolveEffectiveRiskConfig: jest.fn().mockReturnValue({
    overdueRatio: 0.25,
    stalledDays: 7,
    stalledMinCount: 3,
    agentFailRatio: 0.3,
    stalePrDays: 3,
    throughputDrop: 0.5,
  }),
}))

import {
  getProjectStats,
  getWorkspaceStats,
} from '@/lib/services/stats.service'
import { prisma } from '@/lib/db/prisma'
import { aggregateProjectStats } from '@/lib/summaries/stats'
import { resolveEffectiveRiskConfig } from '@/lib/summaries/risk'

const asMock = (fn: unknown): jest.Mock => fn as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('getProjectStats', () => {
  it('resolves effective config and returns aggregated stats', async () => {
    asMock(prisma.project.findUnique).mockResolvedValue({
      id: 'proj-1',
      workspaceId: 'ws-1',
      riskOverdueRatio: null,
      riskStalledDays: null,
      riskStalledMinCount: null,
      riskAgentFailRatio: null,
      riskStalePrDays: null,
      riskThroughputDrop: null,
    })
    asMock(prisma.workspace.findUnique).mockResolvedValue({
      id: 'ws-1',
      riskOverdueRatio: 0.25,
      riskStalledDays: 7,
      riskStalledMinCount: 3,
      riskAgentFailRatio: 0.3,
      riskStalePrDays: 3,
      riskThroughputDrop: 0.5,
    })
    const mockStats = { totalTasks: 10 }
    asMock(aggregateProjectStats).mockResolvedValue(mockStats)

    const result = await getProjectStats('proj-1', 'ws-1')

    expect(resolveEffectiveRiskConfig).toHaveBeenCalled()
    expect(aggregateProjectStats).toHaveBeenCalledWith(
      'proj-1',
      expect.any(Object)
    )
    expect(result).toEqual(mockStats)
  })

  it('throws if project not found', async () => {
    asMock(prisma.project.findUnique).mockResolvedValue(null)

    await expect(getProjectStats('bad', 'ws-1')).rejects.toThrow(
      'Project not found'
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/lib/services/stats.service.test.ts --no-coverage`
Expected: FAIL — `Cannot find module '@/lib/services/stats.service'`

- [ ] **Step 3: Implement the service**

Create `lib/services/stats.service.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'
import {
  aggregateProjectStats,
  aggregateWorkspaceStats,
  type ProjectRiskOverride,
} from '@/lib/summaries/stats'
import { resolveEffectiveRiskConfig } from '@/lib/summaries/risk'
import type { TaskSummaryStats, WorkspaceSummaryStats } from '@/types/summary'

const RISK_FIELDS = {
  riskOverdueRatio: true,
  riskStalledDays: true,
  riskStalledMinCount: true,
  riskAgentFailRatio: true,
  riskStalePrDays: true,
  riskThroughputDrop: true,
} as const

export async function getProjectStats(
  projectId: string,
  workspaceId: string
): Promise<TaskSummaryStats> {
  const [project, workspace] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, ...RISK_FIELDS },
    }),
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: RISK_FIELDS,
    }),
  ])

  if (!project)
    throw Object.assign(new Error('Project not found'), { status: 404 })
  if (!workspace)
    throw Object.assign(new Error('Workspace not found'), { status: 404 })

  const config = resolveEffectiveRiskConfig(workspace, project)
  return aggregateProjectStats(projectId, config)
}

export async function getWorkspaceStats(
  workspaceId: string
): Promise<WorkspaceSummaryStats> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      ...RISK_FIELDS,
      projects: {
        select: { id: true, ...RISK_FIELDS },
      },
    },
  })

  if (!workspace)
    throw Object.assign(new Error('Workspace not found'), { status: 404 })

  const workspaceConfig = {
    riskOverdueRatio: workspace.riskOverdueRatio,
    riskStalledDays: workspace.riskStalledDays,
    riskStalledMinCount: workspace.riskStalledMinCount,
    riskAgentFailRatio: workspace.riskAgentFailRatio,
    riskStalePrDays: workspace.riskStalePrDays,
    riskThroughputDrop: workspace.riskThroughputDrop,
  }

  const effectiveConfig = resolveEffectiveRiskConfig(workspaceConfig, null)

  const projectOverrides = new Map<string, ProjectRiskOverride | null>()
  for (const p of workspace.projects) {
    projectOverrides.set(p.id, {
      riskOverdueRatio: p.riskOverdueRatio,
      riskStalledDays: p.riskStalledDays,
      riskStalledMinCount: p.riskStalledMinCount,
      riskAgentFailRatio: p.riskAgentFailRatio,
      riskStalePrDays: p.riskStalePrDays,
      riskThroughputDrop: p.riskThroughputDrop,
    })
  }

  return aggregateWorkspaceStats(workspaceId, effectiveConfig, projectOverrides)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/lib/services/stats.service.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/services/stats.service.ts tests/lib/services/stats.service.test.ts
git commit -m "feat: add stats service for real-time aggregation [LUM-SUMMARY]"
```

---

### Task 4: Create Real-Time Stats API Routes

**Files:**

- Create: `app/api/stats/project/[projectId]/route.ts`
- Create: `app/api/stats/workspace/route.ts`

- [ ] **Step 1: Create project stats route**

Create `app/api/stats/project/[projectId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { getProjectStats } from '@/lib/services/stats.service'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const { projectId } = await params

  const result = await loadProjectAndMember(projectId, userId)
  if (result instanceof NextResponse) return result
  const { project } = result

  try {
    const stats = await getProjectStats(projectId, project.workspaceId)
    return NextResponse.json({ stats })
  } catch (error) {
    console.error(`GET /api/stats/project/${projectId} error:`, error)
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Create workspace stats route**

Create `app/api/stats/workspace/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { getWorkspaceStats } from '@/lib/services/stats.service'

export async function GET(req: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const wsResult = await requireUserWorkspace(userId)
  if (wsResult instanceof NextResponse) return wsResult

  try {
    const stats = await getWorkspaceStats(wsResult.workspace.id)
    return NextResponse.json({ stats })
  } catch (error) {
    console.error('GET /api/stats/workspace error:', error)
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "stats/(project|workspace)" | head -10`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add app/api/stats/
git commit -m "feat: add real-time stats API routes [LUM-SUMMARY]"
```

---

### Task 5: Extend Summary Service with Generation Job Methods

**Files:**

- Modify: `lib/services/summary.service.ts`

- [ ] **Step 1: Add requestGeneration and getJobStatus to summary service**

Add imports at the top of `lib/services/summary.service.ts`:

```typescript
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'
```

Add two new methods inside the `summaryService` object:

```typescript
  async requestGeneration(
    type: 'project' | 'workspace',
    targetId: string,
    cooldownMinutes = 5
  ): Promise<{ jobId: string } | { retryAfter: number }> {
    const recent = await generationJobRepository.findRecentByTarget(
      targetId,
      cooldownMinutes
    )
    if (recent) {
      const elapsed = Date.now() - recent.createdAt.getTime()
      const retryAfter = Math.ceil(
        (cooldownMinutes * 60 * 1000 - elapsed) / 1000
      )
      return { retryAfter: Math.max(retryAfter, 1) }
    }

    const job = await generationJobRepository.create(type, targetId)
    return { jobId: job.id }
  },

  async getJobStatus(jobId: string) {
    const job = await generationJobRepository.findById(jobId)
    if (!job) return null
    return { status: job.status, summaryId: job.summaryId ?? null }
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep "summary.service" | head -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/services/summary.service.ts
git commit -m "feat: add requestGeneration and getJobStatus to summary service [LUM-SUMMARY]"
```

---

### Task 6: Create On-Demand Generation API Routes

**Files:**

- Create: `app/api/summaries/generate/project/[projectId]/route.ts`
- Create: `app/api/summaries/generate/workspace/route.ts`
- Create: `app/api/summaries/generate/status/[jobId]/route.ts`

- [ ] **Step 1: Create project generation trigger route**

Create `app/api/summaries/generate/project/[projectId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { waitUntil } from '@vercel/functions'
import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { summaryService } from '@/lib/services/summary.service'
import { getProjectStats } from '@/lib/services/stats.service'
import { generateProjectReport } from '@/lib/summaries/report'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'
import { prisma } from '@/lib/db/prisma'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const { projectId } = await params

  const result = await loadProjectAndMember(projectId, userId)
  if (result instanceof NextResponse) return result
  const { project } = result

  const genResult = await summaryService.requestGeneration('project', projectId)
  if ('retryAfter' in genResult) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfter: genResult.retryAfter },
      { status: 429 }
    )
  }

  const { jobId } = genResult

  // Fetch context needed for report generation before returning response
  const workspace = await prisma.workspace.findUnique({
    where: { id: project.workspaceId },
    select: { summaryLocale: true },
  })

  const projectRecord = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true, description: true },
  })

  waitUntil(
    (async () => {
      try {
        const stats = await getProjectStats(projectId, project.workspaceId)
        const { tldr, report } = await generateProjectReport(stats, {
          projectName: projectRecord?.name ?? 'Unknown',
          projectDescription: projectRecord?.description ?? null,
          locale: workspace?.summaryLocale ?? 'en',
        })
        const summary = await summaryService.createProjectSummary(
          projectId,
          stats as unknown as Prisma.InputJsonValue,
          tldr,
          report
        )
        await generationJobRepository.updateStatus(
          jobId,
          'completed',
          summary.id
        )
      } catch (err) {
        console.error(
          `POST /api/summaries/generate/project/${projectId} error:`,
          err
        )
        await generationJobRepository.updateStatus(jobId, 'failed')
      }
    })()
  )

  return NextResponse.json({ jobId }, { status: 202 })
}
```

- [ ] **Step 2: Create workspace generation trigger route**

Create `app/api/summaries/generate/workspace/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { waitUntil } from '@vercel/functions'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { summaryService } from '@/lib/services/summary.service'
import { getWorkspaceStats } from '@/lib/services/stats.service'
import { generateWorkspaceReport } from '@/lib/summaries/report'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'

export async function POST(req: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const wsResult = await requireUserWorkspace(userId)
  if (wsResult instanceof NextResponse) return wsResult

  const workspaceId = wsResult.workspace.id

  const genResult = await summaryService.requestGeneration(
    'workspace',
    workspaceId
  )
  if ('retryAfter' in genResult) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfter: genResult.retryAfter },
      { status: 429 }
    )
  }

  const { jobId } = genResult

  waitUntil(
    (async () => {
      try {
        const stats = await getWorkspaceStats(workspaceId)
        const { tldr, report } = await generateWorkspaceReport(stats, {
          workspaceName: wsResult.workspace.name,
          locale: wsResult.workspace.summaryLocale ?? 'en',
        })
        const summary = await summaryService.createWorkspaceSummary(
          workspaceId,
          stats as unknown as Prisma.InputJsonValue,
          tldr,
          report
        )
        await generationJobRepository.updateStatus(
          jobId,
          'completed',
          summary.id
        )
      } catch (err) {
        console.error('POST /api/summaries/generate/workspace error:', err)
        await generationJobRepository.updateStatus(jobId, 'failed')
      }
    })()
  )

  return NextResponse.json({ jobId }, { status: 202 })
}
```

- [ ] **Step 3: Create job status polling route**

Create `app/api/summaries/generate/status/[jobId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { summaryService } from '@/lib/services/summary.service'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult

  const { jobId } = await params

  const result = await summaryService.getJobStatus(jobId)
  if (!result) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  return NextResponse.json(result)
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "generate/(project|workspace|status)" | head -10`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add app/api/summaries/generate/project/ app/api/summaries/generate/workspace/route.ts app/api/summaries/generate/status/
git commit -m "feat: add on-demand report generation routes [LUM-SUMMARY]"
```

---

### Task 7: Update Cron Route with Skip-Recent and Job Tracking

**Files:**

- Modify: `app/api/summaries/generate/route.ts`

- [ ] **Step 1: Add import for generationJobRepository**

At top of `app/api/summaries/generate/route.ts`, add:

```typescript
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'
```

- [ ] **Step 2: Add skip-if-recently-generated logic per project**

Inside the `for (const project of workspace.projects)` loop, before the existing `try` block, add:

```typescript
// Skip if recently generated (manually or by prior cron run)
const recentJob = await generationJobRepository.findRecentByTarget(
  project.id,
  5
)
if (recentJob?.status === 'completed') {
  projectSummaries.push({
    projectId: project.id,
    skipped: true,
  })
  continue
}
```

- [ ] **Step 3: Write GenerationJob record on successful generation**

Inside the existing `try` block, after `summaryService.createProjectSummary(...)`, add:

```typescript
await generationJobRepository
  .create('project', project.id)
  .then(job =>
    generationJobRepository.updateStatus(job.id, 'completed', summary.id)
  )
```

- [ ] **Step 4: Add workspace-level job tracking**

After `summaryService.createWorkspaceSummary(...)`, add:

```typescript
await generationJobRepository
  .create('workspace', workspace.id)
  .then(job =>
    generationJobRepository.updateStatus(
      job.id,
      'completed',
      workspaceSummary.id
    )
  )
```

- [ ] **Step 5: Add cleanup at the end of the cron handler**

Before the final `return NextResponse.json({ results })`, add:

```typescript
// Clean up old generation jobs (older than 7 days)
await generationJobRepository.deleteOlderThan(7)
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep "generate/route" | head -5`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add app/api/summaries/generate/route.ts
git commit -m "feat: cron skips recent generations, tracks jobs, cleans up [LUM-SUMMARY]"
```

---

### Task 8: Add API Constants and Client Functions

**Files:**

- Modify: `app/workspace/[workspaceUrl]/constants.ts`
- Create: `lib/api-client/stats.ts`
- Create: `lib/api-client/summaries.ts`

- [ ] **Step 1: Add new endpoints to constants**

In `app/workspace/[workspaceUrl]/constants.ts`, extend the `API` object's `summaries` section:

```typescript
  summaries: {
    generate: '/api/summaries/generate',
    generateProject: (projectId: string) =>
      `/api/summaries/generate/project/${projectId}`,
    generateWorkspace: '/api/summaries/generate/workspace',
    jobStatus: (jobId: string) =>
      `/api/summaries/generate/status/${jobId}`,
    project: (projectId: string) => `/api/summaries/project/${projectId}`,
    workspace: '/api/summaries/workspace',
  },
  stats: {
    project: (projectId: string) => `/api/stats/project/${projectId}`,
    workspace: '/api/stats/workspace',
  },
```

- [ ] **Step 2: Create stats API client**

Create `lib/api-client/stats.ts`:

```typescript
import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

export const statsClient = {
  getProjectStats<T>(projectId: string) {
    return apiFetch<T>(API.stats.project(projectId))
  },

  getWorkspaceStats<T>() {
    return apiFetch<T>(API.stats.workspace)
  },
}
```

- [ ] **Step 3: Create summaries API client**

Create `lib/api-client/summaries.ts`:

```typescript
import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

export const summariesClient = {
  getProjectSummaries<T>(projectId: string, limit = 1, before?: string) {
    const params = new URLSearchParams({ limit: String(limit) })
    if (before) params.set('before', before)
    return apiFetch<T>(`${API.summaries.project(projectId)}?${params}`)
  },

  getWorkspaceSummaries<T>(limit = 1, before?: string) {
    const params = new URLSearchParams({ limit: String(limit) })
    if (before) params.set('before', before)
    return apiFetch<T>(`${API.summaries.workspace}?${params}`)
  },

  generateProject(projectId: string) {
    return apiFetch<{ jobId: string }>(
      API.summaries.generateProject(projectId),
      {
        method: 'POST',
      }
    )
  },

  generateWorkspace() {
    return apiFetch<{ jobId: string }>(API.summaries.generateWorkspace, {
      method: 'POST',
    })
  },

  getJobStatus(jobId: string) {
    return apiFetch<{ status: string; summaryId: string | null }>(
      API.summaries.jobStatus(jobId)
    )
  },
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "(stats|summaries)\." | head -10`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/constants.ts lib/api-client/stats.ts lib/api-client/summaries.ts
git commit -m "feat: add stats and summaries API clients [LUM-SUMMARY]"
```

---

### Task 9: Create Frontend Hooks

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/useRealtimeStats.ts`
- Create: `app/workspace/[workspaceUrl]/hooks/useLatestReport.ts`
- Create: `app/workspace/[workspaceUrl]/hooks/useGenerationPoller.ts`
- Create: `app/workspace/[workspaceUrl]/hooks/useReportRefresh.ts`

- [ ] **Step 1: Create useRealtimeStats hook**

Create `app/workspace/[workspaceUrl]/hooks/useRealtimeStats.ts`:

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { statsClient } from '@/lib/api-client/stats'
import type { TaskSummaryStats, WorkspaceSummaryStats } from '@/types/summary'

interface UseRealtimeStatsReturn<T> {
  stats: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useProjectRealtimeStats(
  projectId: string
): UseRealtimeStatsReturn<TaskSummaryStats> {
  const [stats, setStats] = useState<TaskSummaryStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await statsClient.getProjectStats<{
        stats: TaskSummaryStats
      }>(projectId)
      setStats(data.stats)
    } catch {
      setError('Failed to load stats')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    fetch().then(() => {
      if (cancelled) setStats(null)
    })
    return () => {
      cancelled = true
    }
  }, [fetch])

  return { stats, loading, error, refetch: fetch }
}

export function useWorkspaceRealtimeStats(): UseRealtimeStatsReturn<WorkspaceSummaryStats> {
  const [stats, setStats] = useState<WorkspaceSummaryStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await statsClient.getWorkspaceStats<{
        stats: WorkspaceSummaryStats
      }>()
      setStats(data.stats)
    } catch {
      setError('Failed to load stats')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch().then(() => {
      if (cancelled) setStats(null)
    })
    return () => {
      cancelled = true
    }
  }, [fetch])

  return { stats, loading, error, refetch: fetch }
}
```

- [ ] **Step 2: Create useLatestReport hook**

Create `app/workspace/[workspaceUrl]/hooks/useLatestReport.ts`:

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { summariesClient } from '@/lib/api-client/summaries'
import type { ApiProjectSummary, ApiWorkspaceSummary } from '@/types/summary'

interface LatestReport {
  tldr: string | null
  report: string | null
  generatedAt: string | null
}

interface UseLatestReportReturn extends LatestReport {
  loading: boolean
  refetch: () => void
}

export function useProjectLatestReport(
  projectId: string
): UseLatestReportReturn {
  const [data, setData] = useState<LatestReport>({
    tldr: null,
    report: null,
    generatedAt: null,
  })
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const result = await summariesClient.getProjectSummaries<{
        summaries?: ApiProjectSummary[]
      }>(projectId, 1)
      const latest = result.summaries?.[0]
      setData({
        tldr: latest?.tldr ?? null,
        report: latest?.report ?? null,
        generatedAt: latest?.generatedAt ?? null,
      })
    } catch {
      // Keep existing data on refetch failure
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    fetch().then(() => {
      if (cancelled) setData({ tldr: null, report: null, generatedAt: null })
    })
    return () => {
      cancelled = true
    }
  }, [fetch])

  return { ...data, loading, refetch: fetch }
}

export function useWorkspaceLatestReport(): UseLatestReportReturn {
  const [data, setData] = useState<LatestReport>({
    tldr: null,
    report: null,
    generatedAt: null,
  })
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const result = await summariesClient.getWorkspaceSummaries<{
        summaries?: ApiWorkspaceSummary[]
      }>(1)
      const latest = result.summaries?.[0]
      setData({
        tldr: latest?.tldr ?? null,
        report: latest?.report ?? null,
        generatedAt: latest?.generatedAt ?? null,
      })
    } catch {
      // Keep existing data on refetch failure
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch().then(() => {
      if (cancelled) setData({ tldr: null, report: null, generatedAt: null })
    })
    return () => {
      cancelled = true
    }
  }, [fetch])

  return { ...data, loading, refetch: fetch }
}
```

- [ ] **Step 3: Create useGenerationPoller hook**

Create `app/workspace/[workspaceUrl]/hooks/useGenerationPoller.ts`:

```typescript
'use client'

import { useState, useEffect, useRef } from 'react'
import { summariesClient } from '@/lib/api-client/summaries'

interface UseGenerationPollerReturn {
  status: 'idle' | 'pending' | 'completed' | 'failed'
  summaryId: string | null
}

const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 20

export function useGenerationPoller(
  jobId: string | null
): UseGenerationPollerReturn {
  const [status, setStatus] = useState<UseGenerationPollerReturn['status']>(
    jobId ? 'pending' : 'idle'
  )
  const [summaryId, setSummaryId] = useState<string | null>(null)
  const pollCount = useRef(0)

  useEffect(() => {
    if (!jobId) {
      setStatus('idle')
      setSummaryId(null)
      return
    }

    setStatus('pending')
    pollCount.current = 0

    const interval = setInterval(async () => {
      pollCount.current++

      if (pollCount.current > MAX_POLLS) {
        setStatus('failed')
        clearInterval(interval)
        return
      }

      try {
        const result = await summariesClient.getJobStatus(jobId)
        if (result.status === 'completed') {
          setStatus('completed')
          setSummaryId(result.summaryId)
          clearInterval(interval)
        } else if (result.status === 'failed') {
          setStatus('failed')
          clearInterval(interval)
        }
      } catch {
        setStatus('failed')
        clearInterval(interval)
      }
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [jobId])

  return { status, summaryId }
}
```

- [ ] **Step 4: Create useReportRefresh orchestrator hook**

Create `app/workspace/[workspaceUrl]/hooks/useReportRefresh.ts`:

```typescript
'use client'

import { useState, useCallback, useEffect } from 'react'
import { summariesClient } from '@/lib/api-client/summaries'
import { useGenerationPoller } from './useGenerationPoller'
import { ApiClientError } from '@/lib/api-client/base'

type RefreshState = 'idle' | 'generating' | 'cooldown'

interface UseReportRefreshReturn {
  state: RefreshState
  cooldownSeconds: number
  trigger: () => void
}

export function useReportRefresh(
  scope: { type: 'project'; projectId: string } | { type: 'workspace' },
  onComplete: () => void
): UseReportRefreshReturn {
  const [state, setState] = useState<RefreshState>('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)

  const poller = useGenerationPoller(jobId)

  // React to poller completing/failing
  useEffect(() => {
    if (poller.status === 'completed') {
      setJobId(null)
      setState('idle')
      onComplete()
    } else if (poller.status === 'failed') {
      setJobId(null)
      setState('idle')
    }
  }, [poller.status, onComplete])

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldownSeconds <= 0) {
      if (state === 'cooldown') setState('idle')
      return
    }
    const timer = setTimeout(() => setCooldownSeconds(s => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldownSeconds, state])

  const trigger = useCallback(async () => {
    if (state !== 'idle') return

    setState('generating')
    try {
      const result =
        scope.type === 'project'
          ? await summariesClient.generateProject(scope.projectId)
          : await summariesClient.generateWorkspace()

      setJobId(result.jobId)
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 429) {
        // Parse retryAfter from response body
        try {
          const body = JSON.parse(err.message)
          const retryAfter = body.retryAfter ?? 300
          setCooldownSeconds(retryAfter)
          setState('cooldown')
        } catch {
          setCooldownSeconds(300)
          setState('cooldown')
        }
      } else {
        setState('idle')
      }
    }
  }, [state, scope])

  return { state, cooldownSeconds, trigger }
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "hooks/(useRealtime|useLatest|useGeneration|useReport)" | head -10`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/hooks/useRealtimeStats.ts app/workspace/\[workspaceUrl\]/hooks/useLatestReport.ts app/workspace/\[workspaceUrl\]/hooks/useGenerationPoller.ts app/workspace/\[workspaceUrl\]/hooks/useReportRefresh.ts
git commit -m "feat: add real-time stats, report, polling, and refresh hooks [LUM-SUMMARY]"
```

---

### Task 10: Create RefreshReportButton Component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/summary/RefreshReportButton.tsx`
- Create: `__tests__/components/summary/RefreshReportButton.test.tsx`

- [ ] **Step 1: Write the test file**

```typescript
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) => {
      const messages: Record<string, string> = {
        'summary.refreshReport': 'Refresh report',
        'summary.generating': 'Generating…',
        'summary.cooldown': 'Retry in {seconds}s',
      }
      const raw = messages[id] ?? id
      if (!values) return raw
      return raw.replace(/\{(\w+)\}/g, (_, key: string) =>
        String(values[key])
      )
    },
  }),
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { RefreshReportButton } from '@/app/workspace/[workspaceUrl]/components/summary/RefreshReportButton'

describe('RefreshReportButton', () => {
  it('renders idle state with refresh label', () => {
    render(
      <RefreshReportButton state='idle' cooldownSeconds={0} onRefresh={() => {}} />
    )
    expect(screen.getByRole('button')).toHaveTextContent('Refresh report')
    expect(screen.getByRole('button')).toBeEnabled()
  })

  it('renders generating state with spinner', () => {
    render(
      <RefreshReportButton
        state='generating'
        cooldownSeconds={0}
        onRefresh={() => {}}
      />
    )
    expect(screen.getByRole('button')).toHaveTextContent('Generating…')
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('renders cooldown state with countdown', () => {
    render(
      <RefreshReportButton
        state='cooldown'
        cooldownSeconds={120}
        onRefresh={() => {}}
      />
    )
    expect(screen.getByRole('button')).toHaveTextContent('Retry in 120s')
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('calls onRefresh when clicked in idle state', () => {
    const onRefresh = jest.fn()
    render(
      <RefreshReportButton state='idle' cooldownSeconds={0} onRefresh={onRefresh} />
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/summary/RefreshReportButton.test.tsx --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the component**

Create `app/workspace/[workspaceUrl]/components/summary/RefreshReportButton.tsx`:

```typescript
'use client'

import { useIntl } from 'react-intl'
import { RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface RefreshReportButtonProps {
  state: 'idle' | 'generating' | 'cooldown'
  cooldownSeconds: number
  onRefresh: () => void
}

export function RefreshReportButton({
  state,
  cooldownSeconds,
  onRefresh,
}: RefreshReportButtonProps) {
  const intl = useIntl()

  const disabled = state !== 'idle'

  let label: string
  let icon: React.ReactNode

  switch (state) {
    case 'generating':
      label = intl.formatMessage({ id: 'summary.generating' })
      icon = <Loader2 size={14} className='animate-spin' />
      break
    case 'cooldown':
      label = intl.formatMessage(
        { id: 'summary.cooldown' },
        { seconds: cooldownSeconds }
      )
      icon = <RefreshCw size={14} className='text-zinc-400' />
      break
    default:
      label = intl.formatMessage({ id: 'summary.refreshReport' })
      icon = <RefreshCw size={14} />
  }

  return (
    <Button
      variant='ghost'
      size='sm'
      disabled={disabled}
      onClick={onRefresh}
      className='h-7 gap-1.5 text-xs'
    >
      {icon}
      {label}
    </Button>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/summary/RefreshReportButton.test.tsx --no-coverage`
Expected: PASS — 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/summary/RefreshReportButton.tsx __tests__/components/summary/RefreshReportButton.test.tsx
git commit -m "feat: add RefreshReportButton component [LUM-SUMMARY]"
```

---

### Task 11: Wire DashboardPage to Real-Time Stats + Report + Refresh

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/DashboardPage.tsx`

- [ ] **Step 1: Replace useSummary import with new hooks**

Remove:

```typescript
import { useWorkspaceSummary } from '../../hooks/useSummary'
```

Add:

```typescript
import { useWorkspaceRealtimeStats } from '../../hooks/useRealtimeStats'
import { useWorkspaceLatestReport } from '../../hooks/useLatestReport'
import { useReportRefresh } from '../../hooks/useReportRefresh'
import { RefreshReportButton } from '../summary/RefreshReportButton'
```

- [ ] **Step 2: Replace hook usage in component body**

Remove the existing `useWorkspaceSummary()` call and replace with:

```typescript
const {
  stats,
  loading: statsLoading,
  error: statsError,
} = useWorkspaceRealtimeStats()

const {
  tldr,
  report,
  generatedAt,
  loading: reportLoading,
  refetch: refetchReport,
} = useWorkspaceLatestReport()

const {
  state: refreshState,
  cooldownSeconds,
  trigger: triggerRefresh,
} = useReportRefresh({ type: 'workspace' }, refetchReport)

const loading = statsLoading && reportLoading
const error = statsError
```

- [ ] **Step 3: Update rendering to use split data sources**

Replace any `summary.stats` references with `stats` directly. Replace `summary.tldr` with `tldr`, `summary.report` with `report`, `summary.generatedAt` with `generatedAt`.

In the BriefingCard section, add the RefreshReportButton:

```tsx
          <div className='flex items-center justify-between'>
            <BriefingCard
              tldr={tldr}
              report={report}
              generatedAt={generatedAt}
              risk={stats?.risk ?? null}
            />
          </div>
          <div className='flex justify-end -mt-2'>
            <RefreshReportButton
              state={refreshState}
              cooldownSeconds={cooldownSeconds}
              onRefresh={triggerRefresh}
            />
          </div>
```

Update stats-dependent components to read from `stats` directly (they already do — just verify `stats?.projectBreakdown`, `stats?.risk`, etc. still work).

- [ ] **Step 4: Update loading/empty state conditions**

The `if (loading && !summary)` check should become:

```typescript
if (loading && !stats && !tldr) {
  // show loading spinner
}

if (!stats && !tldr) {
  // show empty state
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep "DashboardPage" | head -10`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/pages/DashboardPage.tsx
git commit -m "feat: wire DashboardPage to real-time stats and on-demand refresh [LUM-SUMMARY]"
```

---

### Task 12: Wire ProjectSummaryTab to Real-Time Stats + Report + Refresh

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/summary/ProjectSummaryTab.tsx`

- [ ] **Step 1: Replace useSummary import with new hooks**

Remove:

```typescript
import { useProjectSummary } from '../../hooks/useSummary'
```

Add:

```typescript
import { useProjectRealtimeStats } from '../../hooks/useRealtimeStats'
import { useProjectLatestReport } from '../../hooks/useLatestReport'
import { useReportRefresh } from '../../hooks/useReportRefresh'
import { RefreshReportButton } from './RefreshReportButton'
```

- [ ] **Step 2: Replace hook usage in component body**

Remove `useProjectSummary(projectId)` and replace with:

```typescript
const {
  stats,
  loading: statsLoading,
  error: statsError,
} = useProjectRealtimeStats(projectId)

const {
  tldr,
  report,
  generatedAt,
  loading: reportLoading,
  refetch: refetchReport,
} = useProjectLatestReport(projectId)

const {
  state: refreshState,
  cooldownSeconds,
  trigger: triggerRefresh,
} = useReportRefresh({ type: 'project', projectId }, refetchReport)

const loading = statsLoading && reportLoading
const error = statsError
```

- [ ] **Step 3: Update BriefingCard to use split data + add refresh button**

```tsx
      <div className='flex justify-between items-start'>
        <BriefingCard
          tldr={tldr}
          report={report}
          generatedAt={generatedAt}
          risk={stats?.risk ?? null}
        />
      </div>
      <div className='flex justify-end -mt-2'>
        <RefreshReportButton
          state={refreshState}
          cooldownSeconds={cooldownSeconds}
          onRefresh={triggerRefresh}
        />
      </div>
```

Update all `summary.stats` → `stats`, `summary.tldr` → `tldr`, etc.

- [ ] **Step 4: Keep SummaryHistory as-is**

SummaryHistory reads from the old paginated endpoint and is independent. It can remain unchanged — it shows historical records which still include embedded stats (historical snapshots).

- [ ] **Step 5: Update loading/empty state**

```typescript
if (loading && !stats && !tldr) {
  // show loading spinner
}

if (!stats && !tldr) {
  // show empty state
}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep "ProjectSummaryTab" | head -10`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/summary/ProjectSummaryTab.tsx
git commit -m "feat: wire ProjectSummaryTab to real-time stats and on-demand refresh [LUM-SUMMARY]"
```

---

### Task 13: Add i18n Keys

**Files:**

- Modify: `lib/i18n/en.json`
- Modify: `lib/i18n/zh-CN.json`
- Modify: `lib/i18n/zh-TW.json`

- [ ] **Step 1: Add English keys**

Add after the existing `summary.riskThresholds.saveFailed` key in `lib/i18n/en.json`:

```json
  "summary.refreshReport": "Refresh report",
  "summary.generating": "Generating…",
  "summary.cooldown": "Retry in {seconds}s",
  "summary.refreshSuccess": "Report refreshed",
  "summary.refreshFailed": "Failed to refresh report",
```

- [ ] **Step 2: Add Simplified Chinese keys**

Add at the same location in `lib/i18n/zh-CN.json`:

```json
  "summary.refreshReport": "刷新报告",
  "summary.generating": "生成中…",
  "summary.cooldown": "{seconds}秒后可重试",
  "summary.refreshSuccess": "报告已刷新",
  "summary.refreshFailed": "刷新报告失败",
```

- [ ] **Step 3: Add Traditional Chinese keys**

Add at the same location in `lib/i18n/zh-TW.json`:

```json
  "summary.refreshReport": "刷新報告",
  "summary.generating": "生成中…",
  "summary.cooldown": "{seconds}秒後可重試",
  "summary.refreshSuccess": "報告已刷新",
  "summary.refreshFailed": "刷新報告失敗",
```

- [ ] **Step 4: Validate JSON**

Run: `for f in en.json zh-CN.json zh-TW.json; do node -e "JSON.parse(require('fs').readFileSync('lib/i18n/$f','utf8'))" && echo "$f OK"; done`
Expected: All 3 OK

- [ ] **Step 5: Commit**

```bash
git add lib/i18n/en.json lib/i18n/zh-CN.json lib/i18n/zh-TW.json
git commit -m "i18n: add refresh report keys [LUM-SUMMARY]"
```

---

### Task 14: End-to-End Smoke Test

**Files:** None (verification only)

- [ ] **Step 1: TypeScript full check**

Run: `npx tsc --noEmit 2>&1 | grep -v "__tests__\|tests/" | head -20`
Expected: No errors (existing test-only errors are acceptable)

- [ ] **Step 2: Run all summary-related tests**

Run: `npx jest __tests__/components/summary/ __tests__/lib/repositories/generation-job.repository.test.ts tests/lib/services/stats.service.test.ts tests/lib/summaries/stats.test.ts __tests__/summary.test.ts --testPathIgnorePatterns=".worktrees" --no-coverage`
Expected: All suites pass

- [ ] **Step 3: Verify no import cycles**

Run: `npx tsc --noEmit 2>&1 | wc -l`
Expected: 0 lines (clean)

- [ ] **Step 4: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "test: smoke test for realtime stats and on-demand report [LUM-SUMMARY]"
```
