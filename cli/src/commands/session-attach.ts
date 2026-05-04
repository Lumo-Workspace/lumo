import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { writeCurrentTask } from '../lib/current-task'

interface AttachResponse {
  sessionId: string
  taskId: string
  taskIdentifier: string
  taskTitle: string
  retaggedEventCount: number
}

/**
 * `lumo session attach <identifier>` — attach the currently-running
 * coding session to a task.
 *
 * Difference vs `lumo session start <identifier>`:
 *   - `start` writes ~/.lumo/current-task.json so the **next** hook
 *     events of `claude code` get tagged. The Session row created by
 *     the next claude session inherits that taskId.
 *   - `attach` does the same, AND server-side re-tags the most
 *     recently active Session row (and its still-null HookEvent rows)
 *     so the running session moves under the new task immediately.
 *     Use this when you've been working in a claude session and
 *     realize partway through that it should be filed under a
 *     different task.
 */
export async function sessionAttach(
  identifier: string | undefined
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <identifier>. Usage: lumo session attach <LUM-42>'
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
  const url = `${trimTrailingSlash(apiUrl)}/api/sessions/attach`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.token}`,
      },
      body: JSON.stringify({ taskIdentifier: identifier }),
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
    let message = 'Not found'
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // fall through
    }
    console.error(`Error: ${message}`)
    return 1
  }
  if (!res.ok) {
    console.error(`Error: attach failed (HTTP ${res.status})`)
    return 1
  }

  const result = (await res.json()) as AttachResponse

  // Mirror `lumo session start` so the next claude session also picks
  // up the new task — without this the user would have to call both
  // commands to get full forward + backward consistency.
  writeCurrentTask({
    taskId: result.taskId,
    taskIdentifier: result.taskIdentifier,
    taskTitle: result.taskTitle,
    workspaceSlug: creds.workspaceSlug,
    startedAt: new Date().toISOString(),
  })

  console.log(
    `Attached session ${result.sessionId} to ${result.taskIdentifier} "${result.taskTitle}"`
  )
  console.log(
    `Re-tagged ${result.retaggedEventCount} previously-untagged event${
      result.retaggedEventCount === 1 ? '' : 's'
    } in this session.`
  )
  console.log(
    `Future \`claude code\` sessions in this terminal will also tag with ${result.taskIdentifier}.`
  )
}
