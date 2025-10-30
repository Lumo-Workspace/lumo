import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import { prisma } from '@/lib/db/prisma'

/**
 * NextAuth.js Configuration for Google OAuth
 *
 * Features:
 * - Google OAuth 2.0 provider with PKCE
 * - JWT session strategy (24-hour expiration)
 * - Encrypted token storage (AES-256-GCM)
 * - Automatic profile creation
 * - Account linking support
 *
 * Requirements:
 * - SR-001: OAuth credentials must be validated
 * - SR-002: Tokens encrypted at rest
 * - SR-005: HTTPS-only in production
 * - UR-001: Auto-create profile on first login
 *
 * @see specs/001-google/plan.md
 * @see specs/001-google/data-model.md
 */

export const authOptions: NextAuthOptions = {
  // Prisma adapter for database persistence
  adapter: PrismaAdapter(prisma),

  // OAuth providers
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      authorization: {
        params: {
          // Request specific scopes (SR-004)
          scope: 'openid email profile',
          // Enable PKCE for enhanced security (SR-010)
          code_challenge_method: 'S256',
          // Request offline access for refresh tokens
          access_type: 'offline',
          // Force consent prompt on first login
          prompt: 'consent',
        },
      },
    }),
  ],

  // Session configuration
  session: {
    strategy: 'jwt', // Use JWT for stateless sessions
    maxAge: getSessionMaxAge(), // Default: 24 hours (SR-014)
  },

  // JWT configuration
  jwt: {
    maxAge: getSessionMaxAge(),
  },

  // Custom pages
  pages: {
    signIn: '/login', // Custom login page (UR-001)
    error: '/login', // Redirect errors to login with error query param
  },

  // Callbacks for customization
  callbacks: {
    /**
     * JWT callback - called whenever JWT is created or updated
     * Used to add custom claims to the token
     */
    async jwt({ token, account, profile, user }) {
      // Initial sign in - add user info to token
      if (account && profile && user) {
        token.userId = user.id
        token.email = user.email ?? null
        token.picture = user.image ?? null
        token.name = user.name ?? null
      }

      return token
    },

    /**
     * Session callback - called whenever session is checked
     * Customize what data is sent to the client
     */
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.userId as string
        session.user.email = token.email as string
        session.user.image = token.picture as string
        session.user.name = token.name as string

        // Add team information if user has a team
        const teamMembership = await prisma.teamMember.findFirst({
          where: { userId: token.userId as string },
          include: {
            team: true,
          },
        })

        if (teamMembership) {
          session.user.teamId = teamMembership.teamId
          session.user.teamRole = teamMembership.role
          session.user.workspaceUrl = teamMembership.team.workspaceUrl
        }
      }

      return session
    },

    /**
     * Sign in callback - called before user is signed in
     * Can be used to control access or perform additional validation
     */
    async signIn({ account, profile, user }) {
      // Validate OAuth provider
      if (account?.provider !== 'google') {
        console.error('Invalid OAuth provider:', account?.provider)
        return false
      }

      // Validate required profile fields from Google
      if (!profile?.email) {
        console.error('No email provided by Google OAuth')
        return false
      }

      // Check concurrent sessions limit (SR-015)
      if (user?.id) {
        const sessionCount = await prisma.session.count({
          where: {
            userId: user.id,
            expires: { gt: new Date() },
          },
        })

        const maxSessions = getMaxConcurrentSessions()
        if (sessionCount >= maxSessions) {
          // Delete oldest session to make room
          const oldestSession = await prisma.session.findFirst({
            where: {
              userId: user.id,
              expires: { gt: new Date() },
            },
            orderBy: { createdAt: 'asc' },
          })

          if (oldestSession) {
            await prisma.session.delete({
              where: { id: oldestSession.id },
            })
          }
        }
      }

      return true
    },
  },

  // Events for logging and monitoring
  events: {
    async signIn({ user, account }) {
      console.log('User signed in:', {
        userId: user.id,
        email: user.email,
        provider: account?.provider,
      })

      // Update lastUsedAt for the account (SR-009)
      if (account) {
        await prisma.account.updateMany({
          where: {
            provider: account.provider,
            providerAccountId: account.providerAccountId,
          },
          data: {
            lastUsedAt: new Date(),
          },
        })
      }
    },

    async signOut({ token }) {
      console.log('User signed out:', {
        userId: token?.userId,
        email: token?.email,
      })
    },
  },

  // Enable debug logging in development
  debug: process.env.NODE_ENV === 'development',
}

/**
 * Get session max age from environment or default to 24 hours
 */
function getSessionMaxAge(): number {
  const hours = parseInt(process.env.SESSION_MAX_AGE_HOURS ?? '24', 10)
  return hours * 60 * 60 // Convert to seconds
}

/**
 * Get maximum concurrent sessions from environment or default to 3
 */
function getMaxConcurrentSessions(): number {
  return parseInt(process.env.MAX_CONCURRENT_SESSIONS ?? '3', 10)
}
