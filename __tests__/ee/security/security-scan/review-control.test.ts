/** @jest-environment node */
import {
  DEFAULT_AUTO_PAUSE_AFTER,
  admitAutomaticReview,
  affectedReviewDiff,
  RESUME_BASELINE_HEAD,
  commitsAfterReserve,
  parseAutoPauseAfter,
  resumedHeads,
  reviewBudgetView,
  reviewedCommits,
  withoutHead,
} from '@/ee/security/security-scan/review-control'
import {
  scanCoverageState,
  isOwnedUnfinished,
} from '@/shared/src/security-scan'

const fresh = {
  reviewPaused: false,
  reviewHeads: [] as string[],
  reviewHeadCommits: [] as number[],
  reviewCommitLimit: null as number | null,
}

/** Push one single-commit head after another onto a PR that already has
 *  `startCommits` commits; the admitted pushes (1-based). */
function pushSingleCommits(
  limit: number,
  pushes: number,
  commitLimit = null as number | null,
  start = { ...fresh, reviewCommitLimit: commitLimit },
  startCommits = 0
) {
  let control = start
  const admitted: number[] = []
  for (let i = 1; i <= pushes; i++) {
    const decision = admitAutomaticReview(control, `h${i}`, limit)
    if (decision.reserve)
      control = {
        ...control,
        reviewHeads: [...control.reviewHeads, `h${i}`],
        reviewHeadCommits: commitsAfterReserve(control, startCommits + i),
      }
    if (decision.allowed) admitted.push(i)
  }
  return { admitted, control }
}

test('LUM-1137: default N=5 reviews pushes 1-5 automatically and pauses the 6th', () => {
  expect(DEFAULT_AUTO_PAUSE_AFTER).toBe(5)
  const { admitted, control } = pushSingleCommits(DEFAULT_AUTO_PAUSE_AFTER, 6)
  expect(admitted).toEqual([1, 2, 3, 4, 5])
  expect(reviewBudgetView(control, 5)).toEqual({
    paused: true,
    rounds: 5,
    limit: 5,
    unit: 'commits',
  })
})

test('LUM-1137: N=0 never pauses', () => {
  const { admitted, control } = pushSingleCommits(0, 30)
  expect(admitted).toHaveLength(30)
  expect(reviewBudgetView(control, 0).paused).toBe(false)
})

test('LUM-1137: a PR limit set by --resume --limit overrides the workspace setting', () => {
  expect(pushSingleCommits(5, 6, 2).admitted).toEqual([1, 2])
  expect(pushSingleCommits(0, 6, 3).admitted).toEqual([1, 2, 3])
})

test('LUM-1137: reviewed commits count the commits each head added (CodeRabbit semantics)', () => {
  // Opened with 3 commits (the first review counts one), then pushes of 2
  // and 2: 5 reviewed — the next pauses.
  const control = {
    ...fresh,
    reviewHeads: ['a', 'b', 'c'],
    reviewHeadCommits: [3, 5, 7],
  }
  expect(reviewedCommits(control)).toBe(5)
  expect(admitAutomaticReview(control, 'd', 5).allowed).toBe(false)
  // Unknown counts (0, or heads admitted before LUM-1137) count as one each;
  // a force-push that shrank the PR still counts one.
  expect(
    reviewedCommits({ reviewHeads: ['a', 'b', 'c'], reviewHeadCommits: [] })
  ).toBe(3)
  expect(
    reviewedCommits({ reviewHeads: ['a', 'b'], reviewHeadCommits: [4, 1] })
  ).toBe(2)
  expect(
    commitsAfterReserve({ reviewHeads: ['a', 'b'], reviewHeadCommits: [] }, 7)
  ).toEqual([0, 0, 7])
})

test('LUM-1137 fix: a PR opened with 10 commits (N=5) still gets pushes 2-5 reviewed automatically', () => {
  // The first automatic review counts one commit, not the 10 already there.
  const { admitted, control } = pushSingleCommits(5, 6, null, fresh, 9)
  expect(admitted).toEqual([1, 2, 3, 4, 5])
  expect(control.reviewHeadCommits).toEqual([10, 11, 12, 13, 14])
  expect(reviewBudgetView(control, 5)).toMatchObject({
    paused: true,
    rounds: 5,
  })
})

test('LUM-1137 fix: resume on a 25-commit PR with --limit 20 baselines the budget, so later pushes are reviewed', () => {
  // Paused at the limit: 20 single-commit pushes after the first 5 commits.
  const before = pushSingleCommits(20, 21, 20, { ...fresh }, 5)
  expect(before.admitted).toHaveLength(20)
  // Resume at 25 commits with --limit 20.
  const resumed = {
    ...fresh,
    reviewCommitLimit: 20,
    ...resumedHeads(25),
  }
  expect(resumed.reviewHeads).toEqual([RESUME_BASELINE_HEAD])
  expect(reviewBudgetView(resumed, 5)).toMatchObject({
    paused: false,
    rounds: 0,
    limit: 20,
  })
  const after = pushSingleCommits(5, 21, 20, resumed, 25)
  expect(after.admitted).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  // A push of 3 commits right after resume is charged 3, not the 28 on the PR.
  expect(
    reviewedCommits({
      reviewHeads: [RESUME_BASELINE_HEAD, 'x'],
      reviewHeadCommits: [25, 28],
    })
  ).toBe(3)
  // An unknown count at resume leaves no baseline: the next head counts one.
  expect(resumedHeads(null)).toEqual({ reviewHeads: [], reviewHeadCommits: [] })
})

test('LUM-1137: a released (superseded) head consumes nothing and keeps the arrays aligned', () => {
  const control = {
    ...fresh,
    reviewHeads: ['a', 'b', 'c'],
    reviewHeadCommits: [1, 2, 3],
  }
  const released = withoutHead(control, 'b')
  expect(released).toEqual({
    reviewHeads: ['a', 'c'],
    reviewHeadCommits: [1, 3],
  })
  // c's count now includes b's commit: three commits reviewed either way.
  expect(reviewedCommits(released)).toBe(3)
})

test('retrying an admitted head does not consume another commit; pause denies it', () => {
  const control = {
    ...fresh,
    reviewHeads: ['a', 'b'],
    reviewHeadCommits: [1, 2],
  }
  expect(admitAutomaticReview(control, 'c', 2)).toEqual({
    allowed: false,
    reserve: false,
  })
  expect(admitAutomaticReview(control, 'a', 2)).toEqual({
    allowed: true,
    reserve: false,
  })
  expect(
    admitAutomaticReview({ ...control, reviewPaused: true }, 'a', 2).allowed
  ).toBe(false)
  expect(admitAutomaticReview(fresh, 'c', 2)).toEqual({
    allowed: true,
    reserve: true,
  })
})

test('LUM-1137: stored pause-after values outside 0-100 read as the default', () => {
  expect(parseAutoPauseAfter(0)).toBe(0)
  expect(parseAutoPauseAfter(100)).toBe(100)
  expect(parseAutoPauseAfter(101)).toBe(5)
  expect(parseAutoPauseAfter(-1)).toBe(5)
  expect(parseAutoPauseAfter(null)).toBe(5)
})

test('incremental scope keeps PR-head line numbers and whole affected files, excluding unchanged files', () => {
  const a =
    'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -10 +12 @@\n-old\n+new\n'
  const b =
    'diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-a\n+b\n'
  expect(affectedReviewDiff(a + b, ['a.ts'])).toBe(a)
  expect(affectedReviewDiff(a + b, [])).toBe('')
})

test('paused review cannot count as checked and is not reported as an infrastructure failure', () => {
  const scan = {
    status: 'CLEAN',
    stages: { secrets: 'RAN', judge: 'PAUSED' },
    partial: false,
  }
  expect(scanCoverageState(scan)).toBe('UNFINISHED')
  expect(isOwnedUnfinished({ ...scan, hasSizeNotice: false })).toBe(false)
  expect(
    isOwnedUnfinished({
      ...scan,
      partial: true,
      partialCauses: ['AI_REVIEW_PAUSED'],
      hasSizeNotice: false,
    })
  ).toBe(false)
  expect(
    isOwnedUnfinished({
      ...scan,
      stages: { ...scan.stages, external: 'FAILED' },
      hasSizeNotice: false,
    })
  ).toBe(true)
})
