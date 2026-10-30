/**
 * LUM-1341 — the one place Lumo talks HTTP to Feishu / Lark. No SDK: plain
 * fetch, so the wrapper stays small and nothing third-party is imported
 * outside `lib/integrations/feishu/` (DIP).
 *
 * Every error carries the endpoint, HTTP status and Feishu's numeric `code`,
 * never a request or response token — callers may log it as is.
 */

/** A failed Feishu call. `code` is Feishu's numeric error code when present. */
export class FeishuApiError extends Error {
  readonly endpoint: string
  readonly httpStatus: number
  readonly code: number | null

  constructor(
    endpoint: string,
    httpStatus: number,
    code: number | null,
    detail: string
  ) {
    super(
      `Feishu ${endpoint} failed: HTTP ${httpStatus}` +
        (code !== null ? `, code ${code}` : '') +
        (detail ? ` (${detail.slice(0, 120)})` : '')
    )
    this.name = 'FeishuApiError'
    this.endpoint = endpoint
    this.httpStatus = httpStatus
    this.code = code
  }
}

type Json = Record<string, unknown>

async function readJson(res: Response): Promise<Json> {
  try {
    const body = (await res.json()) as unknown
    return body && typeof body === 'object' ? (body as Json) : {}
  } catch {
    return {}
  }
}

function errorDetail(body: Json): string {
  for (const key of ['msg', 'error_description', 'error']) {
    const v = body[key]
    if (typeof v === 'string' && v) return v
  }
  return ''
}

/**
 * Send one request and return the parsed body when Feishu reports success
 * (HTTP 2xx and `code` 0 or absent). Anything else throws FeishuApiError.
 */
export async function feishuRequest(
  url: string,
  init: { method: 'GET' | 'POST'; token?: string; json?: unknown },
  endpoint: string
): Promise<Json> {
  const headers: Record<string, string> = {}
  if (init.token) headers.Authorization = `Bearer ${init.token}`
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8'
  }
  const res = await fetch(url, {
    method: init.method,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : null,
  })
  const body = await readJson(res)
  const code = typeof body.code === 'number' ? body.code : null
  if (!res.ok || (code !== null && code !== 0)) {
    throw new FeishuApiError(endpoint, res.status, code, errorDetail(body))
  }
  return body
}
