import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import {
  resolveDocContent,
  readStdinToString,
  readFileUtf8,
} from '../lib/doc-input'
import { normalizeScope } from './doc-create'
import { resolveDoc, isLikelyCuid } from '../lib/resolve-doc'

export interface UpdateDocOptions {
  title?: string
  content?: string
  file?: string
  scope?: string
  project?: string
}

export function formatUpdatedDocLine(doc: {
  id: string
  title: string
  url: string
}): string {
  const escaped = doc.title.replace(/"/g, '\\"')
  return `Updated ${doc.id} "${escaped}"  ${doc.url}`
}

async function lookupDocId(
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

export async function docUpdate(
  reference: string | undefined,
  opts: UpdateDocOptions
): Promise<number | void> {
  if (!reference) {
    console.error('Error: missing <doc>. Usage: lumo doc update <doc> [flags]')
    return 1
  }
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl

  const id = await lookupDocId(apiUrl, creds.token, reference)
  if (!id) {
    console.error(`Error: Document not found: ${reference}`)
    return 1
  }

  const body: Record<string, unknown> = {}
  if (opts.title !== undefined) {
    if (opts.title.trim().length === 0) {
      console.error('Error: --title cannot be empty')
      return 1
    }
    body.title = opts.title.trim()
  }
  if (opts.scope !== undefined) {
    const v = normalizeScope(opts.scope)
    if (!v) {
      console.error(
        `Error: invalid scope "${opts.scope}". Allowed: personal, workspace`
      )
      return 1
    }
    body.visibility = v
  }
  if (opts.project !== undefined) {
    body.projectRef = opts.project === '' ? null : opts.project
  }

  const content = await resolveDocContent({
    content: opts.content,
    file: opts.file,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    readStdin: readStdinToString,
    readFile: readFileUtf8,
  })
  if (content.kind === 'error') {
    console.error(`Error: ${content.message}`)
    return 1
  }
  if (content.kind === 'ok') body.contentMarkdown = content.markdown

  if (Object.keys(body).length === 0) {
    console.error('Error: no fields to update — provide at least one flag')
    return 1
  }

  const url = `${trimTrailingSlash(apiUrl)}/api/documents/${id}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(`Error: ${res.status} ${res.statusText}: ${text}`)
    return 1
  }
  const { document } = (await res.json()) as {
    document: { id: string; title: string }
  }
  const docUrlStr = `${trimTrailingSlash(apiUrl)}/workspace/${creds.workspaceSlug ?? 'lumo'}/documents/${document.id}`
  console.log(
    formatUpdatedDocLine({ id: document.id, title: document.title, url: docUrlStr })
  )
}
