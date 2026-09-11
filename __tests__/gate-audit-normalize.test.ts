import {
  normalizeHookEvents,
  buildDeliveryGateAudit,
  type GateHookEventRow,
} from '@/lib/services/gate-audit'

function bash(
  type: string,
  command: string,
  createdAt: string,
  toolResponse?: unknown
): GateHookEventRow {
  return {
    type,
    payload: {
      tool_name: 'Bash',
      tool_input: { command },
      tool_response: toolResponse,
    },
    createdAt: new Date(createdAt),
  }
}

describe('normalizeHookEvents', () => {
  it('lifts execution-gate signals from Bash post-tool-use rows', () => {
    const rows: GateHookEventRow[] = [
      bash('POST_TOOL_USE', 'tsc --noEmit', '2026-06-27T10:00:00.000Z'),
      bash('POST_TOOL_USE_FAILURE', 'npm test', '2026-06-27T10:05:00.000Z', {
        exit_code: 2,
      }),
    ]
    const events = normalizeHookEvents(rows)
    const typecheck = events.find(e => e.key === 'typecheck')
    const test = events.find(e => e.key === 'test')

    expect(typecheck).toMatchObject({
      outcome: 'success',
      command: 'tsc --noEmit',
      exitCode: 0,
    })
    expect(test).toMatchObject({
      outcome: 'failure',
      command: 'npm test',
      exitCode: 2,
    })
    expect(test!.at).toBe('2026-06-27T10:05:00.000Z')
  })

  it('defaults a failure with no payload exit code to a non-zero exit', () => {
    const [ev] = normalizeHookEvents([
      bash('POST_TOOL_USE_FAILURE', 'next build', '2026-06-27T10:00:00.000Z'),
    ])
    expect(ev).toMatchObject({ key: 'build', outcome: 'failure' })
    expect(ev!.exitCode).not.toBe(0)
  })

  it('ignores commands that match no gate and non-tool rows', () => {
    const rows: GateHookEventRow[] = [
      bash('POST_TOOL_USE', 'ls -la', '2026-06-27T10:00:00.000Z'),
      {
        type: 'STOP',
        payload: {},
        createdAt: new Date('2026-06-27T10:01:00.000Z'),
      },
    ]
    expect(normalizeHookEvents(rows)).toEqual([])
  })

  it('does not lift a gate signal from a command that only mentions a gate in quoted text (LUM-614 prod bug)', () => {
    // The real prod command: a `lumo task create` whose description discusses
    // the gates. It must NOT become a passed typecheck event, and the real tsc
    // run must remain the typecheck signal.
    const rows: GateHookEventRow[] = [
      bash('POST_TOOL_USE', 'npx tsc --noEmit', '2026-06-27T10:00:00.000Z'),
      bash(
        'POST_TOOL_USE',
        'lumo task create "机械门闸:执行类 gate(parse/typecheck/build/test)独立版" --new-scope',
        '2026-06-27T10:10:00.000Z'
      ),
    ]
    const events = normalizeHookEvents(rows)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      key: 'typecheck',
      command: 'npx tsc --noEmit',
      outcome: 'success',
    })
  })

  it('emits one self-reported signal per matched gate for a merged command', () => {
    // LUM-629 (observed on LUM-620 #770): jest and tsc combined in one shell
    // command classified as typecheck only, so the test gate under-reported
    // not_run even though jest ran and passed in the delivery window.
    const cmd = 'npx jest __tests__/x.test.ts; npx tsc --noEmit'
    const rows: GateHookEventRow[] = [
      bash('POST_TOOL_USE', cmd, '2026-06-27T10:00:00.000Z'),
    ]
    const events = normalizeHookEvents(rows)
    expect(events.map(e => e.key).sort()).toEqual(['test', 'typecheck'])
    for (const ev of events) {
      expect(ev).toMatchObject({
        outcome: 'success',
        command: cmd,
        exitCode: 0,
        hookEvent: 'POST_TOOL_USE',
        at: '2026-06-27T10:00:00.000Z',
        provenance: 'agent_self_reported',
      })
    }

    const audit = buildDeliveryGateAudit(rows)
    const byKey = Object.fromEntries(audit.gates.map(g => [g.key, g]))
    expect(byKey['test']!.status).toBe('passed')
    expect(byKey['typecheck']!.status).toBe('passed')
    expect(byKey['build']!.status).toBe('not_run')
    // Both signals stay grounded on the same cmd:#exit= pointer.
    expect(byKey['test']!.grounding?.pointer).toContain('#exit=0')
    expect(byKey['typecheck']!.grounding?.pointer).toBe(
      byKey['test']!.grounding?.pointer
    )
  })

  it('a failed merged command emits a failure signal for every matched gate', () => {
    const rows: GateHookEventRow[] = [
      bash(
        'POST_TOOL_USE_FAILURE',
        'npx jest a.test.ts && npx tsc --noEmit',
        '2026-06-27T11:00:00.000Z',
        { exit_code: 2 }
      ),
    ]
    const events = normalizeHookEvents(rows)
    expect(events.map(e => e.key).sort()).toEqual(['test', 'typecheck'])
    for (const ev of events) {
      expect(ev).toMatchObject({ outcome: 'failure', exitCode: 2 })
    }
  })

  it('buildDeliveryGateAudit wires normalize → derive with execution gates configured', () => {
    const rows: GateHookEventRow[] = [
      bash('POST_TOOL_USE', 'tsc --noEmit', '2026-06-27T10:00:00.000Z'),
    ]
    const audit = buildDeliveryGateAudit(rows)
    const byKey = Object.fromEntries(audit.gates.map(g => [g.key, g]))
    // execution gate with a real event → passed; other execution gates → not_run
    expect(byKey['typecheck']!.status).toBe('passed')
    expect(byKey['test']!.status).toBe('not_run')
    expect(byKey['build']!.status).toBe('not_run')
  })
})

describe('normalizeGateSignals — lumo_sandbox source (LUM-746)', () => {
  it('a Lumo-managed CI row is an independent_harness event grounded on its check name, no details url', () => {
    const { normalizeGateSignals } = jest.requireActual(
      '@/lib/services/gate-audit'
    ) as typeof import('@/lib/services/gate-audit')
    const events = normalizeGateSignals([
      {
        gateKey: 'test',
        outcome: 'failure',
        checkName: 'lumo/ci test',
        detailsUrl: null,
        source: 'lumo_sandbox',
        createdAt: new Date('2026-09-10T10:00:00.000Z'),
        prNumber: 960,
      },
    ])
    expect(events).toEqual([
      {
        key: 'test',
        outcome: 'failure',
        command: 'lumo/ci test',
        exitCode: 1,
        hookEvent: 'lumo_sandbox',
        at: '2026-09-10T10:00:00.000Z',
        provenance: 'independent_harness',
        prNumber: 960,
      },
    ])
  })
})
