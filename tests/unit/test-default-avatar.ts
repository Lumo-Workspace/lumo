/**
 * Unit tests for default avatar generation utilities
 * Tests default avatar creation, color generation, and SVG generation
 */

import {
  generateAvatarColor,
  extractInitials,
  generateDefaultAvatarConfig,
  generateDefaultAvatarSVG,
  generateDefaultAvatarDataURL,
  generateDefaultAvatarURL,
  validateDefaultAvatarConfig,
  getAvatarDisplayProps,
} from '@/lib/utils/default-avatar'

describe('Default Avatar Generation', () => {
  describe('generateAvatarColor', () => {
    it('should generate consistent colors for same identifier', () => {
      const color1 = generateAvatarColor('john-doe')
      const color2 = generateAvatarColor('john-doe')

      expect(color1).toBe(color2)
    })

    it('should generate different colors for different identifiers', () => {
      const color1 = generateAvatarColor('john-doe')
      const color2 = generateAvatarColor('jane-smith')

      expect(color1).not.toBe(color2)
    })

    it('should generate valid hex colors', () => {
      const colors = [
        generateAvatarColor('user1'),
        generateAvatarColor('user2'),
        generateAvatarColor('user3'),
        generateAvatarColor('user4'),
        generateAvatarColor('user5'),
      ]

      colors.forEach(color => {
        expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/)
      })
    })

    it('should handle empty identifiers', () => {
      const color = generateAvatarColor('')
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    })

    it('should handle special characters in identifiers', () => {
      const colors = [
        generateAvatarColor('user@domain.com'),
        generateAvatarColor('user-name_123'),
        generateAvatarColor('用户'),
        generateAvatarColor('🚀 user'),
      ]

      colors.forEach(color => {
        expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/)
      })
    })
  })

  describe('extractInitials', () => {
    it('should extract initials from single name', () => {
      expect(extractInitials('John')).toBe('J')
      expect(extractInitials('Alice')).toBe('A')
    })

    it('should extract initials from full name', () => {
      expect(extractInitials('John Doe')).toBe('JD')
      expect(extractInitials('Alice Smith')).toBe('AS')
    })

    it('should extract initials from multiple names', () => {
      expect(extractInitials('John Michael Doe')).toBe('JD')
      expect(extractInitials('Alice Mary Jane Smith')).toBe('AS')
    })

    it('should handle names with extra spaces', () => {
      expect(extractInitials('  John  Doe  ')).toBe('JD')
      expect(extractInitials('Alice   Smith')).toBe('AS')
    })

    it('should handle empty or null names', () => {
      expect(extractInitials('')).toBe('U')
      expect(extractInitials(null)).toBe('U')
      expect(extractInitials(undefined)).toBe('U')
    })

    it('should handle fallback names', () => {
      expect(extractInitials('', 'john@example.com')).toBe('J')
      expect(extractInitials(null, 'alice@example.com')).toBe('A')
    })

    it('should handle Unicode names', () => {
      expect(extractInitials('José María')).toBe('JM')
      expect(extractInitials('李小明')).toBe('李')
      expect(extractInitials('Александр Петров')).toBe('АП')
    })

    it('should handle names with emojis', () => {
      expect(extractInitials('John 🚀')).toBe('J')
      expect(extractInitials('Alice 💻 Smith')).toBe('AS')
    })
  })

  describe('generateDefaultAvatarConfig', () => {
    it('should generate config with display name', () => {
      const config = generateDefaultAvatarConfig('John Doe', null, 'user-123')

      expect(config.letter).toBe('JD')
      expect(config.backgroundColor).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(config.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    })

    it('should generate config with fallback name', () => {
      const config = generateDefaultAvatarConfig(
        null,
        'john@example.com',
        'user-123'
      )

      expect(config.letter).toBe('J')
      expect(config.backgroundColor).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(config.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    })

    it('should generate config with user ID', () => {
      const config = generateDefaultAvatarConfig(null, null, 'user-123')

      expect(config.letter).toBe('U')
      expect(config.backgroundColor).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(config.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    })

    it('should generate contrasting text colors', () => {
      const lightConfig = generateDefaultAvatarConfig(
        'Test User',
        null,
        'light-user'
      )
      const darkConfig = generateDefaultAvatarConfig(
        'Test User',
        null,
        'dark-user'
      )

      // At least one should be different (though not guaranteed due to hash)
      expect(lightConfig.color).toMatch(/^#(000000|FFFFFF)$/)
      expect(darkConfig.color).toMatch(/^#(000000|FFFFFF)$/)
    })
  })

  describe('generateDefaultAvatarSVG', () => {
    it('should generate valid SVG', () => {
      const config = generateDefaultAvatarConfig('John Doe', null, 'user-123')
      const svg = generateDefaultAvatarSVG(config)

      expect(svg).toContain('<svg')
      expect(svg).toContain('width="200"')
      expect(svg).toContain('height="200"')
      expect(svg).toContain('<rect')
      expect(svg).toContain('<text')
      expect(svg).toContain('JD')
      expect(svg).toContain(config.backgroundColor)
      expect(svg).toContain(config.color)
    })

    it('should generate SVG with custom size', () => {
      const config = generateDefaultAvatarConfig('John Doe', null, 'user-123')
      const svg = generateDefaultAvatarSVG(config, 100)

      expect(svg).toContain('width="100"')
      expect(svg).toContain('height="100"')
    })

    it('should include proper SVG attributes', () => {
      const config = generateDefaultAvatarConfig('John Doe', null, 'user-123')
      const svg = generateDefaultAvatarSVG(config)

      expect(svg).toContain('viewBox="0 0 200 200"')
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
      expect(svg).toContain('text-anchor="middle"')
      expect(svg).toContain('dominant-baseline="central"')
    })
  })

  describe('generateDefaultAvatarDataURL', () => {
    it('should generate valid data URL', () => {
      const dataUrl = generateDefaultAvatarDataURL('John Doe', null, 'user-123')

      expect(dataUrl).toMatch(/^data:image\/svg\+xml,/)
      expect(dataUrl).toContain(encodeURIComponent('<svg'))
    })

    it('should generate data URL with custom size', () => {
      const dataUrl = generateDefaultAvatarDataURL(
        'John Doe',
        null,
        'user-123',
        100
      )

      expect(dataUrl).toContain(encodeURIComponent('width="100"'))
    })
  })

  describe('generateDefaultAvatarURL', () => {
    it('should generate API URL with parameters', () => {
      const url = generateDefaultAvatarURL(
        'John Doe',
        'john@example.com',
        'user-123'
      )

      expect(url).toContain('/api/avatar/default?')
      expect(url).toContain('name=John%20Doe')
      expect(url).toContain('fallback=john%40example.com')
      expect(url).toContain('userId=user-123')
    })

    it('should handle missing parameters', () => {
      const url = generateDefaultAvatarURL(undefined, undefined, undefined)

      expect(url).toBe('/api/avatar/default?')
    })
  })

  describe('validateDefaultAvatarConfig', () => {
    it('should validate correct config', () => {
      const config = generateDefaultAvatarConfig('John Doe', null, 'user-123')
      const result = validateDefaultAvatarConfig(config)

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should reject empty initials', () => {
      const config = {
        letter: '',
        color: '#FFFFFF',
        backgroundColor: '#000000',
      }

      const result = validateDefaultAvatarConfig(config)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Initials cannot be empty')
    })

    it('should reject initials that are too long', () => {
      const config = {
        letter: 'ABC',
        color: '#FFFFFF',
        backgroundColor: '#000000',
      }

      const result = validateDefaultAvatarConfig(config)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Initials cannot be more than 2 characters')
    })

    it('should reject invalid color formats', () => {
      const config = {
        letter: 'JD',
        color: 'invalid-color',
        backgroundColor: '#000000',
      }

      const result = validateDefaultAvatarConfig(config)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid color format')
    })

    it('should accept 3-character hex colors', () => {
      const config = {
        letter: 'JD',
        color: '#FFF',
        backgroundColor: '#000',
      }

      const result = validateDefaultAvatarConfig(config)

      expect(result.valid).toBe(true)
    })
  })

  describe('getAvatarDisplayProps', () => {
    it('should return props for existing avatar', () => {
      const props = getAvatarDisplayProps(
        'https://example.com/avatar.jpg',
        'John Doe',
        'john@example.com',
        'user-123'
      )

      expect(props.src).toBe('https://example.com/avatar.jpg')
      expect(props.alt).toBe("John Doe's avatar")
      expect(props.fallback).toContain('data:image/svg+xml,')
    })

    it('should return props for default avatar', () => {
      const props = getAvatarDisplayProps(
        null,
        'John Doe',
        'john@example.com',
        'user-123'
      )

      expect(props.src).toContain('data:image/svg+xml,')
      expect(props.alt).toBe("John Doe's default avatar")
      expect(props.fallback).toContain('data:image/svg+xml,')
    })

    it('should handle missing names gracefully', () => {
      const props = getAvatarDisplayProps(null, null, null, 'user-123')

      expect(props.alt).toBe("User's default avatar")
      expect(props.src).toContain('data:image/svg+xml,')
    })
  })

  describe('performance', () => {
    it('should generate avatars quickly', () => {
      const startTime = Date.now()

      for (let i = 0; i < 100; i++) {
        generateDefaultAvatarConfig(`User ${i}`, null, `user-${i}`)
      }

      const endTime = Date.now()
      const generationTime = endTime - startTime

      // Should generate 100 avatars in less than 100ms
      expect(generationTime).toBeLessThan(100)
    })

    it('should generate SVG quickly', () => {
      const config = generateDefaultAvatarConfig('John Doe', null, 'user-123')
      const startTime = Date.now()

      for (let i = 0; i < 100; i++) {
        generateDefaultAvatarSVG(config)
      }

      const endTime = Date.now()
      const svgTime = endTime - startTime

      // Should generate 100 SVGs in less than 50ms
      expect(svgTime).toBeLessThan(50)
    })
  })
})
