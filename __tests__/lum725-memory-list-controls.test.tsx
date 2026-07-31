/** @jest-environment jsdom */
/**
 * LUM-725 — the project memory list's search / sort / category chips, plus the
 * loading and empty states that surround them.
 */
const en: Record<string, string> = {
  'memory.action.add': 'New memory',
  'memory.action.menu': 'Memory actions',
  'memory.action.edit': 'Edit',
  'memory.action.delete': 'Delete',
  'memory.action.promote': 'Promote to project',
  'memory.tab.count': '{count} memories',
  'memory.tab.empty.title': 'No memories yet',
  'memory.tab.empty.description': 'Memories accumulate as you work.',
  'memory.list.search': 'Search memories…',
  'memory.list.sort.label': 'Sort memories',
  'memory.list.sort.recent': 'Recently updated',
  'memory.list.sort.used': 'Most used',
  'memory.list.filter.label': 'Filter by category',
  'memory.list.filter.all': 'All',
  'memory.list.empty.noResults.title': 'No memories match',
  'memory.list.empty.noResults.body': 'Nothing here matches.',
  'memory.list.empty.clear': 'Clear filters',
  'memory.category.trap': 'Pitfalls',
  'memory.category.decision': 'Decisions',
  'memory.category.convention': 'Conventions',
  'memory.category.procedural': 'Procedures',
  'memory.section.trigger': 'Trigger',
  'memory.section.outcome': 'Outcome',
  'memory.section.what': 'Decision',
  'memory.section.why': 'Why',
  'memory.section.rule': 'Rule',
  'memory.section.scope': 'Scope',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      (en[id] ?? id).replace(/\{(\w+)\}/g, (_, k) => String(values?.[k] ?? '')),
  }),
}))

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))

// Radix's Select never opens under jsdom (it needs pointer capture and layout
// measurement), so the sort control is swapped for a native <select> with the
// same value/onValueChange contract. What this file verifies about sorting is
// MemoryTab's wiring — picking an option reorders the list — not Radix itself.
jest.mock('@/components/ui/select', () => {
  const React = require('react')
  return {
    Select: ({ value, onValueChange, children }: any) =>
      React.createElement(
        'select',
        {
          'data-testid': 'sort-select',
          value,
          onChange: (e: any) => onValueChange(e.target.value),
        },
        children
      ),
    SelectTrigger: ({ children }: any) => children,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => children,
    SelectItem: ({ value, children }: any) =>
      React.createElement('option', { value }, children),
  }
})

const mockUseMemories = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMemories', () => ({
  useMemories: (...a: any[]) => mockUseMemories(...a),
}))

const mockTrust = jest.fn(() => ({}) as Record<string, unknown>)
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useFragmentTrust', () => ({
  useFragmentTrust: () => mockTrust(),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useRetireCandidates', () => ({
  useRetireCandidates: () => ({
    candidates: [],
    confirmRetire: jest.fn(),
    confirming: false,
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMergeCandidates', () => ({
  useMergeCandidates: () => ({
    candidates: [],
    confirmMerge: jest.fn(),
    confirming: false,
  }),
}))

import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryTab } from '@/app/workspace/[workspaceUrl]/components/memory/MemoryTab'
import { selectMemories } from '@/lib/memory/list-view'

const hookBase = {
  memories: [],
  loading: false,
  error: null as string | null,
  refetch: jest.fn(),
  create: jest.fn(),
  edit: jest.fn(),
  promote: jest.fn(),
  remove: jest.fn(),
  mutating: false,
}

const row = (
  id: string,
  category: string,
  content: Record<string, unknown>,
  updatedAt: string
) => ({
  id,
  scope: 'PROJECT',
  category,
  agent: 'CLAUDE_CODE',
  content,
  taskId: null,
  createdByMemberId: null,
  createdAt: updatedAt,
  updatedAt,
})

/** Two traps, one decision, one convention — distinct titles and edit times. */
const MEMORIES = [
  row(
    'trap-old',
    'TRAP',
    {
      summary: 'Prisma drift blocks migrate dev',
      trigger: 'run migrate dev',
      outcome: 'P3012',
    },
    '2026-07-01T00:00:00.000Z'
  ),
  row(
    'decision',
    'DECISION',
    {
      summary: 'Filters stay client-side',
      what: 'filter in the browser',
      why: 'small lists',
    },
    '2026-07-20T00:00:00.000Z'
  ),
  row(
    'trap-new',
    'TRAP',
    {
      summary: 'Radix dialog selects the whole field',
      trigger: 'autofocus a prefilled input',
      outcome: 'first keystroke wipes it',
    },
    '2026-07-28T00:00:00.000Z'
  ),
  row(
    'convention',
    'CONVENTION',
    { summary: 'Branch after squash-merge', rule: 'new branch', scope: 'PRs' },
    '2026-07-10T00:00:00.000Z'
  ),
]

/** Card titles in render order — the list's actual ordering. */
function renderedTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('p.line-clamp-2')).map(el =>
    (el.textContent ?? '').trim()
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockTrust.mockReturnValue({})
})

it('LUM-725 memory list controls filter sort and search', () => {
  mockUseMemories.mockReturnValue({ ...hookBase, memories: MEMORIES })
  // 'trap-old' is the most-used memory and the least recently updated, so the
  // two orderings cannot agree by accident.
  mockTrust.mockReturnValue({
    'trap-old': { judgedUsedTasks: 9, usefulnessPct: 90 },
    decision: { judgedUsedTasks: 1, usefulnessPct: 50 },
  })

  const { container } = render(
    <MemoryTab scope='project' parentId='p1' enabled />
  )

  // Chips carry per-category counts over the whole list.
  const chips = screen.getByTestId('memory-category-filter')
  expect(
    within(chips).getByTestId('memory-category-chip-ALL')
  ).toHaveTextContent('All4')
  expect(
    within(chips).getByTestId('memory-category-chip-TRAP')
  ).toHaveTextContent('Pitfalls2')
  expect(
    within(chips).getByTestId('memory-category-chip-DECISION')
  ).toHaveTextContent('Decisions1')
  expect(
    within(chips).getByTestId('memory-category-chip-PROCEDURAL')
  ).toHaveTextContent('Procedures0')

  // Default sort is most recently updated first.
  expect(renderedTitles(container)).toEqual([
    'Radix dialog selects the whole field',
    'Filters stay client-side',
    'Branch after squash-merge',
    'Prisma drift blocks migrate dev',
  ])

  // Search matches body fields, not just the title ("P3012" is an outcome).
  const search = screen.getByPlaceholderText('Search memories…')
  fireEvent.change(search, { target: { value: 'P3012' } })
  expect(renderedTitles(container)).toEqual(['Prisma drift blocks migrate dev'])

  // Category chip narrows on its own.
  fireEvent.change(search, { target: { value: '' } })
  fireEvent.click(within(chips).getByTestId('memory-category-chip-TRAP'))
  expect(renderedTitles(container)).toEqual([
    'Radix dialog selects the whole field',
    'Prisma drift blocks migrate dev',
  ])

  // …and composes with the query: TRAP ∩ "radix" is one card.
  fireEvent.change(search, { target: { value: 'radix' } })
  expect(renderedTitles(container)).toEqual([
    'Radix dialog selects the whole field',
  ])
  // The header count follows what is on screen.
  expect(screen.getByText('1 memories')).toBeInTheDocument()

  // Sorting by usage reorders the same pool: the most-judged-used memory first,
  // even though it is the oldest edit.
  fireEvent.change(search, { target: { value: '' } })
  fireEvent.click(within(chips).getByTestId('memory-category-chip-ALL'))
  fireEvent.change(screen.getByTestId('sort-select'), {
    target: { value: 'used' },
  })
  expect(renderedTitles(container)).toEqual([
    'Prisma drift blocks migrate dev',
    'Filters stay client-side',
    'Radix dialog selects the whole field',
    'Branch after squash-merge',
  ])

  // Memories with no usage verdict keep a total order (recency breaks the tie).
  expect(
    selectMemories(MEMORIES as never, {
      query: '',
      category: 'ALL',
      sort: 'used',
      usage: {},
    }).map(m => m.id)
  ).toEqual(['trap-new', 'decision', 'convention', 'trap-old'])
})

it('LUM-725 controls render only in project scope', () => {
  mockUseMemories.mockReturnValue({ ...hookBase, memories: MEMORIES })

  const { unmount } = render(<MemoryTab scope='task' parentId='t1' enabled />)
  expect(screen.queryByTestId('memory-category-filter')).not.toBeInTheDocument()
  expect(screen.queryByTestId('sort-select')).not.toBeInTheDocument()
  expect(
    screen.queryByPlaceholderText('Search memories…')
  ).not.toBeInTheDocument()
  // The list itself still renders — only the control row is scope-gated.
  expect(screen.getByText('Filters stay client-side')).toBeInTheDocument()
  unmount()

  render(<MemoryTab scope='project' parentId='p1' enabled />)
  expect(screen.getByTestId('memory-category-filter')).toBeInTheDocument()
  expect(screen.getByTestId('sort-select')).toBeInTheDocument()
  expect(screen.getByPlaceholderText('Search memories…')).toBeInTheDocument()
})

it('LUM-725 loading skeleton and empty states', () => {
  // Loading: structured placeholder cards, one per memory the list will show —
  // not a line of text.
  mockUseMemories.mockReturnValue({ ...hookBase, loading: true })
  const loadingView = render(
    <MemoryTab scope='project' parentId='p1' enabled />
  )
  const skeleton = screen.getByTestId('memory-skeleton')
  expect(skeleton.children).toHaveLength(3)
  expect(screen.queryByText('加载中…')).not.toBeInTheDocument()
  // The controls are already mounted, so the rows land in place instead of
  // being pushed down by a header and a filter row appearing above them.
  expect(screen.getByTestId('memory-category-filter')).toBeInTheDocument()
  expect(screen.getByPlaceholderText('Search memories…')).toBeInTheDocument()
  loadingView.unmount()

  // Nothing captured yet: the first-run empty state, with the create CTA.
  mockUseMemories.mockReturnValue({ ...hookBase, memories: [] })
  const emptyView = render(<MemoryTab scope='project' parentId='p1' enabled />)
  expect(screen.getByTestId('memory-empty-none')).toBeInTheDocument()
  expect(screen.getByText('No memories yet')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /New memory/ })).toBeInTheDocument()
  emptyView.unmount()

  // Filtered to nothing: a different state — no "New memory yet" claim, and the
  // way out is dropping the filter, which brings the list back.
  mockUseMemories.mockReturnValue({ ...hookBase, memories: MEMORIES })
  render(<MemoryTab scope='project' parentId='p1' enabled />)
  fireEvent.change(screen.getByPlaceholderText('Search memories…'), {
    target: { value: 'no such memory' },
  })
  expect(screen.getByTestId('memory-empty-noResults')).toBeInTheDocument()
  expect(screen.queryByTestId('memory-empty-none')).not.toBeInTheDocument()
  expect(screen.queryByText('No memories yet')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(screen.queryByTestId('memory-empty-noResults')).not.toBeInTheDocument()
  expect(screen.getByText('Filters stay client-side')).toBeInTheDocument()
})
