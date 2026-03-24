export function readCache<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeCache<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(data))
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
