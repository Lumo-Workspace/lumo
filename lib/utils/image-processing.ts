import sharp from 'sharp'

/**
 * Image processing utilities for avatar uploads
 * Handles resizing, format conversion, and optimization
 */

export interface ImageProcessingOptions {
  width: number
  height: number
  quality: number
  format: 'jpeg' | 'png' | 'webp'
}

export interface ProcessedImageResult {
  buffer: Buffer
  metadata: {
    originalSize: number
    processedSize: number
    dimensions: { width: number; height: number }
    format: string
  }
}

/**
 * Default processing options for avatars
 */
export const DEFAULT_AVATAR_OPTIONS: ImageProcessingOptions = {
  width: 200,
  height: 200,
  quality: 85,
  format: 'jpeg',
}

/**
 * Supported image formats for avatar uploads
 */
export const SUPPORTED_FORMATS = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const

/**
 * Maximum file size for avatar uploads (5MB)
 */
export const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

/**
 * Process and optimize an image for avatar use
 */
export async function processAvatarImage(
  inputBuffer: Buffer,
  options: Partial<ImageProcessingOptions> = {}
): Promise<ProcessedImageResult> {
  const config = { ...DEFAULT_AVATAR_OPTIONS, ...options }

  try {
    // Get original image metadata
    await sharp(inputBuffer).metadata()
    const originalSize = inputBuffer.length

    // Process the image
    const processedBuffer = await sharp(inputBuffer)
      .resize(config.width, config.height, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: config.quality })
      .toBuffer()

    // Get processed image metadata
    const processedMetadata = await sharp(processedBuffer).metadata()

    return {
      buffer: processedBuffer,
      metadata: {
        originalSize,
        processedSize: processedBuffer.length,
        dimensions: {
          width: processedMetadata.width || config.width,
          height: processedMetadata.height || config.height,
        },
        format: config.format,
      },
    }
  } catch (error) {
    throw new Error(
      `Image processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Validate image file before processing
 */
export function validateImageFile(file: File): {
  valid: boolean
  error?: string
} {
  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds maximum limit of ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
    }
  }

  // Check file type
  if (!SUPPORTED_FORMATS.includes(file.type as any)) {
    return {
      valid: false,
      error: `Unsupported file type. Supported formats: ${SUPPORTED_FORMATS.join(', ')}`,
    }
  }

  return { valid: true }
}

/**
 * Convert File to Buffer for processing
 */
export async function fileToBuffer(file: File): Promise<Buffer> {
  const arrayBuffer = await file.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Get image dimensions without processing
 */
export async function getImageDimensions(
  buffer: Buffer
): Promise<{ width: number; height: number }> {
  const metadata = await sharp(buffer).metadata()
  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
  }
}
