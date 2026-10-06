/** @jest-environment node */
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: { listByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/task-artifact.repository', () => ({
  taskArtifactRepository: { listByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/services/task-figma-link.service', () => ({
  taskFigmaLinkService: {
    listForTask: jest.fn().mockResolvedValue([]),
    refreshLinksForTask: jest.fn().mockResolvedValue([]),
    refreshLinksForTaskAuto: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn().mockResolvedValue(null) },
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    resolveIdentifier: jest.fn(async () => ({
      id: 'tsk_1',
      identifier: 'LUM-1',
    })),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findById: jest.fn(async () => ({
      id: 'tsk_1',
      title: 't',
      status: 'TODO',
      description: 'd',
      projectId: 'proj_1',
    })),
  },
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
jest.mock('@/lib/memory/render', () => ({
  wrapUntrustedTaskDescription: jest.fn((s: string) => s),
  renderMemorySection: jest.fn(() => ''),
  applyTokenBudget: jest.fn((x: unknown[]) => x),
  wrapUntrustedMemory: jest.fn((s: string) => s),
  renderMemoryIndexBlock: jest.fn(() => ''),
  // Faithful to the real contract: "" stays "", non-empty gets the boundary —
  // lets these assembly tests assert the LUM-347 routing without re-testing
  // the wrapper's own text (covered in __tests__/lib/memory/render.test.ts).
  wrapUntrustedLinked: jest.fn((s: string) =>
    s.trim() === ''
      ? ''
      : `<untrusted-linked-context>\n${s}\n</untrusted-linked-context>`
  ),
  wrapUntrustedLinkedGroup: jest.fn((xs: string[]) =>
    xs.map(s =>
      s.trim() === ''
        ? ''
        : `<untrusted-linked-context>\n${s}\n</untrusted-linked-context>`
    )
  ),
}))
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

import { taskSlackContextRepository } from '@/lib/repositories/task-slack-context.repository'
import { taskContextService } from '@/lib/services/task-context.service'

const listByTask = taskSlackContextRepository.listByTask as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskContextService.getContextForIdentifier — slackContextSection', () => {
  it('returns empty string when no contexts', async () => {
    listByTask.mockResolvedValue([])
    const ctx = await taskContextService.getContextForIdentifier(
      'ws_1',
      'member_1',
      'LUM-1'
    )
    expect(ctx?.slackContextSection).toBe('')
  })

  it('renders a tiered card with cached summary + retrieval command', async () => {
    listByTask.mockResolvedValue([
      {
        id: 'ctx_1',
        isThread: false,
        slackChannelName: 'design',
        slackChannelId: 'C9',
        permalink: 'https://lumo.slack.com/archives/C9/p1700000000000100',
        snapshotAt: new Date('2026-05-19T10:00:00Z'),
        refreshError: null,
        summary: 'Decided to ship after review.',
        snapshot: {
          messages: [
            {
              ts: '1700000000.000100',
              userId: 'U1',
              userName: 'alice',
              userAvatarUrl: null,
              text: 'hello',
              edited: false,
            },
          ],
        },
      },
    ])
    const ctx = await taskContextService.getContextForIdentifier(
      'ws_1',
      'member_1',
      'LUM-1'
    )
    // LUM-347: the GET path now serves this section inside the boundary.
    expect(
      ctx?.slackContextSection.startsWith('<untrusted-linked-context>')
    ).toBe(true)
    expect(ctx?.slackContextSection).toContain('## Slack Context')
    expect(ctx?.slackContextSection).toContain('#design')
    expect(ctx?.slackContextSection).toContain('Single message')
    expect(ctx?.slackContextSection).toContain('Decided to ship after review.')
    expect(ctx?.slackContextSection).toContain(
      'lumo task slack show LUM-1 ctx_1'
    )
    // Full thread is no longer inlined when a summary exists.
    expect(ctx?.slackContextSection).not.toContain('alice: hello')
  })

  it('falls back to first messages when no summary cached yet', async () => {
    listByTask.mockResolvedValue([
      {
        id: 'ctx_2',
        isThread: true,
        slackChannelName: 'eng',
        slackChannelId: 'C9',
        permalink: 'https://lumo.slack.com/archives/C9/p1700000000000100',
        snapshotAt: new Date('2026-05-19T10:00:00Z'),
        refreshError: null,
        summary: null,
        snapshot: {
          messages: [
            {
              ts: '1700000000.000100',
              userId: 'U1',
              userName: 'a',
              userAvatarUrl: null,
              text: 'one',
              edited: false,
            },
            {
              ts: '1700000000.000200',
              userId: 'U2',
              userName: 'b',
              userAvatarUrl: null,
              text: 'two',
              edited: false,
            },
          ],
        },
      },
    ])
    const ctx = await taskContextService.getContextForIdentifier(
      'ws_1',
      'member_1',
      'LUM-1'
    )
    expect(ctx?.slackContextSection).toContain('Thread (2 messages')
    expect(ctx?.slackContextSection).toContain('a: one')
    expect(ctx?.slackContextSection).toContain('b: two')
  })

  it('flags refreshError when present', async () => {
    listByTask.mockResolvedValue([
      {
        id: 'ctx_3',
        isThread: false,
        slackChannelName: 'design',
        slackChannelId: 'C9',
        permalink: 'https://lumo.slack.com/archives/C9/p1700000000000100',
        snapshotAt: new Date('2026-05-19T10:00:00Z'),
        refreshError: 'not_in_channel',
        summary: 'A summary.',
        snapshot: {
          messages: [
            {
              ts: '1700000000.000100',
              userId: 'U1',
              userName: 'alice',
              userAvatarUrl: null,
              text: 'hello',
              edited: false,
            },
          ],
        },
      },
    ])
    const ctx = await taskContextService.getContextForIdentifier(
      'ws_1',
      'member_1',
      'LUM-1'
    )
    expect(ctx?.slackContextSection).toContain('refresh failed: not_in_channel')
  })

  it('converts <@U…> mentions to @U… plain tokens in the fallback', async () => {
    listByTask.mockResolvedValue([
      {
        id: 'ctx_4',
        isThread: false,
        slackChannelName: 'design',
        slackChannelId: 'C9',
        permalink: 'https://lumo.slack.com/archives/C9/p1700000000000100',
        snapshotAt: new Date('2026-05-19T10:00:00Z'),
        refreshError: null,
        summary: null,
        snapshot: {
          messages: [
            {
              ts: '1700000000.000100',
              userId: 'U1',
              userName: 'alice',
              userAvatarUrl: null,
              text: 'hey <@U999> look at this <#C5|design>',
              edited: false,
            },
          ],
        },
      },
    ])
    const ctx = await taskContextService.getContextForIdentifier(
      'ws_1',
      'member_1',
      'LUM-1'
    )
    expect(ctx?.slackContextSection).toContain('hey @U999 look at this #design')
    expect(ctx?.slackContextSection).not.toContain('<@U999>')
    expect(ctx?.slackContextSection).not.toContain('<#C5|design>')
  })
})
