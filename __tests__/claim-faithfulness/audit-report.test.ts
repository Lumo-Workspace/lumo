/** @jest-environment node */
import {
  parseAuditArgs,
  summarizeVerdicts,
} from '@/scripts/audit-claim-faithfulness'

describe('parseAuditArgs', () => {
  it('defaults to a live run over all tasks', () => {
    expect(parseAuditArgs([])).toEqual({
      dryRun: false,
      task: null,
      since: null,
      limit: null,
    })
  })
  it('parses flags', () => {
    expect(
      parseAuditArgs(['--dry-run', '--task', 'LUM-5', '--limit', '10'])
    ).toEqual({ dryRun: true, task: 'LUM-5', since: null, limit: 10 })
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
