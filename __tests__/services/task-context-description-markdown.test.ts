jest.mock('marked', () => ({
  marked: { parse: jest.fn((md: string) => `<p>${md}</p>`) },
}))

jest.mock('turndown', () => {
  return jest.fn().mockImplementation(() => ({
    turndown: (html: string) => html.replace(/<p>(.*?)<\/p>/g, '$1'),
  }))
})

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { listForTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn().mockResolvedValue([]),
    findActiveProjectMemories: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: { listByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: { listByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/task-artifact.repository', () => ({
  taskArtifactRepository: { listByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/services/task-figma-link.service', () => ({
  taskFigmaLinkService: { listForTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    resolveIdentifier: jest.fn().mockResolvedValue({
      id: 't1',
      identifier: 'LUM-1',
    }),
  },
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: {
    findDocumentsForContext: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/comment.repository', () => ({
  commentRepository: { listAllForTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listByTask: jest.fn().mockResolvedValue([]),
    listIdAndNumberByTask: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/pr-comment-mirror.repository', () => ({
  prCommentMirrorRepository: {
    listReviewTodosForPrs: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/actor.repository', () => ({
  actorRepository: {
    findGithubIdentitiesByIds: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/services/document.service', () => ({
  scheduleDocumentSummary: jest.fn(),
}))

import { taskRepository } from '@/lib/repositories/task.repository'
import { taskContextService } from '@/lib/services/task-context.service'

beforeEach(() => {
  jest.clearAllMocks()
  ;(taskRepository.findById as jest.Mock).mockReset()
})

describe('task-context descriptionMarkdown', () => {
  it('returns descriptionMarkdown alongside description', async () => {
    ;(taskRepository.findById as jest.Mock).mockResolvedValue({
      id: 't1',
      title: 'T',
      status: 'TODO',
      description: '<p>body</p>',
      milestoneId: null,
      projectId: 'p1',
    })

    const result = await taskContextService.getContextForIdentifier(
      'w1',
      'm1',
      'LUM-1'
    )
    expect(result).not.toBeNull()
    expect(result!.task.description).toBe('<p>body</p>')
    expect(result!.task.descriptionMarkdown).toBe('body')
  })

  it('returns null descriptionMarkdown when description is null', async () => {
    ;(taskRepository.findById as jest.Mock).mockResolvedValue({
      id: 't1',
      title: 'T',
      status: 'TODO',
      description: null,
      milestoneId: null,
      projectId: 'p1',
    })

    const result = await taskContextService.getContextForIdentifier(
      'w1',
      'm1',
      'LUM-1'
    )
    expect(result!.task.descriptionMarkdown).toBeNull()
  })
})
