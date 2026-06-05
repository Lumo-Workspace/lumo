import { selectRevisionsToPrune } from '@/lib/services/revision-retention'

const NOW = new Date('2026-06-05T12:00:00.000Z')
function rev(id: string, iso: string, isManual = false) {
  return { id, createdAt: new Date(iso), isManual }
}

describe('selectRevisionsToPrune', () => {
  it('keeps everything within 24h', () => {
    const revs = [
      rev('a', '2026-06-05T11:00:00Z'),
      rev('b', '2026-06-05T09:00:00Z'),
      rev('c', '2026-06-04T13:00:00Z'), // 23h ago
    ]
    expect(selectRevisionsToPrune(revs, NOW)).toEqual([])
  })

  it('keeps only the latest per day in the 1-7 day band', () => {
    const revs = [
      rev('first', '2026-05-30T08:00:00Z'), // oldest -> always kept
      rev('d1a', '2026-06-02T08:00:00Z'),
      rev('d1b', '2026-06-02T20:00:00Z'), // latest that day -> kept
      rev('d2a', '2026-06-03T09:00:00Z'), // only one that day -> kept
    ]
    // 'd1a' is the only prunable one
    expect(selectRevisionsToPrune(revs, NOW)).toEqual(['d1a'])
  })

  it('keeps only the latest per ISO week older than 7 days', () => {
    const revs = [
      rev('first', '2026-04-01T08:00:00Z'), // oldest -> kept
      rev('w1a', '2026-05-04T08:00:00Z'),
      rev('w1b', '2026-05-06T08:00:00Z'), // same ISO week, later -> kept
    ]
    expect(selectRevisionsToPrune(revs, NOW)).toEqual(['w1a'])
  })

  it('never prunes manual snapshots or the oldest revision', () => {
    const revs = [
      rev('oldest', '2026-01-01T08:00:00Z'),
      rev('manual', '2026-01-02T08:00:00Z', true),
      rev('autoOld', '2026-01-02T09:00:00Z'),
    ]
    // same ISO week as 'manual': 'autoOld' is the week survivor; 'manual'+'oldest' protected
    expect(selectRevisionsToPrune(revs, NOW)).toEqual([])
  })

  it('returns [] for empty input', () => {
    expect(selectRevisionsToPrune([], NOW)).toEqual([])
  })
})
