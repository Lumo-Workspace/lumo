/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    slackIntegration: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    slackChannel: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    project: {
      findFirst: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { slackRepository } from '@/lib/repositories/slack.repository'

beforeEach(() => jest.clearAllMocks())

// ── findIntegrationStatus ───────────────────────────────────────────────

describe('slackRepository.findIntegrationStatus', () => {
  it('selects team info fields', async () => {
    const mock = prisma.slackIntegration.findUnique as jest.Mock
    mock.mockResolvedValue({
      slackTeamName: 'Team',
      slackUserId: 'U123',
      slackTeamId: 'T123',
    })

    const result = await slackRepository.findIntegrationStatus('ws-1')

    expect(mock).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1' },
      select: { slackTeamName: true, slackUserId: true, slackTeamId: true },
    })
    expect(result?.slackTeamName).toBe('Team')
  })
})

// ── findIntegrationWithToken ────────────────────────────────────────────

describe('slackRepository.findIntegrationWithToken', () => {
  it('selects id and accessToken', async () => {
    const mock = prisma.slackIntegration.findUnique as jest.Mock
    mock.mockResolvedValue({ id: 'si-1', accessToken: 'enc' })

    const result = await slackRepository.findIntegrationWithToken('ws-1')

    expect(mock).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1' },
      select: { id: true, accessToken: true },
    })
    expect(result?.id).toBe('si-1')
  })
})

// ── findIntegrationId ───────────────────────────────────────────────────

describe('slackRepository.findIntegrationId', () => {
  it('returns id row when integration exists', async () => {
    const mock = prisma.slackIntegration.findUnique as jest.Mock
    mock.mockResolvedValue({ id: 'si-1' })

    const result = await slackRepository.findIntegrationId('ws-1')

    expect(mock).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1' },
      select: { id: true },
    })
    expect(result).toEqual({ id: 'si-1' })
  })

  it('returns null when no integration exists', async () => {
    const mock = prisma.slackIntegration.findUnique as jest.Mock
    mock.mockResolvedValue(null)

    const result = await slackRepository.findIntegrationId('ws-1')

    expect(result).toBeNull()
  })
})

// ── upsertIntegration ───────────────────────────────────────────────────

describe('slackRepository.upsertIntegration', () => {
  it('upserts with correct shape', async () => {
    const mock = prisma.slackIntegration.upsert as jest.Mock
    mock.mockResolvedValue({ id: 'si-1' })

    await slackRepository.upsertIntegration({
      workspaceId: 'ws-1',
      installedBy: 'mem-1',
      accessToken: 'enc-token',
      slackTeamId: 'T123',
      slackTeamName: 'Team',
      slackUserId: 'U123',
    })

    expect(mock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'ws-1' },
        create: expect.objectContaining({
          workspaceId: 'ws-1',
          installedBy: 'mem-1',
          slackTeamId: 'T123',
        }),
        update: expect.objectContaining({
          installedBy: 'mem-1',
          slackTeamId: 'T123',
        }),
      })
    )
  })
})

// ── deleteIntegration ───────────────────────────────────────────────────

describe('slackRepository.deleteIntegration', () => {
  it('deletes by workspaceId', async () => {
    const mock = prisma.slackIntegration.delete as jest.Mock
    mock.mockResolvedValue({ id: 'si-1' })

    await slackRepository.deleteIntegration('ws-1')

    expect(mock).toHaveBeenCalledWith({ where: { workspaceId: 'ws-1' } })
  })
})

// ── findChannelByProject ────────────────────────────────────────────────

describe('slackRepository.findChannelByProject', () => {
  it('queries by integration + project with select', async () => {
    const mock = prisma.slackChannel.findFirst as jest.Mock
    mock.mockResolvedValue({
      id: 'ch-1',
      channelId: 'C123',
      channelName: '#general',
      events: ['task_created'],
    })

    const result = await slackRepository.findChannelByProject('si-1', 'proj-1')

    expect(mock).toHaveBeenCalledWith({
      where: { integrationId: 'si-1', projectId: 'proj-1' },
      select: { id: true, channelId: true, channelName: true, events: true },
    })
    expect(result?.channelId).toBe('C123')
  })
})

// ── findChannelWithIntegration ──────────────────────────────────────────

describe('slackRepository.findChannelWithIntegration', () => {
  it('includes integration workspace info', async () => {
    const mock = prisma.slackChannel.findUnique as jest.Mock
    mock.mockResolvedValue({
      id: 'ch-1',
      integration: { workspaceId: 'ws-1' },
    })

    await slackRepository.findChannelWithIntegration('ch-1')

    expect(mock).toHaveBeenCalledWith({
      where: { id: 'ch-1' },
      include: { integration: { select: { workspaceId: true } } },
    })
  })
})

// ── channelExistsForProject ─────────────────────────────────────────────

describe('slackRepository.channelExistsForProject', () => {
  it('returns true when channel exists', async () => {
    const mock = prisma.slackChannel.findFirst as jest.Mock
    mock.mockResolvedValue({ id: 'ch-1' })

    const result = await slackRepository.channelExistsForProject(
      'si-1',
      'proj-1'
    )

    expect(result).toBe(true)
  })

  it('returns false when no channel exists', async () => {
    const mock = prisma.slackChannel.findFirst as jest.Mock
    mock.mockResolvedValue(null)

    const result = await slackRepository.channelExistsForProject(
      'si-1',
      'proj-1'
    )

    expect(result).toBe(false)
  })
})

// ── createChannel ───────────────────────────────────────────────────────

describe('slackRepository.createChannel', () => {
  it('creates channel with correct data and select', async () => {
    const mock = prisma.slackChannel.create as jest.Mock
    mock.mockResolvedValue({
      id: 'ch-1',
      channelId: 'C123',
      channelName: '#dev',
      events: ['task_created'],
      projectId: 'proj-1',
    })

    await slackRepository.createChannel({
      integrationId: 'si-1',
      channelId: 'C123',
      channelName: '#dev',
      events: ['task_created'] as never[],
      projectId: 'proj-1',
    })

    expect(mock).toHaveBeenCalledWith({
      data: {
        integrationId: 'si-1',
        channelId: 'C123',
        channelName: '#dev',
        events: ['task_created'],
        projectId: 'proj-1',
      },
      select: {
        id: true,
        channelId: true,
        channelName: true,
        events: true,
        projectId: true,
      },
    })
  })
})

// ── updateChannel ───────────────────────────────────────────────────────

describe('slackRepository.updateChannel', () => {
  it('updates channel and returns select', async () => {
    const mock = prisma.slackChannel.update as jest.Mock
    mock.mockResolvedValue({ id: 'ch-1', events: ['task_done'] })

    await slackRepository.updateChannel('ch-1', {
      events: ['task_done'] as never[],
    })

    expect(mock).toHaveBeenCalledWith({
      where: { id: 'ch-1' },
      data: { events: ['task_done'] },
      select: {
        id: true,
        channelId: true,
        channelName: true,
        events: true,
        projectId: true,
      },
    })
  })
})

// ── deleteChannel ───────────────────────────────────────────────────────

describe('slackRepository.deleteChannel', () => {
  it('deletes by id', async () => {
    const mock = prisma.slackChannel.delete as jest.Mock
    mock.mockResolvedValue({ id: 'ch-1' })

    await slackRepository.deleteChannel('ch-1')

    expect(mock).toHaveBeenCalledWith({ where: { id: 'ch-1' } })
  })
})

// ── findProjectInWorkspace ──────────────────────────────────────────────

describe('slackRepository.findProjectInWorkspace', () => {
  it('queries by project id and workspace', async () => {
    const mock = prisma.project.findFirst as jest.Mock
    mock.mockResolvedValue({ id: 'proj-1' })

    await slackRepository.findProjectInWorkspace('proj-1', 'ws-1')

    expect(mock).toHaveBeenCalledWith({
      where: { id: 'proj-1', workspaceId: 'ws-1' },
    })
  })
})
