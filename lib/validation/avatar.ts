/**
 * Avatar validation schemas and utilities
 * Zod schemas for avatar upload validation
 */

import { z } from 'zod'
import { PROFILE_CONSTANTS } from '@/types/profile'

/**
 * Avatar file validation schema
 */
export const avatarFileSchema = z.object({
  name: z.string().min(1, 'File name is required'),
  type: z
    .string()
    .refine(
      type => PROFILE_CONSTANTS.AVATAR.SUPPORTED_FORMATS.includes(type as any),
      'Unsupported file type'
    ),
  size: z
    .number()
    .max(
      PROFILE_CONSTANTS.AVATAR.MAX_FILE_SIZE,
      `File size must be less than ${PROFILE_CONSTANTS.AVATAR.MAX_FILE_SIZE / (1024 * 1024)}MB`
    ),
})

/**
 * Avatar upload request validation
 */
export const avatarUploadSchema = z.object({
  avatar: z
    .any()
    .refine(file => file instanceof File, 'Avatar must be a valid file')
    .refine(
      file => file.size <= PROFILE_CONSTANTS.AVATAR.MAX_FILE_SIZE,
      `File size must be less than ${PROFILE_CONSTANTS.AVATAR.MAX_FILE_SIZE / (1024 * 1024)}MB`
    )
    .refine(
      file =>
        PROFILE_CONSTANTS.AVATAR.SUPPORTED_FORMATS.includes(file.type as any),
      `Unsupported file type. Supported formats: ${PROFILE_CONSTANTS.AVATAR.SUPPORTED_FORMATS.join(', ')}`
    ),
})

/**
 * Avatar validation result type
 */
export interface AvatarValidationResult {
  success: boolean
  data?: any
  errors?: Array<{
    field: string
    message: string
    code: string
  }>
}

/**
 * Validate avatar file
 */
export function validateAvatarFile(file: File): AvatarValidationResult {
  try {
    const result = avatarFileSchema.parse({
      name: file.name,
      type: file.type,
      size: file.size,
    })

    return {
      success: true,
      data: result,
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        errors: error.errors.map(err => ({
          field: 'avatar',
          message: err.message,
          code: err.code,
        })),
      }
    }

    return {
      success: false,
      errors: [
        {
          field: 'avatar',
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
        },
      ],
    }
  }
}

/**
 * Validate avatar upload request
 */
export function validateAvatarUploadRequest(
  formData: FormData
): AvatarValidationResult {
  try {
    const file = formData.get('avatar') as File

    if (!file) {
      return {
        success: false,
        errors: [
          {
            field: 'avatar',
            message: 'No file provided',
            code: 'MISSING_FILE',
          },
        ],
      }
    }

    return validateAvatarFile(file)
  } catch (error) {
    return {
      success: false,
      errors: [
        {
          field: 'avatar',
          message: 'Invalid request format',
          code: 'INVALID_REQUEST',
        },
      ],
    }
  }
}

/**
 * Get avatar validation rules for UI
 */
export function getAvatarValidationRules() {
  return {
    maxFileSize: PROFILE_CONSTANTS.AVATAR.MAX_FILE_SIZE,
    supportedFormats: PROFILE_CONSTANTS.AVATAR.SUPPORTED_FORMATS,
    maxDimensions: PROFILE_CONSTANTS.AVATAR.TARGET_DIMENSIONS,
    required: true,
    messages: {
      required: 'Avatar file is required',
      maxFileSize: `File size must be less than ${PROFILE_CONSTANTS.AVATAR.MAX_FILE_SIZE / (1024 * 1024)}MB`,
      supportedFormats: `Supported formats: ${PROFILE_CONSTANTS.AVATAR.SUPPORTED_FORMATS.join(', ')}`,
      maxDimensions: `Images will be resized to ${PROFILE_CONSTANTS.AVATAR.TARGET_DIMENSIONS.width}x${PROFILE_CONSTANTS.AVATAR.TARGET_DIMENSIONS.height} pixels`,
    },
  }
}

/**
 * Format validation error for API response
 */
export function formatAvatarValidationError(
  errors: Array<{ field: string; message: string; code: string }>
): {
  error: string
  details: Array<{ field: string; message: string; code: string }>
} {
  const primaryError = errors[0]

  return {
    error: primaryError?.message || 'Validation failed',
    details: errors,
  }
}

/**
 * Check if file is valid avatar without throwing
 */
export function isValidAvatarFile(file: File): boolean {
  const result = validateAvatarFile(file)
  return result.success
}

/**
 * Get file size in human readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * Get file type display name
 */
export function getFileTypeDisplayName(mimeType: string): string {
  const typeMap: Record<string, string> = {
    'image/jpeg': 'JPEG',
    'image/jpg': 'JPEG',
    'image/png': 'PNG',
    'image/gif': 'GIF',
    'image/webp': 'WebP',
    'image/svg+xml': 'SVG',
  }

  return typeMap[mimeType] || mimeType
}
