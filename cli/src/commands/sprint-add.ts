import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { resolveSprintId } from '../lib/resolve'
import { errNotLoggedIn, httpFailed } from '../lib/errors'

export interface AddTaskToSprintOptions {
  team?: string
}

export async function sprintAdd(
  identifier: string,
  taskIdentifier: string,
  opts: AddTaskToSprintOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const workspaceSlug = creds.workspaceSlug ?? ''

  let resolved: { id: string; number: number }
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

  // Resolve task → id via /api/tasks/by-identifier/<LUM-N>
  const tr = await fetch(
    `${base}/api/tasks/by-identifier/${encodeURIComponent(taskIdentifier)}`,
    { headers: { Authorization: `Bearer ${creds.token}` } }
  )
  if (!tr.ok) {
    console.error(`Error: task ${taskIdentifier} not found (HTTP ${tr.status})`)
    return 1
  }
  const { task } = (await tr.json()) as { task: { id: string } }

  let res: Response
  try {
    res = await fetch(`${base}/api/sprints/${resolved.id}/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ taskId: task.id }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }
  if (!res.ok) {
    let errMsg = httpFailed('sprint add', res.status)
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
    `Added ${taskIdentifier} to sprint #${resolved.number}\n`
  )
}
