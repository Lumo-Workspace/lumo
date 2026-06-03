# 详情页三栏布局重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 抽出共享 `DetailLayout`（面包屑 + 正文 + 右侧属性栏），让 Milestone 详情页变成三栏、Sprint 详情页改用同一骨架且行为零回退。

**Architecture:** 新增纯展示组件 `DetailLayout`（无业务逻辑），它复用现有 `PageBreadcrumb` 并实现响应式三栏（宽屏 grid、窄屏堆叠）。Milestone 的元信息抽成 `MilestoneSidebar`（只收扁平 props）放右栏，SprintCoverage + TaskList 留正文。两个页面分别把外层骨架换成 `DetailLayout`，折叠状态由各页以 prop 传入。

**Tech Stack:** Next.js 14 App Router, TypeScript (strict, `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` on), react-intl, Tailwind, Jest + jsdom + @testing-library/react。

**Branch:** `lumo/LUM-179-detail-page-three-column-layout`（已创建并 checkout）

---

## 设计要点 / 已定决策

- **共享范围**：抽 `DetailLayout`，Milestone 与 Sprint 都改用。
- **Milestone 属性栏**：状态 / 日期 / 描述 / 归档标记放右栏；Edit/Archive/Delete 放面包屑右侧 actions 槽；SprintCoverage + TaskList 留正文。
- **折叠/响应式**：`DetailLayout` 只管响应式；折叠状态各页自治、以 prop 传入。
- **i18n**：无需新增 key，复用 `milestone.tab.title`、`milestone.field.status|startDate|targetDate|description`、`milestone.status.*`、`milestone.archived`、`milestone.targetDate.none`。
- **Milestone 面包屑两级**：`项目名(→ /projects/{slug}) / <里程碑名>(current)`。项目页里程碑是本地 state tab，无独立 URL，故按 spec 退化路径取两级（与 Sprint 一致）。
- **Sprint actions 不挪槽**：`SprintActionsMenu` 保持内联在面包屑 children 内，保证 Sprint 视觉零变化；actions 槽仅 Milestone 使用。

## 文件结构

| 文件                                                                      | 责任                                 | 动作 |
| ------------------------------------------------------------------------- | ------------------------------------ | ---- |
| `app/workspace/[workspaceUrl]/components/DetailLayout.tsx`                | 三栏骨架纯展示组件                   | 新建 |
| `__tests__/components/DetailLayout.test.tsx`                              | DetailLayout 单测                    | 新建 |
| `app/workspace/[workspaceUrl]/components/milestones/MilestoneSidebar.tsx` | Milestone 右栏元信息（扁平 props）   | 新建 |
| `__tests__/components/MilestoneSidebar.test.tsx`                          | MilestoneSidebar 单测                | 新建 |
| `app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage.tsx`   | 改用 DetailLayout + MilestoneSidebar | 修改 |
| `app/workspace/[workspaceUrl]/sprints/[sprintId]/SprintDetailClient.tsx`  | 外层骨架换 DetailLayout              | 修改 |

无 schema 变更、无新依赖、无 locale 文件改动。

---

## Task 1: DetailLayout 组件

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/DetailLayout.tsx`
- Test: `__tests__/components/DetailLayout.test.tsx`

- [ ] **Step 1: Write the failing test**

`__tests__/components/DetailLayout.test.tsx`:

```tsx
/** @jest-environment jsdom */

// Isolate DetailLayout from PageBreadcrumb's heavy deps (sidebar/separator UI).
jest.mock('@/app/workspace/[workspaceUrl]/components/PageBreadcrumb', () => ({
  PageBreadcrumb: ({
    children,
    actions,
  }: {
    children?: React.ReactNode
    actions?: React.ReactNode
  }) => (
    <div>
      <div data-testid='bc'>{children}</div>
      {actions ? <div data-testid='actions'>{actions}</div> : null}
    </div>
  ),
}))

import { render, screen } from '@testing-library/react'
import { DetailLayout } from '@/app/workspace/[workspaceUrl]/components/DetailLayout'

test('renders breadcrumb, body and sidebar', () => {
  render(
    <DetailLayout breadcrumb={<span>BC</span>} sidebar={<span>SIDE</span>}>
      <span>BODY</span>
    </DetailLayout>
  )
  expect(screen.getByText('BC')).toBeTruthy()
  expect(screen.getByText('BODY')).toBeTruthy()
  expect(screen.getByText('SIDE')).toBeTruthy()
})

test('hides sidebar when collapsed', () => {
  render(
    <DetailLayout
      breadcrumb={<span>BC</span>}
      sidebar={<span>SIDE</span>}
      sidebarCollapsed
    >
      <span>BODY</span>
    </DetailLayout>
  )
  expect(screen.getByText('BODY')).toBeTruthy()
  expect(screen.queryByText('SIDE')).toBeNull()
})

test('hides sidebar when none provided', () => {
  render(
    <DetailLayout breadcrumb={<span>BC</span>}>
      <span>BODY</span>
    </DetailLayout>
  )
  expect(screen.queryByText('SIDE')).toBeNull()
})

test('renders actions slot', () => {
  render(
    <DetailLayout breadcrumb={<span>BC</span>} actions={<span>ACT</span>}>
      <span>BODY</span>
    </DetailLayout>
  )
  expect(screen.getByText('ACT')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/DetailLayout.test.tsx`
Expected: FAIL — `Cannot find module '@/app/workspace/[workspaceUrl]/components/DetailLayout'`.

- [ ] **Step 3: Write minimal implementation**

`app/workspace/[workspaceUrl]/components/DetailLayout.tsx`:

```tsx
import type { ReactNode } from 'react'
import { PageBreadcrumb } from './PageBreadcrumb'

interface DetailLayoutProps {
  /** Breadcrumb content (multi-level allowed). */
  breadcrumb: ReactNode
  /** Right-aligned actions in the breadcrumb bar. */
  actions?: ReactNode
  /** Right-hand properties panel. Omit for a single-column body. */
  sidebar?: ReactNode
  /** When true, hide the sidebar (collapse is owned by the page). */
  sidebarCollapsed?: boolean
  /** Main content area. */
  children: ReactNode
}

/**
 * Shared three-part detail layout: breadcrumb on top, main content in the
 * center, an optional properties panel on the right. Pure presentation — the
 * page owns data fetching and collapse state.
 *
 * Responsive: on `lg` and up it is a two-column grid (content + 320px rail)
 * with each column scrolling internally; below `lg` it stacks vertically
 * (rail below content) and the whole body scrolls. No horizontal scroll.
 */
export function DetailLayout({
  breadcrumb,
  actions,
  sidebar,
  sidebarCollapsed = false,
  children,
}: DetailLayoutProps) {
  const showSidebar = sidebar != null && !sidebarCollapsed
  return (
    <div className='flex flex-col h-full overflow-hidden'>
      <PageBreadcrumb actions={actions}>{breadcrumb}</PageBreadcrumb>
      <div
        className={
          showSidebar
            ? 'flex-1 min-h-0 flex flex-col overflow-y-auto lg:grid lg:grid-cols-[1fr_320px] lg:gap-4 lg:pr-4 lg:overflow-hidden'
            : 'flex-1 min-h-0 overflow-hidden'
        }
      >
        {children}
        {showSidebar ? (
          <aside className='lg:overflow-y-auto'>{sidebar}</aside>
        ) : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/DetailLayout.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/DetailLayout.tsx __tests__/components/DetailLayout.test.tsx
git commit -m "feat: add shared DetailLayout three-column skeleton [LUM-179]"
```

---

## Task 2: MilestoneSidebar 组件

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/milestones/MilestoneSidebar.tsx`
- Test: `__tests__/components/MilestoneSidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

`__tests__/components/MilestoneSidebar.test.tsx`:

```tsx
/** @jest-environment jsdom */

const en: Record<string, string> = {
  'milestone.field.status': 'Status',
  'milestone.field.targetDate': 'Target date',
  'milestone.field.description': 'Description',
  'milestone.status.ACTIVE': 'Active',
  'milestone.status.PLANNED': 'Planned',
  'milestone.archived': 'Archived',
  'milestone.targetDate.none': 'No target date',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useFormatDate', () => ({
  useFormatDate: () => ({ fmtDate: (d: string) => `D(${d})` }),
}))

import { render, screen } from '@testing-library/react'
import { MilestoneSidebar } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneSidebar'

test('renders status, date range and description', () => {
  render(
    <MilestoneSidebar
      status='ACTIVE'
      startDate='2026-06-01T00:00:00.000Z'
      targetDate='2026-08-31T00:00:00.000Z'
      description='Ship the thing'
      archived={false}
    />
  )
  expect(screen.getByText('Active')).toBeTruthy()
  expect(screen.getByText('Ship the thing')).toBeTruthy()
  // Both dates formatted via the mocked fmtDate.
  expect(screen.getByText(/D\(2026-06-01/)).toBeTruthy()
  expect(screen.getByText(/D\(2026-08-31/)).toBeTruthy()
})

test('shows archived badge and target-date fallback, no description block', () => {
  render(
    <MilestoneSidebar
      status='PLANNED'
      startDate={null}
      targetDate={null}
      description={null}
      archived={true}
    />
  )
  expect(screen.getByText('Archived')).toBeTruthy()
  expect(screen.getByText('No target date')).toBeTruthy()
  expect(screen.queryByText('Description')).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/MilestoneSidebar.test.tsx`
Expected: FAIL — `Cannot find module '.../milestones/MilestoneSidebar'`.

- [ ] **Step 3: Write minimal implementation**

`app/workspace/[workspaceUrl]/components/milestones/MilestoneSidebar.tsx`:

```tsx
'use client'

import { useIntl } from 'react-intl'
import type { ApiMilestone } from '@/lib/api-client'
import { useFormatDate } from '../../hooks/useFormatDate'

const STATUS_CLASS: Record<ApiMilestone['status'], string> = {
  PLANNED: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  ACTIVE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  COMPLETED:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  CANCELLED: 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-500',
}

// Calendar dates stored at UTC midnight — format in UTC so the shown day
// matches what was entered regardless of the viewer's time zone.
const DATE_OPTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
}

interface MilestoneSidebarProps {
  status: ApiMilestone['status']
  startDate: string | null
  targetDate: string | null
  description: string | null
  archived: boolean
}

/** Milestone metadata rail. Receives only flat fields (ISP/LoD). */
export function MilestoneSidebar({
  status,
  startDate,
  targetDate,
  description,
  archived,
}: MilestoneSidebarProps) {
  const intl = useIntl()
  const { fmtDate } = useFormatDate()
  return (
    <div className='flex flex-col gap-4 px-4 pb-6 text-sm lg:px-0'>
      <section>
        <div className='text-xs font-medium text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.field.status' })}
        </div>
        <div className='mt-1 flex items-center gap-2'>
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}
          >
            {intl.formatMessage({ id: `milestone.status.${status}` })}
          </span>
          {archived ? (
            <span className='rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>
              {intl.formatMessage({ id: 'milestone.archived' })}
            </span>
          ) : null}
        </div>
      </section>

      <section>
        <div className='text-xs font-medium text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.field.targetDate' })}
        </div>
        <div className='mt-1 text-zinc-600 dark:text-zinc-300'>
          {startDate ? <span>{fmtDate(startDate, DATE_OPTS)} → </span> : null}
          <span>
            {targetDate
              ? fmtDate(targetDate, DATE_OPTS)
              : intl.formatMessage({ id: 'milestone.targetDate.none' })}
          </span>
        </div>
      </section>

      {description ? (
        <section>
          <div className='text-xs font-medium text-muted-foreground'>
            {intl.formatMessage({ id: 'milestone.field.description' })}
          </div>
          <p className='mt-1 whitespace-pre-wrap text-zinc-600 dark:text-zinc-300'>
            {description}
          </p>
        </section>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/MilestoneSidebar.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/milestones/MilestoneSidebar.tsx __tests__/components/MilestoneSidebar.test.tsx
git commit -m "feat: add MilestoneSidebar properties rail [LUM-179]"
```

---

## Task 3: Milestone 详情页改用 DetailLayout

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage.tsx`

无新单测（页面组件含大量 hooks，仓库惯例不对其做单测）；由 Task 1/2 的组件单测 + `tsc` + 现有套件覆盖。

- [ ] **Step 1: Update imports**

在 import 区：删除不再需要的 `Button` 之外的耦合保持原样，新增 `Link`、breadcrumb UI、`DetailLayout`、`MilestoneSidebar`。把文件顶部 import 块替换为：

```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { milestonesClient, type ApiMilestone } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import {
  findProjectForMilestoneSegment,
  getCanonicalMilestonePath,
  MILESTONE_CUID_RE,
} from '../../utils/milestonePath'
import {
  useMilestone,
  useMilestoneByProjectAndSlug,
} from '../../hooks/useMilestone'
import { useProjects } from '../../hooks/useProjects'
import { Button } from '@/components/ui/button'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { DetailLayout } from '../DetailLayout'
import { MilestoneSidebar } from '../milestones/MilestoneSidebar'
import { MilestoneFormDialog } from '../milestones/MilestoneFormDialog'
import { MilestoneSprintCoverage } from '../milestones/MilestoneSprintCoverage'
import { TaskListByMilestone } from '../milestones/TaskListByMilestone'
```

> Note: `useFormatDate`, `STATUS_CLASS` const, and `DATE_OPTS` const are removed from this file — date formatting + status badge now live in `MilestoneSidebar`. Delete the `const STATUS_CLASS = {...}` and `const DATE_OPTS = {...}` blocks (lines ~25–40) and the `const { fmtDate } = useFormatDate()` line.

- [ ] **Step 2: Remove the now-unused `fmtDate` and consts**

Delete these from the component body / module scope:

- `const STATUS_CLASS: Record<...> = { ... }` (module scope)
- `const DATE_OPTS: Intl.DateTimeFormatOptions = { ... }` (module scope)
- `const { fmtDate } = useFormatDate()` (inside `MilestoneDetailPage`)
- the `useFormatDate` import (covered by Step 1's replacement block).

- [ ] **Step 3: Replace the loading branch**

Replace the existing `if (loading) { return (...) }` block with:

```tsx
if (loading) {
  return (
    <DetailLayout
      breadcrumb={
        <span className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.tab.title' })}
        </span>
      }
    >
      <div className='flex-1 space-y-6 p-4 md:p-8' aria-busy='true'>
        <div className='h-8 w-1/3 animate-pulse rounded bg-muted/50' />
        <div className='h-4 w-1/4 animate-pulse rounded bg-muted/50' />
        <div className='h-40 animate-pulse rounded-lg border border-border bg-muted/50' />
      </div>
    </DetailLayout>
  )
}
```

- [ ] **Step 4: Replace the notFound branch**

Replace the existing `if (!milestone) { return (...) }` block with:

```tsx
if (!milestone) {
  return (
    <DetailLayout
      breadcrumb={
        <span className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.tab.title' })}
        </span>
      }
    >
      <div className='flex-1 p-4 md:p-8'>
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.notFound' })}
        </p>
      </div>
    </DetailLayout>
  )
}
```

- [ ] **Step 5: Replace the main return block**

Replace the entire final `return ( <div className='flex-1 overflow-y-auto space-y-6 p-4 md:p-8'> ... </div> )` (the success render, starting at the `<header>` and ending after `MilestoneFormDialog`) with:

```tsx
const projectName = project?.name ?? params.projectSlug
const projectHref = `/workspace/${params.workspaceUrl}/projects/${params.projectSlug}`

const breadcrumb = (
  <Breadcrumb>
    <BreadcrumbList>
      <BreadcrumbItem>
        <BreadcrumbLink asChild>
          <Link href={projectHref}>{projectName}</Link>
        </BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbSeparator />
      <BreadcrumbItem>
        <BreadcrumbPage>{milestone.name}</BreadcrumbPage>
      </BreadcrumbItem>
    </BreadcrumbList>
  </Breadcrumb>
)

const actions = (
  <div className='flex gap-2'>
    {!archived ? (
      <Button variant='outline' onClick={() => setEditing(true)}>
        {intl.formatMessage({ id: 'milestone.edit' })}
      </Button>
    ) : null}
    {archived ? (
      <Button
        variant='outline'
        disabled={mutating}
        onClick={() => unarchiveMutation.mutate()}
      >
        {intl.formatMessage({ id: 'milestone.unarchive' })}
      </Button>
    ) : (
      <Button
        variant='outline'
        disabled={mutating}
        onClick={() => archiveMutation.mutate()}
      >
        {intl.formatMessage({ id: 'milestone.archive' })}
      </Button>
    )}
    <Button
      variant='outline'
      disabled={mutating}
      className='text-red-600 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400'
      onClick={() => {
        const ok = window.confirm(
          intl.formatMessage(
            { id: 'milestone.delete.confirm' },
            { name: milestone.name }
          )
        )
        if (ok) deleteMutation.mutate()
      }}
    >
      {intl.formatMessage({ id: 'milestone.delete' })}
    </Button>
  </div>
)

return (
  <>
    <DetailLayout
      breadcrumb={breadcrumb}
      actions={actions}
      sidebar={
        <MilestoneSidebar
          status={milestone.status}
          startDate={milestone.startDate}
          targetDate={milestone.targetDate}
          description={milestone.description}
          archived={archived}
        />
      }
    >
      <div className='space-y-6 p-4 md:p-8 lg:overflow-y-auto'>
        <h1 className='text-2xl font-semibold text-balance'>
          {milestone.name}
        </h1>
        <MilestoneSprintCoverage coverage={milestone.sprintCoverage} />
        <TaskListByMilestone
          projectId={milestone.projectId}
          milestoneId={milestone.id}
        />
      </div>
    </DetailLayout>

    {editing ? (
      <MilestoneFormDialog
        projectId={milestone.projectId}
        milestone={milestone}
        onClose={() => setEditing(false)}
      />
    ) : null}
  </>
)
```

> The `<h1>` stays in the body so the milestone name still reads as the page's main heading; status/dates/description move to the rail.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Watch for: unused `useFormatDate` import, unused `STATUS_CLASS`/`DATE_OPTS` — remove if flagged.)

- [ ] **Step 7: Run existing milestone tests + new component tests**

Run: `npx jest __tests__/components/ __tests__/app/workspace/`
Expected: PASS (no regressions).

- [ ] **Step 8: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/pages/MilestoneDetailPage.tsx
git commit -m "feat: milestone detail page uses three-column DetailLayout [LUM-179]"
```

---

## Task 4: Sprint 详情页改用 DetailLayout（行为零回退）

**Files:**

- Modify: `app/workspace/[workspaceUrl]/sprints/[sprintId]/SprintDetailClient.tsx`

- [ ] **Step 1: Add the DetailLayout import**

在 import 区（紧跟现有 `PageBreadcrumb` import 之后）新增：

```tsx
import { DetailLayout } from '@/app/workspace/[workspaceUrl]/components/DetailLayout'
```

`PageBreadcrumb` 的 import 可保留（loading/notFound 分支会改用 DetailLayout，最终不再直接用 PageBreadcrumb——见 Step 5 移除）。

- [ ] **Step 2: Replace the loading branch**

Replace the `if (isLoading) { return (...) }` block with:

```tsx
if (isLoading) {
  return (
    <DetailLayout
      breadcrumb={breadcrumb(
        intl.formatMessage({ id: 'sprints.detail.loading' })
      )}
    >
      <div className='p-6 text-muted-foreground'>
        {intl.formatMessage({ id: 'sprints.detail.loading' })}
      </div>
    </DetailLayout>
  )
}
```

- [ ] **Step 3: Replace the notFound branch**

Replace the `if (error || !sprint) { return (...) }` block with:

```tsx
if (error || !sprint) {
  return (
    <DetailLayout
      breadcrumb={breadcrumb(
        intl.formatMessage({ id: 'sprints.detail.notFound' })
      )}
    >
      <div className='p-6 text-muted-foreground'>
        {intl.formatMessage({ id: 'sprints.detail.notFound' })}
      </div>
    </DetailLayout>
  )
}
```

- [ ] **Step 4: Replace the main return block**

Replace the final `return ( <div className='flex flex-col h-full overflow-hidden'> ... </div> )` block with:

```tsx
return (
  <DetailLayout
    breadcrumb={
      <div className='flex items-center gap-1.5'>
        {breadcrumb(sprint.name)}
        <SprintActionsMenu
          sprint={sprint}
          onDeleted={() => router.push(sprintsHref)}
        />
      </div>
    }
    sidebar={sidePanel}
    sidebarCollapsed={sidebarCollapsed}
  >
    {workspace}
  </DetailLayout>
)
```

> `SprintActionsMenu` 仍内联在 breadcrumb children（不走 actions 槽），保证视觉零变化。`sidePanel` / `workspace` / `sidebarCollapsed` 全部沿用现有定义，不改。

- [ ] **Step 5: Remove the now-unused `PageBreadcrumb` import**

如果 `PageBreadcrumb` 在文件中已无引用，删除其 import 行：

```tsx
import { PageBreadcrumb } from '@/app/workspace/[workspaceUrl]/components/PageBreadcrumb'
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`PageBreadcrumb` import 若残留未用，TS6133 会提示 → 删掉。)

- [ ] **Step 7: Run sprint-related tests**

Run: `npx jest __tests__/components/SprintSidebar.test.tsx __tests__/components/SprintBurndownChart.test.tsx __tests__/components/DetailLayout.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/sprints/\[sprintId\]/SprintDetailClient.tsx
git commit -m "feat: sprint detail page uses shared DetailLayout [LUM-179]"
```

---

## Task 5: 全量验证

**Files:** 无（仅校验）

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `npx jest`
Expected: PASS（无回归）。

- [ ] **Step 3: No console.log in touched files**

Run:

```bash
grep -rn "console.log" \
  "app/workspace/[workspaceUrl]/components/DetailLayout.tsx" \
  "app/workspace/[workspaceUrl]/components/milestones/MilestoneSidebar.tsx" \
  "app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage.tsx" \
  "app/workspace/[workspaceUrl]/sprints/[sprintId]/SprintDetailClient.tsx"
```

Expected: no output.

- [ ] **Step 4: Manual regression review (Sprint 保活清单)**

确认（读代码核对，无需运行 dev server）：

- Sprint 折叠开关仍由 `SprintTasksView` 工具栏经 `onToggleSidebar` 驱动，`sidebarCollapsed` state 未改。
- 折叠状态 cache key（`CACHE_KEY.sprintSidebarCollapsed`）读写逻辑未动。
- `sidePanel` / `workspace` 定义未改，宽屏 320px 右栏不变。

- [ ] **Step 5: Final summary (no extra commit needed)**

所有任务已各自 commit；分支 `lumo/LUM-179-detail-page-three-column-layout` 就绪，可开 PR。

---

## Self-Review 结论

- **Spec 覆盖**：三栏骨架(Task1) / Milestone 三栏+面包屑+属性栏(Task3) / Sprint 复用同骨架(Task4) / 响应式(DetailLayout className) / 扁平 props(MilestoneSidebar, Task2) / i18n(复用现有 key) / 测试(Task1,2) / tsc+无 console.log(Task5) —— 全部有对应任务。
- **退化记录**：面包屑两级（项目页里程碑 tab 无独立 URL）；Sprint actions 不挪槽（保活优先）。两者均在「设计要点」显式记录。
- **类型一致**：`DetailLayoutProps`、`MilestoneSidebarProps` 在使用处字段名/类型一致；`status: ApiMilestone['status']`、`startDate/targetDate/description: string | null`、`archived: boolean` 与 `milestone.*` 取值匹配。
- **占位符**：无 TBD/TODO，所有代码步骤含完整代码。
