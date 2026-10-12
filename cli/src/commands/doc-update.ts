import { readCredentials } from '../lib/config'
import {
  extractErrorMessage,
  resolveAuthedApiUrl,
  trimTrailingSlash,
} from '../lib/api'
import {
  resolveDocContent,
  readStdinToString,
  readFileUtf8,
} from '../lib/doc-input'
import { normalizeScope } from './doc-create'
import { lookupDocId } from '../lib/resolve-doc-id'
import { resolveTagRefs } from '../lib/tag-resolver'
import { sanitizeField } from '../lib/sanitize'
import { errHttp, errNotLoggedIn } from '../lib/errors'

export interface UpdateDocOptions {
  title?: string
  content?: string
  file?: string
  scope?: string
  project?: string
  tag?: string[]
  tagId?: string[]
  addTag?: string[]
  addTagId?: string[]
  removeTag?: string[]
  removeTagId?: string[]
  /** Optimistic-concurrency precondition (LUM-409): revision from `doc show`. */
  ifRevision?: string
  /** Structure guard override (LUM-410): allow dropping tables/rows/headings. */
  allowShrink?: boolean
}

export function formatUpdatedDocLine(doc: {
  id: string
  title: string
  url: string
  tags?: string[]
}): string {
  const escaped = sanitizeField(doc.title).replace(/"/g, '\\"')
  const head = `Updated ${doc.id} "${escaped}"  ${doc.url}`
  if (doc.tags && doc.tags.length > 0) {
    return `${head}\nTags: ${doc.tags.map(sanitizeField).join(', ')}`
  }
  return head
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
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)

  // CLI-side mutex check: --tag/--tag-id (bulk replace) vs --add-tag/--add-tag-id/--remove-tag/--remove-tag-id (incremental)
  const hasBulk =
    (opts.tag && opts.tag.length > 0) || (opts.tagId && opts.tagId.length > 0)
  const hasIncremental =
    (opts.addTag && opts.addTag.length > 0) ||
    (opts.addTagId && opts.addTagId.length > 0) ||
    (opts.removeTag && opts.removeTag.length > 0) ||
    (opts.removeTagId && opts.removeTagId.length > 0)
  if (hasBulk && hasIncremental) {
    console.error(
      'Error: --tag/--tag-id are mutually exclusive with --add-tag/--add-tag-id/--remove-tag/--remove-tag-id'
    )
    return 1
  }

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

  if (opts.ifRevision !== undefined) {
    if (!/^\d+$/.test(opts.ifRevision)) {
      console.error(
        `Error: --if-revision must be a non-negative integer (got "${opts.ifRevision}")`
      )
      return 1
    }
    body.ifRevision = Number(opts.ifRevision)
  }
  if (opts.allowShrink) body.allowShrink = true

  // Resolve tag refs into ids
  const deps = { apiUrl, token: creds.token }
  let tagIds: string[] | undefined
  let addTagIds: string[] | undefined
  let removeTagIds: string[] | undefined
  try {
    if (hasBulk) {
      tagIds = await resolveTagRefs(
        { names: opts.tag ?? [], ids: opts.tagId ?? [] },
        deps
      )
    } else if (hasIncremental) {
      if (
        (opts.addTag && opts.addTag.length > 0) ||
        (opts.addTagId && opts.addTagId.length > 0)
      ) {
        addTagIds = await resolveTagRefs(
          { names: opts.addTag ?? [], ids: opts.addTagId ?? [] },
          deps
        )
      }
      if (
        (opts.removeTag && opts.removeTag.length > 0) ||
        (opts.removeTagId && opts.removeTagId.length > 0)
      ) {
        // NOTE: --remove-tag <unknown-name> creates the Tag via find-or-create, then
        // the detach is a no-op. Net effect: orphan Tag row. Acceptable v1 trade-off.
        removeTagIds = await resolveTagRefs(
          { names: opts.removeTag ?? [], ids: opts.removeTagId ?? [] },
          deps
        )
      }
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`)
    return 1
  }

  if (tagIds !== undefined) body.tagIds = tagIds
  if (addTagIds !== undefined) body.addTagIds = addTagIds
  if (removeTagIds !== undefined) body.removeTagIds = removeTagIds

  // --if-revision / --allow-shrink are modifiers, not fields — alone they
  // are not an update.
  if (
    Object.keys(body).filter(k => k !== 'ifRevision' && k !== 'allowShrink')
      .length === 0
  ) {
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
    const message = extractErrorMessage(text)
    if (res.status === 409 && opts.ifRevision !== undefined) {
      console.error(`Error: revision conflict: ${sanitizeField(message)}`)
      console.error(
        `Hint: re-read the doc (lumo doc show ${reference} --raw), rebase your edit ` +
          `on the current source, then retry with --if-revision <current>.`
      )
      return 1
    }
    if (res.status === 422) {
      // Structure guard rejection (LUM-410): the new body drops structure
      // the stored body has (the message names each category, old→new).
      console.error(`Error: ${sanitizeField(message)}`)
      console.error(
        `Hint: if the deletion is intentional, re-run with --allow-shrink. ` +
          `Otherwise re-read the current source (lumo doc show ${reference} --raw) ` +
          `and rebase your edit on it.`
      )
      return 1
    }
    console.error(errHttp('doc update', res.status, text))
    return 1
  }
  const { document } = (await res.json()) as {
    document: {
      id: string
      slug: string
      title: string
      docTags?: Array<{ name: string }>
    }
  }
  const docUrlStr = `${trimTrailingSlash(apiUrl)}/workspace/${creds.workspaceSlug ?? 'lumo'}/documents/${document.slug}`

  // Read tag names off the response (present when tags were changed)
  const responseTagNames =
    tagIds !== undefined ||
    addTagIds !== undefined ||
    removeTagIds !== undefined
      ? (document.docTags ?? []).map(t => t.name)
      : undefined

  const lineDoc: { id: string; title: string; url: string; tags?: string[] } = {
    id: document.id,
    title: document.title,
    url: docUrlStr,
  }
  if (responseTagNames !== undefined) lineDoc.tags = responseTagNames
  console.log(formatUpdatedDocLine(lineDoc))
}
