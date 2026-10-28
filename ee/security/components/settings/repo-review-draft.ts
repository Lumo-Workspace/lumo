import type { EmptyBaseBranchesMeans } from '@/ee/security/security-scan/auto-review-policy'
import {
  DEFAULT_PRE_MERGE_CHECKS,
  type CustomPreMergeCheck,
  type PreMergeCheckMode,
  type PreMergeChecksSetting,
} from '@/ee/security/security-scan/pre-merge-checks'
import type { PathInstruction } from '@/ee/security/security-scan/path-instructions'
import {
  DEFAULT_REVIEW_PROFILE,
  type ReviewProfile,
} from '@/ee/security/security-scan/review-profile'
import type { HighLevelSummaryMode } from '@/ee/security/security-scan/pr-description-summary'
import type {
  RepoReviewSettingView,
  RepoReviewSettingsUpdate,
} from '@/ee/security/services/repo-review-settings.service'

/**
 * LUM-1331 — the per-repository settings sheet edits one draft and saves it
 * with one PATCH. PURE: the draft shape, its diff against the stored setting,
 * and the one-line summary the repository list shows.
 */

// ── When to review ─────────────────────────────────────────────────────

/** `default` = only the default branch, `any` = every base branch,
 *  `patterns` = the default branch plus the matching ones. */
export type BranchScope = 'default' | 'any' | 'patterns'

/** The regex that matches every base branch. */
const ANY_BRANCH = '.*'

/** Which scopes the repository can express: a repository whose empty list
 *  means "all branches" (stored before LUM-1143) has no "default only". */
export function branchScopesFor(
  emptyMeans: EmptyBaseBranchesMeans
): BranchScope[] {
  return emptyMeans === 'all_branches'
    ? ['any', 'patterns']
    : ['default', 'any', 'patterns']
}

export function branchScopeOf(
  baseBranches: readonly string[],
  emptyMeans: EmptyBaseBranchesMeans
): BranchScope {
  if (baseBranches.length === 0)
    return emptyMeans === 'all_branches' ? 'any' : 'default'
  if (baseBranches.length === 1 && baseBranches[0] === ANY_BRANCH) return 'any'
  return 'patterns'
}

/** The stored `baseBranches` for a scope. */
export function baseBranchesFor(
  scope: BranchScope,
  patterns: readonly string[],
  emptyMeans: EmptyBaseBranchesMeans
): string[] {
  if (scope === 'patterns') return [...patterns]
  if (scope === 'any') return emptyMeans === 'all_branches' ? [] : [ANY_BRANCH]
  return []
}

/** Stored labels: `label` limits or opts in, `!label` skips. */
export function splitLabels(labels: readonly string[]): {
  only: string[]
  skip: string[]
} {
  return {
    only: labels.filter(l => !l.startsWith('!')),
    skip: labels.filter(l => l.startsWith('!')).map(l => l.slice(1)),
  }
}

export function joinLabels(
  only: readonly string[],
  skip: readonly string[]
): string[] {
  return [...only, ...skip.map(l => `!${l}`)]
}

/** True when the server could not compile `pattern` as a regex. */
export function invalidRegExp(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return false
  } catch {
    return true
  }
}

export interface FiltersDraft {
  branchScope: BranchScope
  branchPatterns: string[]
  onlyLabels: string[]
  skipLabels: string[]
  ignoreTitleKeywords: string[]
  ignoreUsernames: string[]
  descriptionKeyword: string
  pathFilters: string[]
}

export function draftOfFilters(setting: RepoReviewSettingView): FiltersDraft {
  const scope = branchScopeOf(
    setting.baseBranches,
    setting.emptyBaseBranchesMeans
  )
  const { only, skip } = splitLabels(setting.labels)
  return {
    branchScope: scope,
    branchPatterns: scope === 'patterns' ? [...setting.baseBranches] : [],
    onlyLabels: only,
    skipLabels: skip,
    ignoreTitleKeywords: [...setting.ignoreTitleKeywords],
    ignoreUsernames: [...setting.ignoreUsernames],
    descriptionKeyword: setting.descriptionKeyword ?? '',
    pathFilters: [...setting.pathFilters],
  }
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i])

const sameSet = (a: readonly string[], b: readonly string[]) =>
  sameList([...a].sort(), [...b].sort())

/** PURE — the filter fields that changed (empty object = none). */
export function filtersUpdate(
  setting: RepoReviewSettingView,
  d: FiltersDraft
): Omit<RepoReviewSettingsUpdate, 'repo'> {
  const update: Omit<RepoReviewSettingsUpdate, 'repo'> = {}
  const baseBranches = baseBranchesFor(
    d.branchScope,
    d.branchPatterns,
    setting.emptyBaseBranchesMeans
  )
  if (!sameList(baseBranches, setting.baseBranches))
    update.baseBranches = baseBranches
  const labels = joinLabels(d.onlyLabels, d.skipLabels)
  // Only and skip labels are shown apart: their order is not a change.
  if (!sameSet(labels, setting.labels)) update.labels = labels
  if (!sameList(d.ignoreTitleKeywords, setting.ignoreTitleKeywords))
    update.ignoreTitleKeywords = d.ignoreTitleKeywords
  if (!sameList(d.ignoreUsernames, setting.ignoreUsernames))
    update.ignoreUsernames = d.ignoreUsernames
  if (!sameList(d.pathFilters, setting.pathFilters))
    update.pathFilters = d.pathFilters
  const keyword = d.descriptionKeyword.trim()
  if (keyword !== (setting.descriptionKeyword ?? ''))
    update.descriptionKeyword = keyword.length > 0 ? keyword : null
  return update
}

// ── Pre-merge checks ───────────────────────────────────────────────────

export interface PreMergeDraft {
  titleMode: PreMergeCheckMode
  titleRequirements: string
  descriptionMode: PreMergeCheckMode
  /** LUM-1149: the linked task / issue assessment. */
  issueMode: PreMergeCheckMode
  taskDetailsOnPublicRepos: boolean
  customChecks: CustomPreMergeCheck[]
  overrideRequestedReviewersOnly: boolean
}

export function draftOfChecks(s: PreMergeChecksSetting): PreMergeDraft {
  return {
    titleMode: s.title.mode,
    titleRequirements: s.title.requirements ?? '',
    descriptionMode: s.description.mode,
    issueMode: s.issueAssessment.mode,
    taskDetailsOnPublicRepos: s.issueAssessment.taskDetailsOnPublicRepos,
    customChecks: s.customChecks.map(c => ({ ...c })),
    overrideRequestedReviewersOnly: s.overrideRequestedReviewersOnly,
  }
}

/** PURE — the PATCH body for what the owner changed (null = nothing). */
export function preMergeChecksUpdate(
  repo: string,
  s: PreMergeChecksSetting,
  d: PreMergeDraft
): RepoReviewSettingsUpdate | null {
  const requirements = d.titleRequirements.trim()
  const custom = d.customChecks
    .map(c => ({
      name: c.name.trim(),
      mode: c.mode,
      instructions: c.instructions.trim(),
    }))
    .filter(c => c.name.length > 0 && c.instructions.length > 0)
  const title: { mode?: PreMergeCheckMode; requirements?: string | null } = {}
  if (d.titleMode !== s.title.mode) title.mode = d.titleMode
  if (requirements !== (s.title.requirements ?? ''))
    title.requirements = requirements.length > 0 ? requirements : null
  const checks: NonNullable<RepoReviewSettingsUpdate['preMergeChecks']> = {}
  if (Object.keys(title).length > 0) checks.title = title
  if (d.descriptionMode !== s.description.mode)
    checks.description = { mode: d.descriptionMode }
  const issue: {
    mode?: PreMergeCheckMode
    taskDetailsOnPublicRepos?: boolean
  } = {}
  if (d.issueMode !== s.issueAssessment.mode) issue.mode = d.issueMode
  if (d.taskDetailsOnPublicRepos !== s.issueAssessment.taskDetailsOnPublicRepos)
    issue.taskDetailsOnPublicRepos = d.taskDetailsOnPublicRepos
  if (Object.keys(issue).length > 0) checks.issueAssessment = issue
  if (JSON.stringify(custom) !== JSON.stringify(s.customChecks))
    checks.customChecks = custom
  if (d.overrideRequestedReviewersOnly !== s.overrideRequestedReviewersOnly)
    checks.overrideRequestedReviewersOnly = d.overrideRequestedReviewersOnly
  return Object.keys(checks).length > 0
    ? { repo, preMergeChecks: checks }
    : null
}

// ── Review style ───────────────────────────────────────────────────────

export interface StyleDraft {
  reviewProfile: ReviewProfile
  toneInstructions: string
  pathInstructions: PathInstruction[]
  highLevelSummary: HighLevelSummaryMode
  sequenceDiagrams: boolean
}

export function draftOfStyle(setting: RepoReviewSettingView): StyleDraft {
  return {
    highLevelSummary: setting.highLevelSummary,
    sequenceDiagrams: setting.sequenceDiagrams,
    reviewProfile: setting.reviewProfile,
    toneInstructions: setting.toneInstructions ?? '',
    pathInstructions: setting.pathInstructions.map(p => ({ ...p })),
  }
}

/** Trimmed rows, a row missing either half dropped. */
function cleanRows(rows: readonly PathInstruction[]): PathInstruction[] {
  return rows
    .map(r => ({ path: r.path.trim(), instructions: r.instructions.trim() }))
    .filter(r => r.path.length > 0 && r.instructions.length > 0)
}

/** PURE — the PATCH body for what the owner changed (null = nothing). */
export function styleUpdate(
  setting: RepoReviewSettingView,
  draft: StyleDraft
): RepoReviewSettingsUpdate | null {
  const update: RepoReviewSettingsUpdate = { repo: setting.repo }
  let changed = false
  if (draft.reviewProfile !== setting.reviewProfile) {
    update.reviewProfile = draft.reviewProfile
    changed = true
  }
  // LUM-1151: where the high-level summary goes.
  if (draft.highLevelSummary !== setting.highLevelSummary) {
    update.highLevelSummary = draft.highLevelSummary
    changed = true
  }
  // LUM-1155: the call-flow diagram in the walkthrough.
  if (draft.sequenceDiagrams !== setting.sequenceDiagrams) {
    update.sequenceDiagrams = draft.sequenceDiagrams
    changed = true
  }
  const tone = draft.toneInstructions.trim()
  if (tone !== (setting.toneInstructions ?? '')) {
    update.toneInstructions = tone.length > 0 ? tone : null
    changed = true
  }
  const rows = cleanRows(draft.pathInstructions)
  if (JSON.stringify(rows) !== JSON.stringify(setting.pathInstructions)) {
    update.pathInstructions = rows
    changed = true
  }
  return changed ? update : null
}

// ── The whole sheet ────────────────────────────────────────────────────

export interface RepoReviewDraft {
  filters: FiltersDraft
  checks: PreMergeDraft
  style: StyleDraft
}

export function draftOfRepo(setting: RepoReviewSettingView): RepoReviewDraft {
  return {
    filters: draftOfFilters(setting),
    checks: draftOfChecks(setting.preMergeChecks),
    style: draftOfStyle(setting),
  }
}

/** PURE — one PATCH body for every section that changed (null = nothing). */
export function repoReviewUpdate(
  setting: RepoReviewSettingView,
  draft: RepoReviewDraft
): RepoReviewSettingsUpdate | null {
  const update: RepoReviewSettingsUpdate = {
    repo: setting.repo,
    ...filtersUpdate(setting, draft.filters),
    ...preMergeChecksUpdate(setting.repo, setting.preMergeChecks, draft.checks),
    ...styleUpdate(setting, draft.style),
  }
  return Object.keys(update).length > 1 ? update : null
}

/** How many settings the PATCH would change (the save bar's count). */
export function changedCount(update: RepoReviewSettingsUpdate | null): number {
  if (update === null) return 0
  const { repo: _repo, preMergeChecks, ...rest } = update
  return (
    Object.keys(rest).length +
    (preMergeChecks ? Object.keys(preMergeChecks).length : 0)
  )
}

/** What keeps the draft from being saved (empty = savable). */
export type DraftProblem = 'branchPatternsEmpty'

export function draftProblems(draft: RepoReviewDraft): DraftProblem[] {
  return draft.filters.branchScope === 'patterns' &&
    draft.filters.branchPatterns.length === 0
    ? ['branchPatternsEmpty']
    : []
}

// ── The list's one-line summary ────────────────────────────────────────

/** One summary part: a message id under `workspaceSettings.repoReview.summary.`
 *  and its values. */
export interface SummaryPart {
  id: string
  values?: Record<string, number | string>
}

const CHECK_MODES = (s: PreMergeChecksSetting): PreMergeCheckMode[] => [
  s.title.mode,
  s.description.mode,
  s.issueAssessment.mode,
  ...s.customChecks.map(c => c.mode),
]

/** PURE — what sets this repository apart from the defaults, in order;
 *  `[{ id: 'default' }]` when nothing does. */
export function repoReviewSummary(
  setting: RepoReviewSettingView
): SummaryPart[] {
  const parts: SummaryPart[] = []
  const scope = branchScopeOf(
    setting.baseBranches,
    setting.emptyBaseBranchesMeans
  )
  if (scope === 'any') parts.push({ id: 'anyBranch' })
  if (scope === 'patterns')
    parts.push({
      id: 'branchPatterns',
      values: { count: setting.baseBranches.length },
    })
  const { only, skip } = splitLabels(setting.labels)
  const skipRules =
    skip.length +
    setting.ignoreTitleKeywords.length +
    setting.ignoreUsernames.length
  if (skipRules > 0)
    parts.push({ id: 'skipRules', values: { count: skipRules } })
  const onlyRules = only.length + (setting.descriptionKeyword ? 1 : 0)
  if (onlyRules > 0)
    parts.push({ id: 'onlyRules', values: { count: onlyRules } })
  if (setting.pathFilters.length > 0)
    parts.push({
      id: 'pathFilters',
      values: { count: setting.pathFilters.length },
    })
  // Compared field by field (the diff), not by key order.
  if (
    preMergeChecksUpdate(
      setting.repo,
      DEFAULT_PRE_MERGE_CHECKS,
      draftOfChecks(setting.preMergeChecks)
    ) !== null
  ) {
    const modes = CHECK_MODES(setting.preMergeChecks)
    const on = modes.filter(m => m !== 'off').length
    const blocking = modes.filter(m => m === 'error').length
    parts.push({ id: 'checks', values: { count: on, blocking } })
  }
  if (setting.reviewProfile !== DEFAULT_REVIEW_PROFILE)
    parts.push({ id: `profile.${setting.reviewProfile}` })
  if (setting.pathInstructions.length > 0)
    parts.push({
      id: 'pathInstructions',
      values: { count: setting.pathInstructions.length },
    })
  return parts.length > 0 ? parts : [{ id: 'default' }]
}
