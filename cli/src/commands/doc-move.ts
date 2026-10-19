import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveDoc } from '../lib/resolve-doc'
import { pickNextSortOrder } from '../lib/doc-sort-order'
import { sanitizeField } from '../lib/sanitize'
import { errHttp, errNotLoggedIn } from '../lib/errors'
import { docHandle } from '../lib/doc-handle'

export interface MoveDocOptions {
  parent?: string
  root?: boolean
}

interface DocLike {
  slug?: string | null
  id: string
  title: string
  parentId: string | null
  sortOrder: number
}

export async function docMove(
  reference: string | undefined,
  opts: MoveDocOptions
): Promise<number | void> {
  if (!reference) {
    console.error('Error: usage: lumo doc move <doc> --parent <doc> | --root')
    return EXIT_USAGE
  }

  const hasParent = typeof opts.parent === 'string' && opts.parent.length > 0
  const hasRoot = Boolean(opts.root)
  if (hasParent && hasRoot) {
    console.error('Error: --parent and --root are mutually exclusive')
    return EXIT_USAGE
  }
  if (!hasParent && !hasRoot) {
    console.error('Error: specify --parent <doc> or --root')
    return EXIT_USAGE
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)

  const listUrl = `${trimTrailingSlash(apiUrl)}/api/documents`
  let listRes: Response
  try {
    listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    console.error(`Error: network failure: ${(err as Error).message}`)
    return 1
  }
  if (!listRes.ok) {
    const text = await listRes.text()
    console.error(errHttp('doc list', listRes.status, text))
    return 1
  }
  const { documents } = (await listRes.json()) as { documents: DocLike[] }

  const docMatch = resolveDoc(reference, documents)
  if (docMatch.kind === 'ambiguous') {
    console.error(
      `Error: title "${reference}" matches ${docMatch.candidates.length} docs:`
    )
    for (const c of docMatch.candidates) {
      console.error(`  ${docHandle(c.id, c.slug)}  ${sanitizeField(c.title)}`)
    }
    console.error('Re-run with the cuid.')
    return 1
  }
  if (docMatch.kind === 'not-found') {
    console.error(`Error: Document not found: ${reference}`)
    return 1
  }
  const docRow = documents.find(d => d.id === docMatch.doc.id)!

  let newParentId: string | null = null
  let parentTitleForOutput = 'root'
  if (hasParent) {
    const parentMatch = resolveDoc(opts.parent!, documents)
    if (parentMatch.kind === 'ambiguous') {
      console.error(
        `Error: --parent "${opts.parent}" matches ${parentMatch.candidates.length} docs:`
      )
      for (const c of parentMatch.candidates) {
        console.error(`  ${docHandle(c.id, c.slug)}  ${sanitizeField(c.title)}`)
      }
      console.error('Re-run with the cuid.')
      return 1
    }
    if (parentMatch.kind === 'not-found') {
      console.error(`Error: Document not found: ${opts.parent}`)
      return 1
    }
    const parentRow = documents.find(d => d.id === parentMatch.doc.id)!
    newParentId = parentRow.id
    parentTitleForOutput = `"${sanitizeField(parentRow.title).replace(/"/g, '\\"')}"`
  }

  const siblings = documents.filter(
    d => d.parentId === newParentId && d.id !== docRow.id
  )
  const sortOrder = pickNextSortOrder(siblings)

  const moveUrl = `${trimTrailingSlash(apiUrl)}/api/documents/${docRow.id}/move`
  let moveRes: Response
  try {
    moveRes = await fetch(moveUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parentId: newParentId, sortOrder }),
    })
  } catch (err) {
    console.error(`Error: network failure: ${(err as Error).message}`)
    return 1
  }
  if (!moveRes.ok) {
    const text = await moveRes.text()
    let msg = text
    try {
      const json = JSON.parse(text) as { error?: string }
      if (json.error) msg = json.error
    } catch {}
    console.error(errHttp('doc move', moveRes.status, msg))
    return 1
  }

  const escapedDocTitle = sanitizeField(docRow.title).replace(/"/g, '\\"')
  console.log(
    `Moved ${docHandle(docRow.id, docRow.slug)} "${escapedDocTitle}" → ${parentTitleForOutput}`
  )
}
