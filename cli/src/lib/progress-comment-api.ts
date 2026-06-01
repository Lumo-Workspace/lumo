import { resolveAuthedApiUrl, trimTrailingSlash } from './api'

interface Credentials {
  token: string
  apiUrl: string
  workspaceSlug: string
}

export interface ServerProgressDraft {
  taskIdentifier: string | null
  taskTitle: string | null
  summaries: { id: string; turnSummary: string; createdAt: string }[]
  watermark: string | null
}

function base(creds: Credentials): string {
  return trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
}

/** GET the unposted progress draft for the session. Throws on transport / non-200. */
export async function fetchProgressDraft(
  creds: Credentials,
  sessionId: string
): Promise<ServerProgressDraft> {
  const url = `${base(creds)}/api/sessions/${encodeURIComponent(sessionId)}/turn-summaries`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (res.status === 401) throw new Error('API key invalid or revoked. Run `lumo auth login`.')
  if (!res.ok) throw new Error(`progress draft fetch failed (HTTP ${res.status})`)
  return (await res.json()) as ServerProgressDraft
}

/** POST the (possibly edited) body + watermark. Throws the server message on non-201. */
export async function postProgressComment(
  creds: Credentials,
  sessionId: string,
  payload: { body: string; watermark: string }
): Promise<{ commentId: string }> {
  const url = `${base(creds)}/api/sessions/${encodeURIComponent(sessionId)}/progress-comment`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (res.status === 401) throw new Error('API key invalid or revoked. Run `lumo auth login`.')
  if (res.status !== 201) {
    let serverMsg: string | null = null
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') serverMsg = errBody.error
    } catch {
      // body wasn't JSON
    }
    throw new Error(serverMsg ?? `progress comment failed (HTTP ${res.status})`)
  }
  return (await res.json()) as { commentId: string }
}
