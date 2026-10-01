import { ideaPullRequestRepository } from '@/lib/repositories/idea-pull-request.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { githubRepository } from '@/lib/repositories/github.repository'
import {
  fetchPullRequest,
  parsePrUrl,
  toPrState,
} from '@/lib/integrations/github/fetch-pull-request'
import { requireConfirmedRepository } from '@/lib/integrations/github/confirmed-repositories'
import { REPO_TOKEN_PERMISSIONS } from '@/lib/integrations/github/token-permissions'
import { resolveIdeaRef } from './idea-evidence-resolve'

const err = (message: string, status: number) =>
  Object.assign(new Error(message), { status })

/**
 * GitHub pull requests cited as evidence on an Idea (LUM-684).
 *
 * Mirrors `task-pr-link.service` with one deliberate difference: a task *owns*
 * its PR (`PullRequest.taskId`, one task per PR — hence that service's
 * 409/force-move dance), whereas an idea only *cites* one. Citing is additive,
 * so there is no conflict to resolve and no `force`: the same PR can back
 * several ideas and a task at once, and attaching it here never moves it away
 * from a task.
 */

/**
 * Reading a PR by URL is done as the workspace's App installation — the
 * machine identity every other GitHub read uses — never with a member's token,
 * and only for a repository the workspace has confirmed (LUM-883).
 */
async function repoTokenFor(
  workspaceId: string,
  repo: string
): Promise<string> {
  // Lazy: auth.ts loads @octokit/auth-app, which must not ride along with this
  // service into every module graph that touches tasks (same reason
  // github.service imports the integration lazily).
  const { getRepoToken } = await import('@/lib/integrations/github/auth')
  return getRepoToken(workspaceId, repo, REPO_TOKEN_PERMISSIONS.pullRequestRead)
}

export const ideaPullRequestService = {
  async list(input: { workspaceId: string; ideaRef: string }) {
    const { ideaId } = await resolveIdeaRef(input)
    return ideaPullRequestRepository.listByIdea(ideaId)
  },

  /**
   * Cite a PR as evidence. Two entry modes, matching the task side:
   *
   * 1. `prId` — caller picked an already-synced PR (typically from search).
   * 2. `url` — caller pasted a GitHub URL. A PR we already track is reused;
   *    otherwise it is fetched from GitHub via the workspace's stored
   *    integration token and upserted.
   */
  async link(input: {
    workspaceId: string
    ideaRef: string
    prId?: string
    url?: string
    createdById: string
  }) {
    const { ideaId, workspaceId } = await resolveIdeaRef(input)

    const pullRequestId = input.prId
      ? await resolveByPrId(input.prId, workspaceId)
      : input.url
        ? await resolveByUrl(input.url, workspaceId)
        : null

    if (!pullRequestId) throw err('Provide prId or url', 400)

    // Citing the same PR twice is a no-op rather than a 409 — the unique index
    // is the guard, and re-attaching evidence is not an error worth a dialog.
    const existing = await ideaPullRequestRepository.findByIdeaAndPr(
      ideaId,
      pullRequestId
    )
    if (existing) return existing

    return ideaPullRequestRepository.create({
      ideaId,
      pullRequestId,
      workspaceId,
      createdById: input.createdById,
    })
  },

  async unlink(input: {
    workspaceId: string
    ideaRef: string
    citationId: string
  }) {
    const { ideaId } = await resolveIdeaRef(input)

    const row = await ideaPullRequestRepository.getById(input.citationId)
    // Scope on the row's own denormalized workspaceId AND its idea, so a
    // citation id from another workspace or another idea reads as missing.
    if (
      !row ||
      row.workspaceId !== input.workspaceId ||
      row.ideaId !== ideaId
    ) {
      throw err('not_found', 404)
    }

    await ideaPullRequestRepository.delete(row.id)
    return { ok: true as const }
  },
}

async function resolveByPrId(
  prId: string,
  workspaceId: string
): Promise<string> {
  const pr = await pullRequestRepository.findById(prId)
  if (!pr) throw err('Pull request not found', 404)
  if (pr.workspaceId !== workspaceId) {
    // Same wording as the task side; a cross-workspace PR is a 403 there.
    throw err('Pull request belongs to a different workspace', 403)
  }
  // LUM-883 — a row kept from before its repository left the confirmed list
  // is not citable evidence either.
  await requireConfirmedRepository(workspaceId, pr.repo)
  return pr.id
}

async function resolveByUrl(url: string, workspaceId: string): Promise<string> {
  const parsed = parsePrUrl(url)
  if (!parsed) throw err('Invalid GitHub PR URL', 400)
  // Before the row lookup and any GitHub read (LUM-883).
  await requireConfirmedRepository(workspaceId, parsed.repo)

  const existing = await pullRequestRepository.findByRepoAndNumber(
    workspaceId,
    parsed.repo,
    parsed.number
  )
  // LUM-924: this workspace's own row — another workspace's copy is not ours.
  if (existing) return existing.id

  const token = await repoTokenFor(workspaceId, parsed.repo)

  const ghPr = await fetchPullRequest({
    token,
    repo: parsed.repo,
    number: parsed.number,
  })
  if (!ghPr) throw err('PR not found on GitHub', 404)

  const upserted = await githubRepository.upsertPullRequest({
    workspaceId,
    // Citing a PR on an idea must never claim it for a task.
    taskId: null,
    // Read as the App installation — there is no OAuth integration behind it.
    integrationId: null,
    repo: parsed.repo,
    number: ghPr.number,
    title: ghPr.title,
    url: ghPr.html_url,
    state: toPrState(ghPr),
    authorLogin: ghPr.user.login,
    headBranch: ghPr.head.ref,
    headSha: ghPr.head.sha,
    baseBranch: ghPr.base.ref,
    isDraft: ghPr.draft,
    mergedAt: ghPr.merged_at ? new Date(ghPr.merged_at) : null,
    closedAt: ghPr.closed_at ? new Date(ghPr.closed_at) : null,
  })
  return upserted.id
}
