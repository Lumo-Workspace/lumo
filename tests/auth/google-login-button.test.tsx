import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { GoogleLoginButton } from '@/components/auth/google-login-button'
import { signIn } from 'next-auth/react'

// Mock next-auth/react
jest.mock('next-auth/react', () => ({
  signIn: jest.fn(),
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}))

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
}))

describe('GoogleLoginButton', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders Google login button with correct text', () => {
    render(<GoogleLoginButton />)

    const button = screen.getByRole('button', { name: /sign in with google/i })
    expect(button).toBeInTheDocument()
  })

  it('has minimum height of 44px for accessibility', () => {
    render(<GoogleLoginButton />)

    const button = screen.getByRole('button', { name: /sign in with google/i })
    expect(button).toHaveClass('min-h-[44px]')
    expect(button).toHaveClass('h-[44px]')
  })

  it('calls signIn with Google provider when clicked', async () => {
    const mockSignIn = signIn as jest.MockedFunction<typeof signIn>
    mockSignIn.mockResolvedValue({
      ok: true,
      error: null,
      status: 200,
      url: null,
    })

    render(<GoogleLoginButton />)

    const button = screen.getByRole('button', { name: /sign in with google/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith('google', {
        callbackUrl: '/dashboard',
        redirect: true,
      })
    })
  })

  it('shows loading state while authenticating', async () => {
    const mockSignIn = signIn as jest.MockedFunction<typeof signIn>
    mockSignIn.mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 100))
    )

    render(<GoogleLoginButton />)

    const button = screen.getByRole('button', { name: /sign in with google/i })
    fireEvent.click(button)

    expect(screen.getByText(/signing in/i)).toBeInTheDocument()
    expect(button).toBeDisabled()
  })

  it('handles authentication errors gracefully', async () => {
    const mockSignIn = signIn as jest.MockedFunction<typeof signIn>
    mockSignIn.mockResolvedValue({
      ok: false,
      error: 'OAuthSignin',
      status: 400,
      url: null,
    })

    render(<GoogleLoginButton />)

    const button = screen.getByRole('button', { name: /sign in with google/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText(/error occurred/i)).toBeInTheDocument()
    })
  })

  it('is keyboard accessible', () => {
    render(<GoogleLoginButton />)

    const button = screen.getByRole('button', { name: /sign in with google/i })
    button.focus()

    expect(button).toHaveFocus()

    // Test keyboard activation
    fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' })
    expect(signIn).toHaveBeenCalled()
  })

  it('supports screen reader with proper aria labels', () => {
    render(<GoogleLoginButton />)

    const button = screen.getByRole('button', { name: /sign in with google/i })
    expect(button).toHaveAttribute('aria-label', 'Sign in with Google')
  })
})
