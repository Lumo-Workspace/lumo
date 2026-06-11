import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { createTask } from '@/lib/services/task-creation.service'
import { taskDependencyService } from '@/lib/services/task-dependency.service'

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findById: jest.fn(),
    findAllByTask: jest.fn(),
    disposition: jest.fn(),
    setRemediationTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findActorByMemberId: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findWithProject: jest.fn(), findHeaderById: jest.fn() },
}))
jest.mock('@/lib/services/task-creation.service', () => ({
  createTask: jest.fn(),
}))
jest.mock('@/lib/services/task-dependency.service', () => ({
  taskDependencyService: { addManual: jest.fn() },
}))

const findById = boundaryCrossingRepository.findById as jest.Mock
const findAll = boundaryCrossingRepository.findAllByTask as jest.Mock
const disposition = boundaryCrossingRepository.disposition as jest.Mock
const setRemediation =
  boundaryCrossingRepository.setRemediationTask as jest.Mock
const createActivity = activityRepository.create as jest.Mock
const findActor = memberRepository.findActorByMemberId as jest.Mock
const findWithProject = taskRepository.findWithProject as jest.Mock
const findHeader = taskRepository.findHeaderById as jest.Mock
const create = createTask as jest.Mock
const addManual = taskDependencyService.addManual as jest.Mock

const ATTRIB = { actorMemberId: 'member-1', actorClerkId: 'clerk-1' }

beforeEach(() => {
  jest.clearAllMocks()
  findActor.mockResolvedValue({ id: 'actor-1' })
  disposition.mockResolvedValue({ count: 1 })
  setRemediation.mockResolvedValue({ id: 'bc-1' })
  createActivity.mockResolvedValue({ id: 'act-1' })
})

describe('boundaryCrossingService.disposition', () => {
  it('dispositions an open crossing (FALSE_POSITIVE) and writes a human-attributed marker', async () => {
    findById.mockResolvedValue({
      id: 'bc-1',
      taskId: 't-1',
      category: 'NEW_NPM_DEPENDENCY',
      detail: 'npm install date-fns',
      disposition: null,
    })
    const out = await boundaryCrossingService.disposition(
      't-1',
      'bc-1',
      'FALSE_POSITIVE',
      'detector lag',
      ATTRIB
    )
    expect(out).toEqual({ crossingId: 'bc-1', disposition: 'FALSE_POSITIVE' })
    expect(disposition).toHaveBeenCalledWith(
      'bc-1',
      'FALSE_POSITIVE',
      'detector lag',
      'actor-1',
      expect.any(Date)
    )
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-1',
        actorId: 'actor-1',
        type: 'BOUNDARY_CROSSING_DISPOSITIONED',
      })
    )
  })

  it('404s when the crossing is not on the task (no cross-task disposition)', async () => {
    findById.mockResolvedValue({
      id: 'bc-1',
      taskId: 'other',
      disposition: null,
    })
    await expect(
      boundaryCrossingService.disposition(
        't-1',
        'bc-1',
        'CONFIRMED',
        null,
        ATTRIB
      )
    ).rejects.toMatchObject({ status: 404 })
    expect(disposition).not.toHaveBeenCalled()
  })

  it('is idempotent: re-dispositioning an already-dispositioned crossing writes no second marker', async () => {
    findById.mockResolvedValue({
      id: 'bc-1',
      taskId: 't-1',
      category: 'PUSH_TO_PROTECTED_BRANCH',
      detail: 'git push origin main',
      disposition: 'CONFIRMED',
    })
    const out = await boundaryCrossingService.disposition(
      't-1',
      'bc-1',
      'CONFIRMED',
      null,
      ATTRIB
    )
    expect(out).toEqual({ crossingId: 'bc-1', disposition: 'CONFIRMED' })
    expect(disposition).not.toHaveBeenCalled()
    expect(createActivity).not.toHaveBeenCalled()
  })
})

describe('boundaryCrossingService.listAll — acceptance read model', () => {
  it('crossing surfaces linked remediation task status', async () => {
    findAll.mockResolvedValue([
      {
        id: 'bc-1',
        category: 'MIGRATION_FILE_DELETED',
        detail: 'rm prisma/migrations/0042/migration.sql',
        detectedAt: new Date('2026-06-11T00:00:00.000Z'),
        reversible: false,
        disposition: 'CONFIRMED',
        dispositionNote: null,
        dispositionedAt: new Date('2026-06-11T01:00:00.000Z'),
        dispositionedById: 'actor-1',
        remediationTask: {
          number: 441,
          title: 'Restore migration',
          status: 'DONE',
          team: { identifier: 'LUM' },
        },
      },
    ])
    const views = await boundaryCrossingService.listAll('t-1')
    const view = views[0]!
    expect(view.remediationTask).toEqual({
      identifier: 'LUM-441',
      title: 'Restore migration',
      status: 'DONE',
      remediated: true,
    })
  })

  it('dispositioned crossings stay in the acceptance read model', async () => {
    findAll.mockResolvedValue([
      {
        id: 'bc-open',
        category: 'HARDCODED_SECRET',
        detail: 'AWS key in lib/config/aws.ts',
        detectedAt: new Date('2026-06-11T00:00:00.000Z'),
        reversible: false,
        disposition: null,
        dispositionNote: null,
        dispositionedAt: null,
        dispositionedById: null,
        remediationTask: null,
      },
      {
        id: 'bc-confirmed',
        category: 'PUSH_TO_PROTECTED_BRANCH',
        detail: 'git push --force origin main',
        detectedAt: new Date('2026-06-10T00:00:00.000Z'),
        reversible: false,
        disposition: 'CONFIRMED',
        dispositionNote: 'owned it',
        dispositionedAt: new Date('2026-06-10T02:00:00.000Z'),
        dispositionedById: 'actor-1',
        remediationTask: null,
      },
    ])
    const views = await boundaryCrossingService.listAll('t-1')
    // The read model returns ALL crossings, not open-only — a CONFIRMED crossing
    // is never removed or hidden after disposition.
    expect(views.map(v => v.id)).toEqual(['bc-open', 'bc-confirmed'])
    const confirmed = views.find(v => v.id === 'bc-confirmed')
    expect(confirmed?.disposition).toBe('CONFIRMED')
  })
})

describe('boundaryCrossingService.spawnRemediation', () => {
  it('spawn remediation task pre-links the crossing and adds the dependency edge', async () => {
    findById.mockResolvedValue({
      id: 'bc-1',
      taskId: 't-1',
      category: 'MIGRATION_FILE_DELETED',
      detail: 'rm prisma/migrations/0042/migration.sql',
      disposition: 'CONFIRMED',
      remediationTaskId: null,
    })
    findWithProject.mockResolvedValue({ id: 't-1', projectId: 'p-1' })
    create.mockResolvedValue({
      task: { id: 'remediation-1', number: 441, teamIdentifier: 'LUM' },
    })

    const out = await boundaryCrossingService.spawnRemediation('t-1', 'bc-1', {
      ...ATTRIB,
      workspaceId: 'w-1',
    })

    // A follow-up task is created in the original task's project.
    expect(create).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ status: 'TODO' }),
      'actor-1',
      'clerk-1'
    )
    // The crossing is PRE-LINKED to the new task.
    expect(setRemediation).toHaveBeenCalledWith('bc-1', 'remediation-1')
    // A dependency edge is added: remediation blocked-by the original task.
    expect(addManual).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      blockedTaskId: 'remediation-1',
      blockingTaskId: 't-1',
      kind: 'BLOCKS',
    })
    expect(out).toEqual({
      crossingId: 'bc-1',
      remediationTaskId: 'remediation-1',
      remediationTaskIdentifier: 'LUM-441',
    })
  })

  it('is idempotent: a crossing already linking a remediation task does not create a second', async () => {
    findById.mockResolvedValue({
      id: 'bc-1',
      taskId: 't-1',
      category: 'MIGRATION_FILE_DELETED',
      detail: 'rm …',
      disposition: 'CONFIRMED',
      remediationTaskId: 'remediation-existing',
    })
    findWithProject.mockResolvedValue({ id: 't-1', projectId: 'p-1' })
    findHeader.mockResolvedValue({ number: 9, team: { identifier: 'LUM' } })

    const out = await boundaryCrossingService.spawnRemediation('t-1', 'bc-1', {
      ...ATTRIB,
      workspaceId: 'w-1',
    })
    expect(create).not.toHaveBeenCalled()
    expect(addManual).not.toHaveBeenCalled()
    expect(out.remediationTaskId).toBe('remediation-existing')
  })
})
