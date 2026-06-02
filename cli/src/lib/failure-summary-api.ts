import { resolveAuthedApiUrl, trimTrailingSlash } from './api'

interface Credentials {
  token: string
  apiUrl: string
  workspaceSlug: string
}

export interface ServerTopFailure {
  label: string
  count: number
  lastErrorSummary: string | null
}

export interface ServerFailureDraft {
  taskIdentifier: string | null
  taskTitle: string | null
  topFailure: ServerTopFailure | null
  alreadyBlocked: boolean
  shouldPrompt: boolean
}

function base(creds: Credentials): string {
  return trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
}

/** GET the blocked-tag prompt draft for the session. Throws on transport / non-200. */
export async function fetchFailureSummary(
  creds: Credentials,
  sessionId: string
): Promise<ServerFailureDraft> {
  const url = `${base(creds)}/api/sessions/${encodeURIComponent(sessionId)}/failure-summary`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (res.status === 401)
    throw new Error('API key invalid or revoked. Run `lumo auth login`.')
  if (!res.ok) throw new Error(`failure summary fetch failed (HTTP ${res.status})`)
  return (await res.json()) as ServerFailureDraft
}

/** POST to attach the `blocked` tag to the session's bound task. Throws the server message on non-201. */
export async function markTaskBlocked(
  creds: Credentials,
  sessionId: string
): Promise<{ taskIdentifier: string; tag: string }> {
  const url = `${base(creds)}/api/sessions/${encodeURIComponent(sessionId)}/mark-blocked`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (res.status === 401)
    throw new Error('API key invalid or revoked. Run `lumo auth login`.')
  if (res.status !== 201) {
    let serverMsg: string | null = null
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') serverMsg = errBody.error
    } catch {
      // body wasn't JSON
    }
    throw new Error(serverMsg ?? `mark blocked failed (HTTP ${res.status})`)
  }
  return (await res.json()) as { taskIdentifier: string; tag: string }
}
