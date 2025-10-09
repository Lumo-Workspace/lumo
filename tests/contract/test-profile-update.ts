/**
 * Contract tests for Profile Update API endpoint
 * Tests the API contract for PUT /api/profile
 */

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/db/prisma'
import { triggerProfileUpdate } from '@/lib/realtime/events'

// Mock dependencies
jest.mock('next-auth')
jest.mock('@/lib/db/prisma')
jest.mock('@/lib/realtime/events')

const mockGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>
const mockPrisma = prisma as jest.Mocked<typeof prisma>
const mockTriggerProfileUpdate = triggerProfileUpdate as jest.MockedFunction<
  typeof triggerProfileUpdate
>

describe('PUT /api/profile', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return 401 when user is not authenticated', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue(null)
    const request = new NextRequest('http://localhost:3000/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'New Name' }),
    })

    // Act
    const { PUT } = await import('@/app/api/profile/route')
    const response = await PUT(request)

    // Assert
    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('should update display name successfully', async () => {
    // Arrange
    const mockUser = {
      id: 'user-123',
      displayName: 'New Name',
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

    const request = new NextRequest('http://localhost:3000/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'New Name' }),
    })

    // Act
    const { PUT } = await import('@/app/api/profile/route')
    const response = await PUT(request)

    // Assert
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.displayName).toBe('New Name')
    expect(mockTriggerProfileUpdate).toHaveBeenCalledWith('user-123', {
      displayName: 'New Name',
    })
  })

  it('should return 400 for invalid request body', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    const request = new NextRequest('http://localhost:3000/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'A'.repeat(101) }), // Too long
    })

    // Act
    const { PUT } = await import('@/app/api/profile/route')
    const response = await PUT(request)

    // Assert
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Invalid request')
  })

  it('should return 400 for empty display name', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    const request = new NextRequest('http://localhost:3000/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName: '' }),
    })

    // Act
    const { PUT } = await import('@/app/api/profile/route')
    const response = await PUT(request)

    // Assert
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Display name cannot be empty')
  })

  it('should return 500 when database update fails', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)
    ;(mockPrisma.user.update as jest.Mock).mockRejectedValue(
      new Error('Database error')
    )

    const request = new NextRequest('http://localhost:3000/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'New Name' }),
    })

    // Act
    const { PUT } = await import('@/app/api/profile/route')
    const response = await PUT(request)

    // Assert
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Failed to update profile')
  })

  it('should handle concurrent updates gracefully', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    // Simulate concurrent update conflict
    ;(mockPrisma.user.update as jest.Mock).mockRejectedValue(
      new Error('Concurrent update conflict')
    )

    const request = new NextRequest('http://localhost:3000/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'New Name' }),
    })

    // Act
    const { PUT } = await import('@/app/api/profile/route')
    const response = await PUT(request)

    // Assert
    expect(response.status).toBe(409)
    const data = await response.json()
    expect(data.error).toBe(
      'Profile was updated by another user. Please refresh and try again.'
    )
  })

  it('should validate display name length', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    const request = new NextRequest('http://localhost:3000/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'A'.repeat(101) }), // Exceeds 100 character limit
    })

    // Act
    const { PUT } = await import('@/app/api/profile/route')
    const response = await PUT(request)

    // Assert
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Display name must be between 1 and 100 characters')
  })

  it('should allow special characters and emojis in display name', async () => {
    // Arrange
    const mockUser = {
      id: 'user-123',
      displayName: 'John 🚀 Doe',
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

    const request = new NextRequest('http://localhost:3000/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'John 🚀 Doe' }),
    })

    // Act
    const { PUT } = await import('@/app/api/profile/route')
    const response = await PUT(request)

    // Assert
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.displayName).toBe('John 🚀 Doe')
  })
})
