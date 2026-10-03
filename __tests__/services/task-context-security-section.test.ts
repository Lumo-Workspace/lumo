/** @jest-environment node */
// LUM-737: buildSessionStartSections carries the undispositioned-security-
// findings section. Same ESM-avoidance mocks as the sibling task-context suites.
jest.mock('@/lib/services/task.service', () => ({
  taskService: { resolveIdentifier: jest.fn() },
}))
jest.mock('@/lib/services/document.service', () => ({
  scheduleDocumentSummary: jest.fn(),
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findAcceptanceModeByTask: jest.fn(async () => false) },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { listForTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn(async () => []),
    findActiveProjectMemories: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: { listByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: { listByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/task-artifact.repository', () => ({
  taskArtifactRepository: { listByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/services/task-figma-link.service', () => ({
  taskFigmaLinkService: { listForTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findDocumentsForContext: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/comment.repository', () => ({
  commentRepository: { listAllForTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listByTask: jest.fn(async () => []),
    listIdAndNumberByTask: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/pr-comment-mirror.repository', () => ({
  prCommentMirrorRepository: {
    listReviewTodosForPrs: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/actor.repository', () => ({
  actorRepository: { findGithubIdentitiesByIds: jest.fn(async () => []) },
}))
jest.mock('@/lib/services/pr-security-reminder.service', () => ({
  prSecurityReminderService: { buildSessionStartSection: jest.fn() },
}))

import { taskContextService } from '@/lib/services/task-context.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { prSecurityReminderService } from '@/lib/services/pr-security-reminder.service'

const mockFindById = taskRepository.findById as jest.Mock
const mockSecurity =
  prSecurityReminderService.buildSessionStartSection as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockFindById.mockResolvedValue({
    id: 'tsk_1',
    projectId: 'proj_1',
    number: 7,
    team: { identifier: 'LUM' },
    title: 'T',
    status: 'IN_PROGRESS',
    description: null,
    milestoneId: null,
    commentsSummary: null,
  })
})

describe('buildSessionStartSections — security findings section (LUM-737)', () => {
  it('carries the section built for the task identifier when findings are open', async () => {
    mockSecurity.mockResolvedValue(
      '## ⚠ Undispositioned security findings (1 · 1 block DONE)\n…'
    )
    const out = await taskContextService.buildSessionStartSections('tsk_1')
    expect(mockSecurity).toHaveBeenCalledWith('tsk_1', 'LUM-7')
    expect(out.securityFindingsSection).toContain(
      'Undispositioned security findings'
    )
  })

  it('is empty when the service has nothing to show', async () => {
    mockSecurity.mockResolvedValue('')
    const out = await taskContextService.buildSessionStartSections('tsk_1')
    expect(out.securityFindingsSection).toBe('')
  })

  it('a failed security read degrades to "" and leaves every other section intact', async () => {
    mockSecurity.mockRejectedValue(new Error('db down'))
    const out = await taskContextService.buildSessionStartSections('tsk_1')
    expect(out.securityFindingsSection).toBe('')
    expect(out).toMatchObject({
      memorySection: expect.any(String),
      linkedResourcesSection: expect.any(String),
    })
    expect(out.budget.budgetTokens).toBeGreaterThan(0)
  })
})
