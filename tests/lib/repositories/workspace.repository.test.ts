import { workspaceRepository } from '@/lib/repositories/workspace.repository'

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    workspace: { findFirst: jest.fn() },
  },
}))

jest.mock('@/lib/team', () => ({
  generateIdentifier: jest.fn().mockReturnValue('TST'),
}))

import { prisma } from '@/lib/db/prisma'

const mockTransaction = prisma.$transaction as jest.Mock
const mockFindFirst = prisma.workspace.findFirst as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

// ── create ─────────────────────────────────────────────────────────────────

describe('workspaceRepository.create', () => {
  it('runs a transaction that creates workspace, team, member, and actors', async () => {
    const fakeWorkspace = { id: 'ws-1', name: 'Test', slug: 'test' }
    const fakeMember = { id: 'mem-1' }

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        workspace: { create: jest.fn().mockResolvedValue(fakeWorkspace) },
        team: { create: jest.fn().mockResolvedValue({ id: 'team-1' }) },
        workspaceMember: { create: jest.fn().mockResolvedValue(fakeMember) },
        teamMember: { create: jest.fn().mockResolvedValue({}) },
        actor: { create: jest.fn().mockResolvedValue({}) },
        agentProfile: {
          create: jest.fn().mockResolvedValue({ id: 'agent-1' }),
        },
      }
      return fn(tx)
    })

    const result = await workspaceRepository.create({
      name: 'Test',
      slug: 'test',
      clerkId: 'user_123',
    })

    expect(result).toEqual({ workspace: fakeWorkspace, member: fakeMember })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })
})

// ── isSlugUnique ───────────────────────────────────────────────────────────

describe('workspaceRepository.isSlugUnique', () => {
  it('returns true when no workspace has the slug', async () => {
    mockFindFirst.mockResolvedValue(null)

    const result = await workspaceRepository.isSlugUnique('new-slug')

    expect(result).toBe(true)
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { slug: 'new-slug' },
    })
  })

  it('returns false when the slug is taken', async () => {
    mockFindFirst.mockResolvedValue({ id: 'ws-2', slug: 'taken' })

    const result = await workspaceRepository.isSlugUnique('taken')

    expect(result).toBe(false)
  })

  it('excludes a specific workspace id when checking uniqueness', async () => {
    mockFindFirst.mockResolvedValue(null)

    await workspaceRepository.isSlugUnique('my-slug', 'ws-1')

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { slug: 'my-slug', id: { not: 'ws-1' } },
    })
  })
})
