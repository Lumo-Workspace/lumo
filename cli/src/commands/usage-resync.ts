import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { listTranscripts } from '../lib/transcript-scan'
import { sumTranscriptUsage } from '../lib/transcript-usage'

/**
 * Sessions per request. --apply runs a write transaction per family, so its
 * batches stay small enough to finish inside the server's time budget.
 */
const DRY_RUN_BATCH = 50
const APPLY_BATCH = 10
const MAX_MODEL_KEY = 200

interface ResyncResult {
  sessionId: string
  status: 'resynced' | 'would_resync' | 'skipped'
  reason?: string
  before?: number
  after?: number
}
interface ResyncResponse {
  dryRun: boolean
  results: ResyncResult[]
}

const n = (v: number) => v.toLocaleString('en-US')

/**
 * `lumo usage resync [--apply] [--json]` (LUM-932) — recompute token usage
 * from local deduped transcripts and ask the server to correct historical
 * (inflated) rows. Dry run unless `--apply`. Sends numbers only.
 */
export async function usageResync(options?: {
  apply?: boolean
  json?: boolean
}): Promise<number | void> {
  const apply = options?.apply === true
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const url = `${trimTrailingSlash(apiUrl)}/api/sessions/usage-resync`

  const transcripts = listTranscripts()
  const sessions = []
  for (const t of transcripts) {
    const usage = sumTranscriptUsage(t.path)
    if (!usage) continue
    const bySubagent = Object.fromEntries(
      Object.entries(usage.bySubagent).map(([id, v]) => [
        id,
        { total: v.total, byModel: capModelKeys(v.byModel) },
      ])
    )
    sessions.push({
      sessionId: t.sessionId,
      total: usage.total,
      byModel: capModelKeys(usage.byModel),
      ...(Object.keys(bySubagent).length > 0 ? { bySubagent } : {}),
    })
  }
  if (sessions.length === 0) {
    process.stdout.write('No transcripts found — nothing to resync.\n')
    return 0
  }
  if (!options?.json) {
    process.stdout.write(
      `Scanning ${transcripts.length} transcript(s)… ${sessions.length} with usage.\n`
    )
  }

  const results: ResyncResult[] = []
  let batchError: string | null = null
  let unsent = 0
  const batchSize = apply ? APPLY_BATCH : DRY_RUN_BATCH
  for (let i = 0; i < sessions.length; i += batchSize) {
    const err = await postBatch(
      url,
      apiUrl,
      creds.token,
      !apply,
      sessions.slice(i, i + batchSize),
      results
    )
    if (err) {
      batchError = err
      unsent = sessions.length - i
      break
    }
  }
  const sendFailed = batchError !== null

  const count = (pred: (r: ResyncResult) => boolean) =>
    results.filter(pred).length
  const reason = (x: string) =>
    count(r => r.status === 'skipped' && r.reason === x)
  const failed = reason('error')
  const exitCode = failed > 0 || sendFailed ? 1 : 0

  if (options?.json) {
    process.stdout.write(
      JSON.stringify({ dryRun: !apply, results }, null, 2) + '\n'
    )
    if (batchError) {
      console.error(batchError)
      console.error(`${unsent} session(s) not sent — re-run`)
    }
    return exitCode
  }

  const lines: string[] = []
  if (!apply)
    lines.push('Dry run — nothing written. Re-run with --apply to write.')
  lines.push(
    `Sent ${results.length} of ${sessions.length} session(s) with usage.`
  )
  const changed = results.filter(r => r.status !== 'skipped')
  lines.push(
    apply
      ? `  ${count(r => r.status === 'resynced')} resynced`
      : `  ${count(r => r.status === 'would_resync')} would be resynced`
  )
  const before = changed.reduce((s, r) => s + (r.before ?? 0), 0)
  const after = changed.reduce((s, r) => s + (r.after ?? 0), 0)
  if (changed.length > 0) lines.push(`  tokens: ${n(before)} → ${n(after)}`)
  const rows: [number, string][] = [
    [reason('not_found'), 'not on this account / unknown'],
    [reason('not_inflated'), 'not inflated'],
    [reason('already_resynced'), 'already resynced'],
    [reason('active_after_cutoff'), 'active after cutoff (already correct)'],
    [reason('no_usage'), 'no usage'],
  ]
  for (const [c, label] of rows) if (c > 0) lines.push(`  ${c} ${label}`)
  if (failed > 0) lines.push(`  ${failed} failed — re-run later`)
  process.stdout.write(lines.join('\n') + '\n')
  if (batchError) {
    console.error(batchError)
    console.error(`${unsent} session(s) not sent — re-run`)
  }
  return exitCode
}

/** Server rejects model keys over 200 chars; drop them so one odd key can't 400 a batch. */
function capModelKeys<T>(m: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(m).filter(([k]) => k.length <= MAX_MODEL_KEY)
  )
}

/** POST one batch; appends results and returns null, or returns an error message. */
async function postBatch(
  url: string,
  apiUrl: string,
  token: string,
  dryRun: boolean,
  batch: unknown[],
  out: ResyncResult[]
): Promise<string | null> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ dryRun, sessions: batch }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `Error: could not reach Lumo API at ${apiUrl} (${msg})`
  }
  if (res.status === 401) {
    return 'Error: API key invalid or revoked. Run `lumo auth login`.'
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const data = (await res.json()) as { error?: string }
      if (data.error) message = data.error
    } catch {
      // keep the status text
    }
    return `Error: ${sanitizeField(message)}`
  }
  try {
    const data = (await res.json()) as ResyncResponse
    if (!Array.isArray(data?.results)) throw new Error('missing results')
    out.push(...data.results)
  } catch {
    return 'Error: unexpected response from Lumo API (invalid or missing results)'
  }
  return null
}
