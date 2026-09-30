import { imagesClient } from '@/lib/api-client'
import { ApiClientError } from '@/lib/api-client/base'

/**
 * Image-upload constraints, mirrored from the server route
 * `app/api/upload/image/route.ts`. Kept in sync by hand: the file picker's
 * `accept` attribute only guards the picker, so paste/drop and oversized
 * picks are validated against these values on the client before we even
 * attempt an upload.
 */
export const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
] as const

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB

export type ImageValidationResult =
  | { ok: true }
  | { ok: false; reason: 'type' | 'size' }

/**
 * Validate a candidate image before upload. Type is checked before size so a
 * file that is both wrong-type and oversized reports the more fundamental
 * problem first.
 */
export function validateImageFile(file: File): ImageValidationResult {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: 'type' }
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, reason: 'size' }
  }
  return { ok: true }
}

/**
 * Upload the file; returns its (login-gated) file-route URL, or null on
 * failure. Unlike a bare `catch {}`, failures are logged with enough context
 * (HTTP status + error code for server-side rejections, the raw error for
 * network/unexpected failures) to tell a 413 / auth / network problem apart.
 */
export async function uploadImageFile(
  file: File,
  documentId?: string
): Promise<string | null> {
  try {
    const { url } = await imagesClient.upload(file, documentId)
    return url || null
  } catch (err) {
    if (err instanceof ApiClientError) {
      console.error(
        `Image upload failed (status ${err.status}, code ${err.code}): ${err.message}`,
        err
      )
    } else {
      console.error('Image upload failed (network or unexpected error):', err)
    }
    return null
  }
}
