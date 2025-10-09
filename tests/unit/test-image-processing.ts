/**
 * Unit tests for image processing utilities
 * Tests image processing, validation, and conversion functions
 */

import {
  processAvatarImage,
  validateImageFile,
  fileToBuffer,
  getImageDimensions,
  DEFAULT_AVATAR_OPTIONS,
  SUPPORTED_FORMATS,
  MAX_FILE_SIZE,
} from '@/lib/utils/image-processing'

// Mock Sharp
jest.mock('sharp', () => {
  return jest.fn().mockImplementation(() => ({
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed-image')),
    metadata: jest.fn().mockResolvedValue({
      width: 200,
      height: 200,
      format: 'jpeg',
    }),
  }))
})

describe('Image Processing Utilities', () => {
  describe('validateImageFile', () => {
    it('should validate valid image files', () => {
      const validFiles = [
        new File(['test'], 'avatar.jpg', { type: 'image/jpeg' }),
        new File(['test'], 'avatar.png', { type: 'image/png' }),
        new File(['test'], 'avatar.gif', { type: 'image/gif' }),
        new File(['test'], 'avatar.webp', { type: 'image/webp' }),
        new File(['test'], 'avatar.svg', { type: 'image/svg+xml' }),
      ]

      validFiles.forEach(file => {
        const result = validateImageFile(file)
        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
      })
    })

    it('should reject files that are too large', () => {
      const largeFile = new File(['x'.repeat(MAX_FILE_SIZE + 1)], 'large.jpg', {
        type: 'image/jpeg',
      })
      const result = validateImageFile(largeFile)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('File size exceeds maximum limit')
    })

    it('should reject unsupported file types', () => {
      const unsupportedFiles = [
        new File(['test'], 'document.pdf', { type: 'application/pdf' }),
        new File(['test'], 'text.txt', { type: 'text/plain' }),
        new File(['test'], 'video.mp4', { type: 'video/mp4' }),
      ]

      unsupportedFiles.forEach(file => {
        const result = validateImageFile(file)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('Unsupported file type')
      })
    })

    it('should list supported formats in error message', () => {
      const unsupportedFile = new File(['test'], 'document.pdf', {
        type: 'application/pdf',
      })
      const result = validateImageFile(unsupportedFile)

      expect(result.error).toContain('Supported formats:')
      SUPPORTED_FORMATS.forEach(format => {
        expect(result.error).toContain(format)
      })
    })
  })

  describe('fileToBuffer', () => {
    it('should convert File to Buffer', async () => {
      const file = new File(['test content'], 'test.jpg', {
        type: 'image/jpeg',
      })
      const buffer = await fileToBuffer(file)

      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.toString()).toBe('test content')
    })

    it('should handle empty files', async () => {
      const file = new File([''], 'empty.jpg', { type: 'image/jpeg' })
      const buffer = await fileToBuffer(file)

      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.length).toBe(0)
    })
  })

  describe('processAvatarImage', () => {
    it('should process image with default options', async () => {
      const inputBuffer = Buffer.from('test image')
      const result = await processAvatarImage(inputBuffer)

      expect(result.buffer).toBeInstanceOf(Buffer)
      expect(result.metadata).toEqual({
        originalSize: inputBuffer.length,
        processedSize: expect.any(Number),
        dimensions: { width: 200, height: 200 },
        format: 'jpeg',
      })
    })

    it('should process image with custom options', async () => {
      const inputBuffer = Buffer.from('test image')
      const customOptions = {
        width: 150,
        height: 150,
        quality: 90,
        format: 'png' as const,
      }

      const result = await processAvatarImage(inputBuffer, customOptions)

      expect(result.metadata.dimensions).toEqual({ width: 150, height: 150 })
    })

    it('should handle processing errors', async () => {
      const { default: sharp } = await import('sharp')
      const mockSharp = sharp as jest.MockedFunction<any>

      mockSharp.mockImplementationOnce(() => ({
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockRejectedValue(new Error('Processing failed')),
      }))

      const inputBuffer = Buffer.from('test image')

      await expect(processAvatarImage(inputBuffer)).rejects.toThrow(
        'Image processing failed'
      )
    })

    it('should preserve original size in metadata', async () => {
      const inputBuffer = Buffer.from('test image content')
      const result = await processAvatarImage(inputBuffer)

      expect(result.metadata.originalSize).toBe(inputBuffer.length)
    })
  })

  describe('getImageDimensions', () => {
    it('should get image dimensions', async () => {
      const inputBuffer = Buffer.from('test image')
      const dimensions = await getImageDimensions(inputBuffer)

      expect(dimensions).toEqual({ width: 200, height: 200 })
    })

    it('should handle missing dimensions', async () => {
      const { default: sharp } = await import('sharp')
      const mockSharp = sharp as jest.MockedFunction<any>

      mockSharp.mockImplementationOnce(() => ({
        metadata: jest.fn().mockResolvedValue({
          width: null,
          height: null,
        }),
      }))

      const inputBuffer = Buffer.from('test image')
      const dimensions = await getImageDimensions(inputBuffer)

      expect(dimensions).toEqual({ width: 0, height: 0 })
    })
  })

  describe('constants', () => {
    it('should have correct default avatar options', () => {
      expect(DEFAULT_AVATAR_OPTIONS).toEqual({
        width: 200,
        height: 200,
        quality: 85,
        format: 'jpeg',
      })
    })

    it('should have correct supported formats', () => {
      expect(SUPPORTED_FORMATS).toContain('image/jpeg')
      expect(SUPPORTED_FORMATS).toContain('image/png')
      expect(SUPPORTED_FORMATS).toContain('image/gif')
      expect(SUPPORTED_FORMATS).toContain('image/webp')
      expect(SUPPORTED_FORMATS).toContain('image/svg+xml')
    })

    it('should have correct max file size', () => {
      expect(MAX_FILE_SIZE).toBe(5 * 1024 * 1024) // 5MB
    })
  })

  describe('performance', () => {
    it('should process images efficiently', async () => {
      const inputBuffer = Buffer.from('test image')
      const startTime = Date.now()

      await processAvatarImage(inputBuffer)

      const endTime = Date.now()
      const processingTime = endTime - startTime

      // Should process images in less than 5 seconds
      expect(processingTime).toBeLessThan(5000)
    })

    it('should validate files quickly', () => {
      const file = new File(['test'], 'avatar.jpg', { type: 'image/jpeg' })
      const startTime = Date.now()

      for (let i = 0; i < 1000; i++) {
        validateImageFile(file)
      }

      const endTime = Date.now()
      const validationTime = endTime - startTime

      // Should validate 1000 files in less than 100ms
      expect(validationTime).toBeLessThan(100)
    })
  })
})
