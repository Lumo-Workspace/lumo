import {
  buildDeliveryGateAudit,
  type GateHookEventRow,
  type GateSignalRow,
  type GateRecord,
} from '@/lib/services/gate-audit'

function byKey(gates: GateRecord[]): Record<string, GateRecord> {
  return Object.fromEntries(gates.map(g => [g.key, g]))
}

function bash(command: string, type: string, at: string): GateHookEventRow {
  return {
    type,
    payload: { tool_name: 'Bash', tool_input: { command } },
    createdAt: new Date(at),
  }
}

function ciSignal(
  gateKey: string,
  outcome: string,
  at: string,
  checkName = 'Vercel'
): GateSignalRow {
  return {
    gateKey,
    outcome,
    checkName,
    detailsUrl: 'https://ci.example/run/1',
    source: 'github_check',
    createdAt: new Date(at),
  }
}

describe('gate-audit two-source merge (LUM-616)', () => {
  it('gateaudit independent precedence over selfreported', () => {
    const hookRows: GateHookEventRow[] = [
      // agent self-reported a PASSING build, and LATER than the CI signal
      bash('next build', 'POST_TOOL_USE', '2026-06-28T12:00:00.000Z'),
      // agent self-reported a passing typecheck (no independent counterpart)
      bash('tsc --noEmit', 'POST_TOOL_USE', '2026-06-28T12:00:00.000Z'),
    ]
    const gateSignals: GateSignalRow[] = [
      // independent CI says build FAILED — earlier in time than the self-report
      ciSignal('build', 'failure', '2026-06-28T10:00:00.000Z'),
    ]

    const g = byKey(buildDeliveryGateAudit(hookRows, gateSignals).gates)

    // independent wins over self-reported for the SAME gate, even though the
    // self-report is newer — the agent's word must not override CI truth.
    expect(g['build']!.status).toBe('failed')
    expect(g['build']!.provenance).toBe('independent_harness')
    expect(g['build']!.grounding?.detailsUrl).toBe('https://ci.example/run/1')

    // no independent signal for typecheck → fall back to self-reported
    expect(g['typecheck']!.status).toBe('passed')
    expect(g['typecheck']!.provenance).toBe('agent_self_reported')
  })

  it('uses the latest independent signal among several for a gate', () => {
    const gateSignals: GateSignalRow[] = [
      ciSignal('build', 'failure', '2026-06-28T10:00:00.000Z'),
      ciSignal('build', 'success', '2026-06-28T11:00:00.000Z'),
    ]
    const g = byKey(buildDeliveryGateAudit([], gateSignals).gates)
    expect(g['build']!.status).toBe('passed')
    expect(g['build']!.provenance).toBe('independent_harness')
  })

  it('drops gate signals with an unrecognized gate key', () => {
    const gateSignals: GateSignalRow[] = [
      ciSignal('not-a-gate', 'success', '2026-06-28T10:00:00.000Z'),
    ]
    const g = byKey(buildDeliveryGateAudit([], gateSignals).gates)
    // no event lifted → build stays not_run, never a fabricated pass
    expect(g['build']!.status).toBe('not_run')
  })
})

describe('gate-audit merge — lumo_sandbox signals (LUM-746)', () => {
  it('a Lumo-managed CI failure overrides a later self-reported pass for the same gate', () => {
    const hookRows: GateHookEventRow[] = [
      bash('npx jest', 'POST_TOOL_USE', '2026-09-10T12:00:00.000Z'),
    ]
    const gateSignals: GateSignalRow[] = [
      {
        gateKey: 'test',
        outcome: 'failure',
        checkName: 'lumo/ci test',
        detailsUrl: null,
        source: 'lumo_sandbox',
        createdAt: new Date('2026-09-10T10:00:00.000Z'),
      },
    ]
    const g = byKey(buildDeliveryGateAudit(hookRows, gateSignals).gates)
    expect(g['test']!.status).toBe('failed')
    expect(g['test']!.provenance).toBe('independent_harness')
    expect(g['test']!.grounding).toEqual({
      pointer: expect.stringContaining('lumo/ci test'),
      hookEvent: 'lumo_sandbox',
      at: '2026-09-10T10:00:00.000Z',
    })
  })
})
