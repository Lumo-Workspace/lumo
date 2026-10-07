/** Which storage a sliding-window limiter runs on. See `backend.ts`. */
export type RateLimitBackendKind = 'kv' | 'redis' | 'memory'

export interface SlidingWindowOptions {
  /** Key prefix, unique per limiter (e.g. `sarif:rate`). */
  prefix: string
  /** Max requests allowed per key inside the window. */
  max: number
  /** Window length in milliseconds. */
  windowMs: number
}

export interface SlidingWindowResult {
  success: boolean
  /** Requests still allowed in the current window after this one. */
  remaining: number
  /** Backend that served this check. */
  backend: RateLimitBackendKind
}

/** One sliding-window limiter bound to a single backend. */
export interface SlidingWindowStore {
  /** Records a hit for `key` (unless already over the limit). */
  limit(key: string): Promise<Omit<SlidingWindowResult, 'backend'>>
  /** Test-only: drop local state (memory window / lazily built clients). */
  reset(): void
}
