/**
 * @jest-environment node
 */
import {
  dedupeTaskRefs,
  partitionMembership,
  formatBatchSummary,
  type BatchOutcome,
} from '@/cli/src/lib/milestone-batch'

describe('dedupeTaskRefs', () => {
  it('preserves order and drops duplicates case-insensitively', () => {
    expect(dedupeTaskRefs(['LUM-1', 'LUM-2', 'lum-1'])).toEqual([
      'LUM-1',
      'LUM-2',
    ])
  })

  it('trims whitespace and drops empties', () => {
    expect(dedupeTaskRefs([' LUM-1 ', '', '   ', 'LUM-2'])).toEqual([
      'LUM-1',
      'LUM-2',
    ])
  })

  it('keeps the first original spelling of a duplicate', () => {
    expect(dedupeTaskRefs(['LUM-7', 'lum-7'])).toEqual(['LUM-7'])
  })

  it('returns an empty array for no refs', () => {
    expect(dedupeTaskRefs([])).toEqual([])
  })
})

describe('partitionMembership', () => {
  const milestoneTasks = [
    { id: 'task-aaa', number: 1, teamIdentifier: 'LUM' },
    { id: 'task-bbb', number: 42, teamIdentifier: 'LUM' },
  ]

  it('matches by LUM-N identifier case-insensitively', () => {
    const { present, absent } = partitionMembership(
      ['LUM-1', 'lum-42', 'LUM-99'],
      milestoneTasks
    )
    expect(present).toEqual(['LUM-1', 'lum-42'])
    expect(absent).toEqual(['LUM-99'])
  })

  it('matches by task id (UUID/cuid)', () => {
    const { present, absent } = partitionMembership(
      ['task-aaa', 'task-zzz'],
      milestoneTasks
    )
    expect(present).toEqual(['task-aaa'])
    expect(absent).toEqual(['task-zzz'])
  })

  it('treats everything as absent for an empty milestone', () => {
    const { present, absent } = partitionMembership(['LUM-1'], [])
    expect(present).toEqual([])
    expect(absent).toEqual(['LUM-1'])
  })
})

describe('formatBatchSummary', () => {
  it('renders an added header with per-task check lines', () => {
    const outcomes: BatchOutcome[] = [
      { task: 'LUM-1', status: 'ok' },
      { task: 'LUM-2', status: 'ok' },
    ]
    const out = formatBatchSummary({
      milestoneName: 'Q3 Launch',
      verb: 'added',
      outcomes,
    })
    expect(out).toContain('Q3 Launch: 2 added')
    expect(out).toContain('LUM-1')
    expect(out).toContain('LUM-2')
  })

  it('counts skipped and failed separately and shows their details', () => {
    const outcomes: BatchOutcome[] = [
      { task: 'LUM-1', status: 'ok' },
      { task: 'LUM-5', status: 'skip', detail: 'not in this milestone' },
      { task: 'LUM-3', status: 'fail', detail: 'task LUM-3 not found' },
    ]
    const out = formatBatchSummary({
      milestoneName: 'Q3 Launch',
      verb: 'removed',
      outcomes,
    })
    expect(out).toContain('1 removed')
    expect(out).toContain('1 skipped')
    expect(out).toContain('1 failed')
    expect(out).toContain('not in this milestone')
    expect(out).toContain('task LUM-3 not found')
  })

  it('omits zero categories from the header', () => {
    const out = formatBatchSummary({
      milestoneName: 'Q3',
      verb: 'added',
      outcomes: [{ task: 'LUM-1', status: 'ok' }],
    })
    expect(out).toContain('1 added')
    expect(out).not.toContain('skipped')
    expect(out).not.toContain('failed')
  })

  it('sanitizes the milestone name and detail text', () => {
    const out = formatBatchSummary({
      milestoneName: 'Evil\x1b[31mName',
      verb: 'added',
      outcomes: [{ task: 'LUM-1', status: 'fail', detail: 'bad\x1b[0mreason' }],
    })
    expect(out).not.toMatch(/\x1b/)
  })
})
