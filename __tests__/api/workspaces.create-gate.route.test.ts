/**
 * @jest-environment node
 *
 * LUM-1344 — POST /api/workspaces consults the creation gate before anything
 * is parsed or created, and surfaces the gate's error code.
 */
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
  getCurrentUser: jest.fn(),
  getVerifiedEmails: jest.fn(),
}))

const mockAssertMayCreate = jest.fn()
const mockCreateWorkspace = jest.fn()
jest.mock('@/lib/services', () => ({
  workspaceCreationGate: {
    assertMayCreate: (...a: unknown[]) => mockAssertMayCreate(...a),
  },
  workspaceService: {
    createWorkspace: (...a: unknown[]) => mockCreateWorkspace(...a),
  },
}))

import { NextRequest } from 'next/server'
import { getCurrentUser, getVerifiedEmails, requireAuth } from '@/lib/auth'
import { POST } from '@/app/api/workspaces/route'

function makeRequest() {
  return new NextRequest('http://localhost/api/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Acme', slug: 'acme' }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'user-1' })
  ;(getVerifiedEmails as jest.Mock).mockResolvedValue(['a@acme.com'])
  ;(getCurrentUser as jest.Mock).mockResolvedValue({
    primaryEmailAddress: { emailAddress: 'A@Acme.com' },
    firstName: 'Ada',
    lastName: 'Lovelace',
    username: 'ada',
  })
})

describe('POST /api/workspaces gate', () => {
  it('returns 403 with code WORKSPACE_APPROVAL_REQUIRED and does not create the workspace when the gate refuses', async () => {
    mockAssertMayCreate.mockRejectedValue(
      Object.assign(new Error('Approval required'), {
        status: 403,
        code: 'WORKSPACE_APPROVAL_REQUIRED',
      })
    )
    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: 'Approval required',
      code: 'WORKSPACE_APPROVAL_REQUIRED',
    })
    expect(mockCreateWorkspace).not.toHaveBeenCalled()
  })

  it('creates the workspace when the gate passes', async () => {
    mockAssertMayCreate.mockResolvedValue(undefined)
    mockCreateWorkspace.mockResolvedValue({
      workspace: { id: 'w1', slug: 'acme' },
      member: { id: 'm1' },
    })
    const res = await POST(makeRequest())
    expect(res.status).toBe(201)
    expect(mockAssertMayCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        verifiedEmails: ['a@acme.com'],
        primaryEmail: 'a@acme.com',
        displayName: 'Ada Lovelace',
        now: expect.any(Date),
      })
    )
    expect(mockCreateWorkspace).toHaveBeenCalledWith('user-1', {
      name: 'Acme',
      slug: 'acme',
    })
  })

  it('omits code from the body for errors that have none', async () => {
    mockAssertMayCreate.mockResolvedValue(undefined)
    mockCreateWorkspace.mockRejectedValue(
      Object.assign(new Error('Slug taken'), { status: 409 })
    )
    const res = await POST(makeRequest())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Slug taken' })
  })
})
