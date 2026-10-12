import { apiCall, apiContext, type ApiContext } from '../lib/test-case-api'
import { sanitizeField } from '../lib/sanitize'
import { httpFailed, warn } from '../lib/errors'
import { cmd, hint } from '../lib/feedback'

export interface AuditListOptions {
  action?: string
  actor?: string
  since?: string
  until?: string
  targetType?: string
  target?: string
  limit?: string
  cursor?: string
  json?: boolean
  csv?: boolean
}

/** One event as GET /api/workspaces/me/audit-events returns it. */
export interface AuditListEvent {
  id: string
  createdAt: string
  action: string
  actorType: 'MEMBER' | 'AGENT' | 'SYSTEM'
  actorId: string | null
  actorName: string | null
  actorEmail: string | null
  source: string
  targetType: string
  targetId: string | null
  ip: string | null
}

export interface AuditListPage {
  events: AuditListEvent[]
  nextCursor: string | null
}

/** The query string the list / export routes take (flag → param). */
export function auditQuery(
  opts: AuditListOptions,
  withPaging: boolean
): string {
  const qs = new URLSearchParams()
  const set = (k: string, v: string | undefined) => {
    if (v !== undefined && v !== '') qs.set(k, v)
  }
  set('action', opts.action)
  set('actor', opts.actor)
  set('since', opts.since)
  set('until', opts.until)
  set('targetType', opts.targetType?.toLowerCase())
  set('targetId', opts.target)
  if (withPaging) {
    set('limit', opts.limit)
    set('cursor', opts.cursor)
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}

function actorLabel(e: AuditListEvent): string {
  if (e.actorType === 'SYSTEM') return 'system'
  if (e.actorType === 'AGENT') return `agent ${e.actorId ?? ''}`.trim()
  if (e.actorName && e.actorEmail) return `${e.actorName} <${e.actorEmail}>`
  return e.actorName ?? e.actorEmail ?? e.actorId ?? '-'
}

/**
 * Render a page as fixed-width rows: UTC time, action, actor, target,
 * source, IP. A trailing hint carries the cursor for the next page.
 */
export function formatAuditList(
  page: AuditListPage,
  opts: AuditListOptions = {}
): string {
  if (page.events.length === 0) return 'No audit events.'
  const rows = page.events.map(e => ({
    time: `${e.createdAt.slice(0, 16).replace('T', ' ')}Z`,
    action: sanitizeField(e.action),
    actor: sanitizeField(actorLabel(e)),
    target: sanitizeField(
      e.targetId ? `${e.targetType} ${e.targetId}` : e.targetType
    ),
    source: e.source,
    ip: sanitizeField(e.ip ?? '-'),
  }))
  const w = (k: keyof (typeof rows)[number]) =>
    Math.max(...rows.map(r => r[k].length))
  const [aw, uw, tw, sw] = [w('action'), w('actor'), w('target'), w('source')]
  const lines = rows.map(r =>
    [
      r.time,
      r.action.padEnd(aw),
      r.actor.padEnd(uw),
      r.target.padEnd(tw),
      r.source.padEnd(sw),
      r.ip,
    ].join('  ')
  )
  if (page.nextCursor) {
    const flags = Object.entries({
      '--action': opts.action,
      '--actor': opts.actor,
      '--since': opts.since,
      '--until': opts.until,
      '--target-type': opts.targetType,
      '--target': opts.target,
      '--limit': opts.limit,
    })
      .filter(([, v]) => v)
      .map(([k, v]) => `${k} ${JSON.stringify(v)}`)
    lines.push(
      '',
      hint(
        `more events with ${cmd(`lumo audit list ${[...flags, `--cursor ${page.nextCursor}`].join(' ')}`)}`
      )
    )
  }
  return lines.join('\n')
}

/** `--csv`: stream the server-built CSV export to stdout. */
async function writeCsv(
  ctx: ApiContext,
  opts: AuditListOptions
): Promise<number | void> {
  let res: Response
  try {
    res = await fetch(
      `${ctx.base}/api/workspaces/me/audit-events/export${auditQuery(opts, false)}`,
      { headers: { Authorization: `Bearer ${ctx.token}` } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${ctx.base} (${msg})`)
    return 1
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string
    } | null
    console.error(
      `Error: ${sanitizeField(body?.error ?? httpFailed('audit export', res.status))}`
    )
    return 1
  }
  process.stdout.write(await res.text())
  if (res.headers.get('x-audit-truncated') === 'true') {
    console.error(
      warn(
        `export capped at ${res.headers.get('x-audit-row-count') ?? 'the maximum number of'} events (newest first) — narrow --since / --until for the rest.`
      )
    )
  }
}

/** `lumo audit list` — the workspace audit log (OWNER only, LUM-907). */
export async function auditList(
  opts: AuditListOptions = {}
): Promise<number | void> {
  if (opts.json && opts.csv) {
    console.error('Error: use either --json or --csv, not both.')
    return 1
  }
  const ctx = apiContext()
  if (!ctx) return 1
  if (opts.csv) return writeCsv(ctx, opts)
  const r = await apiCall<AuditListPage>(
    ctx,
    `/api/workspaces/me/audit-events${auditQuery(opts, true)}`,
    {},
    'audit list'
  )
  if (!r.ok || !r.data) return 1
  if (opts.json) {
    process.stdout.write(JSON.stringify(r.data, null, 2) + '\n')
    return
  }
  process.stdout.write(formatAuditList(r.data, opts) + '\n')
}
