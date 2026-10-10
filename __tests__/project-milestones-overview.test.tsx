/** @jest-environment jsdom */
/**
 * LUM-712: the Project tab's milestone roll-up. It answers "where is the work
 * up to" and nothing else — creating, editing and archiving stay on the
 * Milestones tab so the project never grows two ways to make a milestone.
 */

jest.mock('react-intl', () => {
  const en = require('@/lib/i18n/en.json') as Record<string, string>
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: (
        { id, defaultMessage }: { id: string; defaultMessage?: string },
        values?: Record<string, unknown>
      ) => {
        let msg = en[id] ?? defaultMessage ?? id
        for (const [k, v] of Object.entries(values ?? {})) {
          msg = msg.split(`{${k}}`).join(String(v))
        }
        return msg
      },
    }),
  }
})

const mockUseMilestones = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMilestones', () => ({
  useMilestones: (...args: unknown[]) => mockUseMilestones(...args),
}))

const mockCreate = jest.fn()
const mockCreateState = { isPending: false, isError: false }
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useCreateMilestone', () => ({
  useCreateMilestone: (projectId: string) => ({
    mutate: (name: string, opts?: { onSuccess?: () => void }) => {
      mockCreate(projectId, name)
      opts?.onSuccess?.()
    },
    ...mockCreateState,
  }),
}))

import { render, screen, fireEvent, within } from '@testing-library/react'
import { ProjectMilestonesOverview } from '@/app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectMilestonesOverview'
import type { ApiMilestone } from '@/lib/api-client'

type Counts = NonNullable<ApiMilestone['taskCounts']>

function milestone(
  over: { name: string; slug: string } & Record<string, unknown>
): ApiMilestone {
  return {
    id: over.slug,
    projectId: 'p1',
    description: null,
    status: 'ACTIVE',
    startDate: null,
    targetDate: null,
    completedAt: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as ApiMilestone
}

function setup(milestones: ApiMilestone[], loading = false) {
  mockUseMilestones.mockReturnValue({ milestones, loading })
  const onViewAll = jest.fn()
  const utils = render(
    <ProjectMilestonesOverview
      projectId='p1'
      projectSlug='lumo'
      workspaceUrl='acme'
      onViewAll={onViewAll}
    />
  )
  return { ...utils, onViewAll }
}

beforeEach(() => {
  mockUseMilestones.mockReset()
  mockCreate.mockReset()
  mockCreateState.isPending = false
  mockCreateState.isError = false
})

describe('ProjectMilestonesOverview', () => {
  it('milestone overview renders progress rows plus a name-only inline composer and no edit or archive affordances', () => {
    setup([
      milestone({
        name: 'Honest reporting',
        slug: 'honest-reporting',
        taskCounts: {
          BACKLOG: 0,
          TODO: 2,
          IN_PROGRESS: 1,
          IN_REVIEW: 0,
          DONE: 8,
        } satisfies Counts,
      }),
      milestone({
        name: 'Agent-Native Sprints',
        slug: 'agent-native-sprints',
        status: 'PLANNED',
        taskCounts: {
          BACKLOG: 0,
          TODO: 7,
          IN_PROGRESS: 0,
          IN_REVIEW: 0,
          DONE: 0,
        } satisfies Counts,
      }),
    ])

    // done / total come from taskCounts, and the bar reports the same number.
    expect(screen.getByText('8/11')).toBeInTheDocument()
    expect(screen.getByText('0/7')).toBeInTheDocument()
    const bars = screen.getAllByRole('progressbar')
    expect(bars[0]).toHaveAttribute('aria-valuenow', '73')
    expect(bars[1]).toHaveAttribute('aria-valuenow', '0')

    // Every visible row leads with the same target marker — a milestone the
    // reader can see is an active one, so there is no second state to draw.
    const markers = screen.getAllByTestId('milestone-marker')
    expect(markers).toHaveLength(2)
    // The flag, same glyph the Milestones tab uses — the tab and the rows it
    // leads to should not be labelled with two different symbols.
    markers.forEach(m =>
      expect(m).toHaveClass('lucide-flag', 'text-warning-text')
    )

    // Status is no longer a visible axis: active vs archived is the whole
    // model, and archived rows never reach this list.
    expect(screen.queryByText('Active')).not.toBeInTheDocument()
    expect(screen.queryByText('Planned')).not.toBeInTheDocument()

    // The header is the label alone — no count beside it.
    const header = screen.getByText('Milestones').parentElement!
    expect(within(header).queryByText('2')).not.toBeInTheDocument()

    // Each row is a link to the milestone, nothing more.
    const row = screen.getByRole('link', { name: /Honest reporting/ })
    expect(row).toHaveAttribute(
      'href',
      '/workspace/acme/projects/lumo/milestones/honest-reporting'
    )

    // Editing an existing milestone stays on the Milestones tab — this section
    // writes exactly once, by creating.
    const section = screen.getByTestId('project-milestones-overview')
    for (const label of [/archive/i, /delete/i, /edit/i]) {
      expect(within(section).queryByText(label)).not.toBeInTheDocument()
    }
    // Two buttons only: the hand-off, and the inline add trigger.
    expect(within(section).getAllByRole('button')).toHaveLength(2)
    expect(screen.getByTestId('milestone-add-trigger')).toBeInTheDocument()
    // Closed until asked — the composer must not sit open as a phantom row.
    expect(
      screen.queryByPlaceholderText('Milestone name…')
    ).not.toBeInTheDocument()
  })

  it('creates a milestone from the inline composer on Enter and closes it', () => {
    setup([milestone({ name: 'One', slug: 'one' })])

    fireEvent.click(screen.getByTestId('milestone-add-trigger'))
    const field = screen.getByPlaceholderText('Milestone name…')
    fireEvent.change(field, { target: { value: '  Agent-Native Sprints  ' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    // Trimmed, and sent with the project it belongs to.
    expect(mockCreate).toHaveBeenCalledWith('p1', 'Agent-Native Sprints')
    expect(
      screen.queryByPlaceholderText('Milestone name…')
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('milestone-add-trigger')).toBeInTheDocument()
  })

  it('does not submit an empty or whitespace-only name', () => {
    setup([milestone({ name: 'One', slug: 'one' })])

    fireEvent.click(screen.getByTestId('milestone-add-trigger'))
    const field = screen.getByPlaceholderText('Milestone name…')
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('abandons the composer on Escape but keeps a half-typed name on blur', () => {
    setup([milestone({ name: 'One', slug: 'one' })])

    fireEvent.click(screen.getByTestId('milestone-add-trigger'))
    let field = screen.getByPlaceholderText('Milestone name…')
    fireEvent.change(field, { target: { value: 'half typed' } })
    // Clicking away must not discard what was typed.
    fireEvent.blur(field)
    expect(screen.getByPlaceholderText('Milestone name…')).toHaveValue(
      'half typed'
    )

    field = screen.getByPlaceholderText('Milestone name…')
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(
      screen.queryByPlaceholderText('Milestone name…')
    ).not.toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('hands off to the Milestones tab for anything that changes a milestone', () => {
    const { onViewAll } = setup([milestone({ name: 'One', slug: 'one' })])

    fireEvent.click(screen.getByText('View all →'))
    expect(onViewAll).toHaveBeenCalled()
  })

  it('asks the server for non-archived milestones only', () => {
    // Archived is the only other state a milestone has, and it is hidden by
    // default — the `active` filter resolves to `archivedAt: null` server-side.
    setup([milestone({ name: 'One', slug: 'one' })])

    expect(mockUseMilestones).toHaveBeenCalledWith('p1', 'active')
  })

  it('renders 0/0 rather than crashing when the server sent no task counts', () => {
    setup([milestone({ name: 'Uncounted', slug: 'uncounted' })])

    expect(screen.getByText('0/0')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '0'
    )
  })

  it('falls back to an empty note when the project has no active milestones', () => {
    setup([])

    expect(screen.getByText('No milestones yet')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    // The hand-off stays, so an empty section is still a way in.
    expect(screen.getByText('View all →')).toBeInTheDocument()
  })

  it('shows placeholders while the milestone list is loading', () => {
    setup([], true)

    expect(
      screen
        .getByTestId('project-milestones-overview')
        .querySelector('[aria-busy="true"]')
    ).toBeInTheDocument()
    expect(screen.queryByText('No milestones yet')).not.toBeInTheDocument()
  })
})
