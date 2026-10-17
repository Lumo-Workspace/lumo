import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import {
  resolveDocContent,
  readStdinToString,
  readFileUtf8,
} from '../lib/doc-input'
import { resolveTagRefs } from '../lib/tag-resolver'
import { lookupDocId } from '../lib/resolve-doc-id'
import { sanitizeField } from '../lib/sanitize'
import { errHttp, errNotLoggedIn, httpFailed, warn } from '../lib/errors'
import { docHandle } from '../lib/doc-handle'

export type Scope = 'PRIVATE' | 'WORKSPACE'

export interface CreateDocOptions {
  content?: string
  file?: string
  scope?: string
  project?: string
  task?: string
  tag?: string[]
  tagId?: string[]
  parent?: string
}

interface CreatedDocResponse {
  document: {
    id: string
    slug: string
    title: string
    docTags?: Array<{ id: string; name: string }>
  }
}

/** personal → PRIVATE, workspace → WORKSPACE. Null on unknown. */
export function normalizeScope(value: string): Scope | null {
  const lower = (value ?? '').toLowerCase()
  if (lower === 'personal') return 'PRIVATE'
  if (lower === 'workspace') return 'WORKSPACE'
  return null
}

export function formatCreatedDocLine(doc: {
  id: string
  /** LUM-1230: printed instead of the id. */
  slug?: string | null
  title: string
  url: string
  tags?: string[]
}): string {
  const escaped = sanitizeField(doc.title).replace(/"/g, '\\"')
  const head = `Created ${docHandle(doc.id, doc.slug)} "${escaped}"  ${doc.url}`
  if (doc.tags && doc.tags.length > 0) {
    return `${head}\nTags: ${doc.tags.map(sanitizeField).join(', ')}`
  }
  return head
}

function docUrl(apiUrl: string, workspaceSlug: string, id: string): string {
  return `${trimTrailingSlash(apiUrl)}/workspace/${workspaceSlug}/documents/${id}`
}

export async function docCreate(
  title: string | undefined,
  opts: CreateDocOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }

  let visibility: Scope = 'PRIVATE'
  if (opts.scope !== undefined) {
    const normalized = normalizeScope(opts.scope)
    if (!normalized) {
      console.error(
        `Error: invalid scope "${opts.scope}". Allowed: personal, workspace`
      )
      return 1
    }
    visibility = normalized
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

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const url = `${trimTrailingSlash(apiUrl)}/api/documents`

  let tagIds: string[] | undefined
  if (
    (opts.tag && opts.tag.length > 0) ||
    (opts.tagId && opts.tagId.length > 0)
  ) {
    try {
      tagIds = await resolveTagRefs(
        { names: opts.tag ?? [], ids: opts.tagId ?? [] },
        { apiUrl, token: creds.token }
      )
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`)
      return 1
    }
  }

  let resolvedParentId: string | undefined
  if (opts.parent !== undefined && opts.parent.length > 0) {
    const id = await lookupDocId(apiUrl, creds.token, opts.parent)
    if (!id) {
      console.error(`Error: --parent doc not found: ${opts.parent}`)
      return 1
    }
    resolvedParentId = id
  }

  const body: Record<string, unknown> = {
    title: title?.trim() ?? '',
    visibility,
  }
  if (content.kind === 'ok') body.contentMarkdown = content.markdown
  if (opts.project !== undefined) body.projectRef = opts.project
  if (tagIds && tagIds.length > 0) body.tagIds = tagIds
  if (resolvedParentId !== undefined) body.parentId = resolvedParentId

  let res: Response
  try {
    res = await fetch(url, {
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
    console.error(errHttp('doc create', res.status, text))
    return 1
  }

  const { document } = (await res.json()) as CreatedDocResponse
  const fullUrl = docUrl(apiUrl, creds.workspaceSlug ?? 'lumo', document.slug)
  const responseTagNames = (document.docTags ?? []).map(t => t.name)
  console.log(
    formatCreatedDocLine({
      id: document.id,
      slug: document.slug,
      title: document.title,
      url: fullUrl,
      tags: responseTagNames,
    })
  )

  if (opts.task) {
    const bindUrl = `${trimTrailingSlash(apiUrl)}/api/documents/${document.id}/mentions`
    const bindRes = await fetch(bindUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ taskIdentifier: opts.task }),
    })
    if (!bindRes.ok) {
      const text = await bindRes.text()
      console.error(
        warn(
          `doc created but ${httpFailed(`bind to ${opts.task}`, bindRes.status, text)}`
        )
      )
      return 1
    }
    console.log(`Bound ${docHandle(document.id, document.slug)} ↔ ${opts.task}`)
  }
}
