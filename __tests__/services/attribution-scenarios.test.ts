/**
 * @jest-environment node
 *
 * LUM-932 P2: end-to-end attribution scenarios. Signals come from the real
 * extractAttributionSignals over raw hook payloads; only the repository is
 * mocked, and the segments written by recomputeFamily are asserted.
 */
jest.mock('@/lib/repositories/attribution.repository', () => ({
  ATTRIBUTION_COMPUTE_VERSION: 1,
  attributionRepository: {
    loadFamily: jest.fn(),
    loadBoundFamilyShape: jest.fn(),
    resolveIdentifiers: jest.fn(),
    taskIdsForBranches: jest.fn(),
    listFamilySegments: jest.fn(),
    replaceFamilySegments: jest.fn(),
  },
}))

import { attributionRepository } from '@/lib/repositories/attribution.repository'
import type {
  FamilyEvent,
  FamilySession,
  SegmentRow,
} from '@/lib/repositories/attribution.repository'
import { attributionService } from '@/lib/services/attribution.service'
import { extractAttributionSignals } from '@/lib/attribution/signals'

const repo = attributionRepository as unknown as Record<
  | 'loadFamily'
  | 'loadBoundFamilyShape'
  | 'resolveIdentifiers'
  | 'taskIdsForBranches'
  | 'listFamilySegments'
  | 'replaceFamilySegments',
  jest.Mock
>

const TASKS: Record<string, string> = {
  'LUM-12': 't12',
  'LUM-13': 't13',
  'LUM-30': 't30',
}
const ROOT = 'root-session'
const AGENT = 'agent1'
const CHILD = `${ROOT}:${AGENT}`
const B12 = 'lumo/LUM-12-x'
const B13 = 'lumo/LUM-13-y'

let clock = 0
let seq = 0

function ev(
  sessionId: string,
  type: string,
  branch: string,
  extra: Record<string, unknown> = {}
): FamilyEvent {
  const payload = {
    _lumo_branch: branch,
    cwd: `/work/${branch}`,
    ...extra,
  }
  clock += 1000
  return {
    id: `e${++seq}`,
    sessionId,
    type,
    createdAt: new Date(Date.UTC(2026, 9, 2, 0, 0, 0) + clock),
    attributionSignals: extractAttributionSignals(
      type,
      payload
    ) as unknown as FamilyEvent['attributionSignals'],
    payload: null,
    payloadPrunedAt: null,
  }
}

const prompt = (s: string, branch: string, text: string) =>
  ev(s, 'USER_PROMPT_SUBMIT', branch, { prompt: text })
const bash = (s: string, branch: string, command: string) =>
  ev(s, 'PRE_TOOL_USE', branch, { tool_name: 'Bash', tool_input: { command } })
const read = (s: string, branch: string) =>
  ev(s, 'PRE_TOOL_USE', branch, {
    tool_name: 'Read',
    tool_input: { file_path: '/work/a.ts' },
  })

function session(
  id: string,
  extra: Partial<FamilySession> = {}
): FamilySession {
  return {
    id,
    parentSessionId: null,
    agentId: null,
    taskId: null,
    bindingSource: null,
    startedAt: new Date(Date.UTC(2026, 9, 2)),
    ...extra,
  }
}

const childSession = () =>
  session(CHILD, { parentSessionId: ROOT, agentId: AGENT })

async function run(
  events: FamilyEvent[],
  withChild = false
): Promise<SegmentRow[]> {
  repo.loadFamily.mockResolvedValue({
    workspaceId: 'ws',
    sessions: [session(ROOT), ...(withChild ? [childSession()] : [])],
    events: [...events].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    ),
  })
  const res = await attributionService.recomputeFamily(ROOT)
  expect(res).toEqual({ segments: expect.any(Number), written: true })
  expect(repo.replaceFamilySegments).toHaveBeenCalledTimes(1)
  return repo.replaceFamilySegments.mock.calls[0]![1] as SegmentRow[]
}

const of = (rows: SegmentRow[], id: string) =>
  rows.filter(r => r.sessionId === id).sort((a, b) => a.fromTurn - b.fromTurn)

beforeEach(() => {
  jest.resetAllMocks()
  clock = 0
  seq = 0
  repo.loadBoundFamilyShape.mockResolvedValue(null)
  repo.listFamilySegments.mockResolvedValue([])
  repo.replaceFamilySegments.mockResolvedValue(undefined)
  repo.taskIdsForBranches.mockResolvedValue(new Map())
  repo.resolveIdentifiers.mockImplementation(
    async (_ws: string, ids: string[]) =>
      new Map(ids.filter(i => TASKS[i]).map(i => [i, TASKS[i]!]))
  )
})

describe('attribution scenarios under the branch ruling', () => {
  it('1: a whole session of LUM-12 work on its branch is one INFERRED HIGH segment for t12', async () => {
    const rows = await run([
      prompt(ROOT, B12, 'fix the login bug'),
      bash(ROOT, B12, 'lumo verify LUM-12'),
      prompt(ROOT, B12, 'now commit it'),
      bash(ROOT, B12, 'git commit -m "fix: login [LUM-12]"'),
    ])
    const segs = of(rows, ROOT)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({
      taskId: 't12',
      source: 'INFERRED',
      confidence: 'HIGH',
      fromTurn: 0,
      toTurn: 1,
    })
  })

  it('2: reading another task with lumo task show/context does not switch away from t12', async () => {
    const rows = await run([
      prompt(ROOT, B12, 'check how LUM-30 handled this'),
      bash(ROOT, B12, 'lumo task show LUM-30'),
      bash(ROOT, B12, 'lumo task context LUM-30'),
      read(ROOT, B12),
      prompt(ROOT, B12, 'ok keep going'),
      read(ROOT, B12),
    ])
    const segs = of(rows, ROOT)
    expect(segs).toHaveLength(1)
    expect(segs[0]!.taskId).toBe('t12')
  })

  it('3: a one-off lumo verify LUM-13 and a [LUM-13] commit on the LUM-12 branch do not switch (ruling C)', async () => {
    const rows = await run([
      prompt(ROOT, B12, 'start on the work'),
      read(ROOT, B12),
      read(ROOT, B12),
      prompt(ROOT, B12, 'verify the neighbour and commit'),
      read(ROOT, B12),
      read(ROOT, B12),
      read(ROOT, B12),
      bash(ROOT, B12, 'lumo verify LUM-13'),
      bash(ROOT, B12, 'git commit -m "chore: tidy [LUM-13]"'),
      read(ROOT, B12),
    ])
    const segs = of(rows, ROOT)
    expect(segs).toHaveLength(1)
    expect(segs[0]!.taskId).toBe('t12')
  })

  it('4: changing branch to LUM-13 opens a t13 segment from that turn and closes the first', async () => {
    const rows = await run([
      prompt(ROOT, B12, 'work on twelve'),
      read(ROOT, B12),
      prompt(ROOT, B12, 'more twelve'),
      read(ROOT, B12),
      prompt(ROOT, B13, 'now the other branch'),
      read(ROOT, B13),
      read(ROOT, B13),
    ])
    const segs = of(rows, ROOT)
    expect(segs).toHaveLength(2)
    expect(segs[0]).toMatchObject({ taskId: 't12', fromTurn: 0, toTurn: 1 })
    expect(segs[0]!.toAt).not.toBeNull()
    expect(segs[1]).toMatchObject({
      taskId: 't13',
      fromTurn: 2,
      toTurn: 2,
      toAt: null,
    })
  })

  it('5: on main with no id in the branch, commands naming LUM-12 drive a HIGH t12 segment', async () => {
    const rows = await run([
      prompt(ROOT, 'main', 'please work on this'),
      bash(ROOT, 'main', 'lumo task context LUM-12'),
      bash(ROOT, 'main', 'lumo verify LUM-12'),
      bash(ROOT, 'main', 'git commit -m "feat: thing [LUM-12]"'),
    ])
    const segs = of(rows, ROOT)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ taskId: 't12', confidence: 'HIGH' })
  })

  it('6: a subagent on the parent branch running lumo verify LUM-13 stays on t12 like the parent (ruling C)', async () => {
    const rows = await run(
      [
        prompt(ROOT, B12, 'delegate the check'),
        read(ROOT, B12),
        bash(CHILD, B12, 'lumo verify LUM-13'),
        read(CHILD, B12),
        read(CHILD, B12),
        read(ROOT, B12),
      ],
      true
    )
    expect(of(rows, ROOT).map(r => r.taskId)).toEqual(['t12'])
    const child = of(rows, CHILD)
    expect(child).toHaveLength(1)
    expect(child[0]!.taskId).toBe('t12')
  })

  it('7: a subagent in its own LUM-13 worktree branch is HIGH t13 while the parent stays t12', async () => {
    const rows = await run(
      [
        prompt(ROOT, B12, 'spin up a helper'),
        read(ROOT, B12),
        read(CHILD, B13),
        bash(CHILD, B13, 'git status'),
        read(CHILD, B13),
        read(ROOT, B12),
      ],
      true
    )
    expect(of(rows, ROOT).map(r => r.taskId)).toEqual(['t12'])
    const child = of(rows, CHILD)
    expect(child).toHaveLength(1)
    expect(child[0]).toMatchObject({ taskId: 't13', confidence: 'HIGH' })
  })

  it('8: a dispatch prompt alone attributes a signal-less child on main to t13 at MEDIUM', async () => {
    const dispatch = ev(ROOT, 'POST_TOOL_USE', 'main', {
      tool_name: 'Agent',
      tool_input: { prompt: 'Implement LUM-13' },
      tool_response: { agentId: AGENT },
    })
    const rows = await run(
      [
        prompt(ROOT, 'main', 'hand this out'),
        dispatch,
        read(CHILD, 'main'),
        read(CHILD, 'main'),
        read(ROOT, 'main'),
      ],
      true
    )
    expect(of(rows, ROOT)).toHaveLength(0)
    const child = of(rows, CHILD)
    expect(child).toHaveLength(1)
    expect(child[0]).toMatchObject({ taskId: 't13', confidence: 'MEDIUM' })
  })

  it('9: a pasted backlog of five task ids yields no PROMPT signal and creates no segment', async () => {
    const text = 'backlog: LUM-12, LUM-13, LUM-30, LUM-14, LUM-15'
    const pasted = prompt(ROOT, 'main', text)
    expect(pasted.attributionSignals).toEqual([])
    repo.loadFamily.mockResolvedValue({
      workspaceId: 'ws',
      sessions: [session(ROOT)],
      events: [pasted, read(ROOT, 'main')],
    })
    const res = await attributionService.recomputeFamily(ROOT)
    expect(res).toEqual({ segments: 0, written: false })
    expect(repo.replaceFamilySegments).not.toHaveBeenCalled()
  })

  it('10: lumo session attach LUM-30 in an unbound session is not a signal and yields no t30 segment', async () => {
    const attach = bash(ROOT, 'main', 'lumo session attach LUM-30')
    expect(attach.attributionSignals).toEqual([])
    repo.loadFamily.mockResolvedValue({
      workspaceId: 'ws',
      sessions: [session(ROOT)],
      events: [prompt(ROOT, 'main', 'attach me'), attach],
    })
    await attributionService.recomputeFamily(ROOT)
    const rows = (repo.replaceFamilySegments.mock.calls[0]?.[1] ??
      []) as SegmentRow[]
    expect(rows.some(r => r.taskId === 't30')).toBe(false)
  })
})
