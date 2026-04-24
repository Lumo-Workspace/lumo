import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { writeCurrentTask } from '../lib/current-task'

interface ResolveResponse {
  id: string
  identifier: string
  title: string
  status: string
}

export async function sessionStart(
  identifier: string | undefined
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <identifier>. Usage: lumo session start <LUM-42>'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const url = `${trimTrailingSlash(apiUrl)}/api/tasks/resolve/${encodeURIComponent(identifier)}`

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
  if (res.status === 404) {
    console.error(
      `Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(`Error: resolve failed (HTTP ${res.status})`)
    return 1
  }

  const task = (await res.json()) as ResolveResponse

  writeCurrentTask({
    taskId: task.id,
    taskIdentifier: task.identifier,
    taskTitle: task.title,
    workspaceSlug: creds.workspaceSlug,
    startedAt: new Date().toISOString(),
  })

  console.log(`Session task set: ${task.identifier} "${task.title}"`)
  console.log(
    `Next \`claude code\` session in this terminal will tag hook events with ${task.identifier}.`
  )
}
