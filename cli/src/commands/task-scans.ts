import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { isMissingPluginRoute, missingPluginMessage } from '../lib/plugin-route'
import { printRedactionNotice } from '../lib/redaction-notice'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import { fieldLines, wrapLines, type LayoutOptions } from '../lib/report-layout'
import { colorEnabled, heading, terminalWidth } from '../lib/ui'
import { formatPrScan, type PrScanPayload } from './pr-scan'

export interface TaskScansOptions {
  /** Every pushed head's scan per PR, newest first, instead of the latest only. */
  all?: boolean | undefined
  /** Emit the versioned machine-readable payload instead of prose. */
  json?: boolean | undefined
  /** Append the per-task hunt detail under each scan (as `pr scan --full`). */
  full?: boolean | undefined
}

/**
 * Mirrors `TaskScanReadout` served by GET /api/tasks/[id]/security-scans to a
 * bearer caller (v1): each linked PR is exactly the payload `lumo pr scan`
 * renders, so this command renders it with the same printer.
 */
export interface TaskScansPayload {
  version: number
  task: { identifier: string }
  pullRequests: PrScanPayload[]
  totals: {
    pullRequests: number
    scanned: number
    open: number
    blocking: number
  }
  all: boolean
  redactedSecrets?: number
  scanningOff?: boolean
}

/** True when the body is the task read-out (not an older server's panel model). */
export function isTaskScansPayload(body: unknown): body is TaskScansPayload {
  if (body === null || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    typeof b.version === 'number' &&
    Array.isArray(b.pullRequests) &&
    b.totals !== null &&
    typeof b.totals === 'object' &&
    b.task !== null &&
    typeof b.task === 'object'
  )
}

/**
 * The task header (linked / scanned PRs, open and DONE-blocking findings on
 * each PR's latest scan), then one `lumo pr scan` block per PR, newest PR
 * first. No linked PR is said as "nothing scanned" — never a clean result.
 */
export function formatTaskScans(
  data: TaskScansPayload,
  opts: {
    full?: boolean | undefined
    width?: number | undefined
    color?: boolean | undefined
    /** LUM-1232 D-4: `false` = piped, no hard wrapping. */
    tty?: boolean | undefined
  } = {}
): string {
  const layout: LayoutOptions = {
    width: opts.width,
    color: opts.color,
    tty: opts.tty,
  }
  const id = sanitizeField(data.task.identifier)
  const t = data.totals
  const lines: string[] = [
    heading(`${id} · security scans`, { color: layout.color === true }),
  ]
  if (t.pullRequests === 0) {
    lines.push(
      ...wrapLines(
        `⚠ No PR is linked to ${id} — nothing has been scanned, so it could not be confirmed clean.`,
        2,
        layout
      )
    )
    return lines.join('\n') + '\n'
  }
  lines.push(
    ...fieldLines(
      [
        {
          label: 'PRs',
          value: `${t.pullRequests} linked · ${t.scanned} scanned`,
        },
        {
          label: 'Findings',
          value: `${t.open} open · ${t.blocking} block${t.blocking === 1 ? 's' : ''} DONE (latest scan of each PR)`,
        },
      ],
      2,
      layout
    )
  )
  // Scanning-off is said inside each PR block (`formatPrScan`), once per PR.
  for (const pr of data.pullRequests) {
    lines.push('')
    lines.push(
      formatPrScan(pr, {
        full: opts.full,
        width: opts.width,
        color: opts.color,
        tty: opts.tty,
      }).trimEnd()
    )
  }
  return lines.join('\n') + '\n'
}

/**
 * `lumo task scans <task> [--all] [--full] [--json]`
 *
 * Every security scan of a task across all its linked PRs — stages, partial
 * reasons, size caps, findings (call chain, verifier, AI suggestion) and the
 * dispositions already ruled. Reads `GET /api/tasks/:id/security-scans`
 * (the read-out view); read-only. Rule on a finding with
 * `lumo finding disposition`.
 */
export async function taskScans(
  identifier: string | undefined,
  opts: TaskScansOptions = {}
): Promise<number | void> {
  if (!identifier || identifier.trim() === '') {
    console.error(
      'Error: usage: lumo task scans <LUM-42> [--all] [--full] [--json]'
    )
    return EXIT_USAGE
  }
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const query = new URLSearchParams({ view: 'readout' })
  if (opts.all) query.set('all', '1')
  const url = `${base}/api/tasks/${encodeURIComponent(identifier.trim())}/security-scans?${query.toString()}`

  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }
  if (res.status === 401) {
    console.error(errAuth())
    return 1
  }
  if (isMissingPluginRoute(res)) {
    console.error(missingPluginMessage('task scans', 'security'))
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: task ${sanitizeField(identifier)} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    console.error(errHttp('task scans', res.status, body.error))
    return 1
  }
  const data: unknown = await res.json()
  if (!isTaskScansPayload(data)) {
    console.error(
      'Error: this Lumo server does not serve the task scan read-out yet — use `lumo pr scan <number>` per PR.'
    )
    return 1
  }
  if (opts.json) {
    // JSON.stringify escapes control characters; `version` is the contract.
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
    return
  }
  printRedactionNotice(data.redactedSecrets)
  process.stdout.write(
    formatTaskScans(data, {
      full: opts.full,
      width: terminalWidth(),
      tty: Boolean(process.stdout.isTTY),
      color: colorEnabled(),
    })
  )
}
