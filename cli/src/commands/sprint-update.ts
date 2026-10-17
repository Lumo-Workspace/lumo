import { EXIT_USAGE } from '../lib/exit-codes'
import { fmtCalendarDay } from '../lib/format'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveSprintId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { errAuth, errHttp, errNotLoggedIn, httpFailed } from '../lib/errors'

export interface UpdateSprintOptions {
  team?: string
  name?: string
  start?: string
  end?: string
}

interface UpdatePayload {
  name?: string
  startDate?: string
  endDate?: string
}

export function buildSprintUpdatePayload(opts: UpdateSprintOptions): {
  payload: UpdatePayload
  flagsGiven: string[]
} {
  const payload: UpdatePayload = {}
  const flagsGiven: string[] = []
  if (opts.name !== undefined) {
    payload.name = opts.name
    flagsGiven.push('--name')
  }
  if (opts.start !== undefined) {
    payload.startDate = opts.start
    flagsGiven.push('--start')
  }
  if (opts.end !== undefined) {
    payload.endDate = opts.end
    flagsGiven.push('--end')
  }
  return { payload, flagsGiven }
}

interface SprintSnapshot {
  number: number
  name: string
  startDate?: string | null
  endDate?: string | null
}

export function formatSprintUpdateSummary(
  before: SprintSnapshot,
  after: UpdatePayload
): string {
  const beforeName = sanitizeField(before.name)
  const changes: string[] = []
  if (after.name !== undefined && after.name !== before.name) {
    changes.push(`name "${beforeName}" → "${sanitizeField(after.name)}"`)
  }
  if (after.startDate !== undefined) {
    changes.push(`start → ${fmtCalendarDay(after.startDate)}`)
  }
  if (after.endDate !== undefined) {
    changes.push(`end → ${fmtCalendarDay(after.endDate)}`)
  }
  return `Updated sprint #${before.number} "${beforeName}": ${changes.join(', ')}`
}

export async function sprintUpdate(
  identifier: string,
  opts: UpdateSprintOptions
): Promise<number | void> {
  // Reject empty strings — these fields can't be cleared.
  if (opts.name !== undefined && opts.name === '') {
    console.error('Error: --name cannot be empty.')
    return EXIT_USAGE
  }
  if (opts.start !== undefined && opts.start === '') {
    console.error('Error: --start cannot be empty.')
    return EXIT_USAGE
  }
  if (opts.end !== undefined && opts.end === '') {
    console.error('Error: --end cannot be empty.')
    return EXIT_USAGE
  }

  const { payload, flagsGiven } = buildSprintUpdatePayload(opts)
  if (flagsGiven.length === 0) {
    console.error(
      'Error: provide at least one field to update (--name, --start, --end)'
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

  let sprintId: string
  let resolvedNumber: number
  let resolvedName: string
  try {
    const resolved = await resolveSprintId(
      base,
      creds.token,
      identifier,
      opts.team,
      creds.workspaceSlug
    )
    sprintId = resolved.id
    resolvedNumber = resolved.number
    resolvedName = resolved.name
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  // Fetch current values to populate the before-snapshot for the summary.
  // When resolveSprintId short-circuited on UUID, number/name are empty — we
  // always GET to get a consistent snapshot regardless of identifier form.
  let beforeRes: Response
  try {
    beforeRes = await fetch(`${base}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }
  if (beforeRes.status === 401) {
    console.error(errAuth())
    return 1
  }
  if (!beforeRes.ok) {
    console.error(errHttp('sprint fetch', beforeRes.status))
    return 1
  }
  const { sprint: before } = (await beforeRes.json()) as {
    sprint: SprintSnapshot & { number: number; name: string }
  }
  // Use resolved values if available (number-based lookup already returned them).
  const beforeSnapshot: SprintSnapshot = {
    number: before.number || resolvedNumber,
    name: before.name || resolvedName,
    ...(before.startDate !== undefined && { startDate: before.startDate }),
    ...(before.endDate !== undefined && { endDate: before.endDate }),
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/sprints/${sprintId}`, {
      method: 'PATCH',
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
    let errMsg = httpFailed('sprint update', res.status)
    try {
      const errBody = (await res.json()) as { error?: string }
      if (errBody.error) errMsg = errBody.error
    } catch {
      // body wasn't JSON; keep the status-only message
    }
    console.error(`Error: ${sanitizeField(errMsg)}`)
    return 1
  }

  process.stdout.write(
    formatSprintUpdateSummary(beforeSnapshot, payload) + '\n'
  )
}
