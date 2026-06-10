/**
 * @jest-environment node
 */
// Hoist mocks before imports so Jest can intercept module resolution.
// task-context.service.ts transitively imports task.service.ts which fans
// out into GitHub/Slack integrations — stub those away so the module loads.
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findById: jest.fn(),
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn(),
    findActiveProjectMemories: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { listForTask: jest.fn() },
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
import { memoryRepository } from '@/lib/repositories/memory.repository'

describe('taskContextService.buildMemorySectionForTask', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns "" when task has no task-scope or project-scope memories', async () => {
    ;(taskRepository.findById as jest.Mock).mockResolvedValue({
      id: 'task-1',
      projectId: 'project-1',
    })
    ;(memoryRepository.findActiveTaskMemories as jest.Mock).mockResolvedValue([])
    ;(memoryRepository.findActiveProjectMemories as jest.Mock).mockResolvedValue([])

    const result = await taskContextService.buildMemorySectionForTask('task-1')

    expect(result).toBe('')
  })

  it('returns markdown with PROJECT-scope memories ordered before TASK-scope', async () => {
    ;(taskRepository.findById as jest.Mock).mockResolvedValue({
      id: 'task-1',
      projectId: 'project-1',
    })
    ;(memoryRepository.findActiveProjectMemories as jest.Mock).mockResolvedValue([
      {
        id: 'mem-p',
        category: 'CONVENTION',
        content: { rule: 'Project rule', scope: 'project' },
        // Human-recorded row → user-authored source label (LUM-347).
        createdByMemberId: 'member-1',
      },
    ])
    ;(memoryRepository.findActiveTaskMemories as jest.Mock).mockResolvedValue([
      {
        id: 'mem-t',
        category: 'CONVENTION',
        content: { rule: 'Task rule', scope: 'task' },
        // Agent-distilled row → agent-authored source label (LUM-347).
        createdByMemberId: null,
      },
    ])

    const result = await taskContextService.buildMemorySectionForTask('task-1')

    expect(result).toContain('## Relevant Memory')
    expect(result).toContain('### Conventions')
    expect(result).toContain('[project · user-authored]')
    expect(result).toContain('[task · agent-authored]')
    // Both memories are CONVENTION, so the only thing that can drive order
    // is scope. The service orders PROJECT before TASK.
    expect(result.indexOf('[project ')).toBeLessThan(result.indexOf('[task '))
  })

  it('returns "" when task does not exist', async () => {
    ;(taskRepository.findById as jest.Mock).mockResolvedValue(null)

    const result = await taskContextService.buildMemorySectionForTask('missing')

    expect(result).toBe('')
    expect(memoryRepository.findActiveTaskMemories).not.toHaveBeenCalled()
    expect(memoryRepository.findActiveProjectMemories).not.toHaveBeenCalled()
  })
})
