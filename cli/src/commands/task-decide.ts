import { EXIT_USAGE } from '../lib/exit-codes'
import { apiCall, apiContext } from '../lib/test-case-api'
import { sanitizeField } from '../lib/sanitize'
import { resolveSessionId } from '../lib/session-id'

/**
 * `lumo task decide <identifier> "<text>" [--why "<reason>"]` (LUM-970,
 * LUM-1303) — record a ruling on the task's Decisions tab, with an optional
 * rationale, instead of as a loose comment. The server dates it.
 */
export async function taskDecide(
  identifier: string | undefined,
  text: string | undefined,
  opts: { why?: string | undefined } = {}
): Promise<number | void> {
  if (!identifier || !text || text.trim() === '') {
    process.stderr.write(
      'Error: usage: lumo task decide <LUM-42> "<decision text>" [--why "<reason>"]\n'
    )
    return EXIT_USAGE
  }
  const ctx = apiContext()
  if (!ctx) return 1
  const headers: Record<string, string> = {}
  const sessionId = await resolveSessionId({ write: true })
  if (sessionId) headers['X-Lumo-Session-Id'] = sessionId

  const why = opts.why?.trim()
  const r = await apiCall<{
    task: { identifier: string; title: string; url: string }
    /** LUM-1303; absent from servers before decisions were numbered. */
    decision?: { number?: number }
  }>(
    ctx,
    `/api/tasks/by-identifier/${encodeURIComponent(identifier)}/decisions`,
    {
      method: 'POST',
      headers,
      json: { text: text.trim(), ...(why ? { rationale: why } : {}) },
    },
    'task decide'
  )
  if (!r.ok || !r.data) return 1
  const n = r.data.decision?.number
  const label = typeof n === 'number' ? `Decision ${n}` : 'decision'
  process.stdout.write(
    `Recorded ${label} on ${r.data.task.identifier} "${sanitizeField(r.data.task.title)}"  ${r.data.task.url}\n`
  )
}
