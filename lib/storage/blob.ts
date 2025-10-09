import { put, del } from '@vercel/blob'
import { PROFILE_CONSTANTS } from '@/types/profile'

/**
 * Vercel Blob Storage utilities for avatar management
 * Handles avatar upload, deletion, and URL management
 */

export interface BlobUploadOptions {
  access: 'public' | 'private'
  contentType?: string
  addRandomSuffix?: boolean
}

export interface BlobUploadResult {
  url: string
  pathname: string
  contentType: string
  contentDisposition: string
  size: number
  uploadedAt: Date
}

/**
 * Upload avatar image to Vercel Blob Storage
 */
export async function uploadAvatar(
  file: Buffer,
  userId: string,
  options: Partial<BlobUploadOptions> = {}
): Promise<BlobUploadResult> {
  const config: BlobUploadOptions = {
    contentType: 'image/jpeg',
    addRandomSuffix: true,
    ...options,
    access: 'public', // Ensure access is always public for avatars
  }

  try {
    const filename = `avatars/${userId}-${Date.now()}.jpg`

    const blob = await put(filename, file, {
      access: 'public',
      contentType: config.contentType || 'image/jpeg',
      addRandomSuffix: config.addRandomSuffix || true,
    })

    return {
      url: blob.url,
      pathname: blob.pathname,
      contentType: blob.contentType,
      contentDisposition: blob.contentDisposition,
      size: file.length, // Use file buffer length instead
      uploadedAt: new Date(), // Use current date since uploadedAt is not available
    }
  } catch (error) {
    throw new Error(
      `Failed to upload avatar: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Delete avatar from Vercel Blob Storage
 */
export async function deleteAvatar(blobId: string): Promise<void> {
  try {
    await del(blobId)
  } catch (error) {
    // Log error but don't throw - deletion failures shouldn't block user operations
    console.error(`Failed to delete avatar blob ${blobId}:`, error)
  }
}

/**
 * Generate avatar filename for a user
 */
export function generateAvatarFilename(
  userId: string,
  timestamp?: number
): string {
  const ts = timestamp || Date.now()
  return `avatars/${userId}-${ts}.jpg`
}

/**
 * Extract blob ID from Vercel Blob URL
 */
export function extractBlobIdFromUrl(url: string): string | null {
  try {
    // Vercel Blob URLs have format: https://[hash].public.blob.vercel-storage.com/[pathname]
    const urlObj = new URL(url)
    return urlObj.pathname.substring(1) // Remove leading slash
  } catch {
    return null
  }
}

/**
 * Validate blob URL format
 */
export function isValidBlobUrl(url: string): boolean {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.includes('blob.vercel-storage.com')
  } catch {
    return false
  }
}

/**
 * Get avatar URL with fallback to default
 */
export function getAvatarUrl(
  avatarUrl?: string | null,
  displayName?: string | null
): string {
  if (avatarUrl && isValidBlobUrl(avatarUrl)) {
    return avatarUrl
  }

  // Return default avatar URL (will be generated client-side)
  return `/api/avatar/default?name=${encodeURIComponent(displayName || '')}`
}

/**
 * Clean up old avatar files (utility for maintenance)
 */
export async function cleanupOldAvatars(
  userId: string,
  keepLatest: number = 1
): Promise<void> {
  // This would require listing blobs, which isn't directly supported by Vercel Blob
  // Implementation would need to track avatar history in database
  // For now, we'll rely on the addRandomSuffix option to prevent conflicts
  console.log(
    `Avatar cleanup for user ${userId} - keeping latest ${keepLatest} files`
  )
}

/**
 * Get blob storage configuration
 */
export function getBlobConfig() {
  const token = process.env.BLOB_READ_WRITE_TOKEN

  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN environment variable is required')
  }

  return {
    token,
    maxFileSize: PROFILE_CONSTANTS.AVATAR.MAX_FILE_SIZE,
    supportedFormats: PROFILE_CONSTANTS.AVATAR.SUPPORTED_FORMATS,
    targetDimensions: PROFILE_CONSTANTS.AVATAR.TARGET_DIMENSIONS,
  }
}

/**
 * Validate blob storage environment
 */
export function validateBlobEnvironment(): { valid: boolean; error?: string } {
  try {
    getBlobConfig()
    return { valid: true }
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
