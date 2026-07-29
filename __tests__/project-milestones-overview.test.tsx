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

beforeEach(() => mockUseMilestones.mockReset())

describe('ProjectMilestonesOverview', () => {
  it('milestone overview renders read-only progress rows with no CRUD affordances', () => {
    setup([
      milestone({
        name: 'Honest reporting',
        slug: 'honest-reporting',
        taskCounts: {
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

    // Each row is a link to the milestone, nothing more.
    const row = screen.getByRole('link', { name: /Honest reporting/ })
    expect(row).toHaveAttribute(
      'href',
      '/workspace/acme/projects/lumo/milestones/honest-reporting'
    )
    expect(within(row).getByText('Active')).toBeInTheDocument()

    // No create / edit / archive / delete entry point lives in this section.
    const section = screen.getByTestId('project-milestones-overview')
    for (const label of [/new milestone/i, /archive/i, /delete/i, /edit/i]) {
      expect(within(section).queryByText(label)).not.toBeInTheDocument()
    }
    // The only button is the hand-off to the Milestones tab.
    expect(within(section).getAllByRole('button')).toHaveLength(1)
  })

  it('hands off to the Milestones tab for anything that changes a milestone', () => {
    const { onViewAll } = setup([milestone({ name: 'One', slug: 'one' })])

    fireEvent.click(screen.getByText('View all →'))
    expect(onViewAll).toHaveBeenCalled()
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
