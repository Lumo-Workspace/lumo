'use client'

/**
 * Client-side Providers
 *
 * - AuthProvider (Clerk or Better Auth, per AUTH_PROVIDER) for authentication
 * - ThemeProvider for dark/light mode via next-themes
 * - QueryClientProvider for TanStack Query (data fetching, caching, mutations)
 */

import { AuthProvider, type AuthProviderName } from '@/lib/auth/client'
import { ThemeProvider } from 'next-themes'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { getQueryClient } from '@/lib/query/client'
import { IntlProviderWrapper } from '@/lib/i18n/IntlProviderWrapper'

interface ProvidersProps {
  /** Resolved on the server from AUTH_PROVIDER; Clerk when omitted. */
  authProvider?: AuthProviderName | undefined
  children: React.ReactNode
}

export function Providers({ authProvider, children }: ProvidersProps) {
  const queryClient = getQueryClient()
  return (
    <AuthProvider provider={authProvider}>
      <ThemeProvider attribute='class' defaultTheme='system' enableSystem>
        <QueryClientProvider client={queryClient}>
          <IntlProviderWrapper locale='en'>{children}</IntlProviderWrapper>
          {process.env.NODE_ENV === 'development' && (
            <ReactQueryDevtools initialIsOpen={false} />
          )}
        </QueryClientProvider>
      </ThemeProvider>
    </AuthProvider>
  )
}
