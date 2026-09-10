/** @jest-environment node */
// LUM-739: the per-PR scan line renders the L3 hunt layer after judge.
import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '@/cli/src/commands/task-status'

function payload(
  scans: NonNullable<TaskStatusResponse['securityFindings']>['scans']
): TaskStatusResponse {
  return {
    version: 1,
    task: {
      id: 't-1',
      identifier: 'LUM-9',
      title: 'do the thing',
      status: 'IN_PROGRESS',
    },
    currentRound: 0,
    maxRounds: 3,
    escalated: false,
    criteria: [],
    lastRoundFailures: [],
    nextActions: [],
    securityFindings: { open: 0, blocking: 0, unconfirmedPrs: [], scans },
  } as unknown as TaskStatusResponse
}

describe('LUM-739 hunt stage', () => {
  it('renders `hunt <STATE>` after judge, with the partial flag', () => {
    const out = formatTaskStatus(
      payload([
        {
          prNumber: 12,
          status: 'FINDINGS',
          stages: {
            secrets: 'RAN',
            external: 'RAN',
            judge: 'RAN',
            hunt: 'PARTIAL',
          },
          partial: true,
          error: null,
          externalFindings: 0,
          openFindings: 1,
        },
      ])
    )
    expect(out).toContain(
      'PR #12 · scan FINDINGS · secrets RAN · external RAN · judge RAN · hunt PARTIAL · partial'
    )
  })

  it('renders no hunt segment when the scan has no hunt key (older rows)', () => {
    const out = formatTaskStatus(
      payload([
        {
          prNumber: 3,
          status: 'CLEAN',
          stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
          partial: false,
          error: null,
          externalFindings: 0,
          openFindings: 0,
        },
      ])
    )
    expect(out).toContain(
      'PR #3 · scan CLEAN · secrets RAN · external RAN · judge RAN'
    )
    expect(out).not.toContain('hunt')
  })
})
