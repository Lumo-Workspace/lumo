// Single source of truth lives in shared/src/sanitize.ts (LUM-346) — the
// server applies the same character class at its untrusted render boundary.
export { sanitizeField } from '../../../shared/src/sanitize'
