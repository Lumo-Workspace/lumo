import {
  USAGE_DEDUPE_CUTOFF,
  anyRunOverstated,
  runOverstated,
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

describe('runOverstated / anyRunOverstated', () => {
  const pre = '2026-10-01T10:00:00Z'
  const post = '2026-10-04T10:00:00Z'
  const resyncedAt = '2026-10-05T00:00:00Z'

  it('is true for a pre-cutoff run that was not resynced', () => {
    expect(runOverstated({ startedAt: pre, usageResyncedAt: null })).toBe(true)
    expect(runOverstated({ startedAt: pre })).toBe(true)
  })

  it('is false for a pre-cutoff run that was resynced', () => {
    expect(runOverstated({ startedAt: pre, usageResyncedAt: resyncedAt })).toBe(
      false
    )
  })

  it('is false for a post-cutoff run', () => {
    expect(runOverstated({ startedAt: post, usageResyncedAt: null })).toBe(false)
  })

  it('anyRunOverstated ignores resynced runs', () => {
    expect(
      anyRunOverstated([
        { startedAt: pre, usageResyncedAt: resyncedAt },
        { startedAt: post, usageResyncedAt: null },
      ])
    ).toBe(false)
    expect(
      anyRunOverstated([
        { startedAt: pre, usageResyncedAt: resyncedAt },
        { startedAt: pre, usageResyncedAt: null },
      ])
    ).toBe(true)
    expect(anyRunOverstated([])).toBe(false)
  })
})
