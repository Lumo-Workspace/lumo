/**
 * Contract tests for Avatar Upload API endpoint
 * Tests the API contract for POST /api/profile/avatar
 */

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/db/prisma'
import { uploadAvatar } from '@/lib/storage/blob'
import { processAvatarImage } from '@/lib/utils/image-processing'
import { triggerProfileUpdate } from '@/lib/realtime/events'

// Mock dependencies
jest.mock('next-auth')
jest.mock('@/lib/db/prisma')
jest.mock('@/lib/storage/blob')
jest.mock('@/lib/utils/image-processing')
jest.mock('@/lib/realtime/events')

const mockGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>
const mockPrisma = prisma as jest.Mocked<typeof prisma>
const mockUploadAvatar = uploadAvatar as jest.MockedFunction<
  typeof uploadAvatar
>
const mockProcessAvatarImage = processAvatarImage as jest.MockedFunction<
  typeof processAvatarImage
>
const mockTriggerProfileUpdate = triggerProfileUpdate as jest.MockedFunction<
  typeof triggerProfileUpdate
>

describe('POST /api/profile/avatar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return 401 when user is not authenticated', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue(null)

    const formData = new FormData()
    formData.append(
      'avatar',
      new File(['test'], 'avatar.jpg', { type: 'image/jpeg' })
    )

    const request = new NextRequest(
      'http://localhost:3000/api/profile/avatar',
      {
        method: 'POST',
        body: formData,
      }
    )

    // Act
    const { POST } = await import('@/app/api/profile/avatar/route')
    const response = await POST(request)

    // Assert
    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('should return 400 when no file is provided', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    const formData = new FormData()
    const request = new NextRequest(
      'http://localhost:3000/api/profile/avatar',
      {
        method: 'POST',
        body: formData,
      }
    )

    // Act
    const { POST } = await import('@/app/api/profile/avatar/route')
    const response = await POST(request)

    // Assert
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('No file provided')
  })

  it('should return 413 when file is too large', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    // Create a file larger than 5MB
    const largeFile = new File(
      ['x'.repeat(6 * 1024 * 1024)],
      'large-avatar.jpg',
      { type: 'image/jpeg' }
    )
    const formData = new FormData()
    formData.append('avatar', largeFile)

    const request = new NextRequest(
      'http://localhost:3000/api/profile/avatar',
      {
        method: 'POST',
        body: formData,
      }
    )

    // Act
    const { POST } = await import('@/app/api/profile/avatar/route')
    const response = await POST(request)

    // Assert
    expect(response.status).toBe(413)
    const data = await response.json()
    expect(data.error).toBe('File too large')
  })

  it('should return 415 for unsupported file type', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    const unsupportedFile = new File(['test'], 'document.pdf', {
      type: 'application/pdf',
    })
    const formData = new FormData()
    formData.append('avatar', unsupportedFile)

    const request = new NextRequest(
      'http://localhost:3000/api/profile/avatar',
      {
        method: 'POST',
        body: formData,
      }
    )

    // Act
    const { POST } = await import('@/app/api/profile/avatar/route')
    const response = await POST(request)

    // Assert
    expect(response.status).toBe(415)
    const data = await response.json()
    expect(data.error).toBe('Unsupported file type')
  })

  it('should upload avatar successfully', async () => {
    // Arrange
    const mockUser = {
      id: 'user-123',
      displayName: 'John Doe',
      avatarUrl:
        'https://blob.vercel-storage.com/avatars/user-123-1234567890.jpg',
      avatarBlobId: 'avatars/user-123-1234567890.jpg',
      email: 'john@example.com',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    }

    const mockProcessedImage = {
      buffer: Buffer.from('processed-image'),
      metadata: {
        originalSize: 1024000,
        processedSize: 512000,
        dimensions: { width: 200, height: 200 },
        format: 'jpeg',
      },
    }

    const mockBlobResult = {
      url: 'https://blob.vercel-storage.com/avatars/user-123-1234567890.jpg',
      pathname: 'avatars/user-123-1234567890.jpg',
      contentType: 'image/jpeg',
      contentDisposition: 'inline',
      size: 512000,
      uploadedAt: new Date(),
    }

    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    mockProcessAvatarImage.mockResolvedValue(mockProcessedImage)
    mockUploadAvatar.mockResolvedValue(mockBlobResult)
    ;(mockPrisma.user.update as jest.Mock).mockResolvedValue(mockUser as any)

    const validFile = new File(['test-image'], 'avatar.jpg', {
      type: 'image/jpeg',
    })
    const formData = new FormData()
    formData.append('avatar', validFile)

    const request = new NextRequest(
      'http://localhost:3000/api/profile/avatar',
      {
        method: 'POST',
        body: formData,
      }
    )

    // Act
    const { POST } = await import('@/app/api/profile/avatar/route')
    const response = await POST(request)

    // Assert
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({
      avatarUrl:
        'https://blob.vercel-storage.com/avatars/user-123-1234567890.jpg',
      avatarBlobId: 'avatars/user-123-1234567890.jpg',
      metadata: {
        originalSize: 1024000,
        processedSize: 512000,
        dimensions: { width: 200, height: 200 },
        format: 'jpeg',
      },
    })

    expect(mockProcessAvatarImage).toHaveBeenCalledWith(expect.any(Buffer))
    expect(mockUploadAvatar).toHaveBeenCalledWith(
      mockProcessedImage.buffer,
      'user-123'
    )
    expect(mockTriggerProfileUpdate).toHaveBeenCalledWith('user-123', {
      avatarUrl:
        'https://blob.vercel-storage.com/avatars/user-123-1234567890.jpg',
    })
  })

  it('should return 500 when image processing fails', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    mockProcessAvatarImage.mockRejectedValue(
      new Error('Image processing failed')
    )

    const validFile = new File(['test-image'], 'avatar.jpg', {
      type: 'image/jpeg',
    })
    const formData = new FormData()
    formData.append('avatar', validFile)

    const request = new NextRequest(
      'http://localhost:3000/api/profile/avatar',
      {
        method: 'POST',
        body: formData,
      }
    )

    // Act
    const { POST } = await import('@/app/api/profile/avatar/route')
    const response = await POST(request)

    // Assert
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Upload failed')
  })

  it('should return 500 when blob upload fails', async () => {
    // Arrange
    const mockProcessedImage = {
      buffer: Buffer.from('processed-image'),
      metadata: {
        originalSize: 1024000,
        processedSize: 512000,
        dimensions: { width: 200, height: 200 },
        format: 'jpeg',
      },
    }

    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    mockProcessAvatarImage.mockResolvedValue(mockProcessedImage)
    mockUploadAvatar.mockRejectedValue(new Error('Blob upload failed'))

    const validFile = new File(['test-image'], 'avatar.jpg', {
      type: 'image/jpeg',
    })
    const formData = new FormData()
    formData.append('avatar', validFile)

    const request = new NextRequest(
      'http://localhost:3000/api/profile/avatar',
      {
        method: 'POST',
        body: formData,
      }
    )

    // Act
    const { POST } = await import('@/app/api/profile/avatar/route')
    const response = await POST(request)

    // Assert
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Upload failed')
  })

  it('should handle corrupted image files', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    mockProcessAvatarImage.mockRejectedValue(new Error('Invalid image format'))

    const corruptedFile = new File(['not-an-image'], 'fake.jpg', {
      type: 'image/jpeg',
    })
    const formData = new FormData()
    formData.append('avatar', corruptedFile)

    const request = new NextRequest(
      'http://localhost:3000/api/profile/avatar',
      {
        method: 'POST',
        body: formData,
      }
    )

    // Act
    const { POST } = await import('@/app/api/profile/avatar/route')
    const response = await POST(request)

    // Assert
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Upload failed')
  })
})
