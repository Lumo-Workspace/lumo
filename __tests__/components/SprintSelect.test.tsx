/** @jest-environment jsdom */
const en: Record<string, string> = {
  'sprints.taskField.noSprint': 'No sprint',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSprints', () => ({
  useSprintsForTeam: jest.fn(() => ({ sprints: [] })),
}))

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SprintSelect } from '@/app/workspace/[workspaceUrl]/components/fields/SprintSelect'
import { useSprintsForTeam } from '@/app/workspace/[workspaceUrl]/hooks/useSprints'
import { DAY_MS, viewerDayKey } from '@/lib/services/sprint-date'

const useSprintsForTeamMock = useSprintsForTeam as unknown as jest.Mock

/** Calendar day `offset` days from the viewer's day — see TaskSprintField.test. */
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

// jsdom lacks ResizeObserver, which Radix's Tooltip internals (use-size) need.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
  Element.prototype.scrollIntoView = jest.fn()
  Element.prototype.hasPointerCapture = jest.fn(() => false)
  Element.prototype.releasePointerCapture = jest.fn()
  Element.prototype.setPointerCapture = jest.fn()
})

describe('SprintSelect', () => {
  beforeEach(() => {
    useSprintsForTeamMock.mockClear()
    useSprintsForTeamMock.mockImplementation(() => ({ sprints: [] }))
  })

  // LUM-705: the new-task picker asked for ACTIVE + DRAFT, which dropped the
  // sprint the team is actually in the moment it was closed. One unfiltered
  // query; the calendar window decides what's offered.
  it('asks for the team sprints without a status filter', () => {
    render(<SprintSelect teamId='team_1' value={null} onChange={jest.fn()} />)
    expect(useSprintsForTeamMock).toHaveBeenCalledTimes(1)
    const [teamId, status] = useSprintsForTeamMock.mock.calls[0]
    expect(teamId).toBe('team_1')
    expect(status).toBeUndefined()
  })

  it('offers a CLOSED-status sprint whose window covers today', async () => {
    useSprintsForTeamMock.mockImplementation(() => ({
      sprints: [
        sprint('sp_7', 'Sprint 7', -13, 0, 'CLOSED'),
        sprint('sp_8', 'Sprint 8', 1, 14, 'DRAFT'),
        sprint('sp_6', 'Sprint 6', -27, -14, 'CLOSED'),
        sprint('sp_1', 'Sprint 1', -97, -84, 'DRAFT'),
      ],
    }))
    const onChange = jest.fn()
    render(<SprintSelect teamId='team_1' value={null} onChange={onChange} />)

    await userEvent.click(screen.getByRole('combobox'))

    const options = screen.getAllByRole('option').map(o => o.textContent ?? '')
    expect(options).toContain('Sprint 7')
    expect(options).toContain('Sprint 8')
    // Only the most recently ended sprint carries over; older ones stay out.
    expect(options).toContain('Sprint 6')
    expect(options).not.toContain('Sprint 1')

    await userEvent.click(screen.getByText('Sprint 7'))
    expect(onChange).toHaveBeenCalledWith('sp_7')
  })
})
