import { apiCall, apiContext } from '../lib/test-case-api'
import { missingPluginMessage } from '../lib/plugin-route'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'
import { sanitizeField } from '../lib/sanitize'

/**
 * LUM-1133 — per-repository automatic review of PRs without a Lumo task
 * (`lumo workspace security-scan --repos | --repo <owner/name> …`).
 */

export interface RepoReviewOptions extends ConfirmFlags {
  repo?: string
  repos?: boolean
  review?: string
  drafts?: string
  /** LUM-1143 filters — each repeatable flag replaces the list; "" clears. */
  baseBranches?: string[]
  labels?: string[]
  ignoreTitle?: string[]
  ignoreUsers?: string[]
  descriptionKeyword?: string
  pathFilter?: string[]
  /** LUM-1148 — the pre-merge checks (custom checks: web or .lumo.yaml). */
  titleCheck?: string
  titleRequirements?: string
  descriptionCheck?: string
  overrideReviewersOnly?: string
  /** LUM-1149 — the linked task / issue assessment. */
  issueAssessment?: string
  taskDetailsOnPublicRepos?: string
  /** LUM-1147 review style. */
  profile?: string
  /** "" clears. */
  tone?: string
  /** Repeatable `glob=instructions`; replaces the list, "" clears. */
  pathInstruction?: string[]
  /** LUM-1151: description | comment | off. */
  summary?: string
  /** LUM-1155: on | off — the call-flow diagram in the walkthrough. */
  sequenceDiagrams?: string
  json?: boolean
  /** The switch flags of the same command — not combinable with --repo. */
  scan?: string
  aiReview?: string
  hunt?: string
  requestChanges?: string
  allowAuthorApproval?: string
  learningsScope?: string
  disableAll?: boolean
  enableAll?: boolean
}

export interface RepoReviewSettingView {
  repo: string
  autoReview: boolean
  reviewDrafts: boolean
  /** LUM-1143 filters (absent from an older server). */
  baseBranches?: string[]
  labels?: string[]
  ignoreTitleKeywords?: string[]
  ignoreUsernames?: string[]
  descriptionKeyword?: string | null
  pathFilters?: string[]
  /** LUM-1147 review style (absent from an older server). */
  pathInstructions?: PathInstruction[]
  reviewProfile?: ReviewProfile
  toneInstructions?: string | null
  /** LUM-1151 (absent from an older server). */
  highLevelSummary?: HighLevelSummaryMode
  /** LUM-1155 (absent from an older server). */
  sequenceDiagrams?: boolean
  /** What an empty `baseBranches` reviews. */
  emptyBaseBranchesMeans?: 'all_branches' | 'default_branch_only'
  /** LUM-1148 (absent from an older server). */
  preMergeChecks?: PreMergeChecksView
}

export type CheckMode = 'off' | 'warning' | 'error'
const CHECK_MODES: readonly CheckMode[] = ['off', 'warning', 'error']

/** LUM-1148 — a repository's pre-merge checks, as the server returns them. */
export interface PreMergeChecksView {
  title: { mode: CheckMode; requirements: string | null }
  description: { mode: CheckMode }
  /** LUM-1149 (absent from an older server). */
  issueAssessment?: { mode: CheckMode; taskDetailsOnPublicRepos: boolean }
  customChecks: Array<{ name: string; mode: CheckMode; instructions: string }>
  overrideRequestedReviewersOnly: boolean
}

export interface PreMergeChecksChange {
  title?: { mode?: CheckMode; requirements?: string | null }
  description?: { mode?: CheckMode }
  issueAssessment?: { mode?: CheckMode; taskDetailsOnPublicRepos?: boolean }
  overrideRequestedReviewersOnly?: boolean
}

/** GET/PATCH /api/workspaces/me/security-scan/repositories. */
export interface RepoReviewSettingsView {
  repositories: RepoReviewSettingView[]
  canEdit: boolean
}

export interface RepoReviewUpdate {
  repo: string
  autoReview?: boolean
  reviewDrafts?: boolean
  baseBranches?: string[]
  labels?: string[]
  ignoreTitleKeywords?: string[]
  ignoreUsernames?: string[]
  descriptionKeyword?: string | null
  pathFilters?: string[]
  preMergeChecks?: PreMergeChecksChange
  pathInstructions?: PathInstruction[]
  reviewProfile?: ReviewProfile
  toneInstructions?: string | null
  highLevelSummary?: HighLevelSummaryMode
  sequenceDiagrams?: boolean
}

/** LUM-1151: where the high-level PR summary goes (mirrors the server). */
export const HIGH_LEVEL_SUMMARY_MODES = [
  'description',
  'comment',
  'off',
] as const
export type HighLevelSummaryMode = (typeof HIGH_LEVEL_SUMMARY_MODES)[number]

const SUMMARY_HELP: Record<HighLevelSummaryMode, string> = {
  description:
    'written into the PR description and kept in sync on every review',
  comment: "in Lumo's summary comment only",
  off: 'not written',
}

export const REVIEW_PROFILES = ['quiet', 'chill', 'assertive'] as const
export type ReviewProfile = (typeof REVIEW_PROFILES)[number]

export interface PathInstruction {
  path: string
  instructions: string
}

/** LUM-1147: what each profile comments inline (mirrors the server). */
const PROFILE_HELP: Record<ReviewProfile, string> = {
  quiet:
    'only HIGH and Done-blocking findings inline; MEDIUM and path-instruction findings listed in the summary',
  chill:
    'HIGH, MEDIUM and path-instruction findings inline; other LOW one summary line',
  assertive: 'every finding on a changed line inline, LOW too',
}

/**
 * LUM-1147: repeated `glob=instructions` values; a lone "" (or only
 * blanks) clears the list. The glob is everything before the first `=`.
 */
export function parsePathInstructions(
  values: readonly string[]
): PathInstruction[] {
  const out: PathInstruction[] = []
  for (const raw of values) {
    if (raw.trim().length === 0) continue
    const at = raw.indexOf('=')
    const path = at > 0 ? raw.slice(0, at).trim() : ''
    const instructions = at > 0 ? raw.slice(at + 1).trim() : ''
    if (!path || !instructions)
      throw new Error(
        `--path-instruction takes glob=instructions (got "${raw}")`
      )
    out.push({ path, instructions })
  }
  return out
}

/** LUM-1143: the filter flags and the request field each one sets. */
const LIST_FLAGS = [
  ['baseBranches', '--base-branches', 'baseBranches'],
  ['labels', '--labels', 'labels'],
  ['ignoreTitle', '--ignore-title', 'ignoreTitleKeywords'],
  ['ignoreUsers', '--ignore-users', 'ignoreUsernames'],
  ['pathFilter', '--path-filter', 'pathFilters'],
] as const

/** Repeated values, trimmed; a lone "" (or only blanks) clears the list. */
export function parseFilterList(values: readonly string[]): string[] {
  return values.map(v => v.trim()).filter(v => v.length > 0)
}

function hasFilterFlag(opts: RepoReviewOptions): boolean {
  return (
    LIST_FLAGS.some(([key]) => opts[key] !== undefined) ||
    opts.descriptionKeyword !== undefined ||
    hasChecksFlag(opts) ||
    // LUM-1147: the review style flags change the repository too.
    opts.profile !== undefined ||
    opts.tone !== undefined ||
    opts.pathInstruction !== undefined ||
    // LUM-1151
    opts.summary !== undefined ||
    // LUM-1155
    opts.sequenceDiagrams !== undefined
  )
}

/** LUM-1148: any pre-merge check flag. */
function hasChecksFlag(opts: RepoReviewOptions): boolean {
  return (
    opts.titleCheck !== undefined ||
    opts.titleRequirements !== undefined ||
    opts.descriptionCheck !== undefined ||
    opts.overrideReviewersOnly !== undefined ||
    opts.issueAssessment !== undefined ||
    opts.taskDetailsOnPublicRepos !== undefined
  )
}

function parseCheckMode(flag: string, value: string): CheckMode {
  const v = value.trim().toLowerCase() as CheckMode
  if (CHECK_MODES.includes(v)) return v
  throw new Error(`${flag} takes off, warning or error (got "${value}")`)
}

/** LUM-1148 — the pre-merge check flags as a partial change (null = none). */
export function buildPreMergeChecksChange(
  opts: RepoReviewOptions
): PreMergeChecksChange | null {
  if (!hasChecksFlag(opts)) return null
  const change: PreMergeChecksChange = {}
  if (opts.titleCheck !== undefined || opts.titleRequirements !== undefined) {
    change.title = {}
    if (opts.titleCheck !== undefined)
      change.title.mode = parseCheckMode('--title-check', opts.titleCheck)
    if (opts.titleRequirements !== undefined) {
      const r = opts.titleRequirements.trim()
      if (r.length > 1000)
        throw new Error('--title-requirements takes at most 1000 characters')
      change.title.requirements = r.length > 0 ? r : null
    }
  }
  if (opts.descriptionCheck !== undefined)
    change.description = {
      mode: parseCheckMode('--description-check', opts.descriptionCheck),
    }
  if (
    opts.issueAssessment !== undefined ||
    opts.taskDetailsOnPublicRepos !== undefined
  ) {
    change.issueAssessment = {}
    if (opts.issueAssessment !== undefined)
      change.issueAssessment.mode = parseCheckMode(
        '--issue-assessment',
        opts.issueAssessment
      )
    if (opts.taskDetailsOnPublicRepos !== undefined)
      change.issueAssessment.taskDetailsOnPublicRepos = parseOnOff(
        '--task-details-on-public-repos',
        opts.taskDetailsOnPublicRepos
      )
  }
  if (opts.overrideReviewersOnly !== undefined)
    change.overrideRequestedReviewersOnly = parseOnOff(
      '--override-reviewers-only',
      opts.overrideReviewersOnly
    )
  return change
}

function parseOnOff(flag: string, value: string): boolean {
  const v = value.trim().toLowerCase()
  if (v === 'on' || v === 'true') return true
  if (v === 'off' || v === 'false') return false
  throw new Error(`${flag} takes on or off (got "${value}")`)
}

/** Whether the options ask for the repository mode at all. */
export function wantsRepoReview(opts: RepoReviewOptions): boolean {
  return (
    opts.repos === true ||
    opts.repo !== undefined ||
    opts.review !== undefined ||
    opts.drafts !== undefined ||
    hasFilterFlag(opts)
  )
}

/**
 * The PATCH body, or null for a read (`--repo X` alone, `--repos`). Throws
 * on a malformed or conflicting combination.
 */
export function buildRepoReviewUpdate(
  opts: RepoReviewOptions
): RepoReviewUpdate | null {
  const switches =
    opts.scan !== undefined ||
    opts.aiReview !== undefined ||
    opts.hunt !== undefined ||
    opts.requestChanges !== undefined ||
    opts.allowAuthorApproval !== undefined ||
    opts.learningsScope !== undefined ||
    opts.disableAll ||
    opts.enableAll
  if (switches) {
    throw new Error(
      '--repo / --repos / --review / --drafts / the filter flags cannot be combined with --scan / --ai-review / --hunt / --request-changes / --allow-author-approval / --learnings-scope / --disable-all / --enable-all'
    )
  }
  const change =
    opts.review !== undefined ||
    opts.drafts !== undefined ||
    hasFilterFlag(opts)
  if (change && !opts.repo) {
    throw new Error(
      '--review / --drafts / --base-branches / --labels / --ignore-title / --ignore-users / --description-keyword / --path-filter / --title-check / --title-requirements / --description-check / --override-reviewers-only / --issue-assessment / --task-details-on-public-repos / --profile / --tone / --path-instruction / --summary / --sequence-diagrams need --repo <owner/name>'
    )
  }
  if (!change) return null
  const update: RepoReviewUpdate = { repo: opts.repo!.trim() }
  if (opts.review !== undefined)
    update.autoReview = parseOnOff('--review', opts.review)
  if (opts.drafts !== undefined)
    update.reviewDrafts = parseOnOff('--drafts', opts.drafts)
  for (const [key, , field] of LIST_FLAGS) {
    const values = opts[key]
    if (values !== undefined) update[field] = parseFilterList(values)
  }
  if (opts.descriptionKeyword !== undefined) {
    const k = opts.descriptionKeyword.trim()
    update.descriptionKeyword = k.length > 0 ? k : null
  }
  const checks = buildPreMergeChecksChange(opts)
  if (checks) update.preMergeChecks = checks
  if (opts.profile !== undefined) {
    const p = opts.profile.trim().toLowerCase()
    if (!(REVIEW_PROFILES as readonly string[]).includes(p))
      throw new Error(
        `--profile takes ${REVIEW_PROFILES.join(', ')} (got "${opts.profile}")`
      )
    update.reviewProfile = p as ReviewProfile
  }
  if (opts.tone !== undefined) {
    const t = opts.tone.trim()
    update.toneInstructions = t.length > 0 ? t : null
  }
  if (opts.pathInstruction !== undefined)
    update.pathInstructions = parsePathInstructions(opts.pathInstruction)
  if (opts.summary !== undefined) {
    const m = opts.summary.trim().toLowerCase()
    if (!(HIGH_LEVEL_SUMMARY_MODES as readonly string[]).includes(m))
      throw new Error(
        `--summary takes ${HIGH_LEVEL_SUMMARY_MODES.join(', ')} (got "${opts.summary}")`
      )
    update.highLevelSummary = m as HighLevelSummaryMode
  }
  if (opts.sequenceDiagrams !== undefined)
    update.sequenceDiagrams = parseOnOff(
      '--sequence-diagrams',
      opts.sequenceDiagrams
    )
  return update
}

function findRepo(view: RepoReviewSettingsView, repo: string) {
  const target = repo.trim().toLowerCase()
  return view.repositories.find(r => r.repo.toLowerCase() === target)
}

/** Confirmation `changes` for what the update turns OFF; empty otherwise. */
export function describeRepoReviewTurnOffs(
  view: RepoReviewSettingsView,
  update: RepoReviewUpdate
): string[] {
  const current = findRepo(view, update.repo)
  if (!current) return []
  const lines: string[] = []
  if (update.autoReview === false && current.autoReview) {
    lines.push(
      `Will turn OFF automatic review for ${current.repo}: pull requests without a Lumo task are no longer reviewed (task-linked pull requests are still scanned)`
    )
  }
  if (update.reviewDrafts === false && current.reviewDrafts) {
    lines.push(
      `Will turn OFF draft review for ${current.repo}: drafts wait until they are marked ready`
    )
  }
  // LUM-1148: switching a pre-merge check off, or opening its override up.
  const checks = update.preMergeChecks
  const now = current.preMergeChecks
  if (checks && now) {
    if (checks.title?.mode === 'off' && now.title.mode !== 'off')
      lines.push(`Will turn OFF the pre-merge title check for ${current.repo}`)
    if (checks.description?.mode === 'off' && now.description.mode !== 'off')
      lines.push(
        `Will turn OFF the pre-merge description check for ${current.repo}`
      )
    // LUM-1149: the assessment off, or a private task quoted in public.
    if (
      checks.issueAssessment?.mode === 'off' &&
      now.issueAssessment?.mode !== 'off'
    )
      lines.push(
        `Will turn OFF the pre-merge linked task / issue assessment for ${current.repo}`
      )
    if (
      checks.issueAssessment?.taskDetailsOnPublicRepos === true &&
      now.issueAssessment?.taskDetailsOnPublicRepos !== true
    )
      lines.push(
        `Will quote the linked Lumo task's requirements (and Lumo's assessment of them) on pull requests of ${current.repo} even while it is a PUBLIC repository`
      )
    if (
      checks.overrideRequestedReviewersOnly === false &&
      now.overrideRequestedReviewersOnly
    )
      lines.push(
        `Will let anyone with write access (the PR author included, unless author approval is off) override the pre-merge checks of ${current.repo}, not only its reviewers (requested, or who already reviewed the PR)`
      )
  }
  return lines
}

/** LUM-1148: the pre-merge checks of a repository, one line each. */
export function formatPreMergeChecks(r: RepoReviewSettingView): string[] {
  const c = r.preMergeChecks
  if (!c) return []
  const lines = [
    `  pre-merge checks: title ${c.title.mode} · description ${c.description.mode}${
      c.issueAssessment
        ? ` · issue assessment ${c.issueAssessment.mode}${
            c.issueAssessment.taskDetailsOnPublicRepos
              ? ' (task details shown on public repos)'
              : ''
          }`
        : ''
    }`,
  ]
  if (c.title.requirements)
    lines.push(`  title requirements: ${sanitizeField(c.title.requirements)}`)
  for (const k of c.customChecks)
    lines.push(`  custom check: ${sanitizeField(k.name)} (${k.mode})`)
  lines.push(
    `  override: ${
      c.overrideRequestedReviewersOnly
        ? 'reviewers only — requested, or already reviewed (never the author)'
        : 'anyone with write access'
    } — \`@uselumo ignore pre-merge checks\` on the PR`
  )
  return lines
}

const onOff = (b: boolean) => (b ? 'on' : 'off')

/** LUM-1143: one line per non-default filter of a repository. */
export function formatRepoReviewFilters(r: RepoReviewSettingView): string[] {
  const list = (xs: string[] | undefined) =>
    (xs ?? []).map(x => sanitizeField(x)).join(', ')
  const lines: string[] = []
  const base = list(r.baseBranches)
  lines.push(
    `  base branches: ${
      base
        ? `default branch + ${base}`
        : r.emptyBaseBranchesMeans === 'default_branch_only'
          ? 'default branch only'
          : 'all'
    }`
  )
  if (list(r.labels)) lines.push(`  labels: ${list(r.labels)}`)
  if (list(r.ignoreTitleKeywords))
    lines.push(`  ignore title: ${list(r.ignoreTitleKeywords)}`)
  if (list(r.ignoreUsernames))
    lines.push(`  ignore users: ${list(r.ignoreUsernames)}`)
  if (r.descriptionKeyword)
    lines.push(`  description keyword: ${sanitizeField(r.descriptionKeyword)}`)
  if (list(r.pathFilters)) lines.push(`  path filters: ${list(r.pathFilters)}`)
  // LUM-1147: the review style (absent from an older server).
  if (r.reviewProfile)
    lines.push(
      `  review profile: ${r.reviewProfile} (${PROFILE_HELP[r.reviewProfile] ?? ''})`
    )
  if (r.toneInstructions)
    lines.push(`  tone: ${sanitizeField(r.toneInstructions)}`)
  // LUM-1151 (absent from an older server).
  if (r.highLevelSummary)
    lines.push(
      `  high-level summary: ${r.highLevelSummary} (${SUMMARY_HELP[r.highLevelSummary] ?? ''})`
    )
  // LUM-1155 (absent from an older server).
  if (r.sequenceDiagrams !== undefined)
    lines.push(
      `  sequence diagrams: ${onOff(r.sequenceDiagrams)} (call-flow diagram in the summary comment's walkthrough)`
    )
  for (const p of r.pathInstructions ?? [])
    lines.push(
      `  path instruction: ${sanitizeField(p.path)} = ${sanitizeField(p.instructions).replace(/\s+/g, ' ')}`
    )
  return lines
}

export function formatRepoReviewSettings(
  view: RepoReviewSettingsView,
  filters?: boolean
): string {
  if (view.repositories.length === 0) {
    return 'No repositories are connected to this workspace.'
  }
  const names = view.repositories.map(r => sanitizeField(r.repo))
  const w = Math.max('Repository'.length, ...names.map(n => n.length))
  const withFilters = filters === true
  return [
    `${'Repository'.padEnd(w)}  Review  Drafts`,
    ...view.repositories.flatMap((r, i) => [
      `${names[i]!.padEnd(w)}  ${onOff(r.autoReview).padEnd(6)}  ${onOff(r.autoReview && r.reviewDrafts)}`,
      ...(withFilters
        ? [...formatRepoReviewFilters(r), ...formatPreMergeChecks(r)]
        : []),
    ]),
    '',
    'Review: every pull request without a Lumo task is reviewed automatically (off = only PRs opted in by a label or the description keyword). Task-linked pull requests are always scanned.',
  ].join('\n')
}

const PATH = '/api/workspaces/me/security-scan/repositories'
const NO_PLUGIN = missingPluginMessage('workspace security-scan', 'security')

export async function workspaceRepoReview(
  opts: RepoReviewOptions
): Promise<number | void> {
  let update: RepoReviewUpdate | null
  try {
    update = buildRepoReviewUpdate(opts)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const ctx = apiContext()
  if (!ctx) return 1
  const current = await apiCall<RepoReviewSettingsView>(
    ctx,
    PATH,
    {},
    'repository review settings',
    NO_PLUGIN
  )
  if (!current.ok || !current.data) return 1

  let result = current.data
  if (opts.repo && !findRepo(current.data, opts.repo)) {
    console.error(
      `Error: repository ${sanitizeField(opts.repo)} is not connected to this workspace (see --repos).`
    )
    return 1
  }
  if (update) {
    if (!current.data.canEdit) {
      console.error(
        'Error: only workspace owners can change repository review settings (reading is open to every member).'
      )
      return 1
    }
    const changes = describeRepoReviewTurnOffs(current.data, update)
    if (changes.length > 0 && !isConfirmed(opts)) {
      return emitConfirmation({ command: 'workspace security-scan', changes })
    }
    const r = await apiCall<RepoReviewSettingsView>(
      ctx,
      PATH,
      { method: 'PATCH', json: update },
      'repository review update',
      NO_PLUGIN
    )
    if (!r.ok || !r.data) return 1
    result = r.data
  }

  // `--repo X` shows only that repository.
  const shown: RepoReviewSettingsView = opts.repo
    ? {
        ...result,
        repositories: result.repositories.filter(
          r => r.repo.toLowerCase() === opts.repo!.trim().toLowerCase()
        ),
      }
    : result
  if (opts.json) {
    process.stdout.write(JSON.stringify(shown, null, 2) + '\n')
    return
  }
  if (update) process.stdout.write('Repository review settings saved.\n\n')
  // `--repo X` shows that repository's filters too.
  process.stdout.write(
    formatRepoReviewSettings(shown, opts.repo !== undefined) + '\n'
  )
}
