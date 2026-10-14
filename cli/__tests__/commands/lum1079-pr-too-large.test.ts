import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '../../src/commands/task-status'
import { formatPrScan, type PrScanPayload } from '../../src/commands/pr-scan'
import {
  formatScanLayerTail,
  formatScanStatus,
  formatSizeCapLines,
} from '../../src/lib/scan-format'

/**
 * LUM-1079 — `lumo task status` and `lumo pr scan` for a PR too large to
 * scan: the reason and what to do, never "didn't finish on our side", never
 * CLEAN / checked. A real fault of ours keeps the owned wording.
 */
const SKIPPED = {
  secrets: 'SKIPPED',
  external: 'SKIPPED',
  supplyChain: 'SKIPPED',
  judge: 'SKIPPED',
  hunt: 'SKIPPED',
}
const TOO_LARGE = {
  reason: 'FILE_LIMIT' as const,
  changedFiles: 504,
  capFiles: 300,
}

function statusResponse(
  scan: Record<string, unknown>,
  reason: 'FAILED' | 'TOO_LARGE'
): TaskStatusResponse {
  return {
    version: 2,
    task: {
      id: 't1',
      identifier: 'LUM-1079',
      title: 'scan',
      status: 'IN_PROGRESS',
    },
    struggleTrail: { pullRequests: [], reopens: [] },
    nextActions: [],
    securityFindings: {
      open: 0,
      blocking: 0,
      unconfirmedPrs: [{ number: 1384, reason }],
      scans: [
        {
          prNumber: 1384,
          status: 'FAILED',
          partial: true,
          error: null,
          externalFindings: 0,
          openFindings: 0,
          ...scan,
        } as never,
      ],
    },
  } as TaskStatusResponse
}

describe('LUM-1079 lumo task status', () => {
  it('a PR too large to scan says why and what to do, never our unfinished note', () => {
    const out = formatTaskStatus(
      statusResponse(
        {
          stages: SKIPPED,
          partialCauses: ['PR_TOO_LARGE'],
          prTooLarge: TOO_LARGE,
        },
        'TOO_LARGE'
      )
    )
    const flat = out.replace(/\s+/g, ' ')
    expect(out).toContain('PR #1384 · scan not scanned — PR too large')
    expect(flat).toContain('This PR changes 504 files')
    expect(flat).toContain('split it into smaller PRs or narrow its scope')
    expect(flat).toContain('PR #1384: the PR is too large to scan')
    expect(flat).not.toContain("hasn't finished on our side")
    expect(flat).not.toContain("didn't finish on our side")
    expect(out).not.toMatch(/scan CLEAN|: +checked/)
  })

  it('a real fault of ours still reads as unfinished on our side', () => {
    const out = formatTaskStatus(
      statusResponse(
        { stages: { secrets: 'RAN', hunt: 'FAILED' }, partialCauses: [] },
        'FAILED'
      )
    )
    expect(out).toContain('scan FAILED')
    expect(out).toContain("hasn't finished on our side")
    expect(out).toContain("security scan didn't finish on our side")
    expect(out).not.toContain('too large')
  })
})

describe('LUM-1079 lumo pr scan', () => {
  const payload = (scan: Record<string, unknown>): PrScanPayload => ({
    version: 1,
    pullRequest: {
      repo: 'o/r',
      number: 1384,
      title: 'big',
      url: 'https://github.com/o/r/pull/1384',
      state: 'open',
      task: null,
    },
    all: false,
    scans: [
      {
        id: 's1',
        headSha: 'abcdef1234',
        status: 'FAILED',
        trigger: 'PR_EVENT',
        judgeStatus: null,
        truncated: false,
        stages: SKIPPED,
        partial: true,
        externalFailureReason: null,
        startedAt: '2026-10-10T00:00:00Z',
        finishedAt: '2026-10-10T00:00:01Z',
        tokenSpent: null,
        counts: {
          findings: 0,
          open: 0,
          blocking: 0,
          dispositioned: 0,
          persisting: 0,
          externalFindings: 0,
          dependencyFindings: 0,
        },
        queueExits: {},
        findings: [],
        hunt: null,
        ...scan,
      },
    ],
  })

  it('a PR too large to scan: status, reason, advice; no "none on this scan"', () => {
    const out = formatPrScan(
      payload({ partialCauses: ['PR_TOO_LARGE'], prTooLarge: TOO_LARGE })
    )
    const flat = out.replace(/\s+/g, ' ')
    expect(out).toContain('Scan abcdef1 · not scanned — PR too large')
    expect(flat).toContain('This PR changes 504 files')
    expect(flat).toContain('Findings: none — nothing in this PR was scanned')
    expect(flat).not.toContain("hasn't finished on our side")
    expect(flat).not.toContain('Findings: none on this scan')
    expect(out).not.toMatch(/CLEAN|: +checked/)
  })

  it('GitHub refused the diff: says so, with the file count when known', () => {
    const out = formatPrScan(
      payload({
        partialCauses: ['PR_TOO_LARGE'],
        prTooLarge: {
          reason: 'DIFF_REFUSED',
          changedFiles: 120,
          capFiles: 300,
        },
      })
    )
    expect(out.replace(/\s+/g, ' ')).toContain(
      "GitHub would not return this PR's diff because it is too large (120 files changed)"
    )
  })

  it('a crashed scan of ours keeps the owned note', () => {
    const out = formatPrScan(
      payload({ stages: {}, partial: false, partialCauses: [] })
    )
    expect(out).toContain('Scan abcdef1 · FAILED')
    expect(out).toContain("hasn't finished on our side")
  })
})

describe('LUM-1079 scan-format helpers', () => {
  it('formatScanStatus: too large wins over FAILED / CLEAN', () => {
    expect(formatScanStatus('FAILED', SKIPPED, false, true)).toBe(
      'not scanned — PR too large'
    )
    expect(formatScanStatus('FAILED', {}, false, false)).toBe('FAILED')
  })

  it('formatSizeCapLines puts the too-large line first', () => {
    expect(formatSizeCapLines({ prTooLarge: TOO_LARGE })[0]).toMatch(
      /^This PR changes 504 files/
    )
    expect(formatSizeCapLines({})).toEqual([])
  })

  it('formatScanLayerTail never adds the owned note for a too-large scan', () => {
    const tail = formatScanLayerTail({
      status: 'FAILED',
      stages: SKIPPED,
      partial: true,
      partialCauses: ['PR_TOO_LARGE'],
      prTooLarge: TOO_LARGE,
      externalFindings: 0,
      externalFailureReason: null,
    })
    expect(tail).not.toContain("hasn't finished")
    expect(tail).toContain('Secrets: skipped')
  })
})
