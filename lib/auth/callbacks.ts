import { NextAuthOptions } from 'next-auth'
import { JWT } from 'next-auth/jwt'
import { Session } from 'next-auth'
import { createGoogleUser } from './user-creation'
import { AuthLogger } from '@/lib/utils/logger'

export const authCallbacks: NextAuthOptions['callbacks'] = {
  async signIn({ user, account, profile }) {
    try {
      // Log sign-in attempt
      AuthLogger.logSignIn(
        user.id,
        user.email || '',
        account?.provider || 'unknown'
        // IP and user agent would be available in request context
      )

      // Handle Google OAuth specifically
      if (account?.provider === 'google' && profile) {
        const googleProfile: any = {
          sub: (profile as any).sub || (profile as any).id || '',
          email: profile.email || '',
          email_verified: (profile as any).email_verified || false,
        }

        // Add optional properties only if they exist
        if (profile.name) googleProfile.name = profile.name
        if ((profile as any).given_name)
          googleProfile.given_name = (profile as any).given_name
        if ((profile as any).family_name)
          googleProfile.family_name = (profile as any).family_name
        if ((profile as any).picture)
          googleProfile.picture = (profile as any).picture
        if ((profile as any).locale)
          googleProfile.locale = (profile as any).locale

        // Create or find user
        await createGoogleUser(googleProfile)
      }

      return true
    } catch (error) {
      console.error('Sign-in callback error:', error)

      // Log failed sign-in
      AuthLogger.logSignInFailure(
        user.email || '',
        error instanceof Error ? error.message : 'Unknown error'
      )

      return false
    }
  },

  async redirect({ url, baseUrl }) {
    // Allows relative callback URLs
    if (url.startsWith('/')) return `${baseUrl}${url}`
    // Allows callback URLs on the same origin
    else if (new URL(url).origin === baseUrl) return url
    return baseUrl
  },

  async session({ session, token }: { session: Session; token: JWT }) {
    if (session?.user && token?.user) {
      ;(session.user as any).id = (token.user as any).id
      session.user.name = (token.user as any).name || session.user.name
      session.user.image = (token.user as any).image || session.user.image
    }
    return session
  },

  async jwt({
    token,
    user,
    account,
  }: {
    token: JWT
    user?: any
    account?: any
  }) {
    // Initial sign in
    if (account && user) {
      return {
        ...token,
        accessToken: account.access_token,
        refreshToken: account.refresh_token,
        accessTokenExpires: account.expires_at ? account.expires_at * 1000 : 0,
        user: {
          id: user.id,
          email: user.email ?? null,
          name: user.name ?? null,
          image: user.image ?? null,
        },
      }
    }

    // Return previous token if the access token has not expired yet
    if (Date.now() < (token.accessTokenExpires as number)) {
      return token
    }

    // Access token has expired, try to update it
    return await refreshAccessToken(token)
  },
}

/**
 * Refreshes the access token using the refresh token
 */
async function refreshAccessToken(token: JWT) {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken as string,
      }),
    })

    const refreshedTokens = await response.json()

    if (!response.ok) {
      throw refreshedTokens
    }

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken, // Fall back to old refresh token
    }
  } catch (error) {
    console.error('Error refreshing access token:', error)

    return {
      ...token,
      error: 'RefreshAccessTokenError',
    }
  }
}
