# Task View Block (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the LUM-224 Phase 2 vertical slice — a custom Tiptap `taskView` atom block that persists a JSON query-config and renders a **live (React Query) read-only task list** in both the editor and the read-only viewer, inserted via the slash menu.

**Architecture:** A custom Tiptap atom `Node` stores `config` (a `TaskViewConfig`) serialized to a single `data-task-view-config` attribute (round-trips via `parseHTML`/`renderHTML`, defensive parse). Its `ReactNodeViewRenderer` component `TaskViewBlock` reads the config, calls a new `useWorkspaceTasks` hook (React Query → Phase-1 `tasksClient.listWorkspace` → `GET /api/tasks/workspace`), and renders loading / error / empty / list states; each row links to `/workspace/{slug}/my-tasks/{TEAM-NUMBER}`. Registered in `getBaseExtensions()` (so it renders in editor + `RichTextViewer`) and exposed via a `/task view` slash command.

**Tech Stack:** Next.js 14 App Router, TypeScript strict (exactOptionalPropertyTypes + noUncheckedIndexedAccess), Tiptap (`@tiptap/core`, `@tiptap/react`), React Query, react-intl, Jest + @testing-library/react (jsdom).

**Scope note (deviation from spec §5 P2):** Phase 2 renders a **flat** list with the **default config** (no filters, `groupBy: 'none'`). Grouping + the filter config panel move to **Phase 3** (where `groupBy`/filters become user-editable). The kanban + polling + optimistic drag stay in **Phase 4**. The `TaskViewConfig` shape already includes `view`/`groupBy`/all six filters so P3/P4 only add UI, not schema.

**No backend change / no migration:** consumes the Phase-1 backend as-is. Do not touch `prisma/`, the repository, the service, or the route.

**Reference:** spec `docs/superpowers/specs/2026-06-04-embedded-live-task-view-design.md`; freshest patterns to mirror — `lib/editor/nodes/callout.ts` + `callout-node-view.tsx` (custom node + NodeView), `app/workspace/[workspaceUrl]/hooks/useProjectTasks.ts` (RQ hook), `lib/editor/slash-command.tsx` (slash entry + `FALLBACK_LABELS`), `app/workspace/[workspaceUrl]/components/RichTextViewer.tsx` + `__tests__/components/CalloutToggleViewer.test.tsx` (read-only render test).

**Branch:** `lumo/LUM-224-task-view-block` (worktree `/Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-224-p2`, off `origin/main` @ 55847706).

---

## File Structure

| File | Responsibility | Create/Modify |
| --- | --- | --- |
| `lib/editor/nodes/task-view-config.ts` | `TaskViewConfig` type, `DEFAULT_TASK_VIEW_CONFIG`, `parseTaskViewConfig` (defensive) | Create |
| `__tests__/editor/task-view-config.test.ts` | config parse / default / round-trip coverage | Create |
| `app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks.ts` | RQ hook → `tasksClient.listWorkspace` | Create |
| `__tests__/hooks/useWorkspaceTasks.test.tsx` | hook calls client + returns tasks | Create |
| `lib/editor/nodes/task-view-block.tsx` | `TaskViewBlock` NodeView (states + row links) | Create |
| `lib/editor/nodes/task-view.ts` | `TaskView` atom node + `setTaskView` command | Create |
| `lib/editor/extensions.ts` | register `TaskView` in `getBaseExtensions()` | Modify |
| `lib/editor/slash-command.tsx` | `/task view` item + `FALLBACK_LABELS` entries + icon import | Modify |
| `lib/i18n/*.json` (all 18 locales) | 6 new `editor.*` keys | Modify |
| `__tests__/components/TaskViewBlockViewer.test.tsx` | read-only render of states + link href | Create |

**Shared identifiers (use these exact names in every task):**
- Config: `TaskViewConfig`, `DEFAULT_TASK_VIEW_CONFIG`, `parseTaskViewConfig(raw)` — in `lib/editor/nodes/task-view-config.ts`
- Hook: `useWorkspaceTasks(filters)` returning `{ tasks, truncated, loading, error }`
- NodeView component: `TaskViewBlock`
- Node + command: `TaskView`, `setTaskView`
- DOM marker: `div[data-task-view]`, config attr `data-task-view-config`
- i18n keys: `editor.slash.taskView.title`, `editor.slash.taskView.description`, `editor.taskView.heading`, `editor.taskView.loading`, `editor.taskView.empty`, `editor.taskView.error`

All commands assume: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-224-p2` first (jest MUST run with cwd inside the worktree).

---

### Task 1: Config module + parser

**Files:**
- Create: `lib/editor/nodes/task-view-config.ts`
- Test: `__tests__/editor/task-view-config.test.ts`

- [ ] **Step 1: Write the failing test** — Create `__tests__/editor/task-view-config.test.ts`:

```typescript
import {
  DEFAULT_TASK_VIEW_CONFIG,
  parseTaskViewConfig,
} from '@/lib/editor/nodes/task-view-config'

describe('parseTaskViewConfig', () => {
  it('returns the default for null / empty / malformed input', () => {
    expect(parseTaskViewConfig(null)).toEqual(DEFAULT_TASK_VIEW_CONFIG)
    expect(parseTaskViewConfig('')).toEqual(DEFAULT_TASK_VIEW_CONFIG)
    expect(parseTaskViewConfig('{not json')).toEqual(DEFAULT_TASK_VIEW_CONFIG)
    expect(parseTaskViewConfig('42')).toEqual(DEFAULT_TASK_VIEW_CONFIG)
  })

  it('round-trips a fully-populated config', () => {
    const config = {
      version: 1 as const,
      view: 'kanban' as const,
      groupBy: 'status' as const,
      filters: { projectIds: ['p1'], statuses: ['TODO'] },
    }
    expect(parseTaskViewConfig(JSON.stringify(config))).toEqual(config)
  })

  it('coerces unknown view/groupBy back to defaults and keeps filters', () => {
    const parsed = parseTaskViewConfig(
      JSON.stringify({ view: 'x', groupBy: 'y', filters: { tagIds: ['t1'] } })
    )
    expect(parsed.view).toBe('list')
    expect(parsed.groupBy).toBe('none')
    expect(parsed.filters).toEqual({ tagIds: ['t1'] })
    expect(parsed.version).toBe(1)
  })

  it('defaults filters to {} when missing or non-object', () => {
    expect(parseTaskViewConfig(JSON.stringify({ filters: 5 })).filters).toEqual({})
    expect(parseTaskViewConfig(JSON.stringify({})).filters).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `npx jest __tests__/editor/task-view-config.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — Create `lib/editor/nodes/task-view-config.ts`:

```typescript
import type { WorkspaceTaskFilterArgs } from '@/lib/api-client/tasks'

export type TaskViewMode = 'list' | 'kanban'
export type TaskViewGroupBy = 'none' | 'status' | 'project' | 'milestone'

export interface TaskViewConfig {
  version: 1
  view: TaskViewMode
  groupBy: TaskViewGroupBy
  filters: WorkspaceTaskFilterArgs
}

export const DEFAULT_TASK_VIEW_CONFIG: TaskViewConfig = {
  version: 1,
  view: 'list',
  groupBy: 'none',
  filters: {},
}

const GROUP_BY_VALUES: readonly TaskViewGroupBy[] = [
  'none',
  'status',
  'project',
  'milestone',
]

function isGroupBy(value: unknown): value is TaskViewGroupBy {
  return (
    typeof value === 'string' &&
    (GROUP_BY_VALUES as readonly string[]).includes(value)
  )
}

/**
 * Defensive: a malformed / version-mismatched `data-task-view-config` must
 * never throw during document render — it degrades to the default config.
 * Unknown enum values fall back to defaults; filters are passed through only
 * when they are a plain object.
 */
export function parseTaskViewConfig(
  raw: string | null | undefined
): TaskViewConfig {
  if (!raw) return DEFAULT_TASK_VIEW_CONFIG
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return DEFAULT_TASK_VIEW_CONFIG
    const obj = parsed as Record<string, unknown>
    const filters =
      obj.filters && typeof obj.filters === 'object'
        ? (obj.filters as WorkspaceTaskFilterArgs)
        : {}
    return {
      version: 1,
      view: obj.view === 'kanban' ? 'kanban' : 'list',
      groupBy: isGroupBy(obj.groupBy) ? obj.groupBy : 'none',
      filters,
    }
  } catch {
    return DEFAULT_TASK_VIEW_CONFIG
  }
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx jest __tests__/editor/task-view-config.test.ts` → PASS (4 tests).

- [ ] **Step 5: tsc + commit**
```bash
npx tsc --noEmit   # confirm no new errors in the file you touched
git add lib/editor/nodes/task-view-config.ts __tests__/editor/task-view-config.test.ts
git commit -m "feat: task view block config type + defensive parser [LUM-224]"
```

---

### Task 2: `useWorkspaceTasks` hook

**Files:**
- Create: `app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks.ts`
- Test: `__tests__/hooks/useWorkspaceTasks.test.tsx`

First READ `app/workspace/[workspaceUrl]/hooks/useProjectTasks.ts` (the model) and confirm `tasksClient` is exported from `@/lib/api-client` (it is the barrel that also exports `projectsClient`). Confirm `ApiTask` is exported from `app/workspace/[workspaceUrl]/types.ts`.

- [ ] **Step 1: Write the failing test** — Create `__tests__/hooks/useWorkspaceTasks.test.tsx`:

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'acme' }),
}))

jest.mock('@/lib/api-client', () => ({
  tasksClient: { listWorkspace: jest.fn() },
}))

import { tasksClient } from '@/lib/api-client'
import { useWorkspaceTasks } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks'

const mockList = tasksClient.listWorkspace as jest.Mock

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => jest.clearAllMocks())

describe('useWorkspaceTasks', () => {
  it('fetches via tasksClient.listWorkspace and returns tasks + truncated', async () => {
    mockList.mockResolvedValueOnce({
      tasks: [{ id: 't1', title: 'A', teamIdentifier: 'LUM', number: 1 }],
      truncated: false,
    })

    const { result } = renderHook(
      () => useWorkspaceTasks({ statuses: ['TODO'] }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockList).toHaveBeenCalledWith({ statuses: ['TODO'] })
    expect(result.current.tasks).toHaveLength(1)
    expect(result.current.truncated).toBe(false)
    expect(result.current.error).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `npx jest __tests__/hooks/useWorkspaceTasks.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement** — Create `app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks.ts`:

```typescript
'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { tasksClient } from '@/lib/api-client'
import type { WorkspaceTaskFilterArgs } from '@/lib/api-client/tasks'
import { queryKeys } from '@/lib/query/keys'
import type { ApiTask } from '../types'

interface WorkspaceTasksResponse {
  tasks: ApiTask[]
  truncated: boolean
}

/**
 * Live workspace-wide task list for the embedded task-view block. Scope is
 * enforced server-side by the viewer's identity; `filters` only narrows it.
 * The workspace slug (from the route) namespaces the cache.
 */
export function useWorkspaceTasks(filters: WorkspaceTaskFilterArgs) {
  const params = useParams<{ workspaceUrl: string }>()
  const workspaceUrl = params?.workspaceUrl ?? ''
  const query = useQuery<WorkspaceTasksResponse>({
    queryKey: queryKeys.tasks.byWorkspace(workspaceUrl, JSON.stringify(filters)),
    queryFn: () =>
      tasksClient.listWorkspace<WorkspaceTasksResponse>(filters),
  })
  return {
    tasks: query.data?.tasks ?? [],
    truncated: query.data?.truncated ?? false,
    loading: query.isLoading,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load tasks.')
      : null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx jest __tests__/hooks/useWorkspaceTasks.test.tsx` → PASS.

- [ ] **Step 5: tsc + commit**
```bash
npx tsc --noEmit
git add app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks.ts __tests__/hooks/useWorkspaceTasks.test.tsx
git commit -m "feat: useWorkspaceTasks live query hook [LUM-224]"
```

---

### Task 3: `TaskViewBlock` NodeView component

**Files:**
- Create: `lib/editor/nodes/task-view-block.tsx`

No standalone test here — the component is exercised end-to-end through the read-only viewer test in Task 7 (mirrors how callout/toggle NodeViews are tested via `RichTextViewer`). Build it, then verify with tsc.

- [ ] **Step 1: Implement** — Create `lib/editor/nodes/task-view-block.tsx`:

```tsx
import { useIntl } from 'react-intl'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useWorkspaceTasks } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks'
import { parseTaskViewConfig, type TaskViewConfig } from './task-view-config'

/**
 * Read-only render of the embedded task-view block. Reads the stored config,
 * fetches the live workspace task list, and renders loading / error / empty /
 * list states. Same component runs in the editor and the read-only viewer; it
 * is non-interactive in Phase 2 (config UI + grouping land in Phase 3).
 */
export function TaskViewBlock({ node }: NodeViewProps) {
  const intl = useIntl()
  const params = useParams<{ workspaceUrl: string }>()
  const workspaceUrl = params?.workspaceUrl ?? ''
  const config = (node.attrs.config ?? parseTaskViewConfig(null)) as TaskViewConfig
  const { tasks, loading, error } = useWorkspaceTasks(config.filters)

  return (
    <NodeViewWrapper
      className='task-view-block'
      data-task-view=''
      contentEditable={false}
    >
      <div className='task-view-block-header text-muted-foreground'>
        {intl.formatMessage({
          id: 'editor.taskView.heading',
          defaultMessage: 'Task View',
        })}
      </div>
      {loading ? (
        <p className='text-muted-foreground'>
          {intl.formatMessage({
            id: 'editor.taskView.loading',
            defaultMessage: 'Loading tasks…',
          })}
        </p>
      ) : error ? (
        <p className='text-destructive'>
          {intl.formatMessage({
            id: 'editor.taskView.error',
            defaultMessage: 'Could not load tasks.',
          })}
        </p>
      ) : tasks.length === 0 ? (
        <p className='text-muted-foreground'>
          {intl.formatMessage({
            id: 'editor.taskView.empty',
            defaultMessage: 'No tasks match these filters.',
          })}
        </p>
      ) : (
        <ul className='task-view-block-list'>
          {tasks.map(task => (
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
      )}
    </NodeViewWrapper>
  )
}
```

Note tokens: only semantic Tailwind tokens (`text-muted-foreground`, `text-foreground`, `text-destructive`) — no raw zinc/gray — so `lint:tokens` stays green.

- [ ] **Step 2: Verify it compiles** — `npx tsc --noEmit` → no new errors in the file. (It is not yet imported anywhere, so this only typechecks; it gets wired in Task 4.)

- [ ] **Step 3: Commit**
```bash
git add lib/editor/nodes/task-view-block.tsx
git commit -m "feat: TaskViewBlock node view (read-only live list) [LUM-224]"
```

---

### Task 4: `TaskView` atom node + command

**Files:**
- Create: `lib/editor/nodes/task-view.ts`
- Test: `__tests__/editor/task-view.test.ts`

- [ ] **Step 1: Write the failing test** — Create `__tests__/editor/task-view.test.ts`:

```typescript
import { TaskView } from '@/lib/editor/nodes/task-view'
import {
  DEFAULT_TASK_VIEW_CONFIG,
  parseTaskViewConfig,
} from '@/lib/editor/nodes/task-view-config'

describe('TaskView node', () => {
  it('is a leaf atom block named taskView', () => {
    expect(TaskView.name).toBe('taskView')
    expect(TaskView.config.atom).toBe(true)
    expect(TaskView.config.group).toBe('block')
  })

  it('serializes config to data-task-view-config and parses it back', () => {
    const attrs = TaskView.options as unknown
    // Round-trip the config through the same JSON contract the node uses:
    const config = {
      version: 1 as const,
      view: 'list' as const,
      groupBy: 'none' as const,
      filters: { statuses: ['IN_PROGRESS'] },
    }
    const serialized = JSON.stringify(config)
    expect(parseTaskViewConfig(serialized)).toEqual(config)
    expect(parseTaskViewConfig(null)).toEqual(DEFAULT_TASK_VIEW_CONFIG)
    void attrs
  })
})
```

(The node's `renderHTML` writes `data-task-view-config = JSON.stringify(config)` and `parseHTML` reads it through `parseTaskViewConfig` — the round-trip is the JSON contract asserted above; this avoids standing up a full headless Editor while still pinning the serialization symmetry.)

- [ ] **Step 2: Run test to verify it fails** — `npx jest __tests__/editor/task-view.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — Create `lib/editor/nodes/task-view.ts`:

```typescript
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { TaskViewBlock } from './task-view-block'
import {
  DEFAULT_TASK_VIEW_CONFIG,
  parseTaskViewConfig,
  type TaskViewConfig,
} from './task-view-config'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    taskView: {
      /** Insert a task-view block with the given config (default: all tasks). */
      setTaskView: (attrs?: { config?: TaskViewConfig }) => ReturnType
    }
  }
}

/**
 * Embedded task-view block: a leaf atom that stores only a query config (as a
 * JSON data attribute) and renders a live task list at runtime via
 * {@link TaskViewBlock}. The dynamic task data is never serialized into the
 * document — only the holder div + config round-trip. Same NodeView runs in
 * the editor and the read-only viewer (registered via getBaseExtensions).
 */
export const TaskView = Node.create({
  name: 'taskView',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      config: {
        default: DEFAULT_TASK_VIEW_CONFIG,
        parseHTML: el =>
          parseTaskViewConfig(el.getAttribute('data-task-view-config')),
        renderHTML: attrs => ({
          'data-task-view-config': JSON.stringify(attrs.config),
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-task-view]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-task-view': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TaskViewBlock)
  },

  addCommands() {
    return {
      setTaskView:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { config: attrs.config ?? DEFAULT_TASK_VIEW_CONFIG },
          }),
    }
  },
})
```

- [ ] **Step 4: Run test to verify it passes** — `npx jest __tests__/editor/task-view.test.ts` → PASS. (If `TaskView.config.atom`/`.group` access shape differs in this Tiptap version, adjust the assertions to read the same properties the callout test reads — open `__tests__/editor/callout.test.ts` for the exact access pattern; do not change the node, change the test to match the real API.)

- [ ] **Step 5: tsc + commit**
```bash
npx tsc --noEmit
git add lib/editor/nodes/task-view.ts __tests__/editor/task-view.test.ts
git commit -m "feat: taskView atom node + setTaskView command [LUM-224]"
```

---

### Task 5: Register extension + slash command

**Files:**
- Modify: `lib/editor/extensions.ts`
- Modify: `lib/editor/slash-command.tsx`

- [ ] **Step 1: Register in `getBaseExtensions()`** — In `lib/editor/extensions.ts`: add the import near the other node imports:

```typescript
import { TaskView } from './nodes/task-view'
```

and add `TaskView,` to the returned array, right after `...ToggleExtensions,`:

```typescript
    Callout,
    ...ToggleExtensions,
    TaskView,
    TaskLink,
```

- [ ] **Step 2: Add slash `FALLBACK_LABELS`** — In `lib/editor/slash-command.tsx`, add to the `FALLBACK_LABELS` map (next to the callout/toggle entries):

```typescript
  'editor.slash.taskView.title': 'Task View',
  'editor.slash.taskView.description': 'Live filtered task list',
```

- [ ] **Step 3: Add the icon import** — add `LayoutList` to the existing `lucide-react` import block:

```typescript
  Lightbulb,
  ChevronRight,
  LayoutList,
```

- [ ] **Step 4: Add the slash item** — In the array returned by `getSlashCommandItems`, after the toggle entry, add:

```typescript
    {
      title: t('editor.slash.taskView.title'),
      description: t('editor.slash.taskView.description'),
      icon: <LayoutList size={ICON_SIZE} />,
      categoryKey: 'advanced',
      category: t('editor.slash.category.advanced'),
      command: editor => editor.chain().focus().setTaskView().run(),
    },
```

- [ ] **Step 5: Verify** — `npx tsc --noEmit` (no new errors), then run the editor test suites to confirm nothing regressed:
```bash
npx jest __tests__/editor __tests__/components/CalloutToggleViewer.test.tsx
```
Expected: all pass (including the existing callout/toggle suites).

- [ ] **Step 6: Commit**
```bash
git add lib/editor/extensions.ts lib/editor/slash-command.tsx
git commit -m "feat: register taskView extension + /task view slash command [LUM-224]"
```

---

### Task 6: i18n keys across all locales

**Files:**
- Modify: every file in `lib/i18n/*.json`

The six new keys (English source values):

| Key | English |
| --- | --- |
| `editor.slash.taskView.title` | `Task View` |
| `editor.slash.taskView.description` | `Live filtered task list` |
| `editor.taskView.heading` | `Task View` |
| `editor.taskView.loading` | `Loading tasks…` |
| `editor.taskView.empty` | `No tasks match these filters.` |
| `editor.taskView.error` | `Could not load tasks.` |

- [ ] **Step 1: List the locale files** — `ls lib/i18n/*.json` (expect ~18: en, en-AU, en-GB, de, es, es-419, fr, hi, id, ja, ko, ms, ru, vi, zh-CN, zh-TW, …). For EACH file, find where the existing `editor.slash.callout.*` and `editor.slash.toggle.*` keys live and add the two `editor.slash.taskView.*` keys beside them, and add the four `editor.taskView.*` keys beside any existing `editor.callout.*` / `editor.toggle.*` UI keys (keep the file's existing key ordering/structure — these JSON files are flat key maps; match the sibling style).

- [ ] **Step 2: Translate per locale** — Provide a PROPER translation for each non-English locale (never leave English in a non-English file — project rule). Use the already-translated `editor.slash.callout.*` / `editor.slash.toggle.*` values in that SAME file as the tone/terminology reference (e.g. mirror how "block"/"list"/"Loading…" are rendered there). For the en-variants (en-AU, en-GB) the English source values are fine as-is.

- [ ] **Step 3: Verify JSON validity + key parity** — confirm every locale parses and has all six keys:
```bash
for f in lib/i18n/*.json; do node -e "const j=require('./$f'); ['editor.slash.taskView.title','editor.slash.taskView.description','editor.taskView.heading','editor.taskView.loading','editor.taskView.empty','editor.taskView.error'].forEach(k=>{if(!(k in j)){console.error('MISSING',k,'in','$f');process.exit(1)}})" || exit 1; done; echo "all locales have all 6 keys"
```
Expected: `all locales have all 6 keys`.

- [ ] **Step 4: Commit**
```bash
git add lib/i18n/*.json
git commit -m "i18n: task view block strings across all locales [LUM-224]"
```

---

### Task 7: Read-only render test + full verification

**Files:**
- Create: `__tests__/components/TaskViewBlockViewer.test.tsx`

- [ ] **Step 1: Write the render test** — First READ `__tests__/components/CalloutToggleViewer.test.tsx` to mirror its harness (mocks, `waitFor` for portal). Create `__tests__/components/TaskViewBlockViewer.test.tsx`:

```tsx
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({
      defaultMessage,
      id,
    }: {
      id: string
      defaultMessage?: string
    }) => defaultMessage ?? id,
  }),
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'acme' }),
}))

const mockUseWorkspaceTasks = jest.fn()
jest.mock(
  '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks',
  () => ({ useWorkspaceTasks: (...a: unknown[]) => mockUseWorkspaceTasks(...a) })
)

import { render, screen, waitFor } from '@testing-library/react'
import { RichTextViewer } from '@/app/workspace/[workspaceUrl]/components/RichTextViewer'

const STORED =
  '<div data-task-view data-task-view-config=\'{"version":1,"view":"list","groupBy":"none","filters":{}}\'></div>'

beforeEach(() => jest.clearAllMocks())

describe('RichTextViewer — task view block', () => {
  it('renders the loading state', async () => {
    mockUseWorkspaceTasks.mockReturnValue({
      tasks: [],
      truncated: false,
      loading: true,
      error: null,
    })
    render(<RichTextViewer value={STORED} />)
    await waitFor(() =>
      expect(screen.getByText('Loading tasks…')).toBeInTheDocument()
    )
  })

  it('renders the empty state', async () => {
    mockUseWorkspaceTasks.mockReturnValue({
      tasks: [],
      truncated: false,
      loading: false,
      error: null,
    })
    render(<RichTextViewer value={STORED} />)
    await waitFor(() =>
      expect(
        screen.getByText('No tasks match these filters.')
      ).toBeInTheDocument()
    )
  })

  it('renders rows that link to the task detail', async () => {
    mockUseWorkspaceTasks.mockReturnValue({
      tasks: [
        { id: 't1', title: 'Fix login', teamIdentifier: 'LUM', number: 42 },
      ],
      truncated: false,
      loading: false,
      error: null,
    })
    render(<RichTextViewer value={STORED} />)
    const link = await waitFor(() => screen.getByRole('link', { name: /Fix login/ }))
    expect(link).toHaveAttribute(
      'href',
      '/workspace/acme/my-tasks/LUM-42'
    )
  })

  it('renders the error state', async () => {
    mockUseWorkspaceTasks.mockReturnValue({
      tasks: [],
      truncated: false,
      loading: false,
      error: 'boom',
    })
    render(<RichTextViewer value={STORED} />)
    await waitFor(() =>
      expect(screen.getByText('Could not load tasks.')).toBeInTheDocument()
    )
  })
})
```

(If `RichTextViewer` renders NodeViews lazily and a bare `render` needs a QueryClient even though the hook is mocked, wrap in a `QueryClientProvider` like the `useWorkspaceTasks` test — but since `useWorkspaceTasks` is fully mocked here, no real query runs. Mirror exactly what `CalloutToggleViewer.test.tsx` does.)

- [ ] **Step 2: Run the render test** — `npx jest __tests__/components/TaskViewBlockViewer.test.tsx` → PASS (4 tests).

- [ ] **Step 3: Commit**
```bash
git add __tests__/components/TaskViewBlockViewer.test.tsx
git commit -m "test: read-only render of task view block states [LUM-224]"
```

- [ ] **Step 4: Full verification gate**
```bash
npx tsc --noEmit                          # exactOptional + noUncheckedIndexedAccess gate
npx jest task-view useWorkspaceTasks TaskViewBlockViewer __tests__/editor __tests__/components/CalloutToggleViewer.test.tsx
npx eslint lib/editor/nodes/task-view.ts lib/editor/nodes/task-view-block.tsx lib/editor/nodes/task-view-config.ts app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks.ts lib/editor/extensions.ts lib/editor/slash-command.tsx
npm run lint:tokens                       # semantic-token check (block uses only semantic tokens)
```
Expected: tsc clean, all suites pass, eslint clean, lint:tokens green.

- [ ] **Step 5: Commit any incidental fixes**
```bash
git add -A && git commit -m "chore: typecheck/lint fixes for task view block phase 2 [LUM-224]" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage (P2 slice):**
- `taskView` atom node + config JSON round-trip + defensive parse → Tasks 1, 4 ✓
- `ReactNodeViewRenderer` → `TaskViewBlock` rendering a live list via `useWorkspaceTasks` → Tasks 2, 3 ✓
- Loading / empty / error / list states; rows link to task detail → Task 3 + Task 7 tests ✓
- `/task view` slash command → Task 5 ✓
- Registered in `getBaseExtensions()` (editor + read-only viewer) → Task 5 + Task 7 (renders in `RichTextViewer`) ✓
- i18n in every locale → Task 6 ✓
- Serialization round-trip + render-state tests → Tasks 1, 4, 7 ✓

**Deliberate scope (vs spec):** flat list + default config in P2; grouping/filter UI → P3; kanban/polling/optimistic → P4. `TaskViewConfig` already carries `view`/`groupBy`/all filters so later phases add only UI.

**Type consistency:** `TaskViewConfig` (config module) is the single config type, consumed by node, component, and command; `filters: WorkspaceTaskFilterArgs` reuses the Phase-1 client type; the hook returns `{ tasks, truncated, loading, error }` consumed by `TaskViewBlock`; `queryKeys.tasks.byWorkspace(workspaceUrl, JSON.stringify(filters))` namespaces the cache. No backend/Prisma changes.

**Context gotchas (confirmed during exploration):** `useIntl()` and `useQuery()` work inside `ReactNodeViewRenderer` components (callout/toggle prove it); NodeViews render asynchronously via portals → tests use `waitFor`.
