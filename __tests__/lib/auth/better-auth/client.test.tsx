// LUM-1027 — the Better Auth client half of @/lib/auth/client: hooks mapped
// onto the provider-neutral contract, sign-out, and the sign-in form, all
// reached through <AuthProvider provider='better-auth'> (the dispatcher).
const mockUseSession = jest.fn()
const mockSignOut = jest.fn()
const mockSignInEmail = jest.fn()
const mockSignUpEmail = jest.fn()
const mockSignInSocial = jest.fn()
const mockFetch = jest.fn()
jest.mock('@/lib/auth/better-auth/auth-client', () => ({
  getAuthClient: () => ({
    useSession: () => mockUseSession(),
    signOut: (...a: unknown[]) => mockSignOut(...a),
    signIn: {
      email: (...a: unknown[]) => mockSignInEmail(...a),
      social: (...a: unknown[]) => mockSignInSocial(...a),
    },
    signUp: { email: (...a: unknown[]) => mockSignUpEmail(...a) },
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
// Message ids render as-is (with {provider} filled) so assertions are exact.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, v?: Record<string, string>) =>
      v?.provider ? `${id}:${v.provider}` : id,
  }),
}))
const mockSearchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { AuthProvider, SignIn, useSignOut, useUser } from '@/lib/auth/client'

const wrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider provider='better-auth'>{children}</AuthProvider>
)

beforeEach(() => {
  jest.clearAllMocks()
  mockSearchParams.delete('redirect_url')
  mockFetch.mockResolvedValue({
    data: { socialProviders: ['github'], signUpEnabled: true },
  })
})

describe('useUser (Better Auth)', () => {
  it('pending → not loaded', () => {
    mockUseSession.mockReturnValue({
      data: null,
      isPending: true,
      refetch: jest.fn(),
    })
    const { result } = renderHook(() => useUser(), { wrapper })
    expect(result.current).toEqual({
      isLoaded: false,
      isSignedIn: undefined,
      user: undefined,
    })
  })

  it('no session → signed out', () => {
    mockUseSession.mockReturnValue({
      data: null,
      isPending: false,
      refetch: jest.fn(),
    })
    const { result } = renderHook(() => useUser(), { wrapper })
    expect(result.current).toEqual({
      isLoaded: true,
      isSignedIn: false,
      user: null,
    })
  })

  it('session → AuthClientUser; reload bypasses the cookie cache', async () => {
    const refetch = jest.fn(async () => undefined)
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'u1',
          name: 'Ada Lovelace',
          email: 'ada@x.io',
          image: null,
          firstName: 'Ada',
          lastName: 'Lovelace',
        },
      },
      isPending: false,
      refetch,
    })
    const { result } = renderHook(() => useUser(), { wrapper })
    expect(result.current).toMatchObject({
      isLoaded: true,
      isSignedIn: true,
      user: {
        id: 'u1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        imageUrl: '',
        emailAddresses: [{ emailAddress: 'ada@x.io' }],
      },
    })
    await result.current.user!.reload()
    expect(refetch).toHaveBeenCalledWith({
      query: { disableCookieCache: true },
    })
  })
})

describe('useSignOut (Better Auth)', () => {
  it('ends the session, then navigates (default /)', async () => {
    mockSignOut.mockResolvedValue({})
    const { result } = renderHook(() => useSignOut(), { wrapper })
    await result.current({ redirectUrl: '/signin' })
    expect(mockSignOut).toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenLastCalledWith('/signin')
    await result.current()
    expect(mockNavigate).toHaveBeenLastCalledWith('/')
  })
})

describe('SignIn (Better Auth)', () => {
  const renderForm = async () => {
    render(<SignIn />, { wrapper })
    await screen.findByText('auth.signIn.title')
    await screen.findByText('auth.oauth.continueWith:GitHub')
  }

  it('signs in with email + password and goes to the requested page', async () => {
    mockSearchParams.set('redirect_url', '/workspace/acme')
    mockSignInEmail.mockResolvedValue({ data: {}, error: null })
    await renderForm()
    fireEvent.change(screen.getByLabelText('auth.field.email'), {
      target: { value: ' ada@x.io ' },
    })
    fireEvent.change(screen.getByLabelText('auth.field.password'), {
      target: { value: 'correct horse' },
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'auth.signIn.submit' })
      )
    })
    expect(mockSignInEmail).toHaveBeenCalledWith({
      email: 'ada@x.io',
      password: 'correct horse',
    })
    expect(mockNavigate).toHaveBeenCalledWith('/workspace/acme')
  })

  it('continues an MCP OAuth authorization after sign-in (LUM-1044)', async () => {
    // The server answers a sign-in that carried the signed OAuth request with
    // where to go next (consent page or the client); that wins over the target.
    mockSignInEmail.mockResolvedValue({
      data: { redirect: true, url: '/oauth/consent?client_id=c&sig=s' },
      error: null,
    })
    await renderForm()
    fireEvent.change(screen.getByLabelText('auth.field.email'), {
      target: { value: 'ada@x.io' },
    })
    fireEvent.change(screen.getByLabelText('auth.field.password'), {
      target: { value: 'correct horse' },
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'auth.signIn.submit' })
      )
    })
    expect(mockNavigate).toHaveBeenCalledWith(
      '/oauth/consent?client_id=c&sig=s'
    )
  })

  it('shows the mapped error and stays on the page', async () => {
    mockSignInEmail.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_EMAIL_OR_PASSWORD' },
    })
    await renderForm()
    fireEvent.change(screen.getByLabelText('auth.field.email'), {
      target: { value: 'ada@x.io' },
    })
    fireEvent.change(screen.getByLabelText('auth.field.password'), {
      target: { value: 'wrong-password' },
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'auth.signIn.submit' })
      )
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'auth.error.invalidCredentials'
    )
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('a network failure re-enables the form with the generic error', async () => {
    mockSignInEmail.mockRejectedValue(new TypeError('Failed to fetch'))
    await renderForm()
    fireEvent.change(screen.getByLabelText('auth.field.email'), {
      target: { value: 'ada@x.io' },
    })
    fireEvent.change(screen.getByLabelText('auth.field.password'), {
      target: { value: 'whatever-123' },
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'auth.signIn.submit' })
      )
    })
    expect(screen.getByRole('alert')).toHaveTextContent('auth.error.generic')
    expect(
      screen.getByRole('button', { name: 'auth.signIn.submit' })
    ).toBeEnabled()
  })

  it('switches to sign-up and creates the account with a name', async () => {
    mockSignUpEmail.mockResolvedValue({ data: {}, error: null })
    await renderForm()
    fireEvent.click(screen.getByText('auth.signIn.switchToSignUp'))
    expect(screen.getByText('auth.signUp.title')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('auth.field.name'), {
      target: { value: 'Ada Lovelace' },
    })
    fireEvent.change(screen.getByLabelText('auth.field.email'), {
      target: { value: 'ada@x.io' },
    })
    fireEvent.change(screen.getByLabelText('auth.field.password'), {
      target: { value: 'long-enough-1' },
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'auth.signUp.submit' })
      )
    })
    expect(mockSignUpEmail).toHaveBeenCalledWith({
      name: 'Ada Lovelace',
      email: 'ada@x.io',
      password: 'long-enough-1',
    })
    expect(mockNavigate).toHaveBeenCalledWith('/workspace')
  })

  it('hides sign-up when the instance disabled it', async () => {
    mockFetch.mockResolvedValue({
      data: { socialProviders: [], signUpEnabled: false },
    })
    render(<SignIn />, { wrapper })
    await screen.findByText('auth.signIn.title')
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(screen.queryByText('auth.signIn.switchToSignUp')).toBeNull()
    expect(screen.queryByText(/auth.oauth.continueWith/)).toBeNull()
  })

  it('OAuth buttons start the provider flow back to the target', async () => {
    mockSignInSocial.mockResolvedValue({ data: {}, error: null })
    await renderForm()
    await act(async () => {
      fireEvent.click(screen.getByText('auth.oauth.continueWith:GitHub'))
    })
    expect(mockSignInSocial).toHaveBeenCalledWith({
      provider: 'github',
      callbackURL: '/workspace',
    })
  })
})
