/**
 * @jest-environment node
 */

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
  getUserWorkspace: jest.fn(),
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    userPreference: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}))

import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { GET, PATCH } from '@/app/api/users/preferences/route'

const mockRequireAuth = requireAuth as jest.Mock
const mockGetUserWorkspace = getUserWorkspace as jest.Mock
const mockFindUnique = prisma.userPreference.findUnique as jest.Mock
const mockUpsert = prisma.userPreference.upsert as jest.Mock

function makeRequest(method: string, body?: unknown): Request {
  if (body !== undefined) {
    return new Request('http://localhost/api/users/preferences', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }
  return new Request('http://localhost/api/users/preferences', { method })
}

const DEFAULTS = {
  theme: 'system',
  locale: 'en',
  timezone: 'auto',
  notifyInAppAssigned: true,
  notifyInAppComment: true,
  notifyInAppAgentDone: true,
  notifyInAppAgentInput: true,
  notifyInAppMention: true,
  notifySlackAssigned: true,
  notifySlackComment: true,
  notifySlackAgentDone: true,
  notifySlackAgentInput: true,
  notifySlackMention: true,
}

beforeEach(() => jest.clearAllMocks())

describe('GET /api/users/preferences', () => {
  it('returns 401 when not authenticated', async () => {
    const { NextResponse } = await import('next/server')
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when user has no workspace', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    mockGetUserWorkspace.mockResolvedValueOnce(null)
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(403)
  })

  it('returns defaults when no preference record exists', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    mockGetUserWorkspace.mockResolvedValueOnce({
      member: { id: 'mem_1' },
      workspaceId: 'ws_1',
    })
    mockFindUnique.mockResolvedValueOnce(null)
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toMatchObject(DEFAULTS)
  })

  it('returns existing preference record', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    mockGetUserWorkspace.mockResolvedValueOnce({
      member: { id: 'mem_1' },
      workspaceId: 'ws_1',
    })
    mockFindUnique.mockResolvedValueOnce({
      id: 'pref_1',
      memberId: 'mem_1',
      theme: 'dark',
      locale: 'zh',
      timezone: 'Asia/Shanghai',
      notifyInAppAssigned: true,
      notifyInAppComment: true,
      notifyInAppAgentDone: true,
      notifyInAppAgentInput: true,
      notifyInAppMention: true,
      notifySlackAssigned: true,
      notifySlackComment: true,
      notifySlackAgentDone: true,
      notifySlackAgentInput: true,
      notifySlackMention: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.theme).toBe('dark')
    expect(data.locale).toBe('zh')
  })
})

describe('PATCH /api/users/preferences', () => {
  it('returns 401 when not authenticated', async () => {
    const { NextResponse } = await import('next/server')
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await PATCH(makeRequest('PATCH', { theme: 'dark' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid theme value', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    mockGetUserWorkspace.mockResolvedValueOnce({
      member: { id: 'mem_1' },
      workspaceId: 'ws_1',
    })
    const res = await PATCH(makeRequest('PATCH', { theme: 'neon' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid locale value', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    mockGetUserWorkspace.mockResolvedValueOnce({
      member: { id: 'mem_1' },
      workspaceId: 'ws_1',
    })
    // 'xx' is not in preference.service's VALID_LOCALES. Earlier the test
    // used 'fr', but 'fr' was later added to the valid list, turning this
    // case into a silent 200 → unmocked repo → 500.
    const res = await PATCH(makeRequest('PATCH', { locale: 'xx' }))
    expect(res.status).toBe(400)
  })

  it('upserts preference and returns updated record', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    mockGetUserWorkspace.mockResolvedValueOnce({
      member: { id: 'mem_1' },
      workspaceId: 'ws_1',
    })
    const updated = {
      id: 'pref_1',
      memberId: 'mem_1',
      theme: 'dark',
      locale: 'en',
      timezone: 'auto',
      notifyInAppAssigned: true,
      notifyInAppComment: true,
      notifyInAppAgentDone: true,
      notifyInAppAgentInput: true,
      notifyInAppMention: true,
      notifySlackAssigned: true,
      notifySlackComment: true,
      notifySlackAgentDone: true,
      notifySlackAgentInput: true,
      notifySlackMention: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    mockUpsert.mockResolvedValueOnce(updated)
    const res = await PATCH(makeRequest('PATCH', { theme: 'dark' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.theme).toBe('dark')
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { memberId: 'mem_1' },
        update: { theme: 'dark' },
        create: expect.objectContaining({ memberId: 'mem_1', theme: 'dark' }),
      })
    )
  })

  it('supports partial update of notification toggles', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    mockGetUserWorkspace.mockResolvedValueOnce({
      member: { id: 'mem_1' },
      workspaceId: 'ws_1',
    })
    const updated = {
      ...DEFAULTS,
      id: 'pref_1',
      memberId: 'mem_1',
      notifySlackComment: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    mockUpsert.mockResolvedValueOnce(updated)
    const res = await PATCH(makeRequest('PATCH', { notifySlackComment: false }))
    expect(res.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { notifySlackComment: false } })
    )
  })
})
