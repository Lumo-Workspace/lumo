/**
 * Pure helpers for the LUM-590 system-explain feature on boundary crossings.
 * No React or ESM-only imports — safe to import in Node jest environments.
 */

/**
 * Returns the state for the system-explain feature:
 * - { kind: 'button' } → systemExplanation not yet generated; show an "Explain" button.
 * - { kind: 'text', text } → explanation present; render it as a plain text node.
 * - { kind: 'notRetained' } → LUM-912: the raw text was purged after the
 *   retention window; there is nothing left to explain from.
 *
 * Pure — no intl dependency, jsdom/node-testable (LUM-590).
 */
export function systemExplainState(c: {
  systemExplanation: string | null | undefined
  rawPurged?: boolean | undefined
}):
  | { kind: 'button' }
  | { kind: 'text'; text: string }
  | { kind: 'notRetained' } {
  if (c.rawPurged) return { kind: 'notRetained' }
  if (c.systemExplanation) {
    return { kind: 'text', text: c.systemExplanation }
  }
  return { kind: 'button' }
}
