// LUM-1082 — the Better Auth sign-in page aligned with Clerk's: provider
// marks on the social buttons, email-first one-time-code sign-in, and the
// password form only when the instance keeps password sign-in on. Reached
// through <AuthProvider provider='better-auth'> like the real page.
const mockSendOtp = jest.fn()
const mockSignInEmailOtp = jest.fn()
const mockSignInEmail = jest.fn()
const mockSignInSocial = jest.fn()
const mockFetch = jest.fn()
jest.mock('@/lib/auth/better-auth/auth-client', () => ({
  getAuthClient: () => ({
    signIn: {
      email: (...a: unknown[]) => mockSignInEmail(...a),
      social: (...a: unknown[]) => mockSignInSocial(...a),
      emailOtp: (...a: unknown[]) => mockSignInEmailOtp(...a),
    },
    emailOtp: {
      sendVerificationOtp: (...a: unknown[]) => mockSendOtp(...a),
    },
    $fetch: (...a: unknown[]) => mockFetch(...a),
  }),
}))
const mockNavigate = jest.fn()
jest.mock('@/lib/auth/better-auth/navigate', () => ({
  hardNavigate: (url: string) => mockNavigate(url),
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
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, v?: Record<string, string>) =>
      v ? `${id}:${Object.values(v).join(',')}` : id,
  }),
}))
const mockSearchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AuthProvider, SignIn } from '@/lib/auth/client'

const baWrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider provider='better-auth'>{children}</AuthProvider>
)

/** The hosted SaaS: Google + email codes, password off. */
const SAAS = {
  socialProviders: ['google'],
  signUpEnabled: true,
  passwordEnabled: false,
  emailCodeEnabled: true,
}

async function renderWith(config: Record<string, unknown>) {
  mockFetch.mockResolvedValue({ data: config })
  render(<SignIn />, { wrapper: baWrapper })
  await screen.findByText('auth.signIn.title')
  // Every configuration renders an email field once the options load.
  await screen.findByLabelText('auth.field.email')
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

const click = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

async function reachCodeStep(email = 'ada@x.io') {
  mockSendOtp.mockResolvedValue({ data: { success: true }, error: null })
  type('auth.field.email', email)
  await click('auth.emailCode.continue')
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSearchParams.delete('redirect_url')
  mockSearchParams.delete('error')
})

describe('sign-in page options (LUM-1082)', () => {
  it('SaaS default: Google (with its mark) + email code, no password field', async () => {
    await renderWith(SAAS)
    const google = screen.getByRole('button', {
      name: 'auth.oauth.continueWith:Google',
    })
    expect(
      google.querySelector('[data-testid="social-icon-google"] svg')
    ).not.toBeNull()
    expect(screen.getByLabelText('auth.field.email')).toBeInTheDocument()
    expect(screen.queryByLabelText('auth.field.password')).toBeNull()
    expect(screen.queryByText('auth.emailCode.usePassword')).toBeNull()
    expect(screen.queryByText('auth.signIn.forgotPassword')).toBeNull()
    expect(screen.queryByText('auth.signIn.switchToSignUp')).toBeNull()
  })

  it('the GitHub button carries its mark too', async () => {
    await renderWith({ ...SAAS, socialProviders: ['github', 'google'] })
    expect(
      screen
        .getByRole('button', { name: 'auth.oauth.continueWith:GitHub' })
        .querySelector('svg')
    ).not.toBeNull()
  })

  it('password switch on: the code comes first, the password form one click away', async () => {
    await renderWith({ ...SAAS, passwordEnabled: true })
    expect(screen.queryByLabelText('auth.field.password')).toBeNull()
    await click('auth.emailCode.usePassword')
    expect(screen.getByLabelText('auth.field.password')).toBeInTheDocument()
    expect(screen.getByText('auth.signIn.forgotPassword')).toBeInTheDocument()
    await click('auth.emailCode.useCode')
    expect(screen.queryByLabelText('auth.field.password')).toBeNull()
  })

  it('no email transport (code off) + password on: the password form alone, as before', async () => {
    await renderWith({
      ...SAAS,
      passwordEnabled: true,
      emailCodeEnabled: false,
    })
    expect(screen.getByLabelText('auth.field.password')).toBeInTheDocument()
    expect(screen.queryByText('auth.emailCode.useCode')).toBeNull()
    expect(screen.getByText('auth.signIn.switchToSignUp')).toBeInTheDocument()
  })

  it('the options request failing falls back to the password form', async () => {
    await renderWith(null as unknown as Record<string, unknown>)
    expect(screen.getByLabelText('auth.field.password')).toBeInTheDocument()
  })

  it('an older server without the flags keeps the password form', async () => {
    await renderWith({ socialProviders: [], signUpEnabled: true })
    expect(screen.getByLabelText('auth.field.password')).toBeInTheDocument()
    expect(screen.queryByText('auth.emailCode.continue')).toBeNull()
  })
})

describe('email code flow (LUM-1082)', () => {
  it('sends a code, then signs in with it and goes to the requested page', async () => {
    mockSearchParams.set('redirect_url', '/workspace/acme')
    await renderWith(SAAS)
    await reachCodeStep(' ada@x.io ')
    expect(mockSendOtp).toHaveBeenCalledWith({
      email: 'ada@x.io',
      type: 'sign-in',
    })
    expect(screen.getByText('auth.emailCode.sentTo:ada@x.io')).toBeVisible()
    // The social buttons step aside on the code step.
    expect(screen.queryByText('auth.oauth.continueWith:Google')).toBeNull()

    mockSignInEmailOtp.mockResolvedValue({ data: {}, error: null })
    // Non-digits are dropped; 6 digits max.
    type('auth.field.code', '12 34-567')
    expect(screen.getByLabelText('auth.field.code')).toHaveValue('123456')
    await click('auth.emailCode.verify')
    expect(mockSignInEmailOtp).toHaveBeenCalledWith({
      email: 'ada@x.io',
      otp: '123456',
    })
    expect(mockNavigate).toHaveBeenCalledWith('/workspace/acme')
  })

  it('continues an MCP OAuth authorization after the code sign-in', async () => {
    await renderWith(SAAS)
    await reachCodeStep()
    mockSignInEmailOtp.mockResolvedValue({
      data: { redirect: true, url: '/oauth/consent?client_id=c&sig=s' },
      error: null,
    })
    type('auth.field.code', '123456')
    await click('auth.emailCode.verify')
    expect(mockNavigate).toHaveBeenCalledWith(
      '/oauth/consent?client_id=c&sig=s'
    )
  })

  it.each([
    ['INVALID_OTP', 400, 'auth.error.invalidCode'],
    ['OTP_EXPIRED', 400, 'auth.error.codeExpired'],
    ['TOO_MANY_ATTEMPTS', 403, 'auth.error.tooManyCodeAttempts'],
    [undefined, 429, 'auth.error.tooManyRequests'],
  ])('a %s (%i) answer shows %s and stays', async (code, status, message) => {
    await renderWith(SAAS)
    await reachCodeStep()
    mockSignInEmailOtp.mockResolvedValue({
      data: null,
      error: { code, status },
    })
    type('auth.field.code', '000000')
    await click('auth.emailCode.verify')
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(screen.getByLabelText('auth.field.code')).toBeEnabled()
  })

  it('a rate-limited send stays on the email step with the wait message', async () => {
    await renderWith(SAAS)
    mockSendOtp.mockResolvedValue({
      data: null,
      error: { status: 429, message: 'Too many requests.' },
    })
    type('auth.field.email', 'ada@x.io')
    await click('auth.emailCode.continue')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'auth.error.tooManyRequests'
    )
    expect(screen.queryByLabelText('auth.field.code')).toBeNull()
  })

  it('a network failure on send shows the generic error', async () => {
    await renderWith(SAAS)
    mockSendOtp.mockRejectedValue(new Error('offline'))
    type('auth.field.email', 'ada@x.io')
    await click('auth.emailCode.continue')
    expect(screen.getByRole('alert')).toHaveTextContent('auth.error.generic')
  })

  it('resend sends again and says so; "use a different email" goes back', async () => {
    await renderWith(SAAS)
    await reachCodeStep()
    await click('auth.emailCode.resend')
    expect(mockSendOtp).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status')).toHaveTextContent(
      'auth.emailCode.resent'
    )
    await click('auth.emailCode.changeEmail')
    expect(screen.getByLabelText('auth.field.email')).toHaveValue('ada@x.io')
    expect(
      screen.getByRole('button', { name: 'auth.oauth.continueWith:Google' })
    ).toBeInTheDocument()
  })
})

describe('Clerk mode is unchanged (LUM-1082)', () => {
  it('renders Clerk sign-in and never asks the Better Auth config', async () => {
    render(<SignIn />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AuthProvider provider='clerk'>{children}</AuthProvider>
      ),
    })
    expect(await screen.findByTestId('clerk-sign-in')).toBeInTheDocument()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('auth.field.email')).toBeNull()
  })
})
