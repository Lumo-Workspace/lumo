// LUM-1026 — the client half of the @/lib/auth interface renders Clerk's
// provider / sign-in UI and hands its hooks through unchanged.
const mockSignOut = jest.fn()
const mockUseUser = jest.fn()
jest.mock('@clerk/nextjs', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='clerk-provider'>{children}</div>
  ),
  SignIn: () => <div data-testid='clerk-sign-in' />,
  useClerk: () => ({ signOut: mockSignOut }),
  useUser: () => mockUseUser(),
}))

import { render, renderHook, screen } from '@testing-library/react'
import { AuthProvider, SignIn, useSignOut, useUser } from '@/lib/auth/client'

beforeEach(() => jest.clearAllMocks())

describe('@/lib/auth/client', () => {
  it('AuthProvider mounts the provider around its children', () => {
    render(
      <AuthProvider>
        <span>inside</span>
      </AuthProvider>
    )
    expect(screen.getByTestId('clerk-provider')).toHaveTextContent('inside')
  })

  it('SignIn renders the provider sign-in UI', () => {
    render(<SignIn />)
    expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument()
  })

  it('useUser returns the provider hook result as-is', () => {
    const state = {
      isLoaded: true,
      isSignedIn: true,
      user: { id: 'u1', firstName: 'Ada' },
    }
    mockUseUser.mockReturnValue(state)
    const { result } = renderHook(() => useUser())
    expect(result.current).toBe(state)
  })

  it('useSignOut returns the provider signOut, forwarding options', async () => {
    mockSignOut.mockResolvedValue(undefined)
    const { result } = renderHook(() => useSignOut())
    await result.current({ redirectUrl: '/signin' })
    expect(mockSignOut).toHaveBeenCalledWith({ redirectUrl: '/signin' })
  })
})
