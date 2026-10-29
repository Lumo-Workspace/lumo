/**
 * @jest-environment node
 *
 * LUM-1335 — local mode's workspace and CLI key for the instance's one account.
 */
const mockFindMembers = jest.fn()
const mockIsSlugUnique = jest.fn()
const mockCreateWorkspace = jest.fn()
const mockCreateKey = jest.fn()
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findByClerkId: (...a: unknown[]) => mockFindMembers(...a),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    isSlugUnique: (...a: unknown[]) => mockIsSlugUnique(...a),
  },
}))
jest.mock('@/lib/services/workspace.service', () => ({
  workspaceService: {
    createWorkspace: (...a: unknown[]) => mockCreateWorkspace(...a),
  },
}))
jest.mock('@/lib/services/api-key.service', () => ({
  apiKeyService: { create: (...a: unknown[]) => mockCreateKey(...a) },
}))

import {
  LOCAL_CLI_KEY_LABEL,
  localModeService,
} from '@/lib/services/local-mode.service'

beforeEach(() => {
  jest.resetAllMocks()
  mockCreateWorkspace.mockResolvedValue({
    workspace: { id: 'ws_new', slug: 'my-workspace' },
    member: { id: 'm_new' },
  })
  mockCreateKey.mockResolvedValue({ id: 'k1', key: 'lum_abc' })
})

describe('localModeService.ensureWorkspace', () => {
  it('keeps the workspace the account already has', async () => {
    mockFindMembers.mockResolvedValue([
      { id: 'm1', workspaceId: 'ws1', workspace: { slug: 'acme' } },
    ])
    await expect(localModeService.ensureWorkspace('user_1')).resolves.toEqual({
      workspaceId: 'ws1',
      memberId: 'm1',
      slug: 'acme',
    })
    expect(mockCreateWorkspace).not.toHaveBeenCalled()
  })

  it('creates "My workspace" for an account without one', async () => {
    mockFindMembers.mockResolvedValue([])
    mockIsSlugUnique.mockResolvedValue(true)
    const ws = await localModeService.ensureWorkspace('user_1')
    expect(mockCreateWorkspace).toHaveBeenCalledWith('user_1', {
      name: 'My workspace',
      slug: 'my-workspace',
    })
    expect(ws).toEqual({
      workspaceId: 'ws_new',
      memberId: 'm_new',
      slug: 'my-workspace',
    })
  })

  it('adds a suffix when the my-workspace slug is taken', async () => {
    mockFindMembers.mockResolvedValue([])
    mockIsSlugUnique.mockResolvedValue(false)
    await localModeService.ensureWorkspace('user_AbC123')
    expect(mockCreateWorkspace).toHaveBeenCalledWith('user_AbC123', {
      name: 'My workspace',
      slug: 'my-workspace-abc123',
    })
  })
})

describe('localModeService.ensureWorkspace race', () => {
  it('a create that loses to a parallel first use returns the workspace that won', async () => {
    mockFindMembers
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'm_won',
          workspaceId: 'ws_won',
          workspace: { slug: 'my-workspace' },
        },
      ])
    mockIsSlugUnique.mockResolvedValue(true)
    mockCreateWorkspace.mockRejectedValue(
      new Error('Unique constraint failed on slug')
    )
    await expect(localModeService.ensureWorkspace('user_1')).resolves.toEqual({
      workspaceId: 'ws_won',
      memberId: 'm_won',
      slug: 'my-workspace',
    })
  })

  it('a create that fails for another reason still fails', async () => {
    mockFindMembers.mockResolvedValue([])
    mockIsSlugUnique.mockResolvedValue(true)
    mockCreateWorkspace.mockRejectedValue(new Error('db down'))
    await expect(localModeService.ensureWorkspace('user_1')).rejects.toThrow(
      'db down'
    )
  })
})

describe('localModeService.issueCliKey', () => {
  it("issues a full key in the account's workspace, audited as that account", async () => {
    mockFindMembers.mockResolvedValue([
      { id: 'm1', workspaceId: 'ws1', workspace: { slug: 'acme' } },
    ])
    const audit = {
      actor: { type: 'MEMBER' as const, clerkId: 'user_1', memberId: null },
      source: 'CLI' as const,
      ip: null,
      userAgent: 'lumo-cli',
    }
    await expect(
      localModeService.issueCliKey('user_1', audit)
    ).resolves.toEqual({
      key: 'lum_abc',
      workspaceSlug: 'acme',
    })
    expect(mockCreateKey).toHaveBeenCalledWith(
      { workspaceId: 'ws1', memberId: 'm1' },
      { label: LOCAL_CLI_KEY_LABEL, scope: null },
      { ...audit, actor: { type: 'MEMBER', clerkId: 'user_1', memberId: 'm1' } }
    )
  })

  it('creates the workspace first when the account has none', async () => {
    mockFindMembers.mockResolvedValue([])
    mockIsSlugUnique.mockResolvedValue(true)
    await expect(localModeService.issueCliKey('user_1')).resolves.toEqual({
      key: 'lum_abc',
      workspaceSlug: 'my-workspace',
    })
    expect(mockCreateKey).toHaveBeenCalledWith(
      { workspaceId: 'ws_new', memberId: 'm_new' },
      expect.anything(),
      undefined
    )
  })
})
