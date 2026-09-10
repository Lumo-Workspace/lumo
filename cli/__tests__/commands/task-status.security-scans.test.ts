import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '../../src/commands/task-status'

/**
 * LUM-735 — `lumo task status` prints one line per linked PR's latest scan
 * (stage states, external-finding count, partial flag, external failure
 * reason), fed by the new optional `securityFindings.scans` array. Follows
 * the same minimal-payload setup style as `task-status.render.test.ts`.
 */
function baseResponse(
  over: Partial<TaskStatusResponse> = {}
): TaskStatusResponse {
  return {
    version: 1,
    task: {
      id: 't1',
      identifier: 'LUM-735',
      title: 'external oracle',
      status: 'IN_PROGRESS',
    },
    currentRound: 0,
    maxRounds: 3,
    escalated: false,
    criteria: [],
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    struggleTrail: {
      reworkRounds: [],
      sendBacks: [],
      followUps: [],
      pullRequests: [],
      reopens: [],
    },
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    ...over,
  }
}

describe('lumo task status — per-PR scan lines (LUM-735)', () => {
  it('renders one line per scan with stage segments in secrets/external/judge order and the external finding count', () => {
    const out = formatTaskStatus(
      baseResponse({
        securityFindings: {
          open: 0,
          blocking: 0,
          unconfirmedPrs: [],
          scans: [
            {
              prNumber: 945,
              status: 'CLEAN',
              stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
              partial: false,
              error: null,
              externalFindings: 2,
              openFindings: 0,
            },
          ],
        },
      })
    )
    expect(out).toContain(
      '  PR #945 · scan CLEAN · secrets RAN · external RAN (2 external findings) · judge RAN'
    )
  })

  it('uses singular "finding" for exactly one external finding and omits the count suffix at zero', () => {
    const singular = formatTaskStatus(
      baseResponse({
        securityFindings: {
          open: 1,
          blocking: 0,
          unconfirmedPrs: [],
          scans: [
            {
              prNumber: 1,
              status: 'FINDINGS',
              stages: { secrets: 'RAN', external: 'RAN' },
              partial: false,
              error: null,
              externalFindings: 1,
              openFindings: 1,
            },
          ],
        },
      })
    )
    expect(singular).toContain(
      '  PR #1 · scan FINDINGS · secrets RAN · external RAN (1 external finding)'
    )

    const zero = formatTaskStatus(
      baseResponse({
        securityFindings: {
          open: 0,
          blocking: 0,
          unconfirmedPrs: [],
          scans: [
            {
              prNumber: 2,
              status: 'CLEAN',
              stages: { secrets: 'RAN', external: 'RAN' },
              partial: false,
              error: null,
              externalFindings: 0,
              openFindings: 0,
            },
          ],
        },
      })
    )
    expect(zero).toContain('  PR #2 · scan CLEAN · secrets RAN · external RAN')
    expect(zero).not.toMatch(/external finding/)
  })

  it('only renders stage segments for keys present, in secrets/external/judge order regardless of object key order', () => {
    const out = formatTaskStatus(
      baseResponse({
        securityFindings: {
          open: 0,
          blocking: 0,
          unconfirmedPrs: [],
          scans: [
            {
              prNumber: 7,
              status: 'FAILED',
              // judge present, secrets present, external absent — legacy row.
              stages: { judge: 'FAILED', secrets: 'RAN' },
              partial: false,
              error: null,
              externalFindings: 0,
              openFindings: 0,
            },
          ],
        },
      })
    )
    expect(out).toContain('  PR #7 · scan FAILED · secrets RAN · judge FAILED')
    expect(out).not.toContain('· external')
  })

  it('appends " · partial" when the scan is partial', () => {
    const out = formatTaskStatus(
      baseResponse({
        securityFindings: {
          open: 0,
          blocking: 0,
          unconfirmedPrs: [],
          scans: [
            {
              prNumber: 3,
              status: 'FINDINGS',
              stages: { secrets: 'RAN' },
              partial: true,
              error: null,
              externalFindings: 0,
              openFindings: 0,
            },
          ],
        },
      })
    )
    expect(out).toContain('  PR #3 · scan FINDINGS · secrets RAN · partial')
  })

  it('appends the sanitized, tail-200 error when stages.external is FAILED and error is set', () => {
    const longError = 'external: ' + 'x'.repeat(500)
    const out = formatTaskStatus(
      baseResponse({
        securityFindings: {
          open: 0,
          blocking: 0,
          unconfirmedPrs: [],
          scans: [
            {
              prNumber: 4,
              status: 'FAILED',
              stages: { secrets: 'RAN', external: 'FAILED' },
              partial: false,
              error: longError,
              externalFindings: 0,
              openFindings: 0,
            },
          ],
        },
      })
    )
    expect(out).toContain(
      '  PR #4 · scan FAILED · secrets RAN · external FAILED — '
    )
    // Tail-truncated to 200 chars, prefixed with the ellipsis marker used by
    // the file's existing `tail()` helper.
    expect(out).toMatch(/…x{190,200}/)
    expect(out).not.toContain('x'.repeat(500))
  })

  it('does not append an error suffix when external FAILED but error is null', () => {
    const out = formatTaskStatus(
      baseResponse({
        securityFindings: {
          open: 0,
          blocking: 0,
          unconfirmedPrs: [],
          scans: [
            {
              prNumber: 5,
              status: 'FAILED',
              stages: { secrets: 'RAN', external: 'FAILED' },
              partial: false,
              error: null,
              externalFindings: 0,
              openFindings: 0,
            },
          ],
        },
      })
    )
    expect(out).toContain(
      '  PR #5 · scan FAILED · secrets RAN · external FAILED'
    )
    expect(out).not.toContain('external FAILED —')
  })

  it('renders a line per PR, in the order scans is given', () => {
    const out = formatTaskStatus(
      baseResponse({
        securityFindings: {
          open: 0,
          blocking: 0,
          unconfirmedPrs: [],
          scans: [
            {
              prNumber: 10,
              status: 'CLEAN',
              stages: { secrets: 'RAN' },
              partial: false,
              error: null,
              externalFindings: 0,
              openFindings: 0,
            },
            {
              prNumber: 11,
              status: 'CLEAN',
              stages: { secrets: 'RAN' },
              partial: false,
              error: null,
              externalFindings: 0,
              openFindings: 0,
            },
          ],
        },
      })
    )
    const idx10 = out.indexOf('PR #10')
    const idx11 = out.indexOf('PR #11')
    expect(idx10).toBeGreaterThan(-1)
    expect(idx11).toBeGreaterThan(idx10)
  })

  it('renders nothing (no scan lines) when scans is absent — older server', () => {
    const out = formatTaskStatus(
      baseResponse({
        securityFindings: { open: 0, blocking: 0, unconfirmedPrs: [] },
      })
    )
    expect(out).not.toMatch(/scan (CLEAN|FINDINGS|FAILED|PENDING|RUNNING)/)
  })

  it('renders nothing when securityFindings itself is absent or null', () => {
    const absent = formatTaskStatus(baseResponse())
    expect(absent).not.toContain('scan CLEAN')

    const failed = formatTaskStatus(baseResponse({ securityFindings: null }))
    expect(failed).toContain('⚠ Security-scan check failed')
    expect(failed).not.toContain('scan CLEAN')
  })

  it('scan lines render before the unconfirmed-PR coverage lines', () => {
    const out = formatTaskStatus(
      baseResponse({
        securityFindings: {
          open: 0,
          blocking: 0,
          unconfirmedPrs: [{ number: 99, reason: 'FAILED' }],
          scans: [
            {
              prNumber: 1,
              status: 'CLEAN',
              stages: { secrets: 'RAN' },
              partial: false,
              error: null,
              externalFindings: 0,
              openFindings: 0,
            },
          ],
        },
      })
    )
    const scanIdx = out.indexOf('PR #1 · scan CLEAN')
    const unconfirmedIdx = out.indexOf('PR #99: security scan FAILED')
    expect(scanIdx).toBeGreaterThan(-1)
    expect(unconfirmedIdx).toBeGreaterThan(scanIdx)
  })
})
