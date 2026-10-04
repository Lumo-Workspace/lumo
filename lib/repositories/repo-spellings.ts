import { prisma } from '@/lib/db/prisma'

/**
 * LUM-896 — GitHub repository names are case-insensitive, and a list's
 * spelling need not match the one a PR row was stored under (a repository
 * renamed in case, another source). Returns every stored spelling of
 * `repos` among the workspace's PRs. Prisma's insensitive `equals` is an
 * ILIKE on Postgres, where `_` is a wildcard — so it only narrows the
 * candidates, and the exact case-folded comparison decides.
 *
 * LUM-879 — shared by the scan scrub and the mirrored-comment scrub.
 */
export async function storedRepoSpellings(
  workspaceId: string,
  repos: string[]
): Promise<string[]> {
  if (repos.length === 0) return []
  const wanted = new Set(repos.map(repo => repo.toLowerCase()))
  const candidates = await prisma.pullRequest.groupBy({
    by: ['repo'],
    where: {
      workspaceId,
      OR: repos.map(repo => ({
        repo: { equals: repo, mode: 'insensitive' as const },
      })),
    },
  })
  return candidates
    .map(row => row.repo)
    .filter(repo => wanted.has(repo.toLowerCase()))
}
