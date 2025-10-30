/**
 * Team and workspace URL utility functions
 */

// Reserved workspace URLs that cannot be used
const RESERVED_URLS = [
  'admin',
  'api',
  'www',
  'app',
  'login',
  'signup',
  'dashboard',
  'settings',
]

/**
 * Generate a URL-safe slug from a team name
 * @param teamName - The team name to convert
 * @returns A URL-safe slug (e.g., "Hello World!" → "hello-world")
 */
export function generateWorkspaceSlug(teamName: string): string {
  return teamName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .substring(0, 50) // Truncate to 50 characters
}

/**
 * Validate workspace URL format
 * @param url - The workspace URL to validate
 * @returns Object with `valid` boolean and optional `error` message
 */
export function validateWorkspaceUrl(url: string): {
  valid: boolean
  error?: string
} {
  // Check length
  if (url.length < 2 || url.length > 50) {
    return { valid: false, error: 'URL must be between 2 and 50 characters' }
  }

  // Check format: only lowercase letters, numbers, and hyphens
  if (!/^[a-z0-9-]+$/.test(url)) {
    return {
      valid: false,
      error: 'URL can only contain lowercase letters, numbers, and hyphens',
    }
  }

  // Check for reserved URLs
  if (RESERVED_URLS.includes(url)) {
    return { valid: false, error: `"${url}" is a reserved URL` }
  }

  // Check for leading/trailing hyphens
  if (url.startsWith('-') || url.endsWith('-')) {
    return { valid: false, error: 'URL cannot start or end with a hyphen' }
  }

  return { valid: true }
}

/**
 * Check if a workspace URL is available
 * This will be implemented with actual database query in the API route
 * @param url - The workspace URL to check
 * @param existingUrls - List of existing workspace URLs
 * @returns True if available, false otherwise
 */
export function isWorkspaceUrlAvailable(
  url: string,
  existingUrls: string[]
): boolean {
  return !existingUrls.includes(url)
}
