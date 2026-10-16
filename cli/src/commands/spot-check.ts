import { emptyState, fmtTimestamp, orNone } from '../lib/format'
import { apiCall, apiContext } from '../lib/test-case-api'
import { sanitizeField } from '../lib/sanitize'
import { renderListTable, type ListRenderOptions } from '../lib/list-table'
import { formatExecutor } from '../lib/test-case-executor'
import { hint } from '../lib/feedback'

/**
 * LUM-1191: `lumo spot-check` — the run-review pool the web run-reviews page
 * and the Dashboard Spot-check card show, read-only.
 *
 * Everything here is rendered from what GET /api/test-case-reviews already
 * derived (pool, random sample, false-report rate) — no ceiling / pool logic
 * is re-implemented in the CLI. Reviewing a run stays human-only in the
 * browser, so there is deliberately no write subcommand.
 */

export interface SpotCheckOptions {
  json?: boolean
}

/** One sampled run as GET /api/test-case-reviews returns it. */
export interface SpotCheckItem {
  runId: string
  taskIdentifier: string
  taskTitle: string
  caseNumber: number
  caseTitle: string
  environment: string
  commitSha: string | null
  commitDirty: boolean | null
  recordedAt: string
  /** Absent on servers before LUM-1191 — the column then stays empty. */
  executedBy?: string | null
  sourceSessionId?: string | null
  pr: { number: number; url: string } | null
}

export type SpotCheckRate =
  | {
      status: 'insufficient'
      reviewed: number
      rejected: number
      minSample: number
    }
  | { status: 'measured'; reviewed: number; rejected: number; rate: number }

export interface SpotCheckView {
  sample: SpotCheckItem[]
  poolSize: number
  rate: SpotCheckRate
}

/** The false-report readout — numerator and denominator always shown. */
export function formatSpotCheckRate(rate: SpotCheckRate): string {
  if (rate.status === 'measured') {
    const percent = `${Math.round(rate.rate * 100)}%`
    return `False-report rate: ${rate.rejected} of ${rate.reviewed} reviewed passes sent back — ${percent} false-report rate`
  }
  return `False-report rate: not enough reviews to estimate a rate yet: ${rate.reviewed} of the ${rate.minSample} needed, ${rate.rejected} sent back so far.`
}

function commitLabel(item: SpotCheckItem): string {
  if (!item.commitSha) return '-'
  return `@${sanitizeField(item.commitSha.slice(0, 7))}${item.commitDirty ? '+dirty' : ''}`
}

/**
 * The pool as text: rate readout, pool size, then one row per sampled run
 * (handle, case title, environment, when it was recorded, who ran it,
 * commit, PR). A trailing hint points at the browser for the review itself.
 */
export function formatSpotCheck(
  view: SpotCheckView,
  webUrl: string,
  env: ListRenderOptions = {}
): string {
  const lines = [formatSpotCheckRate(view.rate)]
  if (view.sample.length === 0) {
    lines.push(
      emptyState('unreviewed passes in the pool') +
        ' Every reported pass with evidence has been looked at.'
    )
    return lines.join('\n')
  }
  lines.push(
    `${view.poolSize} unreviewed passes in the pool · showing a random sample of ${view.sample.length}`,
    ''
  )
  const rows = view.sample.map(i => [
    `${sanitizeField(i.taskIdentifier)}/TC${i.caseNumber}`,
    sanitizeField(i.caseTitle),
    sanitizeField(i.environment),
    fmtTimestamp(i.recordedAt),
    orNone(formatExecutor(i)),
    commitLabel(i),
    i.pr ? `#${i.pr.number}` : '-',
  ])
  lines.push(
    renderListTable(rows, {
      header: ['CASE', 'TITLE', 'ENV', 'RECORDED', 'RUN BY', 'COMMIT', 'PR'],
      flex: 1,
      ...env,
    }),
    '',
    hint(
      `reviewing is human-only — open ${webUrl} in the browser to look at the evidence and rule.`
    )
  )
  return lines.join('\n')
}

/** `lumo spot-check` — read-only view of the run-review pool. */
export async function spotCheck(
  opts: SpotCheckOptions = {}
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1
  const r = await apiCall<SpotCheckView>(
    ctx,
    '/api/test-case-reviews',
    {},
    'spot-check'
  )
  if (!r.ok || !r.data) return 1
  if (opts.json) {
    process.stdout.write(JSON.stringify(r.data, null, 2) + '\n')
    return
  }
  const webUrl = `${ctx.base}/workspace/${ctx.workspaceSlug}/run-reviews`
  process.stdout.write(formatSpotCheck(r.data, webUrl) + '\n')
}
