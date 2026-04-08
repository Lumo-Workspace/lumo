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
 * Typed fetch wrapper for API calls.
 * - Auto-sets Content-Type: application/json when body is present
 * - Parses JSON response
 * - Throws ApiClientError on non-ok responses
 */
export async function apiFetch<T>(
  url: string,
  options?: ApiFetchOptions
): Promise<T> {
  const { method = 'GET', body, headers, signal } = options ?? {}

  const reqHeaders: Record<string, string> = {
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...headers,
  }

  const config: RequestInit = {
    method,
    headers: reqHeaders,
    ...(signal !== undefined ? { signal } : {}),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
