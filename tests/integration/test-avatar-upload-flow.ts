/**
 * Integration tests for avatar upload flow
 * Tests the complete user journey for avatar uploads
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

describe('Avatar Upload Integration Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should complete full avatar upload flow', async () => {
    // Arrange - User starts without avatar
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
      avatarUrl:
        'https://blob.vercel-storage.com/avatars/user-123-1234567890.jpg',
      avatarBlobId: 'avatars/user-123-1234567890.jpg',
      updatedAt: new Date('2024-01-02'),
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

    // Step 1: Get current profile
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValueOnce(
      initialUser as any
    )

    // Step 2: Process and upload avatar
    mockProcessAvatarImage.mockResolvedValueOnce(mockProcessedImage)
    mockUploadAvatar.mockResolvedValueOnce(mockBlobResult)
    ;(mockPrisma.user.update as jest.Mock).mockResolvedValueOnce(
      updatedUser as any
    )

    // Act - Complete the upload flow
    const { GET } = await import('@/app/api/profile/route')
    const { POST } = await import('@/app/api/profile/avatar/route')

    // Step 1: Get current profile
    const getResponse = await GET()
    expect(getResponse.status).toBe(200)
    const currentProfile = await getResponse.json()
    expect(currentProfile.avatarUrl).toBeNull()

    // Step 2: Upload avatar
    const validFile = new File(['test-image'], 'avatar.jpg', {
      type: 'image/jpeg',
    })
    const formData = new FormData()
    formData.append('avatar', validFile)

    const uploadRequest = new NextRequest(
      'http://localhost:3000/api/profile/avatar',
      {
        method: 'POST',
        body: formData,
      }
    )

    const uploadResponse = await POST(uploadRequest)
    expect(uploadResponse.status).toBe(200)
    const uploadResult = await uploadResponse.json()
    expect(uploadResult.avatarUrl).toBe(
      'https://blob.vercel-storage.com/avatars/user-123-1234567890.jpg'
    )

    // Step 3: Verify image processing
    expect(mockProcessAvatarImage).toHaveBeenCalledWith(expect.any(Buffer))

    // Step 4: Verify blob upload
    expect(mockUploadAvatar).toHaveBeenCalledWith(
      mockProcessedImage.buffer,
      'user-123'
    )

    // Step 5: Verify database update
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-123' },
      data: {
        avatarUrl:
          'https://blob.vercel-storage.com/avatars/user-123-1234567890.jpg',
        avatarBlobId: 'avatars/user-123-1234567890.jpg',
      },
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

    // Step 6: Verify real-time update
    expect(mockTriggerProfileUpdate).toHaveBeenCalledWith('user-123', {
      avatarUrl:
        'https://blob.vercel-storage.com/avatars/user-123-1234567890.jpg',
    })
  })

  it('should handle file validation errors in upload flow', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    // Act - Try to upload invalid file
    const { POST } = await import('@/app/api/profile/avatar/route')

    // Test 1: File too large
    const largeFile = new File(['x'.repeat(6 * 1024 * 1024)], 'large.jpg', {
      type: 'image/jpeg',
    })
    const largeFormData = new FormData()
    largeFormData.append('avatar', largeFile)

    const largeRequest = new NextRequest(
      'http://localhost:3000/api/profile/avatar',
      {
        method: 'POST',
        body: largeFormData,
      }
    )

    const largeResponse = await POST(largeRequest)
    expect(largeResponse.status).toBe(413)

    // Test 2: Unsupported file type
    const unsupportedFile = new File(['test'], 'document.pdf', {
      type: 'application/pdf',
    })
    const unsupportedFormData = new FormData()
    unsupportedFormData.append('avatar', unsupportedFile)

    const unsupportedRequest = new NextRequest(
      'http://localhost:3000/api/profile/avatar',
      {
        method: 'POST',
        body: unsupportedFormData,
      }
    )

    const unsupportedResponse = await POST(unsupportedRequest)
    expect(unsupportedResponse.status).toBe(415)

    // Assert - No processing or upload should occur
    expect(mockProcessAvatarImage).not.toHaveBeenCalled()
    expect(mockUploadAvatar).not.toHaveBeenCalled()
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
    expect(mockTriggerProfileUpdate).not.toHaveBeenCalled()
  })

  it('should handle image processing failures', async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    mockProcessAvatarImage.mockRejectedValue(
      new Error('Image processing failed')
    )

    // Act
    const { POST } = await import('@/app/api/profile/avatar/route')

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

    const response = await POST(request)

    // Assert
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Upload failed')

    // Verify no further processing occurred
    expect(mockUploadAvatar).not.toHaveBeenCalled()
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
    expect(mockTriggerProfileUpdate).not.toHaveBeenCalled()
  })

  it('should handle blob upload failures', async () => {
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

    // Act
    const { POST } = await import('@/app/api/profile/avatar/route')

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

    const response = await POST(request)

    // Assert
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Upload failed')

    // Verify no database update occurred
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
    expect(mockTriggerProfileUpdate).not.toHaveBeenCalled()
  })

  it('should complete upload flow within performance targets', async () => {
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

    const mockBlobResult = {
      url: 'https://blob.vercel-storage.com/avatars/user-123-1234567890.jpg',
      pathname: 'avatars/user-123-1234567890.jpg',
      contentType: 'image/jpeg',
      contentDisposition: 'inline',
      size: 512000,
      uploadedAt: new Date(),
    }

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

    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    mockProcessAvatarImage.mockResolvedValue(mockProcessedImage)
    mockUploadAvatar.mockResolvedValue(mockBlobResult)
    ;(mockPrisma.user.update as jest.Mock).mockResolvedValue(mockUser as any)

    // Act - Measure upload time
    const startTime = Date.now()

    const { POST } = await import('@/app/api/profile/avatar/route')

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

    const response = await POST(request)
    const endTime = Date.now()
    const uploadTime = endTime - startTime

    // Assert
    expect(response.status).toBe(200)
    expect(uploadTime).toBeLessThan(60000) // Should complete within 60 seconds (SC-002)
  })

  it('should handle concurrent avatar uploads', async () => {
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

    const mockBlobResult = {
      url: 'https://blob.vercel-storage.com/avatars/user-123-1234567890.jpg',
      pathname: 'avatars/user-123-1234567890.jpg',
      contentType: 'image/jpeg',
      contentDisposition: 'inline',
      size: 512000,
      uploadedAt: new Date(),
    }

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

    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123' },
    } as any)

    mockProcessAvatarImage.mockResolvedValue(mockProcessedImage)
    mockUploadAvatar.mockResolvedValue(mockBlobResult)
    ;(mockPrisma.user.update as jest.Mock).mockResolvedValue(mockUser as any)

    // Act - Perform multiple uploads
    const { POST } = await import('@/app/api/profile/avatar/route')

    const uploadPromises = []
    for (let i = 0; i < 3; i++) {
      const file = new File([`test-image-${i}`], `avatar-${i}.jpg`, {
        type: 'image/jpeg',
      })
      const formData = new FormData()
      formData.append('avatar', file)

      const request = new NextRequest(
        'http://localhost:3000/api/profile/avatar',
        {
          method: 'POST',
          body: formData,
        }
      )

      uploadPromises.push(POST(request))
    }

    const responses = await Promise.all(uploadPromises)

    // Assert
    responses.forEach(response => {
      expect(response.status).toBe(200)
    })

    // Verify all uploads were processed
    expect(mockProcessAvatarImage).toHaveBeenCalledTimes(3)
    expect(mockUploadAvatar).toHaveBeenCalledTimes(3)
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(3)
    expect(mockTriggerProfileUpdate).toHaveBeenCalledTimes(3)
  })
})
