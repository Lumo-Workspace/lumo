import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { resolveSessionId } from '../lib/session-id'

interface StatusResponse {
  exists: boolean
  sessionId: string
  startedAt: string
  lastActivityAt: string
  eventCount: number
  taskIdentifier: string | null
  taskTitle: string | null
  /** LUM-640: STEWARD when milestone-bound. Absent on older servers. */
  role?: 'IMPLEMENTATION' | 'STEWARD'
  /** LUM-640: the bound milestone's name for STEWARD sessions. Absent on older servers. */
  milestoneName?: string | null
}

export async function sessionStatus(): Promise<number | void> {
  const sessionId = await resolveSessionId({ write: false })
  if (!sessionId) {
    console.error(
      'Error: $CLAUDE_CODE_SESSION_ID is not set.\n' +
        '`lumo session status` must be run inside a Claude Code session.'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const url = `${trimTrailingSlash(apiUrl)}/api/sessions/${encodeURIComponent(sessionId)}`

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
    // Session row only materializes after the first hook event or an
    // explicit `session attach`. Until then there's nothing to report.
    process.stdout.write(
      `Session ${sessionId} has no server-side state yet (no task bound, no hook events).\n` +
        `Run \`lumo session attach <LUM-N>\` to bind it.\n`
    )
    return
  }
  if (!res.ok) {
    console.error(`Error: session status failed (HTTP ${res.status})`)
    return 1
  }

  const data = (await res.json()) as StatusResponse
  // LUM-640: the steward form — milestone-bound governance session.
  if (data.role === 'STEWARD' && data.milestoneName) {
    process.stdout.write(
      `Session ${sessionId}\n` +
        `  Role:      STEWARD (governance — plan & accept only)\n` +
        `  Bound to:  milestone "${sanitizeField(data.milestoneName)}"\n` +
        `  Events:    ${data.eventCount}\n`
    )
    return
  }
  if (data.taskIdentifier && data.taskTitle) {
    process.stdout.write(
      `Session ${sessionId}\n` +
        `  Bound to:  ${data.taskIdentifier} "${sanitizeField(data.taskTitle)}"\n` +
        `  Events:    ${data.eventCount}\n`
    )
  } else {
    process.stdout.write(
      `Session ${sessionId}\n` +
        `  Bound to:  (no task)\n` +
        `  Events:    ${data.eventCount}\n`
    )
  }
}
