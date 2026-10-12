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
import { lookupDocId } from '../lib/resolve-doc-id'
import { sanitizeField } from '../lib/sanitize'
import { errHttp, errNotLoggedIn } from '../lib/errors'

/**
 * `lumo doc patch` / `lumo doc append` (LUM-409) — section-addressed writes.
 *
 * patch  --section <heading>  replaces the whole addressed section (heading
 *                             line included) with the provided content.
 * append [--section <heading>] inserts the content at the end of the section
 *                             (before the next same-or-higher heading); with
 *                             no --section it appends at the document end.
 *
 * Both splice server-side into the stored markdown source and commit
 * conditionally on the body revision: a concurrent edit returns 409 instead
 * of being silently overwritten. Pass --if-revision <n> (from `doc show`)
 * to also pin the edit base you read.
 */
export interface DocSectionEditOptions {
  section?: string
  content?: string
  file?: string
  ifRevision?: string
  /**
   * Structure guard override (LUM-410): allow a patch that drops
   * tables/rows/headings within the addressed section. Only `doc patch`
   * registers the flag — appends are pure insertion and never guarded.
   */
  allowShrink?: boolean
}

export function formatSectionEditLine(args: {
  verb: 'Patched' | 'Appended to'
  id: string
  title: string
  sectionHeading: string | null
  revision: number | null
}): string {
  const escaped = sanitizeField(args.title).replace(/"/g, '\\"')
  const target = args.sectionHeading
    ? ` § "${sanitizeField(args.sectionHeading)}"`
    : ' (document end)'
  const rev = args.revision !== null ? `  revision ${args.revision}` : ''
  return `${args.verb} ${args.id} "${escaped}"${target}${rev}`
}

async function docSectionEdit(
  mode: 'replace' | 'append',
  reference: string | undefined,
  opts: DocSectionEditOptions
): Promise<number | void> {
  const cmd = mode === 'replace' ? 'patch' : 'append'
  if (!reference) {
    console.error(
      `Error: missing <doc>. Usage: lumo doc ${cmd} <doc> ${
        mode === 'replace' ? '--section <heading>' : '[--section <heading>]'
      } [--content <md> | --file <path> | stdin] [--if-revision <n>]`
    )
    return 1
  }
  if (mode === 'replace' && (!opts.section || opts.section.trim() === '')) {
    console.error('Error: --section <heading> is required for doc patch')
    return 1
  }

  let ifRevision: number | undefined
  if (opts.ifRevision !== undefined) {
    if (!/^\d+$/.test(opts.ifRevision)) {
      console.error(
        `Error: --if-revision must be a non-negative integer (got "${opts.ifRevision}")`
      )
      return 1
    }
    ifRevision = Number(opts.ifRevision)
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
  if (content.kind === 'none') {
    console.error(
      `Error: doc ${cmd} needs content — pass --content, --file, or pipe stdin`
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)

  const id = await lookupDocId(apiUrl, creds.token, reference)
  if (!id) {
    console.error(`Error: Document not found: ${reference}`)
    return 1
  }

  const body: Record<string, unknown> = {
    mode,
    contentMarkdown: content.markdown,
  }
  if (opts.section !== undefined && opts.section.trim() !== '') {
    body.section = opts.section
  }
  if (ifRevision !== undefined) body.ifRevision = ifRevision
  if (opts.allowShrink) body.allowShrink = true

  const res = await fetch(
    `${trimTrailingSlash(apiUrl)}/api/documents/${id}/section`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    const message = extractErrorMessage(text)
    if (res.status === 409) {
      console.error(`Error: revision conflict: ${sanitizeField(message)}`)
      console.error(
        `Hint: re-read the section (lumo doc show ${reference}${
          opts.section ? ` --section "${opts.section}"` : ''
        }), rebase your edit on it, then retry with --if-revision <current>.`
      )
      return 1
    }
    if (res.status === 422) {
      // Structure guard rejection (LUM-410): the replacement drops structure
      // the addressed section has (the message names each category, old→new).
      console.error(`Error: ${sanitizeField(message)}`)
      console.error(
        `Hint: if the deletion is intentional, re-run with --allow-shrink. ` +
          `Otherwise re-read the section (lumo doc show ${reference}${
            opts.section ? ` --section "${opts.section}"` : ''
          }) and rebase your edit on it.`
      )
      return 1
    }
    console.error(errHttp('doc section edit', res.status, message))
    return 1
  }

  const { document } = (await res.json()) as {
    document: {
      id: string
      title: string
      contentRevision?: number
      sectionHeading?: string | null
    }
  }
  console.log(
    formatSectionEditLine({
      verb: mode === 'replace' ? 'Patched' : 'Appended to',
      id: document.id,
      title: document.title,
      sectionHeading: document.sectionHeading ?? opts.section ?? null,
      revision:
        typeof document.contentRevision === 'number'
          ? document.contentRevision
          : null,
    })
  )
}

export function docPatch(
  reference: string | undefined,
  opts: DocSectionEditOptions
): Promise<number | void> {
  return docSectionEdit('replace', reference, opts)
}

export function docAppend(
  reference: string | undefined,
  opts: DocSectionEditOptions
): Promise<number | void> {
  return docSectionEdit('append', reference, opts)
}
