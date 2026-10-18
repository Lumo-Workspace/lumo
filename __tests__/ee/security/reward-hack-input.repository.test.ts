/**
 * @jest-environment node
 *
 * LUM-1234 — the reward-hack judge's read-only queries: the task's sessions
 * (explicit, inferred, subagent children) and their events, the previous
 * merge of the same task, and the task-requirement text. Every query is
 * scoped to the workspace.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    session: { findMany: jest.fn() },
    hookEvent: { findMany: jest.fn() },
    pullRequest: { findFirst: jest.fn() },
    task: { findFirst: jest.fn() },
    taskSlackContext: { findMany: jest.fn() },
    taskWebLink: { findMany: jest.fn() },
    taskFigmaLink: { findMany: jest.fn() },
    documentMention: { findMany: jest.fn() },
    comment: { findMany: jest.fn() },
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    listForTask: jest.fn(),
    listChildrenForTask: jest.fn(),
  },
}))

import { prisma } from '@/lib/db/prisma'
import { sessionRepository } from '@/lib/repositories/session.repository'
import {
  RH_TASK_SESSION_LIMIT,
  rewardHackInputRepository,
} from '@/ee/security/repositories/reward-hack-input.repository'

const m = (fn: unknown) => fn as jest.Mock
const p = prisma as unknown as Record<string, Record<string, jest.Mock>>

beforeEach(() => jest.clearAllMocks())

describe('loadTaskSessions', () => {
  it('collects explicit, inferred and child sessions in the workspace with their events', async () => {
    m(sessionRepository.listForTask).mockResolvedValue([
      { id: 'top', inferred: false },
      { id: 'inf', inferred: true },
      { id: 'foreign', inferred: false },
    ])
    m(sessionRepository.listChildrenForTask).mockResolvedValue([
      { id: 'top:agent1', parentSessionId: 'top' },
    ])
    p.session!.findMany!.mockResolvedValue([
      { id: 'top' },
      { id: 'inf' },
      { id: 'top:agent1' },
    ])
    const at = new Date('2026-10-06T00:00:00Z')
    p.hookEvent!.findMany!.mockResolvedValue([
      {
        id: 'e1',
        sessionId: 'top',
        type: 'USER_PROMPT_SUBMIT',
        toolName: null,
        payload: {},
        createdAt: at,
      },
      {
        id: 'e2',
        sessionId: 'top:agent1',
        type: 'POST_TOOL_USE',
        toolName: 'Edit',
        payload: {},
        createdAt: at,
      },
    ])

    const out = await rewardHackInputRepository.loadTaskSessions('ws1', 't1')

    expect(sessionRepository.listForTask).toHaveBeenCalledWith(
      't1',
      RH_TASK_SESSION_LIMIT
    )
    expect(sessionRepository.listChildrenForTask).toHaveBeenCalledWith('t1')
    expect(p.session!.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['top', 'inf', 'foreign', 'top:agent1'] },
        workspaceId: 'ws1',
      },
      select: { id: true },
    })
    const evArgs = p.hookEvent!.findMany!.mock.calls[0]![0]
    expect(evArgs.where.workspaceId).toBe('ws1')
    expect(evArgs.where.sessionId).toEqual({ in: ['top', 'inf', 'top:agent1'] })
    expect(evArgs.where.type.in).toEqual(
      expect.arrayContaining(['USER_PROMPT_SUBMIT', 'POST_TOOL_USE', 'STOP'])
    )
    expect(out).toEqual([
      {
        id: 'top',
        events: [expect.objectContaining({ id: 'e1', sessionId: 'top' })],
      },
      { id: 'inf', events: [] },
      { id: 'top:agent1', events: [expect.objectContaining({ id: 'e2' })] },
    ])
  })

  it('returns [] without querying events when the task has no sessions', async () => {
    m(sessionRepository.listForTask).mockResolvedValue([])
    m(sessionRepository.listChildrenForTask).mockResolvedValue([])
    await expect(
      rewardHackInputRepository.loadTaskSessions('ws1', 't1')
    ).resolves.toEqual([])
    expect(p.hookEvent!.findMany).not.toHaveBeenCalled()
  })
})

describe('previousMergedAt', () => {
  it('latest merge of another PR of the same task, in the workspace', async () => {
    const d = new Date('2026-10-04T00:00:00Z')
    p.pullRequest!.findFirst!.mockResolvedValue({ mergedAt: d })
    await expect(
      rewardHackInputRepository.previousMergedAt('ws1', 't1', 'pr2')
    ).resolves.toBe(d)
    expect(p.pullRequest!.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: 'ws1',
        taskId: 't1',
        id: { not: 'pr2' },
        mergedAt: { not: null },
      },
      orderBy: { mergedAt: 'desc' },
      select: { mergedAt: true },
    })
  })

  it('null when there is none', async () => {
    p.pullRequest!.findFirst!.mockResolvedValue(null)
    await expect(
      rewardHackInputRepository.previousMergedAt('ws1', 't1', 'pr2')
    ).resolves.toBeNull()
  })
})

describe('loadRequirement', () => {
  it('joins title, description, linked context, workspace docs and user comments', async () => {
    p.task!.findFirst!.mockResolvedValue({
      title: 'Parser accepts empty input',
      description: '<p>Return [] for <strong>empty</strong> input.</p>',
    })
    p.taskSlackContext!.findMany!.mockResolvedValue([
      { slackChannelName: 'eng', summary: 'Agreed: empty means [].' },
    ])
    p.taskWebLink!.findMany!.mockResolvedValue([
      {
        url: 'https://example.test/spec',
        title: 'Spec',
        description: 'Parser spec',
        note: 'see 3.2',
      },
    ])
    p.taskFigmaLink!.findMany!.mockResolvedValue([
      { fileName: 'Parser UI', frameName: 'Empty state' },
    ])
    p.documentMention!.findMany!.mockResolvedValue([
      { document: { title: 'Parser RFC', summary: 'Grammar and edge cases.' } },
    ])
    p.comment!.findMany!.mockResolvedValue([
      { body: '<p>Do not skip the fuzz test.</p>' },
    ])

    const text = await rewardHackInputRepository.loadRequirement('ws1', 't1')

    expect(p.task!.findFirst).toHaveBeenCalledWith({
      where: { id: 't1', workspaceId: 'ws1', deletedAt: null },
      select: { title: true, description: true },
    })
    for (const mock of ['taskSlackContext', 'taskWebLink', 'taskFigmaLink'])
      expect(p[mock]!.findMany!.mock.calls[0]![0].where).toEqual({
        taskId: 't1',
        workspaceId: 'ws1',
      })
    const docWhere = p.documentMention!.findMany!.mock.calls[0]![0].where
    expect(docWhere.document).toEqual({
      workspaceId: 'ws1',
      deletedAt: null,
      visibility: 'WORKSPACE',
    })
    const commentWhere = p.comment!.findMany!.mock.calls[0]![0].where
    expect(commentWhere).toEqual({
      taskId: 't1',
      deletedAt: null,
      type: 'USER',
      task: { workspaceId: 'ws1' },
    })

    expect(text).toContain('Parser accepts empty input')
    expect(text).toContain('**empty**')
    expect(text).not.toContain('<strong>')
    expect(text).toContain('Agreed: empty means [].')
    expect(text).toContain('Spec')
    expect(text).toContain('see 3.2')
    expect(text).toContain('Parser UI')
    expect(text).toContain('Grammar and edge cases.')
    expect(text).toContain('Do not skip the fuzz test.')
  })

  it('empty string when the task is not in the workspace', async () => {
    p.task!.findFirst!.mockResolvedValue(null)
    await expect(
      rewardHackInputRepository.loadRequirement('ws1', 't1')
    ).resolves.toBe('')
    expect(p.comment!.findMany).not.toHaveBeenCalled()
  })
})
