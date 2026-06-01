import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'

interface BindResponse {
  taskId: string
  taskIdentifier: string
  taskTitle: string
  retaggedEventCount: number
  memorySection: string
}

/**
 * `lumo session attach <identifier>` — bind the currently-running
 * Claude Code session to a task.
 *
 * Required environment: `CLAUDE_CODE_SESSION_ID` (set automatically by
 * Claude Code). Must be invoked from inside a Claude Code session — there
 * is no longer a global "current task" pointer for terminals outside CC.
 *
 * The binding lives entirely on the server (`Session.taskId`); subsequent
 * hooks read it back via the session row. The CLI keeps no local sentinel.
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

  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (!sessionId) {
    console.error(
      'Error: $CLAUDE_CODE_SESSION_ID is not set.\n' +
        '`lumo session attach` must be run inside a Claude Code session.'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const url = `${trimTrailingSlash(apiUrl)}/api/sessions/${encodeURIComponent(sessionId)}/bind-task`

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
    console.error(`Error: ${sanitizeField(message)}`)
    return 1
  }
  if (!res.ok) {
    console.error(`Error: bind-task failed (HTTP ${res.status})`)
    return 1
  }

  const result = (await res.json()) as BindResponse

  console.log(
    `Attached session ${sessionId} to ${result.taskIdentifier} "${sanitizeField(result.taskTitle)}"`
  )
  console.log(
    `Re-tagged ${result.retaggedEventCount} previously-untagged event${
      result.retaggedEventCount === 1 ? '' : 's'
    } in this session.`
  )
  if (result.memorySection !== '') {
    console.log('')
    console.log(sanitizeField(result.memorySection))
  }
}
