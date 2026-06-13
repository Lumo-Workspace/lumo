import { resolveBoundTaskIdentifier } from '../../lib/resolve-bound-task'
import { sanitizeField } from '../../lib/sanitize'
import {
  fetchOpenCrossings,
  dispositionUrl,
  type OpenCrossingsResult,
} from '../../lib/open-crossings'

interface Credentials {
  token: string
  apiUrl: string
  workspaceSlug: string
}

/**
 * Build the wrap-up reminder for a task's OPEN boundary crossings (LUM-448).
 * Returns the reminder string when there is ≥1 open crossing, and `null` only on
 * a genuine empty read — the caller prints nothing on null, so a clean task
 * makes NO noise at wrap time. A check FAILURE (LUM-480) is NOT silent: it
 * returns a warning so a failed safety check never reads as "0 open / safe".
 * Read-only awareness: the reminder points at the human-only web disposition
 * panel and offers no way to clear a crossing from the terminal (LUM-426/435/422).
 */
export function formatCrossingReminder(
  taskIdentifier: string,
  result: OpenCrossingsResult,
  url: string
): string | null {
  if (result.status === 'error') {
    return (
      `⚠ Could not check boundary crossings on ${taskIdentifier} ` +
      `(network/server error) — unable to confirm whether any are still ` +
      `undispositioned. Review in the web panel: ${url}\n`
    )
  }
  const open = result.crossings
  if (open.length === 0) return null
  const n = open.length
  const lines = [
    `⚠ ${n} open boundary crossing${n === 1 ? '' : 's'} on ${taskIdentifier} still undispositioned:`,
  ]
  for (const c of open) {
    lines.push(`  • [${c.severity}] ${sanitizeField(c.category)}`)
  }
  lines.push(`  Review & disposition (web + human-only): ${url}`)
  return lines.join('\n') + '\n'
}

/**
 * Resolve the session's bound task and surface its OPEN boundary crossings as a
 * wrap-up reminder (LUM-448), or `null` when the session is unbound or the read
 * genuinely came back empty. A crossings-check failure yields a warning, not
 * silence (LUM-480). Pure read — `fetchOpenCrossings` hits only the LUM-435 GET
 * endpoint and there is no disposition write path here.
 */
export async function openCrossingReminder(
  creds: Credentials
): Promise<string | null> {
  const taskIdentifier = await resolveBoundTaskIdentifier(
    creds.apiUrl,
    creds.token
  )
  if (!taskIdentifier) return null
  const result = await fetchOpenCrossings(
    creds.apiUrl,
    creds.token,
    taskIdentifier
  )
  return formatCrossingReminder(
    taskIdentifier,
    result,
    dispositionUrl(creds.apiUrl, creds.workspaceSlug, taskIdentifier)
  )
}
