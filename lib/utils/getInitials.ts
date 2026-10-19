/**
 * Extract up to `max` (default 2) initials from a display name: the first
 * letter of each of the first words. Handles multiple spaces and
 * leading/trailing whitespace; a blank name yields '?'.
 */
export function getInitials(name: string, max = 2): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, Math.max(1, max))
    .map(p => p[0] ?? '')
    .join('')
    .toUpperCase()
}
