/**
 * LUM-1256 — the reads behind a local scan's server context: the human
 * rulings recorded on a repository's PR findings, and the open PR of a
 * branch. Ids, fingerprints and statuses only — never a finding's code,
 * evidence or note. Every read pins the workspace. Queries only.
 */
import { prisma } from '@/lib/db/prisma'
import { storedRepoSpellings } from '@/lib/repositories/repo-spellings'

export interface RulingRow {
  fingerprint: string
  ruleId: string
  /** null = a reopen marker (the ruling was withdrawn at `dispositionedAt`). */
  disposition: 'FALSE_POSITIVE' | 'ACCEPTED_RISK' | null
  /** WorkspaceMember id of who ruled; null for a system ruling. */
  dispositionedById: string | null
  dispositionedAt: Date
  pullRequestNumber: number
}

export interface BranchPullRequest {
  id: string
  number: number
  headSha: string | null
}

export const securityScanContextRepository = {
  /**
   * Every ruling (and reopen marker) on the repository's PR findings,
   * newest first, at most `limit` rows. The service keeps the newest per
   * fingerprint.
   */
  async findRulingRows(
    workspaceId: string,
    repo: string,
    limit: number
  ): Promise<RulingRow[]> {
    const spellings = await storedRepoSpellings(workspaceId, [repo])
    if (spellings.length === 0) return []
    const rows = await prisma.prSecurityFinding.findMany({
      where: {
        dispositionedAt: { not: null },
        scan: { pullRequest: { workspaceId, repo: { in: spellings } } },
      },
      orderBy: { dispositionedAt: 'desc' },
      take: limit,
      select: {
        fingerprint: true,
        ruleId: true,
        disposition: true,
        dispositionedById: true,
        dispositionedAt: true,
        scan: { select: { pullRequest: { select: { number: true } } } },
      },
    })
    return rows.map(r => ({
      fingerprint: r.fingerprint,
      ruleId: r.ruleId,
      disposition: r.disposition,
      dispositionedById: r.dispositionedById,
      dispositionedAt: r.dispositionedAt as Date,
      pullRequestNumber: r.scan.pullRequest.number,
    }))
  },

  /** The newest open PR of `branch` in the repository, if any. */
  async findOpenPullRequestByBranch(
    workspaceId: string,
    repo: string,
    branch: string
  ): Promise<BranchPullRequest | null> {
    const spellings = await storedRepoSpellings(workspaceId, [repo])
    if (spellings.length === 0) return null
    return prisma.pullRequest.findFirst({
      where: {
        workspaceId,
        repo: { in: spellings },
        headBranch: branch,
        state: 'open',
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, number: true, headSha: true },
    })
  },
}
