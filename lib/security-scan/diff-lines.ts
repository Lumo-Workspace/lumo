/**
 * LUM-1060 — the diff parser moved to the core (`lib/diff/diff-lines`); this
 * re-export keeps the plugin-side importers unchanged until they move with
 * the plugin (RFC LUM-1058 §7 PR6). Core files import `@/lib/diff/diff-lines`
 * directly.
 */
export * from '@/lib/diff/diff-lines'
