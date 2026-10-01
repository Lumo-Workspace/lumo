/**
 * Backfills existing PRs for a newly-added GitHub repo.
 *
 * Called after a webhook is registered so that PRs opened/merged before the
 * webhook existed still show up on task detail pages.
 *
 * Fetches the 100 most-recently-updated PRs (all states) and upserts them
 * into the PullRequest table, linking each one to a task when the head branch
 * contains a matching task identifier (e.g. "ENG-123").
 */

import { logger } from '@/lib/logger'
import { prisma } from '@/lib/db/prisma'
import { parseBranchIdentifier, splitIdentifier } from './branch'

const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
}

interface GhListPR {
  number: number
  title: string
  html_url: string
  state: string
  draft: boolean
  user: { login: string }
  head: { ref: string; sha: string }
  base: { ref: string }
  merged_at: string | null
  closed_at: string | null
}

export async function syncRepoPRs(
  token: string,
  fullName: string,
  workspaceId: string,
  /** null when the backfill runs off the App installation rather than an OAuth integration. */
  integrationId: string | null
): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${fullName}/pulls?state=all&per_page=100&sort=updated&direction=desc`,
    { headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) {
    console.error(
      `[github/sync] failed to fetch PRs for ${fullName}: ${res.status}`
    )
    return
  }

  const prs = (await res.json()) as GhListPR[]

  for (const pr of prs) {
    // Determine task linkage from branch name
    let taskId: string | null = null
    const identifier = parseBranchIdentifier(pr.head.ref)
    if (identifier) {
      const parts = splitIdentifier(identifier)
      if (parts) {
        const task = await prisma.task.findFirst({
          where: {
            number: parts.number,
            team: { identifier: parts.teamIdentifier, workspaceId },
          },
          select: { id: true },
        })
        taskId = task?.id ?? null
      }
    }

    // merged_at being set is the reliable indicator of a merged PR
    const state = pr.merged_at
      ? 'merged'
      : pr.state === 'closed'
        ? 'closed'
        : 'open'

    await prisma.pullRequest.upsert({
      where: {
        workspaceId_repo_number: {
          workspaceId,
          repo: fullName,
          number: pr.number,
        },
      },
      create: {
        workspaceId,
        taskId,
        integrationId,
        repo: fullName,
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        state,
        authorLogin: pr.user.login,
        headBranch: pr.head.ref,
        headSha: pr.head.sha,
        baseBranch: pr.base.ref,
        isDraft: pr.draft,
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
        closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
      },
      update: {
        title: pr.title,
        state,
        isDraft: pr.draft,
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
        closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
        // Only set taskId if we matched one — don't clear an existing link
        ...(taskId ? { taskId } : {}),
      },
    })

    // Also ensure the branch is visible in the task's branch list
    if (taskId) {
      await prisma.taskBranch.upsert({
        where: {
          taskId_repo_branchName: {
            taskId,
            repo: fullName,
            branchName: pr.head.ref,
          },
        },
        create: { taskId, repo: fullName, branchName: pr.head.ref },
        update: {},
      })
    }
  }

  logger.debug(`[github/sync] synced ${prs.length} PRs for ${fullName}`)
}
