/**
 * LUM-450 criterion 3 — reverting a dispositioned crossing back to OPEN
 * re-blocks the task -> DONE transition, because the gate re-evaluates on the
 * crossing's CURRENT disposition. A HIGH-severity crossing reverted to OPEN
 * force-blocks even when the workspace opted the gate out (sustaining LUM-442).
 *
 * Driven through a stateful fake boundary-crossing repository shared by both
 * the human-only re-disposition service AND the DONE gate, so the revert
 * genuinely flips the gate's input rather than a hand-set mock.
 */
import { updateTask } from '@/lib/services/task-state.service'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { memberRepository } from '@/lib/repositories/member.repository'

// LUM-732: the DONE gate now consults the PR security scan. No linked PR here,
// so the real gate short-circuits before touching the scan repository.
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findManyForSecurityByTaskId: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findForUpdate: jest.fn(), update: jest.fn() },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  verificationRunRepository: { latestRunsByCriterion: jest.fn() },
}))
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: { listByTask: jest.fn() },
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
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findActorByMemberId: jest.fn() },
}))
// LUM-812: the DONE gate now consults the test-case plane fail-closed (a proven,
// undispositioned defect blocks). Default it to "no test cases" so this test
// keeps isolating the re-disposition gate.
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    listForTask: jest.fn(() => Promise.resolve([])),
    runsPerCase: jest.fn(() => Promise.resolve(new Map())),
  },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findById: jest.fn(),
    disposition: jest.fn(),
    findUndispositionedByTask: jest.fn(),
    isGateEnabledForWorkspace: jest.fn(),
  },
}))

const findForUpdate = taskRepository.findForUpdate as jest.Mock
const update = taskRepository.update as jest.Mock
const latestRuns = verificationRunRepository.latestRunsByCriterion as jest.Mock
const findById = boundaryCrossingRepository.findById as jest.Mock
const dispositionRepo = boundaryCrossingRepository.disposition as jest.Mock
const findOpen =
  boundaryCrossingRepository.findUndispositionedByTask as jest.Mock
const gateEnabled =
  boundaryCrossingRepository.isGateEnabledForWorkspace as jest.Mock
const findActor = memberRepository.findActorByMemberId as jest.Mock

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

// A single HIGH-severity crossing whose disposition the fake repo holds as
// mutable state — the gate reads it live, the service mutates it.
let crossing: {
  id: string
  taskId: string
  category: string
  detail: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  disposition: 'FALSE_POSITIVE' | 'CONFIRMED' | null
  dispositionNote: string | null
  dispositionedAt: Date | null
  dispositionedById: string | null
}

beforeEach(() => {
  jest.clearAllMocks()
  findForUpdate.mockResolvedValue({ ...TASK })
  update.mockResolvedValue({
    ...TASK,
    status: 'DONE',
    team: { identifier: 'LUM' },
    teamId: 'team-1',
  })
  latestRuns.mockResolvedValue(new Map()) // no send-back; isolate the boundary gate
  findActor.mockResolvedValue({ id: 'actor-1' })

  crossing = {
    id: 'bc-high',
    taskId: 't-1',
    category: 'HARDCODED_SECRET',
    detail: 'AWS key leaked',
    severity: 'HIGH',
    // Seed: already CONFIRMED — the gate is currently clear.
    disposition: 'CONFIRMED',
    dispositionNote: null,
    dispositionedAt: new Date('2026-06-11T00:00:00.000Z'),
    dispositionedById: 'actor-0',
  }

  findById.mockImplementation(async (id: string) =>
    id === crossing.id ? { ...crossing } : null
  )
  dispositionRepo.mockImplementation(
    async (
      _id: string,
      disp: 'FALSE_POSITIVE' | 'CONFIRMED' | null,
      note: string | null,
      actorId: string | null,
      now: Date
    ) => {
      crossing.disposition = disp
      crossing.dispositionNote = disp === null ? null : note
      crossing.dispositionedAt = disp === null ? null : now
      crossing.dispositionedById = disp === null ? null : actorId
      return { count: 1 }
    }
  )
  // The gate's view: only an undispositioned crossing is "open".
  findOpen.mockImplementation(async (taskId: string) =>
    taskId === crossing.taskId && crossing.disposition == null ? [crossing] : []
  )
})

describe('LUM-450 — re-disposition gate re-evaluation', () => {
  it('reverting a crossing to open re-blocks DONE including HIGH under opt-out', async () => {
    // Workspace has OPTED OUT of the boundary gate.
    gateEnabled.mockResolvedValue(false)

    // The HIGH crossing is CONFIRMED → no open crossing → DONE flows even under
    // opt-out.
    await expect(updateTask('t-1', { status: 'DONE' })).resolves.toBeDefined()
    expect(update).toHaveBeenCalled()

    // A human reverts the disposition back to OPEN via the human-only path.
    const out = await boundaryCrossingService.disposition(
      't-1',
      'bc-high',
      null,
      'on reflection this needs another look',
      ATTRIB
    )
    expect(out).toEqual({ crossingId: 'bc-high', disposition: null })
    expect(crossing.disposition).toBeNull()

    // Now it's open again. DONE re-blocks (gate re-evaluates on current state),
    // and because it's HIGH severity the opt-out does NOT let it through.
    update.mockClear()
    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toMatchObject({
      status: 409,
    })
    expect(update).not.toHaveBeenCalled()

    // Still clearable: a human re-confirms it → open count drops → DONE flows.
    await boundaryCrossingService.disposition(
      't-1',
      'bc-high',
      'CONFIRMED',
      null,
      ATTRIB
    )
    await expect(updateTask('t-1', { status: 'DONE' })).resolves.toBeDefined()
  })
})
