/**
 * Profile validation schemas and utilities
 * Zod schemas for profile management validation
 */

import { z } from 'zod'
import { PROFILE_CONSTANTS } from '@/types/profile'

/**
 * Display name validation schema
 */
export const displayNameSchema = z
  .string()
  .min(PROFILE_CONSTANTS.DISPLAY_NAME.MIN_LENGTH, 'Display name is too short')
  .max(PROFILE_CONSTANTS.DISPLAY_NAME.MAX_LENGTH, 'Display name is too long')
  .regex(
    PROFILE_CONSTANTS.DISPLAY_NAME.ALLOWED_CHARACTERS,
    'Display name contains invalid characters'
  )
  .refine(
    name => name.trim().length > 0,
    'Display name cannot be empty or only whitespace'
  )

/**
 * Update profile request schema
 */
export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
})

/**
 * Profile validation result type
 */
export interface ProfileValidationResult {
  success: boolean
  data?: any
  errors?: Array<{
    field: string
    message: string
    code: string
  }>
}

/**
 * Validate display name
 */
export function validateDisplayName(
  displayName: string
): ProfileValidationResult {
  try {
    const result = displayNameSchema.parse(displayName)
    return {
      success: true,
      data: result,
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        errors: error.errors.map(err => ({
          field: 'displayName',
          message: err.message,
          code: err.code,
        })),
      }
    }

    return {
      success: false,
      errors: [
        {
          field: 'displayName',
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
        },
      ],
    }
  }
}

/**
 * Validate update profile request
 */
export function validateUpdateProfileRequest(
  data: any
): ProfileValidationResult {
  try {
    const result = updateProfileSchema.parse(data)
    return {
      success: true,
      data: result,
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        errors: error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
        })),
      }
    }

    return {
      success: false,
      errors: [
        {
          field: 'unknown',
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
        },
      ],
    }
  }
}

/**
 * Sanitize display name
 */
export function sanitizeDisplayName(displayName: string): string {
  return displayName.trim().replace(/\s+/g, ' ')
}

/**
 * Check if display name is valid without throwing
 */
export function isValidDisplayName(displayName: string): boolean {
  const result = validateDisplayName(displayName)
  return result.success
}

/**
 * Get display name validation rules for UI
 */
export function getDisplayNameValidationRules() {
  return {
    minLength: PROFILE_CONSTANTS.DISPLAY_NAME.MIN_LENGTH,
    maxLength: PROFILE_CONSTANTS.DISPLAY_NAME.MAX_LENGTH,
    pattern: PROFILE_CONSTANTS.DISPLAY_NAME.ALLOWED_CHARACTERS.source,
    required: true,
    messages: {
      required: 'Display name is required',
      minLength: `Display name must be at least ${PROFILE_CONSTANTS.DISPLAY_NAME.MIN_LENGTH} character`,
      maxLength: `Display name must be no more than ${PROFILE_CONSTANTS.DISPLAY_NAME.MAX_LENGTH} characters`,
      pattern: 'Display name contains invalid characters',
    },
  }
}

/**
 * Format validation error for API response
 */
export function formatValidationError(
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
