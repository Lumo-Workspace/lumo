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
  json?: boolean
  /** The switch flags of the same command — not combinable with --repo. */
  scan?: string
  aiReview?: string
  hunt?: string
  requestChanges?: string
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
  /** What an empty `baseBranches` reviews. */
  emptyBaseBranchesMeans?: 'all_branches' | 'default_branch_only'
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
    opts.descriptionKeyword !== undefined
  )
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
    opts.learningsScope !== undefined ||
    opts.disableAll ||
    opts.enableAll
  if (switches) {
    throw new Error(
      '--repo / --repos / --review / --drafts / the filter flags cannot be combined with --scan / --ai-review / --hunt / --request-changes / --learnings-scope / --disable-all / --enable-all'
    )
  }
  const change =
    opts.review !== undefined ||
    opts.drafts !== undefined ||
    hasFilterFlag(opts)
  if (change && !opts.repo) {
    throw new Error(
      '--review / --drafts / --base-branches / --labels / --ignore-title / --ignore-users / --description-keyword / --path-filter need --repo <owner/name>'
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
      ...(withFilters ? formatRepoReviewFilters(r) : []),
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
