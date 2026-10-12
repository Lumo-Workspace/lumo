import { trimTrailingSlash } from './api'
import { httpFailed } from './errors'

export interface ResolveTagsDeps {
  apiUrl: string
  token: string
  fetchImpl?: typeof fetch
}

export interface TagRefs {
  names: string[]
  ids: string[]
}

interface ResolveResponse {
  tags: Array<{ id: string; name: string }>
}

export async function resolveTagRefs(
  refs: TagRefs,
  deps: ResolveTagsDeps
): Promise<string[]> {
  const fetchImpl = deps.fetchImpl ?? fetch

  // Trim + reject empty
  const trimmed: string[] = []
  for (const raw of refs.names) {
    const t = raw.trim()
    if (t.length === 0) {
      throw new Error('tag names must not be empty')
    }
    trimmed.push(t)
  }

  // Dedupe case-insensitively, preserve first-seen casing
  const seen = new Set<string>()
  const unique: string[] = []
  for (const t of trimmed) {
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(t)
  }

  let nameIds: string[] = []
  if (unique.length > 0) {
    const url = `${trimTrailingSlash(deps.apiUrl)}/api/tags/resolve`
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${deps.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ names: unique }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(httpFailed('tag resolve', res.status, body))
    }
    const json = (await res.json()) as ResolveResponse
    nameIds = json.tags.map(t => t.id)
  }

  // Merge with explicit ids, dedupe
  const out = new Set<string>(nameIds)
  for (const id of refs.ids) out.add(id)
  return [...out]
}
