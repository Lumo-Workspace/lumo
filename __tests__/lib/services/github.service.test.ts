/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findIntegrationStatus: jest.fn(),
    findIntegration: jest.fn(),
    findIntegrationWithWebhooks: jest.fn(),
    upsertIntegration: jest.fn(),
    updateIntegration: jest.fn(),
    updateIntegrationRepositories: jest.fn(),
    deleteIntegration: jest.fn(),
    upsertWebhook: jest.fn(),
    deleteWebhook: jest.fn(),
    findWebhooksByRepo: jest.fn(),
    upsertPullRequest: jest.fn(),
    updatePullRequestCiStatus: jest.fn(),
    upsertTaskBranch: jest.fn(),
    findTaskByIdentifier: jest.fn(),
    findWorkspaceSlug: jest.fn(),
  },
}))

import { githubRepository } from '@/lib/repositories/github.repository'
import { githubService } from '@/lib/services/github.service'

const mockRepo = githubRepository as jest.Mocked<typeof githubRepository>

beforeEach(() => jest.clearAllMocks())

// ── getIntegrationStatus ────────────────────────────────────────────────

describe('getIntegrationStatus', () => {
  it('returns connected: false when no integration', async () => {
    mockRepo.findIntegrationStatus.mockResolvedValue(null)

    const result = await githubService.getIntegrationStatus('ws-1', 'mem-1')

    expect(result).toEqual({ connected: false })
  })

  it('returns connection details when found', async () => {
    mockRepo.findIntegrationStatus.mockResolvedValue({
      githubLogin: 'user',
      githubUserId: '123',
      repositories: ['org/repo'],
    })

    const result = await githubService.getIntegrationStatus('ws-1', 'mem-1')

    expect(result).toEqual({
      connected: true,
      githubLogin: 'user',
      githubUserId: '123',
      repositories: ['org/repo'],
    })
  })
})

// ── requireIntegration ──────────────────────────────────────────────────

describe('requireIntegration', () => {
  it('returns integration when found', async () => {
    const integration = { id: 'int-1', accessToken: 'enc' }
    mockRepo.findIntegration.mockResolvedValue(integration as never)

    const result = await githubService.requireIntegration('ws-1', 'mem-1')

    expect(result).toEqual(integration)
  })

  it('throws 404 when not found', async () => {
    mockRepo.findIntegration.mockResolvedValue(null)

    await expect(
      githubService.requireIntegration('ws-1', 'mem-1')
    ).rejects.toMatchObject({ message: 'GitHub not connected', status: 404 })
  })
})

// ── requireIntegrationWithWebhooks ──────────────────────────────────────

describe('requireIntegrationWithWebhooks', () => {
  it('throws 404 when not found', async () => {
    mockRepo.findIntegrationWithWebhooks.mockResolvedValue(null)

    await expect(
      githubService.requireIntegrationWithWebhooks('ws-1', 'mem-1')
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('findWorkspaceSlug', () => {
  it('returns slug when found', async () => {
    mockRepo.findWorkspaceSlug.mockResolvedValue({ slug: 'my-ws' })

    const result = await githubService.findWorkspaceSlug('ws-1')

    expect(result).toBe('my-ws')
  })

  it('returns empty string when workspace not found', async () => {
    mockRepo.findWorkspaceSlug.mockResolvedValue(null)

    const result = await githubService.findWorkspaceSlug('ws-missing')

    expect(result).toBe('')
  })
})

// ── passthrough operations ──────────────────────────────────────────────

describe('passthrough operations', () => {
  it('delegates upsertWebhook to repository', async () => {
    mockRepo.upsertWebhook.mockResolvedValue({ id: 'wh-1' } as never)

    await githubService.upsertWebhook('int-1', 'org/repo', 42)

    expect(mockRepo.upsertWebhook).toHaveBeenCalledWith('int-1', 'org/repo', 42)
  })

  it('delegates deleteWebhook to repository', async () => {
    mockRepo.deleteWebhook.mockResolvedValue({ id: 'wh-1' } as never)

    await githubService.deleteWebhook('int-1', 'org/repo')

    expect(mockRepo.deleteWebhook).toHaveBeenCalledWith('int-1', 'org/repo')
  })

  it('delegates updatePullRequestCiStatus to repository', async () => {
    mockRepo.updatePullRequestCiStatus.mockResolvedValue({ count: 1 } as never)

    await githubService.updatePullRequestCiStatus('org/repo', [1, 2], 'success')

    expect(mockRepo.updatePullRequestCiStatus).toHaveBeenCalledWith(
      'org/repo',
      [1, 2],
      'success'
    )
  })
})
