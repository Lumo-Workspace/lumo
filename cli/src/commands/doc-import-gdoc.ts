import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { errHttp, errNotLoggedIn, httpFailed, warn } from '../lib/errors'

export interface ImportGdocOptions {
  scope?: string
  task?: string
}

interface ImportedDocResponse {
  document: { id: string; slug: string; title: string }
}

export function formatImportedLine(doc: {
  id: string
  title: string
  url: string
}): string {
  const escaped = sanitizeField(doc.title).replace(/"/g, '\\"')
  return (
    `Imported ${doc.id} "${escaped}"  ${doc.url}\n` +
    warn(
      'imported content follows Lumo sharing and is no longer gated by Google permissions.'
    )
  )
}

function normalizeScope(
  value: string | undefined
): 'PRIVATE' | 'WORKSPACE' | undefined {
  if (value === undefined) return undefined
  const lower = value.toLowerCase()
  if (lower === 'personal') return 'PRIVATE'
  if (lower === 'workspace') return 'WORKSPACE'
  return undefined
}

export async function docImportGdoc(
  url: string,
  opts: ImportGdocOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  if (!url || url.trim().length === 0) {
    console.error('Error: a Google Doc URL or id is required.')
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  const body: Record<string, unknown> = { url: url.trim() }
  const scope = normalizeScope(opts.scope)
  if (scope) body.visibility = scope

  let res: Response
  try {
    res = await fetch(`${base}/api/documents/import-google`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error(`Error: network failure: ${(err as Error).message}`)
    return 1
  }
  if (!res.ok) {
    const text = await res.text()
    console.error(errHttp('doc import-gdoc', res.status, text))
    return 1
  }

  const { document } = (await res.json()) as ImportedDocResponse
  const fullUrl = `${base}/workspace/${creds.workspaceSlug ?? 'lumo'}/documents/${document.slug}`
  console.log(
    formatImportedLine({
      id: document.id,
      title: document.title,
      url: fullUrl,
    })
  )

  if (opts.task) {
    const bindRes = await fetch(
      `${base}/api/documents/${document.id}/mentions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ taskIdentifier: opts.task }),
      }
    )
    if (!bindRes.ok) {
      const text = await bindRes.text()
      console.error(
        warn(
          `imported but ${httpFailed(`bind to ${opts.task}`, bindRes.status, text)}`
        )
      )
      return 1
    }
    console.log(`Bound ${document.id} ↔ ${opts.task}`)
  }
}
