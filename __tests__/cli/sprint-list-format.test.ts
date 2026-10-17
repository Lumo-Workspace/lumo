/**
 * @jest-environment node
 */
import {
  formatSprintList,
  type SprintRow,
} from '@/cli/src/commands/sprint-list'

describe('formatSprintList', () => {
  it('returns "No sprints." when list is empty', () => {
    expect(formatSprintList([])).toBe('No sprints.')
  })

  it('renders fixed-width rows with #number, date range, name', () => {
    const rows: SprintRow[] = [
      {
        id: 'sp-4',
        number: 4,
        name: 'Sprint 4',
        status: 'DRAFT',
        startDate: '2026-05-27T00:00:00.000Z',
        endDate: '2026-06-09T00:00:00.000Z',
      },
      {
        id: 'sp-3',
        number: 3,
        name: 'Sprint 3',
        status: 'ACTIVE',
        startDate: '2026-05-13T00:00:00.000Z',
        endDate: '2026-05-26T00:00:00.000Z',
      },
      {
        id: 'sp-2',
        number: 2,
        name: 'Sprint 2',
        status: 'CLOSED',
        startDate: '2026-04-29T00:00:00.000Z',
        endDate: '2026-05-12T00:00:00.000Z',
      },
    ]
    const out = formatSprintList(rows)
    const lines = out.split('\n')
    expect(lines).toHaveLength(3)
    // Status column is padded to the longest status ("ACTIVE" = 6, "CLOSED" = 6, "DRAFT" = 5 → pad to 6)
    expect(lines[0]).toBe('DRAFT   #4  2026-05-27 → 2026-06-09  Sprint 4')
    expect(lines[1]).toBe('ACTIVE  #3  2026-05-13 → 2026-05-26  Sprint 3')
    expect(lines[2]).toBe('CLOSED  #2  2026-04-29 → 2026-05-12  Sprint 2')
  })
})
