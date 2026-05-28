import { resolveApiUrl, trimTrailingSlash } from './api'
import { readCredentials } from './config'

export interface FigmaLinkJson {
  id: string
  fileKey: string
  nodeId: string
  url: string
  fileName: string
  frameName: string | null
  thumbnailUrl: string | null
  thumbnailFetchedAt: string | null
  lastSyncedAt: string
  lastSyncError: string | null
  createdAt: string
}

interface ErrorBody {
  error?: string
  code?: string
}

function buildErr(
  status: number,
  body: ErrorBody
): Error & {
  status: number
  code?: string
} {
  return Object.assign(new Error(body.error ?? `HTTP ${status}`), {
    status,
    code: body.code,
  })
}

async function call<T>(
  path: string,
  init: RequestInit & { method: string }
): Promise<T> {
  const creds = readCredentials()
  if (!creds) throw new Error('Not logged in. Run: lumo auth login')
  const apiUrl = resolveApiUrl()
  const res = await fetch(`${trimTrailingSlash(apiUrl)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    let parsed: ErrorBody = {}
    try {
      parsed = (await res.json()) as ErrorBody
    } catch {
      /* non-JSON body */
    }
    throw buildErr(res.status, parsed)
  }
  return (await res.json()) as T
}

export async function addFigmaLink(
  identifier: string,
  url: string
): Promise<{ link: FigmaLinkJson }> {
  return call(`/api/tasks/${encodeURIComponent(identifier)}/figma`, {
    method: 'POST',
    body: JSON.stringify({ url }),
  })
}

export async function listFigmaLinks(
  identifier: string
): Promise<{ links: FigmaLinkJson[] }> {
  return call(`/api/tasks/${encodeURIComponent(identifier)}/figma`, {
    method: 'GET',
  })
}

export async function removeFigmaLink(
  identifier: string,
  linkId: string
): Promise<{ ok: true }> {
  return call(
    `/api/tasks/${encodeURIComponent(identifier)}/figma/${encodeURIComponent(linkId)}`,
    { method: 'DELETE' }
  )
}

export async function refreshFigmaLinks(identifier: string): Promise<{
  results: Array<{ id: string; ok: boolean; error?: string }>
}> {
  return call(`/api/tasks/${encodeURIComponent(identifier)}/figma/refresh`, {
    method: 'POST',
  })
}
