/**
 * LUM-988 — the agentic verifier's switch. Import-light on purpose: stage A
 * reads it to decide whether to keep the managed scan's VM alive and to
 * start the verifier.
 */

/** `LUMO_REVIEW_VERIFIER=off` is the kill switch. */
export function isReviewVerifierEnabled(): boolean {
  return process.env.LUMO_REVIEW_VERIFIER !== 'off'
}

/**
 * `LUMO_REVIEW_RANKER=off` turns off only the ranker that runs after the
 * verifier; the verifier's own verdicts still apply.
 */
export function isReviewRankerEnabled(): boolean {
  return process.env.LUMO_REVIEW_RANKER !== 'off'
}
