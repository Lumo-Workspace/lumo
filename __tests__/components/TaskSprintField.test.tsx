/** @jest-environment jsdom */
const en: Record<string, string> = {
  'sprints.taskField.noSprint': 'No sprint',
  'sprints.taskField.group.current': 'Current',
  'sprints.taskField.group.upcoming': 'Upcoming',
  'sprints.taskField.group.past': 'Past',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

// First paint: the client sprint list hasn't loaded yet.
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSprints', () => ({
  useSprintsForTeam: jest.fn(() => ({ sprints: [] })),
}))

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskSprintField } from '@/app/workspace/[workspaceUrl]/sprints/components/TaskSprintField'
import { useSprintsForTeam } from '@/app/workspace/[workspaceUrl]/hooks/useSprints'
import { DAY_MS, viewerDayKey } from '@/lib/services/sprint-date'

const useSprintsForTeamMock = useSprintsForTeam as unknown as jest.Mock

/**
 * UTC-midnight calendar day `offset` days from the day the VIEWER is in — how
 * sprints are stored, in the frame `deriveSprintState` buckets them in.
 *
 * It has to be the viewer's day, not `Date.UTC(...)` of now: from a machine
 * west of UTC after UTC midnight those are different days, so a UTC-anchored
 * fixture lands one day off and an "ended yesterday" sprint quietly becomes
 * "ends today".
 */
function dayFromToday(offset: number): Date {
  return new Date(viewerDayKey(new Date()) + offset * DAY_MS)
}

function sprint(
  id: string,
  name: string,
  startOffset: number,
  endOffset: number,
  status: string
) {
  return {
    id,
    name,
    status,
    startDate: dayFromToday(startOffset),
    endDate: dayFromToday(endOffset),
  }
}

// Radix Select drives its trigger through pointer-capture APIs jsdom doesn't
// implement, and scrolls the highlighted item into view on open.
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
  Element.prototype.hasPointerCapture = jest.fn(() => false)
  Element.prototype.releasePointerCapture = jest.fn()
  Element.prototype.setPointerCapture = jest.fn()
})

describe('TaskSprintField', () => {
  beforeEach(() => {
    useSprintsForTeamMock.mockClear()
    useSprintsForTeamMock.mockImplementation(() => ({ sprints: [] }))
  })

  // LUM-190: the sprint list query must not fire on first paint — the trigger
  // name is SSR-prefetched. LUM-705: and it is now a SINGLE query with no
  // status filter, so a sprint the team is living in can't be filtered out by
  // its DB status.
  it('defers a single unfiltered sprint query until the dropdown opens', () => {
    render(
      <TaskSprintField
        task={{
          id: 't_1',
          teamId: 'team_1',
          sprintId: 'sp_1',
          sprint: { id: 'sp_1', name: 'Sprint 7' },
        }}
        onChange={jest.fn()}
      />
    )
    expect(useSprintsForTeamMock).toHaveBeenCalledTimes(1)
    const [teamId, status, enabled] = useSprintsForTeamMock.mock.calls[0]
    expect(teamId).toBe('team_1')
    expect(status).toBeUndefined()
    expect(enabled).toBe(false)
  })

  // Regression guard for LUM-189: with the option list still empty, the
  // SSR-prefetched `sprint` object must drive the trigger name so it doesn't
  // flicker blank before `useSprintsForTeam` resolves.
  it('renders the prefetched sprint name when the option list is empty', () => {
    render(
      <TaskSprintField
        task={{
          id: 't_1',
          teamId: 'team_1',
          sprintId: 'sp_1',
          sprint: { id: 'sp_1', name: 'Sprint 7' },
        }}
        onChange={jest.fn()}
      />
    )
    expect(screen.getByText('Sprint 7')).toBeInTheDocument()
    expect(screen.queryByText('No sprint')).not.toBeInTheDocument()
  })

  it('shows the placeholder when no sprint is bound', () => {
    render(
      <TaskSprintField
        task={{ id: 't_1', teamId: 'team_1', sprintId: null, sprint: null }}
        onChange={jest.fn()}
      />
    )
    expect(screen.getByText('No sprint')).toBeInTheDocument()
  })

  // LUM-705 core regression: a sprint whose DB status is CLOSED but whose
  // calendar window still covers today is the sprint the team is working in.
  // It must be offered, grouped as Current — the bug was that the picker only
  // asked for DRAFT + ACTIVE, so it silently disappeared and the "past" slot
  // fell through to a much older sprint that happened to still be DRAFT.
  it('offers a CLOSED-status sprint whose window covers today as Current', async () => {
    useSprintsForTeamMock.mockImplementation(() => ({
      sprints: [
        sprint('sp_7', 'Sprint 7', -13, 0, 'CLOSED'),
        sprint('sp_8', 'Sprint 8', 1, 14, 'DRAFT'),
        sprint('sp_6', 'Sprint 6', -27, -14, 'CLOSED'),
        sprint('sp_3', 'Sprint 3', -69, -56, 'DRAFT'),
      ],
    }))
    const onChange = jest.fn()
    render(
      <TaskSprintField
        task={{ id: 't_1', teamId: 'team_1', sprintId: null, sprint: null }}
        onChange={onChange}
      />
    )

    await userEvent.click(screen.getByRole('combobox'))

    const options = screen.getAllByRole('option').map(o => o.textContent ?? '')
    expect(options.some(o => o.includes('Sprint 7'))).toBe(true)
    expect(options.some(o => o.includes('Sprint 8'))).toBe(true)
    // Past collapses to the most recently ended sprint — Sprint 6, not the
    // older DRAFT-status Sprint 3 the status filter used to surface.
    expect(options.some(o => o.includes('Sprint 6'))).toBe(true)
    expect(options.some(o => o.includes('Sprint 3'))).toBe(false)

    const seven = screen
      .getAllByRole('option')
      .find(o => (o.textContent ?? '').includes('Sprint 7'))!
    expect(seven.textContent).toContain('Current')

    await userEvent.click(seven)
    expect(onChange).toHaveBeenCalledWith('sp_7')
  })
})
