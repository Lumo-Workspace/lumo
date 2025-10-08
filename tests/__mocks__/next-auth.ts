import { Session } from 'next-auth'
import { JWT } from 'next-auth/jwt'

/**
 * Mock NextAuth.js for Testing
 *
 * Provides mock implementations for NextAuth functions and types
 * Used in unit and integration tests
 */

export const mockSession: Session = {
  user: {
    id: 'test-user-id',
    name: 'Test User',
    email: 'test@example.com',
    image: 'https://example.com/avatar.jpg',
  },
  expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
}

export const mockToken: JWT = {
  userId: 'test-user-id',
  name: 'Test User',
  email: 'test@example.com',
  picture: 'https://example.com/avatar.jpg',
  sub: 'test-user-id',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
}

export const mockAccount = {
  provider: 'google',
  type: 'oauth',
  providerAccountId: 'google-123456',
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'Bearer',
  scope: 'openid email profile',
  id_token: 'mock-id-token',
}

export const mockProfile = {
  sub: 'google-123456',
  name: 'Test User',
  email: 'test@example.com',
  email_verified: true,
  picture: 'https://example.com/avatar.jpg',
}

export const mockUser = {
  id: 'test-user-id',
  name: 'Test User',
  email: 'test@example.com',
  emailVerified: new Date(),
  image: 'https://example.com/avatar.jpg',
}

/**
 * Mock getServerSession function
 */
export const getServerSession = jest.fn(async () => mockSession)

/**
 * Mock signIn function
 */
export const signIn = jest.fn(async () => ({
  url: '/dashboard',
  ok: true,
  status: 200,
  error: undefined,
}))

/**
 * Mock signOut function
 */
export const signOut = jest.fn(async () => ({ url: '/login' }))

/**
 * Mock useSession hook for client components
 */
export const useSession = jest.fn(() => ({
  data: mockSession,
  status: 'authenticated' as const,
  update: jest.fn(),
}))

/**
 * Reset all mocks
 */
export function resetAuthMocks() {
  getServerSession.mockClear()
  signIn.mockClear()
  signOut.mockClear()
  useSession.mockClear()
}
