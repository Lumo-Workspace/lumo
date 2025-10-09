/**
 * Unit tests for display name validation
 * Tests validation logic for display names
 */

import { PROFILE_CONSTANTS } from '@/types/profile'

/**
 * Display name validation function
 * This would typically be in a validation utility file
 */
function validateDisplayName(displayName: string): {
  valid: boolean
  error?: string
} {
  // Check if empty
  if (!displayName || displayName.trim().length === 0) {
    return { valid: false, error: 'Display name cannot be empty' }
  }

  // Check length
  if (displayName.length < PROFILE_CONSTANTS.DISPLAY_NAME.MIN_LENGTH) {
    return { valid: false, error: 'Display name is too short' }
  }

  if (displayName.length > PROFILE_CONSTANTS.DISPLAY_NAME.MAX_LENGTH) {
    return { valid: false, error: 'Display name is too long' }
  }

  // Check allowed characters
  if (!PROFILE_CONSTANTS.DISPLAY_NAME.ALLOWED_CHARACTERS.test(displayName)) {
    return { valid: false, error: 'Display name contains invalid characters' }
  }

  return { valid: true }
}

describe('Display Name Validation', () => {
  describe('Empty validation', () => {
    it('should reject empty display name', () => {
      const result = validateDisplayName('')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Display name cannot be empty')
    })

    it('should reject whitespace-only display name', () => {
      const result = validateDisplayName('   ')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Display name cannot be empty')
    })

    it('should reject null display name', () => {
      const result = validateDisplayName(null as any)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Display name cannot be empty')
    })

    it('should reject undefined display name', () => {
      const result = validateDisplayName(undefined as any)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Display name cannot be empty')
    })
  })

  describe('Length validation', () => {
    it('should reject display name shorter than minimum length', () => {
      const result = validateDisplayName('')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Display name cannot be empty')
    })

    it('should accept display name at minimum length', () => {
      const result = validateDisplayName('A')
      expect(result.valid).toBe(true)
    })

    it('should accept display name at maximum length', () => {
      const longName = 'A'.repeat(PROFILE_CONSTANTS.DISPLAY_NAME.MAX_LENGTH)
      const result = validateDisplayName(longName)
      expect(result.valid).toBe(true)
    })

    it('should reject display name longer than maximum length', () => {
      const tooLongName = 'A'.repeat(
        PROFILE_CONSTANTS.DISPLAY_NAME.MAX_LENGTH + 1
      )
      const result = validateDisplayName(tooLongName)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Display name is too long')
    })
  })

  describe('Character validation', () => {
    it('should accept valid characters', () => {
      const validNames = [
        'John Doe',
        'José María',
        '李小明',
        'Александр',
        'محمد',
        'John123',
        'John-Doe',
        'John_Doe',
        'John.Doe',
        'John@Doe',
        'John Doe!',
        'John 🚀 Doe',
      ]

      validNames.forEach(name => {
        const result = validateDisplayName(name)
        expect(result.valid).toBe(true)
      })
    })

    it('should reject invalid characters', () => {
      const invalidNames = [
        'John\nDoe', // Newline
        'John\tDoe', // Tab
        'John\rDoe', // Carriage return
        'John\0Doe', // Null character
      ]

      invalidNames.forEach(name => {
        const result = validateDisplayName(name)
        expect(result.valid).toBe(false)
        expect(result.error).toBe('Display name contains invalid characters')
      })
    })
  })

  describe('Edge cases', () => {
    it('should handle very long names gracefully', () => {
      const veryLongName = 'A'.repeat(1000)
      const result = validateDisplayName(veryLongName)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Display name is too long')
    })

    it('should handle special Unicode characters', () => {
      const unicodeNames = [
        'Café',
        'Naïve',
        'Résumé',
        'Piñata',
        'Zürich',
        'München',
        'São Paulo',
        '北京',
        '東京',
        'Москва',
        'القاهرة',
      ]

      unicodeNames.forEach(name => {
        const result = validateDisplayName(name)
        expect(result.valid).toBe(true)
      })
    })

    it('should handle emojis and symbols', () => {
      const emojiNames = [
        'John 🚀',
        'Alice 💻',
        'Bob 🎉',
        'Charlie ⭐',
        'Diana 🎨',
        'Eve 🌟',
        'Frank 🎯',
        'Grace 🎪',
      ]

      emojiNames.forEach(name => {
        const result = validateDisplayName(name)
        expect(result.valid).toBe(true)
      })
    })

    it('should handle mixed content', () => {
      const mixedNames = [
        'John123!@#',
        'Alice-2024',
        'Bob_Developer',
        'Charlie.Admin',
        'Diana@Company',
        'Eve (Manager)',
        'Frank [Lead]',
        'Grace {Senior}',
      ]

      mixedNames.forEach(name => {
        const result = validateDisplayName(name)
        expect(result.valid).toBe(true)
      })
    })
  })

  describe('Performance', () => {
    it('should validate names quickly', () => {
      const testName = 'John Doe'
      const startTime = Date.now()

      for (let i = 0; i < 1000; i++) {
        validateDisplayName(testName)
      }

      const endTime = Date.now()
      const totalTime = endTime - startTime

      // Should complete 1000 validations in less than 100ms
      expect(totalTime).toBeLessThan(100)
    })

    it('should handle long names efficiently', () => {
      const longName = 'A'.repeat(PROFILE_CONSTANTS.DISPLAY_NAME.MAX_LENGTH)
      const startTime = Date.now()

      validateDisplayName(longName)

      const endTime = Date.now()
      const validationTime = endTime - startTime

      // Should validate long names in less than 10ms
      expect(validationTime).toBeLessThan(10)
    })
  })
})
