// LUM-1044 — /oauth/consent exists only for the self-hosted (Better Auth)
// authorization server; under Clerk the route is a 404.
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

  it('is a 404 under Clerk', () => {
    delete process.env.AUTH_PROVIDER
    expect(() => render(<OAuthConsentPage />)).toThrow('NEXT_NOT_FOUND')
  })
})
