/**
 * @jest-environment node
 *
 * LUM-1237: an unbound root that hosts a self-attached subagent is an
 * orchestration host — its turns are attributed only by work output (BRANCH,
 * COMMIT, PR_CREATE). Also: the Sessions-tile "bound" rule and the host test.
 */
import {
  attributeTurns,
  type EngineEvent,
  type EngineSession,
  type ResolvedSignal,
} from '@/lib/attribution/attribute-turns'
import {
  isBoundRun,
  summarizeRunAttributions,
  type RunAttribution,
} from '@/lib/attribution/run-attribution'
import { isOrchestrationHost } from '@/lib/services/attribution.service'

const ROOT = 'root'
const AGENT = 'a1'
const CHILD = `${ROOT}:${AGENT}`
const t = (s: number) => new Date(Date.UTC(2026, 9, 18, 10, 0, s))
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
  sessionId = ROOT,
  notifiedAgentId?: string
): EngineEvent => ({
  sessionId,
  type,
  at: t(s),
  signals,
  ...(notifiedAgentId ? { notifiedAgentId } : {}),
})
const sessions: EngineSession[] = [
  { id: ROOT, parentSessionId: null, agentId: null },
  { id: CHILD, parentSessionId: ROOT, agentId: AGENT, taskId: 'lum-2' },
]

/** Prompt (names lum-1) → dispatch → notification (R2) → lumo read → commit. */
const events: EngineEvent[] = [
  ev(0, 'USER_PROMPT_SUBMIT', [sig('PROMPT', 'lum-1')]),
  ev(1, 'POST_TOOL_USE', [sig('AGENT_PROMPT', 'lum-2', { agentId: AGENT })]),
  ev(2, 'STOP'),
  ev(3, 'SUBAGENT_START', [], CHILD),
  ev(50, 'SUBAGENT_STOP', [], CHILD),
  ev(60, 'USER_PROMPT_SUBMIT', [], ROOT, AGENT),
  ev(61, 'PRE_TOOL_USE', [sig('LUMO_CMD', 'lum-2')]),
  ev(62, 'STOP'),
  ev(70, 'USER_PROMPT_SUBMIT'),
  ev(71, 'PRE_TOOL_USE', [sig('COMMIT', 'lum-3')]),
  ev(72, 'STOP'),
  ev(80, 'USER_PROMPT_SUBMIT'),
  ev(81, 'STOP'),
]

const rootSegments = (orchestrationHost: boolean) =>
  attributeTurns({ rootSessionId: ROOT, sessions, events, orchestrationHost })
    .filter(s => s.sessionId === ROOT)
    .map(s => [s.taskId, s.fromTurn, s.toTurn])

describe('attributeTurns orchestration host (LUM-1237)', () => {
  it('without the host flag the root is inferred as before (prompt, R2, carry-forward)', () => {
    expect(rootSegments(false)).toEqual([
      ['lum-1', 0, 0],
      ['lum-2', 1, 1],
      ['lum-3', 2, 3],
    ])
  })

  it('a host root is attributed only by its work output turn, with no carry-forward', () => {
    expect(rootSegments(true)).toEqual([['lum-3', 2, 2]])
  })

  it('a host root on a task branch keeps branch ruling C', () => {
    const segs = attributeTurns({
      rootSessionId: ROOT,
      sessions,
      orchestrationHost: true,
      events: [
        ev(0, 'USER_PROMPT_SUBMIT', [sig('BRANCH', 'lum-9')]),
        ev(1, 'PRE_TOOL_USE', [
          sig('BRANCH', 'lum-9'),
          sig('LUMO_CMD', 'lum-2'),
        ]),
        ev(2, 'STOP', [sig('BRANCH', 'lum-9')]),
      ],
    })
    expect(segs.filter(s => s.sessionId === ROOT).map(s => s.taskId)).toEqual([
      'lum-9',
    ])
  })
})

describe('isOrchestrationHost', () => {
  const root = { taskId: null, bindingSource: null }
  it('an unbound root with a self-attached child is a host', () => {
    expect(
      isOrchestrationHost({
        sessions: [root, { taskId: 't', bindingSource: 'ATTACH' }],
      })
    ).toBe(true)
  })
  it('inherited children, unbound children or a bound root are not', () => {
    expect(
      isOrchestrationHost({
        sessions: [root, { taskId: 't', bindingSource: 'INHERITED' }],
      })
    ).toBe(false)
    expect(
      isOrchestrationHost({
        sessions: [root, { taskId: null, bindingSource: null }],
      })
    ).toBe(false)
    expect(
      isOrchestrationHost({
        sessions: [
          { taskId: 't', bindingSource: 'ATTACH' },
          { taskId: 't', bindingSource: 'ATTACH' },
        ],
      })
    ).toBe(false)
    expect(isOrchestrationHost({ sessions: [] })).toBe(false)
  })
})

describe('isBoundRun / summarizeRunAttributions (LUM-1237)', () => {
  const run = (
    mode: RunAttribution['mode'],
    subSources: RunAttribution['subagents'][number]['source'][]
  ): RunAttribution => ({
    mode,
    segments: [],
    approximate: mode === 'INFERRED',
    subagents: subSources.map((source, i) => ({
      sessionId: `${ROOT}:s${i}`,
      agentType: null,
      source,
      confidence: source === 'INFERRED' ? 'HIGH' : 'EXPLICIT',
      evidence: [],
      followsParent: false,
    })),
  })

  it('an auto-detected root with a self-attached subagent on the task is bound', () => {
    expect(isBoundRun(run('INFERRED', ['INFERRED', 'SUBAGENT_ATTACH']))).toBe(
      true
    )
    expect(isBoundRun(run('INFERRED', ['INFERRED']))).toBe(false)
    expect(isBoundRun(run('HOST', ['SUBAGENT_ATTACH']))).toBe(true)
    expect(isBoundRun(run('EXPLICIT', []))).toBe(true)
  })

  it('the Sessions tile counts such a run as bound', () => {
    expect(
      summarizeRunAttributions([
        run('INFERRED', ['SUBAGENT_ATTACH']),
        run('INFERRED', []),
        null,
      ])
    ).toEqual({ explicit: 1, inferred: 1, approximate: true })
  })
})
