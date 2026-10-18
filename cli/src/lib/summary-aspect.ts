import { sanitizeField } from './sanitize'
import { httpFailed } from './errors'

/**
 * LUM-1233 3j (AF-1): the AI summary is an aspect of `milestone show` /
 * `sprint show` (`--summary`, formerly `milestone|sprint summary`), and
 * regenerating it is `milestone|sprint update --refresh-summary` (formerly
 * `summary --retry`).
 */
export type SummaryKind = 'milestones' | 'sprints'

export interface SummaryAspect {
  stats: { done: number; total: number; velocity?: number } | null
  tldr: string | null
  report: string | null
}

/** null = none generated yet (404); `{ error }` = the read failed. */
export type SummaryRead = SummaryAspect | null | { error: string }

/** GET the stored summary. Never rejects. */
export async function readSummary(
  base: string,
  token: string,
  kind: SummaryKind,
  id: string
): Promise<SummaryRead> {
  let res: Response
  try {
    res = await fetch(`${base}/api/${kind}/${id}/summary`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  if (res.status === 404) return null
  if (!res.ok) {
    let msg = httpFailed(`${kind.slice(0, -1)} summary`, res.status)
    try {
      const b = (await res.json()) as { error?: string }
      if (b.error) msg = b.error
    } catch {
      // not JSON; keep the status message
    }
    return { error: msg }
  }
  const body = (await res.json()) as {
    stats?: {
      done?: number
      total?: number
      totalTasks?: number
      velocity?: number
    } | null
    tldr?: string | null
    report?: string | null
  }
  const s = body.stats
  return {
    stats: s
      ? {
          done: s.done ?? 0,
          total: s.totalTasks ?? s.total ?? 0,
          ...(typeof s.velocity === 'number' ? { velocity: s.velocity } : {}),
        }
      : null,
    tldr: body.tldr ?? null,
    report: body.report ?? null,
  }
}

/** The `Summary` section body of a show. Pure. */
export function formatSummaryAspect(read: SummaryRead): string[] {
  if (read !== null && 'error' in read)
    return [`Could not read (${sanitizeField(read.error)})`]
  if (read === null || (!read.stats && !read.tldr && !read.report))
    return ['(no summary generated yet)']
  const lines: string[] = []
  if (read.stats) lines.push(`Done:  ${read.stats.done} / ${read.stats.total}`)
  if (read.tldr)
    lines.push(...(lines.length ? [''] : []), sanitizeField(read.tldr))
  if (read.report) lines.push('', sanitizeField(read.report))
  return lines
}

/**
 * Queue a regeneration (`POST …/summary/retry`, 202). Returns null on
 * success, else the error message.
 */
export async function queueSummaryRefresh(
  base: string,
  token: string,
  kind: SummaryKind,
  id: string
): Promise<string | null> {
  let res: Response
  try {
    res = await fetch(`${base}/api/${kind}/${id}/summary/retry`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (err) {
    return `could not reach the Lumo API (${err instanceof Error ? err.message : String(err)})`
  }
  if (res.ok || res.status === 202) return null
  let msg = httpFailed('summary refresh', res.status)
  try {
    const b = (await res.json()) as { error?: string }
    if (b.error) msg = b.error
  } catch {
    // not JSON
  }
  return sanitizeField(msg)
}
