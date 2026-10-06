import { deriveRecordGaps } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/record-gaps'
import type { BoundaryCrossingView } from '@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings'

let crossingSeq = 0

function crossing(p: Partial<BoundaryCrossingView> = {}): BoundaryCrossingView {
  return {
    id: `x-${crossingSeq++}`,
    category: 'other',
    detail: 'd',
    detectedAt: 'now',
    reversible: true,
    occurrenceCount: 1,
    lastSeenAt: 'now',
    severity: 'MEDIUM',
    disposition: null,
    dispositionNote: null,
    dispositionedAt: null,
    dispositionedById: null,
    remediationTask: null,
    editChange: null,
    lastDispositionChange: null,
    attribution: {
      workspaceMemberId: null,
      sessionId: null,
      agent: null,
      worktreeBranch: null,
      model: null,
    },
    explanations: [],
    advisory: false,
    policyRuleRef: null,
    policyRuleText: null,
    agentContext: null,
    systemExplanation: null,
    ...p,
  }
}

describe('deriveRecordGaps', () => {
  it('no crossings, no security -> all zero, canBeDone', () => {
    const g = deriveRecordGaps({
      taskStatus: 'IN_REVIEW',
      crossings: [],
      gateEnabled: true,
    })
    expect(g).toEqual({
      crossingsOpen: 0,
      crossingsBlocking: 0,
      crossingsTotal: 0,
      securityBlocking: 0,
      testsBlocking: 0,
      canBeDone: true,
      taskDone: false,
    })
  })

  // LUM-1011: an undispositioned proven test defect holds Done back too.
  it('a blocking test defect alone -> cannot be done', () => {
    const g = deriveRecordGaps({
      taskStatus: 'IN_REVIEW',
      crossings: [],
      gateEnabled: true,
      testsBlocking: 1,
    })
    expect(g.testsBlocking).toBe(1)
    expect(g.canBeDone).toBe(false)
  })

  // Review F3: the strip needs to know the task was accepted (to say
  // "Accepted" instead of "can be marked Done") without a second prop.
  it('taskDone mirrors the task status', () => {
    expect(
      deriveRecordGaps({
        taskStatus: 'IN_REVIEW',
        crossings: [],
        gateEnabled: true,
      }).taskDone
    ).toBe(false)
    expect(
      deriveRecordGaps({
        taskStatus: 'DONE',
        crossings: [],
        gateEnabled: true,
      }).taskDone
    ).toBe(true)
  })

  it('crossings: open, non-advisory, gate enabled -> blocks', () => {
    const g = deriveRecordGaps({
      taskStatus: 'IN_REVIEW',
      crossings: [crossing({ severity: 'LOW', advisory: false })],
      gateEnabled: true,
    })
    expect(g.crossingsOpen).toBe(1)
    expect(g.crossingsBlocking).toBe(1)
    expect(g.canBeDone).toBe(false)
  })

  it('crossings: advisory never blocks, even with the gate on and HIGH severity', () => {
    const g = deriveRecordGaps({
      taskStatus: 'IN_REVIEW',
      crossings: [crossing({ severity: 'HIGH', advisory: true })],
      gateEnabled: true,
    })
    expect(g.crossingsOpen).toBe(1)
    expect(g.crossingsBlocking).toBe(0)
    expect(g.canBeDone).toBe(true)
  })

  it('crossings: gate off + LOW severity -> open but not blocking', () => {
    const g = deriveRecordGaps({
      taskStatus: 'IN_REVIEW',
      crossings: [crossing({ severity: 'LOW', advisory: false })],
      gateEnabled: false,
    })
    expect(g.crossingsOpen).toBe(1)
    expect(g.crossingsBlocking).toBe(0)
    expect(g.canBeDone).toBe(true)
  })

  it('crossings: gate off but HIGH severity still blocks', () => {
    const g = deriveRecordGaps({
      taskStatus: 'IN_REVIEW',
      crossings: [crossing({ severity: 'HIGH', advisory: false })],
      gateEnabled: false,
    })
    expect(g.crossingsBlocking).toBe(1)
    expect(g.canBeDone).toBe(false)
  })

  it('crossings: a dispositioned crossing is neither open nor blocking', () => {
    const g = deriveRecordGaps({
      taskStatus: 'IN_REVIEW',
      crossings: [
        crossing({
          severity: 'HIGH',
          advisory: false,
          disposition: 'CONFIRMED',
        }),
      ],
      gateEnabled: true,
    })
    expect(g.crossingsOpen).toBe(0)
    expect(g.crossingsBlocking).toBe(0)
    expect(g.crossingsTotal).toBe(1)
    expect(g.canBeDone).toBe(true)
  })

  it('securityBlocking: is carried through and blocks canBeDone', () => {
    const g = deriveRecordGaps({
      taskStatus: 'IN_REVIEW',
      crossings: [],
      gateEnabled: true,
      securityBlocking: 2,
    })
    expect(g.securityBlocking).toBe(2)
    expect(g.canBeDone).toBe(false)
  })

  it('securityBlocking: omitted defaults to 0', () => {
    const g = deriveRecordGaps({
      taskStatus: 'IN_REVIEW',
      crossings: [],
      gateEnabled: true,
    })
    expect(g.securityBlocking).toBe(0)
  })

  it('canBeDone is true only when every gate is clear at once', () => {
    const g = deriveRecordGaps({
      taskStatus: 'IN_REVIEW',
      crossings: [
        crossing({
          severity: 'HIGH',
          advisory: false,
          disposition: 'CONFIRMED',
        }),
      ],
      gateEnabled: true,
    })
    expect(g.canBeDone).toBe(true)
  })
})
