import { workspaceService } from '@/lib/services/workspace.service'

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    create: jest.fn(),
    update: jest.fn(),
    isSlugUnique: jest.fn(),
  },
}))

jest.mock('@/lib/workspace/slug', () => ({
  generateWorkspaceSlug: jest.fn().mockReturnValue('auto-slug'),
}))

import { workspaceRepository } from '@/lib/repositories/workspace.repository'

const mockCreate = workspaceRepository.create as jest.Mock
const mockUpdate = workspaceRepository.update as jest.Mock
const mockIsSlugUnique = workspaceRepository.isSlugUnique as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

// ── createWorkspace ────────────────────────────────────────────────────────

describe('workspaceService.createWorkspace', () => {
  it('generates a slug when none is provided', async () => {
    const fakeResult = { workspace: { id: 'ws-1' }, member: { id: 'mem-1' } }
    mockCreate.mockResolvedValue(fakeResult)

    const result = await workspaceService.createWorkspace('user_1', {
      name: 'My Workspace',
    })

    expect(result).toEqual(fakeResult)
    expect(mockCreate).toHaveBeenCalledWith({
      name: 'My Workspace',
      slug: 'auto-slug',
      clerkId: 'user_1',
    })
  })

  it('uses provided slug when given', async () => {
    mockCreate.mockResolvedValue({})

    await workspaceService.createWorkspace('user_1', {
      name: 'My Workspace',
      slug: 'custom-slug',
    })

    expect(mockCreate).toHaveBeenCalledWith({
      name: 'My Workspace',
      slug: 'custom-slug',
      clerkId: 'user_1',
    })
  })
})

// ── updateWorkspace ────────────────────────────────────────────────────────

describe('workspaceService.updateWorkspace', () => {
  it('throws 403 when caller is not OWNER', async () => {
    await expect(
      workspaceService.updateWorkspace('ws-1', 'MEMBER', 'old-slug', {
        name: 'New',
      })
    ).rejects.toMatchObject({
      message: 'Only admins can update workspace settings',
      status: 403,
    })
  })

  it('throws 409 when new slug is already taken', async () => {
    mockIsSlugUnique.mockResolvedValue(false)

    await expect(
      workspaceService.updateWorkspace('ws-1', 'OWNER', 'old-slug', {
        slug: 'taken-slug',
      })
    ).rejects.toMatchObject({
      message: 'This URL is already taken',
      status: 409,
    })
  })

  it('updates workspace when OWNER and slug is unique', async () => {
    mockIsSlugUnique.mockResolvedValue(true)
    mockUpdate.mockResolvedValue({ id: 'ws-1', slug: 'new-slug' })

    const result = await workspaceService.updateWorkspace(
      'ws-1',
      'OWNER',
      'old-slug',
      { slug: 'new-slug', name: 'Renamed' }
    )

    expect(result).toEqual({ id: 'ws-1', slug: 'new-slug' })
    expect(mockUpdate).toHaveBeenCalledWith('ws-1', {
      slug: 'new-slug',
      name: 'Renamed',
    })
  })

  it('skips slug uniqueness check when slug is unchanged', async () => {
    mockUpdate.mockResolvedValue({ id: 'ws-1' })

    await workspaceService.updateWorkspace('ws-1', 'OWNER', 'same-slug', {
      slug: 'same-slug',
    })

    expect(mockIsSlugUnique).not.toHaveBeenCalled()
  })
})
