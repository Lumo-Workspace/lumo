'use client'

/**
 * Client-side Providers
 *
 * - AuthProvider (Clerk) for authentication
 * - ThemeProvider for dark/light mode via next-themes
 * - QueryClientProvider for TanStack Query (data fetching, caching, mutations)
 */

import { AuthProvider } from '@/lib/auth/client'
import { ThemeProvider } from 'next-themes'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { getQueryClient } from '@/lib/query/client'
import { IntlProviderWrapper } from '@/lib/i18n/IntlProviderWrapper'

interface ProvidersProps {
  children: React.ReactNode
}

export function Providers({ children }: ProvidersProps) {
  const queryClient = getQueryClient()
  return (
    <AuthProvider>
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
