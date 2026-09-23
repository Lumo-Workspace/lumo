import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'

export interface InitiativeCreateOptions {
  assumption?: string
}

interface CreatedInitiativeResponse {
  initiative: {
    id: string
    identifier: string
    number: number
    name: string
    status: string
  }
}

/** One row of the team's initiatives as returned by `GET /api/initiatives`. */
interface InitiativeListItem {
  identifier: string
  status: string
  name: string
}

interface InitiativeListResponse {
  initiatives: InitiativeListItem[]
}

/**
 * Success line for a created initiative. Echoes the human-referenceable id
 * (`<TEAM>-INIT-<n>`, e.g. `LUM-INIT-3`) — the `INIT` infix keeps it visibly
 * distinct from task (`LUM-3`) and idea (`LUM-I3`) ids.
 */
export function formatCreatedInitiativeLine(init: {
  identifier: string
}): string {
  return `✓ Initiative ${init.identifier} created`
}

/**
 * Render the initiatives as aligned `<id>  <status>  <goal>` lines. The server
 * returns them newest-first, so this preserves order. Empty → a friendly line.
 */
export function formatInitiativeList(
  initiatives: InitiativeListItem[]
): string {
  if (initiatives.length === 0) return 'No initiatives.\n'
  const idWidth = Math.max(...initiatives.map(i => i.identifier.length))
  const statusWidth = Math.max(...initiatives.map(i => i.status.length))
  return (
    initiatives
      .map(i => {
        const id = i.identifier.padEnd(idWidth)
        const status = i.status.padEnd(statusWidth)
        return `${id}  ${status}  ${sanitizeField(i.name)}`
      })
      .join('\n') + '\n'
  )
}

/**
 * `lumo initiative create "<goal>" [--assumption <text>]` — create a
 * team-level Initiative directly, without a converter plan run. Prints the
 * created `<TEAM>-INIT-<n>` id.
 */
export async function initiativeCreate(
  goal: string | undefined,
  opts: InitiativeCreateOptions
): Promise<number | void> {
  if (!goal || goal.trim().length === 0) {
    console.error(
      'Error: missing <goal>. Usage: lumo initiative create "<goal>" [--assumption <text>]'
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
  const url = `${base}/api/initiatives`

  const body: Record<string, unknown> = { name: goal.trim() }
  if (opts.assumption !== undefined) body.assumptionNote = opts.assumption

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
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
    const data = (await res.json()) as CreatedInitiativeResponse
    process.stdout.write(formatCreatedInitiativeLine(data.initiative) + '\n')
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
    console.error(`Error: initiative create failed (HTTP ${res.status})`)
  }
  return 1
}

/**
 * `lumo initiative list` — print the team's initiatives newest-first, each
 * line showing the `<TEAM>-INIT-<n>` id, status (PROPOSED|PLANNED|ACTIVE|COMPLETED|CANCELLED)
 * and goal.
 */
export async function initiativeList(): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const url = `${base}/api/initiatives`

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
    console.error(`Error: initiative list failed (HTTP ${res.status})`)
    return 1
  }

  const data = (await res.json()) as InitiativeListResponse
  process.stdout.write(formatInitiativeList(data.initiatives))
}
