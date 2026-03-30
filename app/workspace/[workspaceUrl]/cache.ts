/** TTL presets (ms) for stale-while-revalidate caching. */
export const CACHE_TTL = {
  /** Tasks, comments, descriptions — change often, stale data is misleading */
  short: 10 * 60 * 1000, // 10 minutes
  /** Members, projects — rarely change */
  long: 60 * 60 * 1000, // 1 hour
  /** Notifications — change very frequently */
  notifications: 5 * 60 * 1000, // 5 minutes
} as const

interface CacheEntry<T> {
  data: T
  ts: number // Date.now() when written
}

/**
 * Read a cached value from localStorage.
 * Returns `null` if missing, expired, or unparseable.
 * @param maxAge — optional TTL in ms; if omitted, entries never expire
 */
export function readCache<T>(key: string, maxAge?: number): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null

    const parsed = JSON.parse(raw)

    // Backwards compat: old entries are plain values (no .ts wrapper)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'ts' in parsed &&
      'data' in parsed
    ) {
      const entry = parsed as CacheEntry<T>
      if (maxAge !== undefined && Date.now() - entry.ts > maxAge) return null
      return entry.data
    }

    // Legacy plain value — treat as no-timestamp (always valid unless maxAge is set)
    if (maxAge !== undefined) return null // can't verify age of legacy entry
    return parsed as T
  } catch {
    return null
  }
}

/**
 * Write a value to localStorage with a timestamp.
 */
export function writeCache<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return
  try {
    const entry: CacheEntry<T> = { data, ts: Date.now() }
    localStorage.setItem(key, JSON.stringify(entry))
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
