import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveTeamId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { errAuth, errNotLoggedIn, httpFailed } from '../lib/errors'
import { successLine } from '../lib/feedback'

export interface CreateSprintOptions {
  team?: string
  name?: string
  start?: string
  end?: string
}

interface CreatePayload {
  name?: string
  startDate: string
  endDate: string
}

export function buildCreateSprintPayload(
  opts: Pick<CreateSprintOptions, 'name' | 'start' | 'end'>
): CreatePayload {
  // start/end are required by the server schema; caller validates presence.
  const payload: CreatePayload = {
    startDate: opts.start!,
    endDate: opts.end!,
  }
  if (opts.name && opts.name.length > 0) payload.name = opts.name
  return payload
}

export function formatCreatedSprintLine(sprint: {
  id: string
  number: number
  name: string
}): string {
  return successLine({
    verb: 'Created',
    kind: 'sprint',
    ref: `#${sprint.number}`,
    title: sprint.name,
    // LUM-1230: `#<number>` is the handle; the uuid is not printed.
  })
}

export async function sprintCreate(
  opts: CreateSprintOptions
): Promise<number | void> {
  if (!opts.start || !opts.end) {
    console.error('Error: --start and --end are required (YYYY-MM-DD)')
    return EXIT_USAGE
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let teamId: string
  try {
    const team = await resolveTeamId(base, creds.token, opts.team)
    teamId = team.id
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const payload = buildCreateSprintPayload(opts)

  let res: Response
  try {
    res = await fetch(`${base}/api/teams/${teamId}/sprints`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
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
    let serverMsg: string | null = null
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') serverMsg = errBody.error
    } catch {
      // ignore
    }
    console.error(
      `Error: ${serverMsg != null ? sanitizeField(serverMsg) : httpFailed('sprint create', res.status)}`
    )
    return 1
  }

  const sprint = (await res.json()) as {
    id: string
    number: number
    name: string
  }
  process.stdout.write(formatCreatedSprintLine(sprint) + '\n')
}
