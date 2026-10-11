/** @jest-environment jsdom */
/**
 * LUM-722 — the "New milestone" (milestones tab) and "New memory" (memory tab)
 * primary CTAs must both lead with a Plus icon, matching the Sprints
 * "+ New …" shape so sibling tabs read as one system.
 *
 * The icon is decorative (aria-hidden), so the accessible name stays the label
 * alone — asserted here too, since that is what every other test looks the
 * buttons up by.
 */
const en: Record<string, string> = {
  'milestone.new': 'New milestone',
  'milestone.empty.title': 'No milestones yet',
  'milestone.empty.cta': 'Create the first milestone',
  'milestone.filter.label': 'Filter milestones',
  'milestone.filter.active': 'Active',
  'milestone.filter.archived': 'Archived',
  'milestone.filter.all': 'All',
  'memory.action.add': 'New memory',
  'memory.tab.count': '{count} memories',
  'memory.action.menu': 'Memory actions',
  'memory.source.auto': 'Sedimented by Claude',
  'agentRun.loading': '加载中…',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      (en[id] ?? id).replace(/\{(\w+)\}/g, (_, k) => String(values?.[k] ?? '')),
  }),
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'lumo' }),
}))

jest.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: jest.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMilestones', () => ({
  useMilestones: () => ({ milestones: [], loading: false }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMilestoneArchive', () => ({
  useMilestoneArchive: () => ({
    archive: { mutate: jest.fn() },
    unarchive: { mutate: jest.fn() },
  }),
}))

const mockUseMemories = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMemories', () => ({
  useMemories: (...a: any[]) => mockUseMemories(...a),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useFragmentTrust', () => ({
  useFragmentTrust: () => ({}),
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
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))

import { render, screen } from '@testing-library/react'
import { ProjectMilestonesTab } from '@/app/workspace/[workspaceUrl]/components/milestones/ProjectMilestonesTab'
import { MemoryTab } from '@/app/workspace/[workspaceUrl]/components/memory/MemoryTab'

/** The icon must be the button's first child — a leading "+", not a trailing one. */
function expectLeadingIcon(button: HTMLElement) {
  const icon = button.querySelector('svg')
  expect(icon).not.toBeNull()
  expect(button.firstElementChild).toBe(icon)
  // Decorative: hidden from the accessibility tree so the name stays the label.
  expect(icon).toHaveAttribute('aria-hidden')
}

describe('LUM-722 new-button plus icon', () => {
  it('New milestone button leads with a plus icon', () => {
    render(<ProjectMilestonesTab projectId='p1' projectSlug='lumo' />)
    // Two of them on an empty list (LUM-724): the header button and the
    // empty-state call to action. Both are the same offer, so both lead with +.
    const buttons = screen.getAllByRole('button', { name: 'New milestone' })
    expect(buttons).toHaveLength(2)
    buttons.forEach(expectLeadingIcon)
  })

  it('New memory button leads with a plus icon', () => {
    mockUseMemories.mockReturnValue({
      memories: [
        {
          id: 'm1',
          scope: 'TASK',
          category: 'TRAP',
          content: { trigger: 'do X', outcome: 'breaks' },
          taskId: 't1',
          createdByMemberId: null,
          createdAt: 'a',
          updatedAt: 'a',
        },
      ],
      loading: false,
      error: null,
      refetch: jest.fn(),
      create: jest.fn(),
      edit: jest.fn(),
      promote: jest.fn(),
      remove: jest.fn(),
      mutating: false,
    })
    render(<MemoryTab scope='task' parentId='t1' enabled />)
    expectLeadingIcon(screen.getByRole('button', { name: 'New memory' }))
  })
})
