/**
 * NextAuth Configuration Unit Tests
 *
 * Tests NextAuth.js configuration setup
 *
 * Requirements:
 * - SR-001: Google OAuth provider configured correctly
 * - SR-005: JWT session strategy
 * - SR-014: Session expiration (24 hours default)
 */

import { authOptions } from '@/lib/auth/config'

describe('NextAuth Configuration', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
    process.env.NEXTAUTH_URL = 'http://localhost:3000'
    process.env.NEXTAUTH_SECRET = 'test-secret-key-at-least-32-chars-long'
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from(
      'test-encryption-key-32-bytes!!'
    ).toString('base64')
    process.env.SESSION_MAX_AGE_HOURS = '24'
    process.env.MAX_CONCURRENT_SESSIONS = '3'
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('Provider Configuration', () => {
    it('should configure Google OAuth provider', () => {
      expect(authOptions.providers).toHaveLength(1)
      expect(authOptions.providers[0]).toHaveProperty('id', 'google')
    })

    it('should request correct OAuth scopes', () => {
      const googleProvider = authOptions.providers[0] as any
      const authParams = googleProvider.authorization?.params

      expect(authParams.scope).toBe('openid email profile')
    })

    it('should enable PKCE (code_challenge_method: S256)', () => {
      const googleProvider = authOptions.providers[0] as any
      const authParams = googleProvider.authorization?.params

      expect(authParams.code_challenge_method).toBe('S256')
    })

    it('should request offline access for refresh tokens', () => {
      const googleProvider = authOptions.providers[0] as any
      const authParams = googleProvider.authorization?.params

      expect(authParams.access_type).toBe('offline')
    })

    it('should force consent prompt on first login', () => {
      const googleProvider = authOptions.providers[0] as any
      const authParams = googleProvider.authorization?.params

      expect(authParams.prompt).toBe('consent')
    })
  })

  describe('Session Configuration', () => {
    it('should use JWT session strategy', () => {
      expect(authOptions.session?.strategy).toBe('jwt')
    })

    it('should set session max age to 24 hours by default', () => {
      const expectedSeconds = 24 * 60 * 60 // 24 hours in seconds
      expect(authOptions.session?.maxAge).toBe(expectedSeconds)
    })

    it('should respect SESSION_MAX_AGE_HOURS environment variable', () => {
      process.env.SESSION_MAX_AGE_HOURS = '48'

      // Re-import to get new config with updated env
      jest.resetModules()
      const { authOptions: newAuthOptions } = require('@/lib/auth/config')

      const expectedSeconds = 48 * 60 * 60
      expect(newAuthOptions.session?.maxAge).toBe(expectedSeconds)
    })
  })

  describe('JWT Configuration', () => {
    it('should set JWT max age to match session max age', () => {
      expect(authOptions.jwt?.maxAge).toBe(authOptions.session?.maxAge)
    })
  })

  describe('Custom Pages', () => {
    it('should set custom sign in page to /login', () => {
      expect(authOptions.pages?.signIn).toBe('/login')
    })

    it('should redirect errors to /login', () => {
      expect(authOptions.pages?.error).toBe('/login')
    })
  })

  describe('Callbacks', () => {
    it('should define jwt callback', () => {
      expect(authOptions.callbacks?.jwt).toBeDefined()
      expect(typeof authOptions.callbacks?.jwt).toBe('function')
    })

    it('should define session callback', () => {
      expect(authOptions.callbacks?.session).toBeDefined()
      expect(typeof authOptions.callbacks?.session).toBe('function')
    })

    it('should define signIn callback', () => {
      expect(authOptions.callbacks?.signIn).toBeDefined()
      expect(typeof authOptions.callbacks?.signIn).toBe('function')
    })
  })

  describe('Events', () => {
    it('should define signIn event handler', () => {
      expect(authOptions.events?.signIn).toBeDefined()
      expect(typeof authOptions.events?.signIn).toBe('function')
    })

    it('should define signOut event handler', () => {
      expect(authOptions.events?.signOut).toBeDefined()
      expect(typeof authOptions.events?.signOut).toBe('function')
    })
  })

  describe('Adapter', () => {
    it('should use Prisma adapter', () => {
      expect(authOptions.adapter).toBeDefined()
      // Prisma adapter has specific methods
      expect(authOptions.adapter).toHaveProperty('createUser')
      expect(authOptions.adapter).toHaveProperty('getUser')
      expect(authOptions.adapter).toHaveProperty('createSession')
    })
  })

  describe('Debug Mode', () => {
    it('should enable debug in development', () => {
      process.env.NODE_ENV = 'development'
      jest.resetModules()
      const { authOptions: devAuthOptions } = require('@/lib/auth/config')

      expect(devAuthOptions.debug).toBe(true)
    })

    it('should disable debug in production', () => {
      process.env.NODE_ENV = 'production'
      jest.resetModules()
      const { authOptions: prodAuthOptions } = require('@/lib/auth/config')

      expect(prodAuthOptions.debug).toBe(false)
    })
  })
})
