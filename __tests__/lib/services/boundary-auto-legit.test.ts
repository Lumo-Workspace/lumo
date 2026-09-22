/**
 * @jest-environment node
 *
 * LUM-478 — auto-resolve a DETERMINISTIC high-confidence legit TEST_TAMPERING.
 *
 * 463 downgraded a legit test edit to LOW but still recorded it OPEN, so a
 * clearly-legit update still queued for human disposition and could still block
 * DONE. LUM-478 splits the LEGIT branch by confidence: a DETERMINISTIC pre-filter
 * LEGIT (production code co-changed AND assertions intact) is recorded for audit
 * but auto-resolved with a SYSTEM `AUTO_LEGIT` disposition — out of the open
 * queue, non-DONE-blocking. A judge-only (LLM) LEGIT and any WEAKENING/AMBIGUOUS
 * are unchanged (still human-dispositioned / still blocking).
 *
 * A stateful in-memory crossing store is shared by the recorder (detectAndRecord),
 * the DONE gate (updateTask) and the human disposition service, so these prove
 * real behaviour end to end — not just that a column was written.
 */
import { boundaryDetectorService } from '@/lib/services/boundary-detector.service'
import { updateTask } from '@/lib/services/task-state.service'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { POST as dispositionPOST } from '@/app/api/tasks/[id]/boundary-crossings/disposition/route'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { judgeTestTampering } from '@/lib/llm/test-tampering-judge-client'
import { taskRepository } from '@/lib/repositories/task.repository'

// --- shared in-memory crossing store -----------------------------------------
type Row = {
  id: string
  taskId: string
  category: string
  detail: string
  target: string | null
  severity: string
  disposition: string | null
  dispositionNote: string | null
  dispositionedAt: Date | null
  dispositionedById: string | null
}
let store: Row[] = []
let seq = 0

// LUM-732: the DONE gate now consults the PR security scan. No linked PR here,
// so the real gate short-circuits before touching the scan repository.
// LUM-812: the DONE gate now consults the test-case plane fail-closed (a proven,
// undispositioned defect blocks). Default it to "no test cases" so this suite
// keeps isolating what it was written for.
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    listForTask: jest.fn(() => Promise.resolve([])),
    runsPerCase: jest.fn(() => Promise.resolve(new Map())),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findManyForSecurityByTaskId: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    create: jest.fn(async (input: Record<string, unknown>) => {
      const row: Row = {
        id: `bc-${++seq}`,
        taskId: input.taskId as string,
        category: input.category as string,
        detail: input.detail as string,
        target: (input.target as string | null) ?? null,
        severity: input.severity as string,
        disposition: (input.disposition as string | null) ?? null,
        dispositionNote: (input.dispositionNote as string | null) ?? null,
        dispositionedAt: (input.dispositionedAt as Date | null) ?? null,
        // create() deliberately carries NO dispositionedById — a system
        // auto-resolution has no human actor (the distinctness invariant).
        dispositionedById: (input.dispositionedById as string | null) ?? null,
      }
      store.push(row)
      return { id: row.id }
    }),
    // LUM-477: only OPEN (disposition: null) rows coalesce.
    coalesceRecurrence: jest.fn(
      async (taskId: string, category: string, target: string | null) => {
        if (target == null) return 0
        const hits = store.filter(
          r =>
            r.taskId === taskId &&
            r.category === category &&
            r.target === target &&
            r.disposition == null
        )
        return hits.length
      }
    ),
    findUndispositionedByTask: jest.fn(async (taskId: string) =>
      store.filter(r => r.taskId === taskId && r.disposition == null)
    ),
    findById: jest.fn(
      async (id: string) => store.find(r => r.id === id) ?? null
    ),
    // LUM-450: unconditional re-disposition — flips ANY row, and a null target
    // reverts the whole disposition tuple back to OPEN.
    disposition: jest.fn(
      async (
        id: string,
        disp: string | null,
        note: string | null,
        actorId: string | null,
        now: Date
      ) => {
        const r = store.find(x => x.id === id)
        if (!r) return { count: 0 }
        r.disposition = disp
        r.dispositionNote = disp === null ? null : note
        r.dispositionedAt = disp === null ? null : now
        r.dispositionedById = disp === null ? null : actorId
        return { count: 1 }
      }
    ),
    isGateEnabledForWorkspace: jest.fn(async () => true),
  },
}))

// --- detection deps -----------------------------------------------------------
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn(), listByTaskAndType: jest.fn() },
}))
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  verificationRunRepository: {
    criterionIdsEverPassed: jest.fn(),
    latestRunsByCriterion: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findByTaskId: jest.fn() },
}))
jest.mock('@/lib/llm/test-tampering-judge-client', () => ({
  judgeTestTampering: jest.fn(),
}))

// --- gate + human-disposition deps -------------------------------------------
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findForUpdate: jest.fn(), update: jest.fn() },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findByIdSimple: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    findByTask: jest.fn(() => []),
    syncTaskTags: jest.fn(),
    addTaskTags: jest.fn(),
    removeTaskTags: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(async () => ({ id: 'actor-1' })),
  },
}))

// --- route (human-only redline) deps -----------------------------------------
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/api/resolve-task-param', () => ({
  resolveTaskParam: jest.fn(),
}))

const createCrossing = boundaryCrossingRepository.create as jest.Mock
const createActivity = activityRepository.create as jest.Mock
const listByTask = acceptanceCriterionRepository.listByTask as jest.Mock
const listActivity = activityRepository.listByTaskAndType as jest.Mock
const everPassed = verificationRunRepository.criterionIdsEverPassed as jest.Mock
const latestRuns = verificationRunRepository.latestRunsByCriterion as jest.Mock
const findEvents = hookEventRepository.findByTaskId as jest.Mock
const judge = judgeTestTampering as jest.Mock
const findForUpdate = taskRepository.findForUpdate as jest.Mock
const update = taskRepository.update as jest.Mock
const mockIdentity = requireIdentity as jest.Mock

const CHECKPOINTER =
  "npx tsx scripts/jest-t.ts 'the widget renders' __tests__/widget.test.ts"
const TEST_FILE = '/Users/dev/repo/__tests__/widget.test.ts'

const machineCriterion = {
  id: 'crit-1',
  taskId: 't-1',
  statement: 'the widget renders',
  verifierType: 'MACHINE' as const,
  checkpointer: CHECKPOINTER,
  evidenceRequired: false,
  source: 'AGENT_DRAFT' as const,
  addedAtRound: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
}

/** An Edit event on the checkpointer's test file. */
const editEvent = (oldString: string, newString: string) => ({
  taskId: 't-1',
  hookEventId: 'evt-1',
  toolName: 'Edit',
  filePath: TEST_FILE,
  payload: {
    tool_input: {
      file_path: TEST_FILE,
      old_string: oldString,
      new_string: newString,
    },
  },
})

/** A production (non-test) write event — Signal A co-change evidence. */
const productionEvent = {
  toolName: 'Edit',
  payload: {
    tool_input: {
      file_path: '/Users/dev/repo/lib/widget.ts',
      old_string: 'export const sum = (a: number, b: number) => a + b',
      new_string: 'export const sum = (a: number, b: number) => a + b + 0',
    },
  },
}

// A non-weakening (value-only) edit: same expect count, same strong matcher.
const LEGIT_OLD = 'it("adds", () => { expect(sum(1, 2)).toBe(3) })'
const LEGIT_NEW = 'it("adds", () => { expect(sum(2, 2)).toBe(4) })'
// A weakening edit: an assertion is removed.
const WEAK_OLD = 'it("adds", () => { expect(x).toBe(1); expect(y).toBe(2) })'
const WEAK_NEW = 'it("adds", () => { expect(x).toBe(1) })'

const TASK = {
  id: 't-1',
  status: 'IN_REVIEW',
  projectId: 'p-1',
  project: { workspaceId: 'w-1' },
  sprintId: null,
  assigneeActorId: null,
  parentTaskId: null,
}
const ATTRIB = { actorMemberId: 'member-1', actorClerkId: 'clerk-1' }

beforeEach(() => {
  jest.clearAllMocks()
  store = []
  seq = 0
  listByTask.mockResolvedValue([machineCriterion])
  everPassed.mockResolvedValue(new Set(['crit-1'])) // green → past the authoring gate
  listActivity.mockResolvedValue([]) // signal C: criterion not edited
  findEvents.mockResolvedValue([]) // signal A: default no co-change
  judge.mockResolvedValue('WEAKENING') // default residual → flag
  createActivity.mockResolvedValue({ id: 'act-1' })
  // Gate deps.
  findForUpdate.mockResolvedValue({ ...TASK })
  update.mockResolvedValue({
    ...TASK,
    status: 'DONE',
    team: { identifier: 'LUM' },
    teamId: 'team-1',
  })
  latestRuns.mockResolvedValue(new Map()) // no unresolved send-back
  mockIdentity.mockResolvedValue({
    clerkId: 'clerk-1',
    memberId: 'member-1',
    workspaceId: 'w-1',
    source: 'clerk',
  })
  ;(resolveTaskParam as jest.Mock).mockResolvedValue({ id: 't-1' })
})

describe('LUM-478 — deterministic auto-legit TEST_TAMPERING', () => {
  it('deterministic high-confidence legit test edit is recorded but auto-resolved, out of the queue and non-blocking', async () => {
    // Production code co-changed (Signal A) + assertions intact (Signal B) →
    // the deterministic pre-filter returns LEGIT, no LLM judge consulted.
    findEvents.mockResolvedValue([productionEvent])

    await boundaryDetectorService.detectAndRecord(
      editEvent(LEGIT_OLD, LEGIT_NEW)
    )

    // RECORDED (on the audit trail) but AUTO-RESOLVED with the system disposition.
    expect(createCrossing).toHaveBeenCalledTimes(1)
    const arg = createCrossing.mock.calls[0]![0] as Record<string, unknown>
    expect(arg.category).toBe('TEST_TAMPERING')
    expect(arg.severity).toBe('LOW')
    expect(arg.disposition).toBe('AUTO_LEGIT')
    expect(arg.dispositionedAt).toBeInstanceOf(Date)
    // No human actor — that null is what distinguishes it from a human ruling.
    expect(arg).not.toHaveProperty('dispositionedById')
    // The judge was never consulted (deterministic decision).
    expect(judge).not.toHaveBeenCalled()

    // OUT OF THE OPEN QUEUE: the gate's undispositioned query excludes it.
    const open =
      await boundaryCrossingRepository.findUndispositionedByTask('t-1')
    expect(open).toHaveLength(0)

    // NON-BLOCKING: the DONE transition flows even though the crossing exists.
    await expect(updateTask('t-1', { status: 'DONE' })).resolves.toBeDefined()
    expect(update).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ status: 'DONE' })
    )

    // STILL ON RECORD: the crossing is persisted, auditable, AUTO_LEGIT.
    expect(store).toHaveLength(1)
    expect(store[0]!.disposition).toBe('AUTO_LEGIT')
    expect(store[0]!.dispositionNote).toMatch(/auto-resolved/i)
  })

  it('only deterministic legit auto-resolves; judge-legit stays human-dispositioned and weakening still blocks', async () => {
    // (a) JUDGE-only LEGIT — pre-filter AMBIGUOUS (no co-change, not weakened),
    // the LLM judge rules LEGIT. Downgraded to LOW but recorded OPEN: NOT
    // auto-resolved (the LLM is not trusted to auto-clear the gate).
    findEvents.mockResolvedValue([]) // no production co-change → AMBIGUOUS
    judge.mockResolvedValue('LEGIT')
    await boundaryDetectorService.detectAndRecord(
      editEvent('expect(a).toBe(1)', 'expect(a).toBe(2)')
    )
    expect(judge).toHaveBeenCalledTimes(1)
    expect(createCrossing).toHaveBeenCalledTimes(1)
    const judgeArg = createCrossing.mock.calls[0]![0] as Record<string, unknown>
    expect(judgeArg.severity).toBe('LOW')
    expect(judgeArg.detail).toContain('downgraded (legit, judge)')
    expect(judgeArg.disposition).toBeUndefined() // OPEN — human still owes a call
    expect(store[0]!.disposition).toBeNull()

    // (b) WEAKENING — an assertion removed, no legit reason. Full-strength
    // crossing, recorded OPEN and DONE-blocking.
    jest.clearAllMocks()
    store = []
    seq = 0
    listByTask.mockResolvedValue([machineCriterion])
    everPassed.mockResolvedValue(new Set(['crit-1']))
    listActivity.mockResolvedValue([])
    findEvents.mockResolvedValue([]) // no legit reason
    findForUpdate.mockResolvedValue({ ...TASK })
    latestRuns.mockResolvedValue(new Map())

    await boundaryDetectorService.detectAndRecord(editEvent(WEAK_OLD, WEAK_NEW))
    expect(createCrossing).toHaveBeenCalledTimes(1)
    const weakArg = createCrossing.mock.calls[0]![0] as Record<string, unknown>
    expect(weakArg.severity).toBe('MEDIUM') // not downgraded
    expect(weakArg.disposition).toBeUndefined() // OPEN
    // The weakening crossing blocks the DONE gate (409).
    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('auto-legit is distinct provenance, human-reopenable, and the agent API disposition path stays 403', async () => {
    // Seed an AUTO_LEGIT crossing (deterministic legit) ...
    findEvents.mockResolvedValue([productionEvent])
    await boundaryDetectorService.detectAndRecord(
      editEvent(LEGIT_OLD, LEGIT_NEW)
    )
    const auto = store.find(r => r.disposition === 'AUTO_LEGIT')!
    expect(auto).toBeDefined()

    // ... and a separately-seeded crossing a HUMAN rules FALSE_POSITIVE.
    store.push({
      id: 'bc-human',
      taskId: 't-1',
      category: 'TEST_TAMPERING',
      detail: 'human-reviewed edit',
      target: '__tests__/other.test.ts',
      severity: 'LOW',
      disposition: null,
      dispositionNote: null,
      dispositionedAt: null,
      dispositionedById: null,
    })
    await boundaryCrossingService.disposition(
      't-1',
      'bc-human',
      'FALSE_POSITIVE',
      null,
      ATTRIB
    )
    const human = store.find(r => r.id === 'bc-human')!

    // DISTINCT PROVENANCE: the system auto-resolution carries no actor; the human
    // ruling carries one — and the disposition VALUES differ too.
    expect(auto.disposition).toBe('AUTO_LEGIT')
    expect(auto.dispositionedById).toBeNull()
    expect(human.disposition).toBe('FALSE_POSITIVE')
    expect(human.dispositionedById).toBe('actor-1')
    expect(auto.disposition).not.toBe(human.disposition)

    // HUMAN-REOPENABLE (LUM-450): a human reverts the auto-legit back to OPEN.
    // The audit row records the transition FROM auto-legit, and the crossing
    // re-blocks DONE.
    createActivity.mockClear()
    await boundaryCrossingService.disposition(
      't-1',
      auto.id,
      null,
      'looks off',
      ATTRIB
    )
    expect(auto.disposition).toBeNull() // reverted to OPEN
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BOUNDARY_CROSSING_DISPOSITIONED',
        payload: expect.objectContaining({ from: 'AUTO_LEGIT', to: null }),
      })
    )
    const open =
      await boundaryCrossingRepository.findUndispositionedByTask('t-1')
    expect(open.map(r => r.id)).toContain(auto.id) // back in the open queue

    // RED LINE UNTOUCHED: an agent/CLI bearer cannot disposition via the API —
    // refused 403 BEFORE the body is even parsed (so it can't auto-clear either).
    mockIdentity.mockResolvedValue({
      clerkId: 'clerk-1',
      memberId: 'member-1',
      workspaceId: 'w-1',
      source: 'bearer',
    })
    const bodyParsed = jest.fn()
    const res = await dispositionPOST(
      {
        json: async () => {
          bodyParsed()
          return {}
        },
        headers: { get: () => null },
      } as never,
      { params: Promise.resolve({ id: 'LUM-478' }) }
    )
    expect(res.status).toBe(403)
    expect(bodyParsed).not.toHaveBeenCalled()
  })
})
