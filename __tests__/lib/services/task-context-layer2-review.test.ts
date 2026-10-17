/**
 * @jest-environment node
 *
 * LUM-165: buildLayer2ReviewSectionForTask surfaces the PROJECT memories the
 * member's immediately-preceding session consolidated, scoped to the current
 * task's project, exactly once at session-start.
 */
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findById: jest.fn(), findByWorkspaceIdentifier: jest.fn() },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn(),
    findActiveProjectMemories: jest.fn(),
    findProjectMemoriesBySession: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    listForTask: jest.fn(),
    findPreviousSessionIdForMember: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {},
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {},
}))
jest.mock('@/lib/repositories/tag.repository', () => ({ tagRepository: {} }))
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {},
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {},
}))
jest.mock('@/lib/services/task-pr-sync.service', () => ({
  syncPullRequestStatus: jest.fn(),
}))
jest.mock('@/lib/services/task-notifications.service', () => ({
  dispatchCreateTaskSideEffects: jest.fn(),
  dispatchUpdateTaskSideEffects: jest.fn(),
}))

import { taskContextService } from '@/lib/services/task-context.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'

const findById = taskRepository.findById as jest.Mock
const findPrev = sessionRepository.findPreviousSessionIdForMember as jest.Mock
const findBySession = memoryRepository.findProjectMemoriesBySession as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  findById.mockResolvedValue({ id: 't1', projectId: 'proj_1' })
  findPrev.mockResolvedValue('sess_prev')
  findBySession.mockResolvedValue([])
})

describe('buildLayer2ReviewSectionForTask', () => {
  it('returns "" when the task is gone', async () => {
    findById.mockResolvedValue(null)
    const out = await taskContextService.buildLayer2ReviewSectionForTask(
      't1',
      'cur'
    )
    expect(out.section).toBe('')
    expect(out.fragments).toEqual([])
    expect(findPrev).not.toHaveBeenCalled()
  })

  it('returns "" when there is no preceding session', async () => {
    findPrev.mockResolvedValue(null)
    const out = await taskContextService.buildLayer2ReviewSectionForTask(
      't1',
      'cur'
    )
    expect(out.section).toBe('')
    expect(out.fragments).toEqual([])
    expect(findBySession).not.toHaveBeenCalled()
  })

  it('returns "" when the previous session promoted nothing into this project', async () => {
    findBySession.mockResolvedValue([])
    const out = await taskContextService.buildLayer2ReviewSectionForTask(
      't1',
      'cur'
    )
    expect(out.section).toBe('')
    expect(out.fragments).toEqual([])
  })

  it('queries the previous session, scoped to the task project', async () => {
    findBySession.mockResolvedValue([
      {
        id: 'mem_1',
        category: 'TRAP',
        content: { trigger: 't', outcome: 'o' },
      },
    ])
    await taskContextService.buildLayer2ReviewSectionForTask('t1', 'cur')
    expect(findPrev).toHaveBeenCalledWith('cur')
    expect(findBySession).toHaveBeenCalledWith('sess_prev', 'proj_1')
  })

  it('renders a review section listing the promoted memory + its id + rm hint', async () => {
    findBySession.mockResolvedValue([
      {
        id: 'mem_42',
        category: 'TRAP',
        content: { trigger: 'enum mid-migration', outcome: 'P3009' },
      },
    ])
    const out = await taskContextService.buildLayer2ReviewSectionForTask(
      't1',
      'cur'
    )
    expect(out.section).toContain('Review needed')
    expect(out.section).toContain('enum mid-migration')
    expect(out.section).toContain('ref: mem_42')
    expect(out.section).toContain('lumo memory rm')
    // Member-authored bodies are wrapped as untrusted.
    expect(out.section).toContain('<untrusted-team-memory>')
    expect(out.fragments).toEqual([
      { fragmentType: 'MEMORY', fragmentId: 'mem_42' },
    ])
  })
})
