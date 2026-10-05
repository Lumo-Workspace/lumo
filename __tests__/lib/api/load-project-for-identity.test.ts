/**
 * @jest-environment node
 *
 * LUM-986 — `loadProjectForIdentity` honors the credential's workspace scope.
 */
import { NextResponse } from 'next/server'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: { findUnique: jest.fn() },
    workspaceMember: { findUnique: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { loadProjectForIdentity } from '@/lib/api/helpers'

const findProject = prisma.project.findUnique as jest.Mock
const findWsMember = prisma.workspaceMember.findUnique as jest.Mock

beforeEach(() => jest.clearAllMocks())

const caller = { clerkId: 'clerk_1', workspaceId: 'ws-alpha' }

const project = (workspaceId: string) => ({
  id: 'proj-1',
  workspaceId,
  teamId: 'team-1',
  name: 'p',
  workspace: { slug: `${workspaceId}-slug` },
})

async function bodyOf(res: unknown) {
  expect(res).toBeInstanceOf(NextResponse)
  const r = res as NextResponse
  return { status: r.status, body: await r.json() }
}

describe('loadProjectForIdentity', () => {
  it('404s with "Project not found" when the project does not exist', async () => {
    findProject.mockResolvedValue(null)
    const res = await loadProjectForIdentity('missing', caller)
    expect(await bodyOf(res)).toEqual({
      status: 404,
      body: { error: 'Project not found' },
    })
    expect(findWsMember).not.toHaveBeenCalled()
  })

  it('404s with the same body when the project is in another workspace, before any membership lookup', async () => {
    findProject.mockResolvedValue(project('ws-bravo'))
    // Even if the human IS a member of the project's workspace.
    findWsMember.mockResolvedValue({ id: 'mem-b', role: 'MEMBER' })
    const res = await loadProjectForIdentity('proj-1', caller)
    expect(await bodyOf(res)).toEqual({
      status: 404,
      body: { error: 'Project not found' },
    })
    expect(findWsMember).not.toHaveBeenCalled()
  })

  it('returns project, member and workspace slug inside the credential workspace', async () => {
    findProject.mockResolvedValue(project('ws-alpha'))
    findWsMember.mockResolvedValue({ id: 'mem-a', role: 'MEMBER' })
    const res = await loadProjectForIdentity('proj-1', caller)
    expect(res).toEqual({
      project: {
        id: 'proj-1',
        workspaceId: 'ws-alpha',
        teamId: 'team-1',
        name: 'p',
      },
      member: { id: 'mem-a', role: 'MEMBER' },
      workspaceSlug: 'ws-alpha-slug',
    })
    expect(findWsMember).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId_clerkId: { workspaceId: 'ws-alpha', clerkId: 'clerk_1' },
          deactivatedAt: null,
        },
      })
    )
  })

  it('403s when the caller is not a member of their credential workspace', async () => {
    findProject.mockResolvedValue(project('ws-alpha'))
    findWsMember.mockResolvedValue(null)
    const res = await loadProjectForIdentity('proj-1', caller)
    expect((await bodyOf(res)).status).toBe(403)
  })
})
