import { apiCall, apiContext } from '../lib/test-case-api'
import { missingPluginMessage } from '../lib/plugin-route'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'
import { wantsRepoReview, workspaceRepoReview } from './workspace-repo-review'

export interface WorkspaceSecurityScanOptions extends ConfirmFlags {
  scan?: string
  aiReview?: string
  hunt?: string
  /** LUM-1130 — the request-changes / approve workflow. */
  requestChanges?: string
  /** LUM-1142 — the PR's author may resolve / approve by command. */
  allowAuthorApproval?: string
  /** LUM-1134 — local | global | auto (which repositories' learnings). */
  learningsScope?: string
  /** LUM-1137 — pause automatic review after N reviewed commits (0 = never). */
  autoPauseAfter?: string
  disableAll?: boolean
  enableAll?: boolean
  json?: boolean
  /** LUM-1133: per-repository automatic review (workspace-repo-review.ts). */
  repo?: string
  repos?: boolean
  review?: string
  drafts?: string
  /** LUM-1143: the per-repository auto-review filters. */
  baseBranches?: string[]
  labels?: string[]
  ignoreTitle?: string[]
  ignoreUsers?: string[]
  descriptionKeyword?: string
  pathFilter?: string[]
}

/** The stored switches, as GET/PATCH /api/workspaces/me/security-scan return them. */
export interface SecurityScanSwitches {
  securityScanEnabled: boolean
  securityAiReviewEnabled: boolean
  securityHuntEnabled: boolean
  /** LUM-1130 — absent on a server older than the workflow (reads as off). */
  securityRequestChangesEnabled?: boolean
  /** LUM-1142 — absent on a server older than the setting (reads as on). */
  securityAllowAuthorApproval?: boolean
  /** LUM-1134 — absent on a server older than the setting (reads as auto). */
  securityLearningsScope?: LearningsScope
  /** LUM-1137 — absent on a server older than the setting (reads as 5). */
  securityReviewAutoPauseAfter?: number
}

/** LUM-1134 — CodeRabbit's `knowledge_base.learnings.scope` values. */
export type LearningsScope = 'local' | 'global' | 'auto'
const LEARNINGS_SCOPES: readonly LearningsScope[] = ['local', 'global', 'auto']

/** The on/off switches (everything but the learnings scope and pause-after). */
type OnOffSwitch = Exclude<
  keyof SecurityScanSwitches,
  'securityLearningsScope' | 'securityReviewAutoPauseAfter'
>

export interface SecurityScanSettingsView {
  switches: SecurityScanSwitches
  platform: { managedScan: boolean; hunt: boolean }
  effective: {
    scan: boolean
    managedScan: boolean
    aiReview: boolean
    hunt: boolean
  }
  /** OWNER may change the switches; absent on a server older than this flag. */
  canEdit?: boolean
}

export type SecurityScanUpdate =
  | { all: boolean }
  | Partial<SecurityScanSwitches>

const SWITCH_LABELS: Record<OnOffSwitch, string> = {
  securityScanEnabled: 'Security scan (master)',
  securityAiReviewEnabled: 'AI review',
  securityHuntEnabled: 'Exploit-path hunt',
  securityRequestChangesEnabled: 'Request-changes workflow',
  securityAllowAuthorApproval: 'PR authors may resolve / approve by command',
}

function parseOnOff(flag: string, value: string): boolean {
  const v = value.trim().toLowerCase()
  if (v === 'on' || v === 'true') return true
  if (v === 'off' || v === 'false') return false
  throw new Error(`${flag} takes on or off (got "${value}")`)
}

function parseLearningsScope(value: string): LearningsScope {
  const v = value.trim().toLowerCase()
  const scope = LEARNINGS_SCOPES.find(s => s === v)
  if (!scope)
    throw new Error(
      `--learnings-scope takes local, global or auto (got "${value}")`
    )
  return scope
}

/** LUM-1137 — a whole number of reviewed commits, 0–100 (0 = never pause). */
function parseAutoPauseAfter(value: string): number {
  const v = value.trim()
  const n = /^\d+$/.test(v) ? Number(v) : NaN
  if (!Number.isInteger(n) || n < 0 || n > 100)
    throw new Error(
      `--auto-pause-after takes a whole number from 0 to 100 (0 = never pause; got "${value}")`
    )
  return n
}

/**
 * The PATCH body the flags ask for, or null when no change was asked for
 * (a plain read). Throws on a conflicting or malformed combination.
 */
export function buildSecurityScanUpdate(
  opts: WorkspaceSecurityScanOptions
): SecurityScanUpdate | null {
  const singles: Partial<SecurityScanSwitches> = {}
  if (opts.scan !== undefined)
    singles.securityScanEnabled = parseOnOff('--scan', opts.scan)
  if (opts.aiReview !== undefined)
    singles.securityAiReviewEnabled = parseOnOff('--ai-review', opts.aiReview)
  if (opts.hunt !== undefined)
    singles.securityHuntEnabled = parseOnOff('--hunt', opts.hunt)
  if (opts.requestChanges !== undefined)
    singles.securityRequestChangesEnabled = parseOnOff(
      '--request-changes',
      opts.requestChanges
    )
  if (opts.allowAuthorApproval !== undefined)
    singles.securityAllowAuthorApproval = parseOnOff(
      '--allow-author-approval',
      opts.allowAuthorApproval
    )
  if (opts.learningsScope !== undefined)
    singles.securityLearningsScope = parseLearningsScope(opts.learningsScope)
  if (opts.autoPauseAfter !== undefined)
    singles.securityReviewAutoPauseAfter = parseAutoPauseAfter(
      opts.autoPauseAfter
    )

  if (opts.disableAll && opts.enableAll) {
    throw new Error('use either --disable-all or --enable-all, not both')
  }
  const all = opts.disableAll ? false : opts.enableAll ? true : undefined
  if (all !== undefined) {
    if (Object.keys(singles).length > 0) {
      throw new Error(
        '--disable-all / --enable-all cannot be combined with --scan / --ai-review / --hunt / --request-changes / --allow-author-approval / --learnings-scope / --auto-pause-after'
      )
    }
    return { all }
  }
  return Object.keys(singles).length > 0 ? singles : null
}

/** The switches the update would set, as a full switch map. */
function targetSwitches(
  update: SecurityScanUpdate
): Partial<SecurityScanSwitches> {
  if ('all' in update && update.all !== undefined) {
    return {
      securityScanEnabled: update.all,
      securityAiReviewEnabled: update.all,
      securityHuntEnabled: update.all,
    }
  }
  return update as Partial<SecurityScanSwitches>
}

/**
 * The confirmation `changes` for every switch the update turns OFF that is
 * on now — empty when the update only turns things on (or changes nothing),
 * which needs no confirmation.
 */
export function describeTurnOffs(
  current: SecurityScanSwitches,
  update: SecurityScanUpdate
): string[] {
  const target = targetSwitches(update)
  const keys = Object.keys(SWITCH_LABELS) as OnOffSwitch[]
  const off = keys.filter(k => target[k] === false && current[k] === true)
  if (off.length === 0) return []
  const lines = off.map(k => `Will turn OFF: ${SWITCH_LABELS[k]}`)
  if (target.securityScanEnabled === false && current.securityScanEnabled) {
    lines.push(
      'With the master switch off, new pushes to this workspace’s PRs are not scanned and no scan comment is posted'
    )
  }
  lines.push(
    'Workspace-wide (every member’s PRs); blocking findings from earlier scans still block Done'
  )
  return lines
}

/**
 * LUM-1130 — every change that needs the user's confirmation: the turn-offs
 * above, plus turning the request-changes workflow ON (it changes how Lumo's
 * review reads on every PR in the workspace — "Changes requested" / an
 * approval — which branch protection may count).
 */
export function describeGatedChanges(
  current: SecurityScanSwitches,
  update: SecurityScanUpdate
): string[] {
  const lines = describeTurnOffs(current, update)
  const target = targetSwitches(update)
  if (
    target.securityRequestChangesEnabled === true &&
    current.securityRequestChangesEnabled !== true
  ) {
    lines.push(
      'Will turn ON: Request-changes workflow — Lumo’s PR review becomes “Changes requested” while a Lumo thread or a finding that blocks Done is open, and Lumo approves once its complete review of the latest commit leaves nothing open',
      'Workspace-wide (every member’s PRs); branch protection that requires approvals or blocks on requested changes may count Lumo’s review'
    )
  }
  // LUM-1140: turning it off withdraws Lumo's standing change requests.
  if (
    target.securityRequestChangesEnabled === false &&
    current.securityRequestChangesEnabled === true
  ) {
    lines.push(
      'Lumo dismisses its standing “Changes requested” reviews on this workspace’s open PRs (in the background; a PR it misses is dismissed at its next review) and posts comment-only reviews from then on — it does not approve, and reviews by people are untouched'
    )
  }
  // LUM-1142: turning author approval ON widens who may resolve Lumo's
  // threads and approve by command — the PR's own author (turning it off is
  // gated like every turn-off above).
  if (
    target.securityAllowAuthorApproval === true &&
    current.securityAllowAuthorApproval !== true
  ) {
    lines.push(
      'Will turn ON: PR authors may resolve / approve by command — the PR’s author (with write access) can run `@uselumo resolve` and `@uselumo approve` on their own PR; approve still needs the request-changes workflow on and no finding that blocks Done',
      'Workspace-wide (every member’s PRs); branch protection that requires approvals may count Lumo’s approval'
    )
  }
  // LUM-1134: `global` lets a PUBLIC repository's review read learnings from
  // the workspace's private repositories — confirmed like any widening.
  const scopeNow = current.securityLearningsScope ?? 'auto'
  if (target.securityLearningsScope === 'global' && scopeNow !== 'global') {
    lines.push(
      `Will change: Learnings scope ${scopeNow} → global — the AI review of every repository in this workspace reads the learnings of all its repositories`,
      'Including public repositories: their reviews (posted publicly on GitHub) may draw on learnings from your private repositories'
    )
  }
  return lines
}

const onOff = (b: boolean) => (b ? 'on' : 'off')

/** Human rendering: stored switch, platform ceiling, what actually runs. */
export function formatSecurityScanSettings(
  s: SecurityScanSettingsView
): string {
  const rows: [string, boolean, boolean | null, boolean][] = [
    [
      'Security scan (master)',
      s.switches.securityScanEnabled,
      null,
      s.effective.scan,
    ],
    [
      'Managed scanners (L1/L2)',
      s.switches.securityScanEnabled,
      s.platform.managedScan,
      s.effective.managedScan,
    ],
    [
      'AI review',
      s.switches.securityAiReviewEnabled,
      null,
      s.effective.aiReview,
    ],
    [
      'Exploit-path hunt',
      s.switches.securityHuntEnabled,
      s.platform.hunt,
      s.effective.hunt,
    ],
  ]
  const w = Math.max(...rows.map(r => r[0].length))
  const lines = [
    `${'Layer'.padEnd(w)}  Setting  Platform  Runs`,
    ...rows.map(
      ([label, setting, platform, runs]) =>
        `${label.padEnd(w)}  ${onOff(setting).padEnd(7)}  ${(platform === null ? '-' : onOff(platform)).padEnd(8)}  ${runs ? 'yes' : 'no'}`
    ),
  ]
  if (s.switches.securityRequestChangesEnabled !== undefined) {
    lines.push(
      '',
      `Request-changes workflow: ${onOff(s.switches.securityRequestChangesEnabled)}`
    )
  }
  if (s.switches.securityAllowAuthorApproval !== undefined) {
    lines.push(
      `PR authors may resolve / approve by command: ${onOff(s.switches.securityAllowAuthorApproval)}`
    )
  }
  if (s.switches.securityLearningsScope !== undefined) {
    lines.push(`Learnings scope: ${s.switches.securityLearningsScope}`)
  }
  // LUM-1137: every push is reviewed until N reviewed commits.
  const pauseAfter = s.switches.securityReviewAutoPauseAfter
  if (pauseAfter !== undefined) {
    lines.push(
      `Automatic review: every push · ${pauseAfter === 0 ? 'never pauses' : `pauses after ${pauseAfter} reviewed commits`}`
    )
  }
  if (!s.switches.securityScanEnabled) {
    lines.push('', 'Security scanning is off for this workspace.')
  }
  return lines.join('\n')
}

const PATH = '/api/workspaces/me/security-scan'
/** LUM-1062: what a server without the security plugin answers. */
const NO_PLUGIN = missingPluginMessage('workspace security-scan', 'security')

/**
 * `lumo workspace security-scan` (LUM-1002) — show the PR security-scan
 * switches, or change them (OWNER only). Turning anything off is gated by
 * the confirmation protocol: without `--confirm` it exits 4 with an envelope.
 */
export async function workspaceSecurityScan(
  opts: WorkspaceSecurityScanOptions = {}
): Promise<number | void> {
  // LUM-1133: --repos / --repo … is the per-repository review mode.
  if (wantsRepoReview(opts)) return workspaceRepoReview(opts)

  let update: SecurityScanUpdate | null
  try {
    update = buildSecurityScanUpdate(opts)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const ctx = apiContext()
  if (!ctx) return 1
  const current = await apiCall<SecurityScanSettingsView>(
    ctx,
    PATH,
    {},
    'security-scan settings',
    NO_PLUGIN
  )
  if (!current.ok || !current.data) return 1

  let result = current.data
  if (update) {
    // Refuse up front: a non-OWNER would otherwise be asked to confirm a
    // change the server then rejects with 403.
    if (current.data.canEdit === false) {
      console.error(
        'Error: only workspace owners can change security-scan settings (reading is open to every member).'
      )
      return 1
    }
    const changes = describeGatedChanges(current.data.switches, update)
    if (changes.length > 0 && !isConfirmed(opts)) {
      return emitConfirmation({ command: 'workspace security-scan', changes })
    }
    const r = await apiCall<SecurityScanSettingsView>(
      ctx,
      PATH,
      { method: 'PATCH', json: update },
      'security-scan update',
      NO_PLUGIN
    )
    if (!r.ok || !r.data) return 1
    result = r.data
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }
  if (update) process.stdout.write('Security scan settings saved.\n\n')
  process.stdout.write(formatSecurityScanSettings(result) + '\n')
}
