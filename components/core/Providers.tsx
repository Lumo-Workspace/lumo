'use client'

/**
 * Client-side Providers
 *
 * Wraps the app with necessary context providers
 * - ClerkProvider for authentication
 */

import { ClerkProvider } from '@clerk/nextjs'

interface ProvidersProps {
  children: React.ReactNode
}

export function Providers({ children }: ProvidersProps) {
  return <ClerkProvider>{children}</ClerkProvider>
}
