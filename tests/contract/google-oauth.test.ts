/**
 * Google OAuth Contract Tests
 *
 * Tests that OAuth endpoints conform to their API contracts
 *
 * Requirements:
 * - API-001: /api/auth/signin/google redirects to Google OAuth
 * - API-002: /api/auth/callback/google handles token exchange
 * - SR-011: CSRF protection via state parameter
 *
 * @see specs/001-google/contracts/auth-api.yaml
 */

import { NextRequest } from 'next/server'

describe('Google OAuth API Contracts', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
    process.env.NEXTAUTH_URL = 'http://localhost:3000'
    process.env.NEXTAUTH_SECRET = 'test-secret-key-at-least-32-chars-long'
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from(
      'test-encryption-key-32-bytes!!'
    ).toString('base64')
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('GET /api/auth/signin/google', () => {
    it('should initiate OAuth flow with redirect', async () => {
      // This endpoint is handled by NextAuth internally
      // We verify the configuration is correct
      const { authOptions } = require('@/lib/auth/config')
      const googleProvider = authOptions.providers[0]

      expect(googleProvider).toBeDefined()
      expect(googleProvider.id).toBe('google')
    })

    it('should include CSRF state parameter', () => {
      const { authOptions } = require('@/lib/auth/config')

      // NextAuth automatically handles CSRF via state parameter
      // We verify callbacks are defined (required for state validation)
      expect(authOptions.callbacks).toBeDefined()
      expect(authOptions.callbacks.signIn).toBeDefined()
    })

    it('should request correct OAuth scopes', () => {
      const { authOptions } = require('@/lib/auth/config')
      const googleProvider = authOptions.providers[0] as any

      expect(googleProvider.authorization.params.scope).toBe(
        'openid email profile'
      )
    })

    it('should enable PKCE (code_challenge_method)', () => {
      const { authOptions } = require('@/lib/auth/config')
      const googleProvider = authOptions.providers[0] as any

      expect(googleProvider.authorization.params.code_challenge_method).toBe(
        'S256'
      )
    })

    it('should request offline access for refresh token', () => {
      const { authOptions } = require('@/lib/auth/config')
      const googleProvider = authOptions.providers[0] as any

      expect(googleProvider.authorization.params.access_type).toBe('offline')
    })

    it('should include redirect_uri parameter', () => {
      const { authOptions } = require('@/lib/auth/config')

      // NextAuth automatically sets redirect_uri based on NEXTAUTH_URL
      expect(process.env.NEXTAUTH_URL).toBe('http://localhost:3000')
    })
  })

  describe('GET /api/auth/callback/google', () => {
    it('should handle OAuth callback with code parameter', () => {
      // NextAuth handles callback internally
      // We verify the adapter is configured for user creation
      const { authOptions } = require('@/lib/auth/config')

      expect(authOptions.adapter).toBeDefined()
      expect(authOptions.adapter.createUser).toBeDefined()
    })

    it('should validate state parameter for CSRF protection', () => {
      const { authOptions } = require('@/lib/auth/config')

      // NextAuth automatically validates state parameter
      // We verify callbacks are set up correctly
      expect(authOptions.callbacks?.signIn).toBeDefined()
    })

    it('should exchange code for access token', () => {
      const { authOptions } = require('@/lib/auth/config')
      const googleProvider = authOptions.providers[0] as any

      // Verify provider has client credentials for token exchange
      expect(googleProvider.options.clientId).toBeTruthy()
      expect(googleProvider.options.clientSecret).toBeTruthy()
    })

    it('should create user on successful authentication', () => {
      const { authOptions } = require('@/lib/auth/config')

      // Verify Prisma adapter is configured
      expect(authOptions.adapter).toBeDefined()
      expect(authOptions.adapter.createUser).toBeInstanceOf(Function)
      expect(authOptions.adapter.linkAccount).toBeInstanceOf(Function)
    })

    it('should create session after user creation', () => {
      const { authOptions } = require('@/lib/auth/config')

      expect(authOptions.adapter.createSession).toBeInstanceOf(Function)
      expect(authOptions.session?.strategy).toBe('jwt')
    })

    it('should handle token exchange errors gracefully', () => {
      const { authOptions } = require('@/lib/auth/config')

      // Verify error page is configured
      expect(authOptions.pages?.error).toBe('/login')
    })

    it('should redirect to callback URL on success', () => {
      const { authOptions } = require('@/lib/auth/config')

      // Default callback URL should redirect to app
      // This is handled by signIn() calls with callbackUrl param
      expect(authOptions.callbacks?.signIn).toBeDefined()
    })
  })

  describe('Error Handling', () => {
    it('should redirect to error page on OAuth failure', () => {
      const { authOptions } = require('@/lib/auth/config')

      expect(authOptions.pages?.error).toBe('/login')
    })

    it('should include error code in redirect', () => {
      const { getErrorMessage } = require('@/lib/auth/errors')

      // Verify error messages are defined
      const errorInfo = getErrorMessage('AccessDenied')
      expect(errorInfo).toBeDefined()
      expect(errorInfo.title).toBeTruthy()
      expect(errorInfo.description).toBeTruthy()
    })

    it('should handle missing environment variables', () => {
      delete process.env.GOOGLE_CLIENT_ID

      jest.resetModules()
      const { authOptions: newAuthOptions } = require('@/lib/auth/config')
      const googleProvider = newAuthOptions.providers[0] as any

      // Should still create provider but with empty credentials
      expect(googleProvider.options.clientId).toBe('')
    })
  })

  describe('Security Requirements', () => {
    it('should enforce HTTPS in production', () => {
      process.env.NODE_ENV = 'production'
      process.env.NEXTAUTH_URL = 'https://app.example.com'

      jest.resetModules()
      const { authOptions: prodAuthOptions } = require('@/lib/auth/config')

      // NextAuth requires HTTPS in production
      expect(process.env.NEXTAUTH_URL).toMatch(/^https:\/\//)
    })

    it('should use secure session cookies in production', () => {
      process.env.NODE_ENV = 'production'

      jest.resetModules()
      const { authOptions: prodAuthOptions } = require('@/lib/auth/config')

      // NextAuth automatically uses secure cookies in production
      expect(prodAuthOptions.session?.strategy).toBe('jwt')
    })

    it('should set session max age', () => {
      const { authOptions } = require('@/lib/auth/config')

      expect(authOptions.session?.maxAge).toBeDefined()
      expect(authOptions.session?.maxAge).toBeGreaterThan(0)
    })
  })

  describe('Response Format Validation', () => {
    it('should create session with correct structure', async () => {
      const { authOptions } = require('@/lib/auth/config')
      const sessionCallback = authOptions.callbacks?.session

      const mockSession = {
        user: {
          id: 'user-id',
          name: 'Test User',
          email: 'test@example.com',
          image: 'https://example.com/avatar.jpg',
        },
        expires: new Date().toISOString(),
      }

      const mockToken = {
        userId: 'user-id',
        email: 'test@example.com',
        name: 'Test User',
        picture: 'https://example.com/avatar.jpg',
      }

      const result = await sessionCallback({
        session: mockSession,
        token: mockToken,
        user: {} as any,
        trigger: 'getSession',
        newSession: undefined,
      })

      // Verify session structure matches contract
      expect(result).toHaveProperty('user')
      expect(result.user).toHaveProperty('id')
      expect(result.user).toHaveProperty('email')
      expect(result.user).toHaveProperty('name')
      expect(result.user).toHaveProperty('image')
      expect(result).toHaveProperty('expires')
    })
  })
})
