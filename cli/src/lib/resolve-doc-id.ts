import { trimTrailingSlash } from './api'
import { resolveDoc, isLikelyCuid } from './resolve-doc'
import { docHandle, rememberDocSlug } from './doc-handle'
import { sanitizeField } from './sanitize'

/**
 * Resolve a user-typed doc reference — its slug (`<title>-<number>`, as in
 * the web URL; LUM-1230), its title (case-insensitive) or its cuid — to a
 * document id. Fetches GET /api/documents to match, and remembers the slug
 * so output can name the doc by it ({@link docHandle}). A cuid the list does
 * not carry is passed through for the server to judge. Returns null on
 * not-found or ambiguity (and prints the candidates by slug in the ambiguous
 * case so the caller can just exit).
 */
export async function lookupDocId(
  apiUrl: string,
  token: string,
  reference: string
): Promise<string | null> {
  const listUrl = `${trimTrailingSlash(apiUrl)}/api/documents`
  let documents: {
    id: string
    title: string
    slug?: string | null
    number?: number | null
  }[] = []
  try {
    const res = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      documents = ((await res.json()) as { documents: typeof documents })
        .documents
    } else if (!isLikelyCuid(reference)) {
      return null
    }
  } catch (err) {
    if (!isLikelyCuid(reference)) throw err
  }
  const result = resolveDoc(reference, documents)
  if (result.kind === 'found') {
    rememberDocSlug(result.doc.id, result.doc.slug)
    if (result.viaNumber) {
      // Never a silent pick: say which doc the old slug's number landed on.
      console.error(
        `Note: no doc has the slug "${sanitizeField(reference)}"; using doc #${result.doc.number} by its number — now ${docHandle(result.doc.id, result.doc.slug)} "${sanitizeField(result.doc.title)}".`
      )
    }
    return result.doc.id
  }
  if (result.kind === 'ambiguous') {
    console.error(
      `Error: title "${sanitizeField(reference)}" matches ${result.candidates.length} docs:`
    )
    for (const c of result.candidates) {
      console.error(`  ${docHandle(c.id, c.slug)}  ${sanitizeField(c.title)}`)
    }
    console.error('Re-run with the slug.')
    return null
  }
  // Not in the caller's list: a cuid still goes to the server, which owns
  // the visibility decision (a doc shared only by link, an older server …).
  return isLikelyCuid(reference) ? reference.trim() : null
}
