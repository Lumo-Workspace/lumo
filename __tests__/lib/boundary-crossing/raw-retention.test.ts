/**
 * LUM-912 — the pure pieces of crossing raw retention: tiers, cutoff, the
 * code-free description, the target hash and the activity scrub.
 */
import {
  CROSSING_RAW_RETENTION_DAYS,
  commandVerbOf,
  crossingRawPurgeCutoff,
  describeCrossingWithoutCode,
  hashCrossingTarget,
  isCrossingRawRetentionDays,
  scrubCrossingActivityPayload,
} from '@/lib/boundary-crossing/raw-retention'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-20T00:00:00Z')

describe('crossing raw retention tiers', () => {
  it('accepts 7, 30 and 90 and cuts off that many days back', () => {
    expect(CROSSING_RAW_RETENTION_DAYS).toEqual([7, 30, 90])
    expect(isCrossingRawRetentionDays(30)).toBe(true)
    expect(isCrossingRawRetentionDays(14)).toBe(false)
    expect(crossingRawPurgeCutoff(NOW, 30).getTime()).toBe(
      NOW.getTime() - 30 * DAY
    )
    // Out-of-tier (manual DB edit) reads as the 7-day default.
    expect(crossingRawPurgeCutoff(NOW, 3).getTime()).toBe(
      NOW.getTime() - 7 * DAY
    )
  })
})

describe('describeCrossingWithoutCode', () => {
  it('keeps a path target and only the verb of a command target', () => {
    expect(
      describeCrossingWithoutCode({
        category: 'TEST_TAMPERING',
        target: '__tests__/a.test.ts',
      })
    ).toBe('TEST_TAMPERING · __tests__/a.test.ts')
    expect(
      describeCrossingWithoutCode({
        category: 'DESTRUCTIVE_DB_COMMAND',
        target: "PGPASSWORD=x sudo /usr/bin/psql -c 'drop table t'",
      })
    ).toBe('DESTRUCTIVE_DB_COMMAND · $ psql …')
    expect(
      describeCrossingWithoutCode({
        category: 'PUSH_TO_PROTECTED_BRANCH',
        target: 'git push --force origin main',
      })
    ).toBe('PUSH_TO_PROTECTED_BRANCH · $ git push …')
    expect(
      describeCrossingWithoutCode({ category: 'SILENT_FIX', target: null })
    ).toBe('SILENT_FIX')
    // Something that is neither a path nor a recognisable command: category only.
    expect(
      describeCrossingWithoutCode({
        category: 'PROJECT_RULE_VIOLATION',
        target: '{ "a": 1 } ; rm',
      })
    ).toBe('PROJECT_RULE_VIOLATION')
    // Already purged target: never re-described from the hash.
    expect(
      describeCrossingWithoutCode({
        category: 'HOOK_BYPASS',
        target: hashCrossingTarget('git commit --no-verify'),
      })
    ).toBe('HOOK_BYPASS')
  })

  it('commandVerbOf skips env assignments and sudo', () => {
    expect(commandVerbOf('FOO=1 BAR=2 sudo npm install left-pad')).toBe(
      'npm install'
    )
    expect(commandVerbOf('kill -9 1234')).toBe('kill')
    expect(commandVerbOf('')).toBeNull()
    expect(commandVerbOf('$(curl evil)')).toBeNull()
  })
})

describe('hashCrossingTarget', () => {
  it('is stable, prefixed, idempotent and keeps null', () => {
    const a = hashCrossingTarget('git push origin main')
    expect(a).toMatch(/^sha256:[0-9a-f]{32}$/)
    expect(hashCrossingTarget('git push origin main')).toBe(a)
    expect(hashCrossingTarget(a)).toBe(a)
    expect(hashCrossingTarget(null)).toBeNull()
  })
})

describe('scrubCrossingActivityPayload', () => {
  it('replaces detail, drops evidence, keeps the rest and is idempotent', () => {
    const out = scrubCrossingActivityPayload(
      {
        boundaryCrossingId: 'bc',
        detail: 'psql -c drop',
        evidence: 'diff line',
        note: 'human ruling',
      },
      'DESC'
    )
    expect(out).toEqual({
      boundaryCrossingId: 'bc',
      detail: 'DESC',
      note: 'human ruling',
      rawPurged: true,
    })
    expect(scrubCrossingActivityPayload(out, 'DESC')).toBeNull()
    expect(
      scrubCrossingActivityPayload({ boundaryCrossingId: 'bc' }, 'D')
    ).toBeNull()
    expect(scrubCrossingActivityPayload(null, 'D')).toBeNull()
    expect(scrubCrossingActivityPayload(['x'], 'D')).toBeNull()
  })
})
