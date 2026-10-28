/**
 * @jest-environment node
 *
 * LUM-987 — active-workspace resolution for browser sessions (unit level; the
 * real-Postgres behavior is pinned in
 * __tests__/security/cross-tenant-idor.real-postgres.test.ts).
 */
const mockFindMany = jest.fn()
const mockFindUnique = jest.fn()
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspaceMember: {
      findMany: (...a: unknown[]) => mockFindMany(...a),
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
    },
  },
}))
const mockHeaders = jest.fn()
jest.mock('next/headers', () => ({ headers: () => mockHeaders() }))

import { NextResponse } from 'next/server'
import {
  getUserWorkspace,
  readActiveWorkspaceSlug,
  requireWorkspaceMember,
  requireWorkspaceMembership,
  resolveActiveMembership,
} from '@/lib/auth'

const row = (workspaceId: string, slug: string) => ({
  id: `m-${workspaceId}`,
  workspaceId,
  clerkId: 'u1',
  role: 'MEMBER',
  workspace: { id: workspaceId, slug, name: slug },
})
const ALPHA = row('wa', 'alpha')
const BRAVO = row('wb', 'bravo')

beforeEach(() => {
  mockFindMany.mockReset()
  mockFindUnique.mockReset()
  mockHeaders.mockReset()
  mockHeaders.mockResolvedValue(new Headers())
})

describe('resolveActiveMembership', () => {
  it('orders memberships deterministically (joinedAt, then id)', async () => {
    mockFindMany.mockResolvedValue([ALPHA, BRAVO])
    await resolveActiveMembership('u1', null)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clerkId: 'u1', deactivatedAt: null },
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      })
    )
  })

  it('no slug → the oldest membership', async () => {
    mockFindMany.mockResolvedValue([ALPHA, BRAVO])
    expect(await resolveActiveMembership('u1', null)).toEqual({
      active: ALPHA,
      count: 2,
    })
  })

  it('slug → that membership', async () => {
    mockFindMany.mockResolvedValue([ALPHA, BRAVO])
    expect((await resolveActiveMembership('u1', 'bravo')).active).toBe(BRAVO)
  })

  it('multi-workspace user, foreign slug → null (no silent fallback)', async () => {
    mockFindMany.mockResolvedValue([ALPHA, BRAVO])
    expect(await resolveActiveMembership('u1', 'nowhere')).toEqual({
      active: null,
      count: 2,
    })
  })

  it('single-workspace user → their workspace whatever the slug', async () => {
    mockFindMany.mockResolvedValue([ALPHA])
    expect((await resolveActiveMembership('u1', 'bravo')).active).toBe(ALPHA)
  })

  it('no membership → null, count 0', async () => {
    mockFindMany.mockResolvedValue([])
    expect(await resolveActiveMembership('u1', 'alpha')).toEqual({
      active: null,
      count: 0,
    })
  })
})

describe('readActiveWorkspaceSlug', () => {
  it('reads X-Lumo-Workspace from the request headers', async () => {
    mockHeaders.mockResolvedValue(new Headers({ 'x-lumo-workspace': 'bravo' }))
    expect(await readActiveWorkspaceSlug()).toBe('bravo')
  })

  it('null outside a request scope', async () => {
    mockHeaders.mockRejectedValue(new Error('outside a request scope'))
    expect(await readActiveWorkspaceSlug()).toBeNull()
  })
})

describe('getUserWorkspace', () => {
  it('defaults the slug to the request header', async () => {
    mockHeaders.mockResolvedValue(new Headers({ 'x-lumo-workspace': 'bravo' }))
    mockFindMany.mockResolvedValue([ALPHA, BRAVO])
    expect((await getUserWorkspace('u1'))?.workspaceId).toBe('wb')
  })

  it('an explicit null slug ignores the header', async () => {
    mockHeaders.mockResolvedValue(new Headers({ 'x-lumo-workspace': 'bravo' }))
    mockFindMany.mockResolvedValue([ALPHA, BRAVO])
    expect((await getUserWorkspace('u1', null))?.workspaceId).toBe('wa')
  })
})

describe('requireWorkspaceMember / requireWorkspaceMembership', () => {
  it('membership-only variant never consults the active workspace', async () => {
    mockFindUnique.mockResolvedValue(BRAVO)
    expect(await requireWorkspaceMembership('wb', 'u1')).toBe(BRAVO)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('not a member → 403 (unchanged)', async () => {
    mockFindUnique.mockResolvedValue(null)
    const res = await requireWorkspaceMember('wb', 'u1')
    expect((res as NextResponse).status).toBe(403)
  })

  it('member of a workspace that is not the active one → 404', async () => {
    mockHeaders.mockResolvedValue(new Headers({ 'x-lumo-workspace': 'alpha' }))
    mockFindUnique.mockResolvedValue(BRAVO)
    mockFindMany.mockResolvedValue([ALPHA, BRAVO])
    const res = await requireWorkspaceMember('wb', 'u1')
    expect((res as NextResponse).status).toBe(404)
  })

  it('member of the active workspace → the member row', async () => {
    mockHeaders.mockResolvedValue(new Headers({ 'x-lumo-workspace': 'bravo' }))
    mockFindUnique.mockResolvedValue(BRAVO)
    mockFindMany.mockResolvedValue([ALPHA, BRAVO])
    expect(await requireWorkspaceMember('wb', 'u1')).toBe(BRAVO)
  })

  it('single-workspace user → the member row, whatever the header', async () => {
    mockHeaders.mockResolvedValue(new Headers({ 'x-lumo-workspace': 'bravo' }))
    mockFindUnique.mockResolvedValue(ALPHA)
    mockFindMany.mockResolvedValue([ALPHA])
    expect(await requireWorkspaceMember('wa', 'u1')).toBe(ALPHA)
  })
})
