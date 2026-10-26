/**
 * LUM-1315 — HTTP client for Codeup (Alibaba Cloud Yunxiao, center edition).
 *
 * REST base `https://openapi-rdc.aliyuncs.com/oapi/v1/codeup/organizations/
 * {organizationId}/…`, authenticated with a personal access token in the
 * `x-yunxiao-token` header (never in a URL). There is no app identity: every
 * call runs as the token's owner. Endpoints (Alibaba Cloud developer
 * reference): ListRepositories, CreateWebHook, DeleteWebHook.
 *
 * The token is never logged, never put into an error message.
 */

import { logger } from '@/lib/logger'

export const CODEUP_API_BASE = 'https://openapi-rdc.aliyuncs.com'

/** Codeup's page-size ceiling for list endpoints. */
const PER_PAGE = 100

/** Hard cap on pages read while listing repositories (100 per page). */
const MAX_PAGES = 10

/** A repository as Lumo uses it (ListRepositories response, trimmed). */
export interface CodeupRepositorySummary {
  id: number
  name: string
  /** Full path, nested groups included: `org/group/sub/repo`. */
  pathWithNamespace: string
  webUrl: string
}

/** A non-2xx answer from Codeup. `status` is the HTTP status. */
export class CodeupApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'CodeupApiError'
    this.status = status
  }
}

/** Whether a Codeup error means the token or organization was refused. */
export function isCodeupAuthError(err: unknown): boolean {
  return (
    err instanceof CodeupApiError &&
    (err.status === 401 || err.status === 403 || err.status === 404)
  )
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface CodeupClient {
  listRepositories(): Promise<CodeupRepositorySummary[]>
  createWebhook(
    repositoryId: number,
    input: { url: string; token: string }
  ): Promise<{ id: number }>
  deleteWebhook(repositoryId: number, hookId: number): Promise<void>
}

/** Organization ids are opaque tokens (a 24-hex id in practice). */
export function isValidOrganizationId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id)
}

/** Narrow one ListRepositories row; null when a required field is missing. */
export function toRepositorySummary(
  row: unknown
): CodeupRepositorySummary | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  if (
    typeof r.id !== 'number' ||
    typeof r.pathWithNamespace !== 'string' ||
    typeof r.webUrl !== 'string'
  ) {
    return null
  }
  return {
    id: r.id,
    name: typeof r.name === 'string' ? r.name : r.pathWithNamespace,
    pathWithNamespace: r.pathWithNamespace,
    webUrl: r.webUrl,
  }
}

export function createCodeupClient(
  organizationId: string,
  token: string,
  fetchImpl: FetchLike = fetch
): CodeupClient {
  if (!isValidOrganizationId(organizationId)) {
    throw new CodeupApiError(400, 'Invalid Codeup organization id')
  }
  const orgBase = `${CODEUP_API_BASE}/oapi/v1/codeup/organizations/${encodeURIComponent(organizationId)}`

  async function call(
    path: string,
    init: { method: string; body?: unknown }
  ): Promise<Response> {
    const res = await fetchImpl(`${orgBase}${path}`, {
      method: init.method,
      headers: {
        'x-yunxiao-token': token,
        Accept: 'application/json',
        ...(init.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
    if (!res.ok) {
      throw new CodeupApiError(
        res.status,
        `Codeup ${init.method} ${path.split('?')[0]} failed with ${res.status}`
      )
    }
    return res
  }

  return {
    async listRepositories() {
      const out: CodeupRepositorySummary[] = []
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await call(
          `/repositories?page=${page}&perPage=${PER_PAGE}&archived=false`,
          { method: 'GET' }
        )
        const rows = (await res.json()) as unknown
        if (!Array.isArray(rows)) break
        for (const row of rows) {
          const summary = toRepositorySummary(row)
          if (summary) out.push(summary)
        }
        const next = res.headers.get('x-next-page')
        if (rows.length < PER_PAGE || !next) break
        if (page === MAX_PAGES) {
          logger.warn(
            `[codeup] organization lists more than ${MAX_PAGES * PER_PAGE} repositories; only the first ${MAX_PAGES * PER_PAGE} are offered`
          )
        }
      }
      return out
    },

    async createWebhook(repositoryId, input) {
      const res = await call(`/repositories/${repositoryId}/webhooks`, {
        method: 'POST',
        body: {
          url: input.url,
          token: input.token,
          pushEvents: true,
          mergeRequestsEvents: true,
          noteEvents: false,
          tagPushEvents: false,
          enableSslVerification: true,
          description: 'Lumo',
        },
      })
      const json = (await res.json()) as { id?: unknown }
      if (typeof json.id !== 'number') {
        throw new CodeupApiError(502, 'Codeup returned no webhook id')
      }
      return { id: json.id }
    },

    async deleteWebhook(repositoryId, hookId) {
      await call(`/repositories/${repositoryId}/webhooks/${hookId}`, {
        method: 'DELETE',
      })
    },
  }
}
