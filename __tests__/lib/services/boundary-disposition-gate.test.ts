/**
 * LUM-435 criterion 1 — the disposition→gate contract, exercised end to end.
 * A stateful in-memory boundary-crossing repo is shared by BOTH the gate
 * (updateTask → assertNoUnacknowledgedBoundaryCrossings) and the disposition
 * service, so the test proves that dispositioning a crossing actually clears the
 * DONE gate (not just that a column was written). Either disposition clears it,
 * and the note is optional.
 */
import { updateTask } from '@/lib/services/task-state.service'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'

let mockRows: Array<{
  id: string
  taskId: string
  category: string
  detail: string
  disposition: string | null
  dispositionNote?: string | null
}> = []

// LUM-732: the DONE gate now consults the PR security scan. No linked PR here,
// so the real gate short-circuits before touching the scan repository.
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findManyForSecurityByTaskId: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findById: jest.fn(
      async (id: string) => mockRows.find(r => r.id === id) ?? null
    ),
    findUndispositionedByTask: jest.fn(async (taskId: string) =>
      mockRows.filter(r => r.taskId === taskId && r.disposition == null)
    ),
    disposition: jest.fn(
      async (id: string, disp: string, note: string | null) => {
        const r = mockRows.find(x => x.id === id && x.disposition == null)
        if (r) {
          r.disposition = disp
          r.dispositionNote = note ?? null
        }
        return { count: r ? 1 : 0 }
      }
    ),
    isGateEnabledForWorkspace: jest.fn(async () => true),
  },
}))

// updateTask's own deps — mocked so the test isolates the disposition→gate path.
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
  memberRepository: {
    findActorByMemberId: jest.fn(async () => ({ id: 'actor-1' })),
  },
}))

const findForUpdate = taskRepository.findForUpdate as jest.Mock
const update = taskRepository.update as jest.Mock
const latestRuns = verificationRunRepository.latestRunsByCriterion as jest.Mock

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
  findForUpdate.mockResolvedValue({ ...TASK })
  update.mockResolvedValue({
    ...TASK,
    status: 'DONE',
    team: { identifier: 'LUM' },
    teamId: 'team-1',
  })
  latestRuns.mockResolvedValue(new Map())
})

function seedOpenCrossing() {
  mockRows = [
    {
      id: 'bc-1',
      taskId: 't-1',
      category: 'PUSH_TO_PROTECTED_BRANCH',
      detail: 'git push --force origin main',
      disposition: null,
    },
  ]
}

describe('LUM-435 disposition clears the DONE gate', () => {
  it('crossing disposition FALSE_POSITIVE or CONFIRMED clears the gate and note is optional', async () => {
    // --- CONFIRMED with NO note ---------------------------------------------
    seedOpenCrossing()
    // Open crossing blocks DONE.
    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toMatchObject({
      status: 409,
    })

    // A human dispositions it CONFIRMED with no note — succeeds (note optional).
    const confirmed = await boundaryCrossingService.disposition(
      't-1',
      'bc-1',
      'CONFIRMED',
      null,
      ATTRIB
    )
    expect(confirmed).toEqual({ crossingId: 'bc-1', disposition: 'CONFIRMED' })

    // Now the gate is cleared — DONE flows through.
    await expect(updateTask('t-1', { status: 'DONE' })).resolves.toBeDefined()
    expect(update).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ status: 'DONE' })
    )

    // --- FALSE_POSITIVE also clears -----------------------------------------
    seedOpenCrossing()
    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toMatchObject({
      status: 409,
    })
    await boundaryCrossingService.disposition(
      't-1',
      'bc-1',
      'FALSE_POSITIVE',
      null,
      ATTRIB
    )
    await expect(updateTask('t-1', { status: 'DONE' })).resolves.toBeDefined()
  })
})
