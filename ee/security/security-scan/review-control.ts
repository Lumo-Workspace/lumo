/** LUM-1056: a round is one distinct head admitted to automatic AI review.
 * Failed attempts keep their reservation; retries of that head cost no round.
 * Resume resets the budget. Manual reviews neither consume nor reset it.
 */
export interface ReviewControl {
  reviewPaused: boolean
  reviewRoundLimit: number
  reviewHeads: string[]
}

export function admitAutomaticReview(control: ReviewControl, head: string) {
  if (control.reviewPaused) return { allowed: false, reserve: false }
  if (control.reviewHeads.includes(head))
    return { allowed: true, reserve: false }
  if (control.reviewHeads.length >= control.reviewRoundLimit)
    return { allowed: false, reserve: false }
  return { allowed: true, reserve: true }
}

/** Include whole PR-diff sections for affected files, with PR-head line
 * numbers. A compare diff alone would lose context and misplace comments.
 */
export function affectedReviewDiff(
  diff: string,
  paths: readonly string[]
): string {
  const affected = new Set(paths)
  const sections = diff.split(/(?=^diff --git )/m)
  // Quoted/nonstandard headers cannot prove exclusion. Fall back to full.
  if (sections.some(section => /^\+\+\+ (?!b\/|\/dev\/null)/m.test(section)))
    return diff
  return sections
    .filter(section => {
      const path = /^\+\+\+ b\/(.+)$/m.exec(section)?.[1]
      return path !== undefined && affected.has(path)
    })
    .join('')
}
