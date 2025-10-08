import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth/config'

/**
 * NextAuth.js API Route Handler
 *
 * Endpoints:
 * - GET  /api/auth/signin/google - Initiate Google OAuth flow
 * - GET  /api/auth/callback/google - OAuth callback handler
 * - POST /api/auth/signout - Sign out current user
 * - GET  /api/auth/session - Get current session
 * - GET  /api/auth/csrf - Get CSRF token
 *
 * @see specs/001-google/contracts/auth-api.yaml
 */

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
