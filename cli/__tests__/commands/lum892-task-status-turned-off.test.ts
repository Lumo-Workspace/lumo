import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '../../src/commands/task-status'
import {
  formatScanStatus,
  formatTurnedOffLines,
} from '../../src/lib/scan-format'

/**
 * LUM-892 — `lumo task status` for a layer the customer turned off in the
 * workspace settings, and for a workspace that turned scanning off: never a
 * bare CLEAN, never "didn't finish on our side".
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

const scanLine = (stages: Record<string, string>) =>
  formatTaskStatus(
    baseResponse({
      securityFindings: {
        open: 0,
        blocking: 0,
        unconfirmedPrs: [],
        scans: [
          {
            prNumber: 945,
            status: 'CLEAN',
            stages,
            partial: false,
            error: null,
            externalFindings: 0,
            openFindings: 0,
          },
        ],
      },
    })
  )

describe('LUM-892 turned-off layer in lumo task status', () => {
  it('LUM-892 turned-off layer: a clean scan with AI review off is not printed as CLEAN and says it was turned off in settings', () => {
    const out = scanLine({
      secrets: 'RAN',
      external: 'RAN',
      judge: 'DISABLED',
      hunt: 'DISABLED',
    })
    expect(out).toContain(
      [
        '  PR #945 · scan no findings in the checks that ran',
        '    Secrets:        checked',
        '    Code scan:      checked',
        '    AI review:      off in workspace settings',
        '    Exploit paths:  off in workspace settings',
      ].join('\n')
    )
    expect(out.replace(/\s+/g, ' ')).toContain(
      "Turned off in this workspace's settings: AI review, Exploit paths. Those checks did not look at this PR."
    )
    expect(out).toMatch(/^ {4}Turned off in this workspace's settings/m)
    expect(out).not.toContain('scan CLEAN')
    expect(out).not.toContain("hasn't finished on our side")
  })

  it('LUM-892 turned-off layer: control, every layer run still prints CLEAN', () => {
    const out = scanLine({ secrets: 'RAN', external: 'RAN', judge: 'RAN' })
    expect(out).toContain('  PR #945 · scan CLEAN\n')
    expect(out).not.toContain('Turned off in')
    expect(formatTurnedOffLines({ judge: 'RAN' })).toEqual([])
    expect(formatScanStatus('FINDINGS', { judge: 'DISABLED' })).toBe('FINDINGS')
  })

  it('LUM-892 scanning turned off: an open PR reads as not checked because scanning is off', () => {
    const out = formatTaskStatus(
      baseResponse({
        securityFindings: {
          open: 0,
          blocking: 0,
          unconfirmedPrs: [{ number: 945, reason: 'SCANNING_OFF' }],
          scans: [],
        },
      })
    )
    expect(out.replace(/\s+/g, ' ')).toContain(
      "⚠ PR #945: security scanning is turned off in this workspace's settings — could not confirm it is clean."
    )
  })
})
