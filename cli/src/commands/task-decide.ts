import { apiCall, apiContext } from '../lib/test-case-api'
import { localDayLabel } from '../lib/local-day'
import { sanitizeField } from '../lib/sanitize'
import { resolveSessionId } from '../lib/session-id'

/**
 * The decision line as written: prefixed with today's local date unless the
 * text already starts with a YYYY-MM-DD date.
 */
export function formatDecisionText(
  text: string,
  now: Date = new Date()
): string {
  const trimmed = text.trim()
  if (/^\d{4}-\d{2}-\d{2}\b/.test(trimmed)) return trimmed
  return `${localDayLabel(now.toISOString())} ${trimmed}`
}

/**
 * `lumo task decide <identifier> "<text>"` (LUM-970) — append a ruling to the
 * task brief's `## Decisions` section (created when missing), instead of
 * recording it as a loose comment.
 */
export async function taskDecide(
  identifier: string | undefined,
  text: string | undefined
): Promise<number | void> {
  if (!identifier || !text || text.trim() === '') {
    process.stderr.write(
      'Error: usage: lumo task decide <LUM-42> "<decision text>"\n'
    )
    return 1
  }
  const ctx = apiContext()
  if (!ctx) return 1
  const headers: Record<string, string> = {}
  const sessionId = await resolveSessionId({ write: true })
  if (sessionId) headers['X-Lumo-Session-Id'] = sessionId

  const r = await apiCall<{
    task: { identifier: string; title: string; url: string }
  }>(
    ctx,
    `/api/tasks/by-identifier/${encodeURIComponent(identifier)}/decisions`,
    { method: 'POST', headers, json: { text: formatDecisionText(text) } },
    'task decide'
  )
  if (!r.ok || !r.data) return 1
  process.stdout.write(
    `Recorded decision on ${r.data.task.identifier} "${sanitizeField(r.data.task.title)}"  ${r.data.task.url}\n`
  )
}
