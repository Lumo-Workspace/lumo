/**
 * Read a non-empty string field off a raw hook payload (already-parsed JSON of
 * unknown shape). Returns null when the payload isn't an object, the field is
 * missing, or the value isn't a non-empty string. Shared by hook routes/services
 * that need to pull specific fields out of the untyped Claude Code payload.
 */
export function getStringField(payload: unknown, field: string): string | null {
  if (payload && typeof payload === 'object') {
    const value = (payload as Record<string, unknown>)[field]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}
