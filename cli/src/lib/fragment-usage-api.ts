import { resolveAuthedApiUrl, trimTrailingSlash } from './api'

interface Credentials {
  token: string
  apiUrl: string
  workspaceSlug: string
}

export interface ServerUsageCandidate {
  fragmentType: string
  fragmentId: string
  label: string
  used: boolean | null
}

export interface ServerUsageDraft {
  taskIdentifier: string | null
  candidates: ServerUsageCandidate[]
  alreadyVoted: boolean
}

export interface UsageVotePayload {
  usedRefs: { fragmentType: string; fragmentId: string }[]
}

function base(creds: Credentials): string {
  return trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
}

/** GET the fragment-usage draft (this session's injected fragments). */
export async function fetchUsageDraft(
  creds: Credentials,
  sessionId: string
): Promise<ServerUsageDraft> {
  const url = `${base(creds)}/api/sessions/${encodeURIComponent(sessionId)}/fragment-usage`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (res.status === 401)
    throw new Error('API key invalid or revoked. Run `lumo auth login`.')
  if (!res.ok) throw new Error(`usage draft fetch failed (HTTP ${res.status})`)
  return (await res.json()) as ServerUsageDraft
}

/** POST the usage vote (used refs). Throws the server message on non-2xx. */
export async function applyFragmentUsage(
  creds: Credentials,
  sessionId: string,
  payload: UsageVotePayload
): Promise<{ used: number; unused: number }> {
  const url = `${base(creds)}/api/sessions/${encodeURIComponent(sessionId)}/fragment-usage`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (res.status === 401)
    throw new Error('API key invalid or revoked. Run `lumo auth login`.')
  if (!res.ok) {
    let serverMsg: string | null = null
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') serverMsg = errBody.error
    } catch {
      // body wasn't JSON
    }
    throw new Error(serverMsg ?? `usage vote failed (HTTP ${res.status})`)
  }
  return (await res.json()) as { used: number; unused: number }
}
