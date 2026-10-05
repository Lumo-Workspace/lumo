/**
 * @jest-environment node
 *
 * LUM-907 PR3: integration connect / disconnect audit — Figma and Google
 * Drive (member-personal, every disconnect request is recorded), GitHub OAuth
 * (member-personal) and Sentry project mappings (OWNER).
 */
process.env.ENCRYPTION_KEY = 'a'.repeat(64)

const mockAudit = jest.fn().mockResolvedValue(true)
jest.mock('@/lib/services/audit.service', () => ({
  recordAuditEvent: (...a: unknown[]) => mockAudit(...a),
}))
jest.mock('@/lib/integrations/figma/oauth', () => ({
  FIGMA_OAUTH_SCOPES: ['file_content:read'],
  exchangeCode: jest.fn().mockResolvedValue({
    access_token: 'figma-at',
    refresh_token: 'figma-rt',
    expires_in: 3600,
  }),
}))
jest.mock('@/lib/integrations/google-drive/oauth', () => ({
  GOOGLE_DRIVE_OAUTH_SCOPES: ['drive.readonly'],
  exchangeCode: jest.fn().mockResolvedValue({
    access_token: 'g-at',
    refresh_token: 'g-rt',
    expires_in: 3600,
  }),
}))
jest.mock('@/lib/integrations/google-drive/client', () => ({
  createGoogleDriveClient: jest.fn(),
  GoogleNeedsReauthError: class extends Error {},
}))
jest.mock('@/lib/repositories/figma-integration.repository', () => ({
  figmaIntegrationRepository: {
    upsert: jest.fn().mockResolvedValue({ id: 'fi1' }),
    delete: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/repositories/google-drive-integration.repository', () => ({
  googleDriveIntegrationRepository: {
    upsert: jest.fn().mockResolvedValue({ id: 'gi1' }),
    delete: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    upsertIntegration: jest.fn().mockResolvedValue({ id: 'gh1' }),
    deleteIntegration: jest.fn().mockResolvedValue({ id: 'gh1' }),
  },
}))
jest.mock('@/lib/repositories/sentry.repository', () => ({
  sentryRepository: {
    findIntegrationByWorkspace: jest.fn(),
    findProjectInWorkspace: jest.fn(),
    findMappingByProjectSlug: jest.fn(),
    createMapping: jest.fn(),
    findMappingWithIntegration: jest.fn(),
    deleteMapping: jest.fn(),
  },
}))
jest.mock('@/lib/services/task.service', () => ({ taskService: {} }))
jest.mock('@/lib/repositories/task.repository', () => ({ taskRepository: {} }))

import * as figma from '@/lib/services/figma-integration.service'
import * as drive from '@/lib/services/google-drive-integration.service'
import { githubService } from '@/lib/services/github.service'
import { sentryService } from '@/lib/services/sentry.service'
import { sentryRepository } from '@/lib/repositories/sentry.repository'
import { figmaIntegrationRepository } from '@/lib/repositories/figma-integration.repository'

const ctx = {
  actor: { type: 'MEMBER' as const, clerkId: 'c1', memberId: 'm1' },
  source: 'WEB' as const,
}
const sentryRepo = sentryRepository as jest.Mocked<typeof sentryRepository>

beforeEach(() => {
  mockAudit.mockClear()
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      id: 'u1',
      handle: 'alice',
      email: 'a@x.io',
      sub: 'g1',
    }),
  }) as unknown as typeof fetch
})

describe('LUM-907 PR3 integrations audit', () => {
  it('integrations audit: Figma connect records the scopes, never the account handle or tokens', async () => {
    await figma.completeOauthFlow(
      { workspaceId: 'w1', memberId: 'm1', code: 'c' },
      ctx
    )
    expect(mockAudit).toHaveBeenCalledWith({
      workspaceId: 'w1',
      action: 'figma.connected',
      target: { type: 'integration', id: 'figma' },
      metadata: { scopes: ['file_content:read'] },
      context: ctx,
    })
    const recorded = JSON.stringify(mockAudit.mock.calls)
    for (const secret of ['alice', 'a@x.io', 'figma-at', 'figma-rt']) {
      expect(recorded).not.toContain(secret)
    }
  })

  it('integrations audit: a failed Figma token exchange records nothing', async () => {
    ;(figmaIntegrationRepository.upsert as jest.Mock).mockRejectedValueOnce(
      new Error('db')
    )
    await expect(
      figma.completeOauthFlow(
        { workspaceId: 'w1', memberId: 'm1', code: 'c' },
        ctx
      )
    ).rejects.toThrow('db')
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('integrations audit: Figma and Drive disconnect record every request', async () => {
    await figma.disconnectIntegration('w1', 'm1', ctx)
    await drive.disconnectIntegration('w1', 'm1', ctx)
    await drive.disconnectIntegration('w1', 'm1', ctx)
    expect(mockAudit.mock.calls.map(c => c[0].action)).toEqual([
      'figma.disconnected',
      'google_drive.disconnected',
      'google_drive.disconnected',
    ])
  })

  it('integrations audit: Google Drive connect records the scopes', async () => {
    await drive.completeOauthFlow(
      { workspaceId: 'w1', memberId: 'm1', code: 'c' },
      ctx
    )
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'google_drive.connected',
        metadata: { scopes: ['drive.readonly'] },
      })
    )
    expect(JSON.stringify(mockAudit.mock.calls)).not.toContain('a@x.io')
  })

  it('integrations audit: GitHub OAuth connect and disconnect', async () => {
    await githubService.upsertIntegration(
      {
        workspaceId: 'w1',
        memberId: 'm1',
        accessToken: 'enc',
        tokenType: 'bearer',
        githubUserId: '42',
        githubLogin: 'octo',
      },
      ctx
    )
    await githubService.deleteIntegration({ id: 'gh1', workspaceId: 'w1' }, ctx)
    expect(mockAudit.mock.calls.map(c => c[0])).toEqual([
      {
        workspaceId: 'w1',
        action: 'github_oauth.connected',
        target: { type: 'integration', id: 'github_oauth' },
        metadata: { githubUserId: '42' },
        context: ctx,
      },
      {
        workspaceId: 'w1',
        action: 'github_oauth.disconnected',
        target: { type: 'integration', id: 'github_oauth' },
        context: ctx,
      },
    ])
  })

  it('integrations audit: Sentry mapping create and delete are audited; refusals are not', async () => {
    await expect(
      sentryService.createMapping(
        'w1',
        'MEMBER',
        { sentryProjectSlug: 's', projectId: 'p' },
        ctx
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(mockAudit).not.toHaveBeenCalled()

    sentryRepo.findIntegrationByWorkspace.mockResolvedValue({
      id: 'si1',
    } as never)
    sentryRepo.findProjectInWorkspace.mockResolvedValue({ id: 'p' } as never)
    sentryRepo.findMappingByProjectSlug.mockResolvedValue(null)
    sentryRepo.createMapping.mockResolvedValue({ id: 'map1' } as never)
    await sentryService.createMapping(
      'w1',
      'OWNER',
      { sentryProjectSlug: 'web', projectId: 'p' },
      ctx
    )
    sentryRepo.findMappingWithIntegration.mockResolvedValue({
      id: 'map1',
      integration: { workspaceId: 'w1' },
    } as never)
    await sentryService.deleteMapping('w1', 'OWNER', 'map1', ctx)
    expect(mockAudit.mock.calls.map(c => c[0])).toEqual([
      {
        workspaceId: 'w1',
        action: 'sentry.mapping_created',
        target: { type: 'sentry_mapping', id: 'map1' },
        metadata: { sentryProjectSlug: 'web', projectId: 'p' },
        context: ctx,
      },
      {
        workspaceId: 'w1',
        action: 'sentry.mapping_deleted',
        target: { type: 'sentry_mapping', id: 'map1' },
        context: ctx,
      },
    ])
  })
})
