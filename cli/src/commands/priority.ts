import { fmtDay } from '../lib/format'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { promptLine } from '../lib/line-prompt'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'

interface PriorityView {
  id: string
  statement: string
  effectiveFrom: string
  declaredByMemberId: string
  createdAt: string
}

interface DeclareResponse {
  priority: PriorityView
}

interface ListResponse {
  current: PriorityView | null
  history: PriorityView[]
}

/**
 * `lumo priority [text]`
 *
 * With `text`: records it directly as the team's current priority.
 * Without `text`: interactively prompts for a 1-3 sentence statement.
 *
 * Priority is append-only — recording a new one supersedes the old without
 * deleting it. Read the append history with `lumo priority list`.
 */
export async function priority(
  text: string | undefined
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }

  let statement = (text ?? '').trim()
  if (!statement) {
    statement = (await promptLine('Priority (1-3 sentences): ')).trim()
  }
  if (!statement) {
    console.error('Error: no priority provided. Nothing recorded.')
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
export async function priorityList(): Promise<number | void> {
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
