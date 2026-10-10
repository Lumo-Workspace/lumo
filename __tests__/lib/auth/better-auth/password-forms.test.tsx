// LUM-1070 — the Better Auth password UI: /reset-password (request a link,
// then set the new password) and the profile page's change-password slot,
// reached through @/lib/auth/client. Under Clerk the slot renders nothing.
const mockRequestPasswordReset = jest.fn()
const mockResetPassword = jest.fn()
const mockChangePassword = jest.fn()
const mockListAccounts = jest.fn()
jest.mock('@/lib/auth/better-auth/auth-client', () => ({
  getAuthClient: () => ({
    requestPasswordReset: (...a: unknown[]) => mockRequestPasswordReset(...a),
    resetPassword: (...a: unknown[]) => mockResetPassword(...a),
    changePassword: (...a: unknown[]) => mockChangePassword(...a),
    listAccounts: (...a: unknown[]) => mockListAccounts(...a),
  }),
}))
jest.mock('@clerk/nextjs', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='clerk-provider'>{children}</div>
  ),
  SignIn: () => <div data-testid='clerk-sign-in' />,
  useClerk: () => ({ signOut: jest.fn() }),
  useUser: () => ({ isLoaded: false }),
}))
jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))
const mockToastSuccess = jest.fn()
jest.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => mockToastSuccess(...a) },
}))
const mockSearchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  AuthProvider,
  PasswordSettings,
  ResetPassword,
} from '@/lib/auth/client'

const baWrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider provider='better-auth'>{children}</AuthProvider>
)

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

const submit = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  for (const k of ['token', 'error']) mockSearchParams.delete(k)
})

describe('ResetPassword — request a link (LUM-1070)', () => {
  it('sends the reset request back to /reset-password and confirms neutrally', async () => {
    mockRequestPasswordReset.mockResolvedValue({ data: {}, error: null })
    render(<ResetPassword />)
    await screen.findByText('auth.resetPassword.request.title')
    type('auth.field.email', ' ada@x.io ')
    await submit('auth.resetPassword.request.submit')
    expect(mockRequestPasswordReset).toHaveBeenCalledWith({
      email: 'ada@x.io',
      redirectTo: '/reset-password',
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      'auth.resetPassword.request.sent'
    )
    expect(
      screen.getByRole('link', { name: 'auth.resetPassword.backToSignIn' })
    ).toHaveAttribute('href', '/signin')
  })

  it('a rate-limited request says to wait', async () => {
    mockRequestPasswordReset.mockResolvedValue({
      data: null,
      error: { status: 429 },
    })
    render(<ResetPassword />)
    await screen.findByText('auth.resetPassword.request.title')
    type('auth.field.email', 'ada@x.io')
    await submit('auth.resetPassword.request.submit')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'auth.error.tooManyRequests'
    )
  })

  it('an expired link (?error=INVALID_TOKEN) explains it above the form', async () => {
    mockSearchParams.set('error', 'INVALID_TOKEN')
    render(<ResetPassword />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'auth.resetPassword.invalidToken'
    )
    expect(
      screen.getByRole('button', { name: 'auth.resetPassword.request.submit' })
    ).toBeInTheDocument()
  })
})

describe('ResetPassword — set the new password (LUM-1070)', () => {
  beforeEach(() => mockSearchParams.set('token', 'tok_123'))

  it('posts the new password with the token, then says to sign in', async () => {
    mockResetPassword.mockResolvedValue({ data: { status: true }, error: null })
    render(<ResetPassword />)
    await screen.findByText('auth.resetPassword.set.title')
    type('auth.field.newPassword', 'brand-new-pass')
    type('auth.field.confirmPassword', 'brand-new-pass')
    await submit('auth.resetPassword.set.submit')
    expect(mockResetPassword).toHaveBeenCalledWith({
      newPassword: 'brand-new-pass',
      token: 'tok_123',
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      'auth.resetPassword.set.done'
    )
  })

  it('refuses mismatched passwords without calling the server', async () => {
    render(<ResetPassword />)
    await screen.findByText('auth.resetPassword.set.title')
    type('auth.field.newPassword', 'brand-new-pass')
    type('auth.field.confirmPassword', 'brand-new-pasS')
    await submit('auth.resetPassword.set.submit')
    expect(mockResetPassword).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'auth.error.passwordMismatch'
    )
  })

  it('an already-used token shows the invalid-link message', async () => {
    mockResetPassword.mockResolvedValue({
      data: null,
      error: { status: 400, code: 'INVALID_TOKEN' },
    })
    render(<ResetPassword />)
    await screen.findByText('auth.resetPassword.set.title')
    type('auth.field.newPassword', 'brand-new-pass')
    type('auth.field.confirmPassword', 'brand-new-pass')
    await submit('auth.resetPassword.set.submit')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'auth.resetPassword.invalidToken'
    )
  })
})

describe('PasswordSettings (LUM-1070)', () => {
  it('renders nothing under Clerk (profile page unchanged)', () => {
    const { container } = render(
      <AuthProvider provider='clerk'>
        <div data-testid='slot'>
          <PasswordSettings />
        </div>
      </AuthProvider>
    )
    expect(screen.getByTestId('slot')).toBeEmptyDOMElement()
    expect(container.querySelector('form')).toBeNull()
    expect(mockListAccounts).not.toHaveBeenCalled()
  })

  it('Better Auth: changes the password and signs out other sessions', async () => {
    mockListAccounts.mockResolvedValue({
      data: [{ providerId: 'credential' }],
    })
    mockChangePassword.mockResolvedValue({ data: {}, error: null })
    render(<PasswordSettings />, { wrapper: baWrapper })
    await screen.findByText('profile.password.title')
    await screen.findByRole('button', { name: 'profile.password.submit' })
    type('auth.field.currentPassword', 'old-password')
    type('auth.field.newPassword', 'brand-new-pass')
    type('auth.field.confirmPassword', 'brand-new-pass')
    await submit('profile.password.submit')
    expect(mockChangePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password',
      newPassword: 'brand-new-pass',
      revokeOtherSessions: true,
    })
    expect(mockToastSuccess).toHaveBeenCalledWith('profile.password.changed')
  })

  it('Better Auth: a wrong current password is said so', async () => {
    mockListAccounts.mockResolvedValue({
      data: [{ providerId: 'credential' }],
    })
    mockChangePassword.mockResolvedValue({
      data: null,
      error: { status: 400, code: 'INVALID_PASSWORD' },
    })
    render(<PasswordSettings />, { wrapper: baWrapper })
    await screen.findByText('profile.password.title')
    type('auth.field.currentPassword', 'wrong-password')
    type('auth.field.newPassword', 'brand-new-pass')
    type('auth.field.confirmPassword', 'brand-new-pass')
    await submit('profile.password.submit')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'profile.password.currentIncorrect'
    )
  })

  it('Better Auth: a social-only account is pointed to forgot password', async () => {
    mockListAccounts.mockResolvedValue({ data: [{ providerId: 'github' }] })
    render(<PasswordSettings />, { wrapper: baWrapper })
    expect(
      await screen.findByText('profile.password.noPassword')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'profile.password.submit' })
    ).toBeNull()
  })
})
