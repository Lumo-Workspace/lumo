import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import { localDayLabel, localDayStart } from '../lib/local-day'
import { fetchMembers, resolveMember } from '../lib/resolve-member'
import { colorEnabled, heading, kvBlock, renderTable } from '../lib/ui'
import { renderListTable, type ListRenderOptions } from '../lib/list-table'

/**
 * LUM-1100 — `lumo report`: token usage + tasks completed over a window of
 * local calendar days. Local copies of the server's ReportResponse shape:
 * the CLI is a separate package and must NOT import from the app `types/`.
 */
export interface ReportTokenTotalsDto {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
}
export interface ReportResponseDto {
  version: 1
  window: { since: string; until: string }
  filter: { memberId: string | null; projectId: string | null }
  team: {
    tokens: ReportTokenTotalsDto
    sessions: number
    unmeteredSessions: number
    completedCount: number
    byModel: Array<ReportTokenTotalsDto & { model: string }>
  }
  byMember: Array<{
    memberId: string | null
    label: string
    tokens: ReportTokenTotalsDto
    sessions: number
    unmeteredSessions: number
    completedCount: number
  }>
  completedTasks: {
    total: number
    items: Array<{
      identifier: string
      title: string
      completedAt: string
      memberId: string | null
      assignee: string | null
    }>
  }
}

export const DEFAULT_REPORT_DAYS = 7
const MAX_LIMIT = 500
/** Mirrors the server's REPORT_MAX_WINDOW_DAYS. */
const MAX_WINDOW_DAYS = 366
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const RELATIVE_RE = /^(\d{1,3})d$/

export interface ReportWindow {
  /** First local day, inclusive (YYYY-MM-DD). */
  sinceDay: string
  /** Last local day, inclusive (YYYY-MM-DD). */
  untilDay: string
  /** Local midnight of sinceDay. */
  sinceIso: string
  /** Local midnight of the day AFTER untilDay (exclusive bound). */
  untilIso: string
  days: number
}

function shiftDay(day: string, plusDays: number): string {
  return localDayLabel(localDayStart(day, plusDays)!)
}

/**
 * Resolve `--since` / `--until` into local calendar days, both inclusive.
 * `--since` takes YYYY-MM-DD, `today`, `yesterday` or `Nd` (the last N days
 * including today); `--until` takes YYYY-MM-DD, `today` or `yesterday`.
 * Default: the last 7 days including today. Pure (clock injected).
 */
export function resolveReportWindow(
  opts: { since?: string | undefined; until?: string | undefined },
  now: Date
): { ok: true; window: ReportWindow } | { ok: false; error: string } {
  const today = localDayLabel(now.toISOString())
  const named = (v: string): string | null => {
    const s = v.trim().toLowerCase()
    if (s === 'today') return today
    if (s === 'yesterday') return shiftDay(today, -1)
    if (DAY_RE.test(s) && localDayStart(s) !== null) return s
    return null
  }

  let untilDay = today
  if (opts.until !== undefined) {
    const d = named(opts.until)
    if (!d)
      return {
        ok: false,
        error: `invalid --until "${opts.until}" (expected YYYY-MM-DD, today or yesterday)`,
      }
    untilDay = d
  }

  let sinceDay = shiftDay(untilDay, -(DEFAULT_REPORT_DAYS - 1))
  if (opts.since !== undefined) {
    const rel = RELATIVE_RE.exec(opts.since.trim().toLowerCase())
    if (rel) {
      const n = Number(rel[1])
      if (n < 1)
        return {
          ok: false,
          error: `invalid --since "${opts.since}" (N must be ≥ 1)`,
        }
      sinceDay = shiftDay(today, -(n - 1))
    } else {
      const d = named(opts.since)
      if (!d)
        return {
          ok: false,
          error: `invalid --since "${opts.since}" (expected YYYY-MM-DD, Nd such as 7d, today or yesterday)`,
        }
      sinceDay = d
    }
  }

  if (sinceDay > untilDay)
    return {
      ok: false,
      error: `--since ${sinceDay} is after --until ${untilDay}`,
    }

  const sinceIso = localDayStart(sinceDay)!
  const untilIso = localDayStart(untilDay, 1)!
  const days = Math.round(
    (new Date(untilIso).getTime() - new Date(sinceIso).getTime()) / 86_400_000
  )
  if (days > MAX_WINDOW_DAYS)
    return {
      ok: false,
      error: `window is ${days} days; the maximum is ${MAX_WINDOW_DAYS}`,
    }
  return { ok: true, window: { sinceDay, untilDay, sinceIso, untilIso, days } }
}

/** Deterministic thousands separator (no locale dependency, test-stable). */
export function groupThousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export interface FormatReportOptions extends ListRenderOptions {
  window: ReportWindow
  /** Human label of the `--member` filter, when given. */
  memberLabel?: string | undefined
  project?: string | undefined
  color?: boolean
}

/** Render the report. Pure (no clock / env / network). */
export function formatReport(
  data: ReportResponseDto,
  opts: FormatReportOptions
): string {
  const color = opts.color ?? false
  const w = opts.window
  const scope = [
    opts.memberLabel
      ? `member ${sanitizeField(opts.memberLabel)}`
      : 'workspace',
    opts.project ? `project ${sanitizeField(opts.project)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const out: string[] = []
  out.push(
    heading(
      `Report ${w.sinceDay} → ${w.untilDay} (${w.days} day${w.days === 1 ? '' : 's'}) · ${scope}`,
      { color }
    )
  )
  out.push('')

  const t = data.team.tokens
  const unmetered = data.team.unmeteredSessions
  const sessionsLine =
    `${data.team.sessions}` +
    (unmetered > 0
      ? ` (${unmetered} unmetered — no token usage recorded, not counted as 0)`
      : '')
  out.push(
    kvBlock(
      [
        [
          'Tokens',
          data.team.sessions === 0
            ? 'none recorded in this window'
            : `${groupThousands(t.total)} (output ${groupThousands(t.output)} · input ${groupThousands(t.input)} · cache_create ${groupThousands(t.cacheCreation)} · cache_read ${groupThousands(t.cacheRead)})`,
        ],
        ['Sessions', sessionsLine],
        [
          'Completed',
          `${data.team.completedCount} task${data.team.completedCount === 1 ? '' : 's'}`,
        ],
      ],
      { color }
    )
  )

  if (data.team.byModel.length > 0) {
    out.push('')
    out.push(heading('By model', { color }))
    out.push(
      renderTable(
        data.team.byModel.map(m => [
          sanitizeField(m.model),
          groupThousands(m.total),
          groupThousands(m.output),
        ]),
        {
          header: ['MODEL', 'TOKENS', 'OUTPUT'],
          align: [undefined, 'right', 'right'],
          maxWidths: [40],
          color,
        }
      )
    )
  }

  if (data.byMember.length > 0) {
    out.push('')
    out.push(heading('By member', { color }))
    out.push(
      renderTable(
        data.byMember.map(m => [
          sanitizeField(m.label),
          m.sessions === 0 && m.tokens.total === 0
            ? '—'
            : groupThousands(m.tokens.total),
          m.unmeteredSessions > 0
            ? `${m.sessions} (${m.unmeteredSessions} unmetered)`
            : String(m.sessions),
          String(m.completedCount),
        ]),
        {
          header: ['MEMBER', 'TOKENS', 'SESSIONS', 'DONE'],
          align: [undefined, 'right', 'right', 'right'],
          maxWidths: [32],
          color,
        }
      )
    )
  }

  out.push('')
  const ct = data.completedTasks
  if (ct.total === 0) {
    out.push(heading('Completed tasks', { color }))
    out.push('No tasks completed in this window.')
  } else {
    const shown =
      ct.items.length < ct.total
        ? ` (showing ${ct.items.length} of ${ct.total}; raise --limit for more)`
        : ` (${ct.total})`
    out.push(heading(`Completed tasks${shown}`, { color }))
    out.push(
      // LUM-1089 list shape: header + width-fitted title on a TTY only.
      renderListTable(
        ct.items.map(i => [
          i.identifier,
          localDayLabel(i.completedAt),
          i.assignee ? sanitizeField(i.assignee) : '—',
          sanitizeField(i.title),
        ]),
        {
          header: ['TASK', 'DONE', 'ASSIGNEE', 'TITLE'],
          flex: 3,
          color,
          ...(opts.tty !== undefined ? { tty: opts.tty } : {}),
          ...(opts.width !== undefined ? { width: opts.width } : {}),
        }
      )
    )
  }
  return out.join('\n')
}

export async function report(opts: {
  since?: string
  until?: string
  member?: string
  project?: string
  limit?: string
  json?: boolean
}): Promise<number | void> {
  const resolved = resolveReportWindow(opts, new Date())
  if (!resolved.ok) {
    console.error(`Error: ${resolved.error}`)
    return 1
  }
  const window = resolved.window

  let limit: number | undefined
  if (opts.limit !== undefined) {
    limit = Number(opts.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      console.error(
        `Error: invalid --limit "${opts.limit}" (expected an integer 1–${MAX_LIMIT})`
      )
      return 1
    }
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)

  let memberId: string | undefined
  let memberLabel: string | undefined
  if (opts.member !== undefined) {
    let members
    try {
      members = await fetchMembers(apiUrl, creds.token)
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`)
      return 1
    }
    const r = resolveMember(members, opts.member, creds.email)
    if (r.kind === 'not_found') {
      console.error(`Error: no member matches "${sanitizeField(r.query)}".`)
      return 1
    }
    if (r.kind === 'ambiguous') {
      const list = r.candidates
        .map(c => sanitizeField(c.email ?? c.displayName))
        .join(', ')
      console.error(
        `Error: multiple members match "${sanitizeField(r.query)}": ${list}`
      )
      return 1
    }
    memberId = r.member.memberId
    memberLabel = r.member.displayName
  }

  const params = new URLSearchParams({
    since: window.sinceIso,
    until: window.untilIso,
  })
  if (memberId) params.set('member', memberId)
  if (opts.project) params.set('project', opts.project)
  if (limit !== undefined) params.set('limit', String(limit))
  const url = `${trimTrailingSlash(apiUrl)}/api/report?${params.toString()}`

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
  if (!res.ok) {
    let detail = ''
    try {
      detail = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      // non-JSON error body — status alone is enough
    }
    console.error(errHttp('report', res.status, detail))
    return 1
  }

  const data = (await res.json()) as ReportResponseDto
  if (opts.json) {
    console.log(JSON.stringify(data, null, 2))
    return
  }
  console.log(
    formatReport(data, {
      window,
      memberLabel,
      project: opts.project,
      color: colorEnabled(),
    })
  )
}
