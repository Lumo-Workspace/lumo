/**
 * Contract tests for Avatar Remove API endpoint
 * Tests the API contract for DELETE /api/profile/avatar
 */

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/db/prisma'
import { deleteAvatar } from '@/lib/storage/blob'
import { triggerProfileUpdate } from '@/lib/realtime/events'

// Mock dependencies
jest.mock('next-auth')
jest.mock('@/lib/db/prisma')
jest.mock('@/lib/storage/blob')
jest.mock('@/lib/realtime/events')

const mockGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>
const mockPrisma = prisma as jest.Mocked<typeof prisma>
const mockDeleteAvatar = deleteAvatar as jest.MockedFunction<
  typeof deleteAvatar
>
const mockTriggerProfileUpdate = triggerProfileUpdate as jest.MockedFunction<
  typeof triggerProfileUpdate
>

describe('DELETE /api/profile/avatar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return 401 when user is not authenticated', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue(null)

    // Act
    const { DELETE } = await import('@/app/api/profile/avatar/route')
    const response = await DELETE()

    // Assert
    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('should remove avatar successfully', async () => {
    // Arrange
    const mockUser = {
      id: 'user-123',
      displayName: 'John Doe',
      avatarUrl: null,
      avatarBlobId: null,
      email: 'john@example.com',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    }

    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)
    ;(mockPrisma.user.update as jest.Mock).mockResolvedValue(mockUser as any)

    // Act
    const { DELETE } = await import('@/app/api/profile/avatar/route')
    const response = await DELETE()

    // Assert
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.avatarUrl).toBeNull()
    expect(data.avatarBlobId).toBeNull()

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-123' },
      data: { avatarUrl: null, avatarBlobId: null },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        avatarBlobId: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    expect(mockTriggerProfileUpdate).toHaveBeenCalledWith('user-123', {
      avatarUrl: null,
    })
  })

  it('should delete existing avatar from blob storage', async () => {
    // Arrange
    const mockUserWithAvatar = {
      id: 'user-123',
      displayName: 'John Doe',
      avatarUrl:
        'https://blob.vercel-storage.com/avatars/user-123-1234567890.jpg',
      avatarBlobId: 'avatars/user-123-1234567890.jpg',
      email: 'john@example.com',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    }

    const mockUserWithoutAvatar = {
      ...mockUserWithAvatar,
      avatarUrl: null,
      avatarBlobId: null,
    }

    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    // Mock finding user with avatar first
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValueOnce(
      mockUserWithAvatar as any
    )
    // Mock updating user to remove avatar
    ;(mockPrisma.user.update as jest.Mock).mockResolvedValueOnce(
      mockUserWithoutAvatar as any
    )

    // Act
    const { DELETE } = await import('@/app/api/profile/avatar/route')
    const response = await DELETE()

    // Assert
    expect(response.status).toBe(200)
    expect(mockDeleteAvatar).toHaveBeenCalledWith(
      'avatars/user-123-1234567890.jpg'
    )
  })

  it('should handle user without existing avatar', async () => {
    // Arrange
    const mockUserWithoutAvatar = {
      id: 'user-123',
      displayName: 'John Doe',
      avatarUrl: null,
      avatarBlobId: null,
      email: 'john@example.com',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    }

    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValueOnce(
      mockUserWithoutAvatar as any
    )
    ;(mockPrisma.user.update as jest.Mock).mockResolvedValueOnce(
      mockUserWithoutAvatar as any
    )

    // Act
    const { DELETE } = await import('@/app/api/profile/avatar/route')
    const response = await DELETE()

    // Assert
    expect(response.status).toBe(200)
    expect(mockDeleteAvatar).not.toHaveBeenCalled() // No blob to delete
  })

  it('should return 500 when database update fails', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)
    ;(mockPrisma.user.update as jest.Mock).mockRejectedValue(
      new Error('Database error')
    )

    // Act
    const { DELETE } = await import('@/app/api/profile/avatar/route')
    const response = await DELETE()

    // Assert
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Failed to remove avatar')
  })

  it('should handle blob deletion failure gracefully', async () => {
    // Arrange
    const mockUserWithAvatar = {
      id: 'user-123',
      displayName: 'John Doe',
      avatarUrl:
        'https://blob.vercel-storage.com/avatars/user-123-1234567890.jpg',
      avatarBlobId: 'avatars/user-123-1234567890.jpg',
      email: 'john@example.com',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    }

    const mockUserWithoutAvatar = {
      ...mockUserWithAvatar,
      avatarUrl: null,
      avatarBlobId: null,
    }

    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValueOnce(
      mockUserWithAvatar as any
    )
    ;(mockPrisma.user.update as jest.Mock).mockResolvedValueOnce(
      mockUserWithoutAvatar as any
    )
    ;(mockDeleteAvatar as jest.Mock).mockRejectedValue(
      new Error('Blob deletion failed')
    )

    // Act
    const { DELETE } = await import('@/app/api/profile/avatar/route')
    const response = await DELETE()

    // Assert
    expect(response.status).toBe(200) // Should still succeed even if blob deletion fails
    expect(mockDeleteAvatar).toHaveBeenCalledWith(
      'avatars/user-123-1234567890.jpg'
    )
  })

  it('should trigger real-time update after successful removal', async () => {
    // Arrange
    const mockUser = {
      id: 'user-123',
      displayName: 'John Doe',
      avatarUrl: null,
      avatarBlobId: null,
      email: 'john@example.com',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    }

    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)
    ;(mockPrisma.user.update as jest.Mock).mockResolvedValue(mockUser as any)

    // Act
    const { DELETE } = await import('@/app/api/profile/avatar/route')
    const response = await DELETE()

    // Assert
    expect(response.status).toBe(200)
    expect(mockTriggerProfileUpdate).toHaveBeenCalledWith('user-123', {
      avatarUrl: null,
    })
  })
})
