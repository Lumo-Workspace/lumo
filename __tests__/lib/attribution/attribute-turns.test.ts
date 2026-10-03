/**
 * @jest-environment node
 *
 * LUM-932 acceptance #2 (verbatim describe name is the checkpoint).
 */
import {
  attributeTurns,
  type EngineEvent,
  type EngineSession,
  type ResolvedSignal,
} from '@/lib/attribution/attribute-turns'

const ROOT = 'root'
const t = (s: number) => new Date(Date.UTC(2026, 9, 2, 10, 0, s))
const sig = (
  kind: ResolvedSignal['kind'],
  taskId: string,
  extra: Partial<ResolvedSignal> = {}
): ResolvedSignal => ({
  kind,
  taskId,
  identifier: taskId.toUpperCase(),
  ...extra,
})
const ev = (
  s: number,
  type: string,
  signals: ResolvedSignal[] = [],
  sessionId = ROOT
): EngineEvent => ({ sessionId, type, at: t(s), signals })
const run = (
  events: EngineEvent[],
  sessions: EngineSession[] = [
    { id: ROOT, parentSessionId: null, agentId: null },
  ]
) => attributeTurns({ rootSessionId: ROOT, sessions, events })

describe('attributeTurns segments a session by turns', () => {
  it('a no-attach session on lumo/LUM-N with lumo verify LUM-N → one HIGH segment covering the whole session incl. leading signal-less turns', () => {
    const segs = run([
      ev(0, 'SESSION_START'),
      ev(1, 'USER_PROMPT_SUBMIT'),
      ev(2, 'PRE_TOOL_USE'),
      ev(3, 'STOP'), // turn 0: exploration, no signal
      ev(4, 'USER_PROMPT_SUBMIT'),
      ev(5, 'STOP'), // turn 1: discussion, no signal
      ev(6, 'USER_PROMPT_SUBMIT'),
      ev(7, 'PRE_TOOL_USE', [
        sig('BRANCH', 'lum-12'),
        sig('LUMO_CMD', 'lum-12'),
      ]),
      ev(8, 'STOP'),
    ])
    expect(segs).toEqual([
      expect.objectContaining({
        sessionId: ROOT,
        taskId: 'lum-12',
        fromTurn: 0,
        toTurn: 2,
        fromAt: t(0),
        toAt: null,
        confidence: 'HIGH',
      }),
    ])
  })

  it('a strong signal for another task opens a new segment from that turn', () => {
    const segs = run([
      ev(1, 'USER_PROMPT_SUBMIT'),
      ev(2, 'PRE_TOOL_USE', [sig('LUMO_CMD', 'lum-12')]),
      ev(3, 'USER_PROMPT_SUBMIT'),
      ev(4, 'PRE_TOOL_USE'),
      ev(5, 'USER_PROMPT_SUBMIT'),
      ev(6, 'PRE_TOOL_USE', [sig('BRANCH', 'lum-13')]),
      ev(7, 'USER_PROMPT_SUBMIT'),
    ])
    expect(
      segs.map(s => [
        s.taskId,
        s.fromTurn,
        s.toTurn,
        s.toAt?.toISOString() ?? null,
      ])
    ).toEqual([
      ['lum-12', 0, 1, t(5).toISOString()],
      ['lum-13', 2, 3, null],
    ])
  })

  it('a weak signal for another task does not split', () => {
    const segs = run([
      ev(0, 'SESSION_START', [sig('GIT_HINT', 'lum-12')]),
      ev(1, 'USER_PROMPT_SUBMIT'),
      ev(2, 'PRE_TOOL_USE', [sig('LUMO_CMD', 'lum-12')]),
      ev(3, 'USER_PROMPT_SUBMIT'),
      ev(4, 'PRE_TOOL_USE', [sig('GIT_HINT', 'lum-99')]),
    ])
    expect(segs).toHaveLength(1)
    expect(segs[0]).toEqual(
      expect.objectContaining({ taskId: 'lum-12', fromTurn: 0, toTurn: 1 })
    )
  })

  it('a session with no signals yields no segment', () => {
    expect(
      run([ev(1, 'USER_PROMPT_SUBMIT'), ev(2, 'PRE_TOOL_USE'), ev(3, 'STOP')])
    ).toEqual([])
  })

  it('a prompt naming another task switches, and a prompt-only segment is MEDIUM', () => {
    const segs = run([
      ev(1, 'USER_PROMPT_SUBMIT', [sig('PROMPT', 'lum-12')]),
      ev(3, 'USER_PROMPT_SUBMIT', [sig('PROMPT', 'lum-13')]),
    ])
    expect(segs.map(s => [s.taskId, s.confidence])).toEqual([
      ['lum-12', 'MEDIUM'],
      ['lum-13', 'MEDIUM'],
    ])
  })

  it('ties within a turn go to the signal seen last', () => {
    // Weak signals: strong ones naming two tasks are decided by R1 instead.
    const segs = run([
      ev(1, 'USER_PROMPT_SUBMIT'),
      ev(2, 'PRE_TOOL_USE', [sig('PROMPT', 'lum-12')]),
      ev(3, 'PRE_TOOL_USE', [sig('PROMPT', 'lum-13')]),
    ])
    expect(segs[0]!.taskId).toBe('lum-13')
  })

  it('strong ties inside a branch-decided turn go to the signal seen last', () => {
    const segs = run([
      ev(1, 'USER_PROMPT_SUBMIT'),
      ev(2, 'PRE_TOOL_USE', [sig('BRANCH', 'lum-12')]),
      ev(3, 'PRE_TOOL_USE', [sig('LUMO_CMD', 'lum-13')]),
    ])
    expect(segs[0]!.taskId).toBe('lum-13')
  })

  it('on one branch, tasks switch only when the branch changes', () => {
    const b12 = sig('BRANCH', 'lum-12')
    const b13 = sig('BRANCH', 'lum-13')
    const events = [
      ev(1, 'USER_PROMPT_SUBMIT', [b12]),
      ev(2, 'PRE_TOOL_USE', [b12]),
      ev(3, 'STOP', [b12]),
      // A one-off command / commit naming another task on the LUM-12 branch.
      ev(4, 'USER_PROMPT_SUBMIT', [b12]),
      ev(5, 'PRE_TOOL_USE', [b12, sig('LUMO_CMD', 'lum-13')]),
      ev(6, 'PRE_TOOL_USE', [b12, sig('COMMIT', 'lum-13')]),
      ev(7, 'PRE_TOOL_USE', [b12]),
      ev(8, 'STOP', [b12]),
    ]
    expect(run(events).map(s => [s.taskId, s.fromTurn, s.toTurn])).toEqual([
      ['lum-12', 0, 1],
    ])

    const switched = run([
      ...events,
      // The branch changed (new branch / worktree for LUM-13).
      ev(9, 'USER_PROMPT_SUBMIT', [b13]),
      ev(10, 'PRE_TOOL_USE', [b13]),
      ev(11, 'STOP', [b13]),
    ])
    expect(
      switched.map(s => [s.taskId, s.fromTurn, s.toTurn, s.fromAt])
    ).toEqual([
      ['lum-12', 0, 1, t(1)],
      ['lum-13', 2, 2, t(9)],
    ])
  })

  it('a subagent follows the parent segment unless it has its own strong signal or a dispatch prompt', () => {
    const sessions = [
      { id: ROOT, parentSessionId: null, agentId: null },
      { id: 'root:a1', parentSessionId: ROOT, agentId: 'a1' },
      { id: 'root:a2', parentSessionId: ROOT, agentId: 'a2' },
      { id: 'root:a3', parentSessionId: ROOT, agentId: 'a3' },
    ]
    const segs = run(
      [
        ev(1, 'USER_PROMPT_SUBMIT'),
        ev(2, 'PRE_TOOL_USE', [sig('BRANCH', 'lum-12')]),
        ev(3, 'PRE_TOOL_USE', [], 'root:a1'),
        ev(4, 'SUBAGENT_STOP', [], 'root:a1'), // follows parent
        ev(5, 'PRE_TOOL_USE', [sig('LUMO_CMD', 'lum-20')], 'root:a2'), // own strong
        ev(6, 'POST_TOOL_USE', [
          sig('AGENT_PROMPT', 'lum-30', { agentId: 'a3' }),
        ]), // dispatch prompt (root event)
        ev(7, 'PRE_TOOL_USE', [], 'root:a3'),
      ],
      sessions
    )
    const by = (id: string) =>
      segs.filter(s => s.sessionId === id).map(s => [s.taskId, s.confidence])
    expect(by(ROOT)).toEqual([['lum-12', 'HIGH']])
    expect(by('root:a1')).toEqual([['lum-12', 'HIGH']])
    expect(by('root:a2')).toEqual([['lum-20', 'HIGH']])
    expect(by('root:a3')).toEqual([['lum-30', 'MEDIUM']])
  })

  it('a dispatch prompt naming the parent task follows the parent instead of a separate MEDIUM segment', () => {
    const sessions = [
      { id: ROOT, parentSessionId: null, agentId: null },
      { id: 'root:a3', parentSessionId: ROOT, agentId: 'a3' },
    ]
    const segs = run(
      [
        ev(1, 'USER_PROMPT_SUBMIT'),
        ev(2, 'PRE_TOOL_USE', [sig('BRANCH', 'lum-12')]),
        ev(6, 'POST_TOOL_USE', [
          sig('AGENT_PROMPT', 'lum-12', { agentId: 'a3' }),
        ]),
        ev(7, 'PRE_TOOL_USE', [], 'root:a3'),
      ],
      sessions
    )
    expect(
      segs
        .filter(s => s.sessionId === 'root:a3')
        .map(s => [s.taskId, s.confidence])
    ).toEqual([['lum-12', 'HIGH']])
  })

  it('a dispatch prompt under a root with no segments yields an own MEDIUM child segment', () => {
    const sessions = [
      { id: ROOT, parentSessionId: null, agentId: null },
      { id: 'root:a3', parentSessionId: ROOT, agentId: 'a3' },
    ]
    const segs = run(
      [
        ev(1, 'USER_PROMPT_SUBMIT'),
        ev(6, 'POST_TOOL_USE', [
          sig('AGENT_PROMPT', 'lum-30', { agentId: 'a3' }),
        ]),
        ev(7, 'PRE_TOOL_USE', [], 'root:a3'),
      ],
      sessions
    )
    expect(segs.map(s => [s.sessionId, s.taskId, s.confidence])).toEqual([
      ['root:a3', 'lum-30', 'MEDIUM'],
    ])
  })

  it('a follow-mode child keeps only parent evidence inside its own window', () => {
    const sessions = [
      { id: ROOT, parentSessionId: null, agentId: null },
      { id: 'root:a1', parentSessionId: ROOT, agentId: 'a1' },
    ]
    const segs = run(
      [
        ev(1, 'USER_PROMPT_SUBMIT'),
        ev(2, 'PRE_TOOL_USE', [sig('BRANCH', 'lum-12')]),
        ev(4, 'PRE_TOOL_USE', [], 'root:a1'),
        ev(4, 'POST_TOOL_USE', [sig('LUMO_CMD', 'lum-12')]),
        ev(5, 'SUBAGENT_STOP', [], 'root:a1'),
      ],
      sessions
    )
    const child = segs.filter(s => s.sessionId === 'root:a1')
    expect(child).toHaveLength(1)
    expect(child[0]!.confidence).toBe('HIGH')
    expect(child[0]!.evidence.map(e => [e.kind, e.at])).toEqual([
      ['LUMO_CMD', t(4).toISOString()],
    ])
  })

  it('a child that runs entirely before the root first event attaches to the first root segment', () => {
    const sessions = [
      { id: ROOT, parentSessionId: null, agentId: null },
      { id: 'root:a1', parentSessionId: ROOT, agentId: 'a1' },
    ]
    const segs = run(
      [
        ev(1, 'PRE_TOOL_USE', [], 'root:a1'),
        ev(2, 'SUBAGENT_STOP', [], 'root:a1'),
        ev(5, 'USER_PROMPT_SUBMIT'),
        ev(6, 'PRE_TOOL_USE', [sig('BRANCH', 'lum-12')]),
      ],
      sessions
    )
    expect(segs.filter(s => s.sessionId === 'root:a1')).toEqual([
      expect.objectContaining({
        taskId: 'lum-12',
        fromTurn: 0,
        toTurn: 0,
        fromAt: t(1),
        toAt: null,
        confidence: 'HIGH',
      }),
    ])
  })

  it('a follow-mode child on an open-ended last segment excludes parent evidence after its last event', () => {
    const sessions = [
      { id: ROOT, parentSessionId: null, agentId: null },
      { id: 'root:a1', parentSessionId: ROOT, agentId: 'a1' },
    ]
    const segs = run(
      [
        ev(1, 'USER_PROMPT_SUBMIT'),
        ev(2, 'PRE_TOOL_USE', [sig('BRANCH', 'lum-12')]),
        ev(4, 'PRE_TOOL_USE', [], 'root:a1'),
        ev(5, 'SUBAGENT_STOP', [], 'root:a1'),
        ev(9, 'POST_TOOL_USE', [sig('LUMO_CMD', 'lum-12')]),
      ],
      sessions
    )
    const child = segs.filter(s => s.sessionId === 'root:a1')
    expect(child).toHaveLength(1)
    expect(child[0]!.toAt).toBeNull()
    expect(child[0]!.evidence.map(e => e.at)).not.toContain(t(9).toISOString())
    expect(child[0]!.evidence).toEqual([])
  })

  it('a before-root child does not take later parent evidence', () => {
    const sessions = [
      { id: ROOT, parentSessionId: null, agentId: null },
      { id: 'root:a1', parentSessionId: ROOT, agentId: 'a1' },
    ]
    const segs = run(
      [
        ev(1, 'PRE_TOOL_USE', [], 'root:a1'),
        ev(2, 'SUBAGENT_STOP', [], 'root:a1'),
        ev(5, 'USER_PROMPT_SUBMIT'),
        ev(6, 'PRE_TOOL_USE', [sig('BRANCH', 'lum-12')]),
      ],
      sessions
    )
    const child = segs.filter(s => s.sessionId === 'root:a1')
    expect(child).toHaveLength(1)
    expect(child[0]!.evidence).toEqual([])
  })
})

describe('multi-task and notification turns follow the output and the subagent', () => {
  type Kid = { agentId: string; taskId?: string | null }
  const family = (...kids: Kid[]): EngineSession[] => [
    { id: ROOT, parentSessionId: null, agentId: null },
    ...kids.map(k => ({
      id: `${ROOT}:${k.agentId}`,
      parentSessionId: ROOT,
      agentId: k.agentId,
      ...(k.taskId !== undefined ? { taskId: k.taskId } : {}),
    })),
  ]
  const note = (
    s: number,
    agentId: string,
    signals: ResolvedSignal[] = []
  ): EngineEvent => ({
    ...ev(s, 'USER_PROMPT_SUBMIT', signals),
    notifiedAgentId: agentId,
  })
  const rootView = (segs: ReturnType<typeof run>) =>
    segs
      .filter(s => s.sessionId === ROOT)
      .map(s => [s.taskId, s.fromTurn, s.toTurn])
  const cmd = (id: string) => sig('LUMO_CMD', id)
  // turn 1 of the acceptance replay: one prompt, four reviews, no output.
  const reviewTurn = (extra: ResolvedSignal[] = []): EngineEvent[] => [
    ev(10, 'USER_PROMPT_SUBMIT'),
    ev(11, 'POST_TOOL_USE', [
      sig('AGENT_PROMPT', 'lum-895', { agentId: 'a5' }),
    ]),
    ev(12, 'POST_TOOL_USE', [
      sig('AGENT_PROMPT', 'lum-896', { agentId: 'a6' }),
    ]),
    ev(13, 'PRE_TOOL_USE', [cmd('lum-898')]),
    ev(14, 'PRE_TOOL_USE', [cmd('lum-898')]),
    ev(15, 'PRE_TOOL_USE', [cmd('lum-898')]),
    ev(16, 'PRE_TOOL_USE', [cmd('lum-898')]),
    ev(17, 'PRE_TOOL_USE', [cmd('lum-893')]),
    ev(18, 'PRE_TOOL_USE', [cmd('lum-897')]),
    ev(19, 'PRE_TOOL_USE', [cmd('lum-892'), ...extra]),
  ]

  it('replays the acceptance session: the review turn is unattributed and notification turns follow their subagent', () => {
    const segs = run(
      [
        ev(1, 'USER_PROMPT_SUBMIT'),
        ev(2, 'PRE_TOOL_USE', [cmd('lum-892')]),
        ...reviewTurn(),
        ev(20, 'PRE_TOOL_USE', [cmd('lum-895')], `${ROOT}:a5`),
        ev(21, 'SUBAGENT_STOP', [], `${ROOT}:a5`),
        ev(22, 'PRE_TOOL_USE', [], `${ROOT}:a6`),
        ev(23, 'SUBAGENT_STOP', [], `${ROOT}:a6`),
        ev(30, 'USER_PROMPT_SUBMIT'), // signal-less: no carry across the review turn
        ev(31, 'STOP'),
        // the notification text names other tasks: weak, the subagent wins
        note(40, 'a5', [sig('PROMPT', 'lum-896')]),
        ev(41, 'STOP'),
        note(50, 'a6'),
        ev(51, 'STOP'),
        note(60, 'b77'), // a background shell, not a subagent: as before
        ev(61, 'STOP'),
      ],
      family({ agentId: 'a5' }, { agentId: 'a6' })
    )
    expect(rootView(segs)).toEqual([
      ['lum-892', 0, 0],
      ['lum-895', 3, 3],
      ['lum-896', 4, 5],
    ])
    const root = segs.filter(s => s.sessionId === ROOT)
    expect(root.map(s => [s.fromAt, s.toAt])).toEqual([
      [t(1), t(10)],
      [t(40), t(50)],
      [t(50), null],
    ])
    expect(root[1]).toMatchObject({ confidence: 'HIGH' })
    expect(root[1]!.evidence.map(e => [e.kind, e.identifier])).toEqual([
      ['LUMO_CMD', 'LUM-895'],
    ])
    expect(root[2]).toMatchObject({ confidence: 'MEDIUM' })
    expect(root[2]!.evidence.map(e => [e.kind, e.identifier])).toEqual([
      ['AGENT_PROMPT', 'LUM-896'],
    ])
    for (const s of segs) {
      expect(s.evidence.map(e => e.kind)).not.toContain('NOTIFICATION')
    }
    const child = (a: string) =>
      segs
        .filter(s => s.sessionId === `${ROOT}:${a}`)
        .map(s => [s.taskId, s.confidence])
    expect(child('a5')).toEqual([['lum-895', 'HIGH']])
    expect(child('a6')).toEqual([['lum-896', 'MEDIUM']])
  })

  it('a multi-task turn whose only output is one commit goes to that task', () => {
    const turns = (output: ResolvedSignal) =>
      run([
        ev(1, 'USER_PROMPT_SUBMIT'),
        ev(2, 'PRE_TOOL_USE', [cmd('lum-892')]),
        ...reviewTurn([output]),
        ev(30, 'USER_PROMPT_SUBMIT'),
        ev(31, 'STOP'),
      ])
    expect(rootView(turns(sig('COMMIT', 'lum-898')))).toEqual([
      ['lum-892', 0, 0],
      ['lum-898', 1, 2],
    ])
    // the output decides even against the most-named task
    expect(rootView(turns(sig('COMMIT', 'lum-893')))).toEqual([
      ['lum-892', 0, 0],
      ['lum-893', 1, 2],
    ])
  })

  it('a multi-task turn with output for two tasks is unattributed and ends the previous segment', () => {
    const segs = run([
      ev(1, 'USER_PROMPT_SUBMIT'),
      ev(2, 'PRE_TOOL_USE', [cmd('lum-892')]),
      ...reviewTurn([sig('COMMIT', 'lum-898'), sig('PR_CREATE', 'lum-893')]),
      ev(30, 'USER_PROMPT_SUBMIT'),
      ev(31, 'STOP'),
    ])
    expect(rootView(segs)).toEqual([['lum-892', 0, 0]])
    expect(segs[0]!.toAt).toEqual(t(10))
  })

  it('a turn decided by its branch is unchanged by other tasks named in it', () => {
    const segs = run([
      ev(1, 'USER_PROMPT_SUBMIT'),
      ev(2, 'STOP'),
      ev(10, 'USER_PROMPT_SUBMIT'),
      ev(11, 'PRE_TOOL_USE', [sig('BRANCH', 'lum-12'), cmd('lum-892')]),
      ev(12, 'PRE_TOOL_USE', [sig('BRANCH', 'lum-12'), cmd('lum-893')]),
      ev(13, 'PRE_TOOL_USE', [sig('BRANCH', 'lum-12')]),
    ])
    expect(rootView(segs)).toEqual([['lum-12', 0, 1]])
  })

  it('leading signal-less turns are not back-attributed across an unattributed turn', () => {
    const segs = run([
      ev(1, 'USER_PROMPT_SUBMIT'),
      ev(2, 'STOP'),
      ev(10, 'USER_PROMPT_SUBMIT'),
      ev(11, 'PRE_TOOL_USE', [cmd('lum-892')]),
      ev(12, 'PRE_TOOL_USE', [cmd('lum-893')]),
      ev(20, 'USER_PROMPT_SUBMIT'),
      ev(21, 'STOP'),
      ev(30, 'USER_PROMPT_SUBMIT'),
      ev(31, 'PRE_TOOL_USE', [cmd('lum-5')]),
    ])
    expect(rootView(segs)).toEqual([['lum-5', 3, 3]])
    expect(segs[0]!.fromAt).toEqual(t(30))
  })

  it('a notification from a subagent spanning two tasks is unattributed and breaks the carry', () => {
    const segs = run(
      [
        ev(1, 'USER_PROMPT_SUBMIT'),
        ev(2, 'PRE_TOOL_USE', [cmd('lum-1')]),
        ev(5, 'PRE_TOOL_USE', [], `${ROOT}:a1`),
        ev(10, 'USER_PROMPT_SUBMIT'),
        ev(11, 'PRE_TOOL_USE', [cmd('lum-2')]),
        ev(15, 'SUBAGENT_STOP', [], `${ROOT}:a1`),
        note(20, 'a1'),
        ev(21, 'STOP'),
        ev(30, 'USER_PROMPT_SUBMIT'),
        ev(31, 'STOP'),
      ],
      family({ agentId: 'a1' })
    )
    expect(rootView(segs)).toEqual([
      ['lum-1', 0, 0],
      ['lum-2', 1, 1],
    ])
    expect(segs.filter(s => s.sessionId === ROOT)[1]!.toAt).toEqual(t(20))
  })

  it('a notification from a subagent with no task is unattributed and blocks back-attribution', () => {
    const segs = run(
      [
        ev(1, 'USER_PROMPT_SUBMIT'),
        ev(2, 'PRE_TOOL_USE', [], `${ROOT}:a1`),
        ev(3, 'SUBAGENT_STOP', [], `${ROOT}:a1`),
        note(10, 'a1'),
        ev(11, 'STOP'),
        ev(20, 'USER_PROMPT_SUBMIT'),
        ev(21, 'PRE_TOOL_USE', [cmd('lum-7')]),
      ],
      family({ agentId: 'a1' })
    )
    expect(rootView(segs)).toEqual([['lum-7', 2, 2]])
  })

  it('a notification turn with its own strong signal is decided by it', () => {
    const segs = run(
      [
        ev(1, 'USER_PROMPT_SUBMIT'),
        ev(2, 'PRE_TOOL_USE', [cmd('lum-895')], `${ROOT}:a5`),
        note(10, 'a5'),
        ev(11, 'PRE_TOOL_USE', [cmd('lum-9')]),
      ],
      family({ agentId: 'a5' })
    )
    expect(rootView(segs)).toEqual([['lum-9', 0, 1]])
  })

  it('a notification from an explicitly attached subagent takes its bound task', () => {
    const segs = run(
      [
        ev(1, 'USER_PROMPT_SUBMIT'),
        ev(2, 'PRE_TOOL_USE', [cmd('lum-1')]),
        ev(3, 'PRE_TOOL_USE', [], `${ROOT}:a1`),
        note(10, 'a1'),
        ev(11, 'STOP'),
      ],
      family({ agentId: 'a1', taskId: 'lum-44' })
    )
    expect(rootView(segs)).toEqual([
      ['lum-1', 0, 0],
      ['lum-44', 1, 1],
    ])
  })

  it('a notification from an explicitly attached subagent carries the evidence the child recorded', () => {
    const segs = run(
      [
        ev(1, 'USER_PROMPT_SUBMIT'),
        ev(2, 'PRE_TOOL_USE', [cmd('lum-1')]),
        ev(3, 'PRE_TOOL_USE', [], `${ROOT}:a1`),
        ev(4, 'PRE_TOOL_USE', [cmd('lum-44')], `${ROOT}:a1`),
        note(10, 'a1'),
        ev(11, 'STOP'),
      ],
      family({ agentId: 'a1', taskId: 'lum-44' })
    )
    const seg = segs.find(s => s.sessionId === ROOT && s.taskId === 'lum-44')!
    expect(seg.confidence).toBe('HIGH')
    expect(seg.evidence.map(e => [e.kind, e.identifier])).toEqual([
      ['LUMO_CMD', 'LUM-44'],
    ])
  })

  it('a notification from an explicitly attached subagent falls back to its dispatch prompt as evidence', () => {
    const segs = run(
      [
        ev(1, 'USER_PROMPT_SUBMIT'),
        ev(2, 'PRE_TOOL_USE', [
          sig('AGENT_PROMPT', 'lum-44', { agentId: 'a1' }),
        ]),
        ev(3, 'PRE_TOOL_USE', [], `${ROOT}:a1`),
        note(10, 'a1'),
        ev(11, 'STOP'),
      ],
      family({ agentId: 'a1', taskId: 'lum-44' })
    )
    const seg = segs.find(s => s.sessionId === ROOT && s.taskId === 'lum-44')!
    expect(seg.evidence.map(e => e.kind)).toEqual(['AGENT_PROMPT'])
  })
})
