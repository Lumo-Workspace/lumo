/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/slack.repository', () => ({
  slackRepository: {
    findIntegrationStatus: jest.fn(),
    findIntegrationWithToken: jest.fn(),
    findIntegrationId: jest.fn(),
    upsertIntegration: jest.fn(),
    deleteIntegration: jest.fn(),
    findChannelByProject: jest.fn(),
    findChannelWithIntegration: jest.fn(),
    channelExistsForProject: jest.fn(),
    createChannel: jest.fn(),
    updateChannel: jest.fn(),
    deleteChannel: jest.fn(),
    findProjectInWorkspace: jest.fn(),
  },
}))

import { slackRepository } from '@/lib/repositories/slack.repository'
import { slackService } from '@/lib/services/slack.service'

const mockRepo = slackRepository as jest.Mocked<typeof slackRepository>

beforeEach(() => jest.clearAllMocks())

// ── getIntegrationStatus ────────────────────────────────────────────────

describe('getIntegrationStatus', () => {
  it('returns connected: false when no integration', async () => {
    mockRepo.findIntegrationStatus.mockResolvedValue(null)

    const result = await slackService.getIntegrationStatus('ws-1')

    expect(result).toEqual({ connected: false })
  })

  it('returns connection details when found', async () => {
    mockRepo.findIntegrationStatus.mockResolvedValue({
      slackTeamName: 'Team',
      slackUserId: 'U123',
      slackTeamId: 'T123',
    })

    const result = await slackService.getIntegrationStatus('ws-1')

    expect(result).toEqual({
      connected: true,
      slackTeamName: 'Team',
      slackUserId: 'U123',
      slackTeamId: 'T123',
    })
  })
})

// ── requireIntegrationWithToken ─────────────────────────────────────────

describe('requireIntegrationWithToken', () => {
  it('returns integration when found', async () => {
    mockRepo.findIntegrationWithToken.mockResolvedValue({
      id: 'si-1',
      accessToken: 'enc',
    })

    const result = await slackService.requireIntegrationWithToken('ws-1')

    expect(result).toEqual({ id: 'si-1', accessToken: 'enc' })
  })

  it('throws 404 when not found', async () => {
    mockRepo.findIntegrationWithToken.mockResolvedValue(null)

    await expect(
      slackService.requireIntegrationWithToken('ws-1')
    ).rejects.toMatchObject({ message: 'Slack not connected', status: 404 })
  })
})

// ── deleteIntegration ───────────────────────────────────────────────────

describe('deleteIntegration', () => {
  it('throws 403 for non-owner', async () => {
    await expect(
      slackService.deleteIntegration('ws-1', 'MEMBER')
    ).rejects.toMatchObject({
      message: 'Only workspace owners can disconnect Slack',
      status: 403,
    })
  })

  it('throws 404 when not connected', async () => {
    mockRepo.findIntegrationWithToken.mockResolvedValue(null)

    await expect(
      slackService.deleteIntegration('ws-1', 'OWNER')
    ).rejects.toMatchObject({ message: 'Not connected', status: 404 })
  })

  it('returns token and delete function for owners', async () => {
    mockRepo.findIntegrationWithToken.mockResolvedValue({
      id: 'si-1',
      accessToken: 'enc-token',
    })
    mockRepo.deleteIntegration.mockResolvedValue({} as never)

    const result = await slackService.deleteIntegration('ws-1', 'OWNER')

    expect(result.integrationToken).toBe('enc-token')
    expect(typeof result.performDelete).toBe('function')

    await result.performDelete()
    expect(mockRepo.deleteIntegration).toHaveBeenCalledWith('ws-1')
  })
})

// ── getChannelForProject ────────────────────────────────────────────────

describe('getChannelForProject', () => {
  it('throws 404 when no integration', async () => {
    mockRepo.findIntegrationId.mockResolvedValue(null)

    await expect(
      slackService.getChannelForProject('ws-1', 'proj-1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('returns channel when found', async () => {
    mockRepo.findIntegrationId.mockResolvedValue({ id: 'si-1' })
    mockRepo.findChannelByProject.mockResolvedValue({
      id: 'ch-1',
      channelId: 'C123',
      channelName: '#general',
      events: ['task_created'],
    } as never)

    const result = await slackService.getChannelForProject('ws-1', 'proj-1')

    expect(result?.channelId).toBe('C123')
    expect(mockRepo.findChannelByProject).toHaveBeenCalledWith('si-1', 'proj-1')
  })
})

// ── createChannel ───────────────────────────────────────────────────────

describe('createChannel', () => {
  const channelData = {
    channelId: 'C123',
    channelName: '#dev',
    projectId: 'proj-1',
    events: ['task_created'] as never[],
  }

  it('throws 404 when no integration', async () => {
    mockRepo.findIntegrationId.mockResolvedValue(null)

    await expect(
      slackService.createChannel('ws-1', channelData)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 403 when project not in workspace', async () => {
    mockRepo.findIntegrationId.mockResolvedValue({ id: 'si-1' })
    mockRepo.findProjectInWorkspace.mockResolvedValue(null)

    await expect(
      slackService.createChannel('ws-1', channelData)
    ).rejects.toMatchObject({ message: 'Project not found', status: 403 })
  })

  it('throws 409 when channel already configured', async () => {
    mockRepo.findIntegrationId.mockResolvedValue({ id: 'si-1' })
    mockRepo.findProjectInWorkspace.mockResolvedValue({ id: 'proj-1' } as never)
    mockRepo.channelExistsForProject.mockResolvedValue(true)

    await expect(
      slackService.createChannel('ws-1', channelData)
    ).rejects.toMatchObject({
      message: 'Channel already configured for this project',
      status: 409,
    })
  })

  it('creates channel when valid', async () => {
    mockRepo.findIntegrationId.mockResolvedValue({ id: 'si-1' })
    mockRepo.findProjectInWorkspace.mockResolvedValue({ id: 'proj-1' } as never)
    mockRepo.channelExistsForProject.mockResolvedValue(false)
    mockRepo.createChannel.mockResolvedValue({
      id: 'ch-1',
      channelId: 'C123',
      channelName: '#dev',
      events: ['task_created'],
      projectId: 'proj-1',
    } as never)

    const result = await slackService.createChannel('ws-1', channelData)

    expect(result).toMatchObject({ channelId: 'C123' })
    expect(mockRepo.createChannel).toHaveBeenCalledWith({
      integrationId: 'si-1',
      channelId: 'C123',
      channelName: '#dev',
      events: ['task_created'],
      projectId: 'proj-1',
    })
  })
})

// ── updateChannel ───────────────────────────────────────────────────────

describe('updateChannel', () => {
  it('throws 404 when channel not found', async () => {
    mockRepo.findChannelWithIntegration.mockResolvedValue(null)

    await expect(
      slackService.updateChannel('ch-1', 'ws-1', { events: [] as never[] })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 404 when workspace mismatch', async () => {
    mockRepo.findChannelWithIntegration.mockResolvedValue({
      id: 'ch-1',
      integration: { workspaceId: 'ws-other' },
    } as never)

    await expect(
      slackService.updateChannel('ch-1', 'ws-1', { events: [] as never[] })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('updates channel when authorized', async () => {
    mockRepo.findChannelWithIntegration.mockResolvedValue({
      id: 'ch-1',
      integration: { workspaceId: 'ws-1' },
    } as never)
    mockRepo.updateChannel.mockResolvedValue({ id: 'ch-1' } as never)

    await slackService.updateChannel('ch-1', 'ws-1', {
      events: ['task_done'] as never[],
    })

    expect(mockRepo.updateChannel).toHaveBeenCalledWith('ch-1', {
      events: ['task_done'],
    })
  })
})

// ── deleteChannel ───────────────────────────────────────────────────────

describe('deleteChannel', () => {
  it('throws 404 when channel not found', async () => {
    mockRepo.findChannelWithIntegration.mockResolvedValue(null)

    await expect(
      slackService.deleteChannel('ch-1', 'ws-1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('deletes channel when authorized', async () => {
    mockRepo.findChannelWithIntegration.mockResolvedValue({
      id: 'ch-1',
      integration: { workspaceId: 'ws-1' },
    } as never)
    mockRepo.deleteChannel.mockResolvedValue({} as never)

    await slackService.deleteChannel('ch-1', 'ws-1')

    expect(mockRepo.deleteChannel).toHaveBeenCalledWith('ch-1')
  })
})
