/**
 * Extract up to 2 initials from a display name.
 * Handles multiple spaces, leading/trailing whitespace.
 */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}
