import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '../../src/commands/task-status'

/** A minimal all-pass status payload — one MACHINE criterion, machine-verified,
 *  one clean round, an empty struggle trail. Override per test. */
function baseResponse(
  over: Partial<TaskStatusResponse> = {}
): TaskStatusResponse {
  return {
    version: 1,
    task: {
      id: 't1',
      identifier: 'LUM-561',
      title: 'demo',
      status: 'IN_REVIEW',
    },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria: [
      {
        id: 'c-1',
        statement: 'does the thing',
        verifierType: 'MACHINE',
        checkpointer: 'npx jest x',
        evidenceRequired: false,
        judgeSteps: null,
        source: 'AGENT_DRAFT',
        addedAtRound: 0,
        verdictStale: false,
        checkMismatch: false,
        machinePassed: true,
        latestVerdict: {
          round: 1,
          verdict: 'PASS',
          evidencePointer: 'cmd:npx jest x#exit=0',
          rejectionReason: null,
          rejectionReasonEnum: null,
          recordedAt: '2026-06-02T10:00:00Z',
        },
        sendBackResolution: null,
      },
    ],
    machineVerification: { total: 1, machineVerified: 1, humanOverridden: 0 },
    struggleTrail: { reworkRounds: [], sendBacks: [], followUps: [] },
    verificationHistory: [
      { round: 1, recordedAt: '2026-06-02T10:00:00Z', passed: 1, failed: 0 },
    ],
    lastRoundFailures: [],
    nextActions: [],
    ...over,
  }
}

describe('task status struggle/rework/outstanding section', () => {
  it('LUM-561 always renders the section even on a clean all-pass task', () => {
    const out = formatTaskStatus(baseResponse())
    expect(out).toMatch(/Struggle \/ rework \/ outstanding/i)
  })

  it('LUM-561 empty trail after verification cites its evidence basis, not a bare nothing-outstanding', () => {
    const out = formatTaskStatus(baseResponse())
    expect(out).toMatch(/Struggle \/ rework \/ outstanding/i)
    // The basis is explicit: rounds run + 0 FAIL + no send-backs/follow-ups.
    expect(out).toMatch(/1 verification round/i)
    expect(out).toMatch(/0 FAIL/i)
    // It must not read as the mum-and-deaf "Nothing outstanding".
    expect(out).not.toMatch(/^\s*Nothing outstanding\.?\s*$/im)
  })

  it('LUM-561 empty trail with no verification states it cannot confirm there were no difficulties', () => {
    const out = formatTaskStatus(
      baseResponse({
        currentRound: 0,
        verificationHistory: [],
        criteria: [
          {
            ...baseResponse().criteria[0]!,
            machinePassed: false,
            latestVerdict: null,
          },
        ],
        machineVerification: {
          total: 1,
          machineVerified: 0,
          humanOverridden: 0,
        },
        nextActions: [
          {
            criterionId: 'c-1',
            statement: 'does the thing',
            verifierType: 'MACHINE',
            checkpointer: 'npx jest x',
            judgeSteps: null,
            source: 'AGENT_DRAFT',
            addedAtRound: 0,
            rejectionReason: null,
          },
        ],
      })
    )
    expect(out).toMatch(/Struggle \/ rework \/ outstanding/i)
    expect(out).toMatch(/no verification has run/i)
    expect(out).toMatch(/cannot confirm/i)
  })

  it('LUM-561 populated trail enumerates rework rounds, send-backs and follow-ups', () => {
    const out = formatTaskStatus(
      baseResponse({
        currentRound: 2,
        struggleTrail: {
          reworkRounds: [{ round: 1, failed: 2 }],
          sendBacks: [
            {
              criterionId: 'c-x',
              statement: 'the bounced requirement',
              status: 'resolved',
              failedAtRound: 1,
              resolvedAtRound: 2,
            },
            {
              criterionId: 'c-y',
              statement: 'the still-open requirement',
              status: 'open',
              failedAtRound: 2,
              resolvedAtRound: null,
            },
          ],
          followUps: [
            { criterionId: 'c-z', statement: 'leftover refactor', round: 2 },
          ],
        },
      })
    )
    // rework round with its FAIL count
    expect(out).toMatch(/round 1.*2 FAIL/i)
    // both send-backs, with state
    expect(out).toMatch(/the bounced requirement/)
    expect(out).toMatch(/resolved/)
    expect(out).toMatch(/the still-open requirement/)
    expect(out).toMatch(/open/)
    // the leftover follow-up
    expect(out).toMatch(/leftover refactor/)
  })
})
