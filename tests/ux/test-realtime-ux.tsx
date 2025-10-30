/**
 * UX flow validation test for real-time updates
 * Tests the user experience of real-time profile updates
 */

import { render, screen, waitFor } from '@testing-library/react'
import { useProfileUpdates } from '@/hooks/use-profile-updates'

// Mock the profile updates hook
jest.mock('@/hooks/use-profile-updates', () => ({
  useProfileUpdates: jest.fn(),
}))

const mockUseProfileUpdates = useProfileUpdates as jest.MockedFunction<
  typeof useProfileUpdates
>

// Mock component that uses real-time updates
const TeamMemberList = ({ userId }: { userId: string }) => {
  const { profile, isConnected, lastUpdate } = useProfileUpdates(userId)

  return (
    <div data-testid='team-member-list'>
      <div data-testid='connection-status'>
        {isConnected ? 'Connected' : 'Disconnected'}
      </div>
      <div data-testid='user-profile'>
        <span data-testid='display-name'>
          {profile?.displayName || 'Loading...'}
        </span>
        <img
          data-testid='avatar'
          src={profile?.avatarUrl || '/default-avatar.png'}
          alt='User avatar'
        />
      </div>
      {lastUpdate && (
        <div data-testid='last-update'>
          Last updated: {lastUpdate.toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}

describe('Real-time Updates UX Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should show loading state initially', () => {
    // Arrange
    mockUseProfileUpdates.mockReturnValue({
      profile: null,
      isConnected: false,
      lastUpdate: null,
      error: null,
      reconnect: jest.fn(),
    })

    // Act
    render(<TeamMemberList userId='user-123' />)

    // Assert
    expect(screen.getByTestId('connection-status')).toHaveTextContent(
      'Disconnected'
    )
    expect(screen.getByTestId('display-name')).toHaveTextContent('Loading...')
  })

  it('should show connected state when SSE connection is established', async () => {
    // Arrange
    mockUseProfileUpdates.mockReturnValue({
      profile: {
        id: 'user-123',
        displayName: 'John Doe',
        avatarUrl: 'https://example.com/avatar.jpg',
        email: 'john@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      isConnected: true,
      lastUpdate: new Date(),
      error: null,
      reconnect: jest.fn(),
    })

    // Act
    render(<TeamMemberList userId='user-123' />)

    // Assert
    expect(screen.getByTestId('connection-status')).toHaveTextContent(
      'Connected'
    )
    expect(screen.getByTestId('display-name')).toHaveTextContent('John Doe')
    expect(screen.getByTestId('avatar')).toHaveAttribute(
      'src',
      'https://example.com/avatar.jpg'
    )
    expect(screen.getByTestId('last-update')).toBeInTheDocument()
  })

  it('should update profile information in real-time', async () => {
    // Arrange - Initial state
    let mockProfile = {
      id: 'user-123',
      displayName: 'John Doe',
      avatarUrl: 'https://example.com/avatar.jpg',
      email: 'john@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    mockUseProfileUpdates.mockReturnValue({
      profile: mockProfile,
      isConnected: true,
      lastUpdate: new Date(),
      error: null,
      reconnect: jest.fn(),
    })

    // Act - Render initial state
    const { rerender } = render(<TeamMemberList userId='user-123' />)

    // Assert - Initial state
    expect(screen.getByTestId('display-name')).toHaveTextContent('John Doe')

    // Act - Simulate real-time update
    mockProfile = {
      ...mockProfile,
      displayName: 'John Smith',
      avatarUrl: 'https://example.com/new-avatar.jpg',
      updatedAt: new Date(),
    }

    mockUseProfileUpdates.mockReturnValue({
      profile: mockProfile,
      isConnected: true,
      lastUpdate: new Date(),
      error: null,
      reconnect: jest.fn(),
    })

    rerender(<TeamMemberList userId='user-123' />)

    // Assert - Updated state
    await waitFor(() => {
      expect(screen.getByTestId('display-name')).toHaveTextContent('John Smith')
    })
    expect(screen.getByTestId('avatar')).toHaveAttribute(
      'src',
      'https://example.com/new-avatar.jpg'
    )
  })

  it('should handle connection errors gracefully', () => {
    // Arrange
    mockUseProfileUpdates.mockReturnValue({
      profile: null,
      isConnected: false,
      lastUpdate: null,
      error: 'Connection failed',
      reconnect: jest.fn(),
    })

    // Act
    render(<TeamMemberList userId='user-123' />)

    // Assert
    expect(screen.getByTestId('connection-status')).toHaveTextContent(
      'Disconnected'
    )
    expect(screen.getByTestId('display-name')).toHaveTextContent('Loading...')
  })

  it('should show default avatar when no avatar is set', () => {
    // Arrange
    mockUseProfileUpdates.mockReturnValue({
      profile: {
        id: 'user-123',
        displayName: 'John Doe',
        avatarUrl: null,
        email: 'john@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      isConnected: true,
      lastUpdate: new Date(),
      error: null,
      reconnect: jest.fn(),
    })

    // Act
    render(<TeamMemberList userId='user-123' />)

    // Assert
    expect(screen.getByTestId('avatar')).toHaveAttribute(
      'src',
      '/default-avatar.png'
    )
  })

  it('should handle multiple users updating simultaneously', async () => {
    // Arrange - Multiple team members
    const users = [
      { id: 'user-1', name: 'Alice', avatar: 'https://example.com/alice.jpg' },
      { id: 'user-2', name: 'Bob', avatar: 'https://example.com/bob.jpg' },
      {
        id: 'user-3',
        name: 'Charlie',
        avatar: 'https://example.com/charlie.jpg',
      },
    ]

    const TeamMemberGrid = () => (
      <div data-testid='team-grid'>
        {users.map(user => (
          <TeamMemberList key={user.id} userId={user.id} />
        ))}
      </div>
    )

    // Mock different profiles for each user
    mockUseProfileUpdates.mockImplementation(userId => {
      const user = users.find(u => u.id === userId)
      return {
        profile: {
          id: userId,
          displayName: user?.name || 'Unknown',
          avatarUrl: user?.avatar || null,
          email: `${user?.name.toLowerCase()}@example.com`,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        isConnected: true,
        lastUpdate: new Date(),
        error: null,
        reconnect: jest.fn(),
      }
    })

    // Act
    render(<TeamMemberGrid />)

    // Assert - All users should be displayed
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Charlie')).toBeInTheDocument()

    // All should show connected status
    const connectionStatuses = screen.getAllByTestId('connection-status')
    connectionStatuses.forEach(status => {
      expect(status).toHaveTextContent('Connected')
    })
  })

  it('should provide visual feedback for real-time updates', async () => {
    // Arrange
    let mockProfile = {
      id: 'user-123',
      displayName: 'John Doe',
      avatarUrl: 'https://example.com/avatar.jpg',
      email: 'john@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    mockUseProfileUpdates.mockReturnValue({
      profile: mockProfile,
      isConnected: true,
      lastUpdate: new Date(),
      error: null,
      reconnect: jest.fn(),
    })

    // Act
    const { rerender } = render(<TeamMemberList userId='user-123' />)

    // Assert - Initial state
    expect(screen.getByTestId('display-name')).toHaveTextContent('John Doe')

    // Act - Simulate real-time update with timestamp
    const updateTime = new Date()
    mockProfile = {
      ...mockProfile,
      displayName: 'John Smith',
      updatedAt: updateTime,
    }

    mockUseProfileUpdates.mockReturnValue({
      profile: mockProfile,
      isConnected: true,
      lastUpdate: updateTime,
      error: null,
      reconnect: jest.fn(),
    })

    rerender(<TeamMemberList userId='user-123' />)

    // Assert - Update should be reflected
    await waitFor(() => {
      expect(screen.getByTestId('display-name')).toHaveTextContent('John Smith')
    })

    // Last update time should be shown
    expect(screen.getByTestId('last-update')).toHaveTextContent(
      `Last updated: ${updateTime.toLocaleTimeString()}`
    )
  })

  it('should handle rapid successive updates', async () => {
    // Arrange
    let updateCount = 0
    let mockProfile = {
      id: 'user-123',
      displayName: 'Initial Name',
      avatarUrl: 'https://example.com/avatar.jpg',
      email: 'john@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    mockUseProfileUpdates.mockReturnValue({
      profile: mockProfile,
      isConnected: true,
      lastUpdate: new Date(),
      error: null,
      reconnect: jest.fn(),
    })

    // Act
    const { rerender } = render(<TeamMemberList userId='user-123' />)

    // Simulate rapid successive updates
    const updates = ['Update 1', 'Update 2', 'Update 3', 'Final Update']

    for (const updateName of updates) {
      mockProfile = {
        ...mockProfile,
        displayName: updateName,
        updatedAt: new Date(),
      }

      mockUseProfileUpdates.mockReturnValue({
        profile: mockProfile,
        isConnected: true,
        lastUpdate: new Date(),
        error: null,
        reconnect: jest.fn(),
      })

      rerender(<TeamMemberList userId='user-123' />)
      updateCount++
    }

    // Assert - Should show the final update
    await waitFor(() => {
      expect(screen.getByTestId('display-name')).toHaveTextContent(
        'Final Update'
      )
    })
  })
})
