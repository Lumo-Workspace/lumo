/**
 * @jest-environment node
 *
 * LUM-751 — AUTO_SUPPRESSED: a detection that matches an active, human-authored
 * repository suppression rule is still RECORDED but system-dispositioned
 * (AUTO_SUPPRESSED + suppressionRuleId, no dispositionedById), out of the open
 * queue and the DONE gate; a recurrence coalesces into the suppressed row; a
 * revoked rule stops suppressing; the HIGH classes and evasion-decoded
 * crossings are never suppressed.
 *
 * A stateful in-memory crossing store is shared by the recorder
 * (detectAndRecord) and the DONE gate (updateTask), so these prove real
 * behaviour end to end — not just that a column was written.
 *
 * Test names below are literal MACHINE checkpointers — do not rename.
 */
import { boundaryDetectorService } from '@/lib/services/boundary-detector.service'
import { updateTask } from '@/lib/services/task-state.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { computeFalsePositiveRates } from '@/lib/boundary-crossing/false-positive-rate'

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
  suppressionRuleId: string | null
  occurrenceCount: number
}
let store: Row[] = []
let seq = 0
let rules: Array<{
  id: string
  category: string
  targetPattern: string
  reason: string | null
  revokedAt: Date | null
}> = []

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
        dispositionedById: (input.dispositionedById as string | null) ?? null,
        suppressionRuleId: (input.suppressionRuleId as string | null) ?? null,
        occurrenceCount: 1,
      }
      store.push(row)
      return { id: row.id }
    }),
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
        for (const h of hits) h.occurrenceCount++
        return hits.length
      }
    ),
    coalesceSuppressedRecurrence: jest.fn(
      async (
        taskId: string,
        category: string,
        target: string | null,
        ruleId: string
      ) => {
        if (target == null) return 0
        const hits = store.filter(
          r =>
            r.taskId === taskId &&
            r.category === category &&
            r.target === target &&
            r.disposition === 'AUTO_SUPPRESSED' &&
            r.suppressionRuleId === ruleId
        )
        for (const h of hits) h.occurrenceCount++
        return hits.length
      }
    ),
    findUndispositionedByTask: jest.fn(async (taskId: string) =>
      store.filter(r => r.taskId === taskId && r.disposition == null)
    ),
    isGateEnabledForWorkspace: jest.fn(async () => true),
  },
}))
jest.mock('@/lib/repositories/crossing-suppression-rule.repository', () => ({
  crossingSuppressionRuleRepository: {
    findActiveForProject: jest.fn(async () =>
      rules.filter(r => r.revokedAt == null)
    ),
  },
}))

// --- detection deps -----------------------------------------------------------
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn(), listByTaskAndType: jest.fn() },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findByTaskId: jest.fn(async () => []) },
}))
jest.mock('@/lib/services/policy/policy-compiler.service', () => ({
  policyCompilerService: { ensureCompiled: jest.fn(async () => null) },
}))
jest.mock('@/lib/llm/action-confirm-client', () => ({
  confirmActionCandidate: jest.fn(async () => 'REAL_ACTION'),
}))

// --- gate deps ----------------------------------------------------------------
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForUpdate: jest.fn(),
    update: jest.fn(),
    findWithProjectWorkspaceId: jest.fn(async () => ({
      id: 't-1',
      projectId: 'p-1',
      project: { workspaceId: 'w-1' },
    })),
  },
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

const createCrossing = boundaryCrossingRepository.create as jest.Mock
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

const bashEvent = (command: string) => ({
  taskId: 't-1',
  hookEventId: 'evt-1',
  toolName: 'Bash',
  filePath: null,
  payload: { tool_input: { command } },
})

const NPM_RULE = {
  id: 'rule-1',
  category: 'NEW_NPM_DEPENDENCY',
  targetPattern: 'npm install left-pad',
  reason: 'vetted',
  revokedAt: null as Date | null,
}

beforeEach(() => {
  jest.clearAllMocks()
  store = []
  seq = 0
  rules = []
  createActivity.mockResolvedValue({ id: 'act-1' })
  findForUpdate.mockResolvedValue({ ...TASK })
  update.mockResolvedValue({
    ...TASK,
    status: 'DONE',
    team: { identifier: 'LUM' },
    teamId: 'team-1',
  })
})

describe('LUM-751 — AUTO_SUPPRESSED by repository rule', () => {
  it('a matching detection is recorded AUTO_SUPPRESSED with a rule ref and no human actor and is excluded from the DONE gate', async () => {
    rules = [{ ...NPM_RULE }]
    await boundaryDetectorService.detectAndRecord(
      bashEvent('npm install left-pad')
    )

    expect(createCrossing).toHaveBeenCalledTimes(1)
    const arg = createCrossing.mock.calls[0]![0] as Record<string, unknown>
    expect(arg.category).toBe('NEW_NPM_DEPENDENCY')
    expect(arg.disposition).toBe('AUTO_SUPPRESSED')
    expect(arg.suppressionRuleId).toBe('rule-1')
    expect(arg.dispositionedAt).toBeInstanceOf(Date)
    expect(String(arg.dispositionNote)).toContain('rule-1')
    expect(String(arg.dispositionNote)).toContain('vetted')
    // No human actor — that null is what distinguishes it from a human ruling.
    expect(arg).not.toHaveProperty('dispositionedById')

    // Out of the open queue, and the DONE transition flows.
    expect(
      await boundaryCrossingRepository.findUndispositionedByTask('t-1')
    ).toHaveLength(0)
    await expect(
      updateTask('t-1', 'w-1', { status: 'DONE' })
    ).resolves.toBeDefined()

    // The timeline marker reads as auto-suppressed, with the rule ref.
    const act = createActivity.mock.calls[0]![0] as {
      payload: Record<string, unknown>
    }
    expect(act.payload.disposition).toBe('AUTO_SUPPRESSED')
    expect(act.payload.suppressionRuleId).toBe('rule-1')
  })

  it('a recurrence coalesces into the suppressed row instead of a new one', async () => {
    rules = [{ ...NPM_RULE }]
    await boundaryDetectorService.detectAndRecord(
      bashEvent('npm install left-pad')
    )
    await boundaryDetectorService.detectAndRecord(
      bashEvent('npm install left-pad')
    )
    expect(createCrossing).toHaveBeenCalledTimes(1)
    expect(store[0]!.occurrenceCount).toBe(2)
  })

  it('a revoked rule no longer suppresses and the crossing is OPEN again', async () => {
    rules = [{ ...NPM_RULE, revokedAt: new Date() }]
    await boundaryDetectorService.detectAndRecord(
      bashEvent('npm install left-pad')
    )
    expect(store).toHaveLength(1)
    expect(store[0]!.disposition).toBeNull()
    expect(store[0]!.suppressionRuleId).toBeNull()
  })

  it('an open crossing on a different target is not touched by the rule', async () => {
    rules = [{ ...NPM_RULE }]
    await boundaryDetectorService.detectAndRecord(
      bashEvent('npm install chalk')
    )
    expect(store[0]!.disposition).toBeNull()
  })

  it('a non-suppressible category is never auto-suppressed even with a matching wildcard rule', async () => {
    rules = [
      {
        id: 'rule-x',
        category: 'DESTRUCTIVE_DB_COMMAND',
        targetPattern: '*',
        reason: null,
        revokedAt: null,
      },
    ]
    await boundaryDetectorService.detectAndRecord(
      bashEvent('npx prisma migrate reset --force')
    )
    expect(store).toHaveLength(1)
    expect(store[0]!.category).toBe('DESTRUCTIVE_DB_COMMAND')
    expect(store[0]!.disposition).toBeNull()
    await expect(
      updateTask('t-1', 'w-1', { status: 'DONE' })
    ).rejects.toMatchObject({
      status: 409,
    })
  })

  it('an evasion-decoded crossing is never auto-suppressed', async () => {
    rules = [
      {
        id: 'rule-p',
        category: 'PUSH_TO_PROTECTED_BRANCH',
        targetPattern: '*',
        reason: null,
        revokedAt: null,
      },
    ]
    const b64 = Buffer.from('git push --force origin main').toString('base64')
    await boundaryDetectorService.detectAndRecord(
      bashEvent(`echo ${b64} | base64 -d | sh`)
    )
    expect(store.length).toBeGreaterThan(0)
    expect(store.every(r => r.disposition === null)).toBe(true)
  })

  it('AUTO_SUPPRESSED rows are counted apart from the human false-positive rate', () => {
    const report = computeFalsePositiveRates(
      [
        { category: 'NEW_NPM_DEPENDENCY', disposition: 'AUTO_SUPPRESSED' },
        { category: 'NEW_NPM_DEPENDENCY', disposition: 'AUTO_SUPPRESSED' },
      ],
      { minSamples: 1 }
    )
    expect(report.categories[0]!.autoSuppressed).toBe(2)
    expect(report.categories[0]!.dispositioned).toBe(0)
    expect(report.categories[0]!.status).toBe('insufficient')
  })
})
