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
  json?: boolean
  /** The switch flags of the same command — not combinable with --repo. */
  scan?: string
  aiReview?: string
  hunt?: string
  disableAll?: boolean
  enableAll?: boolean
}

export interface RepoReviewSettingView {
  repo: string
  autoReview: boolean
  reviewDrafts: boolean
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
    opts.drafts !== undefined
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
    opts.disableAll ||
    opts.enableAll
  if (switches) {
    throw new Error(
      '--repo / --repos / --review / --drafts cannot be combined with --scan / --ai-review / --hunt / --disable-all / --enable-all'
    )
  }
  const change = opts.review !== undefined || opts.drafts !== undefined
  if (change && !opts.repo) {
    throw new Error('--review / --drafts need --repo <owner/name>')
  }
  if (!change) return null
  const update: RepoReviewUpdate = { repo: opts.repo!.trim() }
  if (opts.review !== undefined)
    update.autoReview = parseOnOff('--review', opts.review)
  if (opts.drafts !== undefined)
    update.reviewDrafts = parseOnOff('--drafts', opts.drafts)
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

export function formatRepoReviewSettings(view: RepoReviewSettingsView): string {
  if (view.repositories.length === 0) {
    return 'No repositories are connected to this workspace.'
  }
  const names = view.repositories.map(r => sanitizeField(r.repo))
  const w = Math.max('Repository'.length, ...names.map(n => n.length))
  return [
    `${'Repository'.padEnd(w)}  Review  Drafts`,
    ...view.repositories.map(
      (r, i) =>
        `${names[i]!.padEnd(w)}  ${onOff(r.autoReview).padEnd(6)}  ${onOff(r.autoReview && r.reviewDrafts)}`
    ),
    '',
    'Review: every pull request without a Lumo task is reviewed automatically. Task-linked pull requests are always scanned.',
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
  process.stdout.write(formatRepoReviewSettings(shown) + '\n')
}
