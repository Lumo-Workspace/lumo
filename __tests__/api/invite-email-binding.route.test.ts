/**
 * @jest-environment node
 *
 * LUM-906 PR1 — the invite routes through the real invite service (only the
 * repositories and Clerk are stubbed): the public GET never returns the full
 * invited address, and POST accept passes the caller's verified emails and
 * answers a mismatch with 403 INVITE_EMAIL_MISMATCH plus the masked address.
 */
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
  getVerifiedEmails: jest.fn(),
  getUserWorkspace: jest.fn(),
}))

const mockFindByToken = jest.fn()
const mockFindByTokenWithWorkspace = jest.fn()
const mockAcceptInTransaction = jest.fn()
const mockFindByWorkspaceAndClerkId = jest.fn()

jest.mock('@/lib/repositories/invite.repository', () => ({
  inviteRepository: {
    findByToken: (...a: unknown[]) => mockFindByToken(...a),
    findByTokenWithWorkspace: (...a: unknown[]) =>
      mockFindByTokenWithWorkspace(...a),
    acceptInTransaction: (...a: unknown[]) => mockAcceptInTransaction(...a),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findByWorkspaceAndClerkId: (...a: unknown[]) =>
      mockFindByWorkspaceAndClerkId(...a),
  },
}))
jest.mock('@/lib/services/audit.service', () => ({
  recordAuditEvent: jest.fn(),
  normalizeAuditIp: () => null,
}))

import { NextRequest } from 'next/server'
import { getVerifiedEmails, requireAuth } from '@/lib/auth'
import { GET } from '@/app/api/invites/[token]/route'
import { POST } from '@/app/api/invites/[token]/accept/route'

const INVITED = 'alice.anderson@acme.com'
const params = { params: Promise.resolve({ token: 'tok-1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'clerk-1' })
  mockFindByWorkspaceAndClerkId.mockResolvedValue(null)
  mockAcceptInTransaction.mockResolvedValue({ id: 'member-new' })
  mockFindByTokenWithWorkspace.mockResolvedValue({
    id: 'inv-1',
    workspaceId: 'ws-1',
    status: 'PENDING',
    email: INVITED,
    expiresAt: new Date('2099-01-01'),
    workspace: { slug: 'acme', teams: [] },
  })
})

describe('LUM-906 invite routes', () => {
  it('invite GET returns only the masked address, never the full one', async () => {
    mockFindByToken.mockResolvedValue({
      status: 'PENDING',
      expiresAt: new Date('2099-01-01'),
      email: INVITED,
      inviterName: 'Bob',
      workspace: { name: 'Acme', slug: 'acme' },
    })

    const res = await GET(new NextRequest('http://x/api/invites/tok-1'), params)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(JSON.parse(text).invite.maskedEmail).toBe('a***@acme.com')
    expect(text).not.toContain(INVITED)
    expect(text).not.toContain('alice.anderson')
  })

  it('invite accept route returns 403 with the mismatch code and masked address', async () => {
    ;(getVerifiedEmails as jest.Mock).mockResolvedValue(['mallory@evil.test'])

    const res = await POST(
      new NextRequest('http://x/api/invites/tok-1/accept', { method: 'POST' }),
      params
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({
      code: 'INVITE_EMAIL_MISMATCH',
      maskedEmail: 'a***@acme.com',
    })
    expect(JSON.stringify(body)).not.toContain(INVITED)
    expect(mockAcceptInTransaction).not.toHaveBeenCalled()
  })

  it('invite accept route joins when a verified email matches', async () => {
    ;(getVerifiedEmails as jest.Mock).mockResolvedValue([
      'Alice.Anderson@ACME.com',
    ])

    const res = await POST(
      new NextRequest('http://x/api/invites/tok-1/accept', { method: 'POST' }),
      params
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ workspaceSlug: 'acme' })
    expect(mockAcceptInTransaction).toHaveBeenCalledTimes(1)
  })
})
