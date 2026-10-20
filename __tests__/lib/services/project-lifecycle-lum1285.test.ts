/**
 * @jest-environment node
 *
 * LUM-1285 (server): project status / dates / archive on update, derived
 * completion on list, the task-create gate (refuse CANCELED / archived, warn
 * PAUSED, automation exempt) and the shared lifecycle helpers.
 */

jest.mock('marked', () => ({
  marked: { parse: jest.fn((md: string) => `<p>${md}</p>`) },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findByWorkspace: jest.fn(),
    countTasksByStatus: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    findByIdWithDefaults: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findById: jest.fn(), findByActorId: jest.fn() },
}))
jest.mock('@/lib/integrations/pusher/server', () => ({
  pushWorkspaceEvent: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/team', () => ({ getDefaultTeam: jest.fn() }))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    createWithSequence: jest.fn(),
    findMaxOrder: jest.fn().mockResolvedValue({ order: 0 }),
    findActorById: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    syncTaskTags: jest.fn().mockResolvedValue(undefined),
    findByTask: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/services/task-notifications.service', () => ({
  dispatchCreateTaskSideEffects: jest.fn(),
}))

import { projectRepository } from '@/lib/repositories/project.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { projectService } from '@/lib/services/project.service'
import {
  checkProjectAcceptsTasks,
  createFromAutomation,
  createTask,
} from '@/lib/services/task-creation.service'
import { updateProjectSchema } from '@/lib/validation/schemas'
import {
  CLOSED_TASK_STATUSES,
  isProjectCompleted,
  isProjectWorkable,
  isValidProjectDateWindow,
  parseProjectStatus,
  taskCreateGate,
} from '@/shared/src/project-lifecycle'

const findById = projectRepository.findById as jest.Mock
const update = projectRepository.update as jest.Mock
const findWithDefaults = projectRepository.findByIdWithDefaults as jest.Mock
const createWithSequence = taskRepository.createWithSequence as jest.Mock

const baseProject = {
  id: 'p1',
  workspaceId: 'ws-1',
  teamId: 'team-1',
  name: 'Mobile App',
  isIdea: false,
  createdByMemberId: 'member-1',
  description: null,
  status: 'ACTIVE',
  startDate: null as Date | null,
  targetDate: null as Date | null,
  archivedAt: null as Date | null,
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(memberRepository.findById as jest.Mock).mockResolvedValue({
    id: 'member-1',
    workspaceId: 'ws-1',
  })
  update.mockImplementation(async (_id, _ws, data) => ({
    ...baseProject,
    ...data,
    owner: null,
  }))
})

describe('shared lifecycle helpers', () => {
  it('completion: ≥1 task and none open; only DONE closes today', () => {
    expect(CLOSED_TASK_STATUSES).toEqual(['DONE'])
    expect(isProjectCompleted({})).toBe(false)
    expect(isProjectCompleted({ DONE: 0, TODO: 0 })).toBe(false)
    expect(isProjectCompleted({ DONE: 3, TODO: 0, BACKLOG: 0 })).toBe(true)
    expect(isProjectCompleted({ DONE: 3, BACKLOG: 1 })).toBe(false)
    expect(isProjectCompleted({ DONE: 3, IN_REVIEW: 1 })).toBe(false)
  })

  it('workable: only ACTIVE and unarchived; a missing status is ACTIVE', () => {
    expect(isProjectWorkable({ status: 'ACTIVE', archivedAt: null })).toBe(true)
    expect(isProjectWorkable({})).toBe(true)
    expect(isProjectWorkable({ status: 'PAUSED' })).toBe(false)
    expect(isProjectWorkable({ status: 'CANCELED' })).toBe(false)
    expect(
      isProjectWorkable({ status: 'ACTIVE', archivedAt: '2026-10-01' })
    ).toBe(false)
  })

  it('task-create gate: archived/canceled refuse, paused warns', () => {
    expect(taskCreateGate({ status: 'ACTIVE' })).toEqual({ kind: 'allow' })
    expect(taskCreateGate({ status: 'PAUSED' })).toEqual({
      kind: 'warn',
      reason: 'paused',
    })
    expect(taskCreateGate({ status: 'CANCELED' })).toEqual({
      kind: 'refuse',
      reason: 'canceled',
    })
    expect(
      taskCreateGate({ status: 'PAUSED', archivedAt: new Date() })
    ).toEqual({ kind: 'refuse', reason: 'archived' })
  })

  it('date window: target ≥ start; either side unset is fine', () => {
    expect(isValidProjectDateWindow('2026-11-01', '2026-11-01')).toBe(true)
    expect(isValidProjectDateWindow('2026-11-02', '2026-11-01')).toBe(false)
    expect(isValidProjectDateWindow(null, '2026-11-01')).toBe(true)
    expect(isValidProjectDateWindow('2026-11-01', undefined)).toBe(true)
  })

  it('parseProjectStatus is case-insensitive and rejects COMPLETED', () => {
    expect(parseProjectStatus(' paused ')).toBe('PAUSED')
    expect(parseProjectStatus('Canceled')).toBe('CANCELED')
    expect(parseProjectStatus('completed')).toBeNull()
  })
})

describe('updateProjectSchema', () => {
  it('accepts status, dates and archived', () => {
    const r = updateProjectSchema.safeParse({
      status: 'PAUSED',
      startDate: '2026-11-01',
      targetDate: '2026-12-01',
      archived: true,
    })
    expect(r.success).toBe(true)
  })

  it('rejects a target before the start', () => {
    const r = updateProjectSchema.safeParse({
      startDate: '2026-12-01',
      targetDate: '2026-11-01',
    })
    expect(r.success).toBe(false)
  })

  it('rejects an unknown status (no stored COMPLETED)', () => {
    expect(updateProjectSchema.safeParse({ status: 'COMPLETED' }).success).toBe(
      false
    )
  })
})

describe('projectService.updateProject lifecycle fields', () => {
  it('stores status and dates', async () => {
    findById.mockResolvedValue({ ...baseProject })
    const start = new Date('2026-11-01T00:00:00Z')
    const target = new Date('2026-12-01T00:00:00Z')
    await projectService.updateProject('p1', 'lumo', 'member-1', {
      status: 'PAUSED',
      startDate: start,
      targetDate: target,
    })
    expect(update).toHaveBeenCalledWith('p1', 'ws-1', {
      status: 'PAUSED',
      startDate: start,
      targetDate: target,
    })
  })

  it('refuses a lone target before the stored start (400)', async () => {
    findById.mockResolvedValue({
      ...baseProject,
      startDate: new Date('2026-11-10T00:00:00Z'),
    })
    await expect(
      projectService.updateProject('p1', 'lumo', 'member-1', {
        targetDate: new Date('2026-11-01T00:00:00Z'),
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(update).not.toHaveBeenCalled()
  })

  it('clearing the start lifts the window check', async () => {
    findById.mockResolvedValue({
      ...baseProject,
      targetDate: new Date('2026-11-01T00:00:00Z'),
    })
    await projectService.updateProject('p1', 'lumo', 'member-1', {
      startDate: null,
    })
    expect(update).toHaveBeenCalledWith('p1', 'ws-1', { startDate: null })
  })

  it('archived: true stamps archivedAt; already archived keeps the stamp', async () => {
    findById.mockResolvedValue({ ...baseProject })
    await projectService.updateProject('p1', 'lumo', 'member-1', {
      archived: true,
    })
    expect(update.mock.calls[0][2].archivedAt).toBeInstanceOf(Date)

    update.mockClear()
    findById.mockResolvedValue({
      ...baseProject,
      archivedAt: new Date('2026-10-01T00:00:00Z'),
    })
    await projectService.updateProject('p1', 'lumo', 'member-1', {
      archived: true,
    })
    expect(update.mock.calls[0][2]).toEqual({})
  })

  it('archived: false clears archivedAt', async () => {
    findById.mockResolvedValue({
      ...baseProject,
      archivedAt: new Date('2026-10-01T00:00:00Z'),
    })
    await projectService.updateProject('p1', 'lumo', 'member-1', {
      archived: false,
    })
    expect(update).toHaveBeenCalledWith('p1', 'ws-1', { archivedAt: null })
  })
})

describe('projectService.listProjects derived completion', () => {
  it('adds completed from the task counts', async () => {
    ;(projectRepository.findByWorkspace as jest.Mock).mockResolvedValue([
      { ...baseProject, id: 'done', owner: null },
      { ...baseProject, id: 'open', owner: null },
      { ...baseProject, id: 'empty', owner: null },
    ])
    ;(projectRepository.countTasksByStatus as jest.Mock).mockResolvedValue(
      new Map([
        [
          'done',
          { BACKLOG: 0, TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 2 },
        ],
        [
          'open',
          { BACKLOG: 1, TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 2 },
        ],
      ])
    )
    const list = await projectService.listProjects('ws-1', 'member-1')
    expect(Object.fromEntries(list.map(p => [p.id, p.completed]))).toEqual({
      done: true,
      open: false,
      empty: false,
    })
  })
})

describe('task create gate', () => {
  const input = { title: 'T', status: 'TODO', priority: 'LOW' } as const

  beforeEach(() => {
    createWithSequence.mockResolvedValue({
      id: 't-1',
      teamIdentifier: 'LUM',
      number: 1,
      title: 'T',
      teamId: 'team-1',
    })
  })

  it('refuses a CANCELED project with 409 and the reactivate hint', async () => {
    findWithDefaults.mockResolvedValue({
      ...baseProject,
      status: 'CANCELED',
      workspace: { slug: 'lumo' },
    })
    await expect(createTask('p1', input, 'a', 'c', 'm')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(
        '`lumo project update mobile-app --status active`'
      ),
    })
    expect(createWithSequence).not.toHaveBeenCalled()
  })

  it('refuses an archived project with 409 and the unarchive hint', async () => {
    findWithDefaults.mockResolvedValue({
      ...baseProject,
      archivedAt: new Date(),
      workspace: { slug: 'lumo' },
    })
    await expect(createTask('p1', input, 'a', 'c', 'm')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('`lumo project unarchive mobile-app`'),
    })
  })

  it('a PAUSED project creates the task and returns a warning', async () => {
    findWithDefaults.mockResolvedValue({
      ...baseProject,
      status: 'PAUSED',
      workspace: { slug: 'lumo' },
    })
    const r = await createTask('p1', input, 'a', 'c', 'm')
    expect(createWithSequence).toHaveBeenCalledTimes(1)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/is paused/)
  })

  it('an ACTIVE project: no warning', async () => {
    findWithDefaults.mockResolvedValue({
      ...baseProject,
      workspace: { slug: 'lumo' },
    })
    const r = await createTask('p1', input, 'a', 'c', 'm')
    expect(r.warnings).toEqual([])
  })

  it('automation (crossing remediation) is exempt from the refusal', async () => {
    findWithDefaults.mockResolvedValue({
      ...baseProject,
      status: 'CANCELED',
      archivedAt: new Date(),
      workspace: { slug: 'lumo' },
    })
    const r = await createTask('p1', input, 'a', 'c', 'm', { automation: true })
    expect(createWithSequence).toHaveBeenCalledTimes(1)
    expect(r.warnings).toEqual([])
  })

  it('webhook createFromAutomation is never refused', async () => {
    findWithDefaults.mockResolvedValue({
      ...baseProject,
      status: 'CANCELED',
      workspace: { slug: 'lumo' },
    })
    await createFromAutomation('p1', {
      title: 'Sentry',
      description: null,
      priority: 'HIGH',
      assigneeActorId: null,
      tagIds: [],
    })
    expect(createWithSequence).toHaveBeenCalledTimes(1)
  })

  it('checkProjectAcceptsTasks skip flag', () => {
    expect(
      checkProjectAcceptsTasks(
        { name: 'X', status: 'CANCELED' },
        { skip: true }
      )
    ).toEqual([])
  })
})
