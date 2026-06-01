import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'

interface DetachResponse {
  found: boolean
  alreadyUnbound?: boolean
  previousTaskIdentifier?: string
  previousTaskTitle?: string
}

/**
 * `lumo session detach` — clear the task binding on the current Claude Code
 * session. Idempotent: re-detaching an already-unbound session reports
 * "already unbound" instead of erroring.
 *
 * Past HookEvent rows keep their original taskId — only future events on
 * this session will be unbound. Re-attach later with `session attach
 * <LUM-N>` to point the session at a different task.
 */
export async function sessionDetach(): Promise<number | void> {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (!sessionId) {
    console.error(
      'Error: $CLAUDE_CODE_SESSION_ID is not set.\n' +
        '`lumo session detach` must be run inside a Claude Code session.'
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
  const url = `${trimTrailingSlash(apiUrl)}/api/sessions/${encodeURIComponent(sessionId)}/bind-task`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'DELETE',
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
    process.stdout.write(
      `Session ${sessionId} has no server-side state yet — nothing to detach.\n`
    )
    return
  }
  if (!res.ok) {
    console.error(`Error: session detach failed (HTTP ${res.status})`)
    return 1
  }

  const data = (await res.json()) as DetachResponse
  if (data.alreadyUnbound) {
    process.stdout.write(`Session ${sessionId} was already unbound.\n`)
    return
  }
  process.stdout.write(
    `Detached session ${sessionId} from ${data.previousTaskIdentifier} "${sanitizeField(data.previousTaskTitle ?? '')}".\n`
  )
}
