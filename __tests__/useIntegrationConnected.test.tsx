import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useIntegrationConnected } from '@/app/workspace/[workspaceUrl]/hooks/useIntegrationConnected'
import { apiFetch } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'lumo' }),
}))

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
}))

const mockApiFetch = apiFetch as jest.Mock

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

beforeEach(() => jest.clearAllMocks())

describe('useIntegrationConnected', () => {
  it('reports connected when the workspace already has the integration', async () => {
    mockApiFetch.mockResolvedValue({ connected: true, slackTeamName: 'Lumo' })
    const { wrapper } = makeWrapper()

    const { result } = renderHook(() => useIntegrationConnected('slack'), {
      wrapper,
    })

    await waitFor(() => expect(result.current.connected).toBe(true))
    expect(result.current.loading).toBe(false)
  })

  it('reports not-connected only once the read has actually resolved', async () => {
    mockApiFetch.mockResolvedValue({ connected: false })
    const { wrapper } = makeWrapper()

    const { result } = renderHook(() => useIntegrationConnected('slack'), {
      wrapper,
    })

    // While in flight the answer is unknown — NOT false. Rendering "not
    // connected" off an in-flight read is the LUM-684 bug in miniature.
    expect(result.current.connected).toBeUndefined()

    await waitFor(() => expect(result.current.connected).toBe(false))
  })

  it('leaves connected undefined when the status read fails, never false', async () => {
    mockApiFetch.mockRejectedValue(new Error('network'))
    const { wrapper } = makeWrapper()

    const { result } = renderHook(() => useIntegrationConnected('slack'), {
      wrapper,
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.connected).toBeUndefined()
  })

  it('reads each integration from its own workspace endpoint', async () => {
    mockApiFetch.mockResolvedValue({ connected: true, installed: true })

    for (const [kind, expected] of [
      ['slack', '/api/slack/integration?workspaceUrl=lumo'],
      ['figma', '/api/figma/integration?workspaceUrl=lumo'],
      ['github', '/api/github/app/installation?workspaceUrl=lumo'],
    ] as const) {
      mockApiFetch.mockClear()
      const { wrapper } = makeWrapper()
      const { result } = renderHook(() => useIntegrationConnected(kind), {
        wrapper,
      })
      await waitFor(() => expect(result.current.connected).toBe(true))
      expect(mockApiFetch).toHaveBeenCalledWith(expected)
    }
  })

  it("maps the App installation's `installed` onto `connected` for github", async () => {
    mockApiFetch.mockResolvedValue({ installed: false })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useIntegrationConnected('github'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.connected).toBe(false))
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/github/app/installation?workspaceUrl=lumo'
    )
  })

  it('reads a connection made on the settings page straight from the shared cache', () => {
    mockApiFetch.mockResolvedValue({ connected: true, installed: true })
    const { qc, wrapper } = makeWrapper()
    // Seed the cache under the exact key the integrations settings page writes,
    // i.e. simulate the user having just connected Slack over there.
    qc.setQueryData(queryKeys.integrations.slack('lumo'), { connected: true })

    const { result } = renderHook(() => useIntegrationConnected('slack'), {
      wrapper,
    })

    // Synchronously on first render — no loading flash, and crucially no
    // window in which the surface would render "not connected".
    expect(result.current.connected).toBe(true)
    expect(result.current.loading).toBe(false)
  })

  it('points at the workspace integration settings, not an inline connect flow', () => {
    mockApiFetch.mockResolvedValue({ connected: false })
    const { wrapper } = makeWrapper()

    const { result } = renderHook(() => useIntegrationConnected('slack'), {
      wrapper,
    })

    expect(result.current.integrationsHref).toBe(
      '/workspace/lumo/settings/integrations'
    )
  })
})
