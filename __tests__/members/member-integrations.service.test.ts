/**
 * @jest-environment node
 *
 * LUM-906 PR2 ruling (b) — removing a deactivated member's personal
 * integration credentials. Collaborators are stubbed; the database-level
 * scoping (other workspaces untouched) is proved in
 * member-lifecycle.real-postgres.test.ts.
 */
const mockFindGithub = jest.fn()
const mockFindFigma = jest.fn()
const mockFindDrive = jest.fn()
const mockDeleteGithub = jest.fn()
const mockDisconnectFigma = jest.fn()
const mockDisconnectDrive = jest.fn()
const mockDeleteRepoWebhook = jest.fn()

jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findIntegrationWithWebhooks: (...a: unknown[]) => mockFindGithub(...a),
  },
}))
jest.mock('@/lib/repositories/figma-integration.repository', () => ({
  figmaIntegrationRepository: {
    findByMember: (...a: unknown[]) => mockFindFigma(...a),
  },
}))
jest.mock('@/lib/repositories/google-drive-integration.repository', () => ({
  googleDriveIntegrationRepository: {
    findByMember: (...a: unknown[]) => mockFindDrive(...a),
  },
}))
jest.mock('@/lib/services/github.service', () => ({
  githubService: {
    deleteIntegration: (...a: unknown[]) => mockDeleteGithub(...a),
  },
}))
jest.mock('@/lib/services/figma-integration.service', () => ({
  disconnectIntegration: (...a: unknown[]) => mockDisconnectFigma(...a),
}))
jest.mock('@/lib/services/google-drive-integration.service', () => ({
  disconnectIntegration: (...a: unknown[]) => mockDisconnectDrive(...a),
}))
jest.mock('@/lib/integrations/github/webhooks', () => ({
  deleteRepoWebhook: (...a: unknown[]) => mockDeleteRepoWebhook(...a),
}))
jest.mock('@/lib/crypto', () => ({
  decrypt: (stored: string) => `plain:${stored}`,
}))

import { removeMemberIntegrations } from '@/lib/services/member-integrations.service'

const WEBHOOK_CTX = {
  actor: { type: 'SYSTEM' as const },
  source: 'WEBHOOK' as const,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindGithub.mockResolvedValue(null)
  mockFindFigma.mockResolvedValue(null)
  mockFindDrive.mockResolvedValue(null)
})

describe('LUM-906 member integration cleanup', () => {
  it('member integrations: removes GitHub OAuth, Figma and Drive of this member in this workspace with the given actor', async () => {
    mockFindGithub.mockResolvedValue({
      id: 'gh-1',
      accessToken: 'enc-token',
      webhooks: [
        { repo: 'acme/api', githubHookId: 11 },
        { repo: 'acme/web', githubHookId: 12 },
      ],
    })
    mockFindFigma.mockResolvedValue({ id: 'fg-1' })
    mockFindDrive.mockResolvedValue({ id: 'gd-1' })
    mockDeleteRepoWebhook.mockRejectedValueOnce(new Error('gone on GitHub'))

    const removed = await removeMemberIntegrations('ws-1', 'm-1', WEBHOOK_CTX)

    expect(removed).toEqual(['github_oauth', 'figma', 'google_drive'])
    for (const find of [mockFindGithub, mockFindFigma, mockFindDrive]) {
      expect(find).toHaveBeenCalledWith('ws-1', 'm-1')
    }
    // Repo hooks are deleted best effort; one failure does not stop the rest.
    expect(mockDeleteRepoWebhook).toHaveBeenCalledWith(
      'plain:enc-token',
      'acme',
      'api',
      11
    )
    expect(mockDeleteRepoWebhook).toHaveBeenCalledWith(
      'plain:enc-token',
      'acme',
      'web',
      12
    )
    expect(mockDeleteGithub).toHaveBeenCalledWith(
      { id: 'gh-1', workspaceId: 'ws-1' },
      WEBHOOK_CTX
    )
    expect(mockDisconnectFigma).toHaveBeenCalledWith('ws-1', 'm-1', WEBHOOK_CTX)
    expect(mockDisconnectDrive).toHaveBeenCalledWith('ws-1', 'm-1', WEBHOOK_CTX)
  })

  it('member integrations: nothing connected means nothing disconnected or audited', async () => {
    const removed = await removeMemberIntegrations('ws-1', 'm-1', WEBHOOK_CTX)

    expect(removed).toEqual([])
    expect(mockDeleteGithub).not.toHaveBeenCalled()
    expect(mockDisconnectFigma).not.toHaveBeenCalled()
    expect(mockDisconnectDrive).not.toHaveBeenCalled()
  })
})
