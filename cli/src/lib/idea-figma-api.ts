import { resolveAuthedApiUrl, trimTrailingSlash } from './api'
import { readCredentials } from './config'
import type { FigmaLinkJson } from './figma-api'

export type { FigmaLinkJson }

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
  const err = Object.assign(new Error(body.error ?? `HTTP ${status}`), {
    status,
  }) as Error & { status: number; code?: string }
  if (body.code !== undefined) err.code = body.code
  return err
}

async function call<T>(
  path: string,
  init: RequestInit & { method: string }
): Promise<T> {
  const creds = readCredentials()
  if (!creds) throw new Error('Not logged in. Run: lumo auth login')
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
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

/**
 * Idea-side counterpart to `cli/src/lib/figma-api.ts` (LUM-681). Same shape,
 * same error codes (`figma_not_connected` / `figma_needs_reauth`), only the
 * URL prefix differs: `/api/ideas/:id/...` instead of `/api/tasks/:id/...`.
 */
export async function addIdeaFigmaLink(
  identifier: string,
  url: string
): Promise<{ link: FigmaLinkJson }> {
  return call(`/api/ideas/${encodeURIComponent(identifier)}/figma`, {
    method: 'POST',
    body: JSON.stringify({ url }),
  })
}

export async function listIdeaFigmaLinks(
  identifier: string
): Promise<{ links: FigmaLinkJson[] }> {
  return call(`/api/ideas/${encodeURIComponent(identifier)}/figma`, {
    method: 'GET',
  })
}

export async function removeIdeaFigmaLink(
  identifier: string,
  linkId: string
): Promise<{ ok: true }> {
  return call(
    `/api/ideas/${encodeURIComponent(identifier)}/figma/${encodeURIComponent(linkId)}`,
    { method: 'DELETE' }
  )
}

export async function refreshIdeaFigmaLinks(identifier: string): Promise<{
  results: Array<{ id: string; ok: boolean; error?: string }>
}> {
  return call(`/api/ideas/${encodeURIComponent(identifier)}/figma/refresh`, {
    method: 'POST',
  })
}
