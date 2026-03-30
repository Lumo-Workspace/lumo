export function readCache<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null

    const parsed = JSON.parse(raw)

    // New format: { data, ts } wrapper
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'ts' in parsed &&
      'data' in parsed
    ) {
      return (parsed as { data: T }).data
    }

    // Legacy plain value
    return parsed as T
  } catch {
    return null
  }
}

export function writeCache<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }))
  } catch {
    /* quota exceeded or private mode */
  }
}

/** Remove all `lumo:*` cache entries from localStorage. Call on sign-out. */
export function clearCache(): void {
  if (typeof window === 'undefined') return
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('lumo:'))
    keys.forEach(k => localStorage.removeItem(k))
  } catch {
    /* private mode */
  }
}
