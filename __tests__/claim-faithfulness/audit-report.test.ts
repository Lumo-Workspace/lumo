/** @jest-environment node */
import {
  parseAuditArgs,
  summarizeVerdicts,
} from '@/scripts/audit-claim-faithfulness'
import { isFreshVerdict } from '@/lib/repositories/claim-faithfulness-verdict.repository'

describe('parseAuditArgs', () => {
  it('defaults to a live run over all tasks', () => {
    expect(parseAuditArgs([])).toEqual({
      dryRun: false,
      resume: false,
      task: null,
      since: null,
      limit: null,
    })
  })
  it('parses flags', () => {
    expect(
      parseAuditArgs([
        '--dry-run',
        '--resume',
        '--task',
        'LUM-5',
        '--limit',
        '10',
      ])
    ).toEqual({
      dryRun: true,
      resume: true,
      task: 'LUM-5',
      since: null,
      limit: 10,
    })
  })
})

describe('summarizeVerdicts', () => {
  it('tallies verdicts and flags prefilter candidates the judge cleared', () => {
    const s = summarizeVerdicts([
      {
        identifier: 'LUM-540',
        verdict: 'UNDERREPORT',
        prefilterSignal: 'UNDERREPORT_CANDIDATE',
      },
      {
        identifier: 'LUM-9',
        verdict: 'FAITHFUL',
        prefilterSignal: 'UNDERREPORT_CANDIDATE',
      },
      { identifier: 'LUM-3', verdict: 'FAITHFUL', prefilterSignal: null },
    ])
    expect(s.counts).toEqual({ UNDERREPORT: 1, FAITHFUL: 2 })
    expect(s.underreportCandidatesMissed).toEqual(['LUM-9'])
  })
})

describe('isFreshVerdict', () => {
  const older = new Date('2026-01-01')
  const newer = new Date('2026-02-01')
  it('is fresh when judged at or after the current claim watermark', () => {
    expect(isFreshVerdict(newer, older)).toBe(true)
    expect(isFreshVerdict(older, older)).toBe(true)
  })
  it('is stale when the claim snapshot is newer than the verdict', () => {
    expect(isFreshVerdict(older, newer)).toBe(false)
  })
  it('treats a null claim watermark as nothing-newer-to-judge (fresh)', () => {
    expect(isFreshVerdict(older, null)).toBe(true)
  })
  it('treats a null verdict watermark as stale (pre-tracking)', () => {
    expect(isFreshVerdict(null, older)).toBe(false)
  })
})
