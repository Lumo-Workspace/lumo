import { deriveVerdictStatus } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/verdict-status'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
  CriterionSource,
} from '@/app/workspace/[workspaceUrl]/types'

function view(
  p: Partial<TaskAcceptanceStatusView> & { criteria: any[] }
): TaskAcceptanceStatusView {
  return {
    version: 1,
    task: { id: 't', identifier: 'LUM-1', title: 'x', status: 'IN_REVIEW' },
    currentRound: 1,
    maxRounds: 5,
    escalated: false,
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    ...p,
  } as TaskAcceptanceStatusView
}
const crit = (
  v: string | null,
  verifier: 'MACHINE' | 'HUMAN' = 'MACHINE'
): TaskStatusCriterionView => ({
  id: Math.random().toString(36).slice(2),
  statement: 's',
  verifierType: verifier,
  checkpointer: verifier === 'MACHINE' ? 'cmd:test' : null,
  evidenceRequired: false,
  judgeSteps: null,
  source: 'AGENT_DRAFT' as CriterionSource,
  addedAtRound: 0,
  latestVerdict: v
    ? {
        round: 1,
        verdict: v as any,
        verifierType: verifier,
        evidencePointer: null,
        rejectionReason: null,
        rejectionReasonEnum: null,
        recordedAt: 'now',
      }
    : null,
  machinePassed: v === 'PASS' && verifier === 'MACHINE',
  verdictStale: false,
  checkMismatch: false,
  changeState: null,
  changedAtRound: null,
  lastEdit: null,
})

describe('deriveVerdictStatus', () => {
  it('all criteria PASS -> success/allPassed with met=total', () => {
    const s = deriveVerdictStatus(
      view({ criteria: [crit('PASS'), crit('PASS')] })
    )
    expect(s.tone).toBe('success')
    expect(s.kind).toBe('allPassed')
    expect(s.met).toBe(2)
    expect(s.total).toBe(2)
    expect(s.gateBlocked).toBe(false)
  })
  it('a FAIL -> danger/sentBack and gateBlocked', () => {
    const s = deriveVerdictStatus(
      view({ criteria: [crit('PASS'), crit('FAIL')] })
    )
    expect(s.tone).toBe('danger')
    expect(s.kind).toBe('sentBack')
    expect(s.failCount).toBe(1)
    expect(s.gateBlocked).toBe(true)
  })
  it('escalated wins over everything', () => {
    const s = deriveVerdictStatus(
      view({ escalated: true, criteria: [crit('FAIL')] })
    )
    expect(s.kind).toBe('escalated')
    expect(s.tone).toBe('danger')
  })
  it('round + max passed through', () => {
    const s = deriveVerdictStatus(
      view({ currentRound: 3, maxRounds: 5, criteria: [crit('PASS')] })
    )
    expect(s.round).toBe(3)
    expect(s.maxRounds).toBe(5)
  })
})
