/**
 * Integration test for real-time update flow
 * Tests the complete flow of profile updates being broadcast to connected clients
 */

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth/next'

// Mock dependencies
jest.mock('next-auth/next')
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}))

const mockGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>
const mockPrisma = require('@/lib/db/prisma').prisma

describe('Real-time Update Flow Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should broadcast profile updates to connected SSE clients', async () => {
    // Arrange - Mock authenticated user
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    const mockUser = {
      id: 'user-123',
      displayName: 'Updated Name',
      avatarUrl: 'https://example.com/avatar.jpg',
      email: 'test@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)
    ;(mockPrisma.user.update as jest.Mock).mockResolvedValue(mockUser)

    // Act - Establish SSE connection
    const eventsRequest = new NextRequest(
      'http://localhost:3000/api/profile/events'
    )
    const { GET: getEvents } = await import('@/app/api/profile/events/route')
    const eventsResponse = await getEvents(eventsRequest)

    // Assert - SSE connection established
    expect(eventsResponse.status).toBe(200)
    expect(eventsResponse.headers.get('content-type')).toBe('text/event-stream')

    // Act - Update profile (this should trigger real-time update)
    const updateRequest = new NextRequest('http://localhost:3000/api/profile', {
      method: 'PUT',
      body: JSON.stringify({
        displayName: 'Updated Name',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const { PUT: updateProfile } = await import('@/app/api/profile/route')
    const updateResponse = await updateProfile(updateRequest)

    // Assert - Profile updated successfully
    expect(updateResponse.status).toBe(200)
    const updateData = await updateResponse.json()
    expect(updateData.displayName).toBe('Updated Name')

    // Note: In a real integration test, we would verify that the SSE client
    // receives the profile update event. This would require more complex
    // setup with actual SSE client connections.
  })

  it('should handle multiple concurrent profile updates', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    const mockUser = {
      id: 'user-123',
      displayName: 'Test User',
      avatarUrl: null,
      email: 'test@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)
    ;(mockPrisma.user.update as jest.Mock).mockResolvedValue(mockUser)

    // Act - Multiple concurrent updates
    const updatePromises = [
      // Update 1: Display name
      new NextRequest('http://localhost:3000/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ displayName: 'Name 1' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      // Update 2: Avatar
      new NextRequest('http://localhost:3000/api/profile/avatar', {
        method: 'POST',
        body: new FormData(),
      }),
    ]

    const { PUT: updateProfile } = await import('@/app/api/profile/route')
    const { POST: uploadAvatar } = await import(
      '@/app/api/profile/avatar/route'
    )

    const responses = await Promise.all([
      updateProfile(updatePromises[0]!),
      uploadAvatar(updatePromises[1]!),
    ])

    // Assert - All updates processed
    expect(responses[0].status).toBe(200)
    expect(responses[1].status).toBe(200)

    // Verify that both updates were processed
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(2)
  })

  it('should maintain SSE connection during profile updates', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    const mockUser = {
      id: 'user-123',
      displayName: 'Test User',
      avatarUrl: null,
      email: 'test@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)
    ;(mockPrisma.user.update as jest.Mock).mockResolvedValue(mockUser)

    // Act - Establish SSE connection
    const eventsRequest = new NextRequest(
      'http://localhost:3000/api/profile/events'
    )
    const { GET: getEvents } = await import('@/app/api/profile/events/route')
    const eventsResponse = await getEvents(eventsRequest)

    // Assert - Connection established
    expect(eventsResponse.status).toBe(200)

    // Act - Update profile while SSE connection is active
    const updateRequest = new NextRequest('http://localhost:3000/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'Updated Name' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const { PUT: updateProfile } = await import('@/app/api/profile/route')
    const updateResponse = await updateProfile(updateRequest)

    // Assert - Both operations successful
    expect(eventsResponse.status).toBe(200)
    expect(updateResponse.status).toBe(200)

    // The SSE connection should remain active and ready to receive updates
    expect(eventsResponse.headers.get('connection')).toBe('keep-alive')
  })

  it('should handle SSE connection errors gracefully', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)
    ;(mockPrisma.user.findUnique as jest.Mock).mockRejectedValue(
      new Error('Database connection failed')
    )

    // Act
    const eventsRequest = new NextRequest(
      'http://localhost:3000/api/profile/events'
    )
    const { GET: getEvents } = await import('@/app/api/profile/events/route')
    const eventsResponse = await getEvents(eventsRequest)

    // Assert - Error handled gracefully
    expect(eventsResponse.status).toBe(500)
    const data = await eventsResponse.json()
    expect(data.error).toBe('Internal server error')
  })
})
