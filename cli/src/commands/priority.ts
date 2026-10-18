import { fmtDay } from '../lib/format'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { EXIT_USAGE } from '../lib/exit-codes'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import { emitJson, listEnvelope, stripInternalFields } from '../lib/json-output'

export interface PriorityView {
  id: string
  statement: string
  effectiveFrom: string
  declaredByMemberId: string
  createdAt: string
}

interface DeclareResponse {
  priority: PriorityView
}

export interface ListResponse {
  current: PriorityView | null
  history: PriorityView[]
}

/**
 * `lumo priority create <text>` (LUM-1233 3f, Q2; formerly `lumo priority
 * [text]`) — record `text` as the team's current priority. No interactive
 * prompt: an empty text is a usage error (exit 2).
 *
 * Priority is append-only — recording a new one supersedes the old without
 * deleting it. Read the append history with `lumo priority list`; the current
 * one is also the first line of `lumo status`.
 */
export async function priorityCreate(text: string): Promise<number | void> {
  const statement = text.trim()
  if (!statement) {
    console.error(
      'Error: the priority text is empty; nothing recorded. Pass 1-3 sentences: lumo priority create "<text>"'
    )
    return EXIT_USAGE
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let res: Response
  try {
    res = await fetch(`${base}/api/priorities`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ statement }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error(errAuth())
    return 1
  }
  if (res.status !== 201) {
    console.error(await errorMessage(res, 'record priority'))
    return 1
  }

  const data = (await res.json()) as DeclareResponse
  process.stdout.write(
    `Recorded priority: ${sanitizeField(data.priority.statement)}\n`
  )
}

/**
 * `lumo priority list`
 *
 * Prints the append history newest-first, marking the current declaration
 * (the row with the latest effectiveFrom).
 */
export async function priorityList(
  opts: { json?: boolean } = {}
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let res: Response
  try {
    res = await fetch(`${base}/api/priorities`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error(errAuth())
    return 1
  }
  if (!res.ok) {
    console.error(await errorMessage(res, 'list priorities'))
    return 1
  }

  const data = (await res.json()) as ListResponse
  if (opts.json) {
    emitJson(
      listEnvelope(
        'priorities',
        stripInternalFields(data.history),
        {},
        { current: stripInternalFields(data.current ?? null) }
      )
    )
    return
  }
  if (data.history.length === 0) {
    process.stdout.write('No priorities declared yet.\n')
    return
  }

  const currentId = data.current?.id
  process.stdout.write(formatPriorityHistory(data.history, currentId))
}

/** Render the append history newest-first; the current row is marked `*`. */
export function formatPriorityHistory(
  history: PriorityView[],
  currentId: string | undefined
): string {
  return (
    history
      .map(p => {
        const marker = p.id === currentId ? '*' : ' '
        const when = fmtDay(p.effectiveFrom)
        return `${marker} ${when}  ${sanitizeField(p.statement)}`
      })
      .join('\n') + '\n'
  )
}

/** Best-effort extraction of a server `{ error }` message for a failed fetch. */
async function errorMessage(res: Response, action: string): Promise<string> {
  let serverMsg: string | null = null
  try {
    const errBody = (await res.json()) as { error?: string }
    if (typeof errBody.error === 'string') serverMsg = errBody.error
  } catch {
    // Body wasn't JSON
  }
  return errHttp(action, res.status, serverMsg)
}
