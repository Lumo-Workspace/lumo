/**
 * Contract test for GET /api/profile/events
 * Tests the Server-Sent Events endpoint for real-time profile updates
 */

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth/next'

// Mock dependencies
jest.mock('next-auth/next')
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}))

const mockGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>
const mockPrisma = require('@/lib/db/prisma').prisma

describe('GET /api/profile/events', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return 401 when user is not authenticated', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue(null)
    const request = new NextRequest('http://localhost:3000/api/profile/events')

    // Act
    const { GET } = await import('@/app/api/profile/events/route')
    const response = await GET(request)

    // Assert
    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('should establish SSE connection for authenticated user', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      displayName: 'Test User',
      avatarUrl: null,
      email: 'test@example.com',
    })

    const request = new NextRequest('http://localhost:3000/api/profile/events')

    // Act
    const { GET } = await import('@/app/api/profile/events/route')
    const response = await GET(request)

    // Assert
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('connection')).toBe('keep-alive')
  })

  it('should send initial connection event', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      displayName: 'Test User',
      avatarUrl: null,
      email: 'test@example.com',
    })

    const request = new NextRequest('http://localhost:3000/api/profile/events')

    // Act
    const { GET } = await import('@/app/api/profile/events/route')
    const response = await GET(request)

    // Assert
    expect(response.status).toBe(200)

    // Read the response stream to verify initial event
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    const { value } = await reader!.read()
    const eventData = decoder.decode(value!)

    expect(eventData).toContain('event: connection_established')
    expect(eventData).toContain('data: {"type":"connection_established"')
  })

  it('should handle database errors gracefully', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)
    ;(mockPrisma.user.findUnique as jest.Mock).mockRejectedValue(
      new Error('Database error')
    )

    const request = new NextRequest('http://localhost:3000/api/profile/events')

    // Act
    const { GET } = await import('@/app/api/profile/events/route')
    const response = await GET(request)

    // Assert
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Internal server error')
  })

  it('should handle user not found', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null)

    const request = new NextRequest('http://localhost:3000/api/profile/events')

    // Act
    const { GET } = await import('@/app/api/profile/events/route')
    const response = await GET(request)

    // Assert
    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toBe('User not found')
  })
})
