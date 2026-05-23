import { trimTrailingSlash } from './api'
import { resolveDoc, isLikelyCuid } from './resolve-doc'

/**
 * Resolve a user-typed doc reference (cuid OR case-insensitive title) to a
 * document id. Fetches GET /api/documents to perform a title lookup when
 * needed. Returns null on not-found or ambiguity (and prints a helpful
 * error in the ambiguous case so the caller can just exit).
 */
export async function lookupDocId(
  apiUrl: string,
  token: string,
  reference: string
): Promise<string | null> {
  if (isLikelyCuid(reference)) return reference
  const listUrl = `${trimTrailingSlash(apiUrl)}/api/documents`
  const res = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const { documents } = (await res.json()) as {
    documents: { id: string; title: string }[]
  }
  const result = resolveDoc(reference, documents)
  if (result.kind === 'found') return result.doc.id
  if (result.kind === 'ambiguous') {
    console.error(
      `Error: title "${reference}" matches ${result.candidates.length} docs:`
    )
    for (const c of result.candidates) {
      console.error(`  ${c.id}  ${c.title}`)
    }
    console.error('Re-run with the cuid.')
    return null
  }
  return null
}
