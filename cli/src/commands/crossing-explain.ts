import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { resolveBoundTask } from '../lib/bound-task'

export interface CrossingExplainOptions {
  note?: string
}

interface ExplainOutcome {
  crossingId: string
  explanation: {
    id: string
    note: string
    createdAt: string
  }
}

/**
 * `lumo crossing explain <id> --note "…"` — append an agent self-explanation
 * ("申辩") to a boundary crossing (LUM-542).
 *
 * This is the AGENT side of the boundary-crossing review loop and the deliberate
 * inverse of dispositioning: it can only ADD an append-only note for the human
 * reviewer to weigh — it never clears the crossing or unblocks Done (the user
 * rules on that: `lumo crossing disposition` through the exit-4 confirmation
 * protocol, or the web acceptance panel). The crossing must belong to
 * the task this session is bound to; the binding is how the target task is
 * resolved, so run it inside a session attached via `lumo session attach`.
 */
export async function crossingExplain(
  crossingId: string | undefined,
  options: CrossingExplainOptions = {}
): Promise<number | void> {
  if (!crossingId || crossingId.trim() === '') {
    console.error(
      'Error: a crossing id is required: lumo crossing explain <id> --note "…"'
    )
    return 1
  }
  const note = options.note?.trim()
  if (!note) {
    console.error(
      'Error: --note "<text>" is required (the explanation to record).'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const base = trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
  }
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (sessionId) headers['X-Lumo-Session-Id'] = sessionId

  // The crossing is addressed by id, but the route is task-scoped — resolve the
  // bound task from the session so the server can verify the crossing is on it.
  const bound = await resolveBoundTask({ base, headers, sessionId })
  if (!bound.ok) {
    console.error(bound.message)
    return 1
  }
  const taskId = bound.taskIdentifier

  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(taskId)}/boundary-crossings/${encodeURIComponent(crossingId)}/explain`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      }
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
    const errBody = (await res.json().catch(() => null)) as {
      error?: unknown
    } | null
    const detail =
      errBody && typeof errBody.error === 'string'
        ? sanitizeField(errBody.error)
        : ''
    console.error(
      `Error: explanation rejected (HTTP ${res.status})${detail ? ` — ${detail}` : ''}`
    )
    return 1
  }

  const outcome = (await res.json()) as ExplainOutcome
  process.stdout.write(
    `✓ Recorded an explanation on crossing ${sanitizeField(outcome.crossingId)}.\n` +
      '  This is an append-only note for the human reviewer — it does not clear ' +
      'the crossing or unblock Done. Once the user rules, record it with ' +
      '`lumo crossing disposition <id> --false-positive | --confirmed` (exit-4 envelope) ' +
      'or in the web panel.\n'
  )
  return
}
