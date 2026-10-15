/**
 * LUM-1133 — automatic review of PRs that have no Lumo task (auto-review
 * filters). PURE: the service loads the inputs.
 *
 * A task-linked PR keeps its scan regardless of these settings — it is the
 * DONE gate's evidence. A task-less PR is reviewed when:
 *  - the event is one a review runs on (opened / reopened / synchronize /
 *    ready_for_review on an open PR) — or, LUM-1143, a labeled / unlabeled /
 *    edited event after which the PR NEWLY passes the filters below (it did
 *    not with its previous labels / title / description / base);
 *  - this workspace confirmed the repository (never just because a webhook
 *    arrived — tenant isolation);
 *  - the repository's filters let it through (LUM-1143), in this
 *    precedence — the first rule that decides wins:
 *      1. `ignoreUsernames` — exact, case-sensitive author login ⇒ skip;
 *      2. `ignoreTitleKeywords` (case-insensitive substring of the title)
 *         and negative labels (`!wip`) ⇒ skip;
 *      3. enabled / opt-in: with automatic review ON, a list with positive
 *         labels reviews only PRs carrying one of them; with it OFF, only a
 *         PR carrying a positive label or whose description contains
 *         `descriptionKeyword` is reviewed (negative-only labels never opt
 *         in);
 *      4. base branch — the default branch is always reviewed; other bases
 *         must fully match one of `baseBranches` (regexes; `.*` = all). An
 *         EMPTY list means the repository's `emptyBaseBranchesMeans`;
 *      5. drafts — skipped unless the repository opted drafts in. A PR
 *         converted back to draft keeps its earlier findings and threads;
 *         marking it ready reviews the then-current head;
 *  - no other workspace holds the PR linked to one of its tasks, and among
 *    the workspaces that confirmed the repository and would review it, this
 *    one confirmed first — so a repository two workspaces share gets one
 *    review on GitHub, not two.
 *
 * Manual `@<app> review` and `lumo pr scan --review` bypass all of this.
 *
 * LUM-1152 — `@<app> ignore` in the PR description (`hasIgnoreDirective`)
 * sits on top of every rule above, for task-linked and task-less PRs alike:
 * an automatic scan still runs (and is dispatched by the rules above exactly
 * as without it), but its AI review and exploit-path hunt are skipped
 * (`AI_REVIEW_IGNORED`) and the summary says why. It beats every opt-in —
 * positive labels, `descriptionKeyword`, `ignoreUsernames` cannot re-enable
 * it — and only the description's CURRENT text counts: it is read when the
 * scan runs, so adding or removing it with a `pull_request.edited` event
 * starts nothing by itself (an edit only reviews when the filters above
 * newly let the PR through); the next push after removing it is reviewed.
 * The deterministic layers (secrets, scanners, dependencies) keep running —
 * a task-linked PR keeps its DONE-gate scan. Manual reviews ignore it.
 */
import { shouldScanOnPrEvent } from '@/ee/security/services/pr-security-scan-dispatch'
import type { PathInstruction } from './path-instructions'
import { DEFAULT_REVIEW_PROFILE, type ReviewProfile } from './review-profile'

/**
 * What an EMPTY `baseBranches` list reviews (user decision, 2026-10-15):
 * repositories connected before LUM-1143 were backfilled to
 * `'all_branches'` (nothing changes for them); a newly connected repository
 * gets `'default_branch_only'` — only PRs into its default branch.
 */
export type EmptyBaseBranchesMeans = 'all_branches' | 'default_branch_only'

export const EMPTY_BASE_BRANCHES_VALUES: readonly EmptyBaseBranchesMeans[] = [
  'all_branches',
  'default_branch_only',
]

/** A stored value as the domain type (an unknown string = the new-repo default). */
export function parseEmptyBaseBranchesMeans(
  raw: string | null | undefined
): EmptyBaseBranchesMeans {
  return raw === 'all_branches' ? 'all_branches' : 'default_branch_only'
}

/** A newly connected repository (no stored row). */
export const NEW_REPO_EMPTY_BASE_BRANCHES_MEANS: EmptyBaseBranchesMeans =
  'default_branch_only'

export interface RepoReviewSettingValues {
  /** Review every PR of the repository automatically (`enabled`). */
  autoReview: boolean
  /** Review draft PRs too (otherwise they wait for ready_for_review). */
  reviewDrafts: boolean
  /** Regexes on the base branch; the default branch is always included. */
  baseBranches: string[]
  /** What an empty `baseBranches` reviews (per repository, stored). */
  emptyBaseBranchesMeans: EmptyBaseBranchesMeans
  /** `label` = positive (opt in / restrict), `!label` = exclude. */
  labels: string[]
  /** Case-insensitive title substrings that skip the review. */
  ignoreTitleKeywords: string[]
  /** Exact, case-sensitive author logins that are never reviewed. */
  ignoreUsernames: string[]
  /** With autoReview off: a description containing this opts the PR in. */
  descriptionKeyword: string | null
  /** Globs for what the review reads (reviewable-path.ts). */
  pathFilters: string[]
  /** LUM-1147: extra AI-review instructions per path glob. */
  pathInstructions: PathInstruction[]
  /** LUM-1147: which findings get inline comments (review-profile.ts). */
  reviewProfile: ReviewProfile
  /** LUM-1147: how the AI review words its findings; null = none. */
  toneInstructions: string | null
}

/** No stored row = these. */
export const DEFAULT_REPO_REVIEW_SETTING: Readonly<RepoReviewSettingValues> =
  Object.freeze({
    autoReview: true,
    reviewDrafts: false,
    baseBranches: [],
    emptyBaseBranchesMeans: NEW_REPO_EMPTY_BASE_BRANCHES_MEANS,
    labels: [],
    ignoreTitleKeywords: [],
    ignoreUsernames: [],
    descriptionKeyword: null,
    pathFilters: [],
    pathInstructions: [],
    reviewProfile: DEFAULT_REVIEW_PROFILE,
    toneInstructions: null,
  })

/**
 * What the webhook says about the PR. A field the payload lacked is null /
 * empty and never makes a filter skip the PR (fail-open = pre-1143).
 */
export interface PrReviewFacts {
  isDraft: boolean
  baseBranch: string | null
  defaultBranch: string | null
  labels: string[]
  title: string | null
  body: string | null
  authorLogin: string | null
}

export const UNKNOWN_PR_FACTS: Readonly<Omit<PrReviewFacts, 'isDraft'>> =
  Object.freeze({
    baseBranch: null,
    defaultBranch: null,
    labels: [],
    title: null,
    body: null,
    authorLogin: null,
  })

export interface ConfirmingWorkspace {
  workspaceId: string
  /** When the workspace's GitHub App row was created (its confirmation). */
  confirmedAt: Date
  setting: RepoReviewSettingValues
}

export type ReviewFilterSkip =
  | 'ignored_author'
  | 'ignored_title'
  | 'excluded_label'
  | 'label_missing'
  | 'repo_off'
  | 'base_branch'
  | 'draft'

export type TasklessReviewSkip =
  | 'not_a_review_event'
  | 'not_newly_matching'
  | 'repo_not_confirmed'
  | ReviewFilterSkip
  | 'linked_elsewhere'
  | 'other_workspace_reviews'

export type ReviewFilterDecision =
  | { review: true }
  | { review: false; reason: ReviewFilterSkip }

export type TasklessReviewDecision =
  | { review: true }
  | { review: false; reason: TasklessReviewSkip }

/** pull_request actions after which the filters are re-evaluated. */
const FILTER_CHANGE_ACTIONS = new Set(['labeled', 'unlabeled', 'edited'])

/** PURE — a labeled / unlabeled / edited event on an open PR. */
export function isFilterChangeEvent(action: string, state: string): boolean {
  return state === 'open' && FILTER_CHANGE_ACTIONS.has(action)
}

export interface TasklessReviewInput {
  action: string
  state: string
  isDraft: boolean
  /** LUM-1143: the PR's facts (isDraft is taken from the field above). */
  pr?: Omit<PrReviewFacts, 'isDraft'> | undefined
  /**
   * LUM-1143: for a labeled / unlabeled / edited event, the facts as they
   * were before it. Absent = the event changed nothing a filter reads.
   */
  before?: Omit<PrReviewFacts, 'isDraft'> | undefined
  workspaceId: string
  /** Every workspace whose confirmed list holds the repository. */
  confirming: readonly ConfirmingWorkspace[]
  /** Another workspace holds this PR linked to one of its tasks. */
  linkedElsewhere: boolean
}

const nonEmpty = (xs: readonly string[]) =>
  xs.map(x => x.trim()).filter(x => x.length > 0)

/** Positive and negative entries of a `labels` list (case-insensitive). */
export function splitLabelFilters(labels: readonly string[]): {
  positive: string[]
  negative: string[]
} {
  const all = nonEmpty(labels)
  return {
    positive: all.filter(l => !l.startsWith('!')).map(l => l.toLowerCase()),
    negative: all
      .filter(l => l.startsWith('!'))
      .map(l => l.slice(1).trim().toLowerCase())
      .filter(l => l.length > 0),
  }
}

/** A `baseBranches` entry as an anchored RegExp; null when it does not compile. */
export function baseBranchRegExp(pattern: string): RegExp | null {
  try {
    return new RegExp(`^(?:${pattern})$`)
  } catch {
    return null
  }
}

function baseBranchAllowed(
  setting: RepoReviewSettingValues,
  pr: Omit<PrReviewFacts, 'isDraft'>
): boolean {
  if (pr.baseBranch === null || pr.defaultBranch === null) return true
  if (pr.baseBranch === pr.defaultBranch) return true
  const patterns = nonEmpty(setting.baseBranches)
  if (patterns.length === 0)
    return setting.emptyBaseBranchesMeans === 'all_branches'
  return patterns.some(p => baseBranchRegExp(p)?.test(pr.baseBranch!) ?? false)
}

/** PURE — one repository's filters on one PR, in the documented precedence. */
export function evaluateReviewFilters(
  setting: RepoReviewSettingValues,
  pr: PrReviewFacts
): ReviewFilterDecision {
  const skip = (reason: ReviewFilterSkip) =>
    ({ review: false, reason }) as const
  // 1. Ignored authors beat everything, labels and opt-ins included.
  if (
    pr.authorLogin !== null &&
    nonEmpty(setting.ignoreUsernames).includes(pr.authorLogin)
  )
    return skip('ignored_author')
  // 2. Title keywords and negative labels.
  const title = (pr.title ?? '').toLowerCase()
  if (
    pr.title !== null &&
    nonEmpty(setting.ignoreTitleKeywords).some(k =>
      title.includes(k.toLowerCase())
    )
  )
    return skip('ignored_title')
  const prLabels = new Set(pr.labels.map(l => l.toLowerCase()))
  const { positive, negative } = splitLabelFilters(setting.labels)
  if (negative.some(l => prLabels.has(l))) return skip('excluded_label')
  // 3. Enabled / opt-in.
  const hasPositive = positive.some(l => prLabels.has(l))
  if (setting.autoReview) {
    if (positive.length > 0 && !hasPositive) return skip('label_missing')
  } else {
    const keyword = setting.descriptionKeyword?.trim() ?? ''
    const keywordOptIn =
      keyword.length > 0 && pr.body !== null && pr.body.includes(keyword)
    if (!hasPositive && !keywordOptIn) return skip('repo_off')
  }
  // 4. Base branch.
  if (!baseBranchAllowed(setting, pr)) return skip('base_branch')
  // 5. Drafts.
  if (pr.isDraft && !setting.reviewDrafts) return skip('draft')
  return { review: true }
}

export function decideTasklessAutoReview(
  input: TasklessReviewInput
): TasklessReviewDecision {
  const skip = (reason: TasklessReviewSkip) =>
    ({ review: false, reason }) as const
  const reviewEvent = shouldScanOnPrEvent(input.action, input.state)
  const filterChange =
    !reviewEvent &&
    isFilterChangeEvent(input.action, input.state) &&
    input.before !== undefined
  if (!reviewEvent && !filterChange) return skip('not_a_review_event')
  const self = input.confirming.find(c => c.workspaceId === input.workspaceId)
  if (!self) return skip('repo_not_confirmed')
  const facts: PrReviewFacts = {
    ...UNKNOWN_PR_FACTS,
    ...input.pr,
    isDraft: input.isDraft,
  }
  const verdict = evaluateReviewFilters(self.setting, facts)
  if (!verdict.review) return verdict
  // A label / title / description / base change only reviews a PR the
  // change newly lets through — one that already passed was reviewed (or
  // deliberately not) on its own events.
  if (
    filterChange &&
    evaluateReviewFilters(self.setting, {
      ...facts,
      ...input.before,
      isDraft: input.isDraft,
    }).review
  )
    return skip('not_newly_matching')
  if (input.linkedElsewhere) return skip('linked_elsewhere')
  const reviewer = input.confirming
    .filter(c => evaluateReviewFilters(c.setting, facts).review)
    .sort(
      (a, b) =>
        a.confirmedAt.getTime() - b.confirmedAt.getTime() ||
        (a.workspaceId < b.workspaceId ? -1 : 1)
    )[0]
  if (reviewer?.workspaceId !== input.workspaceId)
    return skip('other_workspace_reviews')
  return { review: true }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * LUM-1152 — does this PR description carry `<handle> ignore` (`@slug` or
 * `@slug[bot]`, any case, anywhere in the text — HTML comments included, so
 * it can be hidden)? Text inside fenced code blocks, inline code spans and
 * `>` quotes does not count: a description that documents the directive is
 * not using it. `handle` null (the App's slug is not configured) = never.
 * PURE.
 */
export function hasIgnoreDirective(
  body: string | null | undefined,
  handle: string | null
): boolean {
  if (!body || !handle) return false
  const directive = new RegExp(
    `(?:^|[^\\w@/-])${escapeRegExp(handle)}(?:\\[bot\\])?[\\s,:]+ignore(?![\\w-])`,
    'i'
  )
  let fenced = false
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced || line.startsWith('>')) continue
    if (directive.test(line.replace(/`[^`]*`/g, ' '))) return true
  }
  return false
}
