import { EXIT_USAGE } from '../lib/exit-codes'
import { NONE, fmtCount, fmtLedger } from '../lib/format'
import {
  childCell,
  renderListTable,
  type ListRenderOptions,
} from '../lib/list-table'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import { note } from '../lib/feedback'
import { localDayStart } from '../lib/local-day'

/**
 * Local copies of the server's OperationCostResponse shape. The CLI is a
 * separate package and must NOT import from the app `types/`.
 */
export interface OperationCostRowDto {
  key: string
  label: string
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
  /** LUM-840: per-command rows under a `Bash · <purpose>` row (sums to it). */
  breakdown?: OperationCostRowDto[]
}
export interface OperationCostResponse {
  version: 1
  scope: { kind: 'task' | 'session' | 'workspace'; label: string }
  grandTotal: {
    input: number
    output: number
    cacheRead: number
    cacheCreation: number
    total: number
  }
  coverage: {
    toolTurns: number
    perStepTurns: number
    perStepPct: number | null
  }
  byTool: OperationCostRowDto[]
  byModel: OperationCostRowDto[]
  byMember: OperationCostRowDto[]
  bySession: OperationCostRowDto[]
}

type By = 'tool' | 'model' | 'member' | 'session'

/** Commands listed under a `Bash · <purpose>` row. */
const MAX_COMMANDS = 5

/**
 * One ranking table (LUM-1232 batch A): the shared list renderer — upper-case
 * header and right-aligned numbers on a TTY, nothing cut (the OPERATION cell
 * is an identifier); piped, TAB-separated rows with plain integers and child
 * rows keyed `parent/child` (L-6).
 */
function rankTable(
  title: string,
  rows: OperationCostRowDto[],
  opts: ListRenderOptions
): string {
  if (rows.length === 0) return ''
  const tty = opts.tty ?? Boolean(process.stdout.isTTY)
  const n = (v: number) => fmtLedger(v, tty)
  const cells = (label: string, r: OperationCostRowDto) => [
    label,
    n(r.output),
    n(r.input),
    n(r.cacheCreation),
    n(r.cacheRead),
    n(r.total),
  ]
  const body: string[][] = []
  for (const r of rows.slice(0, 20)) {
    const label = sanitizeField(r.label)
    body.push(cells(label, r))
    for (const c of (r.breakdown ?? []).slice(0, MAX_COMMANDS)) {
      body.push(cells(childCell(label, sanitizeField(c.label), tty), c))
    }
  }
  const table = renderListTable(body, {
    header: [
      'OPERATION',
      'OUTPUT',
      'INPUT',
      'CACHE WRITE',
      'CACHE READ',
      'TOTAL',
    ],
    align: [undefined, 'right', 'right', 'right', 'right', 'right'],
    ...opts,
    tty,
  })
  const lines = tty ? table.split('\n').map(l => `  ${l}`) : table.split('\n')
  return [title, ...lines].join('\n')
}

/**
 * LUM-1124: `--since` as the server should see it. A bare YYYY-MM-DD is the
 * shell's LOCAL midnight (the same day boundary `lumo report` uses) — sent
 * raw, the server would parse it as UTC midnight. A timestamp is read here,
 * in the shell's zone, and sent as an ISO instant. Null = not a valid day or
 * timestamp.
 */
export function resolveCostSince(
  since: string
): { iso: string; day: string | null } | null {
  const raw = since.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    // Date-shaped only: `new Date('7d')` is invalid, but bare numbers parse.
    if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) return null
    const t = new Date(raw)
    return Number.isNaN(t.getTime())
      ? null
      : { iso: t.toISOString(), day: null }
  }
  const iso = localDayStart(raw)
  return iso ? { iso, day: raw } : null
}

/**
 * Render an OperationCostResponse as the per-operation cost report. Pure
 * function (no clock / env / network) so it is deterministic and unit-testable.
 * `sinceDay` = the local day the user asked for; it titles the window instead
 * of the server's UTC instant.
 */
export function formatOperationCost(
  data: OperationCostResponse,
  by: By,
  sinceDay?: string | null,
  opts: ListRenderOptions = {}
): string {
  const primary =
    by === 'model'
      ? data.byModel
      : by === 'member'
        ? data.byMember
        : by === 'session'
          ? data.bySession
          : data.byTool
  const pct =
    data.coverage.perStepPct == null
      ? NONE
      : `${Math.round(data.coverage.perStepPct * 100)}%`
  const out: string[] = []
  const scopeLabel =
    data.scope.kind === 'workspace' && sinceDay
      ? `since ${sinceDay}`
      : data.scope.label
  out.push(
    `Per-operation cost — ${data.scope.kind} ${sanitizeField(scopeLabel)}`
  )
  out.push(
    `Total: output ${fmtCount(data.grandTotal.output)} · input ${fmtCount(data.grandTotal.input)} · cache_create ${fmtCount(data.grandTotal.cacheCreation)} · cache_read ${fmtCount(data.grandTotal.cacheRead)} · all ${fmtCount(data.grandTotal.total)} tokens`
  )
  out.push(
    `Per-step attribution: ${pct} of ${data.coverage.toolTurns} tool-using turns (rest fall back to per-turn split)`
  )
  out.push('')
  out.push(rankTable(`By ${by}`, primary, opts))
  if (by !== 'tool') out.push('\n' + rankTable('By tool', data.byTool, opts))
  if (by !== 'model') out.push('\n' + rankTable('By model', data.byModel, opts))
  if (by !== 'member' && data.byMember.length > 1)
    out.push('\n' + rankTable('By member', data.byMember, opts))
  if (by !== 'session' && data.bySession.length > 1)
    out.push('\n' + rankTable('By session', data.bySession, opts))
  out.push('')
  out.push(
    note(
      'token→tool attribution is heuristic — a model step that fires several tools in parallel splits its tokens evenly across them. output (generation) and cache_read (~95%, structural — turns × context) attribute cleanly per step; input and cache_create are bursty (prompt + cache checkpoints) and per-tool figures for those two are coarse.'
    )
  )
  return out.join('\n')
}

export async function cost(opts: {
  task?: string
  session?: string
  since?: string
  by?: string
  json?: boolean
}): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }

  const byArg = opts.by?.toLowerCase()
  const by: By =
    byArg === 'model' || byArg === 'member' || byArg === 'session'
      ? byArg
      : 'tool'

  const params = new URLSearchParams()
  let sinceDay: string | null = null
  if (opts.task) params.set('task', opts.task)
  else if (opts.session) params.set('session', opts.session)
  else if (opts.since) {
    const since = resolveCostSince(opts.since)
    if (!since) {
      console.error(
        `Error: invalid --since "${opts.since}" (expected YYYY-MM-DD or a timestamp such as 2026-10-12T09:30)`
      )
      return EXIT_USAGE
    }
    params.set('since', since.iso)
    sinceDay = since.day
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const qs = params.toString()
  const url = `${trimTrailingSlash(apiUrl)}/api/cost${qs ? `?${qs}` : ''}`

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
  if (res.status === 404) {
    console.error(
      `Error: task ${opts.task ?? ''} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('cost report', res.status))
    return 1
  }

  const data = (await res.json()) as OperationCostResponse
  if (opts.json) {
    console.log(JSON.stringify(data, null, 2))
    return
  }
  console.log(formatOperationCost(data, by, sinceDay))
}
