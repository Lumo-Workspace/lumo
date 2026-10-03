import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { listTranscripts } from '../lib/transcript-scan'
import { sumTranscriptUsage } from '../lib/transcript-usage'

const BATCH = 50

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

  const sessions = []
  for (const t of listTranscripts()) {
    const usage = sumTranscriptUsage(t.path)
    if (!usage) continue
    sessions.push({
      sessionId: t.sessionId,
      total: usage.total,
      byModel: usage.byModel,
      ...(Object.keys(usage.bySubagent).length > 0
        ? { bySubagent: usage.bySubagent }
        : {}),
    })
  }
  if (sessions.length === 0) {
    process.stdout.write('No transcripts found — nothing to resync.\n')
    return 0
  }

  const results: ResyncResult[] = []
  for (let i = 0; i < sessions.length; i += BATCH) {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creds.token}`,
        },
        body: JSON.stringify({
          dryRun: !apply,
          sessions: sessions.slice(i, i + BATCH),
        }),
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
    if (!res.ok) {
      let message = `HTTP ${res.status}`
      try {
        const data = (await res.json()) as { error?: string }
        if (data.error) message = data.error
      } catch {
        // keep the status text
      }
      console.error(`Error: ${sanitizeField(message)}`)
      return 1
    }
    const data = (await res.json()) as ResyncResponse
    results.push(...data.results)
  }

  const count = (pred: (r: ResyncResult) => boolean) =>
    results.filter(pred).length
  const reason = (x: string) =>
    count(r => r.status === 'skipped' && r.reason === x)
  const failed = reason('error')

  if (options?.json) {
    process.stdout.write(
      JSON.stringify({ dryRun: !apply, results }, null, 2) + '\n'
    )
    return failed > 0 ? 1 : 0
  }

  const lines: string[] = []
  if (!apply)
    lines.push('Dry run — nothing written. Re-run with --apply to write.')
  lines.push(`Scanned ${sessions.length} transcript(s).`)
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
  return failed > 0 ? 1 : 0
}
