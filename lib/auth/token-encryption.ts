import crypto from 'crypto'

/**
 * AES-256-GCM Token Encryption Utilities
 *
 * Security Requirements:
 * - SR-002: All OAuth tokens MUST be encrypted using AES-256-GCM
 * - SR-013: Support key rotation with graceful fallback
 * - SR-014: 96-bit IV for each encryption operation
 *
 * @see specs/001-google/requirements-token-management.md
 */

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16 // 128 bits for GCM auth tag
// const SALT_LENGTH = 32 // For key derivation (reserved for future use)

interface EncryptionResult {
  encrypted: string // Base64 encoded: iv:authTag:ciphertext
  success: boolean
  error?: string
}

interface DecryptionResult {
  decrypted: string | null
  success: boolean
  error?: string
}

/**
 * Get encryption key from environment
 * Supports key rotation via TOKEN_ENCRYPTION_KEY_PREVIOUS
 */
function getEncryptionKey(usePrevious = false): Buffer | null {
  const keyEnv = usePrevious
    ? 'TOKEN_ENCRYPTION_KEY_PREVIOUS'
    : 'TOKEN_ENCRYPTION_KEY'
  const key = process.env[keyEnv]

  if (!key) {
    return null
  }

  try {
    // Key should be base64 encoded 32-byte key
    const keyBuffer = Buffer.from(key, 'base64')
    if (keyBuffer.length !== 32) {
      console.error(
        `Invalid key length for ${keyEnv}: expected 32 bytes, got ${keyBuffer.length}`
      )
      return null
    }
    return keyBuffer
  } catch (error) {
    console.error(`Failed to decode ${keyEnv}:`, error)
    return null
  }
}

/**
 * Encrypt a token using AES-256-GCM
 *
 * @param plaintext - Token to encrypt
 * @returns Encrypted token in format: iv:authTag:ciphertext (all base64)
 */
export function encryptToken(plaintext: string): EncryptionResult {
  if (!plaintext) {
    return { encrypted: '', success: false, error: 'Empty plaintext' }
  }

  const key = getEncryptionKey()
  if (!key) {
    return {
      encrypted: '',
      success: false,
      error: 'TOKEN_ENCRYPTION_KEY not configured or invalid',
    }
  }

  try {
    // Generate random IV (96 bits)
    const iv = crypto.randomBytes(IV_LENGTH)

    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

    // Encrypt
    let encrypted = cipher.update(plaintext, 'utf8', 'base64')
    encrypted += cipher.final('base64')

    // Get auth tag
    const authTag = cipher.getAuthTag()

    // Combine iv:authTag:ciphertext (all base64)
    const result = `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`

    return { encrypted: result, success: true }
  } catch (error) {
    return {
      encrypted: '',
      success: false,
      error: error instanceof Error ? error.message : 'Encryption failed',
    }
  }
}

/**
 * Decrypt a token using AES-256-GCM
 * Supports automatic key rotation by trying current key first, then previous key
 *
 * @param ciphertext - Encrypted token in format: iv:authTag:ciphertext
 * @returns Decrypted token or null if decryption fails
 */
export function decryptToken(ciphertext: string): DecryptionResult {
  if (!ciphertext) {
    return { decrypted: null, success: false, error: 'Empty ciphertext' }
  }

  // Try current key first
  const resultCurrent = tryDecrypt(ciphertext, false)
  if (resultCurrent.success) {
    return resultCurrent
  }

  // Try previous key for key rotation support (SR-013)
  const resultPrevious = tryDecrypt(ciphertext, true)
  if (resultPrevious.success) {
    // TODO: Re-encrypt with current key in background (key rotation)
    return resultPrevious
  }

  return {
    decrypted: null,
    success: false,
    error: 'Decryption failed with both current and previous keys',
  }
}

/**
 * Internal function to attempt decryption with specified key
 */
function tryDecrypt(
  ciphertext: string,
  usePreviousKey: boolean
): DecryptionResult {
  const key = getEncryptionKey(usePreviousKey)
  if (!key) {
    return {
      decrypted: null,
      success: false,
      error: usePreviousKey
        ? 'Previous key not available'
        : 'Current key not available',
    }
  }

  try {
    // Parse iv:authTag:ciphertext
    const parts = ciphertext.split(':')
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      return {
        decrypted: null,
        success: false,
        error: 'Invalid ciphertext format (expected iv:authTag:ciphertext)',
      }
    }

    const iv = Buffer.from(parts[0], 'base64')
    const authTag = Buffer.from(parts[1], 'base64')
    const encrypted = parts[2]

    // Validate lengths
    if (iv.length !== IV_LENGTH) {
      return {
        decrypted: null,
        success: false,
        error: `Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`,
      }
    }
    if (authTag.length !== AUTH_TAG_LENGTH) {
      return {
        decrypted: null,
        success: false,
        error: `Invalid auth tag length: expected ${AUTH_TAG_LENGTH}, got ${authTag.length}`,
      }
    }

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    // Decrypt
    let decrypted = decipher.update(encrypted, 'base64', 'utf8')
    decrypted += decipher.final('utf8')

    return { decrypted, success: true }
  } catch (error) {
    return {
      decrypted: null,
      success: false,
      error: error instanceof Error ? error.message : 'Decryption failed',
    }
  }
}

/**
 * Validate that encryption keys are properly configured
 * Used during application startup and health checks
 */
export function validateEncryptionConfig(): {
  valid: boolean
  currentKeyValid: boolean
  previousKeyExists: boolean
  errors: string[]
} {
  const errors: string[] = []

  const currentKey = getEncryptionKey(false)
  const currentKeyValid = currentKey !== null

  if (!currentKeyValid) {
    errors.push('TOKEN_ENCRYPTION_KEY is missing or invalid')
  }

  const previousKey = getEncryptionKey(true)
  const previousKeyExists = previousKey !== null

  return {
    valid: currentKeyValid,
    currentKeyValid,
    previousKeyExists,
    errors,
  }
}
