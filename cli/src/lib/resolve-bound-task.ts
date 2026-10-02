import { trimTrailingSlash } from './api'
import { resolveSessionId } from './session-id'

/**
 * The task identifier (LUM-N) the current Claude Code session is bound to, or
 * null when there is no session env, no server-side session row, or no binding.
 * Used by the memory commands to default their target to the bound task.
 */
export async function resolveBoundTaskIdentifier(
  apiUrl: string,
  token: string
): Promise<string | null> {
  const sessionId = await resolveSessionId({ write: false })
  if (!sessionId) return null
  const url = `${trimTrailingSlash(apiUrl)}/api/sessions/${encodeURIComponent(sessionId)}`
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  } catch {
    return null
  }
  if (!res.ok) return null
  try {
    const data = (await res.json()) as { taskIdentifier?: string | null }
    return data.taskIdentifier ?? null
  } catch {
    return null
  }
}
