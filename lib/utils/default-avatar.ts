/**
 * Default avatar generation utilities
 * Creates SVG-based default avatars with user initials and consistent colors
 */

import { DefaultAvatarConfig } from '@/types/profile'

/**
 * Color palette for default avatars
 * Consistent, accessible colors that work well together
 */
const AVATAR_COLORS = [
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#96CEB4', // Green
  '#FFEAA7', // Yellow
  '#DDA0DD', // Plum
  '#98D8C8', // Mint
  '#F7DC6F', // Light Yellow
  '#BB8FCE', // Purple
  '#85C1E9', // Light Blue
  '#F8C471', // Orange
  '#82E0AA', // Light Green
] as const

/**
 * Generate a consistent color for a user based on their ID or name
 */
export function generateAvatarColor(identifier: string): string {
  // Create a simple hash from the identifier
  let hash = 0
  for (let i = 0; i < identifier.length; i++) {
    const char = identifier.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }

  // Use absolute value and modulo to get a valid array index
  const colorIndex = Math.abs(hash) % AVATAR_COLORS.length
  return AVATAR_COLORS[colorIndex] || AVATAR_COLORS[0] // Fallback to first color
}

/**
 * Extract initials from a display name or fallback to first character
 */
export function extractInitials(
  displayName?: string | null,
  fallbackName?: string | null
): string {
  const name = displayName || fallbackName || 'U'

  // Remove extra whitespace and split by spaces
  const words = name.trim().split(/\s+/)

  if (words.length === 1) {
    // Single word - use first character
    return words[0]?.charAt(0).toUpperCase() || 'U'
  } else {
    // Multiple words - use first character of first and last word
    const first = words[0]?.charAt(0).toUpperCase() || 'U'
    const last = words[words.length - 1]?.charAt(0).toUpperCase() || 'U'
    return first + last
  }
}

/**
 * Generate default avatar configuration
 */
export function generateDefaultAvatarConfig(
  displayName?: string | null,
  fallbackName?: string | null,
  userId?: string
): DefaultAvatarConfig {
  const initials = extractInitials(displayName, fallbackName)
  const identifier = userId || displayName || fallbackName || 'default'
  const backgroundColor = generateAvatarColor(identifier)

  // Calculate text color based on background brightness
  const textColor = getContrastingTextColor(backgroundColor)

  return {
    letter: initials,
    color: textColor,
    backgroundColor,
  }
}

/**
 * Calculate contrasting text color (black or white) based on background brightness
 */
function getContrastingTextColor(backgroundColor: string): string {
  // Remove # if present
  const hex = backgroundColor.replace('#', '')

  // Convert to RGB
  const r = parseInt(hex.substr(0, 2), 16)
  const g = parseInt(hex.substr(2, 2), 16)
  const b = parseInt(hex.substr(4, 2), 16)

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

  // Return black for light backgrounds, white for dark backgrounds
  return luminance > 0.5 ? '#000000' : '#FFFFFF'
}

/**
 * Generate SVG string for default avatar
 */
export function generateDefaultAvatarSVG(
  config: DefaultAvatarConfig,
  size: number = 200
): string {
  const { letter, color, backgroundColor } = config

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="${backgroundColor}" rx="${size * 0.1}"/>
      <text 
        x="50%" 
        y="50%" 
        text-anchor="middle" 
        dominant-baseline="central" 
        font-family="system-ui, -apple-system, sans-serif" 
        font-size="${size * 0.4}" 
        font-weight="600" 
        fill="${color}"
      >
        ${letter}
      </text>
    </svg>
  `.trim()
}

/**
 * Generate data URL for default avatar
 */
export function generateDefaultAvatarDataURL(
  displayName?: string | null,
  fallbackName?: string | null,
  userId?: string,
  size: number = 200
): string {
  const config = generateDefaultAvatarConfig(displayName, fallbackName, userId)
  const svg = generateDefaultAvatarSVG(config, size)
  const encodedSvg = encodeURIComponent(svg)
  return `data:image/svg+xml,${encodedSvg}`
}

/**
 * Generate default avatar URL for API endpoint
 */
export function generateDefaultAvatarURL(
  displayName?: string | null,
  fallbackName?: string | null,
  userId?: string
): string {
  const params = new URLSearchParams()

  if (displayName) params.set('name', displayName)
  if (fallbackName) params.set('fallback', fallbackName)
  if (userId) params.set('userId', userId)

  return `/api/avatar/default?${params.toString()}`
}

/**
 * Validate default avatar configuration
 */
export function validateDefaultAvatarConfig(config: DefaultAvatarConfig): {
  valid: boolean
  error?: string
} {
  if (!config.letter || config.letter.length === 0) {
    return { valid: false, error: 'Initials cannot be empty' }
  }

  if (config.letter.length > 2) {
    return { valid: false, error: 'Initials cannot be more than 2 characters' }
  }

  if (!config.backgroundColor || !config.color) {
    return { valid: false, error: 'Colors must be specified' }
  }

  // Validate hex color format
  const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/
  if (
    !hexColorRegex.test(config.backgroundColor) ||
    !hexColorRegex.test(config.color)
  ) {
    return { valid: false, error: 'Invalid color format' }
  }

  return { valid: true }
}

/**
 * Get avatar display properties for React components
 */
export function getAvatarDisplayProps(
  avatarUrl?: string | null,
  displayName?: string | null,
  fallbackName?: string | null,
  userId?: string
) {
  if (avatarUrl) {
    return {
      src: avatarUrl,
      alt: `${displayName || fallbackName || 'User'}'s avatar`,
      fallback: generateDefaultAvatarDataURL(displayName, fallbackName, userId),
    }
  }

  return {
    src: generateDefaultAvatarDataURL(displayName, fallbackName, userId),
    alt: `${displayName || fallbackName || 'User'}'s default avatar`,
    fallback: generateDefaultAvatarDataURL(displayName, fallbackName, userId),
  }
}
