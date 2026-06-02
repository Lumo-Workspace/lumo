import { resolveAuthedApiUrl, trimTrailingSlash } from './api'

interface Credentials {
  token: string
  apiUrl: string
  workspaceSlug: string
}

export interface ServerMemoryRow {
  id: string
  scope: 'TASK' | 'PROJECT'
  category: 'TRAP' | 'DECISION' | 'CONVENTION' | 'PROCEDURAL'
  content: unknown
  createdByMemberId: string | null
}

export interface ServerMemoryDraft {
  taskIdentifier: string | null
  memories: ServerMemoryRow[]
  watermark: string | null
}

export interface MemoryReviewPayload {
  watermark: string
  deleteIds: string[]
  promoteIds: string[]
}

function base(creds: Credentials): string {
  return trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
}

/** GET the memory-review draft for the session. Throws on transport / non-200. */
export async function fetchMemoryDraft(
  creds: Credentials,
  sessionId: string
): Promise<ServerMemoryDraft> {
  const url = `${base(creds)}/api/sessions/${encodeURIComponent(sessionId)}/session-memories`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (res.status === 401) throw new Error('API key invalid or revoked. Run `lumo auth login`.')
  if (!res.ok) throw new Error(`memory draft fetch failed (HTTP ${res.status})`)
  return (await res.json()) as ServerMemoryDraft
}

/** POST the review (deletes + promotes + watermark). Throws server message on non-2xx. */
export async function applyMemoryReview(
  creds: Credentials,
  sessionId: string,
  payload: MemoryReviewPayload
): Promise<{ deleted: number; promoted: number }> {
  const url = `${base(creds)}/api/sessions/${encodeURIComponent(sessionId)}/memory-review`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (res.status === 401) throw new Error('API key invalid or revoked. Run `lumo auth login`.')
  if (!res.ok) {
    let serverMsg: string | null = null
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') serverMsg = errBody.error
    } catch {
      // body wasn't JSON
    }
    throw new Error(serverMsg ?? `memory review failed (HTTP ${res.status})`)
  }
  return (await res.json()) as { deleted: number; promoted: number }
}
