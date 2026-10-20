/**
 * LUM-1063 — path-glob matching. LUM-1256: the body moved to
 * `shared/src/path-glob.ts` so the CLI's local scan matches a review
 * learning's path glob with the same code; this re-export keeps every
 * existing import working.
 */
export { matchPathGlob } from '@/shared/src/path-glob'
