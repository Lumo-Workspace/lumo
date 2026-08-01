/** @jest-environment jsdom */

/**
 * LUM-727 — the milestone detail page as ONE page.
 *
 * Pins the three structural criteria of the redesign: no tab navigation with
 * hero → description → metric strip → tasks in that order; the description
 * edited in place (and never written back on an archived milestone); and the
 * tasks region reusing the shared project task list minus the board toggle.
 *
 * react-intl ships ESM jest can't load (repo convention: mock it) — the mock
 * reads the REAL en.json so asserted copy is the shipped translation.
 */

import en from '@/lib/i18n/en.json'

const messages = en as Record<string, string>
/** Shipped copy for an id — the assertions read the real translation. */
const m = (id: string): string => messages[id] ?? id

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      let msg = messages[id] ?? defaultMessage ?? id
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.replace(`{${k}}`, String(v))
      }
      return msg
    },
  }),
}))

// The tiptap stack is lazy-loaded and far too heavy for jsdom. Stub it with a
// button that fires the same onCommit contract the real editor fires on blur,
// so the page's write-back wiring is what gets asserted.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/DescriptionEditorLazy',
  () => ({
    DescriptionEditor: ({
      value,
      onCommit,
    }: {
      value: string | null
      onCommit: (html: string | null) => void
    }) => (
      <div data-testid='description-editor'>
        <span>{value}</span>
        <button type='button' onClick={() => onCommit('<p>edited</p>')}>
          commit
        </button>
      </div>
    ),
  })
)
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMentionSources', () => ({
  useMentionSources: () => ({ members: [], searchEntities: async () => [] }),
}))

// The task table itself has its own suites; here we only assert THAT the
// shared list is what renders, with which columns, and over which rows.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/task-list/TaskListView',
  () => ({
    TaskListView: (p: {
      visibleColumns: string[]
      flow?: boolean
      tasks: { status: string }[]
    }) => (
      <div
        data-testid='task-list'
        data-columns={p.visibleColumns.join(',')}
        data-flow={p.flow ? '1' : '0'}
        data-statuses={p.tasks.map(t => t.status).join(',')}
      />
    ),
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/task-list/BulkActionBar',
  () => ({
    BulkActionBar: () => <div data-testid='bulk-action-bar' />,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/task-list/BulkDeleteConfirm',
  () => ({ BulkDeleteConfirm: () => null })
)
jest.mock('@/app/workspace/[workspaceUrl]/components/AsyncContent', () => ({
  AsyncContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))
jest.mock('@/lib/api-client', () => ({
  tasksClient: { update: jest.fn(), delete: jest.fn() },
}))
// Stable identities matter here: MilestoneTasksWorkspace mirrors `tasks` into
// state through an effect keyed on the array reference, and re-fetches on
// `fetchProjects` — a fresh [] / closure per render loops forever. Each value
// is created once inside the factory closure.
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMilestoneTasks', () => {
  // A DONE task rides along: the milestone list has no completed filter, so
  // every task in the milestone must reach the table.
  const tasks = [
    { id: 't1', status: 'TODO', projectId: 'p1' },
    { id: 't2', status: 'DONE', projectId: 'p1' },
    { id: 't3', status: 'IN_PROGRESS', projectId: 'p1', parentTaskId: 't1' },
  ]
  const refetch = () => {}
  return {
    useMilestoneTasks: () => ({
      tasks,
      isLoading: false,
      error: null,
      refetch,
    }),
  }
})
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMembers', () => {
  const members: never[] = []
  return { useMembers: () => ({ members }) }
})
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useProjects', () => {
  const projects: never[] = []
  const fetchProjects = () => {}
  return { useProjects: () => ({ projects, fetchProjects }) }
})
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskBulkMutations', () => ({
  useTaskBulkMutations: () => ({
    confirmDeleteOpen: false,
    setConfirmDeleteOpen: () => {},
    deleting: false,
    runBulkUpdate: () => {},
    runBulkDelete: () => {},
  }),
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ApiMilestone } from '@/lib/api-client'
import { MilestoneDetailBody } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneDetailBody'

const milestone = {
  id: 'm1',
  projectId: 'p1',
  name: 'Trust and cognitive load',
  slug: 'trust-and-cognitive-load',
  description: '<p>the milestone prose</p>',
  status: 'IN_PROGRESS',
  startDate: null,
  targetDate: null,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  taskCounts: { TODO: 6, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 2 },
  costRollup: {
    tokenCost: 283_500_000,
    activeTimeSec: 10_740,
    measuredTasks: 2,
    totalTasks: 8,
  },
  deliveryStats: {
    pr: {
      mergedPrCount: 5,
      multiPrTaskCount: 1,
      unlinkedTaskCount: 2,
      linkedTaskCount: 2,
    },
    changedFiles: { total: 12, measuredTasks: 2, totalTasks: 8 },
  },
} as unknown as ApiMilestone

const renderBody = (
  override: Partial<ApiMilestone> = {},
  onUpdate = () => {}
) =>
  render(
    <MilestoneDetailBody
      milestone={{ ...milestone, ...override } as ApiMilestone}
      onUpdate={onUpdate}
      members={[]}
      onOpenTask={() => {}}
    />
  )

test('renders hero, description, metric strip and tasks in one page with no tab navigation', () => {
  const { container } = renderBody()

  // No tab bar: the retired Overview / Tasks / Description switcher is gone.
  for (const id of [
    'milestone.tab.overview',
    'milestone.tab.tasks',
    'milestone.tab.description',
  ]) {
    expect(
      screen.queryByRole('button', { name: m(id) })
    ).not.toBeInTheDocument()
  }

  // Every region is mounted at once, in reading order.
  const hero = container.querySelector('h1')
  const description = screen.getByText(m('milestone.section.description'))
  const metrics = screen.getByLabelText(m('milestone.metrics.label'))
  const tasks = screen.getByTestId('task-list')
  expect(hero).toHaveTextContent('Trust and cognitive load')

  const order = [hero, description, metrics, tasks] as HTMLElement[]
  for (let i = 1; i < order.length; i++) {
    // Node.DOCUMENT_POSITION_FOLLOWING === 4
    expect(order[i - 1]!.compareDocumentPosition(order[i]!) & 4).toBeTruthy()
  }
})

test('commits an inline description edit through onUpdate and stays read-only when archived', () => {
  const onUpdate = jest.fn()
  const { unmount } = renderBody({}, onUpdate)

  expect(screen.getByTestId('description-editor')).toHaveTextContent(
    'the milestone prose'
  )
  fireEvent.click(screen.getByRole('button', { name: 'commit' }))
  expect(onUpdate).toHaveBeenCalledWith({ description: '<p>edited</p>' })
  unmount()

  // Archived milestones render the same editor but never write back.
  const archivedUpdate = jest.fn()
  renderBody({ archivedAt: '2026-07-30T00:00:00.000Z' }, archivedUpdate)
  fireEvent.click(screen.getByRole('button', { name: 'commit' }))
  expect(archivedUpdate).not.toHaveBeenCalled()
})

test('renders every milestone task in the shared list with no filter, display or view controls above it', () => {
  renderBody()

  const list = screen.getByTestId('task-list')
  // The shared project column set, including the cross-project PROJECT column
  // and the select column that drives bulk actions.
  expect(list.getAttribute('data-columns')).toBe(
    'select,identifier,title,project,status,priority,dueDate,assignee,updatedAt,actions'
  )
  // Grown into the page's scroll flow — no second scrollbar inside the page.
  expect(list.getAttribute('data-flow')).toBe('1')

  // Every task in the milestone reaches the table — DONE and subtasks
  // included. The milestone IS the filter; nothing is hidden by default.
  expect(list.getAttribute('data-statuses')).toBe('TODO,DONE,IN_PROGRESS')

  // Nothing sits between the section heading and the table: no filter menu,
  // no display (completed / ordering / subtasks) menu, no board toggle.
  for (const id of [
    'filter.menuTrigger',
    'display.menuTrigger',
    'common.viewList',
    'common.viewBoard',
  ]) {
    expect(screen.queryByLabelText(m(id))).not.toBeInTheDocument()
  }
  const tasksHeading = screen.getByText(m('milestone.section.tasks'))
  const between = [
    ...(tasksHeading.parentElement?.querySelectorAll('button') ?? []),
  ]
  expect(between).toHaveLength(0)
})
