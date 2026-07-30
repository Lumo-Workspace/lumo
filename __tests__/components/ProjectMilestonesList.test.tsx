/** @jest-environment jsdom */
/**
 * LUM-723 — the milestone list's two page-level behaviours:
 *
 * 1. The Active / Archived / All chips carry counts, and those counts come from
 *    the same single fetch the rows come from. Three server-filtered queries
 *    would let a chip claim a number the list below it had never loaded.
 * 2. Archiving a milestone with open tasks asks first and says how many tasks
 *    are affected — it is the only archive that hides unfinished work. A
 *    finished milestone archives on the click.
 *
 * The row's actions menu is a Radix dropdown covered by MilestoneRow's own
 * suite; here it is stubbed to a plain button so these assertions are about the
 * page's gating, not about opening a menu.
 */

const en: Record<string, string> = {
  'milestone.filter.label': 'Filter milestones',
  'milestone.filter.active': 'Active',
  'milestone.filter.archived': 'Archived',
  'milestone.filter.all': 'All',
  'milestone.new': 'New milestone',
  'milestone.empty.title': 'No milestones yet',
  'milestone.empty.cta': 'Create the first milestone',
  'milestone.archiveConfirm.title': 'Archive an unfinished milestone?',
  'milestone.archiveConfirm.body':
    '{name} still has {remaining} unfinished tasks.',
  'milestone.archiveConfirm.confirm': 'Archive anyway',
  'common.cancel': 'Cancel',
  'milestone.targetDate.none': 'No target date',
  'milestone.status.ACTIVE': 'Active status',
  'milestone.status.PLANNED': 'Planned status',
  'milestone.status.COMPLETED': 'Completed status',
  'milestone.status.CANCELLED': 'Cancelled status',
  'milestone.list.incomplete': 'Incomplete',
  'milestone.list.archivedIncomplete': 'Archived while incomplete',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      (en[id] ?? id).replace(/\{(\w+)\}/g, (_, k) => String(values?.[k] ?? '')),
  }),
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'acme' }),
}))

jest.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: jest.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))

const mockUseMilestones = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMilestones', () => ({
  useMilestones: (...args: unknown[]) => mockUseMilestones(...args),
}))

const mockArchive = jest.fn()
const mockUnarchive = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMilestoneArchive', () => ({
  useMilestoneArchive: () => ({
    archive: { mutate: mockArchive },
    unarchive: { mutate: mockUnarchive },
  }),
}))

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneActionsMenu',
  () => ({
    MilestoneActionsMenu: ({
      onArchiveToggle,
    }: {
      onArchiveToggle: () => void
    }) => (
      <button type='button' onClick={onArchiveToggle}>
        archive-toggle
      </button>
    ),
  })
)

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneFormDialog',
  () => ({ MilestoneFormDialog: () => <div data-testid='form-dialog' /> })
)

import { render, screen, fireEvent, within } from '@testing-library/react'
import { ProjectMilestonesTab } from '@/app/workspace/[workspaceUrl]/components/milestones/ProjectMilestonesTab'
import type { ApiMilestone } from '@/lib/api-client'

function milestone(
  over: Partial<ApiMilestone> & { name: string; id: string }
): ApiMilestone {
  return {
    projectId: 'p-1',
    slug: over.name.toLowerCase().replace(/\s+/g, '-'),
    description: null,
    status: 'ACTIVE',
    startDate: null,
    targetDate: null,
    completedAt: null,
    archivedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  } as ApiMilestone
}

const counts = (done: number, todo: number) => ({
  TODO: todo,
  IN_PROGRESS: 0,
  IN_REVIEW: 0,
  DONE: done,
})

const list: ApiMilestone[] = [
  milestone({ id: 'm1', name: 'Running one', taskCounts: counts(2, 6) }),
  milestone({ id: 'm2', name: 'Running two', taskCounts: counts(8, 3) }),
  milestone({
    id: 'm3',
    name: 'Shipped one',
    status: 'COMPLETED',
    archivedAt: '2026-07-01T00:00:00.000Z',
    taskCounts: counts(5, 0),
  }),
]

function setup(milestones: ApiMilestone[] = list, loading = false) {
  mockUseMilestones.mockReturnValue({ milestones, loading })
  return render(<ProjectMilestonesTab projectId='p-1' projectSlug='lumo' />)
}

beforeEach(() => {
  mockUseMilestones.mockReset()
  mockArchive.mockReset()
  mockUnarchive.mockReset()
})

describe('ProjectMilestonesTab list', () => {
  it('shows counts on the Active, Archived and All filter chips', () => {
    setup()

    const chips = screen.getByRole('group', { name: 'Filter milestones' })
    const chip = (label: string) =>
      within(chips).getByRole('button', { name: new RegExp(`^${label}`) })
    expect(chip('Active')).toHaveTextContent('Active2')
    expect(chip('Archived')).toHaveTextContent('Archived1')
    expect(chip('All')).toHaveTextContent('All3')

    // The counts describe one fetch, not three: the hook is asked for `all`
    // and the tabs partition that result client-side.
    expect(mockUseMilestones).toHaveBeenCalledWith('p-1', 'all')

    // Active is the landing view — only the two unarchived rows show.
    expect(screen.getByText('Running one')).toBeInTheDocument()
    expect(screen.queryByText('Shipped one')).not.toBeInTheDocument()

    fireEvent.click(within(chips).getByText('Archived'))
    expect(screen.getByText('Shipped one')).toBeInTheDocument()
    expect(screen.queryByText('Running one')).not.toBeInTheDocument()

    fireEvent.click(within(chips).getByText('All'))
    expect(screen.getByText('Running one')).toBeInTheDocument()
    expect(screen.getByText('Shipped one')).toBeInTheDocument()
  })

  it('asks for confirmation before archiving an unfinished milestone', () => {
    setup()

    // "Running one" has 2 of 8 done — archiving it would hide 6 open tasks.
    fireEvent.click(screen.getAllByText('archive-toggle')[0]!)

    expect(mockArchive).not.toHaveBeenCalled()
    expect(
      screen.getByText('Archive an unfinished milestone?')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Running one still has 6 unfinished tasks.')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByText('Archive anyway'))
    expect(mockArchive).toHaveBeenCalledTimes(1)
    expect(mockArchive.mock.calls[0]?.[0].id).toBe('m1')
  })

  it('archives a finished milestone without asking', () => {
    setup([milestone({ id: 'm9', name: 'All done', taskCounts: counts(4, 0) })])

    fireEvent.click(screen.getByText('archive-toggle'))

    expect(mockArchive).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByText('Archive an unfinished milestone?')
    ).not.toBeInTheDocument()
  })

  it('unarchives without asking', () => {
    setup([
      milestone({
        id: 'm8',
        name: 'Dropped',
        archivedAt: '2026-07-01T00:00:00.000Z',
        taskCounts: counts(1, 4),
      }),
    ])

    const chips = screen.getByRole('group', { name: 'Filter milestones' })
    fireEvent.click(within(chips).getByText('Archived'))
    fireEvent.click(screen.getByText('archive-toggle'))

    expect(mockUnarchive).toHaveBeenCalledTimes(1)
    expect(mockArchive).not.toHaveBeenCalled()
    expect(
      screen.queryByText('Archive an unfinished milestone?')
    ).not.toBeInTheDocument()
  })

  it('cancelling the confirmation leaves the milestone alone', () => {
    setup()

    fireEvent.click(screen.getAllByText('archive-toggle')[0]!)
    fireEvent.click(screen.getByText('Cancel'))

    expect(mockArchive).not.toHaveBeenCalled()
    expect(
      screen.queryByText('Archive an unfinished milestone?')
    ).not.toBeInTheDocument()
  })
})
