/**
 * Integration tests for display name update flow
 * Tests the complete user journey for updating display names
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

describe('Display Name Update Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should complete full display name update flow', async () => {
    // Arrange - User starts with existing profile
    const initialUser = {
      id: 'user-123',
      displayName: 'John Doe',
      avatarUrl: null,
      avatarBlobId: null,
      email: 'john@example.com',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    }

    const updatedUser = {
      ...initialUser,
      displayName: 'John Smith',
      updatedAt: new Date('2024-01-02'),
    }

    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    // Step 1: Get current profile
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValueOnce(
      initialUser as any
    )

    // Step 2: Update profile
    ;(mockPrisma.user.update as jest.Mock).mockResolvedValueOnce(
      updatedUser as any
    )

    // Act - Complete the update flow
    const { GET, PUT } = await import('@/app/api/profile/route')

    // Step 1: Get current profile
    const getResponse = await GET()
    expect(getResponse.status).toBe(200)
    const currentProfile = await getResponse.json()
    expect(currentProfile.displayName).toBe('John Doe')

    // Step 2: Update display name
    const updateRequest = new NextRequest('http://localhost:3000/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'John Smith' }),
    })

    const updateResponse = await PUT(updateRequest)
    expect(updateResponse.status).toBe(200)
    const updatedProfile = await updateResponse.json()
    expect(updatedProfile.displayName).toBe('John Smith')

    // Step 3: Verify real-time update was triggered
    expect(mockTriggerProfileUpdate).toHaveBeenCalledWith('user-123', {
      displayName: 'John Smith',
    })

    // Step 4: Verify database was updated
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-123' },
      data: { displayName: 'John Smith' },
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

  it('should handle validation errors in update flow', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    // Act - Try to update with invalid data
    const { PUT } = await import('@/app/api/profile/route')
    const updateRequest = new NextRequest('http://localhost:3000/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName: '' }), // Empty name
    })

    const updateResponse = await PUT(updateRequest)

    // Assert
    expect(updateResponse.status).toBe(400)
    const errorData = await updateResponse.json()
    expect(errorData.error).toBe('Display name cannot be empty')

    // Verify no database update occurred
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
    expect(mockTriggerProfileUpdate).not.toHaveBeenCalled()
  })

  it('should handle concurrent update conflicts', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    // Simulate concurrent update conflict
    ;(mockPrisma.user.update as jest.Mock).mockRejectedValue(
      new Error('Concurrent update conflict')
    )

    // Act
    const { PUT } = await import('@/app/api/profile/route')
    const updateRequest = new NextRequest('http://localhost:3000/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'New Name' }),
    })

    const updateResponse = await PUT(updateRequest)

    // Assert
    expect(updateResponse.status).toBe(409)
    const errorData = await updateResponse.json()
    expect(errorData.error).toBe(
      'Profile was updated by another user. Please refresh and try again.'
    )

    // Verify no real-time update was triggered
    expect(mockTriggerProfileUpdate).not.toHaveBeenCalled()
  })

  it('should handle network connectivity issues gracefully', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    // Simulate network timeout
    ;(mockPrisma.user.update as jest.Mock).mockRejectedValue(
      new Error('Network timeout')
    )

    // Act
    const { PUT } = await import('@/app/api/profile/route')
    const updateRequest = new NextRequest('http://localhost:3000/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'New Name' }),
    })

    const updateResponse = await PUT(updateRequest)

    // Assert
    expect(updateResponse.status).toBe(500)
    const errorData = await updateResponse.json()
    expect(errorData.error).toBe('Failed to update profile')

    // Verify no real-time update was triggered
    expect(mockTriggerProfileUpdate).not.toHaveBeenCalled()
  })

  it('should complete update flow within performance targets', async () => {
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

    // Act - Measure update time
    const startTime = Date.now()

    const { PUT } = await import('@/app/api/profile/route')
    const updateRequest = new NextRequest('http://localhost:3000/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'New Name' }),
    })

    const updateResponse = await PUT(updateRequest)
    const endTime = Date.now()
    const updateTime = endTime - startTime

    // Assert
    expect(updateResponse.status).toBe(200)
    expect(updateTime).toBeLessThan(30000) // Should complete within 30 seconds (SC-001)
  })

  it('should maintain data consistency across multiple updates', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    const mockUser = {
      id: 'user-123',
      displayName: 'Final Name',
      avatarUrl: null,
      avatarBlobId: null,
      email: 'john@example.com',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    }

    ;(mockPrisma.user.update as jest.Mock).mockResolvedValue(mockUser as any)

    // Act - Perform multiple updates
    const { PUT } = await import('@/app/api/profile/route')

    // First update
    const update1Request = new NextRequest(
      'http://localhost:3000/api/profile',
      {
        method: 'PUT',
        body: JSON.stringify({ displayName: 'First Name' }),
      }
    )
    const update1Response = await PUT(update1Request)

    // Second update
    const update2Request = new NextRequest(
      'http://localhost:3000/api/profile',
      {
        method: 'PUT',
        body: JSON.stringify({ displayName: 'Second Name' }),
      }
    )
    const update2Response = await PUT(update2Request)

    // Assert
    expect(update1Response.status).toBe(200)
    expect(update2Response.status).toBe(200)

    // Verify both updates were processed
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(2)
    expect(mockTriggerProfileUpdate).toHaveBeenCalledTimes(2)
  })
})
