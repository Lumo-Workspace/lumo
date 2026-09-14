import type { ClaimVerdict } from './types'

/** The client-visible faithfulness state (LUM-583): the four judged verdicts
 *  plus PENDING (not judged yet) and STALE (judged against an older claim, the
 *  underlying verdict still surfaced). Mirrors `TaskClaimFaithfulnessView.state`. */
export type ClaimFaithfulnessState = ClaimVerdict | 'PENDING' | 'STALE'

/** The minimal shape the show/hide decision reads — structurally satisfied by
 *  `TaskClaimFaithfulnessView`, so the component passes it straight through. */
export interface ClaimFaithfulnessLike {
  state: ClaimFaithfulnessState
  verdict: ClaimVerdict | null
}

const MISMATCH_VERDICTS: ReadonlySet<ClaimVerdict> = new Set<ClaimVerdict>([
  'OVERSTATED',
  'UNDERREPORT',
])

/**
 * LUM-730 — whether the "Claim vs verification" section should exist at all.
 *
 * Decision-first taken to its end (LUM-597): the claim's only job is to flag
 * when it disagrees with what was delivered, so the section is shown only on a
 * mismatch — OVERSTATED (claimed more than delivered) or UNDERREPORT (claimed
 * less), including a STALE state whose underlying verdict is one of those. A
 * FAITHFUL claim, a claim still being judged (PENDING), one the judge could not
 * decide (UNJUDGEABLE), or no faithfulness at all (no claim / older server) is
 * not evidence of a conflict — the section stays out of the way. Failed
 * criteria are the criteria list's job and never pull the section back.
 *
 * Pure: no React, no I/O.
 */
export function shouldShowClaimVsVerification(
  faithfulness: ClaimFaithfulnessLike | null | undefined
): boolean {
  if (!faithfulness) return false
  switch (faithfulness.state) {
    case 'OVERSTATED':
    case 'UNDERREPORT':
      return true
    case 'STALE':
      return (
        faithfulness.verdict !== null &&
        MISMATCH_VERDICTS.has(faithfulness.verdict)
      )
    case 'FAITHFUL':
    case 'UNJUDGEABLE':
    case 'PENDING':
      return false
    default: {
      // A new state must be classified explicitly — never silently hidden.
      const unhandled: never = faithfulness.state
      return unhandled
    }
  }
}
