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
    version: 2,
    task: {
      id: 't1',
      identifier: 'LUM-735',
      title: 'external oracle',
      status: 'IN_PROGRESS',
    },
    struggleTrail: { pullRequests: [], reopens: [] },
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
      [
        '  PR #945 · scan CLEAN',
        '    Secrets:    checked',
        '    Code scan:  checked (2 external findings)',
        '    AI review:  checked',
      ].join('\n')
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
      [
        '  PR #1 · scan FINDINGS',
        '    Secrets:    checked',
        '    Code scan:  checked (1 external finding)',
      ].join('\n')
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
    expect(zero).toContain(
      [
        '  PR #2 · scan CLEAN',
        '    Secrets:    checked',
        '    Code scan:  checked',
      ].join('\n')
    )
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
    expect(out).toContain(
      [
        '  PR #7 · scan FAILED',
        '    Secrets:    checked',
        "    AI review:  ⚠ didn't finish",
      ].join('\n')
    )
    expect(out).not.toContain('Code scan')
  })

  it('appends the owned unfinished note (not " · partial") when the scan is partial', () => {
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
    expect(out).toContain(
      [
        '  PR #3 · scan FINDINGS',
        '    Secrets:  checked',
        "    Note:     part of this scan hasn't finished on our side — not counted as checked",
      ].join('\n')
    )
    expect(out).not.toContain('partial')
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
    // LUM-1091: the reason rides on the Code scan row it explains; too long
    // to sit beside its label, it wraps one level under it.
    expect(out).toContain(
      [
        '  PR #4 · scan FAILED',
        '    Secrets:    checked',
        '    Code scan:',
        "      ⚠ didn't finish —",
        '      …xxxx',
      ].join('\n')
    )
    expect(out).toMatch(/^ {4}Note: +part of this scan hasn't finished/m)
    // Tail-truncated to 200 chars, prefixed with the ellipsis marker used by
    // the file's existing `tail()` helper.
    const unwrapped = out.replace(/\n +/g, '')
    expect(unwrapped).toMatch(/…x{190,200}/)
    expect(unwrapped).not.toContain('x'.repeat(201))
    expect(out).not.toContain('x'.repeat(500))
  })

  it('LUM-756: prints only the text after the "external: " prefix — the prefix is provenance, not content', () => {
    const out = formatTaskStatus(
      baseResponse({
        securityFindings: {
          open: 0,
          blocking: 0,
          unconfirmedPrs: [],
          scans: [
            {
              prNumber: 6,
              status: 'FAILED',
              stages: { secrets: 'RAN', external: 'FAILED' },
              partial: false,
              error: 'external: gitleaks exit 2',
              externalFindings: 0,
              openFindings: 0,
            },
          ],
        },
      })
    )
    expect(out).toContain(
      [
        '  PR #6 · scan FAILED',
        '    Secrets:    checked',
        "    Code scan:  ⚠ didn't finish — gitleaks exit 2",
        "    Note:       part of this scan hasn't finished on our side — not counted as checked",
      ].join('\n')
    )
    expect(out).not.toContain('— external: gitleaks')
  })

  it('LUM-756: never prints an unprefixed error (stage A raw crash text) as the scanner reason', () => {
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
              stages: { secrets: 'RAN', external: 'FAILED' },
              partial: false,
              error: 'ENOTFOUND api.github.com (raw stage A crash text)',
              externalFindings: 0,
              openFindings: 0,
            },
          ],
        },
      })
    )
    expect(out).toMatch(/^ {4}Code scan: +⚠ didn't finish$/m)
    expect(out).not.toContain('not counted as checked — ')
    expect(out).not.toContain('ENOTFOUND')
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
    expect(out).toMatch(/^ {4}Code scan: +⚠ didn't finish$/m)
    expect(out).not.toContain('not counted as checked — ')
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
    const unconfirmedIdx = out.indexOf(
      "PR #99: security scan didn't finish on our side"
    )
    expect(scanIdx).toBeGreaterThan(-1)
    expect(unconfirmedIdx).toBeGreaterThan(scanIdx)
  })
})
