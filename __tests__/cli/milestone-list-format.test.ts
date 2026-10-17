/**
 * @jest-environment node
 */
import { formatMilestoneList } from '@/cli/src/commands/milestone-list'

type Row = Parameters<typeof formatMilestoneList>[0][number]

function row(overrides: Partial<Row>): Row {
  return {
    id: 'm-1',
    name: 'Q3 Launch',
    slug: 'q3-launch',
    completedAt: null,
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

  it('renders a HEALTH column between state and target date', () => {
    const out = formatMilestoneList([row({ health: 'at-risk' })])
    expect(out).toBe('ACTIVE\tAT_RISK\t2026-08-31\tq3-launch\tQ3 Launch')
  })

  // LUM-714: the STATE column is derived from the two timestamps, not read
  // off a status column.
  it('shows "-" for a milestone with no health light', () => {
    const out = formatMilestoneList([
      row({ completedAt: '2026-06-01T00:00:00.000Z', health: null }),
    ])
    expect(out).toBe('COMPLETED\t-\t2026-08-31\tq3-launch\tQ3 Launch')
  })

  it('aligns columns across rows (state, health, date, name)', () => {
    const out = formatMilestoneList([
      row({ id: 'a', name: 'A', slug: 'a', health: 'overdue' }),
      row({
        id: 'b',
        name: 'B',
        slug: 'b',
        completedAt: '2026-06-01T00:00:00.000Z',
        health: 'on-track',
        targetDate: null,
      }),
    ])
    const lines = out.split('\n')
    expect(lines).toHaveLength(2)
    const line1 = lines[0] as string
    const line2 = lines[1] as string
    // Piped: fields are TAB-separated; tokenise to assert order + values.
    expect(line1.split('\t')).toEqual([
      'ACTIVE',
      'OVERDUE',
      '2026-08-31',
      'a',
      'A',
    ])
    expect(line2.split('\t')).toEqual(['COMPLETED', 'ON_TRACK', '-', 'b', 'B'])
    // On a TTY the HEALTH column starts at the same offset on every row.
    const tty = formatMilestoneList(
      [
        row({ id: 'a', name: 'A', slug: 'a', health: 'overdue' }),
        row({
          id: 'b',
          name: 'B',
          slug: 'b',
          completedAt: '2026-06-01T00:00:00.000Z',
          health: 'on-track',
          targetDate: null,
        }),
      ],
      { tty: true, width: 200, color: false }
    ).split('\n')
    expect(tty[1]!.indexOf('OVERDUE')).toBe(tty[2]!.indexOf('ON_TRACK'))
  })

  // LUM-1230: the slug is the handle every milestone command takes — the
  // name may repeat or carry characters that are hard to type.
  it('prints the slug column (the ref to type), never the id', () => {
    const out = formatMilestoneList([
      row({
        id: 'cmv95ivuj000l06jvjrs7b7z1',
        name: 'Headless 化(一):Web 展示信息 CLI 化',
        slug: 'headless-web-cli',
      }),
    ])
    expect(out).toContain('headless-web-cli')
    expect(out).not.toContain('cmv95ivuj000l06jvjrs7b7z1')
  })

  it('shows "-" in the slug column for an older server that sends none', () => {
    const { slug: _slug, ...noSlug } = row({})
    const out = formatMilestoneList([noSlug])
    expect(out).toBe('ACTIVE\t-\t2026-08-31\t-\tQ3 Launch')
  })

  // LUM-714: archived is a first-class STATE now, so it reads in the state
  // column rather than as a suffix bolted onto the name.
  it('renders an archived milestone in the state column', () => {
    const out = formatMilestoneList([
      row({ archivedAt: '2026-06-02T00:00:00.000Z' }),
    ])
    expect(out.split('\t')[0]).toBe('ARCHIVED')
    expect(out).toContain('Q3 Launch')
  })
})
