/**
 * @jest-environment node
 *
 * LUM-832 — the scan's failure rate and hunt coverage as an internal number,
 * read off the stored rows (it used to exist only as a yellow line in the
 * customer's panel).
 */
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: { findForReliability: jest.fn() },
}))

import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import {
  formatScanReliability,
  summarizeScanReliability,
  type ReliabilityScanRow,
} from '@/ee/security/security-scan/reliability'
import {
  RELIABILITY_DEFAULT_WINDOW_MS,
  securityScanReliabilityService,
} from '@/ee/security/services/security-scan-reliability.service'
import { parseReliabilityArgs } from '@/scripts/security/scan-reliability'

const findForReliability =
  prSecurityScanRepository.findForReliability as jest.Mock

function row(over: Partial<ReliabilityScanRow>): ReliabilityScanRow {
  return {
    status: 'CLEAN',
    stages: { secrets: 'RAN', judge: 'RAN', hunt: 'RAN' },
    partial: false,
    partialCauses: [],
    huntAudit: { diff: { oversized: false } },
    ...over,
  }
}

const ROWS: ReliabilityScanRow[] = [
  // Checked, whole-diff hunt.
  row({}),
  // Our fault: a hunt task never terminated.
  row({
    stages: { secrets: 'RAN', judge: 'RAN', hunt: 'PARTIAL' },
    partial: true,
    partialCauses: ['HUNT_INCOMPLETE'],
  }),
  // Our fault: stage A crashed.
  row({ status: 'FAILED', stages: { secrets: 'RAN' }, huntAudit: null }),
  // Coverage owed only: oversized hunt + judge tier.
  row({
    stages: { secrets: 'RAN', judge: 'PARTIAL', hunt: 'PARTIAL' },
    partial: true,
    partialCauses: ['HUNT_OVERSIZED', 'JUDGE_TRUNCATED'],
    huntAudit: { diff: { oversized: true } },
  }),
  // Both: the fault wins the bucket.
  row({
    partial: true,
    partialCauses: ['JUDGE_TRUNCATED', 'GRAPH_READ_FAILED'],
  }),
  // Legacy: partial with no cause.
  row({ partial: true }),
  // Still running: excluded from the rate.
  row({ stages: { secrets: 'RAN', hunt: 'PENDING' }, huntAudit: null }),
]

describe('reliability read-out separates our-fault rate from coverage owed', () => {
  beforeEach(() => jest.clearAllMocks())

  it('counts our-fault scans apart from coverage-owed ones, over settled scans only', () => {
    const r = summarizeScanReliability(ROWS)
    expect(r.scans).toBe(7)
    expect(r.byCoverage).toEqual({
      IN_PROGRESS: 1,
      CHECKED: 1,
      UNFINISHED: 5,
      TURNED_OFF: 0,
    })
    expect(r.ourFault).toBe(3)
    expect(r.coverageOwedOnly).toBe(1)
    expect(r.unattributed).toBe(1)
    expect(r.ourFaultRate).toBeCloseTo(3 / 6)
    expect(r.causes).toEqual({
      HUNT_INCOMPLETE: 1,
      HUNT_OVERSIZED: 1,
      JUDGE_TRUNCATED: 2,
      GRAPH_READ_FAILED: 1,
    })
  })

  it('reads hunt coverage as the share of hunted scans sized for the whole diff', () => {
    const r = summarizeScanReliability(ROWS)
    // Hunted = RAN or PARTIAL: rows 1, 2, 4, 5, 6 → 5; one was oversized.
    expect(r.hunt).toEqual({ hunted: 5, wholeDiff: 4, coverageRatio: 4 / 5 })
  })

  it('an empty window has no rate rather than a rate of zero', () => {
    const r = summarizeScanReliability([])
    expect(r.ourFaultRate).toBeNull()
    expect(r.hunt.coverageRatio).toBeNull()
  })

  it('the service reads the default seven-day window from the repository', async () => {
    findForReliability.mockResolvedValue(ROWS)
    const until = new Date('2026-09-25T00:00:00Z')
    const r = await securityScanReliabilityService.summarize({ until })
    expect(findForReliability).toHaveBeenCalledWith(
      new Date(until.getTime() - RELIABILITY_DEFAULT_WINDOW_MS),
      until
    )
    expect(r.ourFault).toBe(3)
    expect(r.until).toBe('2026-09-25T00:00:00.000Z')
  })

  it('prints one plain block with the rate, the coverage and each cause with its class', () => {
    const text = formatScanReliability(summarizeScanReliability(ROWS))
    expect(text).toContain('our fault 3 (50.0% of settled)')
    expect(text).toContain('hunt coverage 4/5 whole-diff (80.0%)')
    expect(text).toContain('GRAPH_READ_FAILED 1 (OUR_FAULT)')
    expect(text).toContain('JUDGE_TRUNCATED 2 (COVERAGE_OWED)')
  })

  it('the ops script parses its window and rejects a bad date', () => {
    expect(
      parseReliabilityArgs(['--since', '2026-09-18', '--until', '2026-09-25'])
    ).toEqual({
      since: new Date('2026-09-18'),
      until: new Date('2026-09-25'),
    })
    expect(parseReliabilityArgs([])).toEqual({})
    expect(() => parseReliabilityArgs(['--since', 'nope'])).toThrow(
      /not a date/
    )
  })
})
