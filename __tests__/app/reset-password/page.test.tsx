// LUM-1070 — /reset-password exists while password sign-in is on; a 404
// when the instance turned it off (AUTH_DISABLE_PASSWORD, LUM-1082).
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

  it('is a 404 when password sign-in is off', () => {
    const savedFlag = process.env.AUTH_DISABLE_PASSWORD
    process.env.AUTH_DISABLE_PASSWORD = 'true'
    try {
      expect(() => render(<ResetPasswordPage />)).toThrow('NEXT_NOT_FOUND')
    } finally {
      if (savedFlag === undefined) delete process.env.AUTH_DISABLE_PASSWORD
      else process.env.AUTH_DISABLE_PASSWORD = savedFlag
    }
  })
})
