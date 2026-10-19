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
 *
 * LUM-724 adds the list's two edge states — the loading placeholder and the
 * empty state — in the third describe block at the bottom.
 */

const en: Record<string, string> = {
  'milestone.filter.label': 'Filter milestones',
  'milestone.filter.active': 'Active',
  'milestone.filter.archived': 'Archived',
  'milestone.filter.all': 'All',
  'milestone.new': 'New milestone',
  'milestone.empty.active.title': 'No milestones in progress',
  'milestone.empty.active.body': 'Milestones group tasks into stages.',
  'milestone.empty.archived.title': 'No archived milestones',
  'milestone.empty.archived.body': 'Archiving puts a milestone away.',
  'milestone.empty.all.title': 'No milestones yet',
  'milestone.empty.all.body': 'Milestones group tasks into stages.',
  'milestone.archiveConfirm.title': 'Archive an unfinished milestone?',
  'milestone.archiveConfirm.body':
    '{name} still has {remaining} unfinished tasks.',
  'milestone.archiveConfirm.confirm': 'Archive anyway',
  'common.cancel': 'Cancel',
  'milestone.targetDate.none': 'No target date',
  'milestone.state.active': 'Active state',
  'milestone.state.completed': 'Completed state',
  'milestone.state.archived': 'Archived state',
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
  BACKLOG: 0,
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
    completedAt: '2026-06-01T00:00:00.000Z',
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
      within(chips).getByRole('radio', { name: new RegExp(`^${label}`) })
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

describe('ProjectMilestonesTab edge states', () => {
  /** The `h-*` utility an element sets its own height with, if any. */
  const heightClass = (el: Element | null) =>
    el?.className.split(/\s+/).find(c => /^h-\[?\d/.test(c))

  it('loading shows skeleton rows shaped like real rows', () => {
    const { container: loadingBox } = setup([], true)

    const busy = loadingBox.querySelector('[aria-busy="true"]')
    expect(busy).not.toBeNull()
    const placeholders = Array.from(busy!.children)
    expect(placeholders).toHaveLength(3)

    // Same columns as a real row: status dot, name, spacer, right-hand meta.
    for (const row of placeholders) {
      expect(row.children).toHaveLength(4)
      expect(row.children[0]!.className).toContain('size-2')
      expect(row.children[3]!.className).toContain('w-[140px]')
    }

    // Nothing claims the list is empty while it is still loading.
    expect(
      within(loadingBox).queryByText('No milestones in progress')
    ).not.toBeInTheDocument()

    // A placeholder of a different height makes the list jump when data lands.
    const { container: listBox } = setup(list)
    expect(heightClass(placeholders[0]!)).toBe(
      heightClass(listBox.querySelector('.group'))
    )
    expect(heightClass(placeholders[0]!)).toBeDefined()
  })

  it('empty state copy and CTA follow the tab', () => {
    setup([])

    const chips = screen.getByRole('group', { name: 'Filter milestones' })
    const ctas = () => screen.getAllByRole('button', { name: /New milestone/ })

    // Active — nothing is running; the header button plus the empty-state CTA.
    expect(screen.getByText('No milestones in progress')).toBeInTheDocument()
    expect(
      screen.getByText('Milestones group tasks into stages.')
    ).toBeInTheDocument()
    expect(ctas()).toHaveLength(2)

    // Archived — you archive an existing milestone, so "create one" is not the
    // way out of this state. Only the page header keeps its button.
    fireEvent.click(within(chips).getByText('Archived'))
    expect(screen.getByText('No archived milestones')).toBeInTheDocument()
    expect(
      screen.getByText('Archiving puts a milestone away.')
    ).toBeInTheDocument()
    expect(ctas()).toHaveLength(1)

    // All — the project has no milestones at all.
    fireEvent.click(within(chips).getByText('All'))
    expect(screen.getByText('No milestones yet')).toBeInTheDocument()
    expect(ctas()).toHaveLength(2)

    // The empty-state CTA opens the same create dialog the header does.
    fireEvent.click(ctas()[1]!)
    expect(screen.getByTestId('form-dialog')).toBeInTheDocument()
  })

  it('every locale has translated empty state keys', () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')

    const dir = path.join(process.cwd(), 'lib/i18n')
    const locales = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    expect(locales.length).toBeGreaterThan(1)

    const keys = [
      'milestone.empty.active.title',
      'milestone.empty.active.body',
      'milestone.empty.archived.title',
      'milestone.empty.archived.body',
      'milestone.empty.all.title',
      'milestone.empty.all.body',
    ]
    const read = (file: string) =>
      JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Record<
        string,
        string
      >
    const english = read('en.json')

    for (const file of locales) {
      const messages = read(file)
      for (const key of keys) {
        const value = messages[key]
        expect(typeof value).toBe('string')
        expect(value!.trim()).not.toBe('')
        // `npm run i18n:sync` back-fills placeholders to keep parity green;
        // shipping one would show English-shaped filler to that locale.
        expect(value).not.toContain('[TODO:')
        // Non-English locales get a real translation, never the English string.
        if (!file.startsWith('en')) {
          expect(value).not.toBe(english[key])
        }
      }
    }
  })
})
