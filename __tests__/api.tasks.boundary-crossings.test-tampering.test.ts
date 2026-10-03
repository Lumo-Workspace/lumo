/**
 * @jest-environment node
 *
 * LUM-441 criterion 3 — a TEST_TAMPERING crossing flows through the LUM-435
 * disposition model, with nothing special-cased for the category. LUM-942: the
 * detector that produced TEST_TAMPERING is gone, but legacy OPEN rows still
 * exist — they must keep blocking DONE and keep dispositioning like any other:
 *
 *  - HUMAN-ONLY: an agent/CLI bearer request to disposition it is refused 403
 *    BEFORE the body is parsed (the agent can never clear its own reward-hack to
 *    unblock its own DONE), and nothing is recorded.
 *  - EITHER DISPOSITION CLEARS THE GATE: while the crossing is open it blocks
 *    DONE (409); once a human dispositions it — FALSE_POSITIVE *or* CONFIRMED —
 *    the same DONE transition flows.
 */
import { updateTask } from '@/lib/services/task-state.service'
import { POST as dispositionPOST } from '@/app/api/tasks/[id]/boundary-crossings/disposition/route'
import { requireIdentity } from '@/lib/auth'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'

// --- DONE-gate deps (mirrors task-state.boundary-gate.test) ------------------
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
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    create: jest.fn(),
    findUndispositionedByTask: jest.fn(),
    isGateEnabledForWorkspace: jest.fn(),
    disposition: jest.fn(),
    findById: jest.fn(),
  },
}))

// --- route deps (the human-only redline) -------------------------------------
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/api/resolve-task-param', () => ({
  resolveTaskParam: jest.fn(),
}))
jest.mock('@/lib/services/boundary-crossing.service', () => ({
  boundaryCrossingService: { disposition: jest.fn() },
}))

const findForUpdate = taskRepository.findForUpdate as jest.Mock
const update = taskRepository.update as jest.Mock
const findOpen =
  boundaryCrossingRepository.findUndispositionedByTask as jest.Mock
const gateEnabled =
  boundaryCrossingRepository.isGateEnabledForWorkspace as jest.Mock
const dispositionRow = boundaryCrossingRepository.disposition as jest.Mock
const mockIdentity = requireIdentity as jest.Mock
const mockServiceDisposition = boundaryCrossingService.disposition as jest.Mock

const TASK = {
  id: 't-1',
  status: 'IN_REVIEW',
  projectId: 'p-1',
  project: { workspaceId: 'w-1' },
  sprintId: null,
  assigneeActorId: null,
  parentTaskId: null,
}

/** An in-memory crossing store so the gate query and the LUM-435 disposition
 *  primitive share state — disposition (either value) moves the row out of the
 *  undispositioned set the gate blocks on. */
type Row = {
  id: string
  taskId: string
  category: string
  disposition: string | null
}
let store: Row[] = []

beforeEach(() => {
  jest.clearAllMocks()
  findForUpdate.mockResolvedValue({ ...TASK })
  update.mockResolvedValue({
    ...TASK,
    status: 'DONE',
    team: { identifier: 'LUM' },
    teamId: 'team-1',
  })
  gateEnabled.mockResolvedValue(true)

  store = [
    {
      id: 'bc-1',
      taskId: 't-1',
      category: 'TEST_TAMPERING',
      disposition: null,
    },
  ]
  findOpen.mockImplementation(async (taskId: string) =>
    store.filter(r => r.taskId === taskId && r.disposition == null)
  )
  // The real repository's guarded primitive: stamp disposition only on an
  // open row (idempotent), exactly the field the gate query filters on.
  dispositionRow.mockImplementation(async (id: string, value: string) => {
    const r = store.find(x => x.id === id && x.disposition == null)
    if (r) r.disposition = value
    return { count: r ? 1 : 0 }
  })

  mockIdentity.mockResolvedValue({
    clerkId: 'clerk-1',
    memberId: 'member-1',
    workspaceId: 'w-1',
    source: 'clerk',
  })
})

function req() {
  return {
    // Throws if ever called — proves the 403 fires before any body parse.
    json: async () => {
      throw new Error('body must not be parsed')
    },
    headers: { get: () => null },
  } as never
}

describe('TEST_TAMPERING — LUM-435 disposition model (LUM-441 criterion 3)', () => {
  it('TEST_TAMPERING crossing is human-only dispositionable and clears the gate', async () => {
    // HUMAN-ONLY: a bearer (agent/CLI) request is refused 403 before parse and
    // records nothing — an agent can't clear its own reward-hack.
    mockIdentity.mockResolvedValue({
      clerkId: 'clerk-1',
      memberId: 'member-1',
      workspaceId: 'w-1',
      source: 'bearer',
    })
    const res = await dispositionPOST(req(), {
      params: Promise.resolve({ id: 'LUM-441' }),
    })
    expect(res.status).toBe(403)
    expect(mockServiceDisposition).not.toHaveBeenCalled()

    // OPEN crossing blocks DONE with 409.
    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toMatchObject({
      status: 409,
    })
    expect(update).not.toHaveBeenCalled()

    // A human dispositions it CONFIRMED → the same DONE transition flows.
    await boundaryCrossingRepository.disposition(
      'bc-1',
      'CONFIRMED',
      null,
      'member-1',
      new Date()
    )
    await expect(updateTask('t-1', { status: 'DONE' })).resolves.toBeDefined()
    expect(update).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ status: 'DONE' })
    )

    // FALSE_POSITIVE clears the gate just the same (legit test fix).
    store = [
      {
        id: 'bc-2',
        taskId: 't-1',
        category: 'TEST_TAMPERING',
        disposition: null,
      },
    ]
    update.mockClear()
    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toMatchObject({
      status: 409,
    })
    await boundaryCrossingRepository.disposition(
      'bc-2',
      'FALSE_POSITIVE',
      null,
      'member-1',
      new Date()
    )
    await expect(updateTask('t-1', { status: 'DONE' })).resolves.toBeDefined()
    expect(update).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ status: 'DONE' })
    )
  })
})
