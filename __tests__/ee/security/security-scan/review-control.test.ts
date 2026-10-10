/** @jest-environment node */
import {
  admitAutomaticReview,
  affectedReviewDiff,
} from '@/ee/security/security-scan/review-control'
import {
  scanCoverageState,
  isOwnedUnfinished,
} from '@/shared/src/security-scan'

test('two automatic heads exhaust the budget; retrying an admitted head does not consume another round', () => {
  const control = {
    reviewPaused: false,
    reviewRoundLimit: 2,
    reviewHeads: ['a', 'b'],
  }
  expect(admitAutomaticReview(control, 'c')).toEqual({
    allowed: false,
    reserve: false,
  })
  expect(admitAutomaticReview(control, 'a')).toEqual({
    allowed: true,
    reserve: false,
  })
  expect(
    admitAutomaticReview({ ...control, reviewPaused: true }, 'a').allowed
  ).toBe(false)
  expect(admitAutomaticReview({ ...control, reviewHeads: [] }, 'c')).toEqual({
    allowed: true,
    reserve: true,
  })
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
