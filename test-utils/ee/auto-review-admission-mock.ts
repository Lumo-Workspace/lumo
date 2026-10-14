/**
 * LUM-1137 — for suites that drive `prSecurityScanService.run` with a mocked
 * `prReviewControlRepository`: admission delegates to that mock's
 * `reserve(prId, head)`, so `reserve → false` still reads as a paused head
 * and the suite needs no workspace setting, commit count or rate limiter.
 * The real admission rules are covered by
 * `__tests__/ee/security/services/auto-review-admission.service.test.ts`.
 *
 *   jest.mock('@/ee/security/services/auto-review-admission.service', () =>
 *     require('@/test-utils/ee/auto-review-admission-mock').delegatingAdmission()
 *   )
 */
export function delegatingAdmission() {
  return {
    autoReviewAdmissionService: {
      admit: jest.fn(async (pr: { id: string }, head: string) => {
        const {
          prReviewControlRepository,
        } = require('@/ee/security/repositories/pr-review-control.repository')
        const allowed = Boolean(
          await prReviewControlRepository.reserve(pr.id, head)
        )
        return { allowed, rateLimited: false }
      }),
    },
  }
}
