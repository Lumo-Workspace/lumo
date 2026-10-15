import { prisma } from '@/lib/db/prisma'
import {
  overrideFromColumns,
  type PreMergeChecksOverride,
} from '@/ee/security/security-scan/pre-merge-checks'

/**
 * LUM-1148 — the per-PR override of the pre-merge checks
 * (`@<app> ignore pre-merge checks`), recorded on the PR row: who, when,
 * at which head. Set once — the first override stands (a repeat is a no-op).
 *
 * Per PR, not per head: the override covers every later push to the PR.
 * `preMergeOverrideSha` is the head it was given at, kept for the audit
 * trail and the summary line — it never scopes the override (see
 * `PreMergeChecksOverride`).
 */
export const preMergeOverrideRepository = {
  async find(pullRequestId: string): Promise<PreMergeChecksOverride | null> {
    const row = await prisma.pullRequest.findUnique({
      where: { id: pullRequestId },
      select: {
        preMergeOverrideBy: true,
        preMergeOverrideAt: true,
        preMergeOverrideSha: true,
      },
    })
    return row ? overrideFromColumns(row) : null
  },

  /**
   * Records the override unless one is already there. Returns the override
   * that stands, and whether this call recorded it.
   */
  async record(
    pullRequestId: string,
    input: { login: string; headSha: string | null; at?: Date }
  ): Promise<{ override: PreMergeChecksOverride; recorded: boolean }> {
    const at = input.at ?? new Date()
    const { count } = await prisma.pullRequest.updateMany({
      where: { id: pullRequestId, preMergeOverrideBy: null },
      data: {
        preMergeOverrideBy: input.login,
        preMergeOverrideAt: at,
        preMergeOverrideSha: input.headSha,
      },
    })
    if (count > 0)
      return {
        override: { login: input.login, at, headSha: input.headSha },
        recorded: true,
      }
    const existing = await preMergeOverrideRepository.find(pullRequestId)
    return {
      override: existing ?? { login: input.login, at, headSha: input.headSha },
      recorded: false,
    }
  },
}
