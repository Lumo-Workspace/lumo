// LUM-1044 — the MCP OAuth consent screen (/oauth/consent) under Better Auth:
// shows the client's name, the requested scopes, the signed-in user and the
// return host; Allow / Deny post the decision and follow the answer.
const mockUseSession = jest.fn()
const mockFetch = jest.fn()
jest.mock('@/lib/auth/better-auth/auth-client', () => ({
  getAuthClient: () => ({
    useSession: () => mockUseSession(),
    $fetch: (...a: unknown[]) => mockFetch(...a),
  }),
}))
const mockNavigate = jest.fn()
jest.mock('@/lib/auth/better-auth/navigate', () => ({
  hardNavigate: (url: string) => mockNavigate(url),
}))
// Message ids render with their values so assertions are exact.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, v?: Record<string, string>) =>
      v ? `${id}:${Object.values(v).join('|')}` : id,
  }),
}))
let mockSearch = ''
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

import { act, fireEvent, render, screen } from '@testing-library/react'
import { OAuthConsent } from '@/lib/auth/better-auth/consent-form'

const SIGNED =
  'client_id=cid&redirect_uri=http%3A%2F%2Flocalhost%3A6274%2Foauth%2Fcallback' +
  '&scope=mcp+offline_access&state=s&exp=1&sig=xyz'

beforeEach(() => {
  jest.clearAllMocks()
  mockSearch = SIGNED
  mockUseSession.mockReturnValue({ data: { user: { email: 'ada@x.io' } } })
  mockFetch.mockImplementation(async (path: string) =>
    path === '/oauth2/public-client'
      ? { data: { client_id: 'cid', client_name: 'MCP Inspector' } }
      : {
          data: {
            redirect: true,
            url: 'http://localhost:6274/oauth/callback?code=c',
          },
        }
  )
})

async function renderConsent() {
  render(<OAuthConsent />)
  await screen.findByText('oauth.consent.title:MCP Inspector')
}

describe('OAuthConsent', () => {
  it('shows who asks, for what, as whom, and where the browser returns', async () => {
    await renderConsent()
    expect(mockFetch).toHaveBeenCalledWith('/oauth2/public-client', {
      method: 'GET',
      query: { client_id: 'cid' },
    })
    expect(
      screen.getByText('oauth.consent.subtitle:MCP Inspector')
    ).toBeTruthy()
    expect(screen.getByText('oauth.consent.signedInAs:ada@x.io')).toBeTruthy()
    expect(screen.getByText('oauth.consent.scope.mcp')).toBeTruthy()
    expect(screen.getByText('oauth.consent.scope.offlineAccess')).toBeTruthy()
    expect(
      screen.getByText('oauth.consent.redirectNotice:localhost:6274')
    ).toBeTruthy()
  })

  it('shows an unknown scope by its raw name', async () => {
    mockSearch = SIGNED.replace('scope=mcp+offline_access', 'scope=mcp+weird')
    await renderConsent()
    expect(
      document.querySelector('[data-scope="weird"]')?.textContent
    ).toContain('weird')
  })

  it('falls back to the client id when the client has no name', async () => {
    mockFetch.mockResolvedValueOnce({ data: { client_id: 'cid' } })
    render(<OAuthConsent />)
    await screen.findByText('oauth.consent.title:cid')
  })

  it.each([
    ['Allow', 'oauth.consent.allow', true],
    ['Deny', 'oauth.consent.deny', false],
  ])(
    '%s posts the decision and follows the redirect',
    async (_n, label, accept) => {
      await renderConsent()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: label }))
      })
      expect(mockFetch).toHaveBeenCalledWith('/oauth2/consent', {
        method: 'POST',
        body: { accept },
      })
      expect(mockNavigate).toHaveBeenCalledWith(
        'http://localhost:6274/oauth/callback?code=c'
      )
    }
  )

  it('shows an error and re-enables the buttons when the decision fails', async () => {
    await renderConsent()
    mockFetch.mockResolvedValueOnce({ data: null, error: { status: 400 } })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'oauth.consent.allow' })
      )
    })
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('auth.error.generic')
    expect(
      (
        screen.getByRole('button', {
          name: 'oauth.consent.allow',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  })

  it('an unsigned or incomplete request shows only the invalid-request message', () => {
    mockSearch = 'client_id=cid'
    render(<OAuthConsent />)
    expect(screen.getByRole('alert').textContent).toBe('oauth.consent.invalid')
    expect(screen.queryByRole('button')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
