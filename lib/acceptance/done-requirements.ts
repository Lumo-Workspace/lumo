/**
 * LUM-1334 — the two opt-in DONE requirements, evaluated per pull request.
 *
 * Pure (no prisma / repository / service), like `done-verdict.ts`: the
 * service collects the rows, this decides. A requirement holds for a PR only
 * on positive evidence about that PR's own commits — anything unknown (no
 * head recorded, no commit on the run) counts as missing, never as met.
 */
import { sameCommit } from '@/lib/test-cases/freshness'

export type DoneRequirement = 'TEST_CASE' | 'REVIEW'

export interface DoneRequirementSwitches {
  testCase: boolean
  review: boolean
}

export interface RequirementPullRequest {
  id: string
  number: number
  /** "open" | "closed" | "merged" */
  state: string
  headSha: string | null
  mergeCommitSha: string | null
}

/** A test case's latest run, already judged PASS and not capped UNPROVEN. */
export interface PassingRun {
  pullRequestId: string | null
  commitSha: string | null
  commitDirty: boolean | null
}

/** A stored GitHub review (APPROVED / CHANGES_REQUESTED / DISMISSED). */
export interface StoredReview {
  pullRequestId: string
  reviewerLogin: string
  state: string
  commitSha: string
  submittedAt: Date
}

export interface MissingRequirement {
  requirement: DoneRequirement
  prNumber: number
}

/** The PRs the requirements apply to: a closed-unmerged PR was abandoned. */
export function countedPullRequests<T extends { state: string }>(
  prs: T[]
): T[] {
  return prs.filter(pr => pr.state !== 'closed')
}

/** The commits that stand for the PR's code: its head and, once merged, the merge commit. */
function prCommits(pr: RequirementPullRequest): string[] {
  return [pr.headSha, pr.mergeCommitSha].filter(
    (sha): sha is string => typeof sha === 'string' && sha !== ''
  )
}

/**
 * A passing run covers the PR when it was recorded on a clean tree at the
 * PR's head or merge commit, and against this PR or no PR at all (a local run
 * without `--pr` still names the commit it tested). The merge commit counts
 * because a squash merge leaves runs on the head looking "stale" against it
 * (`deriveRunFreshness`), and a run on the merge commit is the shipped code.
 */
export function runCoversPullRequest(
  run: PassingRun,
  pr: RequirementPullRequest
): boolean {
  if (run.pullRequestId !== null && run.pullRequestId !== pr.id) return false
  if (run.commitDirty === true || !run.commitSha) return false
  const sha = run.commitSha
  return prCommits(pr).some(c => sameCommit(sha, c))
}

/**
 * A GitHub approval covers the PR's head when some reviewer's latest stored
 * review is APPROVED on that head commit. A later change request or a
 * dismissal by the same reviewer withdraws it.
 */
export function approvalCoversHead(
  reviews: StoredReview[],
  pr: RequirementPullRequest
): boolean {
  const head = pr.headSha
  if (!head) return false
  const latest = new Map<string, StoredReview>()
  for (const r of reviews) {
    if (r.pullRequestId !== pr.id) continue
    const prev = latest.get(r.reviewerLogin)
    if (!prev || r.submittedAt.getTime() >= prev.submittedAt.getTime())
      latest.set(r.reviewerLogin, r)
  }
  for (const r of latest.values())
    if (r.state === 'APPROVED' && sameCommit(r.commitSha, head)) return true
  return false
}

/**
 * Every requirement a counted PR does not meet, in PR order then
 * TEST_CASE before REVIEW. Switches off → `[]`.
 *
 * `pluginReviewed` holds the ids of PRs whose head a plugin review covers
 * (Lumo's AI review or an imported agent review on that head).
 */
export function missingDoneRequirements(input: {
  switches: DoneRequirementSwitches
  pullRequests: RequirementPullRequest[]
  passingRuns: PassingRun[]
  reviews: StoredReview[]
  pluginReviewed: ReadonlySet<string>
}): MissingRequirement[] {
  const { switches } = input
  if (!switches.testCase && !switches.review) return []
  const missing: MissingRequirement[] = []
  for (const pr of countedPullRequests(input.pullRequests)) {
    if (
      switches.testCase &&
      !input.passingRuns.some(run => runCoversPullRequest(run, pr))
    )
      missing.push({ requirement: 'TEST_CASE', prNumber: pr.number })
    if (
      switches.review &&
      !(
        (pr.headSha !== null && input.pluginReviewed.has(pr.id)) ||
        approvalCoversHead(input.reviews, pr)
      )
    )
      missing.push({ requirement: 'REVIEW', prNumber: pr.number })
  }
  return missing
}
