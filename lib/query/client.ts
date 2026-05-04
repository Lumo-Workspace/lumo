import { QueryClient, isServer } from '@tanstack/react-query'

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  })
}

let browserClient: QueryClient | undefined

export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient()
  if (!browserClient) browserClient = makeQueryClient()
  return browserClient
}
