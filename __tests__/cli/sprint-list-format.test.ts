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

  it('renders rows with #number, date range, name', () => {
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
    // Piped (LUM-1232 L-3): fields TAB-separated, no padding.
    expect(lines[0]).toBe('DRAFT\t#4\t2026-05-27 → 2026-06-09\tSprint 4')
    expect(lines[1]).toBe('ACTIVE\t#3\t2026-05-13 → 2026-05-26\tSprint 3')
    expect(lines[2]).toBe('CLOSED\t#2\t2026-04-29 → 2026-05-12\tSprint 2')
  })
})
