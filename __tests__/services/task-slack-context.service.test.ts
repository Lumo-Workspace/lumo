/** @jest-environment node */
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: {
    create: jest.fn(),
    listByTask: jest.fn(),
    getById: jest.fn(),
    updateSnapshot: jest.fn(),
    delete: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/slack/token', () => ({
  getSlackIntegrationToken: jest.fn(),
}))
jest.mock('@/lib/integrations/slack/context-fetcher', () => ({
  fetchSingleMessage: jest.fn(),
  fetchThread: jest.fn(),
  resolveUsers: jest.fn(),
  resolveChannelName: jest.fn(),
  toSnapshot: jest.fn((raw, users) => ({
    messages: raw.map((m: { ts: string; user: string; text: string }) => ({
      ts: m.ts,
      userId: m.user,
      userName: users.get(m.user)?.name ?? null,
      userAvatarUrl: null,
      text: m.text,
      edited: false,
    })),
  })),
  SlackApiError: class SlackApiError extends Error {
    constructor(
      public code: string,
      msg?: string
    ) {
      super(msg ?? code)
    }
  },
}))

import { taskSlackContextRepository } from '@/lib/repositories/task-slack-context.repository'
import { getSlackIntegrationToken } from '@/lib/integrations/slack/token'
import {
  fetchSingleMessage,
  fetchThread,
  resolveUsers,
  resolveChannelName,
  SlackApiError,
} from '@/lib/integrations/slack/context-fetcher'
import { taskSlackContextService } from '@/lib/services/task-slack-context.service'

const repoCreate = taskSlackContextRepository.create as jest.Mock
const repoListByTask = taskSlackContextRepository.listByTask as jest.Mock
const tokenMock = getSlackIntegrationToken as jest.Mock
const fetchSingle = fetchSingleMessage as jest.Mock
const fetchThr = fetchThread as jest.Mock
const resolveU = resolveUsers as jest.Mock
const resolveC = resolveChannelName as jest.Mock

beforeEach(() => jest.clearAllMocks())

const SINGLE_URL = 'https://lumo.slack.com/archives/C9/p1700000000000100'
const THREAD_URL =
  'https://lumo.slack.com/archives/C9/p1700000000000200?thread_ts=1700000000.000100&cid=C9'

describe('linkSlackPermalink — single message', () => {
  it('fetches the single message and persists', async () => {
    tokenMock.mockResolvedValue({
      token: 'tok',
      slackTeamId: 'T1',
      slackTeamName: 'lumo',
    })
    fetchSingle.mockResolvedValue({
      ts: '1700000000.000100',
      user: 'U1',
      text: 'hi',
    })
    resolveU.mockResolvedValue(
      new Map([['U1', { name: 'alice', avatarUrl: null }]])
    )
    resolveC.mockResolvedValue('design')
    repoCreate.mockResolvedValue({ id: 'ctx_1' })

    const out = await taskSlackContextService.linkSlackPermalink({
      taskId: 'tsk_1',
      workspaceId: 'ws_1',
      permalink: SINGLE_URL,
      actorMemberId: 'mem_1',
    })

    expect(fetchSingle).toHaveBeenCalledWith('tok', 'C9', '1700000000.000100')
    expect(fetchThr).not.toHaveBeenCalled()
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'tsk_1',
        workspaceId: 'ws_1',
        slackTeamId: 'T1',
        slackChannelId: 'C9',
        slackChannelName: 'design',
        rootTs: '1700000000.000100',
        threadTs: null,
        isThread: false,
        createdById: 'mem_1',
      })
    )
    expect(out).toEqual({ id: 'ctx_1' })
  })
})

describe('linkSlackPermalink — thread', () => {
  it('fetches the full thread when permalink is a reply', async () => {
    tokenMock.mockResolvedValue({
      token: 'tok',
      slackTeamId: 'T1',
      slackTeamName: 'lumo',
    })
    fetchThr.mockResolvedValue([
      { ts: '1700000000.000100', user: 'U1', text: 'parent' },
      { ts: '1700000000.000200', user: 'U2', text: 'reply' },
    ])
    resolveU.mockResolvedValue(
      new Map([
        ['U1', { name: 'alice', avatarUrl: null }],
        ['U2', { name: 'bob', avatarUrl: null }],
      ])
    )
    resolveC.mockResolvedValue('design')
    repoCreate.mockResolvedValue({ id: 'ctx_2' })

    await taskSlackContextService.linkSlackPermalink({
      taskId: 'tsk_1',
      workspaceId: 'ws_1',
      permalink: THREAD_URL,
      actorMemberId: 'mem_1',
    })

    expect(fetchThr).toHaveBeenCalledWith('tok', 'C9', '1700000000.000100')
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        rootTs: '1700000000.000100',
        threadTs: '1700000000.000100',
        isThread: true,
      })
    )
  })
})

describe('linkSlackPermalink — error mapping', () => {
  it('throws 400 invalid_permalink on a malformed url', async () => {
    await expect(
      taskSlackContextService.linkSlackPermalink({
        taskId: 'tsk_1',
        workspaceId: 'ws_1',
        permalink: 'https://example.com/foo',
        actorMemberId: 'mem_1',
      })
    ).rejects.toMatchObject({ status: 400, message: 'invalid_permalink' })
  })

  it('throws 412 not_connected when no SlackIntegration', async () => {
    tokenMock.mockResolvedValue(null)
    await expect(
      taskSlackContextService.linkSlackPermalink({
        taskId: 'tsk_1',
        workspaceId: 'ws_1',
        permalink: SINGLE_URL,
        actorMemberId: 'mem_1',
      })
    ).rejects.toMatchObject({ status: 412, message: 'not_connected' })
  })

  it('maps SlackApiError("not_in_channel") to status 403', async () => {
    tokenMock.mockResolvedValue({
      token: 'tok',
      slackTeamId: 'T1',
      slackTeamName: 'lumo',
    })
    fetchSingle.mockRejectedValue(new SlackApiError('not_in_channel'))
    resolveC.mockResolvedValue(null)
    await expect(
      taskSlackContextService.linkSlackPermalink({
        taskId: 'tsk_1',
        workspaceId: 'ws_1',
        permalink: SINGLE_URL,
        actorMemberId: 'mem_1',
      })
    ).rejects.toMatchObject({ status: 403, message: 'not_in_channel' })
  })

  it('maps SlackApiError("channel_not_found") to status 404', async () => {
    tokenMock.mockResolvedValue({
      token: 'tok',
      slackTeamId: 'T1',
      slackTeamName: 'lumo',
    })
    fetchSingle.mockRejectedValue(new SlackApiError('channel_not_found'))
    resolveC.mockResolvedValue(null)
    await expect(
      taskSlackContextService.linkSlackPermalink({
        taskId: 'tsk_1',
        workspaceId: 'ws_1',
        permalink: SINGLE_URL,
        actorMemberId: 'mem_1',
      })
    ).rejects.toMatchObject({ status: 404, message: 'message_gone' })
  })

  it('maps SlackApiError("message_not_found") to status 404', async () => {
    tokenMock.mockResolvedValue({
      token: 'tok',
      slackTeamId: 'T1',
      slackTeamName: 'lumo',
    })
    fetchSingle.mockRejectedValue(new SlackApiError('message_not_found'))
    resolveC.mockResolvedValue(null)
    await expect(
      taskSlackContextService.linkSlackPermalink({
        taskId: 'tsk_1',
        workspaceId: 'ws_1',
        permalink: SINGLE_URL,
        actorMemberId: 'mem_1',
      })
    ).rejects.toMatchObject({ status: 404, message: 'message_gone' })
  })

  it('maps SlackApiError("missing_scope") to status 403', async () => {
    tokenMock.mockResolvedValue({
      token: 'tok',
      slackTeamId: 'T1',
      slackTeamName: 'lumo',
    })
    fetchSingle.mockRejectedValue(new SlackApiError('missing_scope'))
    resolveC.mockResolvedValue(null)
    await expect(
      taskSlackContextService.linkSlackPermalink({
        taskId: 'tsk_1',
        workspaceId: 'ws_1',
        permalink: SINGLE_URL,
        actorMemberId: 'mem_1',
      })
    ).rejects.toMatchObject({ status: 403, message: 'missing_scope' })
  })

  it('maps SlackApiError("slack_unavailable") to status 502', async () => {
    tokenMock.mockResolvedValue({
      token: 'tok',
      slackTeamId: 'T1',
      slackTeamName: 'lumo',
    })
    fetchSingle.mockRejectedValue(new SlackApiError('slack_unavailable'))
    resolveC.mockResolvedValue(null)
    await expect(
      taskSlackContextService.linkSlackPermalink({
        taskId: 'tsk_1',
        workspaceId: 'ws_1',
        permalink: SINGLE_URL,
        actorMemberId: 'mem_1',
      })
    ).rejects.toMatchObject({ status: 502, message: 'slack_unavailable' })
  })
})

describe('listForTask', () => {
  it('delegates to repository.listByTask', async () => {
    repoListByTask.mockResolvedValue([{ id: 'ctx_1' }])
    const out = await taskSlackContextService.listForTask('tsk_1')
    expect(repoListByTask).toHaveBeenCalledWith('tsk_1')
    expect(out).toEqual([{ id: 'ctx_1' }])
  })
})

// Additional mocks for refresh + unlink tests
const repoGetById = taskSlackContextRepository.getById as jest.Mock
const repoUpdateSnapshot =
  taskSlackContextRepository.updateSnapshot as jest.Mock
const repoDelete = taskSlackContextRepository.delete as jest.Mock

describe('refreshContext', () => {
  it('refetches and updates snapshot on success', async () => {
    repoGetById.mockResolvedValue({
      id: 'ctx_1',
      workspaceId: 'ws_1',
      slackChannelId: 'C9',
      threadTs: null,
      rootTs: '1700000000.000100',
      isThread: false,
    })
    tokenMock.mockResolvedValue({
      token: 'tok',
      slackTeamId: 'T1',
      slackTeamName: 'lumo',
    })
    fetchSingle.mockResolvedValue({
      ts: '1700000000.000100',
      user: 'U1',
      text: 'fresh',
    })
    resolveU.mockResolvedValue(
      new Map([['U1', { name: 'alice', avatarUrl: null }]])
    )

    await taskSlackContextService.refreshContext('ctx_1', 'ws_1')

    expect(repoUpdateSnapshot).toHaveBeenCalledWith(
      'ctx_1',
      expect.objectContaining({
        messages: [
          expect.objectContaining({ ts: '1700000000.000100', text: 'fresh' }),
        ],
      }),
      null,
      // LUM-783: the refreshed snapshot is re-scanned; clean text → null.
      null
    )
  })

  it('preserves old snapshot and writes refreshError on Slack failure', async () => {
    repoGetById.mockResolvedValue({
      id: 'ctx_1',
      workspaceId: 'ws_1',
      slackChannelId: 'C9',
      threadTs: null,
      rootTs: '1700000000.000100',
      isThread: false,
    })
    tokenMock.mockResolvedValue({
      token: 'tok',
      slackTeamId: 'T1',
      slackTeamName: 'lumo',
    })
    fetchSingle.mockRejectedValue(new SlackApiError('not_in_channel'))

    await expect(
      taskSlackContextService.refreshContext('ctx_1', 'ws_1')
    ).rejects.toMatchObject({
      status: 403,
    })
    expect(repoUpdateSnapshot).toHaveBeenCalledWith(
      'ctx_1',
      null,
      'not_in_channel'
    )
  })

  it('throws 404 when the context id does not exist', async () => {
    repoGetById.mockResolvedValue(null)
    await expect(
      taskSlackContextService.refreshContext('ctx_x', 'ws_1')
    ).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('refreshContext — cross-workspace guard', () => {
  it('throws 404 when the context belongs to a different workspace', async () => {
    repoGetById.mockResolvedValue({
      id: 'ctx_1',
      workspaceId: 'ws_OTHER',
      slackChannelId: 'C9',
      threadTs: null,
      rootTs: '1700000000.000100',
      isThread: false,
    })
    await expect(
      taskSlackContextService.refreshContext('ctx_1', 'ws_1')
    ).rejects.toMatchObject({ status: 404 })
    // The token must not have been fetched
    expect(tokenMock).not.toHaveBeenCalled()
    expect(repoUpdateSnapshot).not.toHaveBeenCalled()
  })
})

describe('unlinkContext', () => {
  it('throws 404 when not found', async () => {
    repoGetById.mockResolvedValue(null)
    await expect(
      taskSlackContextService.unlinkContext('ctx_x', 'ws_1')
    ).rejects.toMatchObject({
      status: 404,
    })
  })

  it('delegates to repo.delete on success', async () => {
    repoGetById.mockResolvedValue({ id: 'ctx_1', workspaceId: 'ws_1' })
    await taskSlackContextService.unlinkContext('ctx_1', 'ws_1')
    expect(repoDelete).toHaveBeenCalledWith('ctx_1')
  })
})

describe('unlinkContext — cross-workspace guard', () => {
  it('throws 404 when the context belongs to a different workspace', async () => {
    repoGetById.mockResolvedValue({ id: 'ctx_1', workspaceId: 'ws_OTHER' })
    await expect(
      taskSlackContextService.unlinkContext('ctx_1', 'ws_1')
    ).rejects.toMatchObject({ status: 404 })
    expect(repoDelete).not.toHaveBeenCalled()
  })
})
