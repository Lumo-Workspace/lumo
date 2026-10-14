/**
 * @jest-environment node
 *
 * LUM-1137 — `lumo pr scan` says how many commits automatic review has
 * covered against the PR's pause-after (0 = never pauses), and a paused AI
 * layer of a rate-limited scan says it is rate-limited, not paused.
 */
import { formatReviewBudget } from '@/cli/src/commands/pr-scan'
import { scanLayerRows } from '@/cli/src/lib/scan-format'

test('reviewed commits against the limit; 0 never pauses; an older server counted rounds', () => {
  expect(formatReviewBudget({ rounds: 3, limit: 5, unit: 'commits' })).toBe(
    '3/5 commits reviewed'
  )
  expect(formatReviewBudget({ rounds: 12, limit: 0, unit: 'commits' })).toBe(
    '12 commits reviewed · never pauses'
  )
  expect(formatReviewBudget({ rounds: 1, limit: 2 })).toBe('1/2 rounds')
})

test('a rate-limited scan labels its paused AI layers rate-limited', () => {
  const base = {
    stages: { secrets: 'RAN', judge: 'PAUSED', hunt: 'PAUSED' },
    partial: true,
    externalFindings: 0,
    externalFailureReason: null,
  }
  const limited = scanLayerRows({
    ...base,
    partialCauses: ['AI_REVIEW_RATE_LIMITED'],
  })
  expect(limited.find(r => r.key === 'judge')!.value).toBe(
    'rate-limited — automatic review resumes within the hour'
  )
  expect(limited.find(r => r.key === 'secrets')!.value).toBe('checked')
  const paused = scanLayerRows({ ...base, partialCauses: ['AI_REVIEW_PAUSED'] })
  expect(paused.find(r => r.key === 'judge')!.value).toBe(
    'paused — request a manual review'
  )
})
