/**
 * @jest-environment node
 *
 * LUM-759 — a repository suppression rule takes effect BACKWARDS.
 *
 * LUM-751 bound a rule to future detections only, so ruling once still left
 * every already-recorded occurrence of the same shape sitting in the queue —
 * 75 of them in prod, 30 on a single target. Here creating the rule also
 * stamps those existing rows, isomorphically to a fresh suppressed detection,
 * and the whole thing (rule + stamps + audit) is one transaction.
 *
 * A stateful in-memory crossing store is shared by the sweep and by the real
 * DONE gate (`updateTask`), so the gate consequence is proven rather than
 * asserted: the sweep clears a task's only blocking crossing and DONE flows.
 *
 * Test names below are literal MACHINE checkpointers — do not rename.
 */
import { crossingSuppressionRuleRepository } from '@/lib/repositories/crossing-suppression-rule.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { updateTask } from '@/lib/services/task-state.service'
import { RETROACTIVE_SUPPRESSION_CAP } from '@/lib/boundary-crossing/suppression'

// --- shared in-memory crossing store -----------------------------------------
interface Row {
  id: string
  taskId: string | null
  category: string
  detail: string
  target: string | null
  disposition: string | null
  dispositionNote: string | null
  dispositionedAt: Date | null
  dispositionedById: string | null
  suppressionRuleId: string | null
  detectedAt: Date
}
let store: Row[] = []
/** Every row the transaction wrote, in order — proves atomic bundling. */
let txWrites: string[] = []
let txCommitted = true

type TxCallback = (client: unknown) => unknown

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(async (fn: TxCallback) => {
      txWrites = []
      txCommitted = false
      const out = await fn({
        crossingSuppressionRule: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            txWrites.push('rule')
            return {
              id: 'rule-1',
              reason: (data.reason as string | null) ?? null,
              category: data.category,
              targetPattern: data.targetPattern,
            }
          },
        },
      })
      txCommitted = true
      return out
    }),
  },
}))

// LUM-812: the DONE gate now consults the test-case plane fail-closed (a proven,
// undispositioned defect blocks). Default it to "no test cases" so this suite
// keeps isolating what it was written for.
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    listForTask: jest.fn(() => Promise.resolve([])),
    runsPerCase: jest.fn(() => Promise.resolve(new Map())),
  },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findRetroactiveSuppressionCandidates: jest.fn(
      async (input: {
        projectId: string
        category: string
        targetPattern: string
        excludeCrossingId?: string | null
        limit: number
      }) =>
        store
          .filter(
            r =>
              r.disposition == null &&
              r.category === input.category &&
              r.target === input.targetPattern &&
              r.id !== input.excludeCrossingId
          )
          .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())
          .slice(0, input.limit)
          .map(r => ({
            id: r.id,
            taskId: r.taskId,
            category: r.category,
            detail: r.detail,
          }))
    ),
    suppressManyByIds: jest.fn(
      async (
        ids: string[],
        ruleId: string,
        note: string,
        now: Date
      ): Promise<number> => {
        txWrites.push(`suppress:${ids.length}`)
        let n = 0
        for (const r of store) {
          if (!ids.includes(r.id)) continue
          r.disposition = 'AUTO_SUPPRESSED'
          r.dispositionNote = note
          r.dispositionedAt = now
          r.dispositionedById = null
          r.suppressionRuleId = ruleId
          n++
        }
        return n
      }
    ),
    findUndispositionedByTask: jest.fn(async (taskId: string) =>
      store.filter(r => r.taskId === taskId && r.disposition == null)
    ),
    isGateEnabledForWorkspace: jest.fn(async () => true),
  },
}))

jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: jest.fn(async () => {
      txWrites.push('activity')
      return { id: 'act' }
    }),
    listByTaskAndType: jest.fn(),
  },
}))

// --- gate deps ----------------------------------------------------------------
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findForUpdate: jest.fn(), update: jest.fn() },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findByIdSimple: jest.fn(),
    findDefaultRepository: jest.fn(async () => null),
  },
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
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findManyForSecurityByTaskId: jest.fn().mockResolvedValue([]),
  },
}))

const createActivity = activityRepository.create as jest.Mock
const findForUpdate = taskRepository.findForUpdate as jest.Mock
const update = taskRepository.update as jest.Mock

const TASK = {
  id: 't-1',
  status: 'IN_REVIEW',
  projectId: 'p-1',
  project: { workspaceId: 'w-1' },
  sprintId: null,
  assigneeActorId: null,
}

const TARGET = 'actionrule:a8c320ced05a3a87'
const crossing = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  taskId: 't-1',
  category: 'PROJECT_RULE_VIOLATION',
  detail: 'gh pr create --base main',
  target: TARGET,
  disposition: null,
  dispositionNote: null,
  dispositionedAt: null,
  dispositionedById: null,
  suppressionRuleId: null,
  detectedAt: new Date('2026-09-01T00:00:00Z'),
  ...over,
})

const createRule = () =>
  crossingSuppressionRuleRepository.createWithRetroactiveSweep(
    {
      projectId: 'p-1',
      category: 'PROJECT_RULE_VIOLATION',
      targetPattern: TARGET,
      reason: 'PR target branch, not a write to main',
      createdById: 'member-1',
      sourceCrossingId: 'bc-source',
    },
    { limit: RETROACTIVE_SUPPRESSION_CAP, actorId: 'actor-1', now: new Date() }
  )

beforeEach(() => {
  jest.clearAllMocks()
  store = []
  txWrites = []
  createActivity.mockImplementation(async () => {
    txWrites.push('activity')
    return { id: 'act' }
  })
  findForUpdate.mockResolvedValue({ ...TASK })
  update.mockResolvedValue({
    ...TASK,
    status: 'DONE',
    team: { identifier: 'LUM' },
    teamId: 'team-1',
  })
})

describe('LUM-759 — creating a rule disposes the project backlog too', () => {
  it('existing open crossings of the same shape are stamped isomorphically to a fresh suppressed detection, with no human actor', async () => {
    store.push(crossing('bc-1'), crossing('bc-2', { taskId: 't-2' }))

    const outcome = await createRule()

    expect(outcome.suppressedCount).toBe(2)
    expect(outcome.capped).toBe(false)
    for (const r of store) {
      expect(r.disposition).toBe('AUTO_SUPPRESSED')
      expect(r.suppressionRuleId).toBe('rule-1')
      expect(r.dispositionedAt).toBeInstanceOf(Date)
      // The null actor is what tells an auditor "the rule decided this",
      // not "a person reviewed this" — same as a detector-time suppression.
      expect(r.dispositionedById).toBeNull()
      expect(r.dispositionNote).toContain('rule-1')
      expect(r.dispositionNote).toContain('PR target branch')
    }
  })

  it('the sweep reaches across every task in the project, not just the one being ruled on', async () => {
    store.push(
      crossing('bc-1', { taskId: 't-1' }),
      crossing('bc-2', { taskId: 't-2' }),
      crossing('bc-3', { taskId: 't-3' })
    )
    const outcome = await createRule()
    expect(outcome.suppressedCount).toBe(3)
    expect(new Set(store.map(r => r.disposition))).toEqual(
      new Set(['AUTO_SUPPRESSED'])
    )
  })

  it('each stamped crossing appends its own BOUNDARY_CROSSING_DISPOSITIONED activity carrying the real transition and the rule id', async () => {
    store.push(crossing('bc-1'), crossing('bc-2', { taskId: 't-2' }))

    await createRule()

    expect(createActivity).toHaveBeenCalledTimes(2)
    const payloads = createActivity.mock.calls.map(
      c => c[0] as { taskId: string; payload: Record<string, unknown> }
    )
    expect(payloads.map(p => p.taskId).sort()).toEqual(['t-1', 't-2'])
    for (const p of payloads) {
      expect(p.payload.from).toBeNull()
      expect(p.payload.to).toBe('AUTO_SUPPRESSED')
      expect(p.payload.disposition).toBe('AUTO_SUPPRESSED')
      expect(p.payload.suppressionRuleId).toBe('rule-1')
      expect(p.payload.retroactive).toBe(true)
    }
    // append-only: the activity is written, never an existing row rewritten
    expect(createActivity.mock.calls[0]![1]).toBeDefined() // inside the tx
  })

  it('the rule row, the stamps and the audit rows all commit in one transaction', async () => {
    store.push(crossing('bc-1'), crossing('bc-2', { taskId: 't-2' }))
    await createRule()
    expect(txCommitted).toBe(true)
    // Rule first, then the stamping, then one audit row per stamped crossing —
    // all inside the single $transaction callback.
    expect(txWrites).toEqual(['rule', 'suppress:2', 'activity', 'activity'])
  })

  it('a task whose only blocking crossing was swept can transition to DONE', async () => {
    store.push(crossing('bc-1'))
    await expect(updateTask('t-1', 'w-1', { status: 'DONE' })).rejects.toThrow()

    await createRule()

    expect(
      await boundaryCrossingRepository.findUndispositionedByTask('t-1')
    ).toHaveLength(0)
    await expect(
      updateTask('t-1', 'w-1', { status: 'DONE' })
    ).resolves.toBeDefined()
  })

  it('with nothing to sweep the rule is still created and reports zero', async () => {
    const outcome = await createRule()
    expect(outcome.id).toBe('rule-1')
    expect(outcome.suppressedCount).toBe(0)
    expect(outcome.capped).toBe(false)
    expect(createActivity).not.toHaveBeenCalled()
  })
})
