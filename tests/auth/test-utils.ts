import { Session } from 'next-auth'
import { JWT } from 'next-auth/jwt'

/**
 * Authentication Test Utilities
 *
 * Helper functions for creating mock sessions, users, and tokens in tests
 */

/**
 * Create a mock session for testing
 */
export function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    user: {
      id: 'test-user-id',
      name: 'Test User',
      email: 'test@example.com',
      image: 'https://example.com/avatar.jpg',
      ...overrides.user,
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  }
}

/**
 * Create a mock JWT token for testing
 */
export function createMockToken(overrides: Partial<JWT> = {}): JWT {
  return {
    userId: 'test-user-id',
    name: 'Test User',
    email: 'test@example.com',
    picture: 'https://example.com/avatar.jpg',
    sub: 'test-user-id',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    ...overrides,
  }
}

/**
 * Create a mock user record for testing
 */
export function createMockUser(overrides: any = {}) {
  return {
    id: 'test-user-id',
    name: 'Test User',
    email: 'test@example.com',
    emailVerified: new Date(),
    image: 'https://example.com/avatar.jpg',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

/**
 * Create a mock account record for testing
 */
export function createMockAccount(overrides: any = {}) {
  return {
    id: 'test-account-id',
    userId: 'test-user-id',
    type: 'oauth',
    provider: 'google',
    providerAccountId: 'google-123456',
    refresh_token: 'encrypted-refresh-token',
    access_token: 'encrypted-access-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'Bearer',
    scope: 'openid email profile',
    id_token: 'mock-id-token',
    session_state: null,
    lastUsedAt: new Date(),
    ...overrides,
  }
}

/**
 * Create a mock Google profile for testing
 */
export function createMockGoogleProfile(overrides: any = {}) {
  return {
    sub: 'google-123456',
    name: 'Test User',
    email: 'test@example.com',
    email_verified: true,
    picture: 'https://example.com/avatar.jpg',
    given_name: 'Test',
    family_name: 'User',
    locale: 'en',
    ...overrides,
  }
}

/**
 * Create expired session for testing
 */
export function createExpiredSession(): Session {
  return createMockSession({
    expires: new Date(Date.now() - 1000).toISOString(),
  })
}

/**
 * Create expired token for testing
 */
export function createExpiredToken(): JWT {
  return createMockToken({
    exp: Math.floor(Date.now() / 1000) - 3600,
  })
}

/**
 * Mock environment variables for testing
 */
export function mockAuthEnv() {
  process.env.NEXTAUTH_URL = 'http://localhost:3000'
  process.env.NEXTAUTH_SECRET = 'test-secret-key-at-least-32-chars-long'
  process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.from(
    'test-encryption-key-32-bytes!!'
  ).toString('base64')
  process.env.SESSION_MAX_AGE_HOURS = '24'
  process.env.MAX_CONCURRENT_SESSIONS = '3'
}

/**
 * Clear auth environment variables
 */
export function clearAuthEnv() {
  delete process.env.NEXTAUTH_URL
  delete process.env.NEXTAUTH_SECRET
  delete process.env.GOOGLE_CLIENT_ID
  delete process.env.GOOGLE_CLIENT_SECRET
  delete process.env.TOKEN_ENCRYPTION_KEY
  delete process.env.SESSION_MAX_AGE_HOURS
  delete process.env.MAX_CONCURRENT_SESSIONS
}
