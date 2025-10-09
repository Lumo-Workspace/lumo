/**
 * Type definitions for Account Management feature
 * Profile management types and interfaces
 */

export interface UserProfile {
  id: string
  displayName?: string | null
  avatarUrl?: string | null
  avatarBlobId?: string | null
  email?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface UpdateProfileRequest {
  displayName?: string
}

export interface AvatarUploadResponse {
  avatarUrl: string
  avatarBlobId: string
  metadata: {
    originalSize: number
    processedSize: number
    dimensions: {
      width: number
      height: number
    }
    format: string
  }
}

export interface ProfileUpdateEvent {
  type: 'profile_updated'
  userId: string
  changes: {
    displayName?: string
    avatarUrl?: string
  }
  timestamp: Date
}

export interface AvatarMetadata {
  originalSize: number
  processedSize: number
  format: string
  dimensions: {
    width: number
    height: number
  }
  uploadTimestamp: Date
}

export interface DefaultAvatarConfig {
  letter: string
  color: string
  backgroundColor: string
}

export interface ProfileValidationError {
  field: string
  message: string
  code: string
}

export interface ProfileUpdateResult {
  success: boolean
  profile?: UserProfile
  errors?: ProfileValidationError[]
}

export interface RealTimeUpdateSubscription {
  userId: string
  callback: (event: ProfileUpdateEvent) => void
  unsubscribe: () => void
}

// Form validation schemas
export interface DisplayNameValidation {
  required: boolean
  minLength: number
  maxLength: number
  pattern?: RegExp
  allowedCharacters: string[]
}

export interface AvatarValidation {
  maxFileSize: number
  allowedFormats: string[]
  maxDimensions: {
    width: number
    height: number
  }
  minDimensions: {
    width: number
    height: number
  }
}

// API response types
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  code?: string
}

export interface ProfileApiResponse extends ApiResponse<UserProfile> {}
export interface AvatarApiResponse extends ApiResponse<AvatarUploadResponse> {}

// Error types
export interface ProfileError extends Error {
  code: string
  field?: string | undefined
  details?: any
}

export class ValidationError extends Error implements ProfileError {
  code: string
  field?: string | undefined
  details?: any

  constructor(message: string, code: string, field?: string, details?: any) {
    super(message)
    this.name = 'ValidationError'
    this.code = code
    this.field = field
    this.details = details
  }
}

export class UploadError extends Error implements ProfileError {
  code: string
  field?: string | undefined
  details?: any

  constructor(message: string, code: string, field?: string, details?: any) {
    super(message)
    this.name = 'UploadError'
    this.code = code
    this.field = field
    this.details = details
  }
}

// Constants
export const PROFILE_CONSTANTS = {
  DISPLAY_NAME: {
    MIN_LENGTH: 1,
    MAX_LENGTH: 100,
    ALLOWED_CHARACTERS: /^[\p{L}\p{N}\p{P}\p{S}\p{Z}]*$/u, // Unicode letters, numbers, punctuation, symbols, spaces
  },
  AVATAR: {
    MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
    SUPPORTED_FORMATS: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
    ],
    TARGET_DIMENSIONS: { width: 200, height: 200 },
    QUALITY: 85,
  },
  REAL_TIME: {
    UPDATE_TIMEOUT: 5000, // 5 seconds
    RECONNECTION_DELAY: 1000, // 1 second
    MAX_RECONNECTION_ATTEMPTS: 5,
  },
} as const

// Utility types
export type ProfileField = keyof Pick<UserProfile, 'displayName' | 'avatarUrl'>
export type ProfileUpdateType = 'displayName' | 'avatar' | 'both'
export type AvatarFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'svg'
