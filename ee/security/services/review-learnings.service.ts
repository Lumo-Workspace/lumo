/**
 * LUM-1131 — the learnings a review of this repository reads: the
 * repository's PR-review learnings in scope for this PR (its own, and those
 * of merged PRs — `learningInScope`) whose memory is still ACTIVE (an edit in
 * the memory UI is what the review sees; a deleted or retired memory is
 * gone), filtered to the files the review reads, guarded line by line and
 * bounded (`REVIEW_LEARNINGS_MAX_*`). Never throws — a review without its
 * learnings is today's review.
 *
 * LUM-1134 — the workspace's learnings scope decides whether the workspace's
 * other repositories' learnings join them (`global`, or `auto` on a private
 * repository; a visibility GitHub did not confirm counts as public).
 */
import { logger } from '@/lib/logger'
import { conventionContentSchema } from '@/lib/memory/schemas'
import { guardPromptLineText } from '@/lib/security-scan/inject-guard'
import { prReviewLearningRepository } from '@/ee/security/repositories/pr-review-learning.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import {
  learningInScope,
  REVIEW_LEARNINGS_MAX_ITEMS,
  renderReviewLearnings,
  selectRelevantLearnings,
  type StoredLearning,
} from '@/ee/security/security-scan/thread-reply'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import {
  readsOtherRepositories,
  type RepoVisibility,
} from '@/ee/security/security-scan/learnings-scope'

/** Rows read before relevance filtering — bounds the query, not the prompt. */
const READ_LIMIT = 100

/** The reviewed repository's visibility (LUM-1134 `auto`), read live. */
export type RepoVisibilityReader = (opts: {
  workspaceId: string
  fullName: string
}) => Promise<RepoVisibility>

const readRepoVisibility: RepoVisibilityReader = async opts => {
  // Dynamic import keeps the GitHub App auth (ESM) out of this module's
  // static graph — the scan service imports it statically.
  const { fetchRepoVisibility } =
    await import('@/lib/integrations/github/contents')
  return fetchRepoVisibility(opts)
}

type Row = Awaited<
  ReturnType<typeof prReviewLearningRepository.findActiveForRepo>
>[number]

export async function loadReviewLearnings(
  input: {
    workspaceId: string
    repo: string
    /** The PR under review: its own learnings apply before it merges. */
    pullRequestId: string
    reviewedPaths: string[]
  },
  deps: { repoVisibility?: RepoVisibilityReader } = {}
): Promise<string> {
  try {
    // LUM-1134: `local` reads this repository only; `global` / `auto` may
    // add the workspace's other repositories (never another workspace's).
    const scope = await securityColumnsRepository.findLearningsScope(
      input.workspaceId
    )
    const [own, others] = await Promise.all([
      prReviewLearningRepository.findActiveForRepo(
        input.workspaceId,
        input.repo,
        READ_LIMIT
      ),
      scope === 'local'
        ? Promise.resolve([] as Row[])
        : prReviewLearningRepository.findActiveForOtherRepos(
            input.workspaceId,
            input.repo,
            READ_LIMIT
          ),
    ])
    const rows = [...own, ...others]
    const sourceIds = [
      ...new Set(
        rows
          .filter(r => !r.repoWideAt && r.sourcePullRequestId)
          .map(r => r.sourcePullRequestId as string)
      ),
    ]
    const states = await pullRequestRepository.findStatesByIds(
      input.workspaceId,
      sourceIds
    )
    const toStored = (list: Row[]): StoredLearning[] => {
      const stored: StoredLearning[] = []
      for (const r of list) {
        if (
          !learningInScope(
            r,
            input.pullRequestId,
            r.sourcePullRequestId
              ? states.get(r.sourcePullRequestId)
              : undefined
          )
        )
          continue
        const parsed = conventionContentSchema.safeParse(r.content)
        if (parsed.success)
          stored.push({ text: parsed.data.rule, pathGlob: r.pathGlob })
      }
      return stored
    }
    const ownStored = selectRelevantLearnings(
      toStored(own),
      input.reviewedPaths
    )
    // Another repository's learning applies here only once it is
    // repository-wide there (its source PR merged — `learningInScope`, as a
    // PR-only learning names a PR of that repository) and is relevant to the
    // files this review reads. This repository's own learnings come first,
    // so the shared cap never pushes them out.
    let otherStored = selectRelevantLearnings(
      toStored(others),
      input.reviewedPaths
    )
    if (otherStored.length > 0 && scope === 'auto') {
      const visibility = await (deps.repoVisibility ?? readRepoVisibility)({
        workspaceId: input.workspaceId,
        fullName: input.repo,
      }).catch((): RepoVisibility => 'unknown')
      if (!readsOtherRepositories(scope, visibility)) otherStored = []
    }
    return renderReviewLearnings(
      [...ownStored, ...otherStored].slice(0, REVIEW_LEARNINGS_MAX_ITEMS),
      guardPromptLineText
    )
  } catch (error) {
    logger.warn(
      `[review-learnings] read failed ${input.repo}: ${error instanceof Error ? error.message : String(error)}`
    )
    return ''
  }
}

/**
 * The source PR merged (into any branch): its learnings apply to the whole
 * repository from now on. Idempotent; returns how many were promoted.
 */
export async function promoteLearningsOnMerge(
  workspaceId: string,
  pullRequestId: string,
  at: Date = new Date()
): Promise<number> {
  return prReviewLearningRepository.markRepoWideForPullRequest(
    workspaceId,
    pullRequestId,
    at
  )
}
