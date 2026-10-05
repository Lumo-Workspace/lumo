import {
  ACTIVE_WORKSPACE_HEADER,
  ACTIVE_WORKSPACE_META,
  normalizeActiveSlug,
  workspaceSlugFromPathname,
} from '@/lib/workspace/active-workspace'

/** Error thrown by API client on non-ok responses */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string = 'API_ERROR'
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface ApiFetchOptions {
  method?: HttpMethod | undefined
  body?: unknown
  headers?: Record<string, string> | undefined
  signal?: AbortSignal | undefined
}

/**
 * LUM-987: the workspace the current page is in — the `/workspace/<slug>/…`
 * URL slug, else a `<meta name="lumo-workspace">` a workspace-less page
 * (e.g. `/sessions/[id]`) declares. Null outside the browser.
 */
export function currentActiveWorkspaceSlug(): string | null {
  if (typeof window === 'undefined') return null
  const fromPath = workspaceSlugFromPathname(window.location.pathname)
  if (fromPath) return fromPath
  const meta = document.querySelector<HTMLMetaElement>(
    `meta[name="${ACTIVE_WORKSPACE_META}"]`
  )
  return normalizeActiveSlug(meta?.content)
}

/**
 * Typed fetch wrapper for API calls.
 * - Sends the page's active workspace slug as `X-Lumo-Workspace` (LUM-987),
 *   unless the caller set that header itself
 * - Auto-sets Content-Type: application/json when body is a plain value
 * - For FormData bodies: skips Content-Type so the browser writes the
 *   multipart boundary, and passes the FormData through unchanged
 * - Parses JSON response
 * - Throws ApiClientError on non-ok responses
 */
export async function apiFetch<T>(
  url: string,
  options?: ApiFetchOptions
): Promise<T> {
  const { method = 'GET', body, headers, signal } = options ?? {}
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData

  const activeSlug = currentActiveWorkspaceSlug()
  const reqHeaders: Record<string, string> = {
    ...(body !== undefined && !isFormData
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(activeSlug ? { [ACTIVE_WORKSPACE_HEADER]: activeSlug } : {}),
    ...headers,
  }

  const config: RequestInit = {
    method,
    headers: reqHeaders,
    ...(signal !== undefined ? { signal } : {}),
    ...(body !== undefined
      ? { body: isFormData ? (body as FormData) : JSON.stringify(body) }
      : {}),
  }

  const res = await fetch(url, config)

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`
    let code = 'API_ERROR'
    try {
      const errorData = await res.json()
      if (errorData.error) message = errorData.error
      if (errorData.message) message = errorData.message
      if (errorData.code) code = errorData.code
    } catch {
      // Response body isn't JSON — use default message
    }
    throw new ApiClientError(message, res.status, code)
  }

  // 204 No Content
  if (res.status === 204) return undefined as T

  return res.json() as Promise<T>
}

/**
 * Fire-and-forget fetch — same as apiFetch but swallows errors silently.
 * Use for non-critical mutations where failure doesn't affect UI state.
 */
export async function apiFetchQuiet(
  url: string,
  options?: ApiFetchOptions
): Promise<void> {
  try {
    await apiFetch(url, options)
  } catch {
    // Silently ignore — caller handles rollback via other means
  }
}
