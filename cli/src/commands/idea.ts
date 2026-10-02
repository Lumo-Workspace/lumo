import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { sanitizeField } from '../lib/sanitize'
import { resolveSessionId } from '../lib/session-id'

export interface IdeaCaptureOptions {
  context?: string
}

export interface IdeaUpdateOptions {
  status?: string
}

/**
 * The four Idea lifecycle states (LUM-679), lower-cased for CLI input. The
 * command normalizes case before sending, so `--status Developing` and
 * `--status developing` both resolve. Mirrors `lib/validation/idea.ts`.
 */
const IDEA_STATUS_VALUES = [
  'captured',
  'developing',
  'planned',
  'dropped',
] as const

interface CapturedIdeaResponse {
  idea: {
    id: string
    identifier: string
    number: number
    statement: string
    status: string
  }
}

/** One row of the team idea pool as returned by `GET /api/ideas`. */
interface IdeaListItem {
  identifier: string
  status: string
  statement: string
}

interface IdeaListResponse {
  ideas: IdeaListItem[]
}

/**
 * Render the idea pool as aligned `<id>  <status>  <statement>` lines. The
 * server already returns the pool newest-first, so this preserves order.
 * Empty pool → a friendly one-liner.
 */
export function formatIdeaList(ideas: IdeaListItem[]): string {
  if (ideas.length === 0) return 'No ideas.\n'
  const idWidth = Math.max(...ideas.map(i => i.identifier.length))
  const statusWidth = Math.max(...ideas.map(i => i.status.length))
  return (
    ideas
      .map(i => {
        const id = i.identifier.padEnd(idWidth)
        const status = i.status.padEnd(statusWidth)
        return `${id}  ${status}  ${sanitizeField(i.statement)}`
      })
      .join('\n') + '\n'
  )
}

/**
 * Success line for a captured idea. Echoes the human-referenceable id
 * (`<TEAM>-I<n>`, e.g. `LUM-I42`) — the `I` prefix keeps it visibly distinct
 * from task ids (`LUM-42`).
 */
export function formatCapturedIdeaLine(idea: { identifier: string }): string {
  return `✓ 想法 ${idea.identifier} 已入池`
}

/**
 * `lumo idea "<statement>"` — a <10s frictionless capture of a team-level idea.
 *
 * Provenance is gathered opportunistically and never blocks the capture:
 * the current `CLAUDE_CODE_SESSION_ID` (→ sourceSessionId) and the task the
 * session is bound to (→ sourceTaskId, null when nothing is bound). An
 * optional `--context` note becomes sourceContext.
 */
export async function ideaCapture(
  statement: string | undefined,
  opts: IdeaCaptureOptions
): Promise<number | void> {
  if (!statement || statement.trim().length === 0) {
    console.error(
      'Error: missing <statement>. Usage: lumo idea "<your idea>" [--context <text>]'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const url = `${base}/api/ideas`

  const sourceSessionId = (await resolveSessionId({ write: true })) ?? null
  const sourceTaskId = await resolveBoundTaskIdentifier(apiUrl, creds.token)

  const body: Record<string, unknown> = { statement: statement.trim() }
  if (opts.context !== undefined) body.sourceContext = opts.context
  if (sourceSessionId) body.sourceSessionId = sourceSessionId
  if (sourceTaskId) body.sourceTaskId = sourceTaskId

  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
    'Content-Type': 'application/json',
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }

  if (res.status === 201) {
    const data = (await res.json()) as CapturedIdeaResponse
    process.stdout.write(formatCapturedIdeaLine(data.idea) + '\n')
    return
  }

  let serverMsg: string | null = null
  try {
    const errBody = (await res.json()) as { error?: string }
    if (typeof errBody.error === 'string') serverMsg = errBody.error
  } catch {
    // Body wasn't JSON; fall through to status-only message
  }
  if (serverMsg) {
    console.error(`Error: ${sanitizeField(serverMsg)}`)
  } else {
    console.error(`Error: idea capture failed (HTTP ${res.status})`)
  }
  return 1
}

/**
 * `lumo idea list` — print the team's idea pool newest-first, each line
 * showing the `<TEAM>-I<n>` id, status (CAPTURED|PLANNED) and statement.
 * Reads `GET /api/ideas`, which returns the whole pool already ordered
 * newest-first.
 */
export async function ideaList(): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const url = `${base}/api/ideas`

  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (!res.ok) {
    console.error(`Error: idea list failed (HTTP ${res.status})`)
    return 1
  }

  const data = (await res.json()) as IdeaListResponse
  process.stdout.write(formatIdeaList(data.ideas))
}

/**
 * `lumo idea update <id> --status <STATUS>` — move an idea through its
 * lifecycle (LUM-679). `<id>` is the `<TEAM>-I<n>` identifier (a bare `<n>`
 * also resolves). The status is case-insensitive; the server enforces the
 * allowed transitions (CAPTURED↔DEVELOPING→PLANNED, any→DROPPED, DROPPED
 * terminal) and rejects an illegal move with a clear error.
 */
export async function ideaUpdate(
  idRef: string | undefined,
  opts: IdeaUpdateOptions
): Promise<number | void> {
  if (!idRef || idRef.trim().length === 0) {
    console.error(
      'Error: missing <id>. Usage: lumo idea update <LUM-I42> --status <captured|developing|planned|dropped>'
    )
    return 1
  }

  const status = opts.status?.trim().toLowerCase()
  if (!status) {
    console.error(
      'Error: --status is required. One of: captured | developing | planned | dropped'
    )
    return 1
  }
  if (
    !IDEA_STATUS_VALUES.includes(status as (typeof IDEA_STATUS_VALUES)[number])
  ) {
    console.error(
      `Error: invalid status "${sanitizeField(opts.status ?? '')}". One of: captured | developing | planned | dropped`
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const url = `${base}/api/ideas/${encodeURIComponent(idRef.trim())}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: status.toUpperCase() }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }

  if (res.ok) {
    const data = (await res.json()) as CapturedIdeaResponse
    process.stdout.write(
      `✓ 想法 ${data.idea.identifier} → ${data.idea.status}\n`
    )
    return
  }

  let serverMsg: string | null = null
  try {
    const errBody = (await res.json()) as { error?: string }
    if (typeof errBody.error === 'string') serverMsg = errBody.error
  } catch {
    // Body wasn't JSON; fall through to status-only message
  }
  if (serverMsg) {
    console.error(`Error: ${sanitizeField(serverMsg)}`)
  } else {
    console.error(`Error: idea update failed (HTTP ${res.status})`)
  }
  return 1
}
