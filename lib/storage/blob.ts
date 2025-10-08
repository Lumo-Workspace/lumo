import { put } from '@vercel/blob'
import { AuthLogger } from '@/lib/utils/logger'

export interface UploadResult {
  success: boolean
  url?: string
  error?: string
}

export async function uploadAvatar(
  file: File,
  userId: string
): Promise<UploadResult> {
  try {
    AuthLogger.logError('Avatar upload attempt', {
      userId,
      fileName: file.name,
      fileSize: file.size,
    })

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return {
        success: false,
        error: 'File must be an image',
      }
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024 // 5MB
    if (file.size > maxSize) {
      return {
        success: false,
        error: 'File size must be less than 5MB',
      }
    }

    // Generate unique filename
    const fileExtension = file.name.split('.').pop() || 'jpg'
    const fileName = `avatars/${userId}/${Date.now()}.${fileExtension}`

    // Upload to Vercel Blob
    const blob = await put(fileName, file, {
      access: 'public',
      addRandomSuffix: false,
    })

    AuthLogger.logError('Avatar upload success', { userId, blobUrl: blob.url })

    return {
      success: true,
      url: blob.url,
    }
  } catch (error) {
    AuthLogger.logError('Avatar upload failed', {
      userId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    }
  }
}

export async function uploadDocument(
  file: File,
  userId: string,
  projectId?: string
): Promise<UploadResult> {
  try {
    AuthLogger.logError('Document upload attempt', {
      userId,
      projectId,
      fileName: file.name,
      fileSize: file.size,
    })

    // Validate file type (allow common document types)
    const allowedTypes = [
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ]

    if (!allowedTypes.includes(file.type)) {
      return {
        success: false,
        error: 'File type not supported',
      }
    }

    // Validate file size (max 25MB)
    const maxSize = 25 * 1024 * 1024 // 25MB
    if (file.size > maxSize) {
      return {
        success: false,
        error: 'File size must be less than 25MB',
      }
    }

    // Generate unique filename
    const fileExtension = file.name.split('.').pop() || 'bin'
    const folder = projectId ? `documents/${projectId}` : 'documents'
    const fileName = `${folder}/${userId}/${Date.now()}.${fileExtension}`

    // Upload to Vercel Blob
    const blob = await put(fileName, file, {
      access: 'public',
      addRandomSuffix: false,
    })

    AuthLogger.logError('Document upload success', {
      userId,
      projectId,
      blobUrl: blob.url,
    })

    return {
      success: true,
      url: blob.url,
    }
  } catch (error) {
    AuthLogger.logError('Document upload failed', {
      userId,
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    }
  }
}

export async function deleteBlob(url: string): Promise<boolean> {
  try {
    // Note: Vercel Blob doesn't provide a direct delete method in the client
    // In production, you would need to implement this on the server side
    // or use Vercel's API to delete blobs
    AuthLogger.logError('Blob delete requested', { url })

    // For now, we'll just log the request
    // TODO: Implement actual blob deletion via Vercel API
    return true
  } catch (error) {
    AuthLogger.logError('Blob delete failed', {
      url,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return false
  }
}
