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
        invocation: 'tsc --noEmit',
        status: 'passed',
        exitCode: 0,
        at: '2026-06-27T10:00:00.000Z',
        sessionId: null,
      },
      {
        command: 'npm test',
        invocation: 'npm test',
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

  it('keeps only the production commands that invoked a check', () => {
    // LUM-839 TC2: the 15 commands the production panel listed for PR 1102,
    // byte-identical to what GET /api/tasks/[id]/gates returned (sha256 of the
    // command list checked when captured). The first 14 are the ones on screen
    // when TC2 ran; the 15th arrived after it.
    const prod: {
      at: string
      command: string
    }[] = require('./fixtures/lum839-prod-self-reported.json')
    expect(prod).toHaveLength(15)
    const rows = prod.map(p => bash('POST_TOOL_USE', p.command, p.at))

    const kept = normalizeHookEvents(rows)
    const keptAt = kept.map(e => e.at)
    expect(keptAt).toEqual([
      '2026-09-26T04:28:41.504Z', // sed … && npx jest
      '2026-09-26T04:32:03.702Z', // heredoc test write, then npx jest
      '2026-09-26T04:32:36.315Z', // heredoc test writes, then npx jest
      '2026-09-26T04:33:35.839Z', // heredoc test write, then npx jest; npx tsc
      '2026-09-26T04:34:54.179Z', // git add … && npx jest --silent
      '2026-09-26T04:35:25.740Z', // for … do npx tsx scripts/jest-t.ts
      '2026-09-26T04:43:31.110Z', // python heredoc edit, then npx jest && npx tsc
      '2026-09-26T04:43:58.270Z', // npx prisma generate && npx tsc
      '2026-09-26T05:05:29.751Z', // git rev-parse …; npx jest … --verbose
    ])
    expect(
      kept.filter(e => prod.slice(0, 14).some(p => p.at === e.at))
    ).toHaveLength(9)

    // Dropped: a check word only in a file path, a heredoc body, a commit
    // message, or an evidence file name.
    const droppedAt = prod.map(p => p.at).filter(at => !keptAt.includes(at))
    expect(droppedAt).toEqual([
      '2026-09-26T04:27:32.466Z', // ls … && cat scripts/jest-t.ts
      '2026-09-26T04:27:56.444Z', // python / cat heredocs editing schema + migration
      '2026-09-26T04:32:51.059Z', // heredoc test write, then git rm / sed
      '2026-09-26T04:35:10.694Z', // git commit heredoc, then lumo verify
      '2026-09-26T05:05:48.041Z', // lumo task testcase run --evidence-file …jest.log
      '2026-09-26T05:09:06.639Z', // heredoc evidence write
    ])

    // Each row shows the check it ran, not the start of the command line.
    const byAt = new Map(kept.map(e => [e.at, e.invocation]))
    expect(byAt.get('2026-09-26T04:33:35.839Z')).toBe(
      'npx jest __tests__/gate __tests__/Delivery __tests__/ci-signal 2>&1; npx tsc --noEmit 2>&1'
    )
    expect(byAt.get('2026-09-26T04:35:25.740Z')).toBe(
      'npx tsx scripts/jest-t.ts "${t%%|*}" "${t##*|}" 2>&1'
    )
    expect(byAt.get('2026-09-26T04:32:03.702Z')).toBe(
      'npx jest __tests__/gate-audit-per-pr.test.ts 2>&1'
    )
  })
})
