import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveSprintId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { errAuth, errNotLoggedIn, httpFailed } from '../lib/errors'

export interface StartSprintOptions {
  team?: string
}

export async function sprintStart(
  identifier: string,
  opts: StartSprintOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const workspaceSlug = creds.workspaceSlug ?? ''

  let resolved: { id: string; number: number; name: string }
  try {
    resolved = await resolveSprintId(
      base,
      creds.token,
      identifier,
      opts.team,
      workspaceSlug
    )
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  // Fill in number/name if identifier was a UUID.
  let displayNumber = resolved.number
  let displayName = resolved.name
  if (!displayName) {
    const r = await fetch(`${base}/api/sprints/${resolved.id}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
    if (r.ok) {
      const { sprint } = (await r.json()) as {
        sprint: { number: number; name: string }
      }
      displayNumber = sprint.number
      displayName = sprint.name
    }
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/sprints/${resolved.id}/start`, {
      method: 'POST',
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
    let errMsg = httpFailed('sprint start', res.status)
    try {
      const errBody = (await res.json()) as { error?: string }
      if (errBody.error) errMsg = errBody.error
    } catch {
      // ignore
    }
    console.error(`Error: ${sanitizeField(errMsg)}`)
    return 1
  }
  process.stdout.write(
    `Started sprint #${displayNumber} "${sanitizeField(displayName)}"\n`
  )
}
