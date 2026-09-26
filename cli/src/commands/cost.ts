import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'

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

/** Deterministic thousands separator (no locale dependency, test-stable). */
function groupThousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Wide enough for `Bash · typecheck/lint/build`. */
const LABEL_WIDTH = 28
/** Commands listed under a `Bash · <purpose>` row. */
const MAX_COMMANDS = 5

/** Render one ranking row: label + the four token categories + total, aligned. */
function rankRow(
  label: string,
  output: string,
  input: string,
  cacheCreate: string,
  cacheRead: string,
  total: string
): string {
  return `  ${label.slice(0, LABEL_WIDTH).padEnd(LABEL_WIDTH)}  ${output.padStart(10)}  ${input.padStart(10)}  ${cacheCreate.padStart(12)}  ${cacheRead.padStart(12)}  ${total.padStart(12)}`
}

function rankTable(title: string, rows: OperationCostRowDto[]): string {
  if (rows.length === 0) return ''
  const lines = [
    title,
    rankRow(
      'operation',
      'output',
      'input',
      'cache_create',
      'cache_read',
      'total'
    ),
  ]
  const push = (label: string, r: OperationCostRowDto) =>
    lines.push(
      rankRow(
        label,
        groupThousands(r.output),
        groupThousands(r.input),
        groupThousands(r.cacheCreation),
        groupThousands(r.cacheRead),
        groupThousands(r.total)
      )
    )
  for (const r of rows.slice(0, 20)) {
    push(sanitizeField(r.label), r)
    for (const c of (r.breakdown ?? []).slice(0, MAX_COMMANDS)) {
      push(`  ↳ ${sanitizeField(c.label)}`, c)
    }
  }
  return lines.join('\n')
}

/**
 * Render an OperationCostResponse as the per-operation cost report. Pure
 * function (no clock / env / network) so it is deterministic and unit-testable.
 */
export function formatOperationCost(
  data: OperationCostResponse,
  by: By
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
      ? 'n/a'
      : `${Math.round(data.coverage.perStepPct * 100)}%`
  const out: string[] = []
  out.push(`Per-operation cost — ${data.scope.kind} ${data.scope.label}`)
  out.push(
    `Total: output ${groupThousands(data.grandTotal.output)} · input ${groupThousands(data.grandTotal.input)} · cache_create ${groupThousands(data.grandTotal.cacheCreation)} · cache_read ${groupThousands(data.grandTotal.cacheRead)} · all ${groupThousands(data.grandTotal.total)} tokens`
  )
  out.push(
    `Per-step attribution: ${pct} of ${data.coverage.toolTurns} tool-using turns (rest fall back to per-turn split)`
  )
  out.push('')
  out.push(rankTable(`By ${by}:`, primary))
  if (by !== 'tool') out.push('\n' + rankTable('By tool:', data.byTool))
  if (by !== 'model') out.push('\n' + rankTable('By model:', data.byModel))
  if (by !== 'member' && data.byMember.length > 1)
    out.push('\n' + rankTable('By member:', data.byMember))
  if (by !== 'session' && data.bySession.length > 1)
    out.push('\n' + rankTable('By session:', data.bySession))
  out.push('')
  out.push(
    'Note: token→tool attribution is heuristic — a model step that fires several tools in parallel splits its tokens evenly across them. output (generation) and cache_read (~95%, structural — turns × context) attribute cleanly per step; input and cache_create are bursty (prompt + cache checkpoints) and per-tool figures for those two are coarse.'
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
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const byArg = opts.by?.toLowerCase()
  const by: By =
    byArg === 'model' || byArg === 'member' || byArg === 'session'
      ? byArg
      : 'tool'

  const params = new URLSearchParams()
  if (opts.task) params.set('task', opts.task)
  else if (opts.session) params.set('session', opts.session)
  else if (opts.since) params.set('since', opts.since)

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
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: task ${opts.task ?? ''} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(`Error: server returned HTTP ${res.status}`)
    return 1
  }

  const data = (await res.json()) as OperationCostResponse
  if (opts.json) {
    console.log(JSON.stringify(data, null, 2))
    return
  }
  console.log(formatOperationCost(data, by))
}
