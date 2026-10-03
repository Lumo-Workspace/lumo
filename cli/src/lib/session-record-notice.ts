import { readCredentials, type Credentials } from './config'
import { resolveAuthedApiUrl, trimTrailingSlash } from './api'
import { sanitizeField } from './sanitize'

const TIMEOUT_MS = 5000

export interface SessionRecordNoticeDeps {
  readCredentials: () => Credentials | null
  fetch: typeof fetch
  timeoutMs?: number
}

/**
 * LUM-943: the workspace's session record notice for `lumo setup` — one line
 * stating the mode, retention and where an OWNER changes it, rendered by the
 * server so it always reflects the current setting.
 *
 * Silent by design: not logged in, an insecure/unknown API URL, a network
 * error, a timeout, a non-2xx (e.g. an older server without the route) or a
 * malformed body all return null, and setup prints nothing for it.
 */
export async function fetchSessionRecordNotice(
  deps: SessionRecordNoticeDeps = { readCredentials, fetch }
): Promise<string | null> {
  try {
    const creds = deps.readCredentials()
    if (!creds) return null
    const apiUrl = resolveAuthedApiUrl(creds.apiUrl, { warn: () => {} })
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      deps.timeoutMs ?? TIMEOUT_MS
    )
    try {
      const res = await deps.fetch(
        `${trimTrailingSlash(apiUrl)}/api/workspaces/me/session-records`,
        {
          headers: { Authorization: `Bearer ${creds.token}` },
          signal: controller.signal,
        }
      )
      if (!res.ok) return null
      const body = (await res.json()) as {
        sessionRecords?: { notice?: unknown } | null
      }
      const notice = body?.sessionRecords?.notice
      if (typeof notice !== 'string' || notice.trim() === '') return null
      return sanitizeField(notice.trim())
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}
