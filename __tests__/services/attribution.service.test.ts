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
    resolveIdentifiers: jest.fn(),
    taskIdsForBranches: jest.fn(),
    replaceFamilySegments: jest.fn(),
  },
}))

import {
  attributionRepository,
  type SessionFamily,
} from '@/lib/repositories/attribution.repository'
import {
  attributionInternals,
  attributionService,
} from '@/lib/services/attribution.service'

const repo = attributionRepository as unknown as Record<
  | 'loadFamily'
  | 'resolveIdentifiers'
  | 'taskIdsForBranches'
  | 'replaceFamilySegments',
  jest.Mock
>

const ROOT = 'root-uuid'
const CHILD = `${ROOT}:a1`
const t = (s: number) => new Date(Date.UTC(2026, 9, 2, 0, 0, s))

type Ev = {
  sessionId: string
  type: string
  createdAt: Date
  attributionSignals: unknown
  payload: unknown
  payloadPrunedAt: Date | null
}

function ev(partial: Partial<Ev> & Pick<Ev, 'type' | 'createdAt'>): Ev {
  return {
    sessionId: ROOT,
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
    ...over,
  }
}

function family(sessions: unknown[], events: Ev[]): SessionFamily {
  return { workspaceId: 'ws', sessions, events } as unknown as SessionFamily
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

function writtenRows(): Row[] {
  expect(repo.replaceFamilySegments).toHaveBeenCalledTimes(1)
  return repo.replaceFamilySegments.mock.calls[0]![1] as Row[]
}

beforeEach(() => {
  for (const fn of Object.values(repo)) fn.mockReset()
  repo.resolveIdentifiers.mockImplementation(
    async (_ws: string, ids: string[]) =>
      new Map(ids.filter(i => i === 'LUM-12').map(i => [i, 'task_12']))
  )
  repo.taskIdsForBranches.mockResolvedValue(new Map())
  repo.replaceFamilySegments.mockResolvedValue(undefined)
})

describe('attributionService.recomputeFamily', () => {
  it('returns null when the family does not exist', async () => {
    repo.loadFamily.mockResolvedValue(null)
    await expect(attributionService.recomputeFamily(ROOT)).resolves.toBeNull()
    expect(repo.replaceFamilySegments).not.toHaveBeenCalled()
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

    await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual({
      segments: 4,
    })
    expect(repo.resolveIdentifiers).not.toHaveBeenCalled()
    expect(repo.taskIdsForBranches).not.toHaveBeenCalled()
    expect(repo.replaceFamilySegments.mock.calls[0]![0]).toEqual([
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
    await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual({
      segments: 1,
    })
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
    await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual({
      segments: 0,
    })
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
    await expect(attributionService.recomputeFamily(ROOT)).resolves.toEqual({
      segments: 0,
    })
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
