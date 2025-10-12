'use client'

/**
 * Client-side Providers
 *
 * Wraps the app with necessary context providers
 * - SessionProvider for NextAuth
 */

import { SessionProvider } from 'next-auth/react'
import type { Session } from 'next-auth'

interface ProvidersProps {
  children: React.ReactNode
  session?: Session | null
}

export function Providers({ children, session }: ProvidersProps) {
  return (
    <SessionProvider {...(session !== undefined && { session })}>
      {children}
    </SessionProvider>
  )
}
