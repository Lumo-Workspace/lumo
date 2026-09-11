/**
 * LUM-740 — the record of a human's decision on an LLM-suggested disposition
 * (spec §12 R2 data). Pure.
 */
export type SuggestionOutcome = 'CONFIRMED' | 'OVERRULED'
export type Disposition = 'FALSE_POSITIVE' | 'ACCEPTED_RISK'

/**
 * CONFIRMED when the human chose exactly what was suggested, OVERRULED when
 * they chose another disposition, null when nothing had been suggested.
 */
export function suggestionOutcomeFor(
  suggested: Disposition | null | undefined,
  chosen: Disposition
): SuggestionOutcome | null {
  if (suggested == null) return null
  return suggested === chosen ? 'CONFIRMED' : 'OVERRULED'
}
