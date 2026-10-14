import { apiCall, apiContext } from '../lib/test-case-api'
import { missingPluginMessage } from '../lib/plugin-route'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'

export interface WorkspaceSecurityScanOptions extends ConfirmFlags {
  scan?: string
  aiReview?: string
  hunt?: string
  /** LUM-1130 — the request-changes / approve workflow. */
  requestChanges?: string
  disableAll?: boolean
  enableAll?: boolean
  json?: boolean
}

/** The stored switches, as GET/PATCH /api/workspaces/me/security-scan return them. */
export interface SecurityScanSwitches {
  securityScanEnabled: boolean
  securityAiReviewEnabled: boolean
  securityHuntEnabled: boolean
  /** LUM-1130 — absent on a server older than the workflow (reads as off). */
  securityRequestChangesEnabled?: boolean
}

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

const SWITCH_LABELS: Record<keyof SecurityScanSwitches, string> = {
  securityScanEnabled: 'Security scan (master)',
  securityAiReviewEnabled: 'AI review',
  securityHuntEnabled: 'Exploit-path hunt',
  securityRequestChangesEnabled: 'Request-changes workflow',
}

function parseOnOff(flag: string, value: string): boolean {
  const v = value.trim().toLowerCase()
  if (v === 'on' || v === 'true') return true
  if (v === 'off' || v === 'false') return false
  throw new Error(`${flag} takes on or off (got "${value}")`)
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

  if (opts.disableAll && opts.enableAll) {
    throw new Error('use either --disable-all or --enable-all, not both')
  }
  const all = opts.disableAll ? false : opts.enableAll ? true : undefined
  if (all !== undefined) {
    if (Object.keys(singles).length > 0) {
      throw new Error(
        '--disable-all / --enable-all cannot be combined with --scan / --ai-review / --hunt / --request-changes'
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
  const keys = Object.keys(SWITCH_LABELS) as (keyof SecurityScanSwitches)[]
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
