import {
  normalizeHookEvents,
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
  it('lifts the agent check runs from Bash post-tool-use rows as raw commands', () => {
    const rows: GateHookEventRow[] = [
      bash('POST_TOOL_USE', 'tsc --noEmit', '2026-06-27T10:00:00.000Z'),
      bash('POST_TOOL_USE_FAILURE', 'npm test', '2026-06-27T10:05:00.000Z', {
        exit_code: 2,
      }),
    ]
    expect(normalizeHookEvents(rows)).toEqual([
      {
        command: 'tsc --noEmit',
        status: 'passed',
        exitCode: 0,
        at: '2026-06-27T10:00:00.000Z',
        sessionId: null,
      },
      {
        command: 'npm test',
        status: 'failed',
        exitCode: 2,
        at: '2026-06-27T10:05:00.000Z',
        sessionId: null,
      },
    ])
  })

  it('defaults a failure with no payload exit code to a non-zero exit', () => {
    const [ev] = normalizeHookEvents([
      bash('POST_TOOL_USE_FAILURE', 'next build', '2026-06-27T10:00:00.000Z'),
    ])
    expect(ev).toMatchObject({ status: 'failed' })
    expect(ev!.exitCode).not.toBe(0)
  })

  it('ignores commands that run no check and non-tool rows', () => {
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

  it('does not lift a check run from a command that only mentions a check in quoted text (LUM-614 prod bug)', () => {
    const rows: GateHookEventRow[] = [
      bash('POST_TOOL_USE', 'npx tsc --noEmit', '2026-06-27T10:00:00.000Z'),
      bash(
        'POST_TOOL_USE',
        'lumo task create "机械门闸:执行类 gate(parse/typecheck/build/test)独立版" --new-scope',
        '2026-06-27T10:10:00.000Z'
      ),
    ]
    const events = normalizeHookEvents(rows)
    expect(events.map(e => e.command)).toEqual(['npx tsc --noEmit'])
  })

  it('keeps a chained check command as one run, exactly as written', () => {
    const cmd = 'npx jest __tests__/x.test.ts; npx tsc --noEmit'
    const events = normalizeHookEvents([
      bash('POST_TOOL_USE_FAILURE', cmd, '2026-06-27T11:00:00.000Z', {
        exit_code: 2,
      }),
    ])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      command: cmd,
      status: 'failed',
      exitCode: 2,
    })
  })
})
