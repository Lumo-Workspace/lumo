import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { sanitizeField } from '../lib/sanitize'

export interface IdeaCaptureOptions {
  context?: string
}

interface CapturedIdeaResponse {
  idea: {
    id: string
    identifier: string
    number: number
    statement: string
    status: string
  }
}

/**
 * Success line for a captured idea. Echoes the human-referenceable id
 * (`<TEAM>-I<n>`, e.g. `LUM-I42`) — the `I` prefix keeps it visibly distinct
 * from task ids (`LUM-42`).
 */
export function formatCapturedIdeaLine(idea: { identifier: string }): string {
  return `✓ 想法 ${idea.identifier} 已入池`
}

/**
 * `lumo idea "<statement>"` — a <10s frictionless capture of a team-level idea.
 *
 * Provenance is gathered opportunistically and never blocks the capture:
 * the current `CLAUDE_CODE_SESSION_ID` (→ sourceSessionId) and the task the
 * session is bound to (→ sourceTaskId, null when nothing is bound). An
 * optional `--context` note becomes sourceContext.
 */
export async function ideaCapture(
  statement: string | undefined,
  opts: IdeaCaptureOptions
): Promise<number | void> {
  if (!statement || statement.trim().length === 0) {
    console.error(
      'Error: missing <statement>. Usage: lumo idea "<your idea>" [--context <text>]'
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
  const url = `${base}/api/ideas`

  const sourceSessionId = process.env.CLAUDE_CODE_SESSION_ID ?? null
  const sourceTaskId = await resolveBoundTaskIdentifier(apiUrl, creds.token)

  const body: Record<string, unknown> = { statement: statement.trim() }
  if (opts.context !== undefined) body.sourceContext = opts.context
  if (sourceSessionId) body.sourceSessionId = sourceSessionId
  if (sourceTaskId) body.sourceTaskId = sourceTaskId

  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
    'Content-Type': 'application/json',
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
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
    const data = (await res.json()) as CapturedIdeaResponse
    process.stdout.write(formatCapturedIdeaLine(data.idea) + '\n')
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
    console.error(`Error: idea capture failed (HTTP ${res.status})`)
  }
  return 1
}
