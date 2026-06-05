# Task View Config Panel (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the LUM-224 task-view block configurable — an in-block popover (editable mode only) to set the six filters (project, milestone, status, priority, tag, assignee) + `groupBy`, persisted via `updateAttributes({ config })`; the live list re-queries on change and renders grouped. Adds the one missing data source: a workspace-wide milestone list endpoint.

**Architecture:** Two parts. **(A) Backend** — a small workspace-milestone slice mirroring the Phase-1 workspace-task query: `milestoneRepository.findByWorkspace` → `milestoneService.listByWorkspace` → `GET /api/milestones/workspace` → client + key + `useWorkspaceMilestones`. **(B) UI** — a reusable `FilterCheckboxGroup`, a `TaskViewConfigPanel` (Popover assembling groupBy + 6 filter groups, fed by `useProjects`/`useTags`/`useMembers`/`useWorkspaceMilestones` + static status/priority), wired into `TaskViewBlock` (editable-gated trigger → `updateAttributes`), plus group-by rendering of the list.

**Tech Stack:** Next.js 14, TS strict (exactOptionalPropertyTypes + noUncheckedIndexedAccess), Prisma, Zod, React Query, react-intl, shadcn/ui (Popover/Checkbox/Button/Badge), Jest + @testing-library/react.

**Scope (per spec §5 P3):** filters + groupBy + persistence + grouped render. The list/kanban **view toggle** stays a P4 concern (kanban rendering is P4) — P3 keeps `view` in the type but the panel does NOT expose a kanban toggle yet. No polling/optimistic (P4).

**Key constraints (from exploration):**
- New UI files MUST use **semantic Tailwind tokens** (`text-muted-foreground`, `bg-muted`, `text-foreground`, `border-border`) — do NOT copy `DisplayOptionsMenu`'s raw `zinc/gray` classes (it's grandfathered; copying trips `lint:tokens` in new files).
- Status/priority option labels **reuse the existing English constants** `API_STATUS_LABEL` (`app/workspace/[workspaceUrl]/utils/taskStatus.ts`) and `PRIORITY_CONFIG` (`app/workspace/[workspaceUrl]/components/fields/shared.tsx`) — consistent with how the whole app renders them (they are not i18n'd app-wide). Only the panel **chrome** (section titles, groupBy options, trigger/clear labels) gets new i18n keys.
- Radix **Select can't open in jsdom** — use inline `Checkbox` lists (no nested poppers) in the panel; jsdom-friendly + testable.
- Milestone → workspace scoping is via `project.workspaceId` (Milestone has no direct workspaceId).

**No schema change / no migration.**

**Reference:** spec `docs/superpowers/specs/2026-06-04-embedded-live-task-view-design.md`; Phase-1 backend (`app/api/tasks/workspace/route.ts`, `lib/services/task-query.service.ts`, `taskRepository.findByWorkspaceWithFilters`) as the milestone-slice template; `app/workspace/[workspaceUrl]/components/DisplayOptionsMenu.tsx` as the popover template (structure only, NOT its color classes).

**Branch:** `lumo/LUM-224-task-view-config-panel` (worktree `/Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-224-p3`, off origin/main @ 35ba46b8 — includes P1+P2).

---

## File Structure

| File | Responsibility | C/M |
| --- | --- | --- |
| `lib/repositories/milestone.repository.ts` | add `findByWorkspace(workspaceId, filter)` | M |
| `__tests__/milestone.repository.workspace.test.ts` | where/scoping coverage | C |
| `lib/services/milestone.service.ts` | add `listByWorkspace(workspaceId, filter)` | M |
| `__tests__/milestone.service.workspace.test.ts` | passes args to repo | C |
| `app/api/milestones/workspace/route.ts` | thin GET | C |
| `__tests__/api.milestones.workspace.route.test.ts` | auth/filter/return | C |
| `lib/api-client/milestones.ts` | add `listByWorkspace` | M |
| `app/workspace/[workspaceUrl]/constants.ts` | add `API.milestones.workspace` | M |
| `lib/query/keys.ts` | add `milestones.byWorkspace` | M |
| `app/workspace/[workspaceUrl]/hooks/useWorkspaceMilestones.ts` | RQ hook | C |
| `__tests__/hooks/useWorkspaceMilestones.test.tsx` | hook fetch | C |
| `lib/editor/nodes/task-view-filter-group.tsx` | reusable `FilterCheckboxGroup` | C |
| `__tests__/editor/task-view-filter-group.test.tsx` | toggle → onChange | C |
| `lib/editor/nodes/task-view-config-panel.tsx` | `TaskViewConfigPanel` (popover) | C |
| `__tests__/editor/task-view-config-panel.test.tsx` | panel edits → onChange(config) | C |
| `lib/editor/nodes/task-view-group.ts` | `groupTasks(tasks, groupBy, nameMaps)` helper | C |
| `__tests__/editor/task-view-group.test.ts` | grouping order/buckets | C |
| `lib/editor/nodes/task-view-block.tsx` | wire panel (editable) + grouped render | M |
| `__tests__/components/TaskViewBlockViewer.test.tsx` | grouped render + panel-hidden-in-readonly | M |
| `lib/i18n/*.json` (16) | ~13 `editor.taskView.*` panel chrome keys | M |

**Shared identifiers:** `milestoneRepository.findByWorkspace`, `milestoneService.listByWorkspace`, `GET /api/milestones/workspace`, `API.milestones.workspace`, `queryKeys.milestones.byWorkspace`, `milestonesClient.listByWorkspace`, `useWorkspaceMilestones`, `FilterCheckboxGroup`, `TaskViewConfigPanel`, `groupTasks`.

All commands assume: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-224-p3` first.

---

## PART A — Workspace milestone backend

### Task 1: Repository `findByWorkspace`

**Files:** Modify `lib/repositories/milestone.repository.ts`; Test `__tests__/milestone.repository.workspace.test.ts`.

FIRST read `lib/repositories/milestone.repository.ts` to confirm `MilestoneListFilter` type + the `findByProject` style.

- [ ] **Step 1 — failing test** `__tests__/milestone.repository.workspace.test.ts`:
```typescript
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

const mockFindMany = jest.fn()
jest.mock('@/lib/db/prisma', () => ({
  prisma: { milestone: { findMany: (...a: any[]) => mockFindMany(...a) } },
}))
beforeEach(() => jest.clearAllMocks())

describe('milestoneRepository.findByWorkspace', () => {
  it('scopes via project.workspaceId and excludes archived for active', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await milestoneRepository.findByWorkspace('w1', 'active')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { project: { workspaceId: 'w1' }, archivedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      })
    )
  })
  it('includes archived when filter=all', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await milestoneRepository.findByWorkspace('w1', 'all')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { project: { workspaceId: 'w1' } } })
    )
  })
  it('only archived when filter=archived', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await milestoneRepository.findByWorkspace('w1', 'archived')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { project: { workspaceId: 'w1' }, archivedAt: { not: null } },
      })
    )
  })
})
```
- [ ] **Step 2 — run, expect fail** `npx jest __tests__/milestone.repository.workspace.test.ts`.
- [ ] **Step 3 — implement** inside `export const milestoneRepository = { ... }` (next to `findByProject`):
```typescript
  async findByWorkspace(
    workspaceId: string,
    filter: MilestoneListFilter = 'active'
  ) {
    const where: Prisma.MilestoneWhereInput = {
      project: { workspaceId },
    }
    if (filter === 'active') where.archivedAt = null
    else if (filter === 'archived') where.archivedAt = { not: null }
    return prisma.milestone.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
  },
```
(`Prisma`, `MilestoneListFilter` are already in scope in this file — confirm by reading the top.)
- [ ] **Step 4 — run, expect pass** (3).
- [ ] **Step 5 — tsc + commit**
```bash
npx tsc --noEmit
git add lib/repositories/milestone.repository.ts __tests__/milestone.repository.workspace.test.ts
git commit -m "feat: workspace-scoped milestone repository query [LUM-224]"
```

### Task 2: Service `listByWorkspace`

**Files:** Modify `lib/services/milestone.service.ts`; Test `__tests__/milestone.service.workspace.test.ts`.

- [ ] **Step 1 — failing test**:
```typescript
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findByWorkspace: jest.fn() },
}))
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { milestoneService } from '@/lib/services/milestone.service'
const mock = milestoneRepository.findByWorkspace as jest.Mock
beforeEach(() => jest.clearAllMocks())

describe('milestoneService.listByWorkspace', () => {
  it('delegates to the repository with workspaceId + filter', async () => {
    mock.mockResolvedValueOnce([{ id: 'm1' }])
    const res = await milestoneService.listByWorkspace('w1', 'active')
    expect(mock).toHaveBeenCalledWith('w1', 'active')
    expect(res).toEqual([{ id: 'm1' }])
  })
})
```
NOTE: `milestone.service.ts` imports other things (projectService etc.). If mocking only the repository causes import-time errors from unrelated deps, mock those too (mirror an existing milestone.service test if one exists — search `__tests__` first). The method itself only needs the repository.
- [ ] **Step 2 — run, expect fail**.
- [ ] **Step 3 — implement** inside `export const milestoneService = { ... }`:
```typescript
  /**
   * All milestones in the viewer's workspace (for the task-view config picker).
   * Scope comes from the authenticated identity's workspaceId — no per-project
   * authorization needed since it is the caller's own workspace.
   */
  async listByWorkspace(
    workspaceId: string,
    filter: MilestoneListFilter = 'active'
  ) {
    return milestoneRepository.findByWorkspace(workspaceId, filter)
  },
```
(`MilestoneListFilter` is already imported at the top of the service.)
- [ ] **Step 4 — run, expect pass**.
- [ ] **Step 5 — tsc + commit**
```bash
npx tsc --noEmit
git add lib/services/milestone.service.ts __tests__/milestone.service.workspace.test.ts
git commit -m "feat: milestoneService.listByWorkspace [LUM-224]"
```

### Task 3: Route `GET /api/milestones/workspace`

**Files:** Create `app/api/milestones/workspace/route.ts`; Test `__tests__/api.milestones.workspace.route.test.ts`.

FIRST read `app/api/tasks/workspace/route.ts` (mirror its auth + error handling) and an existing milestone route for the `{ milestones }` shape.

- [ ] **Step 1 — failing test** (`@jest-environment node`):
```typescript
/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: { listByWorkspace: jest.fn() },
}))
import type { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'
import { GET } from '@/app/api/milestones/workspace/route'
const mockId = requireIdentity as jest.Mock
const mockList = milestoneService.listByWorkspace as jest.Mock
const req = (qs: string) =>
  new Request(`http://localhost/api/milestones/workspace${qs}`) as unknown as NextRequest
beforeEach(() => jest.clearAllMocks())

describe('GET /api/milestones/workspace', () => {
  it('returns workspace milestones (default active)', async () => {
    mockId.mockResolvedValueOnce({ workspaceId: 'w1' })
    mockList.mockResolvedValueOnce([{ id: 'm1' }])
    const res = await GET(req(''))
    expect(mockList).toHaveBeenCalledWith('w1', 'active')
    expect(await res.json()).toEqual({ milestones: [{ id: 'm1' }] })
  })
  it('passes ?filter=all through', async () => {
    mockId.mockResolvedValueOnce({ workspaceId: 'w1' })
    mockList.mockResolvedValueOnce([])
    await GET(req('?filter=all'))
    expect(mockList).toHaveBeenCalledWith('w1', 'all')
  })
  it('falls back to active for an unknown filter', async () => {
    mockId.mockResolvedValueOnce({ workspaceId: 'w1' })
    mockList.mockResolvedValueOnce([])
    await GET(req('?filter=bogus'))
    expect(mockList).toHaveBeenCalledWith('w1', 'active')
  })
})
```
- [ ] **Step 2 — run, expect fail**.
- [ ] **Step 3 — implement** `app/api/milestones/workspace/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'
import type { MilestoneListFilter } from '@/lib/repositories/milestone.repository'

const VALID_FILTERS: readonly MilestoneListFilter[] = ['active', 'all', 'archived']

export async function GET(request: NextRequest) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { searchParams } = new URL(request.url)
    const raw = searchParams.get('filter')
    const filter: MilestoneListFilter =
      raw && (VALID_FILTERS as readonly string[]).includes(raw)
        ? (raw as MilestoneListFilter)
        : 'active'
    const milestones = await milestoneService.listByWorkspace(
      identity.workspaceId,
      filter
    )
    return NextResponse.json({ milestones })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
```
Confirm `MilestoneListFilter` is exported from the repository (it's referenced by `findByProject`'s signature — if it lives elsewhere, import from the real module).
- [ ] **Step 4 — run, expect pass** (3).
- [ ] **Step 5 — tsc + commit**
```bash
npx tsc --noEmit
git add app/api/milestones/workspace/route.ts __tests__/api.milestones.workspace.route.test.ts
git commit -m "feat: GET /api/milestones/workspace route [LUM-224]"
```

### Task 4: Client + constant + query key

**Files:** Modify `lib/api-client/milestones.ts`, `app/workspace/[workspaceUrl]/constants.ts`, `lib/query/keys.ts`; Test `__tests__/api-client.milestones.workspace.test.ts`.

- [ ] **Step 1 — failing test**:
```typescript
jest.mock('@/lib/api-client/base', () => ({ apiFetch: jest.fn() }))
import { apiFetch } from '@/lib/api-client/base'
import { milestonesClient } from '@/lib/api-client/milestones'
const m = apiFetch as jest.Mock
beforeEach(() => jest.clearAllMocks())

describe('milestonesClient.listByWorkspace', () => {
  it('omits the filter param for the active default', () => {
    milestonesClient.listByWorkspace()
    expect(m).toHaveBeenCalledWith('/api/milestones/workspace')
  })
  it('appends ?filter=all for non-default', () => {
    milestonesClient.listByWorkspace('all')
    expect(m).toHaveBeenCalledWith('/api/milestones/workspace?filter=all')
  })
})
```
- [ ] **Step 2 — run, expect fail**.
- [ ] **Step 3 — constant** in `constants.ts` inside the `milestones:` object: add
```typescript
    workspace: '/api/milestones/workspace',
```
- [ ] **Step 4 — client method** in `milestonesClient` (mirror `listByProject`):
```typescript
  listByWorkspace(filter: MilestoneListFilter = 'active') {
    const base = API.milestones.workspace
    const url = filter === 'active' ? base : `${base}?filter=${filter}`
    return apiFetch<{ milestones: ApiMilestone[] }>(url)
  },
```
- [ ] **Step 5 — query key** in `lib/query/keys.ts` inside `milestones`:
```typescript
    byWorkspace: (workspaceId: string) =>
      ['milestones', 'byWorkspace', workspaceId] as const,
```
- [ ] **Step 6 — run, expect pass**; then `npx tsc --noEmit`.
- [ ] **Step 7 — commit**
```bash
git add lib/api-client/milestones.ts app/workspace/[workspaceUrl]/constants.ts lib/query/keys.ts __tests__/api-client.milestones.workspace.test.ts
git commit -m "feat: milestone workspace api-client + key [LUM-224]"
```

### Task 5: `useWorkspaceMilestones` hook

**Files:** Create `app/workspace/[workspaceUrl]/hooks/useWorkspaceMilestones.ts`; Test `__tests__/hooks/useWorkspaceMilestones.test.tsx`.

FIRST read `app/workspace/[workspaceUrl]/hooks/useMilestones.ts` (the model) + `useWorkspaceTasks.ts` (for the `useParams` workspace-slug pattern).

- [ ] **Step 1 — failing test**:
```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
jest.mock('next/navigation', () => ({ useParams: () => ({ workspaceUrl: 'acme' }) }))
jest.mock('@/lib/api-client', () => ({ milestonesClient: { listByWorkspace: jest.fn() } }))
import { milestonesClient } from '@/lib/api-client'
import { useWorkspaceMilestones } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceMilestones'
const mock = milestonesClient.listByWorkspace as jest.Mock
const wrapper = ({ children }: { children: ReactNode }) => {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={c}>{children}</QueryClientProvider>
}
beforeEach(() => jest.clearAllMocks())

describe('useWorkspaceMilestones', () => {
  it('fetches and returns milestones', async () => {
    mock.mockResolvedValueOnce({ milestones: [{ id: 'm1', name: 'M1' }] })
    const { result } = renderHook(() => useWorkspaceMilestones(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.milestones).toHaveLength(1)
  })
})
```
- [ ] **Step 2 — run, expect fail**.
- [ ] **Step 3 — implement**:
```typescript
'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import {
  milestonesClient,
  type ApiMilestone,
  type MilestoneListFilter,
} from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

/** Workspace-wide milestone list for the task-view config picker. */
export function useWorkspaceMilestones(filter: MilestoneListFilter = 'active') {
  const params = useParams<{ workspaceUrl: string }>()
  const workspaceUrl = params?.workspaceUrl ?? ''
  const query = useQuery<ApiMilestone[]>({
    queryKey: [...queryKeys.milestones.byWorkspace(workspaceUrl), filter],
    queryFn: async () => {
      const data = await milestonesClient.listByWorkspace(filter)
      return data.milestones
    },
  })
  return {
    milestones: query.data ?? [],
    loading: query.isLoading,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load milestones.')
      : null,
  }
}
```
Confirm `ApiMilestone` / `MilestoneListFilter` are re-exported from `@/lib/api-client` (they come from `milestones.ts`; check the barrel — if not re-exported, import from `@/lib/api-client/milestones`).
- [ ] **Step 4 — run, expect pass**; `npx tsc --noEmit`.
- [ ] **Step 5 — commit**
```bash
git add app/workspace/[workspaceUrl]/hooks/useWorkspaceMilestones.ts __tests__/hooks/useWorkspaceMilestones.test.tsx
git commit -m "feat: useWorkspaceMilestones hook [LUM-224]"
```

---

## PART B — Config panel UI

### Task 6: `FilterCheckboxGroup` (reusable)

**Files:** Create `lib/editor/nodes/task-view-filter-group.tsx`; Test `__tests__/editor/task-view-filter-group.test.tsx`.

A self-contained, controlled multi-select section: a title + a checkbox row per option; toggling emits the next selected-array. Semantic tokens only.

- [ ] **Step 1 — failing test**:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilterCheckboxGroup } from '@/lib/editor/nodes/task-view-filter-group'

it('toggles a value on and off via onChange', async () => {
  const onChange = jest.fn()
  const { rerender } = render(
    <FilterCheckboxGroup
      title='Status'
      options={[
        { value: 'TODO', label: 'Todo' },
        { value: 'DONE', label: 'Done' },
      ]}
      selected={[]}
      onChange={onChange}
    />
  )
  await userEvent.click(screen.getByRole('checkbox', { name: 'Done' }))
  expect(onChange).toHaveBeenCalledWith(['DONE'])

  rerender(
    <FilterCheckboxGroup
      title='Status'
      options={[
        { value: 'TODO', label: 'Todo' },
        { value: 'DONE', label: 'Done' },
      ]}
      selected={['DONE']}
      onChange={onChange}
    />
  )
  await userEvent.click(screen.getByRole('checkbox', { name: 'Done' }))
  expect(onChange).toHaveBeenLastCalledWith([])
})
```
- [ ] **Step 2 — run, expect fail**.
- [ ] **Step 3 — implement**:
```tsx
import type { ReactNode } from 'react'
import { Checkbox } from '@/components/ui/checkbox'

export interface FilterOption {
  value: string
  label: string
  icon?: ReactNode
}

interface FilterCheckboxGroupProps {
  title: string
  options: FilterOption[]
  selected: string[]
  onChange: (next: string[]) => void
}

/**
 * Controlled multi-select section for the task-view config panel. Inline
 * checkbox rows (no nested popper → jsdom-friendly). Semantic tokens only.
 */
export function FilterCheckboxGroup({
  title,
  options,
  selected,
  onChange,
}: FilterCheckboxGroupProps) {
  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter(v => v !== value)
        : [...selected, value]
    )
  }
  return (
    <div className='space-y-1'>
      <p className='px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground'>
        {title}
      </p>
      <div className='max-h-40 space-y-0.5 overflow-y-auto'>
        {options.map(opt => (
          <label
            key={opt.value}
            className='flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm text-foreground hover:bg-muted'
          >
            <Checkbox
              checked={selected.includes(opt.value)}
              onCheckedChange={() => toggle(opt.value)}
              aria-label={opt.label}
            />
            {opt.icon}
            <span className='truncate'>{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
```
- [ ] **Step 4 — run, expect pass**; `npx tsc --noEmit`; `npx eslint lib/editor/nodes/task-view-filter-group.tsx`.
- [ ] **Step 5 — commit**
```bash
git add lib/editor/nodes/task-view-filter-group.tsx __tests__/editor/task-view-filter-group.test.tsx
git commit -m "feat: FilterCheckboxGroup for task view config panel [LUM-224]"
```

### Task 7: `TaskViewConfigPanel`

**Files:** Create `lib/editor/nodes/task-view-config-panel.tsx`; Test `__tests__/editor/task-view-config-panel.test.tsx`.

Assembles the popover: a `groupBy` segmented row + six `FilterCheckboxGroup`s. Status/priority options come from the English constants; project/milestone/tag/assignee from data hooks. Emits a full `TaskViewConfig` via `onChange`. The TRIGGER is a small Button (caller only renders the panel in editable mode). `useMembers` is caller-driven → call `fetchMembers()` once on mount.

FIRST read: `app/workspace/[workspaceUrl]/utils/taskStatus.ts` (`API_STATUS_LABEL`), `app/workspace/[workspaceUrl]/components/fields/shared.tsx` (`PRIORITY_CONFIG`), `app/workspace/[workspaceUrl]/hooks/useProjects.ts` / `ProjectsProvider`, `useTags.ts`, `useMembers.ts`, and `components/ui/popover.tsx`. Confirm import paths.

- [ ] **Step 1 — failing test** (mock the four data hooks + intl so the panel renders deterministically):
```tsx
jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ defaultMessage, id }: { id: string; defaultMessage?: string }) => defaultMessage ?? id }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useProjects', () => ({
  useProjects: () => ({ projects: [{ id: 'p1', name: 'Acme' }] }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTags', () => ({
  useTags: () => ({ tags: [{ id: 't1', name: 'bug', color: null }] }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useWorkspaceMilestones', () => ({
  useWorkspaceMilestones: () => ({ milestones: [{ id: 'm1', name: 'V1' }] }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMembers', () => ({
  useMembers: () => ({ members: [{ actorId: 'a1', name: 'Sam' }], fetchMembers: jest.fn(), agentActors: [] }),
}))

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskViewConfigPanel } from '@/lib/editor/nodes/task-view-config-panel'
import { DEFAULT_TASK_VIEW_CONFIG } from '@/lib/editor/nodes/task-view-config'

it('emits an updated config when a status filter is toggled', async () => {
  const onChange = jest.fn()
  render(<TaskViewConfigPanel config={DEFAULT_TASK_VIEW_CONFIG} onChange={onChange} />)
  await userEvent.click(screen.getByRole('button', { name: /configure/i }))
  await userEvent.click(await screen.findByRole('checkbox', { name: 'In Progress' }))
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      filters: expect.objectContaining({ statuses: ['IN_PROGRESS'] }),
    })
  )
})

it('emits groupBy change', async () => {
  const onChange = jest.fn()
  render(<TaskViewConfigPanel config={DEFAULT_TASK_VIEW_CONFIG} onChange={onChange} />)
  await userEvent.click(screen.getByRole('button', { name: /configure/i }))
  await userEvent.click(await screen.findByRole('button', { name: 'Status' }))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ groupBy: 'status' }))
})
```
(If Radix `PopoverContent` does not mount its children in jsdom until opened and `findByRole` still can't see them, mirror whatever pattern an existing popover test in `__tests__` uses; Popover/Checkbox are confirmed jsdom-OK, unlike Select.)
- [ ] **Step 2 — run, expect fail**.
- [ ] **Step 3 — implement** `lib/editor/nodes/task-view-config-panel.tsx`:
```tsx
import { useEffect } from 'react'
import { useIntl } from 'react-intl'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useProjects } from '@/app/workspace/[workspaceUrl]/hooks/useProjects'
import { useTags } from '@/app/workspace/[workspaceUrl]/hooks/useTags'
import { useMembers } from '@/app/workspace/[workspaceUrl]/hooks/useMembers'
import { useWorkspaceMilestones } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceMilestones'
import { API_STATUS_LABEL } from '@/app/workspace/[workspaceUrl]/utils/taskStatus'
import { PRIORITY_CONFIG } from '@/app/workspace/[workspaceUrl]/components/fields/shared'
import type { ApiPriority } from '@/app/workspace/[workspaceUrl]/types'
import {
  FilterCheckboxGroup,
  type FilterOption,
} from './task-view-filter-group'
import type {
  TaskViewConfig,
  TaskViewGroupBy,
} from './task-view-config'

const STATUS_ORDER = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const
const PRIORITY_ORDER: ApiPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW']
const GROUP_BY_ORDER: TaskViewGroupBy[] = ['none', 'status', 'project', 'milestone']

interface TaskViewConfigPanelProps {
  config: TaskViewConfig
  onChange: (next: TaskViewConfig) => void
}

export function TaskViewConfigPanel({
  config,
  onChange,
}: TaskViewConfigPanelProps) {
  const intl = useIntl()
  const { projects } = useProjects()
  const { tags } = useTags()
  const { milestones } = useWorkspaceMilestones()
  const { members, fetchMembers } = useMembers()

  useEffect(() => {
    void fetchMembers()
  }, [fetchMembers])

  const f = config.filters
  const setFilter = (key: keyof TaskViewConfig['filters'], next: string[]) =>
    onChange({
      ...config,
      filters: { ...config.filters, [key]: next.length ? next : undefined },
    })

  const statusOptions: FilterOption[] = STATUS_ORDER.map(s => ({
    value: s,
    label: API_STATUS_LABEL[s] ?? s,
  }))
  const priorityOptions: FilterOption[] = PRIORITY_ORDER.map(p => ({
    value: p,
    label: PRIORITY_CONFIG[p].label,
  }))
  const projectOptions: FilterOption[] = projects.map(p => ({
    value: p.id,
    label: p.name,
  }))
  const milestoneOptions: FilterOption[] = milestones.map(m => ({
    value: m.id,
    label: m.name,
  }))
  const tagOptions: FilterOption[] = tags.map(t => ({ value: t.id, label: t.name }))
  const memberOptions: FilterOption[] = members
    .filter(m => m.actorId)
    .map(m => ({ value: m.actorId as string, label: m.name }))

  const groupByLabel = (g: TaskViewGroupBy) =>
    intl.formatMessage({
      id: `editor.taskView.groupBy.${g}`,
      defaultMessage:
        g === 'none'
          ? 'None'
          : g === 'status'
            ? 'Status'
            : g === 'project'
              ? 'Project'
              : 'Milestone',
    })

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          contentEditable={false}
          onMouseDown={e => e.preventDefault()}
          className='h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground'
          aria-label={intl.formatMessage({
            id: 'editor.taskView.configure',
            defaultMessage: 'Configure task view',
          })}
        >
          <SlidersHorizontal size={13} />
          {intl.formatMessage({
            id: 'editor.taskView.configure',
            defaultMessage: 'Configure task view',
          })}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='max-h-[28rem] w-64 space-y-3 overflow-y-auto p-3'
        contentEditable={false}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className='space-y-1'>
          <p className='px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground'>
            {intl.formatMessage({
              id: 'editor.taskView.groupByLabel',
              defaultMessage: 'Group by',
            })}
          </p>
          <div className='flex flex-wrap gap-1'>
            {GROUP_BY_ORDER.map(g => (
              <Button
                key={g}
                type='button'
                size='sm'
                variant={config.groupBy === g ? 'default' : 'outline'}
                className='h-6 px-2 text-xs'
                onClick={() => onChange({ ...config, groupBy: g })}
              >
                {groupByLabel(g)}
              </Button>
            ))}
          </div>
        </div>

        <FilterCheckboxGroup
          title={intl.formatMessage({ id: 'editor.taskView.filter.project', defaultMessage: 'Projects' })}
          options={projectOptions}
          selected={f.projectIds ?? []}
          onChange={n => setFilter('projectIds', n)}
        />
        <FilterCheckboxGroup
          title={intl.formatMessage({ id: 'editor.taskView.filter.milestone', defaultMessage: 'Milestones' })}
          options={milestoneOptions}
          selected={f.milestoneIds ?? []}
          onChange={n => setFilter('milestoneIds', n)}
        />
        <FilterCheckboxGroup
          title={intl.formatMessage({ id: 'editor.taskView.filter.status', defaultMessage: 'Status' })}
          options={statusOptions}
          selected={f.statuses ?? []}
          onChange={n => setFilter('statuses', n)}
        />
        <FilterCheckboxGroup
          title={intl.formatMessage({ id: 'editor.taskView.filter.priority', defaultMessage: 'Priority' })}
          options={priorityOptions}
          selected={f.priorities ?? []}
          onChange={n => setFilter('priorities', n)}
        />
        <FilterCheckboxGroup
          title={intl.formatMessage({ id: 'editor.taskView.filter.tag', defaultMessage: 'Tags' })}
          options={tagOptions}
          selected={f.tagIds ?? []}
          onChange={n => setFilter('tagIds', n)}
        />
        <FilterCheckboxGroup
          title={intl.formatMessage({ id: 'editor.taskView.filter.assignee', defaultMessage: 'Assignee' })}
          options={memberOptions}
          selected={f.assigneeActorIds ?? []}
          onChange={n => setFilter('assigneeActorIds', n)}
        />
      </PopoverContent>
    </Popover>
  )
}
```
NOTES: `useProjects` must be imported from wherever the re-export lives (`hooks/useProjects` per exploration); if it requires a `ProjectsProvider` ancestor and throws otherwise, the test mocks it (above) and at runtime the editor lives inside the workspace tree where the provider exists. `setFilter` writes `undefined` for empty arrays (keeps the stored config minimal and the query key stable). Reuse `STATUS_ORDER`/`PRIORITY_ORDER` constants here; a later task imports `STATUS_ORDER` for grouping — export it if shared, or redeclare in the group helper (the group helper task re-declares its own to stay self-contained).
- [ ] **Step 2 — run, expect pass**; `npx tsc --noEmit`; `npx eslint` on the file; `npm run lint:tokens` (must be green — semantic tokens only).
- [ ] **Step 3 — commit**
```bash
git add lib/editor/nodes/task-view-config-panel.tsx __tests__/editor/task-view-config-panel.test.tsx
git commit -m "feat: TaskViewConfigPanel (filters + groupBy popover) [LUM-224]"
```

### Task 8: `groupTasks` helper

**Files:** Create `lib/editor/nodes/task-view-group.ts`; Test `__tests__/editor/task-view-group.test.ts`.

Pure function: bucket tasks by `groupBy` with stable ordering + a label per group. Status order fixed; project/milestone resolved via name maps; `none` → single group; tasks with no value → a trailing "Ungrouped" bucket.

- [ ] **Step 1 — failing test**:
```typescript
import { groupTasks } from '@/lib/editor/nodes/task-view-group'

const tasks = [
  { id: '1', status: 'DONE', projectId: 'p1', milestoneId: 'm1' },
  { id: '2', status: 'TODO', projectId: 'p2', milestoneId: null },
] as any[]

describe('groupTasks', () => {
  it('none → one group with all tasks', () => {
    const g = groupTasks(tasks, 'none', {}, {}, 'Ungrouped')
    expect(g).toHaveLength(1)
    expect(g[0]!.tasks).toHaveLength(2)
  })
  it('status → fixed order TODO before DONE, only non-empty groups', () => {
    const g = groupTasks(tasks, 'status', {}, {}, 'Ungrouped')
    expect(g.map(x => x.key)).toEqual(['TODO', 'DONE'])
  })
  it('project → uses the name map, label falls back to id', () => {
    const g = groupTasks(tasks, 'project', { p1: 'Alpha' }, {}, 'Ungrouped')
    const labels = g.map(x => x.label).sort()
    expect(labels).toContain('Alpha')
    expect(labels).toContain('p2')
  })
  it('milestone → null milestone lands in the Ungrouped bucket last', () => {
    const g = groupTasks(tasks, 'milestone', {}, { m1: 'V1' }, 'Ungrouped')
    expect(g[g.length - 1]!.label).toBe('Ungrouped')
  })
})
```
- [ ] **Step 2 — run, expect fail**.
- [ ] **Step 3 — implement**:
```typescript
import type { ApiTask } from '@/app/workspace/[workspaceUrl]/types'

export interface TaskGroup {
  key: string
  label: string
  tasks: ApiTask[]
}

const STATUS_ORDER = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const
const STATUS_LABEL: Record<string, string> = {
  TODO: 'Todo',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
}

/**
 * Bucket tasks for the task-view list. Pure + deterministic. `projectNames` /
 * `milestoneNames` map ids → display names (label falls back to the id).
 * `ungroupedLabel` is the (localized) header for tasks missing the group value.
 */
export function groupTasks(
  tasks: ApiTask[],
  groupBy: 'none' | 'status' | 'project' | 'milestone',
  projectNames: Record<string, string>,
  milestoneNames: Record<string, string>,
  ungroupedLabel: string
): TaskGroup[] {
  if (groupBy === 'none') {
    return [{ key: 'all', label: '', tasks }]
  }
  if (groupBy === 'status') {
    return STATUS_ORDER.map(s => ({
      key: s,
      label: STATUS_LABEL[s] ?? s,
      tasks: tasks.filter(t => t.status === s),
    })).filter(g => g.tasks.length > 0)
  }
  const idOf = (t: ApiTask) =>
    groupBy === 'project' ? t.projectId : (t.milestoneId ?? null)
  const nameOf = (id: string) =>
    (groupBy === 'project' ? projectNames[id] : milestoneNames[id]) ?? id

  const buckets = new Map<string, ApiTask[]>()
  const noneBucket: ApiTask[] = []
  for (const t of tasks) {
    const id = idOf(t)
    if (!id) {
      noneBucket.push(t)
      continue
    }
    const arr = buckets.get(id)
    if (arr) arr.push(t)
    else buckets.set(id, [t])
  }
  const groups: TaskGroup[] = [...buckets.entries()]
    .map(([id, ts]) => ({ key: id, label: nameOf(id), tasks: ts }))
    .sort((a, b) => a.label.localeCompare(b.label))
  if (noneBucket.length) {
    groups.push({ key: '__none__', label: ungroupedLabel, tasks: noneBucket })
  }
  return groups
}
```
- [ ] **Step 4 — run, expect pass** (4); `npx tsc --noEmit`.
- [ ] **Step 5 — commit**
```bash
git add lib/editor/nodes/task-view-group.ts __tests__/editor/task-view-group.test.ts
git commit -m "feat: groupTasks helper for task view list [LUM-224]"
```

### Task 9: Wire panel + grouped render into `TaskViewBlock`

**Files:** Modify `lib/editor/nodes/task-view-block.tsx`; Modify `__tests__/components/TaskViewBlockViewer.test.tsx`.

Destructure `editor` + `updateAttributes`; render `<TaskViewConfigPanel>` in the header ONLY when `editor.isEditable`; replace the flat `<ul>` with grouped sections via `groupTasks`, resolving name maps from `useProjects()` + `useWorkspaceMilestones()`.

FIRST read the current `lib/editor/nodes/task-view-block.tsx` (Phase 2). Keep loading/error/empty states unchanged.

- [ ] **Step 1 — update the component.** Replace the body so it:
  - destructures `{ node, editor, updateAttributes }: NodeViewProps`,
  - builds `projectNames`/`milestoneNames` maps from `useProjects()` + `useWorkspaceMilestones()`,
  - in the header, renders the title and — when `editor.isEditable` — `<TaskViewConfigPanel config={config} onChange={c => updateAttributes({ config: c })} />`,
  - replaces the list branch with: `groupTasks(tasks, config.groupBy, projectNames, milestoneNames, intl.formatMessage({ id:'editor.taskView.ungrouped', defaultMessage:'No group' }))`, mapping each group to a section with a header (`group.label` — omit header when `group.label === ''`) and the existing row `<Link>`s.

Full new file:
```tsx
import { useIntl } from 'react-intl'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useWorkspaceTasks } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks'
import { useProjects } from '@/app/workspace/[workspaceUrl]/hooks/useProjects'
import { useWorkspaceMilestones } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceMilestones'
import { parseTaskViewConfig, type TaskViewConfig } from './task-view-config'
import { TaskViewConfigPanel } from './task-view-config-panel'
import { groupTasks } from './task-view-group'

export function TaskViewBlock({ node, editor, updateAttributes }: NodeViewProps) {
  const intl = useIntl()
  const params = useParams<{ workspaceUrl: string }>()
  const workspaceUrl = params?.workspaceUrl ?? ''
  const config = (node.attrs.config ?? parseTaskViewConfig(null)) as TaskViewConfig
  const { tasks, loading, error } = useWorkspaceTasks(config.filters)
  const { projects } = useProjects()
  const { milestones } = useWorkspaceMilestones()

  const projectNames: Record<string, string> = {}
  for (const p of projects) projectNames[p.id] = p.name
  const milestoneNames: Record<string, string> = {}
  for (const m of milestones) milestoneNames[m.id] = m.name

  const groups = groupTasks(
    tasks,
    config.groupBy,
    projectNames,
    milestoneNames,
    intl.formatMessage({ id: 'editor.taskView.ungrouped', defaultMessage: 'No group' })
  )

  return (
    <NodeViewWrapper className='task-view-block' data-task-view='' contentEditable={false}>
      <div className='task-view-block-header flex items-center justify-between text-muted-foreground'>
        <span>
          {intl.formatMessage({ id: 'editor.taskView.heading', defaultMessage: 'Task View' })}
        </span>
        {editor.isEditable ? (
          <TaskViewConfigPanel
            config={config}
            onChange={c => updateAttributes({ config: c })}
          />
        ) : null}
      </div>
      {loading ? (
        <p className='text-muted-foreground'>
          {intl.formatMessage({ id: 'editor.taskView.loading', defaultMessage: 'Loading tasks…' })}
        </p>
      ) : error ? (
        <p className='text-destructive'>
          {intl.formatMessage({ id: 'editor.taskView.error', defaultMessage: 'Could not load tasks.' })}
        </p>
      ) : tasks.length === 0 ? (
        <p className='text-muted-foreground'>
          {intl.formatMessage({ id: 'editor.taskView.empty', defaultMessage: 'No tasks match these filters.' })}
        </p>
      ) : (
        <div className='task-view-block-groups space-y-3'>
          {groups.map(group => (
            <div key={group.key} className='task-view-group'>
              {group.label ? (
                <p className='task-view-group-header text-xs font-medium text-muted-foreground'>
                  {group.label} · {group.tasks.length}
                </p>
              ) : null}
              <ul className='task-view-block-list'>
                {group.tasks.map(task => (
                  <li key={task.id}>
                    <Link
                      href={`/workspace/${workspaceUrl}/my-tasks/${task.teamIdentifier}-${task.number}`}
                      className='task-view-row'
                    >
                      <span className='task-view-row-id text-muted-foreground'>
                        {task.teamIdentifier}-{task.number}
                      </span>
                      <span className='task-view-row-title text-foreground'>
                        {task.title}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  )
}
```
- [ ] **Step 2 — update the viewer test** `__tests__/components/TaskViewBlockViewer.test.tsx`: the test renders via `RichTextViewer` (editable:false) so the panel is hidden — existing 4 state tests should still pass, BUT the component now calls `useProjects`/`useWorkspaceMilestones`, so add jest.mock stubs for those two hooks returning `{ projects: [] }` / `{ milestones: [] }` (alongside the existing mocks). Add ONE new test: with `groupBy:'status'` config and two tasks of different statuses, assert both status group headers render. Update the STORED config string for that case to `...,"groupBy":"status",...`. Keep the existing loading/empty/error/link tests (they use default `groupBy:'none'` → no headers).
- [ ] **Step 3 — run** `npx jest __tests__/components/TaskViewBlockViewer.test.tsx` → all pass; `npx tsc --noEmit`; `npx eslint lib/editor/nodes/task-view-block.tsx`.
- [ ] **Step 4 — commit**
```bash
git add lib/editor/nodes/task-view-block.tsx __tests__/components/TaskViewBlockViewer.test.tsx
git commit -m "feat: wire config panel + grouped render into task view block [LUM-224]"
```

### Task 10: i18n — panel chrome keys (all locales)

**Files:** Modify every `lib/i18n/*.json`.

Keys (English source):

| Key | English |
| --- | --- |
| `editor.taskView.configure` | `Configure task view` |
| `editor.taskView.groupByLabel` | `Group by` |
| `editor.taskView.groupBy.none` | `None` |
| `editor.taskView.groupBy.status` | `Status` |
| `editor.taskView.groupBy.project` | `Project` |
| `editor.taskView.groupBy.milestone` | `Milestone` |
| `editor.taskView.filter.project` | `Projects` |
| `editor.taskView.filter.milestone` | `Milestones` |
| `editor.taskView.filter.status` | `Status` |
| `editor.taskView.filter.priority` | `Priority` |
| `editor.taskView.filter.tag` | `Tags` |
| `editor.taskView.filter.assignee` | `Assignee` |
| `editor.taskView.ungrouped` | `No group` |

- [ ] **Step 1** — for each `lib/i18n/*.json`, add all 13 keys beside the existing `editor.taskView.*` keys, **translated per locale** (reuse each locale's existing `editor.taskView.heading` style; mirror sibling terminology; en/en-AU/en-GB keep English). NEVER leave English in a non-English file.
- [ ] **Step 2 — parity check**:
```bash
for f in lib/i18n/*.json; do node -e "const j=require('./$f'); ['editor.taskView.configure','editor.taskView.groupByLabel','editor.taskView.groupBy.none','editor.taskView.groupBy.status','editor.taskView.groupBy.project','editor.taskView.groupBy.milestone','editor.taskView.filter.project','editor.taskView.filter.milestone','editor.taskView.filter.status','editor.taskView.filter.priority','editor.taskView.filter.tag','editor.taskView.filter.assignee','editor.taskView.ungrouped'].forEach(k=>{if(!(k in j)){console.error('MISSING',k,'in','$f');process.exit(1)}})" || exit 1; done; echo "all locales OK"
```
- [ ] **Step 3 — commit**
```bash
git add lib/i18n/*.json
git commit -m "i18n: task view config panel strings across all locales [LUM-224]"
```

### Task 11: Full verification gate

- [ ] **Step 1 — typecheck** `npx tsc --noEmit 2>&1 | grep -vE "document-template.repository|prisma/seed"` → empty (the only allowed pre-existing errors are those two files; confirm none of YOUR files appear).
- [ ] **Step 2 — tests**
```bash
npx jest milestone.repository.workspace milestone.service.workspace api.milestones.workspace api-client.milestones.workspace useWorkspaceMilestones task-view-filter-group task-view-config-panel task-view-group TaskViewBlockViewer __tests__/editor
```
all pass.
- [ ] **Step 3 — lint + tokens**
```bash
npx eslint lib/repositories/milestone.repository.ts lib/services/milestone.service.ts app/api/milestones/workspace/route.ts lib/api-client/milestones.ts lib/query/keys.ts app/workspace/[workspaceUrl]/hooks/useWorkspaceMilestones.ts lib/editor/nodes/task-view-filter-group.tsx lib/editor/nodes/task-view-config-panel.tsx lib/editor/nodes/task-view-group.ts lib/editor/nodes/task-view-block.tsx
npm run lint:tokens
```
eslint clean (module-augmentation-style warnings excepted), lint:tokens green.
- [ ] **Step 4 — commit any incidental fixes**
```bash
git add -A && git commit -m "chore: typecheck/lint fixes for task view config panel [LUM-224]" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage (P3):** config popover with all six filters (project/milestone/status/priority/tag/assignee) → Tasks 6,7; groupBy (none/status/project/milestone) + grouped render → Tasks 7,8,9; `updateAttributes` persistence + live re-query → Task 9 (hook already keys on filters); the missing milestone data source → Tasks 1–5. i18n → Task 10.

**Deliberate scope:** no list/kanban **view** toggle in the panel (kanban render is P4); no polling/optimistic (P4); no `truncated` banner (P4 follow-up). Status/priority labels reuse existing English constants (app-wide convention, not i18n'd); only panel chrome is i18n'd.

**Type consistency:** `TaskViewConfig`/`TaskViewGroupBy`/`WorkspaceTaskFilterArgs` reused throughout; `setFilter` writes `undefined` for empty arrays (keeps stored config + query key minimal); `groupTasks` is pure and the only grouping path; milestone slice mirrors the Phase-1 task slice exactly (repository where → service passthrough → thin route → client → key → hook).

**Constraints honored:** new UI files use semantic tokens only (lint:tokens); inline Checkbox lists (no Radix Select → jsdom-safe); milestone scoping via `project.workspaceId`; no schema change.
