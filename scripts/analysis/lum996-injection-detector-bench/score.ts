/**
 * LUM-996 — score one sample exactly as production does.
 *
 * Every injection point strips control characters with `sanitizeField` and
 * then fences the text through `guardUntrustedContent` (directly, or via
 * `guardInjectedText` in lib/security-scan/inject-guard.ts, which only adds
 * secret redaction in front of it). This module calls those two functions and
 * nothing else — it is not a re-implementation of the detector.
 *
 * A sample counts as FLAGGED when production would print a notice for it:
 * at least one injection signal, or at least one neutralized wrapper tag.
 */
import { sanitizeField } from '../../../shared/src/sanitize'
import {
  guardUntrustedContent,
  INJECTION_SIGNAL_KINDS,
  type InjectionSignalKind,
} from '../../../shared/src/untrusted-content'

/** Signal kinds plus the wrapper-escape half, as one reporting dimension. */
export type ScoreKind = InjectionSignalKind | 'WRAPPER_ESCAPE'

export const SCORE_KINDS: readonly ScoreKind[] = [
  ...INJECTION_SIGNAL_KINDS,
  'WRAPPER_ESCAPE',
]

export interface SampleScore {
  flagged: boolean
  /** Per-kind occurrence counts; kinds that did not fire are absent. */
  kinds: Partial<Record<ScoreKind, number>>
}

export function scoreText(text: string): SampleScore {
  const guarded = guardUntrustedContent(sanitizeField(text))
  const kinds: Partial<Record<ScoreKind, number>> = {}
  for (const s of guarded.signals) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1
  if (guarded.wrapperEscapes > 0) kinds.WRAPPER_ESCAPE = guarded.wrapperEscapes
  return {
    flagged: guarded.signals.length > 0 || guarded.wrapperEscapes > 0,
    kinds: sortKinds(kinds),
  }
}

/** Stable key order so results.json diffs cleanly. */
export function sortKinds(
  kinds: Partial<Record<ScoreKind, number>>
): Partial<Record<ScoreKind, number>> {
  const out: Partial<Record<ScoreKind, number>> = {}
  for (const k of SCORE_KINDS) if (kinds[k] !== undefined) out[k] = kinds[k]
  return out
}
