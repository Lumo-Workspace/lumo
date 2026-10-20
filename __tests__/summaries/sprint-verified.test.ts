// isTaskVerified / summarizeTestTrust are covered in
// __tests__/lib/summaries/sprint-attention.test.ts (LUM-1278); this file only
// adds what LUM-1280 needs on top.
import {
  isTaskVerified,
  summarizeTestTrust,
  verifiedAt,
} from '@/lib/summaries/sprint-verified'

const d = (s: string) => new Date(s)

describe('verifiedAt', () => {
  it('is the later of the DONE move and the newest latest run', () => {
    const latestRunAts = [d('2026-10-04T00:00:00Z'), d('2026-10-06T00:00:00Z')]
    expect(
      verifiedAt({
        verified: true,
        doneAt: d('2026-10-05T00:00:00Z'),
        latestRunAts,
      })
    ).toEqual(d('2026-10-06T00:00:00Z'))
    expect(
      verifiedAt({
        verified: true,
        doneAt: d('2026-10-09T00:00:00Z'),
        latestRunAts,
      })
    ).toEqual(d('2026-10-09T00:00:00Z'))
  })

  it('is null when not verified or no instant is known', () => {
    expect(
      verifiedAt({
        verified: false,
        doneAt: d('2026-10-05T00:00:00Z'),
        latestRunAts: [],
      })
    ).toBeNull()
    expect(
      verifiedAt({ verified: true, doneAt: null, latestRunAts: [null] })
    ).toBeNull()
  })
})

describe('never-run case', () => {
  it('counts toward total but not fresh, so the task is not verified', () => {
    const tests = summarizeTestTrust(
      [{ requiredEnvironment: null, latestRun: null }],
      new Map()
    )
    expect(tests).toEqual({ total: 1, passing: 0, fresh: 0 })
    expect(isTaskVerified({ status: 'DONE', gate: 'clear', tests })).toBe(false)
  })
})
