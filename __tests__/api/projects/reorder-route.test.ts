/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
}))

jest.mock('@/lib/api/helpers', () => ({
  requireUserWorkspace: jest.fn(),
  zodError: (parsed: { error: { issues: { message: string }[] } }) => {
    const { NextResponse } = require('next/server')
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  },
}))

jest.mock('@/lib/services', () => ({
  projectService: {
    reorderProjects: jest.fn(),
  },
}))

import { PATCH } from '@/app/api/projects/reorder/route'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { projectService } from '@/lib/services'

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/projects/reorder', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => jest.clearAllMocks())

describe('PATCH /api/projects/reorder', () => {
  it('returns 401 when unauthenticated', async () => {
    const { NextResponse } = require('next/server')
    ;(requireAuth as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    )

    const res = await PATCH(req({ orderedIds: ['abc'] }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when body is malformed', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'u1' })
    ;(requireUserWorkspace as jest.Mock).mockResolvedValue({
      workspaceId: 'ws-1',
      workspace: { slug: 'acme' },
      member: { id: 'm1' },
    })

    const res = await PATCH(req({ orderedIds: [] }))
    expect(res.status).toBe(400)
    expect(projectService.reorderProjects).not.toHaveBeenCalled()
  })

  it('returns 200 and calls the service on success', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'u1' })
    ;(requireUserWorkspace as jest.Mock).mockResolvedValue({
      workspaceId: 'ws-1',
      workspace: { slug: 'acme' },
      member: { id: 'm1' },
    })
    ;(projectService.reorderProjects as jest.Mock).mockResolvedValue(undefined)

    const res = await PATCH(
      req({
        orderedIds: ['cjlds5g4h00014z0ab1c2d3e4', 'cjlds5g4h00024z0ab1c2d3e5'],
      })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(projectService.reorderProjects).toHaveBeenCalledWith(
      'ws-1',
      'acme',
      'm1',
      ['cjlds5g4h00014z0ab1c2d3e4', 'cjlds5g4h00024z0ab1c2d3e5']
    )
  })

  it('forwards service status codes (e.g. 400 for mixed workspace)', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'u1' })
    ;(requireUserWorkspace as jest.Mock).mockResolvedValue({
      workspaceId: 'ws-1',
      workspace: { slug: 'acme' },
      member: { id: 'm1' },
    })
    ;(projectService.reorderProjects as jest.Mock).mockRejectedValue(
      Object.assign(new Error('mixed'), { status: 400 })
    )

    const res = await PATCH(req({ orderedIds: ['cjlds5g4h00014z0ab1c2d3e4'] }))
    expect(res.status).toBe(400)
  })
})
