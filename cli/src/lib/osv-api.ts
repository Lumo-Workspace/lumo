import type { OsvVuln } from './osv-advisory'

/**
 * The two OSV API calls `lumo security scan --deps` fast mode makes: the
 * batch query (which advisories affect these `name@version`s) and one
 * record fetch per advisory. Only ecosystem, package name and version are
 * sent. Any failure — unreachable, timeout, a non-2xx, a malformed body —
 * throws `OsvUnavailableError`: the caller reports the scan incomplete,
 * never clean.
 */

export const OSV_API = 'https://api.osv.dev'

/** Per-request budget. */
export const OSV_TIMEOUT_MS = 10_000

/** The API's own per-call query cap. */
const BATCH_SIZE = 1000

/** Advisory records fetched at once. */
const CONCURRENCY = 8

/** Paging rounds per batch before giving up (a package with that many advisories is not real). */
const MAX_PAGES = 20

export class OsvUnavailableError extends Error {}

export interface OsvQuery {
  ecosystem: string
  name: string
  version: string
}

async function postJson(
  url: string,
  body: unknown,
  fetchImpl: typeof fetch
): Promise<unknown> {
  return request(url, fetchImpl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function request(
  url: string,
  fetchImpl: typeof fetch,
  init: RequestInit = {}
): Promise<unknown> {
  let res: Response
  try {
    res = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(OSV_TIMEOUT_MS),
    })
  } catch (e) {
    const name = (e as Error)?.name
    throw new OsvUnavailableError(
      name === 'TimeoutError' || name === 'AbortError'
        ? `api.osv.dev did not answer within ${OSV_TIMEOUT_MS / 1000}s`
        : `api.osv.dev unreachable (${(e as Error)?.message || 'network error'})`
    )
  }
  if (!res.ok) {
    throw new OsvUnavailableError(`api.osv.dev answered HTTP ${res.status}`)
  }
  try {
    return (await res.json()) as unknown
  } catch {
    throw new OsvUnavailableError('api.osv.dev returned a malformed response')
  }
}

function idsOf(result: unknown): { ids: string[]; next: string | null } {
  const r = result as { vulns?: { id?: unknown }[]; next_page_token?: unknown }
  const ids = (Array.isArray(r?.vulns) ? r.vulns : [])
    .map(v => v?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  const next =
    typeof r?.next_page_token === 'string' && r.next_page_token
      ? r.next_page_token
      : null
  return { ids, next }
}

/** Advisory ids per query, in query order (`/v1/querybatch`, paged). */
export async function queryBatch(
  queries: OsvQuery[],
  fetchImpl: typeof fetch = fetch
): Promise<string[][]> {
  const out: string[][] = queries.map(() => [])
  for (let start = 0; start < queries.length; start += BATCH_SIZE) {
    let pending = queries
      .slice(start, start + BATCH_SIZE)
      .map((q, i) => ({ index: start + i, q, page: null as string | null }))
    for (let round = 0; pending.length > 0; round++) {
      if (round >= MAX_PAGES) {
        throw new OsvUnavailableError('api.osv.dev kept paging past the limit')
      }
      const body = await postJson(
        `${OSV_API}/v1/querybatch`,
        {
          queries: pending.map(p => ({
            package: { ecosystem: p.q.ecosystem, name: p.q.name },
            version: p.q.version,
            ...(p.page ? { page_token: p.page } : {}),
          })),
        },
        fetchImpl
      )
      const results = (body as { results?: unknown[] })?.results
      if (!Array.isArray(results) || results.length !== pending.length) {
        throw new OsvUnavailableError(
          'api.osv.dev returned a malformed response'
        )
      }
      const next: typeof pending = []
      pending.forEach((p, i) => {
        const { ids, next: token } = idsOf(results[i])
        out[p.index]?.push(...ids)
        if (token) next.push({ ...p, page: token })
      })
      pending = next
    }
  }
  return out.map(ids => [...new Set(ids)])
}

/** Full records for `ids` (`/v1/vulns/<id>`), `CONCURRENCY` at a time. */
export async function fetchVulns(
  ids: string[],
  fetchImpl: typeof fetch = fetch
): Promise<Map<string, OsvVuln>> {
  const out = new Map<string, OsvVuln>()
  const queue = [...new Set(ids)]
  // One failed fetch fails the lookup: the other workers stop taking ids.
  let failed = false
  const worker = async () => {
    for (
      let id = queue.shift();
      id !== undefined && !failed;
      id = queue.shift()
    ) {
      try {
        const body = (await request(
          `${OSV_API}/v1/vulns/${encodeURIComponent(id)}`,
          fetchImpl
        )) as OsvVuln | null
        if (!body || typeof body.id !== 'string') {
          throw new OsvUnavailableError(
            'api.osv.dev returned a malformed response'
          )
        }
        out.set(id, body)
      } catch (e) {
        failed = true
        throw e
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)
  )
  return out
}
