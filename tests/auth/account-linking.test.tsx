import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useSession } from 'next-auth/react'
import AccountLinking from '@/components/auth/account-linking'

// Mock next-auth/react
jest.mock('next-auth/react')
const mockUseSession = useSession as jest.MockedFunction<typeof useSession>

// Mock fetch for API calls
global.fetch = jest.fn()

describe('Account Linking Component', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(global.fetch as jest.Mock).mockClear()
  })

  it('should render account linking button for unlinked users', () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user_123',
          email: 'existing@example.com',
          name: 'Existing User',
        },
      },
      status: 'authenticated',
    })

    render(<AccountLinking />)

    expect(screen.getByText('Link Google Account')).toBeInTheDocument()
    expect(
      screen.getByText('Connect your Google account for easier sign-in')
    ).toBeInTheDocument()
  })

  it('should display linked status for users with Google account', () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user_123',
          email: 'existing@example.com',
          name: 'Existing User',
        },
        accounts: [
          {
            provider: 'google',
            type: 'oauth',
            providerAccountId: 'google_123',
          },
        ],
      },
      status: 'authenticated',
    })

    render(<AccountLinking />)

    expect(screen.getByText('Google Account Linked')).toBeInTheDocument()
    expect(screen.getByText('Connected to google_123')).toBeInTheDocument()
    expect(screen.getByText('Unlink Account')).toBeInTheDocument()
  })

  it('should handle account linking flow', async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user_123',
          email: 'existing@example.com',
          name: 'Existing User',
        },
      },
      status: 'authenticated',
    })
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    })

    render(<AccountLinking />)

    const linkButton = screen.getByText('Link Google Account')
    fireEvent.click(linkButton)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/account/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google' }),
      })
    })
  })

  it('should handle account unlinking flow', async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user_123',
          email: 'existing@example.com',
          name: 'Existing User',
        },
        accounts: [
          {
            provider: 'google',
            type: 'oauth',
            providerAccountId: 'google_123',
          },
        ],
      },
      status: 'authenticated',
    })
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    })

    render(<AccountLinking />)

    const unlinkButton = screen.getByText('Unlink Account')
    fireEvent.click(unlinkButton)

    // Should show confirmation dialog
    expect(screen.getByText('Confirm Account Unlinking')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Are you sure you want to unlink your Google account? You will need to use your email and password to sign in.'
      )
    ).toBeInTheDocument()

    const confirmButton = screen.getByText('Yes, Unlink Account')
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/account/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google' }),
      })
    })
  })

  it('should handle linking errors gracefully', async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user_123',
          email: 'existing@example.com',
          name: 'Existing User',
        },
      },
      status: 'authenticated',
    })
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Account already linked' }),
    })

    render(<AccountLinking />)

    const linkButton = screen.getByText('Link Google Account')
    fireEvent.click(linkButton)

    await waitFor(() => {
      expect(
        screen.getByText('Error: Account already linked')
      ).toBeInTheDocument()
    })
  })

  it('should handle unlinking errors gracefully', async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user_123',
          email: 'existing@example.com',
          name: 'Existing User',
        },
        accounts: [
          {
            provider: 'google',
            type: 'oauth',
            providerAccountId: 'google_123',
          },
        ],
      },
      status: 'authenticated',
    })
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Cannot unlink last authentication method' }),
    })

    render(<AccountLinking />)

    const unlinkButton = screen.getByText('Unlink Account')
    fireEvent.click(unlinkButton)

    const confirmButton = screen.getByText('Yes, Unlink Account')
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(
        screen.getByText('Error: Cannot unlink last authentication method')
      ).toBeInTheDocument()
    })
  })

  it('should show loading states during API calls', async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user_123',
          email: 'existing@example.com',
          name: 'Existing User',
        },
      },
      status: 'authenticated',
    })

    // Mock a slow API response
    ;(global.fetch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise(resolve =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: async () => ({ success: true }),
              }),
            100
          )
        )
    )

    render(<AccountLinking />)

    const linkButton = screen.getByText('Link Google Account')
    fireEvent.click(linkButton)

    // Should show loading state
    expect(screen.getByText('Linking...')).toBeInTheDocument()
    expect(linkButton).toBeDisabled()

    await waitFor(() => {
      expect(screen.queryByText('Linking...')).not.toBeInTheDocument()
    })
  })

  it('should be accessible with proper ARIA labels', () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user_123',
          email: 'existing@example.com',
          name: 'Existing User',
        },
      },
      status: 'authenticated',
    })

    render(<AccountLinking />)

    const linkButton = screen.getByRole('button', {
      name: 'Link your Google account for easier sign-in',
    })
    expect(linkButton).toHaveAttribute(
      'aria-label',
      'Link your Google account for easier sign-in'
    )
  })

  it('should support keyboard navigation', () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user_123',
          email: 'existing@example.com',
          name: 'Existing User',
        },
      },
      status: 'authenticated',
    })

    render(<AccountLinking />)

    const linkButton = screen.getByText('Link Google Account')
    linkButton.focus()

    expect(document.activeElement).toBe(linkButton)

    // Test keyboard interaction by clicking (simulating Enter key)
    fireEvent.click(linkButton)
    expect(global.fetch).toHaveBeenCalled()
  })
})
