/**
 * @jest-environment node
 */
import { formatMilestoneList } from '@/cli/src/commands/milestone-list'

type Row = Parameters<typeof formatMilestoneList>[0][number]

function row(overrides: Partial<Row>): Row {
  return {
    id: 'm-1',
    name: 'Q3 Launch',
    status: 'ACTIVE',
    targetDate: '2026-08-31T00:00:00.000Z',
    createdAt: '2026-06-01T00:00:00.000Z',
    archivedAt: null,
    ...overrides,
  }
}

describe('formatMilestoneList', () => {
  it('returns a placeholder when there are no milestones', () => {
    expect(formatMilestoneList([])).toBe('No milestones.')
  })

  it('renders a HEALTH column between status and target date', () => {
    const out = formatMilestoneList([row({ health: 'at-risk' })])
    expect(out).toBe('ACTIVE  AT-RISK  2026-08-31  Q3 Launch')
  })

  it('shows "-" for a milestone with no health light', () => {
    const out = formatMilestoneList([
      row({ status: 'COMPLETED', health: null }),
    ])
    expect(out).toBe('COMPLETED  -  2026-08-31  Q3 Launch')
  })

  it('aligns columns across rows (status, health, date, name)', () => {
    const out = formatMilestoneList([
      row({ id: 'a', name: 'A', status: 'ACTIVE', health: 'overdue' }),
      row({
        id: 'b',
        name: 'B',
        status: 'PLANNED',
        health: 'on-track',
        targetDate: null,
      }),
    ])
    const lines = out.split('\n')
    expect(lines).toHaveLength(2)
    const line1 = lines[0] as string
    const line2 = lines[1] as string
    // Columns are separated by 2+ spaces; tokenise to assert order + values.
    expect(line1.split(/\s{2,}/)).toEqual([
      'ACTIVE',
      'OVERDUE',
      '2026-08-31',
      'A',
    ])
    expect(line2.split(/\s{2,}/)).toEqual(['PLANNED', 'ON-TRACK', '-', 'B'])
    // The HEALTH column starts at the same offset on every row.
    expect(line1.indexOf('OVERDUE')).toBe(line2.indexOf('ON-TRACK'))
  })

  it('marks an archived milestone with a (archived) suffix', () => {
    const out = formatMilestoneList([
      row({ archivedAt: '2026-06-02T00:00:00.000Z' }),
    ])
    expect(out).toContain('Q3 Launch (archived)')
  })
})
