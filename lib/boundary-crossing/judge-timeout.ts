/**
 * Shared best-effort timeout for the boundary-crossing LLM judges (LUM-463,
 * extended in LUM-466). Extracted so the LLM judges (action-category
 * confirmation, claim faithfulness) share ONE timeout primitive — a hung model call
 * can never block hook ingestion or the DONE path (the exit-0 invariant). The
 * caller wraps this best-effort and falls back to the conservative (flagging)
 * direction on any reject.
 */

/** Reject after `ms` so a hung judge can never block ingestion. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('boundary-crossing judge timed out')),
      ms
    )
    // Never let a pending judge timeout hold the process open (Node only).
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      ;(timer as { unref: () => void }).unref()
    }
    p.then(
      v => {
        clearTimeout(timer)
        resolve(v)
      },
      e => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    )
  })
}
