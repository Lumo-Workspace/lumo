/**
 * @jest-environment node
 */

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
}))

jest.mock('@/lib/auth/users', () => ({
  getUserDirectory: jest.fn(),
}))

import { requireAuth } from '@/lib/auth'
import { getUserDirectory } from '@/lib/auth/users'
import { PATCH } from '@/app/api/users/profile/route'
import { POST } from '@/app/api/users/profile/avatar/route'

const mockRequireAuth = requireAuth as jest.Mock
const mockGetUserDirectory = getUserDirectory as jest.Mock

function makeJsonRequest(body: unknown, method = 'PATCH'): Request {
  return new Request('http://localhost/api/users/profile', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeFormRequest(file: File): Request {
  const fd = new FormData()
  fd.append('file', file)
  return new Request('http://localhost/api/users/profile/avatar', {
    method: 'POST',
    body: fd,
  })
}

beforeEach(() => jest.clearAllMocks())

// ── PATCH /api/users/profile ──────────────────────────────────────────────────

describe('PATCH /api/users/profile', () => {
  it('returns 401 when not authenticated', async () => {
    const { NextResponse } = await import('next/server')
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await PATCH(
      makeJsonRequest({ firstName: 'Chao', lastName: 'Li' })
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when both firstName and lastName are empty', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    const res = await PATCH(makeJsonRequest({ firstName: '  ', lastName: '' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/firstName or lastName/)
  })

  it('calls the directory updateUser and returns ok:true', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    const mockUpdateUser = jest.fn().mockResolvedValueOnce({})
    mockGetUserDirectory.mockResolvedValueOnce({ updateUser: mockUpdateUser })

    const res = await PATCH(
      makeJsonRequest({ firstName: 'Chao', lastName: 'Li' })
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(mockUpdateUser).toHaveBeenCalledWith('user_abc', {
      firstName: 'Chao',
      lastName: 'Li',
    })
  })

  it('only sends non-empty fields to Clerk (partial update)', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    const mockUpdateUser = jest.fn().mockResolvedValueOnce({})
    mockGetUserDirectory.mockResolvedValueOnce({ updateUser: mockUpdateUser })

    // Send only firstName — lastName should NOT be included in the update
    const res = await PATCH(
      makeJsonRequest({ firstName: 'Chao', lastName: '' })
    )
    expect(res.status).toBe(200)
    expect(mockUpdateUser).toHaveBeenCalledWith('user_abc', {
      firstName: 'Chao',
    })
    // lastName must NOT be in the call args
    const callArgs = mockUpdateUser.mock.calls[0][1]
    expect(callArgs).not.toHaveProperty('lastName')
  })
})

// ── POST /api/users/profile/avatar ───────────────────────────────────────────

describe('POST /api/users/profile/avatar', () => {
  it('returns 401 when not authenticated', async () => {
    const { NextResponse } = await import('next/server')
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const file = new File(['data'], 'avatar.png', { type: 'image/png' })
    const res = await POST(makeFormRequest(file))
    expect(res.status).toBe(401)
  })

  it('returns 400 when file exceeds 2 MB', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    // Create a file just over 2 MB
    const bigData = new Uint8Array(2 * 1024 * 1024 + 1)
    const file = new File([bigData], 'big.png', { type: 'image/png' })
    const res = await POST(makeFormRequest(file))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/2 MB/)
  })

  it('returns 400 for disallowed file type', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    const file = new File(['data'], 'avatar.gif', { type: 'image/gif' })
    const res = await POST(makeFormRequest(file))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/JPG, PNG/)
  })

  it('calls the directory updateUserProfileImage and returns ok:true', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user_abc' })
    const mockUpdateImage = jest.fn().mockResolvedValueOnce({})
    mockGetUserDirectory.mockResolvedValueOnce({
      updateUserProfileImage: mockUpdateImage,
    })
    const file = new File(['data'], 'avatar.png', { type: 'image/png' })
    const res = await POST(makeFormRequest(file))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    // FormData round-trip creates a new File instance with a different lastModified,
    // so compare by properties rather than by reference.
    expect(mockUpdateImage).toHaveBeenCalledWith(
      'user_abc',
      expect.objectContaining({
        file: expect.objectContaining({
          name: 'avatar.png',
          type: 'image/png',
          size: file.size,
        }),
      })
    )
  })
})
