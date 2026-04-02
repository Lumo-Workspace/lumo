'use client'

/**
 * Client-side Providers
 *
 * Wraps the app with necessary context providers
 * - ClerkProvider for authentication
 * - ThemeProvider for dark/light mode via next-themes
 */

import { ClerkProvider } from '@clerk/nextjs'
import { ThemeProvider } from 'next-themes'

interface ProvidersProps {
  children: React.ReactNode
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ClerkProvider>
      <ThemeProvider attribute='class' defaultTheme='system' enableSystem>
        {children}
      </ThemeProvider>
    </ClerkProvider>
  )
}
