/** @jest-environment node */
// LUM-274: getContextForIdentifier must surface a flat fragment manifest
// `[{ type, id }]` alongside the pre-rendered *Section strings — the stable
// reference layer that lineage edge-recording (LUM-275+) builds on. This test
// asserts the manifest covers every non-empty section type (Session uses its
// UUID, every other type its cuid) and stays empty when nothing is attached.

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
  taskFigmaLinkService: {
    listForTask: jest.fn().mockResolvedValue([]),
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
      commentsSummary: null,
    })),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { listForTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    findTurnBoundaryEventsForSessions: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn().mockResolvedValue([]),
    findActiveProjectMemories: jest.fn().mockResolvedValue([]),
  },
}))
// Real renderMemorySection is exercised elsewhere; here we only need it to be
// non-empty for non-empty input so the "non-empty section ⟺ fragment" invariant
// is observable, and applyTokenBudget to be reconfigurable for the budget test.
jest.mock('@/lib/memory/render', () => ({
  renderMemorySection: jest.fn((xs: unknown[]) =>
    xs.length ? '## Relevant Memory\n(rendered)' : ''
  ),
  applyTokenBudget: jest.fn((xs: unknown[]) => xs),
  wrapUntrustedMemory: jest.fn((s: string) => s),
  renderMemoryIndexBlock: jest.fn(() => ''),
  renderLayer2ReviewSection: jest.fn(() => ''),
  wrapUntrustedLinked: jest.fn((s: string) => s),
  wrapUntrustedLinkedGroup: jest.fn((xs: string[]) => xs),
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findDocumentsForContext: jest.fn().mockResolvedValue([]) },
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
import { taskWebLinkRepository } from '@/lib/repositories/task-web-link.repository'
import { taskArtifactRepository } from '@/lib/repositories/task-artifact.repository'
import { taskFigmaLinkService } from '@/lib/services/task-figma-link.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { applyTokenBudget } from '@/lib/memory/render'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { actorRepository } from '@/lib/repositories/actor.repository'
import { taskContextService } from '@/lib/services/task-context.service'
import type { ContextFragment } from '@/lib/services/task-context.service'

const listSlack = taskSlackContextRepository.listByTask as jest.Mock
const listWeb = taskWebLinkRepository.listByTask as jest.Mock
const listArtifacts = taskArtifactRepository.listByTask as jest.Mock
const listFigma = taskFigmaLinkService.listForTask as jest.Mock
const listSessions = sessionRepository.listForTask as jest.Mock
const findTaskMemories = memoryRepository.findActiveTaskMemories as jest.Mock
const findProjectMemories =
  memoryRepository.findActiveProjectMemories as jest.Mock
const budget = applyTokenBudget as jest.Mock
const findDocs = miscRepository.findDocumentsForContext as jest.Mock
const listComments = commentRepository.listAllForTask as jest.Mock
const listPRs = pullRequestRepository.listByTask as jest.Mock
const listPRIds = pullRequestRepository.listIdAndNumberByTask as jest.Mock
const listReviewTodos =
  prCommentMirrorRepository.listReviewTodosForPrs as jest.Mock
const listGithubIdents = actorRepository.findGithubIdentitiesByIds as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  // clearAllMocks wipes call records but NOT mockResolvedValue, so reset every
  // data source to its empty default here; tests that want data opt in via
  // attachOneOfEverything(). budget defaults to identity.
  for (const m of [
    listSlack,
    listWeb,
    listArtifacts,
    listFigma,
    listSessions,
    findTaskMemories,
    findProjectMemories,
    findDocs,
    listComments,
    listPRs,
    listPRIds,
    listReviewTodos,
    listGithubIdents,
  ]) {
    m.mockResolvedValue([])
  }
  budget.mockImplementation((xs: unknown[]) => xs)
})

/** Populate every fragment-bearing source with exactly one record. */
function attachOneOfEverything(): void {
  findProjectMemories.mockResolvedValue([
    { id: 'mem_p1', category: 'CONVENTION', content: 'project mem' },
  ])
  findTaskMemories.mockResolvedValue([
    { id: 'mem_t1', category: 'CONTEXT', content: 'task mem' },
  ])
  listSlack.mockResolvedValue([
    {
      id: 'slk_1',
      isThread: false,
      slackChannelName: 'general',
      permalink: 'https://slack/x',
      snapshotAt: new Date('2026-05-30T10:00:00Z'),
      refreshError: null,
      summary: null,
      snapshot: {
        messages: [{ ts: '1', userName: 'a', userId: 'U1', text: 'hi' }],
      },
    },
  ])
  listWeb.mockResolvedValue([
    {
      id: 'web_1',
      url: 'https://example.com/a',
      domain: 'example.com',
      title: 'A',
      description: null,
      note: null,
      fetchedAt: new Date('2026-05-30T10:00:00Z'),
      fetchError: null,
    },
  ])
  listFigma.mockResolvedValue([
    {
      id: 'fig_1',
      fileName: 'Design',
      frameName: 'Home',
      url: 'https://figma/x',
      thumbnailUrl: 'https://figma/t.png',
      thumbnailFetchedAt: new Date('2026-05-30T10:00:00Z'),
      lastSyncError: null,
      lastSyncedAt: new Date('2026-05-30T10:00:00Z'),
    },
  ])
  listArtifacts.mockResolvedValue([
    {
      id: 'art_1',
      kind: 'plan',
      title: 'Plan',
      content: 'the plan body',
      agent: null,
      summary: 'one-liner',
    },
  ])
  findDocs.mockResolvedValue([
    {
      id: 'doc_1',
      title: 'Design Doc',
      updatedAt: new Date('2026-05-20T10:00:00Z'),
      summary: 'How it works.',
      summaryGeneratedAt: new Date('2026-05-21T10:00:00Z'),
      content: '<p>body</p>',
    },
  ])
  listComments.mockResolvedValue([
    {
      id: 'cmt_1',
      authorActorId: 'a1',
      body: 'a comment',
      createdAt: new Date('2026-05-30T10:00:00Z'),
    },
  ])
  listPRs.mockResolvedValue([
    {
      id: 'pr_1',
      number: 42,
      title: 'Add the thing',
      state: 'open',
      ciStatus: 'passing',
    },
  ])
  listPRIds.mockResolvedValue([{ id: 'pr_1', number: 42 }])
  listReviewTodos.mockResolvedValue([
    {
      id: 'mir_1',
      pullRequestId: 'pr_1',
      externalSource: 'REVIEW_LINE',
      externalUrl: 'https://gh/c/1',
      filePath: 'lib/foo.ts',
      lineStart: 40,
      lineEnd: 42,
      comment: {
        body: '<p>Extract this</p>',
        authorActorId: 'act_gh',
        createdAt: new Date('2026-05-30T10:00:00Z'),
      },
    },
  ])
  listGithubIdents.mockResolvedValue([
    { id: 'act_gh', externalIdentity: 'github:octocat' },
  ])
  listSessions.mockResolvedValue([
    {
      id: 'ses_uuid_1',
      startedAt: new Date('2026-05-30T09:00:00Z'),
      lastActivityAt: new Date('2026-05-30T10:00:00Z'),
      eventCount: 5,
      summaryType: 'implementation',
      summary: { goal: 'did stuff', unresolved: [] },
    },
  ])
}

const idsOfType = (frags: ContextFragment[], type: string): string[] =>
  frags.filter(f => f.type === type).map(f => f.id)

describe('taskContextService.getContextForIdentifier — fragment manifest', () => {
  it('surfaces a fragment for every non-empty section, keyed by stable id', async () => {
    attachOneOfEverything()

    const ctx = await taskContextService.getContextForIdentifier(
      'ws_1',
      'member_1',
      'LUM-1'
    )
    const frags = ctx?.fragments ?? []

    // Project memory ordered before task memory (matches section ordering).
    expect(idsOfType(frags, 'MEMORY')).toEqual(['mem_p1', 'mem_t1'])
    expect(idsOfType(frags, 'SLACK_CONTEXT')).toEqual(['slk_1'])
    expect(idsOfType(frags, 'WEB_LINK')).toEqual(['web_1'])
    expect(idsOfType(frags, 'FIGMA_LINK')).toEqual(['fig_1'])
    expect(idsOfType(frags, 'ARTIFACT')).toEqual(['art_1'])
    expect(idsOfType(frags, 'DOCUMENT')).toEqual(['doc_1'])
    expect(idsOfType(frags, 'COMMENT')).toEqual(['cmt_1'])
    expect(idsOfType(frags, 'PULL_REQUEST')).toEqual(['pr_1'])
    expect(idsOfType(frags, 'PR_REVIEW_TODO')).toEqual(['mir_1'])
    // Session keyed by its UUID, not a cuid.
    expect(idsOfType(frags, 'SESSION')).toEqual(['ses_uuid_1'])
  })

  it('covers exactly the non-empty section types — invariant check', async () => {
    attachOneOfEverything()

    const ctx = await taskContextService.getContextForIdentifier(
      'ws_1',
      'member_1',
      'LUM-1'
    )
    if (!ctx) throw new Error('expected context')

    const sectionByType: Array<[string, string]> = [
      ['MEMORY', ctx.memorySection],
      ['SLACK_CONTEXT', ctx.slackContextSection],
      ['WEB_LINK', ctx.webLinkSection],
      ['FIGMA_LINK', ctx.figmaSection],
      ['ARTIFACT', ctx.artifactSection],
      ['DOCUMENT', ctx.docSection],
      ['COMMENT', ctx.commentsSection],
      ['PULL_REQUEST', ctx.prSection],
      ['PR_REVIEW_TODO', ctx.prReviewTodosSection],
    ]
    for (const [type, section] of sectionByType) {
      const hasFragment = idsOfType(ctx.fragments, type).length > 0
      expect([type, section !== '']).toEqual([type, hasFragment])
    }
    // Sessions are fragments too even though they're not a "## section" string.
    expect(idsOfType(ctx.fragments, 'SESSION').length).toBe(ctx.sessions.length)
  })

  it('returns an empty manifest when nothing is attached', async () => {
    // All mocks default to [] from the factories; nothing populated.
    const ctx = await taskContextService.getContextForIdentifier(
      'ws_1',
      'member_1',
      'LUM-1'
    )

    expect(ctx?.fragments).toEqual([])
  })

  it('memory fragments reflect the budget-trimmed set the agent actually sees', async () => {
    attachOneOfEverything()
    // Budget drops the tail (task memory), keeping only the project memory.
    budget.mockImplementation((xs: Array<{ id: string }>) => xs.slice(0, 1))

    const ctx = await taskContextService.getContextForIdentifier(
      'ws_1',
      'member_1',
      'LUM-1'
    )

    expect(idsOfType(ctx?.fragments ?? [], 'MEMORY')).toEqual(['mem_p1'])
  })
})

describe('inferred (unattached) sessions in task context (LUM-932 P3 I6)', () => {
  const turnEvents =
    hookEventRepository.findTurnBoundaryEventsForSessions as jest.Mock
  const at = (m: number) => new Date(Date.UTC(2026, 9, 2, 0, m, 0))

  it('no summary headline/unresolved, per-task active time, and no SESSION lineage fragment', async () => {
    listSessions.mockResolvedValue([
      {
        id: 'ses_explicit',
        startedAt: at(0),
        lastActivityAt: at(30),
        eventCount: 4,
        summaryType: 'implementation',
        summary: { goal: 'explicit work', unresolved: ['x'] },
        inferred: false,
      },
      {
        id: 'ses_inferred',
        startedAt: at(0),
        lastActivityAt: at(30),
        eventCount: 8,
        summaryType: 'implementation',
        summary: { goal: 'OTHER task stuff', unresolved: ['other todo'] },
        inferred: true,
      },
    ])
    turnEvents.mockResolvedValue([
      // Turn on this task: 2 minutes.
      {
        sessionId: 'ses_inferred',
        taskId: 'tsk_1',
        type: 'USER_PROMPT_SUBMIT',
        createdAt: at(0),
      },
      {
        sessionId: 'ses_inferred',
        taskId: 'tsk_1',
        type: 'STOP',
        createdAt: at(2),
      },
      // Turn on another task: 3 minutes — not this task's time.
      {
        sessionId: 'ses_inferred',
        taskId: 'tsk_other',
        type: 'USER_PROMPT_SUBMIT',
        createdAt: at(10),
      },
      {
        sessionId: 'ses_inferred',
        taskId: 'tsk_other',
        type: 'STOP',
        createdAt: at(13),
      },
      {
        sessionId: 'ses_explicit',
        taskId: 'tsk_1',
        type: 'USER_PROMPT_SUBMIT',
        createdAt: at(20),
      },
      {
        sessionId: 'ses_explicit',
        taskId: 'tsk_1',
        type: 'STOP',
        createdAt: at(21),
      },
    ])
    const ctx = await taskContextService.getContextForIdentifier(
      'ws',
      'mem',
      'LUM-1'
    )
    const byId = new Map(ctx!.sessions.map(s => [s.id, s]))
    const inferred = byId.get('ses_inferred')!
    expect(inferred.headline).not.toContain('OTHER task stuff')
    expect(inferred.unresolved).toEqual([])
    expect(inferred.durationMs).toBe(2 * 60_000)
    expect(byId.get('ses_explicit')!.headline).toContain('explicit work')
    expect(byId.get('ses_explicit')!.durationMs).toBe(60_000)
    expect(
      ctx!.fragments.filter(f => f.type === 'SESSION').map(f => f.id)
    ).toEqual(['ses_explicit'])
  })
})
