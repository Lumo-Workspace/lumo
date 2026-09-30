/**
 * @jest-environment node
 *
 * LUM-918 — the trash API routes: identity-scoped, kind-validated, thin.
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services', () => ({
  trashService: {
    list: jest.fn(),
    restore: jest.fn(),
    deletePermanently: jest.fn(),
  },
}))

import { GET } from '@/app/api/trash/route'
import { DELETE } from '@/app/api/trash/[kind]/[id]/route'
import { POST } from '@/app/api/trash/[kind]/[id]/restore/route'
import { requireIdentity } from '@/lib/auth'
import { trashService } from '@/lib/services'

const identity = { clerkId: 'c1', memberId: 'm1', workspaceId: 'ws1' }
const req = (method: string) =>
  new NextRequest('https://x.test/api/trash', { method })
const params = (kind: string, id: string) => ({
  params: Promise.resolve({ kind, id }),
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireIdentity as jest.Mock).mockResolvedValue(identity)
})

describe('trash routes', () => {
  it('GET lists the caller trash for their workspace', async () => {
    ;(trashService.list as jest.Mock).mockResolvedValue([{ id: 't1' }])
    const res = await GET(req('GET'))
    expect(await res.json()).toEqual({ items: [{ id: 't1' }] })
    expect(trashService.list).toHaveBeenCalledWith('ws1', 'm1')
  })

  it('restore and permanent delete pass kind, id and the caller scope', async () => {
    await POST(req('POST'), params('task', 't1'))
    expect(trashService.restore).toHaveBeenCalledWith('task', 't1', 'ws1', 'm1')
    ;(trashService.deletePermanently as jest.Mock).mockResolvedValue(3)
    const res = await DELETE(req('DELETE'), params('document', 'd1'))
    expect(await res.json()).toEqual({ deleted: 3 })
  })

  it('an unknown kind is a 400 and touches nothing', async () => {
    const res = await POST(req('POST'), params('project', 'p1'))
    expect(res.status).toBe(400)
    expect(trashService.restore).not.toHaveBeenCalled()
  })

  it('a service 404 (not in trash / not yours) comes back as 404', async () => {
    ;(trashService.restore as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Not found in trash'), { status: 404 })
    )
    const res = await POST(req('POST'), params('document', 'd9'))
    expect(res.status).toBe(404)
  })
})
