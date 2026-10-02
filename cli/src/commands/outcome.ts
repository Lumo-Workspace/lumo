import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { resolveSessionId } from '../lib/session-id'

interface SignalRow {
  id: string
  kind: string
  source: string
  detectedAt: string
  occurredAt: string | null
  evidence: { note?: string } | null
}

async function authBase(): Promise<
  { base: string; headers: Record<string, string> } | { error: string }
> {
  const creds = readCredentials()
  if (!creds) return { error: 'not logged in. Run `lumo auth login` first.' }
  const base = trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
  }
  const sessionId = await resolveSessionId({ write: false })
  if (sessionId) headers['X-Lumo-Session-Id'] = sessionId
  return { base, headers }
}

/**
 * `lumo outcome show <task>` — read the well for a task: the falsifier verdict
 * plus its backing rejection signals.
 */
export async function outcomeShow(
  taskId: string | undefined
): Promise<number | void> {
  if (!taskId || taskId.trim() === '') {
    console.error('Error: a task is required: lumo outcome show <task>')
    return 1
  }
  const auth = await authBase()
  if ('error' in auth) {
    console.error(`Error: ${auth.error}`)
    return 1
  }

  let res: Response
  try {
    res = await fetch(
      `${auth.base}/api/tasks/${encodeURIComponent(taskId)}/outcome-signals`,
      { headers: auth.headers }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API (${msg})`)
    return 1
  }
  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (!res.ok) {
    console.error(`Error: could not read the well (HTTP ${res.status}).`)
    return 1
  }

  const well = (await res.json()) as {
    verdict: 'REJECTED' | 'INCONCLUSIVE'
    signals: SignalRow[]
  }

  const mark = well.verdict === 'REJECTED' ? '✗' : '·'
  process.stdout.write(
    `${mark} Outcome well — ${sanitizeField(taskId)}: ${well.verdict}\n`
  )
  if (well.verdict === 'INCONCLUSIVE') {
    process.stdout.write(
      '  No rejection on record. INCONCLUSIVE ≠ satisfied — the well only ' +
        'asserts rejection; silence is not a pass.\n'
    )
    return
  }
  for (const s of well.signals) {
    const when = (s.occurredAt ?? s.detectedAt).slice(0, 10)
    const note = s.evidence?.note ? ` — ${sanitizeField(s.evidence.note)}` : ''
    process.stdout.write(
      `  ${when}  ${sanitizeField(s.kind)} (${sanitizeField(s.source)})${note}\n`
    )
  }
  return
}

// ─── `lumo outcome rate` — trust × post-hoc-fate join (LUM-603 / LUM-606) ─────

export interface OutcomeRateOptions {
  min?: string
  json?: boolean
}

/** Value-neutral verification-friction buckets (LUM-606) — pure descriptions of
 *  the verification record, no good/bad ordering welded into the names. */
type FrictionBucketDto =
  | 'no-verification'
  | 'single-round'
  | 'multi-round-or-sendback'

interface BracketRejectionDto {
  bracket: FrictionBucketDto
  delivered: number
  rejected: number
  status: 'measured' | 'insufficient'
  rejectionRate: number | null
  interval: { lower: number; upper: number } | null
}

interface OutcomeRejectionReportDto {
  minSamples: number
  totalDeliveries: number
  brackets: BracketRejectionDto[]
  comparison: {
    status: 'measured' | 'inconclusive'
    direction:
      | 'multi-round-or-sendback-rejected-more'
      | 'single-round-rejected-more'
      | null
    reason: string
  }
}

/** Width of the widest bucket label, for aligned columns. */
const BUCKET_LABEL_WIDTH = 'multi-round-or-sendback'.length

/** Render the report client-side (same pattern as `lumo cost` / `outcome show`). */
function formatRate(report: OutcomeRejectionReportDto): string {
  const lines: string[] = []
  lines.push(
    'Trust × post-hoc fate — delivery-time verification friction vs the outcome well'
  )
  lines.push(
    '  (rejection rate is a LOWER BOUND: the well only records rejections; ' +
      'no signal = INCONCLUSIVE, never "satisfied")'
  )
  lines.push(
    `  ${report.totalDeliveries} snapshotted deliveries · min ${report.minSamples} per bracket`
  )
  if (report.totalDeliveries === 0) {
    lines.push('  (no delivery has a forecast snapshot yet — nothing to join)')
    return lines.join('\n') + '\n'
  }
  for (const b of report.brackets) {
    if (b.status === 'measured') {
      const pct = ((b.rejectionRate ?? 0) * 100).toFixed(1)
      const lo = ((b.interval?.lower ?? 0) * 100).toFixed(1)
      const hi = ((b.interval?.upper ?? 0) * 100).toFixed(1)
      lines.push(
        `  ${b.bracket.padEnd(BUCKET_LABEL_WIDTH)} ≥${pct}% rejected (${b.rejected}/${b.delivered}, 95% CI ${lo}–${hi}%)`
      )
    } else {
      lines.push(
        `  ${b.bracket.padEnd(BUCKET_LABEL_WIDTH)} insufficient (${b.rejected}/${b.delivered} deliveries < ${report.minSamples} — rate withheld)`
      )
    }
  }
  const verdict =
    report.comparison.status === 'measured'
      ? `→ ${sanitizeField(report.comparison.reason)}`
      : `→ inconclusive: ${sanitizeField(report.comparison.reason)}`
  lines.push(`  ${verdict}`)
  return lines.join('\n') + '\n'
}

/**
 * `lumo outcome rate [--min N] [--json]` — read the workspace trust × post-hoc-
 * fate join: per delivery-time verification-friction bucket (LUM-606:
 * no-verification / single-round / multi-round-or-sendback, frozen at delivery),
 * the post-hoc REJECTED rate from the outcome well. Honest by construction — thin
 * buckets read `insufficient` (no fabricated rate) and the single-round
 * vs multi-round-or-sendback comparison stays `inconclusive` until the well has
 * enough signal to tell the buckets apart.
 */
export async function outcomeRate(
  options: OutcomeRateOptions = {}
): Promise<number | void> {
  const auth = await authBase()
  if ('error' in auth) {
    console.error(`Error: ${auth.error}`)
    return 1
  }

  let min: number | undefined
  if (options.min !== undefined && options.min.trim() !== '') {
    const n = Number(options.min)
    if (!Number.isInteger(n) || n < 1) {
      console.error('Error: --min must be a positive integer')
      return 1
    }
    min = n
  }
  const qs = min !== undefined ? `?min=${min}` : ''

  let res: Response
  try {
    res = await fetch(`${auth.base}/api/outcome/rate${qs}`, {
      headers: auth.headers,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API (${msg})`)
    return 1
  }
  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (!res.ok) {
    console.error(
      `Error: could not read the outcome rate (HTTP ${res.status}).`
    )
    return 1
  }

  const report = (await res.json()) as OutcomeRejectionReportDto
  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    return
  }
  process.stdout.write(formatRate(report))
  return
}
