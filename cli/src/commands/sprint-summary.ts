import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveSprintId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { errAuth, errNotLoggedIn, httpFailed, warn } from '../lib/errors'

export interface SprintSummaryOptions {
  team?: string
  retry?: boolean
}

export interface SprintSummaryInput {
  number: number
  name: string
  stats: { done: number; total: number; velocity?: number } | null
  tldr: string | null
  report: string | null
}

export function formatSprintSummary(input: SprintSummaryInput): string {
  const { number, name, stats, tldr, report } = input
  const lines: string[] = [`Sprint: #${number} ${sanitizeField(name)}`]

  if (stats === null && tldr === null && report === null) {
    lines.push('', '(no summary generated yet)')
    return lines.join('\n')
  }

  if (stats !== null) {
    lines.push(`Done:   ${stats.done} / ${stats.total}`)
  }

  if (tldr) {
    lines.push('', sanitizeField(tldr))
  }

  if (report) {
    lines.push('', sanitizeField(report))
  }

  return lines.join('\n')
}

export async function sprintSummary(
  identifier: string,
  opts: SprintSummaryOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const workspaceSlug = creds.workspaceSlug ?? ''

  let resolved: { id: string; number: number; name: string }
  try {
    resolved = await resolveSprintId(
      base,
      creds.token,
      identifier,
      opts.team,
      workspaceSlug
    )
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  // Fill in number/name if identifier was a UUID (same pattern as sprint-start.ts).
  let displayNumber = resolved.number
  let displayName = resolved.name
  if (!displayName) {
    const r = await fetch(`${base}/api/sprints/${resolved.id}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
    if (r.ok) {
      const { sprint } = (await r.json()) as {
        sprint: { number: number; name: string }
      }
      displayNumber = sprint.number
      displayName = sprint.name
    }
  }

  // Optional retry: POST to /summary/retry first. Expect 202 (queued).
  if (opts.retry) {
    let retryRes: Response
    try {
      retryRes = await fetch(
        `${base}/api/sprints/${resolved.id}/summary/retry`,
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
      warn(
        'summary regeneration queued. Result below may still be the previous summary.'
      )
    )
  }

  // GET /api/sprints/<id>/summary — returns SprintSummary row directly or 404.
  let summaryRes: Response
  try {
    summaryRes = await fetch(`${base}/api/sprints/${resolved.id}/summary`, {
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

  let stats: SprintSummaryInput['stats'] = null
  let tldr: string | null = null
  let report: string | null = null

  if (summaryRes.ok) {
    const body = (await summaryRes.json()) as {
      stats?: SprintSummaryInput['stats']
      tldr?: string | null
      report?: string | null
    }
    stats = body.stats ?? null
    tldr = body.tldr ?? null
    report = body.report ?? null
  } else if (summaryRes.status !== 404) {
    let errMsg = httpFailed('sprint summary', summaryRes.status)
    try {
      const errBody = (await summaryRes.json()) as { error?: string }
      if (errBody.error) errMsg = errBody.error
    } catch {
      // ignore
    }
    console.error(`Error: ${sanitizeField(errMsg)}`)
    return 1
  }
  // 404 → fall through with all-null; formatSprintSummary renders the friendly marker.

  process.stdout.write(
    formatSprintSummary({
      number: displayNumber,
      name: displayName,
      stats,
      tldr,
      report,
    }) + '\n'
  )
}
