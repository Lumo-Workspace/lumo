/**
 * Contract tests for Profile API endpoints
 * Tests the API contract for GET /api/profile
 */

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/db/prisma'

// Mock dependencies
jest.mock('next-auth')
jest.mock('@/lib/db/prisma')

const mockGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>
const mockPrisma = prisma as jest.Mocked<typeof prisma>

describe('GET /api/profile', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return 401 when user is not authenticated', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue(null)

    // Act
    const { GET } = await import('@/app/api/profile/route')
    const response = await GET()

    // Assert
    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('should return user profile when authenticated', async () => {
    // Arrange
    const mockUser = {
      id: 'user-123',
      displayName: 'John Doe',
      avatarUrl: 'https://example.com/avatar.jpg',
      avatarBlobId: 'blob-123',
      email: 'john@example.com',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    }

    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(
      mockUser as any
    )

    // Act
    const { GET } = await import('@/app/api/profile/route')
    const response = await GET()

    // Assert
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({
      id: 'user-123',
      displayName: 'John Doe',
      avatarUrl: 'https://example.com/avatar.jpg',
      avatarBlobId: 'blob-123',
      email: 'john@example.com',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-123' },
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
  })

  it('should return 500 when database query fails', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)
    ;(mockPrisma.user.findUnique as jest.Mock).mockRejectedValue(
      new Error('Database error')
    )

    // Act
    const { GET } = await import('@/app/api/profile/route')
    const response = await GET()

    // Assert
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Internal server error')
  })

  it('should handle user not found in database', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null)

    // Act
    const { GET } = await import('@/app/api/profile/route')
    const response = await GET()

    // Assert
    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toBe('User not found')
  })
})
