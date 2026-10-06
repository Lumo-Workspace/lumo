/**
 * LUM-919 — argument parsing and report formatting for the subprocessor
 * change notice script (send.ts). Pure: no database, no env, no output.
 */
import type {
  NoticePlan,
  NoticeSendResult,
} from '@/lib/services/subprocessor-notice.service'

export interface NoticeArgs {
  changeId: string
  confirm: boolean
  confirmHost?: string
  /** Print the full HTML of the preview email, not just the text part. */
  html: boolean
}

export const USAGE = `Usage:
  DOTENV_CONFIG_PATH=<env file> npx tsx -r dotenv/config \\
    scripts/subprocessor-notice/send.ts --change <change id> [--html]
  DOTENV_CONFIG_PATH=<env file> npx tsx -r dotenv/config \\
    scripts/subprocessor-notice/send.ts --change <change id> --confirm --confirm-host <db host>

Without --confirm: dry run — prints the change, the owners per workspace and
the email; sends nothing. --confirm sends to every owner not yet notified and
needs --confirm-host to equal the connected database host.`

function valueOf(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  if (i < 0) return undefined
  const v = argv[i + 1]
  if (v === undefined || v.startsWith('--'))
    throw new Error(`${name} needs a value`)
  return v
}

/** Parse argv (without node/script). Throws with a message on anything unclear. */
export function parseNoticeArgs(argv: string[]): NoticeArgs {
  const known = new Set(['--change', '--confirm', '--confirm-host', '--html'])
  const valued = new Set(['--change', '--confirm-host'])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!known.has(a)) throw new Error(`Unknown argument: ${a}`)
    if (valued.has(a)) i++
  }
  const changeId = valueOf(argv, '--change')
  if (!changeId) throw new Error('--change <change id> is required')
  const confirm = argv.includes('--confirm')
  const confirmHost = valueOf(argv, '--confirm-host')
  if (confirm && !confirmHost)
    throw new Error('--confirm needs --confirm-host <db host>')
  if (!confirm && confirmHost)
    throw new Error('--confirm-host only goes with --confirm')
  return {
    changeId,
    confirm,
    html: argv.includes('--html'),
    ...(confirmHost ? { confirmHost } : {}),
  }
}

/** The dry-run report: change, refusal, per-workspace owners, the email. */
export function formatNoticePlan(
  plan: NoticePlan,
  options: { html: boolean }
): string[] {
  const c = plan.change
  const lines = [
    `Change ${c.id} (${c.kind}${c.urgent ? ', URGENT' : ''})`,
    `  ${c.summary}`,
    `  announced ${c.announcedAt} · takes effect ${c.effectiveAt}`,
    ...(c.urgent ? [`  urgent reason: ${c.urgent.reason}`] : []),
    plan.refusal
      ? `REFUSED — would not send: ${plan.refusal}`
      : 'Sendable now (notice period OK).',
    '',
    `Workspaces: ${plan.totals.workspaces} · active owners: ${plan.totals.owners} · already notified: ${plan.totals.alreadyNotified} · to notify: ${plan.totals.toNotify} · no email on record: ${plan.totals.missingEmail}`,
  ]
  for (const w of plan.workspaces) {
    const flags = [
      w.pendingDeletion ? 'deletion scheduled' : null,
      w.owners === 0 ? 'NO ACTIVE OWNER' : null,
      w.missingEmail > 0 ? `${w.missingEmail} without email` : null,
    ].filter(Boolean)
    lines.push(
      `  ${w.workspaceId}  ${JSON.stringify(w.workspaceName)}  owners=${w.owners} notified=${w.alreadyNotified} toNotify=${w.toNotify}` +
        (flags.length ? `  [${flags.join(', ')}]` : '')
    )
  }
  lines.push(
    '',
    `Subject: ${plan.preview.subject}`,
    '',
    options.html ? plan.preview.html : plan.preview.text
  )
  return lines
}

export function formatSendResult(result: NoticeSendResult): string[] {
  const lines = [
    `Change ${result.changeId}: sent ${result.sent} · already notified ${result.alreadyNotified} · failed ${result.failed.length} · workspaces notified ${result.workspacesNotified}`,
  ]
  for (const f of result.failed)
    lines.push(`  FAILED ${f.workspaceId} ${f.clerkId}: ${f.reason}`)
  if (result.failed.length > 0)
    lines.push('Failures are not recorded: rerun to retry them.')
  for (const u of result.unrecorded)
    lines.push(
      `  SENT BUT NOT RECORDED ${u.workspaceId} ${u.clerkId}: ${u.reason}`
    )
  if (result.unrecorded.length > 0)
    lines.push(
      'These owners got the email but have no delivery record: a rerun within 24 hours is deduplicated by Resend, a later one would email them again.'
    )
  return lines
}
