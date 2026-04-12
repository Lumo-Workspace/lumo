# Realtime Stats & On-Demand Report Generation

## Problem

Summary data (task stats, risk scores, blockers) and LLM-generated reports are both produced by a daily cron job. Users see stale numbers until the next scheduled run. Before meetings or status checks, there is no way to get fresh data or trigger a new report.

## Design Decision

Split the data path into two independent channels:

| Channel                                 | Source                                             | Freshness                                             |
| --------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| **Stats** (task counts, risk, blockers) | Real-time DB aggregation on page load              | Always current                                        |
| **Report** (tldr + markdown narrative)  | Cached from last LLM generation; on-demand refresh | Minutes-old after manual refresh; hours-old from cron |

The existing daily cron is retained as a baseline fallback.

## Architecture

### Data Flow

```
Page Load
  ├─ useRealtimeStats(scope)  → GET /api/stats/…        → live DB aggregation
  └─ useLatestReport(scope)   → GET /api/summaries/…     → cached record (limit=1)

Manual Refresh (report only)
  ├─ POST /api/summaries/generate/{project|workspace}/…  → 202 + { jobId }
  ├─ useGenerationPoller(jobId)  → GET /status/[jobId]   → poll every 3s
  └─ completed → useLatestReport.refetch()               → updated BriefingCard

Daily Cron (unchanged path, report only)
  └─ GET /api/summaries/generate  → iterates workspaces  → skips recently generated
```

---

## 1. Real-Time Stats API

### New Routes

| Route                            | Method | Auth  | Response                |
| -------------------------------- | ------ | ----- | ----------------------- |
| `/api/stats/project/[projectId]` | GET    | Clerk | `TaskSummaryStats`      |
| `/api/stats/workspace`           | GET    | Clerk | `WorkspaceSummaryStats` |

### Implementation

Each route is a thin handler:

1. Auth check (Clerk)
2. Resolve effective risk config: workspace defaults + project overrides via `resolveEffectiveRiskConfig()`
3. Call `aggregateProjectStats(projectId, config)` or `aggregateWorkspaceStats(workspaceId, config, overrides)`
4. Return JSON

No caching layer needed initially. The aggregation runs ~10 parallel Prisma queries (groupBy, count, findMany) which complete in <100ms for typical team sizes (<500 tasks per project).

### Frontend Hooks

```typescript
function useRealtimeStats(projectId?: string): {
  stats: TaskSummaryStats | WorkspaceSummaryStats | null
  loading: boolean
  error: string | null
  refetch: () => void
}
```

- Called on component mount
- Returns live data; no localStorage caching (stats are always fresh)

---

## 2. On-Demand Report Generation

### New Routes

| Route                                              | Method | Auth  | Response                                |
| -------------------------------------------------- | ------ | ----- | --------------------------------------- |
| `POST /api/summaries/generate/project/[projectId]` | POST   | Clerk | `202 { jobId }` or `429 { retryAfter }` |
| `POST /api/summaries/generate/workspace`           | POST   | Clerk | `202 { jobId }` or `429 { retryAfter }` |
| `GET /api/summaries/generate/status/[jobId]`       | GET    | Clerk | `{ status, summaryId? }`                |

### Async Generation Flow

```
POST handler:
  1. Clerk auth
  2. Cooldown check → 429 if generated within last 5 minutes
  3. Create GenerationJob { status: 'pending' }
  4. Return 202 { jobId } immediately
  5. waitUntil(): run LLM generation in background
     a. aggregateProjectStats / aggregateWorkspaceStats
     b. generateProjectReport / generateWorkspaceReport (LLM call)
     c. createProjectSummary / createWorkspaceSummary (persist)
     d. Update job → 'completed' + summaryId
     e. On error → update job → 'failed'
```

`waitUntil` is imported from `next/server` (`import { waitUntil } from 'next/server'`). It allows async work to continue after the response is sent in Vercel Serverless / Edge environments. No external queue infrastructure required.

### GenerationJob Model

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

### Cooldown (Rate Limiting)

5-minute per-target cooldown. Implemented by querying GenerationJob:

```typescript
const recent = await prisma.generationJob.findFirst({
  where: {
    targetId,
    status: { in: ['pending', 'completed'] },
    createdAt: { gte: fiveMinutesAgo },
  },
  orderBy: { createdAt: 'desc' },
})
if (recent) → 429 { retryAfter: remainingSeconds }
```

Pending jobs also count toward cooldown to prevent double-submits.

### Polling Hook

```typescript
function useGenerationPoller(jobId: string | null): {
  status: 'idle' | 'pending' | 'completed' | 'failed'
  summaryId: string | null
}
```

- Polls `GET /status/[jobId]` every 3 seconds
- Max 20 polls (60-second timeout), then treats as failed
- Clears interval on `completed` or `failed`

---

## 3. Frontend UI

### Refresh Button Placement

- **DashboardPage**: next to the BriefingCard header
- **ProjectSummaryTab**: next to the BriefingCard header

### Button State Machine

| State        | Icon                 | Label                       | Enabled |
| ------------ | -------------------- | --------------------------- | ------- |
| `idle`       | 🔄 RefreshCw         | 刷新报告                    | Yes     |
| `generating` | Spinner (Loader2)    | 生成中…                     | No      |
| `cooldown`   | 🔄 RefreshCw (muted) | N分钟后可刷新               | No      |
| `error`      | —                    | toast error, revert to idle | —       |

### Data Rendering Split

| UI Region                                                      | Data Source                                       |
| -------------------------------------------------------------- | ------------------------------------------------- |
| RiskBadge, TopBlockersList, ProjectsAtGlanceList, StatsCardRow | `useRealtimeStats()` — always live                |
| BriefingCard (tldr + markdown sections)                        | `useLatestReport()` — cached, refreshed on-demand |
| "Generated 2h ago" timestamp                                   | `useLatestReport().generatedAt`                   |

Stats areas have no refresh button — they are always current on page load.

### Report Hook

```typescript
function useLatestReport(projectId?: string): {
  tldr: string | null
  report: string | null
  generatedAt: string | null
  loading: boolean
  refetch: () => void
}
```

Fetches the latest summary record (limit=1) but only extracts `tldr`, `report`, and `generatedAt`. Ignores the embedded `stats` JSON.

---

## 4. Cron Compatibility

### Adjustments to Existing Cron

1. **Skip recently generated**: before generating for a project, check if a GenerationJob with `status: 'completed'` exists within the workspace's frequency window. If yes, skip that project.
2. **Write GenerationJob**: cron also creates a GenerationJob record per generation, so cooldown logic works uniformly regardless of trigger source.

### Job Cleanup

The cron handler deletes GenerationJob records older than 7 days at the end of each run. No separate cleanup cron needed.

### Summary Record Compatibility

Existing `ProjectSummary` / `WorkspaceSummary` records are unchanged. The `stats` JSON embedded in old records becomes a historical snapshot. Frontend no longer reads stats from these records — only `tldr`, `report`, and `generatedAt`.

---

## 5. API Client Layer

### New Functions

```typescript
// lib/api-client/stats.ts
export const statsClient = {
  getProjectStats<T>(projectId: string) { ... },
  getWorkspaceStats<T>() { ... },
}

// lib/api-client/summaries.ts (extend existing)
export const summariesClient = {
  ...existing,
  generateProject(projectId: string) { ... },    // POST → { jobId }
  generateWorkspace() { ... },                    // POST → { jobId }
  getJobStatus(jobId: string) { ... },            // GET  → { status, summaryId? }
}
```

---

## 6. Service Layer

### New: `stats.service.ts`

Thin wrapper that resolves risk config and calls aggregation:

```typescript
export async function getProjectStats(
  projectId: string,
  workspaceId: string
): Promise<TaskSummaryStats>
export async function getWorkspaceStats(
  workspaceId: string
): Promise<WorkspaceSummaryStats>
```

### Extended: `summary.service.ts`

New methods:

```typescript
export async function requestGeneration(
  type: 'project' | 'workspace',
  targetId: string
): Promise<{ jobId: string } | { retryAfter: number }>
export async function getJobStatus(
  jobId: string
): Promise<{ status: string; summaryId: string | null }>
```

### New: `generation-job.repository.ts`

CRUD for GenerationJob records + cooldown query + cleanup.

---

## Non-Goals

- **WebSocket/SSE push**: not needed; 3s polling is sufficient for a 10-15s generation window
- **Redis caching for stats**: premature; DB aggregation is fast enough for current scale
- **Removing the cron**: retained as baseline fallback
- **Changing summary storage schema**: existing ProjectSummary/WorkspaceSummary tables are untouched
