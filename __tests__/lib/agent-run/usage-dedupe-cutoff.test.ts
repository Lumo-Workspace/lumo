import {
  USAGE_DEDUPE_CUTOFF,
  anyStartedBeforeUsageDedupe,
  startedBeforeUsageDedupe,
} from '@/lib/agent-run/usage-dedupe-cutoff'

describe('startedBeforeUsageDedupe', () => {
  it('exposes the cutoff constant', () => {
    expect(USAGE_DEDUPE_CUTOFF).toBe('2026-10-03T07:13:35Z')
  })

  it('is true just before the cutoff (string)', () => {
    expect(startedBeforeUsageDedupe('2026-10-03T07:13:34Z')).toBe(true)
  })

  it('is false exactly at the cutoff', () => {
    expect(startedBeforeUsageDedupe('2026-10-03T07:13:35Z')).toBe(false)
    expect(startedBeforeUsageDedupe(new Date('2026-10-03T07:13:35Z'))).toBe(
      false
    )
  })

  it('is false after the cutoff and true before it for Date inputs', () => {
    expect(startedBeforeUsageDedupe('2026-10-03T07:13:36Z')).toBe(false)
    expect(startedBeforeUsageDedupe(new Date('2026-10-03T07:13:36Z'))).toBe(
      false
    )
    expect(startedBeforeUsageDedupe(new Date('2026-09-01T00:00:00Z'))).toBe(
      true
    )
  })

  it('is false for an unparseable timestamp', () => {
    expect(startedBeforeUsageDedupe('not-a-date')).toBe(false)
    expect(startedBeforeUsageDedupe(undefined as unknown as string)).toBe(false)
  })
})

describe('anyStartedBeforeUsageDedupe', () => {
  it('is true when any run started before the cutoff', () => {
    expect(
      anyStartedBeforeUsageDedupe([
        { startedAt: '2026-10-04T00:00:00Z' },
        { startedAt: '2026-10-01T00:00:00Z' },
      ])
    ).toBe(true)
  })

  it('is false when all runs are after the cutoff or there are none', () => {
    expect(
      anyStartedBeforeUsageDedupe([{ startedAt: '2026-10-04T00:00:00Z' }])
    ).toBe(false)
    expect(anyStartedBeforeUsageDedupe([])).toBe(false)
  })
})
