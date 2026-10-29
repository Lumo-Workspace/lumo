/**
 * @jest-environment node
 *
 * LUM-1335 — local mode's workspace and CLI key for the instance's one account.
 */
const mockFindMembers = jest.fn()
const mockIsSlugUnique = jest.fn()
const mockCreateWorkspace = jest.fn()
const mockCreateKey = jest.fn()
const mockCreateProject = jest.fn()
jest.mock('@/lib/services/project.service', () => ({
  projectService: {
    createProject: (...a: unknown[]) => mockCreateProject(...a),
  },
}))
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
    // An existing workspace never gets a project added.
    expect(mockCreateProject).not.toHaveBeenCalled()
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
    expect(mockCreateProject).toHaveBeenCalledWith(
      'ws_new',
      'my-workspace',
      'm_new',
      { name: 'My project' }
    )
  })

  it('adds a suffix only when another account already holds my-workspace', async () => {
    mockFindMembers.mockResolvedValue([])
    mockIsSlugUnique.mockResolvedValue(false)
    mockCreateWorkspace
      .mockReset()
      .mockRejectedValueOnce(new Error('Unique constraint failed on slug'))
      .mockResolvedValueOnce({
        workspace: { id: 'ws_s', slug: 'my-workspace-abc123' },
        member: { id: 'm_s' },
      })
    const ws = await localModeService.ensureWorkspace('user_AbC123')
    expect(mockCreateWorkspace.mock.calls.map(c => c[1].slug)).toEqual([
      'my-workspace',
      'my-workspace-abc123',
    ])
    expect(ws.slug).toBe('my-workspace-abc123')
    expect(mockCreateProject).toHaveBeenCalledTimes(1)
  })

  it('a failed project create is reported, not mistaken for a lost race', async () => {
    mockFindMembers.mockResolvedValue([])
    mockCreateProject.mockRejectedValue(new Error('project insert failed'))
    await expect(localModeService.ensureWorkspace('user_1')).rejects.toThrow(
      'project insert failed'
    )
    expect(mockCreateWorkspace).toHaveBeenCalledTimes(1)
  })
})

describe('localModeService.ensureWorkspace race', () => {
  it('the losing parallel first use never makes a second, suffixed workspace', async () => {
    mockFindMembers
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'm_won',
          workspaceId: 'ws_won',
          workspace: { slug: 'my-workspace' },
        },
      ])
    // By now the winner holds the slug.
    mockIsSlugUnique.mockResolvedValue(false)
    mockCreateWorkspace.mockRejectedValue(
      new Error('Unique constraint failed on slug')
    )
    await expect(
      localModeService.ensureWorkspace('user_1')
    ).resolves.toMatchObject({
      workspaceId: 'ws_won',
    })
    expect(mockCreateWorkspace).toHaveBeenCalledTimes(1)
    expect(mockCreateProject).not.toHaveBeenCalled()
  })

  it('a create that loses to a parallel first use returns the workspace that won', async () => {
    mockFindMembers.mockResolvedValueOnce([]).mockResolvedValueOnce([
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
