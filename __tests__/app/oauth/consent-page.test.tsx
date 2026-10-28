// LUM-1044 — /oauth/consent is the consent screen of this instance's MCP
// OAuth authorization server; with Clerk gone (LUM-1077) it always renders.
const mockNotFound = jest.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
jest.mock('next/navigation', () => ({ notFound: () => mockNotFound() }))
jest.mock('@/lib/auth/client', () => ({
  OAuthConsent: () => <div data-testid='consent' />,
}))

import { render, screen } from '@testing-library/react'
import OAuthConsentPage from '@/app/oauth/consent/page'

const saved = process.env.AUTH_PROVIDER
afterAll(() => {
  if (saved === undefined) delete process.env.AUTH_PROVIDER
  else process.env.AUTH_PROVIDER = saved
})

describe('/oauth/consent page', () => {
  it('renders the consent screen under Better Auth', () => {
    process.env.AUTH_PROVIDER = 'better-auth'
    render(<OAuthConsentPage />)
    expect(screen.getByTestId('consent')).toBeTruthy()
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  it('renders with AUTH_PROVIDER unset too', () => {
    delete process.env.AUTH_PROVIDER
    render(<OAuthConsentPage />)
    expect(screen.getAllByTestId('consent').length).toBeGreaterThan(0)
  })
})
