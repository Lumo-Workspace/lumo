import { taskService } from '@/lib/services/task.service'

// ── Mock prisma ──────────────────────────────────────────────────────────────

const mockTaskFindUnique = jest.fn()
const mockTaskCreate = jest.fn()
const mockTaskUpdate = jest.fn()
const mockActivityCreate = jest.fn()
const mockTeamUpdate = jest.fn()
const mockActorFindUnique = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findUnique: (...a: any[]) => mockTaskFindUnique(...a),
      create: (...a: any[]) => mockTaskCreate(...a),
      update: (...a: any[]) => mockTaskUpdate(...a),
      findUniqueOrThrow: (...a: any[]) => mockTaskFindUnique(...a),
    },
    taskActivity: { create: (...a: any[]) => mockActivityCreate(...a) },
    team: { update: (...a: any[]) => mockTeamUpdate(...a) },
    actor: { findUnique: (...a: any[]) => mockActorFindUnique(...a) },
    $transaction: jest.fn(async (fn: (tx: any) => any) =>
      fn({
        team: { update: (...a: any[]) => mockTeamUpdate(...a) },
        actor: { findUnique: (...a: any[]) => mockActorFindUnique(...a) },
        task: { create: (...a: any[]) => mockTaskCreate(...a) },
      })
    ),
  },
}))

// ── Mock repositories ────────────────────────────────────────────────────────

const mockTaskFindById = jest.fn()
const mockTaskFindWithProject = jest.fn()
const mockTaskFindForUpdate = jest.fn()
const mockTaskFindMaxOrder = jest.fn()
const mockTaskFindActorById = jest.fn()
const mockTaskCreateWithSequence = jest.fn()
const mockTaskUpdate2 = jest.fn()
const mockTaskUpdateSprint = jest.fn()

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findById: (...a: any[]) => mockTaskFindById(...a),
    findWithProject: (...a: any[]) => mockTaskFindWithProject(...a),
    findForUpdate: (...a: any[]) => mockTaskFindForUpdate(...a),
    findMaxOrder: (...a: any[]) => mockTaskFindMaxOrder(...a),
    findActorById: (...a: any[]) => mockTaskFindActorById(...a),
    createWithSequence: (...a: any[]) => mockTaskCreateWithSequence(...a),
    update: (...a: any[]) => mockTaskUpdate2(...a),
    updateSprint: (...a: any[]) => mockTaskUpdateSprint(...a),
    findProjectIdById: jest.fn().mockResolvedValue(null),
  },
}))

const mockProjectFindByIdWithDefaults = jest.fn()
const mockProjectFindByIdSimple = jest.fn()

jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findByIdWithDefaults: (...a: any[]) =>
      mockProjectFindByIdWithDefaults(...a),
    findByIdSimple: (...a: any[]) => mockProjectFindByIdSimple(...a),
  },
}))

jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    syncTaskTags: jest.fn().mockResolvedValue(undefined),
    findByTask: jest.fn().mockResolvedValue([]),
  },
}))

jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findById: jest.fn().mockResolvedValue(null),
  },
}))

jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findIntegrationByRepo: jest.fn().mockResolvedValue(null),
    upsertPullRequest: jest.fn().mockResolvedValue(null),
  },
}))

jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: (...a: any[]) => mockActivityCreate(...a),
  },
}))

jest.mock('@/lib/services/task-notifications.service', () => ({
  dispatchCreateTaskSideEffects: jest.fn(),
  dispatchUpdateTaskSideEffects: jest.fn(),
}))

jest.mock('@/lib/services/task-pr-sync.service', () => ({
  syncPullRequestStatus: jest.fn().mockResolvedValue(new Map()),
}))

jest.mock('@/lib/crypto', () => ({
  decrypt: jest.fn((v: string) => v),
}))

jest.mock('@/lib/task/state-machine', () => ({
  isValidTaskTransition: jest.fn().mockReturnValue(true),
  // LUM-1282: terminal stamps are covered in lum1282-* suites.
  terminalTimestampPatch: () => ({}),
}))

// ── Shared test fixtures ─────────────────────────────────────────────────────

const BASE_PROJECT = {
  id: 'proj1',
  teamId: 'team1',
  workspaceId: 'ws1',
  owner: null,
  workspace: { slug: 'my-workspace' },
}

const BASE_TASK_FOR_UPDATE = {
  id: 'task1',
  status: 'TODO',
  sprintId: 's1',
  assigneeActorId: null,
  projectId: 'proj1',
  project: {
    workspaceId: 'ws1',
    workspace: { slug: 'my-workspace' },
    owner: null,
  },
  team: { identifier: 'LUM' },
}

const CREATED_TASK = {
  id: 'new-task',
  title: 'New task',
  teamIdentifier: 'LUM',
  number: 42,
  status: 'TODO',
  priority: 'MEDIUM',
  projectId: 'proj1',
  assigneeActorId: null,
  sprintId: null,
  team: { identifier: 'LUM' },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockTaskFindMaxOrder.mockResolvedValue(null)
  mockProjectFindByIdWithDefaults.mockResolvedValue(BASE_PROJECT)
  mockTaskCreateWithSequence.mockResolvedValue(CREATED_TASK)
  mockTaskUpdate2.mockResolvedValue({
    ...BASE_TASK_FOR_UPDATE,
    team: { identifier: 'LUM' },
    project: { id: 'proj1', name: 'My Project' },
  })
})

// ── createTask: sprint binding ───────────────────────────────────────────────

describe('taskService — sprint binding (createTask)', () => {
  it('passes an explicit sprintId through', async () => {
    await taskService.createTask(
      'proj1',
      {
        title: 'Standalone task',
        status: 'TODO',
        priority: 'MEDIUM',
        sprintId: 's2',
      },
      'actor1',
      'clerk1',
      'member1'
    )

    expect(mockTaskCreateWithSequence).toHaveBeenCalledWith(
      expect.objectContaining({ sprintId: 's2' })
    )
  })

  it('defaults to no sprint when sprintId is omitted (no parent to inherit from since LUM-959)', async () => {
    await taskService.createTask(
      'proj1',
      { title: 'Standalone task', status: 'TODO', priority: 'MEDIUM' },
      'actor1',
      'clerk1',
      'member1'
    )

    expect(mockTaskCreateWithSequence).toHaveBeenCalledWith(
      expect.objectContaining({ sprintId: null })
    )
  })
})

// ── updateTask: SPRINT_CHANGED activity ─────────────────────────────────────

describe('taskService — SPRINT_CHANGED activity (updateTask)', () => {
  it('writes SPRINT_CHANGED with reason=manual when sprintId changes', async () => {
    mockTaskFindForUpdate.mockResolvedValueOnce(BASE_TASK_FOR_UPDATE) // sprintId: 's1'

    await taskService.updateTask('task1', 'ws1', { sprintId: 's2' }, 'actor1')

    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task1',
        actorId: 'actor1',
        type: 'SPRINT_CHANGED',
        payload: expect.objectContaining({
          fromSprintId: 's1',
          toSprintId: 's2',
          reason: 'manual',
        }),
      })
    )
  })

  it('does NOT write SPRINT_CHANGED when sprintId is unchanged', async () => {
    mockTaskFindForUpdate.mockResolvedValueOnce(BASE_TASK_FOR_UPDATE) // sprintId: 's1'

    // Update title only — no sprintId in input
    await taskService.updateTask(
      'task1',
      'ws1',
      { title: 'New title' },
      'actor1'
    )

    const sprintActivityCalls = mockActivityCreate.mock.calls.filter(
      call => call[0]?.type === 'SPRINT_CHANGED'
    )
    expect(sprintActivityCalls).toHaveLength(0)
  })

  it('does NOT write SPRINT_CHANGED when sprintId key absent from input', async () => {
    mockTaskFindForUpdate.mockResolvedValueOnce({
      ...BASE_TASK_FOR_UPDATE,
      sprintId: null,
    })

    await taskService.updateTask('task1', 'ws1', { title: 'Hello' }, null)

    const sprintActivityCalls = mockActivityCreate.mock.calls.filter(
      call => call[0]?.type === 'SPRINT_CHANGED'
    )
    expect(sprintActivityCalls).toHaveLength(0)
  })

  it('writes SPRINT_CHANGED when clearing sprint (null)', async () => {
    mockTaskFindForUpdate.mockResolvedValueOnce(BASE_TASK_FOR_UPDATE) // sprintId: 's1'

    await taskService.updateTask('task1', 'ws1', { sprintId: null }, 'actor1')

    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SPRINT_CHANGED',
        payload: expect.objectContaining({
          fromSprintId: 's1',
          toSprintId: null,
        }),
      })
    )
  })

  it('actorId=null is accepted (system-triggered change)', async () => {
    mockTaskFindForUpdate.mockResolvedValueOnce(BASE_TASK_FOR_UPDATE)

    await taskService.updateTask('task1', 'ws1', { sprintId: 's2' }, null)

    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        type: 'SPRINT_CHANGED',
      })
    )
  })
})
