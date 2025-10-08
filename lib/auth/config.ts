import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { PrismaClient } from '@prisma/client'
import { authCallbacks } from './callbacks'

const prisma = new PrismaClient()

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile',
        },
      },
    }),
  ],
  session: {
    strategy: 'database',
    maxAge: 24 * 60 * 60, // 24 hours
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: authCallbacks || {},
  events: {
    async signIn({ user, account }) {
      // Log successful sign-ins for security monitoring
      console.log(`User ${user.email} signed in with ${account?.provider}`)
    },
    async signOut({ session }) {
      // Log sign-outs for security monitoring
      console.log(`User ${session?.user?.email} signed out`)
    },
  },
}
