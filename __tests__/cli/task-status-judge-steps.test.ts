import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '../../cli/src/commands/task-status'

function baseResponse(judgeSteps: string | null): TaskStatusResponse {
  return {
    version: 1,
    task: {
      id: 't-1',
      identifier: 'LUM-465',
      title: 'judge steps',
      status: 'IN_REVIEW',
    },
    currentRound: 0,
    maxRounds: 3,
    escalated: false,
    criteria: [
      {
        id: 'c-1',
        statement: 'the card renders steps',
        verifierType: 'HUMAN',
        checkpointer: null,
        evidenceRequired: false,
        source: 'AGENT_DRAFT',
        addedAtRound: 0,
        judgeSteps,
        verdictStale: false,
        checkMismatch: false,
        machinePassed: false,
        confirmedAt: '2026-06-01T00:00:00Z',
        latestVerdict: null,
      },
    ],
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
  }
}

describe('LUM-465 task status judgeSteps rendering', () => {
  it('formatTaskStatus renders a judge line when judgeSteps is present', () => {
    const out = formatTaskStatus(
      baseResponse('Open the tab; read the steps; pass if URLs click.')
    )
    expect(out).toMatch(/↳ judge:/)
    expect(out).toContain('Open the tab; read the steps; pass if URLs click.')
  })

  it('omits the judge line when judgeSteps is null', () => {
    const out = formatTaskStatus(baseResponse(null))
    expect(out).not.toMatch(/↳ judge:/)
  })
})
