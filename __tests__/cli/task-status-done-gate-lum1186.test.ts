/**
 * @jest-environment node
 *
 * LUM-1186 — `lumo task status` and its DONE-readiness section (formerly
 * `task wrapup`, LUM-1233) render the server's Done gate
 * (the web Record tab's single verdict + crossings / security / tests rows)
 * — the claim + faithfulness stay JSON-only — and say plainly that an unruled proven test
 * defect blocks DONE. Fail-closed: an absent or unconfirmed gate is "cannot
 * confirm", never ready.
 */
import {
  crossingsRow,
  doneGateHeadline,
  doneGateRows,
  doneGateSection,
  securityRow,
  testsRow,
  type DoneGateReadout,
} from '@/cli/src/lib/done-gate-format'
import {
  formatTaskStatus,
  testCaseVerdictBlocks,
  testCaseVerdictGate,
  type TaskStatusResponse,
  type TestCaseVerdictAction,
} from '@/cli/src/commands/task-status'
import {
  assessReadiness,
  formatDoneReadiness,
  type ReadinessInput,
} from '@/cli/src/lib/done-readiness'
import { assessDigest } from '@/cli/src/lib/status-digest'

type Gate = Extract<DoneGateReadout, { confirmed: true }>

function gate(over: Partial<Gate> = {}): Gate {
  return {
    confirmed: true,
    headline: 'blocked',
    blockingTotal: 1,
    crossings: {
      state: 'advisory',
      blocking: 0,
      advisory: 2,
      dispositioned: 1,
      total: 3,
    },
    security: { state: 'notScanned', blocking: 0 },
    tests: { state: 'blocked', blocking: 1, passing: 3, total: 4 },
    ...over,
  }
}

function verdict(
  over: Partial<TestCaseVerdictAction> = {}
): TestCaseVerdictAction {
  return {
    kind: 'TEST_CASE_VERDICT',
    signal: 'PROVEN_DEFECT',
    number: 4,
    title: 'login redirect',
    blocking: true,
    advisory: false,
    ...over,
  }
}

function status(over: Partial<TaskStatusResponse> = {}): TaskStatusResponse {
  return {
    version: 2,
    task: {
      id: 't1',
      identifier: 'LUM-9001',
      title: 'Gate me',
      status: 'IN_REVIEW',
    },
    nextActions: [],
    securityFindings: { open: 0, blocking: 0, unconfirmedPrs: [], scans: [] },
    ...over,
  } as TaskStatusResponse
}

describe('Done gate rendering', () => {
  it('headline per state, fail-closed when absent or unconfirmed', () => {
    expect(doneGateHeadline(gate())).toBe('BLOCKED — 1 item blocks DONE')
    expect(doneGateHeadline(gate({ blockingTotal: 2 }))).toBe(
      'BLOCKED — 2 items block DONE'
    )
    expect(doneGateHeadline(gate({ headline: 'ready' }))).toBe(
      'READY — nothing blocks DONE'
    )
    expect(doneGateHeadline(gate({ headline: 'accepted' }))).toBe(
      'ACCEPTED — the task is DONE'
    )
    expect(doneGateHeadline(undefined)).toMatch(/^⚠ CANNOT CONFIRM/)
    expect(
      doneGateHeadline({ confirmed: false, unconfirmed: ['test cases'] })
    ).toBe('⚠ CANNOT CONFIRM — could not read test cases')
  })

  it('crossings row: none / blocked / advisory / clear', () => {
    expect(
      crossingsRow({
        state: 'none',
        blocking: 0,
        advisory: 0,
        dispositioned: 0,
        total: 0,
      })
    ).toBe('– none recorded')
    expect(
      crossingsRow({
        state: 'blocked',
        blocking: 1,
        advisory: 1,
        dispositioned: 0,
        total: 2,
      })
    ).toBe(
      '✗ 1 blocking, not dispositioned · 1 advisory (open, does not block DONE) · dispositioned 0/2'
    )
    expect(crossingsRow(gate().crossings)).toBe(
      '✓ 2 advisory (open, does not block DONE) · dispositioned 1/3'
    )
    expect(
      crossingsRow({
        state: 'clear',
        blocking: 0,
        advisory: 0,
        dispositioned: 2,
        total: 2,
      })
    ).toBe('✓ dispositioned 2/2')
  })

  it('security row: not scanned is never clean', () => {
    expect(securityRow({ state: 'notScanned', blocking: 0 })).toMatch(
      /^– not scanned .* not a clean result$/
    )
    expect(securityRow({ state: 'clear', blocking: 0 })).toBe(
      '✓ no blocking findings'
    )
    expect(securityRow({ state: 'blocked', blocking: 2 })).toBe(
      '✗ 2 blocking findings not dispositioned'
    )
  })

  it('tests row: N/M passing', () => {
    expect(testsRow(gate().tests)).toBe(
      '✗ 1 proven defect awaiting a ruling · 3/4 passing'
    )
    expect(
      testsRow({ state: 'clear', blocking: 0, passing: 4, total: 4 })
    ).toBe('✓ no proven defects · 4/4 passing')
    expect(testsRow({ state: 'none', blocking: 0, passing: 0, total: 0 })).toBe(
      '– no test cases'
    )
  })

  it('rows: no security row without a security plugin', () => {
    const rows = doneGateRows(gate({ security: null }), 2)
    expect(rows.join('\n')).not.toContain('Security')
    expect(rows).toHaveLength(2)
    expect(doneGateRows(gate(), 2)).toHaveLength(3)
  })

  it('section says unknown, not clear, when the gate is unconfirmed', () => {
    const out = doneGateSection({
      confirmed: false,
      unconfirmed: ['boundary crossings'],
    }).join('\n')
    expect(out).toContain(
      'Done gate: ⚠ CANNOT CONFIRM — could not read boundary crossings'
    )
    expect(out).toContain('Unknown, not clear')
  })
})

describe('lumo task status output', () => {
  it('prints the Done gate first, with crossings / security / tests rows', () => {
    const out = formatTaskStatus(status({ doneGate: gate() }))
    const lines = out.split('\n')
    expect(lines.slice(0, 7)).toEqual([
      'LUM-9001  Gate me',
      'Status: IN_REVIEW',
      '',
      'Done gate: BLOCKED — 1 item blocks DONE',
      '  Crossings:  ✓ 2 advisory (open, does not block DONE) · dispositioned 1/3',
      '  Security:   – not scanned (no linked PR has a scan) — not a clean result',
      '  Tests:      ✗ 1 proven defect awaiting a ruling · 3/4 passing',
    ])
  })

  it('a proven defect reads as blocking DONE, and the heading is not "advisory only"', () => {
    const out = formatTaskStatus(
      status({ doneGate: gate(), nextActions: [verdict()] })
    )
    expect(out.replace(/\s+/g, ' ')).toContain(
      'TC4 login redirect — implementation defect, with evidence (blocks DONE until the user rules on it)'
    )
    expect(out).not.toContain('advisory only')
    expect(out).not.toMatch(/login redirect.*\(advisory\)/)
  })

  it('verdict gate wording follows the server flag; an older server is never "advisory"', () => {
    expect(testCaseVerdictGate(verdict())).toBe(
      'blocks DONE until the user rules on it'
    )
    expect(
      testCaseVerdictGate(verdict({ blocking: false, advisory: true }))
    ).toBe('ruled on — does not block DONE')
    const old = verdict()
    delete old.blocking
    expect(testCaseVerdictGate(old)).toBe(
      'blocks DONE unless that run was already ruled on'
    )
    expect(
      testCaseVerdictGate(
        verdict({ signal: 'CASE_OUTDATED', blocking: false, advisory: true })
      )
    ).toBe('advisory')
    expect(testCaseVerdictBlocks(verdict())).toBe(true)
    expect(testCaseVerdictBlocks(old)).toBe(true)
    expect(testCaseVerdictBlocks(verdict({ blocking: false }))).toBe(false)
    expect(
      testCaseVerdictBlocks(
        verdict({ signal: 'UNPROVEN_PASS', blocking: false })
      )
    ).toBe(false)
  })

  it('the text report omits the Claim section (user ruling 2026-10-17)', () => {
    const out = formatTaskStatus(
      status({
        claim: { text: 'Added the gate', source: 'AGENT' },
        faithfulness: {
          state: 'UNJUDGEABLE',
          verdict: 'UNJUDGEABLE',
          evidence: [],
          reasoning: null,
          diffShas: [],
          prNumbers: [],
          judgedAt: null,
          judgedClaimAt: null,
        },
      })
    )
    expect(out).not.toMatch(/^Claim$/m)
    expect(out).not.toContain('Claim:')
    expect(out).not.toContain('Faithfulness:')
    expect(out).not.toContain('unverified self-report')
    expect(out).not.toContain('Added the gate')
  })
})

function wrapInput(data: TaskStatusResponse): ReadinessInput {
  return {
    identifier: 'LUM-9001',
    status: { ok: true, value: data },
    task: {
      ok: true,
      value: {
        identifier: 'LUM-9001',
        title: 'Gate me',
        status: 'IN_REVIEW',
        pullRequests: [],
      },
    },
    crossings: { status: 'ok', crossings: [], gateEnabled: true },
    worktrees: { mainRoot: '/repo', items: [] },
  }
}

describe('DONE readiness section (formerly task wrapup)', () => {
  it('shows the same Done gate verdict and rows', () => {
    const input = wrapInput(
      status({ doneGate: gate(), nextActions: [verdict()] })
    )
    const done = formatDoneReadiness(input, assessReadiness(input)).join('\n')
    expect(done.startsWith('\nDONE readiness')).toBe(true)
    expect(done).toContain('  Done gate: BLOCKED — 1 item blocks DONE')
    expect(done).toContain(
      '    Tests:      ✗ 1 proven defect awaiting a ruling · 3/4 passing'
    )
    expect(done).toContain('Readiness: BLOCKED')
  })

  it('a ruled-on defect no longer makes readiness BLOCKED', () => {
    const r = assessReadiness(
      wrapInput(
        status({
          doneGate: gate({ headline: 'ready', blockingTotal: 0 }),
          nextActions: [verdict({ blocking: false, advisory: true })],
        })
      )
    )
    expect(r.level).toBe('READY')
  })

  it('never reports less than the server gate (fail-closed)', () => {
    const r = assessReadiness(
      wrapInput(status({ doneGate: gate({ blockingTotal: 2 }) }))
    )
    expect(r).toEqual({
      level: 'BLOCKED',
      reasons: ['the Done gate reports 2 items blocking DONE'],
    })
  })

  it('an unconfirmed gate makes readiness CANNOT CONFIRM', () => {
    const r = assessReadiness(
      wrapInput(
        status({ doneGate: { confirmed: false, unconfirmed: ['test cases'] } })
      )
    )
    expect(r.level).toBe('UNCONFIRMED')
    expect(r.reasons).toEqual(['could not read the Done gate (test cases)'])
  })
})

describe('status digest', () => {
  it('counts only proven defects that still block', () => {
    const v = assessDigest({
      identifier: 'LUM-9001',
      status: {
        ok: true,
        value: status({
          nextActions: [
            verdict(),
            verdict({ number: 5, blocking: false, advisory: true }),
          ],
        }),
      },
      crossings: { status: 'ok', crossings: [], gateEnabled: true },
    })
    expect(v.blocking).toEqual(['1 proven test-case defect'])
  })
})
