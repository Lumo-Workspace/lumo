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
