/**
 * Token Encryption Unit Tests
 *
 * Tests AES-256-GCM encryption/decryption functionality
 *
 * Requirements:
 * - SR-002: All OAuth tokens MUST be encrypted using AES-256-GCM
 * - SR-013: Support key rotation with graceful fallback
 * - SR-014: 96-bit IV for each encryption operation
 */

import {
  encryptToken,
  decryptToken,
  validateEncryptionConfig,
} from '@/lib/auth/token-encryption'

describe('Token Encryption', () => {
  const originalEnv = process.env

  beforeEach(() => {
    // Reset environment before each test
    jest.resetModules()
    process.env = { ...originalEnv }
    // Set a valid 32-byte key (base64 encoded)
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from(
      'test-encryption-key-32-bytes!!'
    ).toString('base64')
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('encryptToken', () => {
    it('should encrypt a plaintext token successfully', () => {
      const plaintext = 'test-access-token-12345'
      const result = encryptToken(plaintext)

      expect(result.success).toBe(true)
      expect(result.encrypted).toBeTruthy()
      expect(result.error).toBeUndefined()
    })

    it('should return encrypted token in format iv:authTag:ciphertext', () => {
      const plaintext = 'test-token'
      const result = encryptToken(plaintext)

      expect(result.success).toBe(true)
      const parts = result.encrypted.split(':')
      expect(parts).toHaveLength(3) // iv:authTag:ciphertext

      // Verify each part is valid base64
      parts.forEach(part => {
        expect(Buffer.from(part, 'base64').toString('base64')).toBe(part)
      })
    })

    it('should generate different IVs for same plaintext', () => {
      const plaintext = 'test-token'
      const result1 = encryptToken(plaintext)
      const result2 = encryptToken(plaintext)

      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      expect(result1.encrypted).not.toBe(result2.encrypted) // Different IVs = different output
    })

    it('should fail with empty plaintext', () => {
      const result = encryptToken('')

      expect(result.success).toBe(false)
      expect(result.encrypted).toBe('')
      expect(result.error).toBe('Empty plaintext')
    })

    it('should fail when TOKEN_ENCRYPTION_KEY is not set', () => {
      delete process.env.TOKEN_ENCRYPTION_KEY

      const result = encryptToken('test-token')

      expect(result.success).toBe(false)
      expect(result.error).toContain('TOKEN_ENCRYPTION_KEY not configured')
    })

    it('should fail when TOKEN_ENCRYPTION_KEY has invalid length', () => {
      // Set a key that's not 32 bytes
      process.env.TOKEN_ENCRYPTION_KEY =
        Buffer.from('short-key').toString('base64')

      const result = encryptToken('test-token')

      expect(result.success).toBe(false)
      expect(result.error).toContain(
        'TOKEN_ENCRYPTION_KEY not configured or invalid'
      )
    })
  })

  describe('decryptToken', () => {
    it('should decrypt a valid encrypted token', () => {
      const plaintext = 'test-access-token-12345'
      const encResult = encryptToken(plaintext)

      expect(encResult.success).toBe(true)

      const decResult = decryptToken(encResult.encrypted)

      expect(decResult.success).toBe(true)
      expect(decResult.decrypted).toBe(plaintext)
      expect(decResult.error).toBeUndefined()
    })

    it('should fail with empty ciphertext', () => {
      const result = decryptToken('')

      expect(result.success).toBe(false)
      expect(result.decrypted).toBeNull()
      expect(result.error).toBe('Empty ciphertext')
    })

    it('should fail with invalid ciphertext format', () => {
      const result = decryptToken('invalid-format')

      expect(result.success).toBe(false)
      expect(result.decrypted).toBeNull()
      expect(result.error).toContain('Invalid ciphertext format')
    })

    it('should fail with tampered ciphertext (authentication check)', () => {
      const plaintext = 'test-token'
      const encResult = encryptToken(plaintext)

      // Tamper with the ciphertext
      const parts = encResult.encrypted.split(':')
      parts[2] = Buffer.from('tampered').toString('base64')
      const tamperedCiphertext = parts.join(':')

      const decResult = decryptToken(tamperedCiphertext)

      expect(decResult.success).toBe(false)
      expect(decResult.decrypted).toBeNull()
    })

    it('should fail with wrong decryption key', () => {
      const plaintext = 'test-token'
      const encResult = encryptToken(plaintext)

      // Change the encryption key
      process.env.TOKEN_ENCRYPTION_KEY = Buffer.from(
        'different-key-32-bytes-long!!'
      ).toString('base64')

      const decResult = decryptToken(encResult.encrypted)

      expect(decResult.success).toBe(false)
      expect(decResult.decrypted).toBeNull()
    })
  })

  describe('Key Rotation Support (SR-013)', () => {
    it('should decrypt with previous key when current key fails', () => {
      // Encrypt with current key
      const plaintext = 'test-token'
      const encResult = encryptToken(plaintext)

      expect(encResult.success).toBe(true)

      // Rotate keys: current -> previous, set new current
      process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS =
        process.env.TOKEN_ENCRYPTION_KEY
      process.env.TOKEN_ENCRYPTION_KEY = Buffer.from(
        'new-encryption-key-32-bytes!!!'
      ).toString('base64')

      // Should still decrypt using previous key
      const decResult = decryptToken(encResult.encrypted)

      expect(decResult.success).toBe(true)
      expect(decResult.decrypted).toBe(plaintext)
    })

    it('should prefer current key over previous key', () => {
      // Set both keys
      process.env.TOKEN_ENCRYPTION_KEY = Buffer.from(
        'current-key-32-bytes-long!!!!'
      ).toString('base64')
      process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = Buffer.from(
        'previous-key-32-bytes-long!!!'
      ).toString('base64')

      // Encrypt with current key
      const plaintext = 'test-token'
      const encResult = encryptToken(plaintext)

      // Should decrypt with current key (not previous)
      const decResult = decryptToken(encResult.encrypted)

      expect(decResult.success).toBe(true)
      expect(decResult.decrypted).toBe(plaintext)
    })
  })

  describe('validateEncryptionConfig', () => {
    it('should validate when current key is set correctly', () => {
      const result = validateEncryptionConfig()

      expect(result.valid).toBe(true)
      expect(result.currentKeyValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should fail validation when current key is missing', () => {
      delete process.env.TOKEN_ENCRYPTION_KEY

      const result = validateEncryptionConfig()

      expect(result.valid).toBe(false)
      expect(result.currentKeyValid).toBe(false)
      expect(result.errors).toContain(
        'TOKEN_ENCRYPTION_KEY is missing or invalid'
      )
    })

    it('should detect previous key when set', () => {
      process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = Buffer.from(
        'previous-key-32-bytes-long!!!'
      ).toString('base64')

      const result = validateEncryptionConfig()

      expect(result.valid).toBe(true)
      expect(result.previousKeyExists).toBe(true)
    })

    it('should handle missing previous key gracefully', () => {
      delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS

      const result = validateEncryptionConfig()

      expect(result.valid).toBe(true) // Still valid without previous key
      expect(result.previousKeyExists).toBe(false)
    })
  })

  describe('IV and Auth Tag Requirements (SR-014)', () => {
    it('should use 96-bit (12-byte) IV', () => {
      const plaintext = 'test-token'
      const result = encryptToken(plaintext)

      const parts = result.encrypted.split(':')
      const iv = Buffer.from(parts[0], 'base64')

      expect(iv.length).toBe(12) // 96 bits = 12 bytes
    })

    it('should use 128-bit (16-byte) auth tag', () => {
      const plaintext = 'test-token'
      const result = encryptToken(plaintext)

      const parts = result.encrypted.split(':')
      const authTag = Buffer.from(parts[1], 'base64')

      expect(authTag.length).toBe(16) // 128 bits = 16 bytes
    })
  })

  describe('End-to-End Encryption/Decryption', () => {
    it('should handle long tokens (refresh tokens)', () => {
      const longToken = 'a'.repeat(1000) // 1000 character token

      const encResult = encryptToken(longToken)
      expect(encResult.success).toBe(true)

      const decResult = decryptToken(encResult.encrypted)
      expect(decResult.success).toBe(true)
      expect(decResult.decrypted).toBe(longToken)
    })

    it('should handle special characters and unicode', () => {
      const specialToken =
        'token-with-special-chars-!@#$%^&*()_+-={}[]|:";\'<>?,./™€£¥'

      const encResult = encryptToken(specialToken)
      expect(encResult.success).toBe(true)

      const decResult = decryptToken(encResult.encrypted)
      expect(decResult.success).toBe(true)
      expect(decResult.decrypted).toBe(specialToken)
    })
  })
})
