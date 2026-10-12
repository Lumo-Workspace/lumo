import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { errAuth, errNotLoggedIn, httpFailed } from '../lib/errors'

export interface MilestoneSummaryOptions {
  project?: string
  retry?: boolean
}

export interface MilestoneSummaryInput {
  name: string
  stats: { done: number; total: number } | null
  tldr: string | null
  report: string | null
}

export function formatMilestoneSummary(input: MilestoneSummaryInput): string {
  const { name, stats, tldr, report } = input
  const lines: string[] = [`Milestone: ${sanitizeField(name)}`]

  if (stats === null && tldr === null && report === null) {
    lines.push('', '(no summary generated yet)')
    return lines.join('\n')
  }

  if (stats !== null) {
    lines.push(`Done:      ${stats.done} / ${stats.total}`)
  }

  if (tldr) {
    lines.push('', sanitizeField(tldr))
  }

  if (report) {
    lines.push('', sanitizeField(report))
  }

  return lines.join('\n')
}

export async function milestoneSummary(
  identifier: string,
  opts: MilestoneSummaryOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let resolved: { id: string; name: string }
  try {
    resolved = await resolveMilestoneId(
      base,
      creds.token,
      identifier,
      opts.project
    )
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  // Fill in name if identifier was a UUID (resolveMilestoneId returns '' then).
  let displayName = resolved.name
  if (!displayName) {
    const r = await fetch(`${base}/api/milestones/${resolved.id}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
    if (r.ok) {
      const { milestone } = (await r.json()) as {
        milestone: { name: string }
      }
      displayName = milestone.name
    }
  }

  // Optional retry: POST to /summary/retry first. Expect 202 (queued).
  if (opts.retry) {
    let retryRes: Response
    try {
      retryRes = await fetch(
        `${base}/api/milestones/${resolved.id}/summary/retry`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${creds.token}` },
        }
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
      return 1
    }
    if (retryRes.status === 401) {
      console.error(errAuth())
      return 1
    }
    if (!retryRes.ok && retryRes.status !== 202) {
      let errMsg = httpFailed('summary retry', retryRes.status)
      try {
        const errBody = (await retryRes.json()) as { error?: string }
        if (errBody.error) errMsg = errBody.error
      } catch {
        // ignore
      }
      console.error(`Error: ${sanitizeField(errMsg)}`)
      return 1
    }
    // 202 means queued; regeneration is async. The GET below may still return
    // the old summary or 404 — warn the user.
    console.error(
      'Note: summary regeneration queued. Result below may still be the previous summary.'
    )
  }

  // GET /api/milestones/<id>/summary — returns MilestoneSummary row or 404.
  let summaryRes: Response
  try {
    summaryRes = await fetch(`${base}/api/milestones/${resolved.id}/summary`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (summaryRes.status === 401) {
    console.error(errAuth())
    return 1
  }

  let stats: MilestoneSummaryInput['stats'] = null
  let tldr: string | null = null
  let report: string | null = null

  if (summaryRes.ok) {
    const body = (await summaryRes.json()) as {
      stats?: { done?: number; totalTasks?: number } | null
      tldr?: string | null
      report?: string | null
    }
    if (body.stats) {
      stats = {
        done: body.stats.done ?? 0,
        total: body.stats.totalTasks ?? 0,
      }
    }
    tldr = body.tldr ?? null
    report = body.report ?? null
  } else if (summaryRes.status !== 404) {
    let errMsg = httpFailed('milestone summary', summaryRes.status)
    try {
      const errBody = (await summaryRes.json()) as { error?: string }
      if (errBody.error) errMsg = errBody.error
    } catch {
      // ignore
    }
    console.error(`Error: ${sanitizeField(errMsg)}`)
    return 1
  }
  // 404 → fall through with all-null; formatMilestoneSummary renders the marker.

  process.stdout.write(
    formatMilestoneSummary({
      name: displayName,
      stats,
      tldr,
      report,
    }) + '\n'
  )
}
