import { readFileSync } from 'fs'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { printStatusDigest } from '../lib/status-digest'
import { resolveBoundTask } from '../lib/bound-task'
import { resolveSessionId } from '../lib/session-id'

export interface CrossingExplainOptions {
  note?: string
  /** LUM-845: a JSON array of `{ "id", "note" }` — one note per crossing,
   *  recorded in one call. `-` reads it from stdin. */
  file?: string
  /** LUM-932: the task the crossings are on — wins over the session binding,
   *  so an unattached session (no binding) can still explain. */
  task?: string
}

interface ExplainItem {
  id: string
  note: string
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
 *
 * `--file <json|->` (LUM-845) records one note per crossing for several
 * crossings in one call: each is attempted and reported on its own line, the
 * status digest prints once, and any failure exits 1.
 */
export async function crossingExplain(
  crossingId: string | undefined,
  options: CrossingExplainOptions = {}
): Promise<number | void> {
  let items: ExplainItem[]
  if (options.file !== undefined) {
    if ((crossingId && crossingId.trim() !== '') || options.note) {
      console.error(
        'Error: --file carries the ids and notes — pass either --file or <id> --note, not both.'
      )
      return 1
    }
    const loaded = loadExplainFile(options.file)
    if (typeof loaded === 'string') {
      console.error(`Error: ${loaded}`)
      return 1
    }
    items = loaded
  } else {
    if (!crossingId || crossingId.trim() === '') {
      console.error(
        'Error: a crossing id is required: lumo crossing explain <id> --note "…" (or --file <json> for several)'
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
    items = [{ id: crossingId, note }]
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
  const sessionId = await resolveSessionId({ write: true })
  if (sessionId) headers['X-Lumo-Session-Id'] = sessionId

  // The crossing is addressed by id, but the route is task-scoped — resolve the
  // bound task from the session so the server can verify the crossing is on it.
  const bound = await resolveBoundTask({
    base,
    headers,
    sessionId,
    explicit: options.task,
  })
  if (!bound.ok) {
    console.error(bound.message)
    return 1
  }
  const taskId = bound.taskIdentifier

  if (items.length === 1) {
    const only = items[0] as ExplainItem
    const result = await postExplanation(base, headers, taskId, only)
    if (!result.ok) {
      console.error(result.error)
      return 1
    }
    process.stdout.write(
      `✓ Recorded an explanation on crossing ${sanitizeField(result.crossingId)}.\n` +
        '  This is an append-only note for the human reviewer — it does not clear ' +
        'the crossing or unblock Done. Once the user rules, record it with ' +
        '`lumo crossing disposition <id> --false-positive | --confirmed` (exit-4 envelope) ' +
        'or in the web panel.\n'
    )
    // LUM-842: an explanation never clears the crossing — the digest shows
    // that it still blocks, without a follow-up `lumo task status`.
    await printStatusDigest(base, creds.token, taskId)
    return
  }

  // LUM-845: several notes in one call — each attempted, each reported.
  const lines: string[] = []
  let failed = 0
  for (const item of items) {
    const result = await postExplanation(base, headers, taskId, item)
    if (result.ok) {
      lines.push(`  ✓ ${sanitizeField(result.crossingId)}`)
    } else {
      failed++
      lines.push(
        `  ✗ ${sanitizeField(item.id)} — ${result.error.replace(/^Error: /, '')}`
      )
    }
  }
  process.stdout.write(
    `${failed === 0 ? '✓' : '✗'} Recorded ${items.length - failed} of ${items.length} explanations on ${taskId}:\n` +
      lines.join('\n') +
      '\n' +
      '  Append-only notes for the human reviewer — they clear no crossing and unblock nothing. ' +
      'Once the user rules, record the rulings in one batch: ' +
      '`lumo crossing disposition <id> <id> … --false-positive | --confirmed` (exit-4 envelope per step).\n'
  )
  await printStatusDigest(base, creds.token, taskId)
  return failed > 0 ? 1 : undefined
}

/** Parse the `--file` batch; a string is the error to print. */
export function parseExplainItems(raw: string): ExplainItem[] | string {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return '--file is not valid JSON (expected [{"id": "…", "note": "…"}, …]).'
  }
  if (!Array.isArray(data) || data.length === 0) {
    return '--file must be a non-empty JSON array of {"id", "note"} objects.'
  }
  const items: ExplainItem[] = []
  for (const [i, entry] of data.entries()) {
    const e = entry as { id?: unknown; note?: unknown } | null
    const id = typeof e?.id === 'string' ? e.id.trim() : ''
    const note = typeof e?.note === 'string' ? e.note.trim() : ''
    if (!id || !note) {
      return `--file entry ${i + 1} needs a non-empty "id" and "note".`
    }
    items.push({ id, note })
  }
  return items
}

function loadExplainFile(path: string): ExplainItem[] | string {
  let raw: string
  try {
    raw = readFileSync(path === '-' ? 0 : path, 'utf8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `could not read --file ${path === '-' ? '(stdin)' : path} (${msg}).`
  }
  return parseExplainItems(raw)
}

type ExplainResult =
  | { ok: true; crossingId: string }
  | { ok: false; error: string }

async function postExplanation(
  base: string,
  headers: Record<string, string>,
  taskId: string,
  item: ExplainItem
): Promise<ExplainResult> {
  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(taskId)}/boundary-crossings/${encodeURIComponent(item.id)}/explain`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: item.note }),
      }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Error: could not reach Lumo API (${msg})` }
  }
  if (res.status === 401) {
    return {
      ok: false,
      error: 'Error: API key invalid or revoked. Run `lumo auth login`.',
    }
  }
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as {
      error?: unknown
    } | null
    const detail =
      errBody && typeof errBody.error === 'string'
        ? sanitizeField(errBody.error)
        : ''
    return {
      ok: false,
      error: `Error: explanation rejected (HTTP ${res.status})${detail ? ` — ${detail}` : ''}`,
    }
  }
  const outcome = (await res.json()) as ExplainOutcome
  return { ok: true, crossingId: outcome.crossingId }
}
