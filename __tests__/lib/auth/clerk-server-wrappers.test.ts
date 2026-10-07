/**
 * @jest-environment node
 */
// LUM-1026 — the server half of the @/lib/auth interface must hand Clerk's
// behavior through unchanged: same client factory, same arguments, same
// results and rejections.
import type { NextRequest } from 'next/server'

const mockAuth = jest.fn()
const mockProtect = jest.fn()
const mockCurrentUser = jest.fn()
const mockClerkClient = jest.fn()
const mockCreateClerkClient = jest.fn()
const mockVerifyClerkToken = jest.fn()
type ClerkHandler = (
  auth: (() => Promise<{ userId: string | null }>) & {
    protect: () => Promise<void>
  },
  req: NextRequest
) => Promise<Response | undefined | void>
let capturedHandler: ClerkHandler | null = null
// The function clerkMiddleware() returns; the dispatcher (LUM-1027) builds it
// on the first request and forwards (request, event) to it.
const mockClerkMiddlewareFn = jest.fn(async () => new Response('clerk'))

jest.mock('@clerk/nextjs/server', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
  currentUser: () => mockCurrentUser(),
  clerkClient: () => mockClerkClient(),
  createClerkClient: (opts: unknown) => mockCreateClerkClient(opts),
  createRouteMatcher: jest.fn(),
  clerkMiddleware: (handler: ClerkHandler) => {
    capturedHandler = handler
    return mockClerkMiddlewareFn
  },
}))
// @clerk/mcp-tools subpaths are ESM-only exports jest cannot resolve, so the
// mocks are virtual (as in __tests__/app/api/mcp/route.integration.test.ts).
jest.mock(
  '@clerk/mcp-tools/server',
  () => ({
    verifyClerkToken: (...args: unknown[]) => mockVerifyClerkToken(...args),
  }),
  { virtual: true }
)
jest.mock(
  '@clerk/mcp-tools/next',
  () => ({
    authServerMetadataHandlerClerk: () => async () => 'as-response',
    protectedResourceHandlerClerk: () => async () => 'pr-response',
    metadataCorsOptionsRequestHandler: () => async () => 'options-response',
  }),
  { virtual: true }
)

import { getCurrentUser, getCurrentUserId } from '@/lib/auth/clerk/session'
import {
  createUserDirectory,
  getUserDirectory,
  isUserDirectoryConfigured,
} from '@/lib/auth/users'
import {
  createAuthMiddleware,
  type MiddlewareAuth,
} from '@/lib/auth/middleware'
import { verifyMcpAccessToken } from '@/lib/auth/mcp'
import {
  oauthAuthorizationServerMetadataHandler,
  oauthMetadataOptionsHandler,
  oauthProtectedResourceMetadataHandler,
} from '@/lib/auth/oauth-metadata'

function fakeUsersApi() {
  return {
    getUser: jest.fn(async (id: string) => ({ id })),
    getUserList: jest.fn(async () => ({ data: [{ id: 'u1' }], totalCount: 1 })),
    updateUser: jest.fn(async () => ({ id: 'u1' })),
    updateUserProfileImage: jest.fn(async () => ({ id: 'u1' })),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  capturedHandler = null
})

describe('session', () => {
  it('getCurrentUserId returns the session user id, or null', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'user_1' })
    await expect(getCurrentUserId()).resolves.toBe('user_1')
    mockAuth.mockResolvedValueOnce({ userId: null })
    await expect(getCurrentUserId()).resolves.toBeNull()
    expect(mockAuth).toHaveBeenCalledWith()
  })

  it('getCurrentUser returns the provider user as-is', async () => {
    const user = { id: 'user_1', emailAddresses: [] }
    mockCurrentUser.mockResolvedValueOnce(user)
    await expect(getCurrentUser()).resolves.toBe(user)
    mockCurrentUser.mockResolvedValueOnce(null)
    await expect(getCurrentUser()).resolves.toBeNull()
  })
})

describe('user directory', () => {
  it('getUserDirectory delegates every call to the request clerkClient()', async () => {
    const users = fakeUsersApi()
    mockClerkClient.mockResolvedValue({ users })
    const dir = await getUserDirectory()

    await expect(dir.getUser('u1')).resolves.toEqual({ id: 'u1' })
    const query = { userId: ['u1', 'u2'], limit: 2 }
    await expect(dir.getUserList(query)).resolves.toEqual({
      data: [{ id: 'u1' }],
      totalCount: 1,
    })
    await dir.updateUser('u1', { firstName: 'Ada' })
    const file = new Blob(['x'])
    await dir.updateUserProfileImage('u1', { file })

    expect(users.getUser).toHaveBeenCalledWith('u1')
    expect(users.getUserList).toHaveBeenCalledWith(query)
    expect(users.updateUser).toHaveBeenCalledWith('u1', { firstName: 'Ada' })
    expect(users.updateUserProfileImage).toHaveBeenCalledWith('u1', { file })
    expect(mockCreateClerkClient).not.toHaveBeenCalled()
  })

  it('passes provider rejections through unchanged', async () => {
    const users = fakeUsersApi()
    const err = Object.assign(new Error('not found'), { status: 404 })
    users.getUser.mockRejectedValueOnce(err)
    mockClerkClient.mockResolvedValue({ users })
    await expect((await getUserDirectory()).getUser('gone')).rejects.toBe(err)
  })

  it('createUserDirectory builds a standalone client from CLERK_SECRET_KEY', async () => {
    const saved = process.env.CLERK_SECRET_KEY
    process.env.CLERK_SECRET_KEY = ['fixture', 'secret'].join('-')
    try {
      const users = fakeUsersApi()
      mockCreateClerkClient.mockReturnValue({ users })
      const dir = await createUserDirectory()
      await dir.getUser('u9')
      expect(mockCreateClerkClient).toHaveBeenCalledWith({
        secretKey: 'fixture-secret',
      })
      expect(users.getUser).toHaveBeenCalledWith('u9')
      expect(mockClerkClient).not.toHaveBeenCalled()
    } finally {
      if (saved === undefined) delete process.env.CLERK_SECRET_KEY
      else process.env.CLERK_SECRET_KEY = saved
    }
  })

  it('isUserDirectoryConfigured follows CLERK_SECRET_KEY', () => {
    const saved = process.env.CLERK_SECRET_KEY
    try {
      delete process.env.CLERK_SECRET_KEY
      expect(isUserDirectoryConfigured()).toBe(false)
      process.env.CLERK_SECRET_KEY = ''
      expect(isUserDirectoryConfigured()).toBe(false)
      process.env.CLERK_SECRET_KEY = 'x'
      expect(isUserDirectoryConfigured()).toBe(true)
    } finally {
      if (saved === undefined) delete process.env.CLERK_SECRET_KEY
      else process.env.CLERK_SECRET_KEY = saved
    }
  })
})

describe('createAuthMiddleware', () => {
  const req = {} as NextRequest

  it('returns the provider middleware and exposes userId()/protect()', async () => {
    let seenRequest: NextRequest | null = null
    const handler = jest.fn(
      async (auth: MiddlewareAuth, request: NextRequest) => {
        seenRequest = request
        const userId = await auth.userId()
        await auth.protect()
        return new Response(userId)
      }
    )
    const middleware = createAuthMiddleware(handler)
    const event = {} as Parameters<typeof middleware>[1]
    const out = await middleware(req, event)
    expect(await (out as Response).text()).toBe('clerk')
    expect(mockClerkMiddlewareFn).toHaveBeenCalledWith(req, event)

    const clerkAuth = Object.assign(async () => ({ userId: 'user_7' }), {
      protect: mockProtect,
    })
    const res = await capturedHandler!(clerkAuth, req)
    expect(await (res as Response).text()).toBe('user_7')
    expect(mockProtect).toHaveBeenCalledTimes(1)
    expect(seenRequest).toBe(req)
  })

  it('lets protect() control-flow throws escape (sign-in redirect)', async () => {
    const redirect = new Error('NEXT_REDIRECT')
    mockProtect.mockRejectedValueOnce(redirect)
    const middleware = createAuthMiddleware(async auth => {
      await auth.protect()
      return new Response('unreachable')
    })
    await middleware(req, {} as Parameters<typeof middleware>[1])
    const clerkAuth = Object.assign(async () => ({ userId: null }), {
      protect: mockProtect,
    })
    await expect(capturedHandler!(clerkAuth, req)).rejects.toBe(redirect)
  })
})

describe('MCP OAuth', () => {
  it('verifyMcpAccessToken verifies an oauth_token machine auth', async () => {
    const machineAuth = { tokenType: 'oauth_token', userId: 'user_1' }
    const info = { token: 't', clientId: 'c', scopes: [] }
    mockAuth.mockResolvedValueOnce(machineAuth)
    mockVerifyClerkToken.mockReturnValueOnce(info)

    await expect(verifyMcpAccessToken('t')).resolves.toBe(info)
    expect(mockAuth).toHaveBeenCalledWith({ acceptsToken: 'oauth_token' })
    expect(mockVerifyClerkToken).toHaveBeenCalledWith(machineAuth, 't')
  })

  it('verifyMcpAccessToken resolves undefined for an unverifiable token', async () => {
    mockAuth.mockResolvedValueOnce({ tokenType: 'oauth_token', userId: null })
    mockVerifyClerkToken.mockReturnValueOnce(undefined)
    await expect(verifyMcpAccessToken(undefined)).resolves.toBeUndefined()
  })

  it('metadata handlers delegate each request to the provider handlers', async () => {
    const request = new Request('http://localhost/.well-known/x')
    await expect(
      oauthAuthorizationServerMetadataHandler()(request)
    ).resolves.toBe('as-response')
    await expect(
      oauthProtectedResourceMetadataHandler()(request)
    ).resolves.toBe('pr-response')
    await expect(oauthMetadataOptionsHandler()(request)).resolves.toBe(
      'options-response'
    )
  })
})
