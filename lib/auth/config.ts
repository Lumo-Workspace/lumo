import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { PrismaClient } from '@prisma/client'
import { authCallbacks } from './callbacks'
import {
  validateEnvironmentVariables,
  printEnvironmentSetup,
} from '@/lib/utils/env-validation'

// Validate environment variables at startup
const envValidation = validateEnvironmentVariables()
if (!envValidation.isValid) {
  console.error('❌ NextAuth configuration failed due to environment errors:')
  envValidation.errors.forEach(error => console.error(`   - ${error}`))
  printEnvironmentSetup()
  throw new Error('Invalid environment configuration. See errors above.')
}

if (envValidation.warnings.length > 0) {
  console.warn('⚠️  NextAuth configuration warnings:')
  envValidation.warnings.forEach(warning => console.warn(`   - ${warning}`))
}

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
