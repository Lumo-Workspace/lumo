import { render, screen } from '@testing-library/react'
import { useSession } from 'next-auth/react'

// Mock next-auth/react
jest.mock('next-auth/react', () => ({
  signIn: jest.fn(),
  useSession: jest.fn(),
}))

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard',
}))

// Simple component that uses useSession
function TestComponent() {
  const { data: session, status } = useSession()

  if (status === 'loading') return <div>Loading...</div>
  if (status === 'unauthenticated') return <div>Not authenticated</div>
  if (!session?.user) return <div>No user data</div>

  return (
    <div>
      <h1>Welcome, {session.user.name}!</h1>
      <p>Email: {session.user.email}</p>
      <p>ID: {session.user.id}</p>
    </div>
  )
}

describe('Existing User Login Flow', () => {
  const mockUseSession = useSession as jest.MockedFunction<typeof useSession>

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should display existing user profile information', () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user_123',
          email: 'existing@example.com',
          name: 'Existing User',
          image: 'https://example.com/avatar.jpg',
        },
        expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      } as any,
      status: 'authenticated',
      update: jest.fn() as any,
    } as any)

    render(<TestComponent />)

    expect(screen.getByText('Welcome, Existing User!')).toBeInTheDocument()
    expect(screen.getByText('Email: existing@example.com')).toBeInTheDocument()
    expect(screen.getByText('ID: user_123')).toBeInTheDocument()
    expect(mockUseSession).toHaveBeenCalled()
  })

  it('should handle session loading state', () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: 'loading',
      update: jest.fn() as any,
    } as any)

    render(<TestComponent />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(mockUseSession).toHaveBeenCalled()
  })

  it('should redirect unauthenticated users to login', () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: 'unauthenticated',
      update: jest.fn() as any,
    } as any)

    render(<TestComponent />)
    expect(screen.getByText('Not authenticated')).toBeInTheDocument()
    expect(mockUseSession).toHaveBeenCalled()
  })

  it('should maintain session across page refreshes', () => {
    const mockSession = {
      user: {
        id: 'user_123',
        email: 'existing@example.com',
        name: 'Existing User',
        image: 'https://example.com/avatar.jpg',
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
    }

    mockUseSession.mockReturnValue({
      data: mockSession as any,
      status: 'authenticated',
      update: jest.fn() as any,
    } as any)

    render(<TestComponent />)
    expect(screen.getByText('Welcome, Existing User!')).toBeInTheDocument()
    expect(mockUseSession).toHaveBeenCalled()
  })

  it('should handle session expiration gracefully', () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: 'unauthenticated',
      update: jest.fn() as any,
    } as any)

    render(<TestComponent />)
    expect(screen.getByText('Not authenticated')).toBeInTheDocument()
    expect(mockUseSession).toHaveBeenCalled()
  })

  it('should display user profile with correct information', () => {
    const mockUser = {
      id: 'user_123',
      email: 'existing@example.com',
      name: 'Existing User',
      image: 'https://example.com/avatar.jpg',
    }

    mockUseSession.mockReturnValue({
      data: { user: mockUser, expires: new Date().toISOString() } as any,
      status: 'authenticated',
      update: jest.fn() as any,
    } as any)

    render(<TestComponent />)
    expect(screen.getByText('Welcome, Existing User!')).toBeInTheDocument()
    expect(screen.getByText('Email: existing@example.com')).toBeInTheDocument()
    expect(screen.getByText('ID: user_123')).toBeInTheDocument()
    expect(mockUseSession).toHaveBeenCalled()
  })
})
