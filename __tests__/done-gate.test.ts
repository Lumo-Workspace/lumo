/**
 * LUM-1009 — `deriveDoneGate`, the pure rule behind the Record tab's Done
 * gate: one headline plus a crossings row and a security row. A task with no
 * scanned PR must never read as "no blocking findings".
 */
import { deriveDoneGate } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/done-gate'
import type { RecordGaps } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/record-gaps'

function gaps(over: Partial<RecordGaps> = {}): RecordGaps {
  return {
    crossingsOpen: 0,
    crossingsBlocking: 0,
    crossingsTotal: 0,
    securityBlocking: 0,
    testsBlocking: 0,
    canBeDone: true,
    taskDone: false,
    ...over,
  }
}

describe('deriveDoneGate', () => {
  it('is ready with nothing recorded and says the PR was not scanned', () => {
    const gate = deriveDoneGate(gaps(), { securityScanned: false })
    expect(gate.headline).toBe('ready')
    expect(gate.blockingTotal).toBe(0)
    expect(gate.crossings.state).toBe('none')
    expect(gate.security?.state).toBe('notScanned')
  })

  it('reports a clear security row only when a PR was scanned', () => {
    expect(
      deriveDoneGate(gaps(), { securityScanned: true }).security?.state
    ).toBe('clear')
  })

  it('blocks on a security finding alone', () => {
    const gate = deriveDoneGate(
      gaps({ securityBlocking: 2, canBeDone: false }),
      {
        securityScanned: true,
      }
    )
    expect(gate.headline).toBe('blocked')
    expect(gate.blockingTotal).toBe(2)
    expect(gate.security).toEqual({ state: 'blocked', blocking: 2 })
    expect(gate.crossings.state).toBe('none')
  })

  it('sums blocking crossings and findings, and splits out advisory crossings', () => {
    const gate = deriveDoneGate(
      gaps({
        crossingsOpen: 3,
        crossingsBlocking: 2,
        crossingsTotal: 5,
        securityBlocking: 1,
        canBeDone: false,
      }),
      { securityScanned: true }
    )
    expect(gate.blockingTotal).toBe(3)
    expect(gate.crossings).toEqual({
      state: 'blocked',
      blocking: 2,
      advisory: 1,
      dispositioned: 2,
      total: 5,
    })
  })

  it('treats advisory-only open crossings as not blocking', () => {
    const gate = deriveDoneGate(
      gaps({ crossingsOpen: 1, crossingsBlocking: 0, crossingsTotal: 1 }),
      { securityScanned: true }
    )
    expect(gate.headline).toBe('ready')
    expect(gate.crossings.state).toBe('advisory')
    expect(gate.crossings.advisory).toBe(1)
  })

  it('is clear once every crossing is dispositioned', () => {
    expect(
      deriveDoneGate(gaps({ crossingsTotal: 4 }), { securityScanned: true })
        .crossings
    ).toEqual({
      state: 'clear',
      blocking: 0,
      advisory: 0,
      dispositioned: 4,
      total: 4,
    })
  })

  it('says accepted on a DONE task, even with late open items', () => {
    const gate = deriveDoneGate(
      gaps({
        taskDone: true,
        crossingsOpen: 1,
        crossingsBlocking: 1,
        crossingsTotal: 1,
      }),
      { securityScanned: true }
    )
    expect(gate.headline).toBe('accepted')
  })

  // LUM-1011: a proven test defect already blocks DONE server-side (LUM-812);
  // before this the Record page's Done gate never said so.
  it('blocks on an undispositioned proven test defect, and counts it', () => {
    const gate = deriveDoneGate(
      gaps({ testsBlocking: 1, securityBlocking: 1, canBeDone: false }),
      { securityScanned: true, tests: { total: 3, passing: 1 } }
    )
    expect(gate.headline).toBe('blocked')
    expect(gate.blockingTotal).toBe(2)
    expect(gate.tests).toEqual({
      state: 'blocked',
      blocking: 1,
      passing: 1,
      total: 3,
    })
  })

  it('reads a task without test cases as "none", never as passing', () => {
    const gate = deriveDoneGate(gaps(), { securityScanned: true })
    expect(gate.tests.state).toBe('none')
    expect(
      deriveDoneGate(gaps(), {
        securityScanned: true,
        tests: { total: 2, passing: 2 },
      }).tests.state
    ).toBe('clear')
  })
})
