// LUM-1070 — /reset-password exists only under Better Auth; under Clerk
// (production today) the route stays a 404.
const mockNotFound = jest.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
jest.mock('next/navigation', () => ({ notFound: () => mockNotFound() }))
jest.mock('@/lib/auth/client', () => ({
  ResetPassword: () => <div data-testid='reset' />,
}))

import { render, screen } from '@testing-library/react'
import ResetPasswordPage from '@/app/reset-password/page'

const saved = process.env.AUTH_PROVIDER
afterAll(() => {
  if (saved === undefined) delete process.env.AUTH_PROVIDER
  else process.env.AUTH_PROVIDER = saved
})

describe('/reset-password page (LUM-1070)', () => {
  it('renders the reset flow under Better Auth', () => {
    process.env.AUTH_PROVIDER = 'better-auth'
    render(<ResetPasswordPage />)
    expect(screen.getByTestId('reset')).toBeTruthy()
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  it('is a 404 under Clerk', () => {
    delete process.env.AUTH_PROVIDER
    expect(() => render(<ResetPasswordPage />)).toThrow('NEXT_NOT_FOUND')
  })
})
