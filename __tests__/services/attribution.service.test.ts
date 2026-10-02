/**
 * @jest-environment node
 *
 * LUM-932 P2 Task 5: recompute a session family's attribution segments
 * (observe-only mode). The repository is mocked; the real engine runs.
 */
jest.mock('@/lib/repositories/attribution.repository', () => ({
  ATTRIBUTION_COMPUTE_VERSION: 1,
  attributionRepository: {
    loadFamily: jest.fn(),
    loadBoundFamilyShape: jest.fn(),
    listFamilySegments: jest.fn(),
    resolveIdentifiers: jest.fn(),
    taskIdsForBranches: jest.fn(),
    commitFamilyAttribution: jest.fn(),
  },
}))

const loggerWarn = jest.fn()
jest.mock('@/lib/logger', () => ({
  logger: { warn: (...a: unknown[]) => loggerWarn(...a) },
}))

import {
  attributionRepository,
  type SessionFamily,
} from '@/lib/repositories/attribution.repository'
import {
  attributionInternals,
  attributionService,
  eventTaskAssignments,
} from '@/lib/services/attribution.service'
import type { SegmentRow } from '@/lib/repositories/attribution.repository'

const repo = attributionRepository as unknown as Record<
  | 'loadFamily'
  | 'loadBoundFamilyShape'
  | 'listFamilySegments'
  | 'resolveIdentifiers'
  | 'taskIdsForBranches'
  | 'commitFamilyAttribution',
  jest.Mock
>

const ROOT = 'root-uuid'
const CHILD = `${ROOT}:a1`
const t = (s: number) => new Date(Date.UTC(2026, 9, 2, 0, 0, s))

type Ev = {
  id: string
  sessionId: string
  taskId: string | null
  type: string
  createdAt: Date
  attributionSignals: unknown
  payload: unknown
  payloadPrunedAt: Date | null
}

let evSeq = 0
function ev(partial: Partial<Ev> & Pick<Ev, 'type' | 'createdAt'>): Ev {
  return {
    id: `ev${++evSeq}`,
    sessionId: ROOT,
    taskId: null,
    attributionSignals: null,
    payload: {},
    payloadPrunedAt: null,
    ...partial,
  }
}

function session(over: Record<string, unknown> = {}) {
  return {
    id: ROOT,
    parentSessionId: null,
    agentId: null,
    taskId: null,
    bindingSource: null,
    startedAt: t(0),
    role: 'IMPLEMENTATION',
    milestoneId: null,
    ...over,
  }
}

function family(sessions: unknown[], events: Ev[]): SessionFamily {
  return {
    workspaceId: 'ws',
    attributionVersion: 0,
    sessions,
    events,
  } as unknown as SessionFamily
}

type Row = {
  sessionId: string
  taskId: string
  source: string
  confidence: string
  fromTurn: number
  toTurn: number
  fromAt: Date
  toAt: Date | null
  evidence: unknown
  computeVersion: number
  workspaceId: string
}

const STALE = {
  sessionId: ROOT,
  taskId: 'task_old',
  fromTurn: 0,
  toTurn: 0,
  fromAt: t(1),
  toAt: null,
  source: 'INFERRED',
  confidence: 'HIGH',
  computeVersion: 1,
  evidence: [],
}

it('an empty family with nothing stored writes nothing', async () => {
  repo.loadFamily.mockResolvedValue(family([session()], []))
  await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual({
    segments: 0,
    written: false,
    eventsUpdated: 0,
    crossingsMoved: 0,
  })
  expect(repo.commitFamilyAttribution).not.toHaveBeenCalled()
})

function writtenRows(): Row[] {
  expect(repo.commitFamilyAttribution).toHaveBeenCalledTimes(1)
  return repo.commitFamilyAttribution.mock.calls[0]![0].segments as Row[]
}

beforeEach(() => {
  for (const fn of Object.values(repo)) fn.mockReset()
  repo.resolveIdentifiers.mockImplementation(
    async (_ws: string, ids: string[]) =>
      new Map(ids.filter(i => i === 'LUM-12').map(i => [i, 'task_12']))
  )
  repo.taskIdsForBranches.mockResolvedValue(new Map())
  repo.commitFamilyAttribution.mockResolvedValue({
    conflict: false,
    eventsUpdated: 0,
    crossingsMoved: 0,
  })
  repo.listFamilySegments.mockResolvedValue([])
  // Bound-root shape derived from the test's loadFamily fixture without
  // recording a loadFamily call.
  repo.loadBoundFamilyShape.mockImplementation(async (id: string) => {
    const f = (await repo.loadFamily.getMockImplementation()?.(id)) as
      | SessionFamily
      | null
      | undefined
    return f && f.sessions[0]?.taskId ? shapeOf(f) : null
  })
})

function shapeOf(f: SessionFamily) {
  const root = f.sessions[0]!
  const firstEventAt = new Map<string, Date>()
  for (const e of f.events) {
    if (e.sessionId && !firstEventAt.has(e.sessionId))
      firstEventAt.set(e.sessionId, e.createdAt)
  }
  return {
    workspaceId: f.workspaceId,
    attributionVersion: f.attributionVersion,
    sessions: f.sessions,
    rootPromptCount: f.events.filter(
      e => e.sessionId === root.id && e.type === 'USER_PROMPT_SUBMIT'
    ).length,
    firstEventAt,
  }
}

describe('attributionService.recomputeFamily', () => {
  it('returns null when the family does not exist', async () => {
    repo.loadFamily.mockResolvedValue(null)
    await expect(attributionService.recomputeFamily(ROOT)).resolves.toBeNull()
    expect(repo.commitFamilyAttribution).not.toHaveBeenCalled()
  })

  it('explicitly bound root writes SESSION_ATTACH + child INHERITED/SUBAGENT_ATTACH without running the engine', async () => {
    repo.loadFamily.mockResolvedValue(
      family(
        [
          session({ taskId: 'task_root', bindingSource: 'ATTACH' }),
          session({
            id: CHILD,
            parentSessionId: ROOT,
            agentId: 'a1',
            taskId: 'task_root',
            bindingSource: 'INHERITED',
            startedAt: t(5),
          }),
          session({
            id: `${ROOT}:a2`,
            parentSessionId: ROOT,
            agentId: 'a2',
            taskId: 'task_other',
            bindingSource: 'ATTACH',
            startedAt: t(6),
          }),
          session({
            id: `${ROOT}:a3`,
            parentSessionId: ROOT,
            agentId: 'a3',
            startedAt: t(7),
          }),
        ],
        [
          ev({ type: 'SESSION_START', createdAt: t(1) }),
          ev({ type: 'USER_PROMPT_SUBMIT', createdAt: t(2) }),
          ev({ type: 'USER_PROMPT_SUBMIT', createdAt: t(3) }),
          ev({ type: 'USER_PROMPT_SUBMIT', createdAt: t(4) }),
          ev({ sessionId: CHILD, type: 'PRE_TOOL_USE', createdAt: t(8) }),
        ]
      )
    )

    await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual(
      expect.objectContaining({ segments: 4, written: true })
    )
    expect(repo.resolveIdentifiers).not.toHaveBeenCalled()
    expect(repo.taskIdsForBranches).not.toHaveBeenCalled()
    expect(repo.commitFamilyAttribution.mock.calls[0]![0].familyIds).toEqual([
      ROOT,
      CHILD,
      `${ROOT}:a2`,
      `${ROOT}:a3`,
    ])
    const rows = writtenRows()
    expect(rows).toEqual([
      {
        workspaceId: 'ws',
        sessionId: ROOT,
        taskId: 'task_root',
        fromTurn: 0,
        toTurn: 2,
        fromAt: t(1),
        toAt: null,
        source: 'SESSION_ATTACH',
        confidence: 'EXPLICIT',
        evidence: [],
        computeVersion: 1,
      },
      expect.objectContaining({
        sessionId: CHILD,
        taskId: 'task_root',
        source: 'INHERITED',
        confidence: 'EXPLICIT',
        fromAt: t(8),
        fromTurn: 0,
        toTurn: 2,
        toAt: null,
      }),
      expect.objectContaining({
        sessionId: `${ROOT}:a2`,
        taskId: 'task_other',
        source: 'SUBAGENT_ATTACH',
        confidence: 'EXPLICIT',
        fromAt: t(6),
      }),
      expect.objectContaining({
        sessionId: `${ROOT}:a3`,
        taskId: 'task_root',
        source: 'INHERITED',
        confidence: 'EXPLICIT',
      }),
    ])
  })

  it('bound root with no events falls back to the root startedAt', async () => {
    repo.loadFamily.mockResolvedValue(
      family([session({ taskId: 'task_root', startedAt: t(9) })], [])
    )
    await attributionService.recomputeFamily(ROOT)
    expect(writtenRows()).toEqual([
      expect.objectContaining({ fromAt: t(9), fromTurn: 0, toTurn: 0 }),
    ])
  })

  it('stored [] means computed-empty: no payload extraction', async () => {
    repo.loadFamily.mockResolvedValue(
      family(
        [session()],
        [
          ev({ type: 'USER_PROMPT_SUBMIT', createdAt: t(1) }),
          ev({
            type: 'PRE_TOOL_USE',
            createdAt: t(2),
            attributionSignals: [],
            payload: {
              tool_name: 'Bash',
              tool_input: { command: 'lumo verify LUM-12' },
            },
          }),
        ]
      )
    )
    // A previously stored segment is now stale: the family is cleared.
    repo.listFamilySegments.mockResolvedValue([STALE])
    await attributionService.recomputeFamily(ROOT)
    expect(repo.resolveIdentifiers).not.toHaveBeenCalled()
    expect(writtenRows()).toEqual([])
  })

  it('canonicalises LUM-012 before resolving and lookup', async () => {
    repo.loadFamily.mockResolvedValue(
      family(
        [session()],
        [
          ev({ type: 'USER_PROMPT_SUBMIT', createdAt: t(1) }),
          ev({
            type: 'PRE_TOOL_USE',
            createdAt: t(2),
            attributionSignals: [{ kind: 'LUMO_CMD', identifier: 'LUM-012' }],
          }),
        ]
      )
    )
    await attributionService.recomputeFamily(ROOT)
    expect(repo.resolveIdentifiers).toHaveBeenCalledWith('ws', ['LUM-12'])
    expect(writtenRows()).toEqual([
      expect.objectContaining({ taskId: 'task_12', source: 'INFERRED' }),
    ])
  })

  it('bound root: an un-attached child inherits the root task', async () => {
    repo.loadFamily.mockResolvedValue(
      family(
        [
          session({ taskId: 'task_root' }),
          session({ id: CHILD, parentSessionId: ROOT, agentId: 'a1' }),
        ],
        []
      )
    )
    await attributionService.recomputeFamily(ROOT)
    expect(writtenRows()).toEqual([
      expect.objectContaining({ sessionId: ROOT, source: 'SESSION_ATTACH' }),
      expect.objectContaining({
        sessionId: CHILD,
        taskId: 'task_root',
        source: 'INHERITED',
        confidence: 'EXPLICIT',
      }),
    ])
  })

  it('unbound root: stored LUMO_CMD LUM-12 signal resolves to an INFERRED/HIGH segment', async () => {
    repo.loadFamily.mockResolvedValue(
      family(
        [session()],
        [
          ev({ type: 'USER_PROMPT_SUBMIT', createdAt: t(1) }),
          ev({
            type: 'PRE_TOOL_USE',
            createdAt: t(2),
            attributionSignals: [{ kind: 'LUMO_CMD', identifier: 'LUM-12' }],
          }),
        ]
      )
    )
    await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual(
      expect.objectContaining({ segments: 1, written: true })
    )
    expect(repo.resolveIdentifiers).toHaveBeenCalledTimes(1)
    expect(repo.resolveIdentifiers).toHaveBeenCalledWith('ws', ['LUM-12'])
    const [row] = writtenRows()
    expect(row).toMatchObject({
      workspaceId: 'ws',
      sessionId: ROOT,
      taskId: 'task_12',
      source: 'INFERRED',
      confidence: 'HIGH',
      computeVersion: 1,
    })
    expect(row!.evidence).toEqual([
      { kind: 'LUMO_CMD', identifier: 'LUM-12', at: t(2).toISOString() },
    ])
  })

  it('historical event (null signals, unpruned payload) is extracted on the fly', async () => {
    repo.loadFamily.mockResolvedValue(
      family(
        [session()],
        [
          ev({ type: 'USER_PROMPT_SUBMIT', createdAt: t(1) }),
          ev({
            type: 'PRE_TOOL_USE',
            createdAt: t(2),
            payload: { _lumo_branch: 'lumo/LUM-12-thing' },
          }),
        ]
      )
    )
    await attributionService.recomputeFamily(ROOT)
    expect(writtenRows()).toEqual([
      expect.objectContaining({ taskId: 'task_12', source: 'INFERRED' }),
    ])
  })

  it('pruned historical payload is not extracted', async () => {
    repo.loadFamily.mockResolvedValue(
      family(
        [session()],
        [
          ev({ type: 'USER_PROMPT_SUBMIT', createdAt: t(1) }),
          ev({
            type: 'PRE_TOOL_USE',
            createdAt: t(2),
            payload: { _lumo_branch: 'lumo/LUM-12-thing' },
            payloadPrunedAt: t(3),
          }),
        ]
      )
    )
    // A previously stored segment is now stale: the family is cleared.
    repo.listFamilySegments.mockResolvedValue([STALE])
    await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual(
      expect.objectContaining({ segments: 0, written: true })
    )
    expect(writtenRows()).toEqual([])
  })

  it('branch without identifier resolves through the PR head-branch map', async () => {
    repo.taskIdsForBranches.mockResolvedValue(
      new Map([['feature/login', 'task_pr']])
    )
    repo.loadFamily.mockResolvedValue(
      family(
        [session()],
        [
          ev({ type: 'USER_PROMPT_SUBMIT', createdAt: t(1) }),
          ev({
            type: 'PRE_TOOL_USE',
            createdAt: t(2),
            attributionSignals: [{ kind: 'BRANCH', branch: 'feature/login' }],
          }),
        ]
      )
    )
    await attributionService.recomputeFamily(ROOT)
    expect(repo.taskIdsForBranches).toHaveBeenCalledWith('ws', [
      'feature/login',
    ])
    const [row] = writtenRows()
    expect(row).toMatchObject({ taskId: 'task_pr', source: 'INFERRED' })
    expect(row!.evidence).toEqual([
      { kind: 'BRANCH', identifier: 'feature/login', at: t(2).toISOString() },
    ])
  })

  it('identifiers missing from the workspace are dropped (no segment)', async () => {
    repo.loadFamily.mockResolvedValue(
      family(
        [session()],
        [
          ev({ type: 'USER_PROMPT_SUBMIT', createdAt: t(1) }),
          ev({
            type: 'PRE_TOOL_USE',
            createdAt: t(2),
            attributionSignals: [{ kind: 'LUMO_CMD', identifier: 'LUM-999' }],
          }),
        ]
      )
    )
    // A previously stored segment is now stale: the family is cleared.
    repo.listFamilySegments.mockResolvedValue([STALE])
    await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual(
      expect.objectContaining({ segments: 0, written: true })
    )
    expect(writtenRows()).toEqual([])
  })

  it('explicitly attached child of an unbound root gets SUBAGENT_ATTACH instead of the engine segment', async () => {
    repo.loadFamily.mockResolvedValue(
      family(
        [
          session(),
          session({
            id: CHILD,
            parentSessionId: ROOT,
            agentId: 'a1',
            taskId: 'task_child',
            bindingSource: 'ATTACH',
            startedAt: t(3),
          }),
        ],
        [
          ev({ type: 'USER_PROMPT_SUBMIT', createdAt: t(1) }),
          ev({
            type: 'PRE_TOOL_USE',
            createdAt: t(2),
            attributionSignals: [{ kind: 'LUMO_CMD', identifier: 'LUM-12' }],
          }),
          ev({ sessionId: CHILD, type: 'PRE_TOOL_USE', createdAt: t(4) }),
        ]
      )
    )
    await attributionService.recomputeFamily(ROOT)
    const rows = writtenRows()
    expect(rows.filter(r => r.sessionId === ROOT)).toEqual([
      expect.objectContaining({ taskId: 'task_12', source: 'INFERRED' }),
    ])
    expect(rows.filter(r => r.sessionId === CHILD)).toEqual([
      expect.objectContaining({
        taskId: 'task_child',
        source: 'SUBAGENT_ATTACH',
        confidence: 'EXPLICIT',
        fromAt: t(4),
        evidence: [],
      }),
    ])
  })

  it('a child id recomputes from its root', async () => {
    repo.loadFamily.mockResolvedValue(family([session()], []))
    await attributionService.recomputeFamily(CHILD)
    expect(repo.loadFamily).toHaveBeenCalledWith(ROOT)
  })
})

describe('attributionInternals.inferFamily', () => {
  it('ignoreExplicit runs the engine for a bound root and keeps engine segments of bound children', async () => {
    const fam = family(
      [
        session({ taskId: 'task_root', bindingSource: 'ATTACH' }),
        session({
          id: CHILD,
          parentSessionId: ROOT,
          agentId: 'a1',
          taskId: 'task_root',
          bindingSource: 'INHERITED',
        }),
      ],
      [
        ev({ type: 'USER_PROMPT_SUBMIT', createdAt: t(1) }),
        ev({
          type: 'PRE_TOOL_USE',
          createdAt: t(2),
          attributionSignals: [{ kind: 'LUMO_CMD', identifier: 'LUM-12' }],
        }),
        ev({ sessionId: CHILD, type: 'PRE_TOOL_USE', createdAt: t(3) }),
      ]
    )
    const out = await attributionInternals.inferFamily(fam, {
      ignoreExplicit: true,
    })
    expect(out.lastRootTurn).toBe(0)
    expect(out.segments.map(s => [s.sessionId, s.taskId])).toEqual([
      [ROOT, 'task_12'],
      [CHILD, 'task_12'],
    ])

    const kept = await attributionInternals.inferFamily(fam, {
      ignoreExplicit: false,
    })
    // Without ignoreExplicit every explicitly bound session's engine segments
    // are dropped (the caller writes explicit segments for them instead).
    expect(kept.segments).toEqual([])
  })
})

describe('attributionService.recomputeFamily write avoidance and bound light path', () => {
  /** `tagged`: the events already carry the task a previous commit backfilled. */
  const unbound = (tagged = false) =>
    family(
      [session()],
      [
        ev({
          type: 'USER_PROMPT_SUBMIT',
          createdAt: t(1),
          taskId: tagged ? 'task_12' : null,
        }),
        ev({
          type: 'PRE_TOOL_USE',
          createdAt: t(2),
          taskId: tagged ? 'task_12' : null,
          attributionSignals: [
            { kind: 'LUMO_CMD', identifier: 'LUM-12' },
            { kind: 'BRANCH', identifier: 'LUM-12', branch: 'lumo/LUM-12' },
          ],
        }),
      ]
    )

  /** Stored form of written rows: no workspaceId, shuffled, jsonb-reordered evidence keys. */
  function stored(rows: Row[]) {
    return rows
      .map(({ workspaceId: _ws, evidence, ...r }) => ({
        ...r,
        evidence: (evidence as Record<string, unknown>[]).map(e =>
          Object.fromEntries(Object.entries(e).reverse())
        ),
      }))
      .reverse()
  }

  it('skips the replace when the recomputed rows equal the stored ones', async () => {
    repo.loadFamily.mockResolvedValue(unbound())
    await attributionService.recomputeFamily(ROOT)
    const first = writtenRows()
    expect(first).toHaveLength(1)
    expect((first[0]!.evidence as unknown[]).length).toBeGreaterThan(0)

    repo.commitFamilyAttribution.mockClear()
    repo.loadFamily.mockResolvedValue(unbound(true))
    repo.listFamilySegments.mockResolvedValue(stored(first))
    await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual(
      expect.objectContaining({ segments: 1, written: false })
    )
    expect(repo.listFamilySegments).toHaveBeenCalledWith([ROOT])
    expect(repo.commitFamilyAttribution).not.toHaveBeenCalled()
  })

  it('replaces when any compared field changed', async () => {
    repo.loadFamily.mockResolvedValue(unbound())
    await attributionService.recomputeFamily(ROOT)
    const first = writtenRows()
    for (const change of [
      { taskId: 'task_other' },
      { toTurn: 5 },
      { confidence: 'MEDIUM' },
      { computeVersion: 0 },
      { evidence: [] },
    ]) {
      repo.commitFamilyAttribution.mockClear()
      repo.listFamilySegments.mockResolvedValue(
        stored(first).map(r => ({ ...r, ...change }))
      )
      await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual(
        expect.objectContaining({ segments: 1, written: true })
      )
      expect(repo.commitFamilyAttribution).toHaveBeenCalledTimes(1)
    }
  })

  it('a bound root builds explicit rows from the light shape and never loads events', async () => {
    repo.loadBoundFamilyShape.mockResolvedValue({
      workspaceId: 'ws',
      sessions: [
        session({ taskId: 'task_root', bindingSource: 'ATTACH' }),
        session({
          id: CHILD,
          parentSessionId: ROOT,
          agentId: 'a1',
          startedAt: t(7),
        }),
      ],
      rootPromptCount: 4,
      firstEventAt: new Map([[ROOT, t(2)]]),
    })
    await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual(
      expect.objectContaining({ segments: 2, written: true })
    )
    expect(repo.loadBoundFamilyShape).toHaveBeenCalledWith(ROOT)
    expect(repo.loadFamily).not.toHaveBeenCalled()
    expect(repo.resolveIdentifiers).not.toHaveBeenCalled()
    expect(writtenRows()).toEqual([
      expect.objectContaining({
        sessionId: ROOT,
        taskId: 'task_root',
        source: 'SESSION_ATTACH',
        fromTurn: 0,
        toTurn: 3,
        fromAt: t(2),
      }),
      expect.objectContaining({
        sessionId: CHILD,
        taskId: 'task_root',
        source: 'INHERITED',
        toTurn: 3,
        fromAt: t(7),
      }),
    ])
  })

  it('an unbound root falls through to the full family load', async () => {
    repo.loadBoundFamilyShape.mockResolvedValue(null)
    repo.loadFamily.mockResolvedValue(unbound())
    await attributionService.recomputeFamily(ROOT)
    expect(repo.loadFamily).toHaveBeenCalledWith(ROOT)
    expect(writtenRows()).toEqual([
      expect.objectContaining({ taskId: 'task_12', source: 'INFERRED' }),
    ])
  })
})

describe('eventTaskAssignments (LUM-932 P3 event backfill)', () => {
  const seg = (
    sessionId: string,
    taskId: string,
    fromAt: Date,
    toAt: Date | null,
    source: SegmentRow['source'] = 'INFERRED'
  ): SegmentRow => ({
    workspaceId: 'ws',
    sessionId,
    taskId,
    fromTurn: 0,
    toTurn: 0,
    fromAt,
    toAt,
    source,
    confidence: 'HIGH',
    evidence: [],
    computeVersion: 1,
  })
  const child = (over: Record<string, unknown> = {}) =>
    session({ id: CHILD, parentSessionId: ROOT, agentId: 'a1', ...over })

  it('matches fromAt inclusive and toAt exclusive, and only reports changes', () => {
    const fam = family(
      [session()],
      [
        ev({
          id: 'before',
          type: 'PRE_TOOL_USE',
          createdAt: t(0),
          taskId: 'stale',
        }),
        ev({ id: 'from', type: 'PRE_TOOL_USE', createdAt: t(1) }),
        ev({
          id: 'mid',
          type: 'PRE_TOOL_USE',
          createdAt: t(4),
          taskId: 'task_a',
        }),
        ev({
          id: 'to',
          type: 'PRE_TOOL_USE',
          createdAt: t(5),
          taskId: 'task_a',
        }),
        ev({ id: 'open', type: 'PRE_TOOL_USE', createdAt: t(9) }),
      ]
    )
    expect(
      eventTaskAssignments(fam, [
        seg(ROOT, 'task_a', t(1), t(5)),
        seg(ROOT, 'task_b', t(5), null),
      ])
    ).toEqual([
      { eventId: 'before', taskId: null },
      { eventId: 'from', taskId: 'task_a' },
      { eventId: 'to', taskId: 'task_b' },
      { eventId: 'open', taskId: 'task_b' },
    ])
  })

  it('ignores non-INFERRED rows', () => {
    const fam = family(
      [session()],
      [ev({ id: 'e', type: 'PRE_TOOL_USE', createdAt: t(2) })]
    )
    expect(
      eventTaskAssignments(fam, [seg(ROOT, 'task_a', t(1), null, 'INHERITED')])
    ).toEqual([])
  })

  it('a child follows the parent where it has no covering segment of its own', () => {
    const fam = family(
      [session(), child()],
      [
        ev({
          id: 'c1',
          sessionId: CHILD,
          type: 'PRE_TOOL_USE',
          createdAt: t(2),
        }),
        ev({
          id: 'c2',
          sessionId: CHILD,
          type: 'PRE_TOOL_USE',
          createdAt: t(6),
        }),
      ]
    )
    // No child rows at all: both follow the root.
    expect(
      eventTaskAssignments(fam, [seg(ROOT, 'task_a', t(1), null)])
    ).toEqual([
      { eventId: 'c1', taskId: 'task_a' },
      { eventId: 'c2', taskId: 'task_a' },
    ])
    // A clipped child segment ends at its last event (exclusive): that last
    // event falls back to the root's segment.
    expect(
      eventTaskAssignments(fam, [
        seg(ROOT, 'task_a', t(1), t(4)),
        seg(ROOT, 'task_b', t(4), null),
        seg(CHILD, 'task_c', t(2), t(6)),
      ])
    ).toEqual([
      { eventId: 'c1', taskId: 'task_c' },
      { eventId: 'c2', taskId: 'task_b' },
    ])
  })

  it('a child entirely before the root head keeps its last event on its clipped segment', () => {
    const fam = family(
      [session(), child()],
      [
        ev({
          id: 'c1',
          sessionId: CHILD,
          type: 'PRE_TOOL_USE',
          createdAt: t(1),
        }),
        ev({
          id: 'c2',
          sessionId: CHILD,
          type: 'PRE_TOOL_USE',
          createdAt: t(3),
        }),
      ]
    )
    // The engine clips the head to [first, last): the root's first segment
    // starts after the child's last event, so no root row covers c2 either.
    expect(
      eventTaskAssignments(fam, [
        seg(ROOT, 'task_a', t(5), null),
        seg(CHILD, 'task_a', t(1), t(3)),
      ])
    ).toEqual([
      { eventId: 'c1', taskId: 'task_a' },
      { eventId: 'c2', taskId: 'task_a' },
    ])
  })

  it('never touches events of explicitly bound sessions or their children', () => {
    const rows = [seg(ROOT, 'task_a', t(1), null)]
    const boundChild = family(
      [session(), child({ taskId: 'task_x', bindingSource: 'ATTACH' })],
      [
        ev({ id: 'r', type: 'PRE_TOOL_USE', createdAt: t(2) }),
        ev({
          id: 'c',
          sessionId: CHILD,
          type: 'PRE_TOOL_USE',
          createdAt: t(3),
        }),
      ]
    )
    expect(eventTaskAssignments(boundChild, rows)).toEqual([
      { eventId: 'r', taskId: 'task_a' },
    ])
    const boundRoot = family(
      [session({ taskId: 'task_x' }), child()],
      [
        ev({ id: 'r', type: 'PRE_TOOL_USE', createdAt: t(2) }),
        ev({
          id: 'c',
          sessionId: CHILD,
          type: 'PRE_TOOL_USE',
          createdAt: t(3),
        }),
      ]
    )
    expect(eventTaskAssignments(boundRoot, rows)).toEqual([])
  })

  it('never backfills a STEWARD session or a child of one', () => {
    const rows = [seg(ROOT, 'task_a', t(1), null)]
    const events = [
      ev({ id: 'r', type: 'PRE_TOOL_USE', createdAt: t(2) }),
      ev({ id: 'c', sessionId: CHILD, type: 'PRE_TOOL_USE', createdAt: t(3) }),
    ]
    const steward = family(
      [session({ role: 'STEWARD', milestoneId: 'ms' }), child()],
      events
    )
    expect(eventTaskAssignments(steward, rows)).toEqual([])
    // STEWARD role without a milestone binding is not a steward binding.
    const unboundSteward = family(
      [session({ role: 'STEWARD', milestoneId: null }), child()],
      events
    )
    expect(eventTaskAssignments(unboundSteward, rows)).toEqual([
      { eventId: 'r', taskId: 'task_a' },
      { eventId: 'c', taskId: 'task_a' },
    ])
  })
})

describe('attributionService.recomputeFamily event backfill and version conflicts', () => {
  const lum12 = (version: number, tagged: boolean) => ({
    ...family(
      [session()],
      [
        ev({
          id: 'p',
          type: 'USER_PROMPT_SUBMIT',
          createdAt: t(1),
          taskId: tagged ? 'task_12' : null,
        }),
        ev({
          id: 'b',
          type: 'PRE_TOOL_USE',
          createdAt: t(2),
          taskId: tagged ? 'task_12' : null,
          attributionSignals: [{ kind: 'LUMO_CMD', identifier: 'LUM-12' }],
        }),
      ]
    ),
    attributionVersion: version,
  })
  const conflict = { conflict: true, eventsUpdated: 0, crossingsMoved: 0 }

  beforeEach(() => loggerWarn.mockReset())

  it('commits segments and event changes with the loaded version', async () => {
    repo.loadFamily.mockResolvedValue(lum12(7, false))
    repo.commitFamilyAttribution.mockResolvedValue({
      conflict: false,
      eventsUpdated: 2,
      crossingsMoved: 1,
    })
    await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual({
      segments: 1,
      written: true,
      eventsUpdated: 2,
      crossingsMoved: 1,
    })
    expect(repo.commitFamilyAttribution).toHaveBeenCalledWith({
      rootSessionId: ROOT,
      expectedVersion: 7,
      familyIds: [ROOT],
      segments: [expect.objectContaining({ taskId: 'task_12' })],
      eventTaskChanges: [
        { eventId: 'p', taskId: 'task_12' },
        { eventId: 'b', taskId: 'task_12' },
      ],
    })
  })

  it('segments unchanged but events stale: commits with segments null', async () => {
    repo.loadFamily.mockResolvedValue(lum12(0, false))
    await attributionService.recomputeFamily(ROOT)
    const rows = writtenRows()
    repo.commitFamilyAttribution.mockClear()
    repo.listFamilySegments.mockResolvedValue(
      rows.map(({ workspaceId: _ws, ...r }) => r)
    )
    repo.commitFamilyAttribution.mockResolvedValue({
      conflict: false,
      eventsUpdated: 2,
      crossingsMoved: 0,
    })
    await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual({
      segments: 1,
      written: false,
      eventsUpdated: 2,
      crossingsMoved: 0,
    })
    expect(repo.commitFamilyAttribution).toHaveBeenCalledWith(
      expect.objectContaining({ segments: null })
    )
  })

  it('no segment and no event change: nothing is committed', async () => {
    repo.loadFamily.mockResolvedValue(lum12(0, true))
    await attributionService.recomputeFamily(ROOT)
    const rows = writtenRows()
    repo.commitFamilyAttribution.mockClear()
    repo.listFamilySegments.mockResolvedValue(
      rows.map(({ workspaceId: _ws, ...r }) => r)
    )
    await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual({
      segments: 1,
      written: false,
      eventsUpdated: 0,
      crossingsMoved: 0,
    })
    expect(repo.commitFamilyAttribution).not.toHaveBeenCalled()
  })

  it('a version conflict re-reads, recomputes and retries with the new version', async () => {
    repo.loadFamily
      .mockResolvedValueOnce(lum12(3, false))
      .mockResolvedValueOnce(lum12(4, false))
    repo.commitFamilyAttribution
      .mockResolvedValueOnce(conflict)
      .mockResolvedValueOnce({
        conflict: false,
        eventsUpdated: 2,
        crossingsMoved: 0,
      })
    await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual({
      segments: 1,
      written: true,
      eventsUpdated: 2,
      crossingsMoved: 0,
    })
    expect(repo.loadFamily).toHaveBeenCalledTimes(2)
    expect(
      repo.commitFamilyAttribution.mock.calls.map(c => c[0].expectedVersion)
    ).toEqual([3, 4])
    expect(loggerWarn).not.toHaveBeenCalled()
  })

  it('gives up after two retries, logs, and reports the conflict', async () => {
    repo.loadFamily.mockResolvedValue(lum12(0, false))
    repo.commitFamilyAttribution.mockResolvedValue(conflict)
    await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual({
      segments: 1,
      written: false,
      eventsUpdated: 0,
      crossingsMoved: 0,
      conflict: true,
    })
    // One attempt plus two retries.
    expect(repo.commitFamilyAttribution).toHaveBeenCalledTimes(3)
    expect(loggerWarn).toHaveBeenCalledWith(
      'attribution recompute gave up after version conflicts',
      expect.objectContaining({ rootSessionId: ROOT })
    )
  })

  it('an explicitly bound root never produces event changes', async () => {
    repo.loadFamily.mockResolvedValue(
      family(
        [session({ taskId: 'task_root', bindingSource: 'ATTACH' })],
        [ev({ id: 'x', type: 'PRE_TOOL_USE', createdAt: t(1) })]
      )
    )
    await attributionService.recomputeFamily(ROOT)
    expect(repo.commitFamilyAttribution).toHaveBeenCalledWith(
      expect.objectContaining({ eventTaskChanges: [] })
    )
  })
})

describe('STEWARD families are never inferred (LUM-932 P3 I2)', () => {
  it('writes no INFERRED segment for a STEWARD root and clears stale ones', async () => {
    repo.loadFamily.mockResolvedValue(
      family(
        [session({ role: 'STEWARD', milestoneId: 'ms_1' })],
        [
          ev({ type: 'USER_PROMPT_SUBMIT', createdAt: t(1) }),
          ev({
            type: 'PRE_TOOL_USE',
            createdAt: t(2),
            attributionSignals: [{ kind: 'LUMO_CMD', identifier: 'LUM-12' }],
          }),
        ]
      )
    )
    repo.listFamilySegments.mockResolvedValue([STALE])
    await attributionService.recomputeFamily(ROOT)
    const rows = writtenRows()
    expect(rows.filter(r => r.source === 'INFERRED')).toEqual([])
    expect(
      repo.commitFamilyAttribution.mock.calls[0]![0].eventTaskChanges
    ).toEqual([])
  })

  it('a STEWARD root with nothing stored writes nothing', async () => {
    repo.loadFamily.mockResolvedValue(
      family(
        [session({ role: 'STEWARD', milestoneId: 'ms_1' })],
        [
          ev({ type: 'USER_PROMPT_SUBMIT', createdAt: t(1) }),
          ev({
            type: 'PRE_TOOL_USE',
            createdAt: t(2),
            attributionSignals: [{ kind: 'LUMO_CMD', identifier: 'LUM-12' }],
          }),
        ]
      )
    )
    await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual(
      expect.objectContaining({ segments: 0, written: false })
    )
    expect(repo.commitFamilyAttribution).not.toHaveBeenCalled()
  })
})
