import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '../cli/src/commands/task-status'

function base(): TaskStatusResponse {
  return {
    version: 1,
    task: {
      id: 't-1',
      identifier: 'LUM-457',
      title: 'stale',
      status: 'IN_PROGRESS',
    },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria: [],
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
  }
}

function criterion(over: Partial<TaskStatusResponse['criteria'][number]> = {}) {
  return {
    id: 'c-1',
    statement: 'route rejects bad input',
    verifierType: 'MACHINE' as const,
    checkpointer: 'npx jest x.test.ts',
    evidenceRequired: false,
    judgeSteps: null,
    source: 'AGENT_DRAFT' as const,
    addedAtRound: 0,
    verdictStale: false,
    checkMismatch: false,
    machinePassed: true,
    confirmedAt: '2026-06-01T00:00:00Z',
    latestVerdict: {
      round: 1,
      verdict: 'PASS' as const,
      evidencePointer: 'cmd:npx jest x.test.ts#exit=0',
      rejectionReason: null,
      rejectionReasonEnum: null,
      recordedAt: '2026-06-02T10:00:00Z',
    },
    ...over,
  }
}

describe('lumo task status — stale-verdict render (LUM-457)', () => {
  it('flags a stale PASS row with a pre-edit-version marker and re-run hint', () => {
    const data = base()
    data.criteria = [criterion({ verdictStale: true })]

    const out = formatTaskStatus(data)

    expect(out).toMatch(/pre-edit version/i)
    expect(out).toMatch(/lumo verify/)
  })

  it('flags a checkpointer mismatch the same way', () => {
    const data = base()
    data.criteria = [criterion({ checkMismatch: true })]

    const out = formatTaskStatus(data)

    expect(out).toMatch(/pre-edit version/i)
  })

  it('leaves a genuinely fresh PASS row unmarked', () => {
    const data = base()
    data.criteria = [criterion()]

    const out = formatTaskStatus(data)

    expect(out).not.toMatch(/pre-edit version/i)
    // The pass is still shown as a pass.
    expect(out).toMatch(/✓ PASS@r1/)
  })
})
