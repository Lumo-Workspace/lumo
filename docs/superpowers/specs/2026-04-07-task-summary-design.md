# Task Summary Design Spec

## Overview

Add a task summary feature to Lumo that combines statistical dashboards with AI-generated structured reports. Available at both project level (Summary tab) and workspace level (Dashboard page). Summaries are generated on a configurable schedule and stored with full history.

## Data Model

### New Models

```prisma
model ProjectSummary {
  id          String   @id @default(cuid())
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  stats       Json     // TaskSummaryStats
  tldr        String   // One-line TL;DR
  report      String   // Structured Markdown report

  generatedAt DateTime @default(now())
  createdAt   DateTime @default(now())

  @@index([projectId, generatedAt(sort: Desc)])
}

model WorkspaceSummary {
  id           String    @id @default(cuid())
  workspaceId  String
  workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  stats        Json      // WorkspaceSummaryStats
  tldr         String
  report       String

  generatedAt  DateTime  @default(now())
  createdAt    DateTime  @default(now())

  @@index([workspaceId, generatedAt(sort: Desc)])
}
```

### Workspace Config Fields

```prisma
// Added to existing Workspace model
summaryFrequency  SummaryFrequency @default(DAILY)
summaryEnabled    Boolean          @default(true)
summaryLocale     String           @default("en") // "en" or "zh"

enum SummaryFrequency {
  DAILY
  EVERY_TWO_DAYS
  WEEKLY
}
```

### Stats TypeScript Types

```typescript
interface TaskSummaryStats {
  totalTasks: number
  statusDistribution: Record<TaskStatus, number> // TODO, IN_PROGRESS, IN_REVIEW, DONE
  priorityDistribution: Record<TaskPriority, number> // LOW, MEDIUM, HIGH, URGENT
  overdueTasks: { count: number; taskIds: string[] }
  memberWorkload: Array<{
    actorId: string
    name: string
    assigned: number
    completed: number
  }>
  completionTrend: Array<{ date: string; completed: number }> // Last 30 days, daily
  avgCompletionTime: number | null // Hours
  subtaskCompletionRate: number | null // 0-1
  agentStats: {
    total: number
    completed: number
    failed: number
    working: number
  }
  prStats: { total: number; merged: number; open: number }
}

interface WorkspaceSummaryStats extends TaskSummaryStats {
  projectBreakdown: Array<{
    projectId: string
    projectName: string
    totalTasks: number
    completedTasks: number
    overdueTasks: number
  }>
}
```

## Backend Architecture

### API Routes

#### `POST /api/summaries/generate`

Triggered by external cron service. Authenticated via secret token (env var `SUMMARY_CRON_SECRET`).

Optional params:

- `workspaceId` — generate for a specific workspace; omit to process all enabled workspaces

Flow:

1. Query workspaces where `summaryEnabled=true` and due for generation (based on `summaryFrequency` and last `generatedAt`)
2. For each workspace, iterate all projects:
   - Call `aggregateProjectStats(projectId)` to compute stats
   - Call `generateProjectReport(stats, projectContext)` to get AI report
   - Insert `ProjectSummary` record
3. Call `aggregateWorkspaceStats(workspaceId)` to compute workspace-wide stats
4. Call `generateWorkspaceReport(stats, workspaceContext)` to get AI report
5. Insert `WorkspaceSummary` record

#### `GET /api/summaries/project/[projectId]`

Returns project summaries. Params:

- `limit` (default: 1) — number of records to return
- `before` (optional) — cursor for pagination (generatedAt timestamp)

Auth: follows existing project access control.

#### `GET /api/summaries/workspace`

Returns workspace summaries. Same params as above. Auth: workspace membership.

### Stats Aggregation (`lib/summaries/stats.ts`)

Two pure functions using Prisma queries:

**`aggregateProjectStats(projectId): Promise<TaskSummaryStats>`**

- `groupBy` on `status` and `priority` for distribution counts
- `where: { dueDate: { lt: now }, status: { not: DONE } }` for overdue tasks
- `groupBy` on `assigneeActorId` with `_count` for member workload
- Tasks with `status: DONE` and `updatedAt` in last 30 days, grouped by day for completion trend
- Average time between `createdAt` and `updatedAt` for completed tasks
- Subtask completion: count of children with `status: DONE` / total children
- Agent tasks: group by `agentStatus`
- PR stats: count by merge status from `PullRequest` model

**`aggregateWorkspaceStats(workspaceId): Promise<WorkspaceSummaryStats>`**

- Same as above but across all projects in workspace
- Additional `projectBreakdown` array with per-project totals

### AI Report Generation (`lib/summaries/report.ts`)

Two functions calling Claude Sonnet via Vercel AI SDK:

**`generateProjectReport(stats, projectContext): Promise<{ tldr: string; report: string }>`**

**`generateWorkspaceReport(stats, workspaceContext): Promise<{ tldr: string; report: string }>`**

System prompt instructs the model to output:

- **TL;DR**: One sentence, data-driven summary
- **Report** (Markdown): Three sections:
  - **进展概述 / Progress Overview**: What was accomplished, key metrics
  - **风险与阻塞 / Risks & Blockers**: Overdue tasks, resource bottlenecks, failing agents
  - **建议行动 / Suggested Actions**: Prioritized next steps

Language selection: based on `summaryLocale` field on Workspace model (default: `"en"`). Supports `en` and `zh`.

Input context includes: stats JSON, project name/description, team member names, recent activity count.

### Cron Trigger

External cron service (Vercel Cron or similar) calls `POST /api/summaries/generate` with the secret token. The endpoint internally checks frequency and last generation time to determine which workspaces need processing.

## Frontend Design

### Project Level — Summary Tab

New tab in project detail page, alongside existing "Overview" and "Tasks" tabs.

**Layout: Top-down structure**

1. **AI Summary Card** (top)
   - Shows TL;DR text prominently
   - "Show full report" toggle to expand the structured Markdown report
   - Timestamp: "Generated Apr 7, 2026"
   - Collapsed by default, TL;DR always visible

2. **Stats Card Row** (4 cards)
   - Total Tasks | Completed | Overdue | Avg Completion Time
   - Large number with label beneath

3. **Charts Row** (3 charts)
   - **Status Distribution**: Horizontal stacked bar with legend
   - **Member Workload**: Horizontal bars per member showing assigned count
   - **Completion Trend (7d)**: Vertical bar chart, one bar per day

4. **Additional Stats** (below charts, collapsible)
   - Priority Distribution: Similar stacked bar
   - Subtask Completion Rate: Percentage with progress ring
   - Agent Stats: Total / Completed / Failed / Working
   - PR Stats: Total / Merged / Open

5. **History Link** (bottom)
   - "View history →" link
   - Opens timeline list: each entry shows date + TL;DR
   - Click to expand full report and stats snapshot for that date

### Workspace Level — Dashboard Page

New sidebar entry "Dashboard" above "My Tasks".

**Layout:**

1. **AI Summary Card** — same pattern as project level, workspace-wide report
2. **Stats Card Row** — workspace-wide totals
3. **Project Progress Table** — one row per project:
   - Project name | Total tasks | Completed | Overdue | Progress bar
   - Click row to navigate to that project's Summary tab
4. **Charts Row** — workspace-wide status distribution, member workload, trend
5. **History Link**

### Settings

In workspace Settings page, new "Summary" section:

- **Enable/Disable toggle**: `summaryEnabled`
- **Frequency selector**: dropdown with Daily / Every Two Days / Weekly
- **Language selector**: dropdown with English / 中文 (controls AI report language)

### Empty & Error States

- **No summary yet**: Empty state illustration + "Summary will be generated on the next scheduled run"
- **AI generation failed**: Stats display normally (pure DB query), report area shows "Report generation failed. Will retry on next run."
- **No tasks in project**: Stats show all zeros, AI report says "No tasks to summarize"

## i18n

New keys under `summary.*` namespace:

```
summary.title — "Summary" / "摘要"
summary.tldr — "TL;DR"
summary.showReport — "Show full report" / "展开完整报告"
summary.hideReport — "Hide report" / "收起报告"
summary.generatedAt — "Generated {date}" / "生成于 {date}"
summary.totalTasks — "Total Tasks" / "总任务数"
summary.completed — "Completed" / "已完成"
summary.overdue — "Overdue" / "已逾期"
summary.avgCompletion — "Avg Completion" / "平均完成时间"
summary.statusDistribution — "Status Distribution" / "状态分布"
summary.memberWorkload — "Member Workload" / "成员工作量"
summary.completionTrend — "Completion Trend" / "完成趋势"
summary.priorityDistribution — "Priority Distribution" / "优先级分布"
summary.subtaskRate — "Subtask Completion" / "子任务完成率"
summary.agentStats — "Agent Tasks" / "Agent 任务"
summary.prStats — "Pull Requests" / "PR 统计"
summary.viewHistory — "View history" / "查看历史"
summary.noSummary — "Summary will be generated on the next scheduled run" / "摘要将在下次定时任务时生成"
summary.reportFailed — "Report generation failed. Will retry on next run." / "报告生成失败，将在下次重试"
summary.settings — "Summary Settings" / "摘要设置"
summary.enabled — "Enable Summary" / "启用摘要"
summary.frequency — "Generation Frequency" / "生成频率"
summary.daily — "Daily" / "每日"
summary.everyTwoDays — "Every Two Days" / "每两天"
summary.weekly — "Weekly" / "每周"
summary.dashboard — "Dashboard" / "仪表盘"
summary.projectProgress — "Project Progress" / "项目进度"
summary.hours — "{count}h"
summary.locale — "Report Language" / "报告语言"
```

## Testing

- **Stats aggregation**: Unit tests with seeded Prisma data verifying correct counts for each stat field
- **API routes**: Integration tests for generate, project summary, and workspace summary endpoints
- **Report generation**: Mock AI responses, verify TL;DR and report structure
- **Frontend components**: Test rendering with mock summary data, empty states, error states
- **History**: Test pagination and ordering of historical records
- **Settings**: Test frequency toggle persists to DB
