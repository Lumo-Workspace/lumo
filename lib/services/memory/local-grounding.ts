/**
 * LUM-773 — local, deterministic grounding gate for Layer 1.
 *
 * Replaces the second flash call of LUM-396 on the per-turn path: instead of
 * sending the turn log back to the model and asking "is each candidate backed
 * by the source?", the extract pass is told to attach a verbatim `quote` to
 * every candidate, and this module checks that the quote actually occurs in
 * the source text. A candidate with no quote, or with a quote that is not in
 * the source, is discarded — the same quote-or-discard posture as the LLM gate
 * (ProMem, arXiv 2601.04463), but with zero tokens and no fail-open ambiguity.
 *
 * Whitespace is normalised on both sides (runs collapsed to one space) so a
 * quote that wraps a line differently from the compacted log still matches;
 * everything else is exact.
 *
 * Layer 2 and milestone-distill keep the LLM gate in `ground-candidates.ts` —
 * their source material is not a single turn log the model can quote from.
 */

/**
 * Any candidate object; `quote` is read structurally so a candidate the model
 * emitted WITHOUT one is still a valid input (and is discarded, not rejected
 * by the type checker).
 */
export type QuotedCandidate = object

export interface LocalGroundingInput<T extends QuotedCandidate> {
  /** The SAME source material the extract prompt saw. */
  sourceText: string
  candidates: T[]
}

export interface LocalGroundingResult<T extends QuotedCandidate> {
  /** Grounded candidates, original order, with the `quote` field removed. */
  kept: Array<Omit<T, 'quote'>>
  discardedCount: number
}

export function normalizeForQuoteMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function groundCandidatesLocally<T extends QuotedCandidate>(
  input: LocalGroundingInput<T>
): LocalGroundingResult<T> {
  if (input.candidates.length === 0) return { kept: [], discardedCount: 0 }

  const haystack = normalizeForQuoteMatch(input.sourceText)
  const kept: Array<Omit<T, 'quote'>> = []
  let discardedCount = 0

  for (const candidate of input.candidates) {
    const raw = (candidate as { quote?: unknown }).quote
    const quote = typeof raw === 'string' ? normalizeForQuoteMatch(raw) : ''
    if (quote.length === 0 || !haystack.includes(quote)) {
      discardedCount++
      continue
    }
    const { quote: _dropped, ...rest } = candidate as T & { quote?: unknown }
    void _dropped
    kept.push(rest as Omit<T, 'quote'>)
  }

  return { kept, discardedCount }
}
