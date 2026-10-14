/**
 * @jest-environment node
 *
 * LUM-1137 — the security summary on the PR: a paused head says it was
 * paused (by a reviewer, or after the PR's reviewed-commit limit) — no
 * "2 rounds" — and a rate-limited head says it is rate-limited and that the
 * next push is reviewed, never "didn't finish on our side". The web panel's
 * stage reason says the same.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {},
}))

import { buildSummary } from '@/ee/security/services/security-pr-review.service'
import { stageReason } from '@/ee/security/components/TaskDetailTimeline/security-summary'
import { isOwnedUnfinished } from '@/shared/src/security-scan'

const base = {
  headSha: 'abcdef1234567890',
  stages: { secrets: 'RAN', judge: 'PAUSED', hunt: 'PAUSED' } as never,
  status: 'CLEAN' as const,
  partial: true,
  externalCounts: {},
  open: 0,
  blocking: 0,
  error: null,
  taskUrl: null,
  repo: 'acme/app',
  prNumber: 9,
  commandHandle: '@uselumo',
}

test('paused: names the reviewed-commit limit and resume, not a round budget', () => {
  const body = buildSummary({ ...base, partialCauses: ['AI_REVIEW_PAUSED'] })
  expect(body).toContain('after its limit of reviewed commits')
  expect(body).toContain('`@uselumo resume` to review every push again')
  expect(body).not.toMatch(/round budget/)
  expect(body).not.toMatch(/rate-limited/)
})

test('rate-limited: says so, that the next push is reviewed, and how to review now', () => {
  const body = buildSummary({
    ...base,
    partialCauses: ['AI_REVIEW_RATE_LIMITED'],
  })
  expect(body).toContain('Automatic AI review is rate-limited')
  expect(body).toContain('The next push after the limit resets is reviewed')
  expect(body).toContain('`@uselumo review`')
  expect(body).toContain(
    'rate-limited — automatic review resumes within the hour'
  )
  expect(body).not.toMatch(/paused on this PR/)
  // Not our failure: no owned "didn't finish" line.
  expect(
    isOwnedUnfinished({
      status: 'CLEAN',
      stages: base.stages,
      partial: true,
      partialCauses: ['AI_REVIEW_RATE_LIMITED'],
      hasSizeNotice: false,
    })
  ).toBe(false)
})

test('web stage reason: rate-limited vs paused', () => {
  const scan = {
    stages: { judge: 'PAUSED' } as never,
    huntOverCap: null,
    judgeOverCap: null,
    huntProgress: null,
  }
  expect(stageReason('judge', scan)?.id).toBe('securityScan.stageReason.PAUSED')
  expect(stageReason('judge', { ...scan, reviewRateLimited: true })?.id).toBe(
    'securityScan.stageReason.RATE_LIMITED'
  )
})
