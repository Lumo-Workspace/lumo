/**
 * @jest-environment node
 *
 * LUM-1335 — local mode's workspace and CLI key for the instance's one account.
 */
const mockFindMembers = jest.fn()
const mockIsSlugUnique = jest.fn()
const mockFindAccounts = jest.fn()
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
jest.mock('@/lib/repositories/auth-user.repository', () => ({
  authUserRepository: { findMany: (...a: unknown[]) => mockFindAccounts(...a) },
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

describe('localModeService.issueCliKey', () => {
  it('issues a full key for the one account, audited as that account', async () => {
    mockFindAccounts.mockResolvedValue([{ id: 'user_1' }])
    mockFindMembers.mockResolvedValue([
      { id: 'm1', workspaceId: 'ws1', workspace: { slug: 'acme' } },
    ])
    const audit = {
      actor: { type: 'MEMBER' as const, clerkId: null, memberId: null },
      source: 'CLI' as const,
      ip: null,
      userAgent: 'curl',
    }
    await expect(localModeService.issueCliKey(audit)).resolves.toEqual({
      key: 'lum_abc',
      workspaceSlug: 'acme',
    })
    expect(mockFindAccounts).toHaveBeenCalledWith({ limit: 2 })
    expect(mockCreateKey).toHaveBeenCalledWith(
      { workspaceId: 'ws1', memberId: 'm1' },
      { label: LOCAL_CLI_KEY_LABEL, scope: null },
      { ...audit, actor: { type: 'MEMBER', clerkId: 'user_1', memberId: 'm1' } }
    )
  })

  it('refuses with 409 when there are several accounts, issuing nothing', async () => {
    mockFindAccounts.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    await expect(localModeService.issueCliKey()).rejects.toMatchObject({
      status: 409,
    })
    expect(mockCreateKey).not.toHaveBeenCalled()
  })

  it('refuses with 409 before the first visit created the account', async () => {
    mockFindAccounts.mockResolvedValue([])
    await expect(localModeService.issueCliKey()).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('open Lumo in a browser once'),
    })
    expect(mockCreateKey).not.toHaveBeenCalled()
  })
})
