import { NONE, fmtTimestamp } from '../lib/format'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { tiptapToMarkdown } from '../lib/markdown-tiptap'
import { extractSection, findSection } from '../lib/markdown-sections'
import { lookupDocId } from '../lib/resolve-doc-id'
import { sanitizeField } from '../lib/sanitize'
import { capRenderedOutput } from '../../../shared/src/output-budget'
import { errHttp, errNotLoggedIn } from '../lib/errors'

export interface ShowDocViewModel {
  id: string
  title: string
  scope: 'PRIVATE' | 'WORKSPACE' | 'SHARED'
  projectName: string | null
  createdAt: string
  updatedAt: string
  /** Body contentRevision (LUM-409); null when the server predates it. */
  revision: number | null
  mentionedTasks: string[]
  bodyMarkdown: string
}

function scopeLabel(s: ShowDocViewModel['scope']): string {
  if (s === 'PRIVATE') return 'personal'
  if (s === 'WORKSPACE') return 'workspace'
  return 'shared'
}

export function formatShowOutput(vm: ShowDocViewModel): string {
  const lines = [
    `ID: ${vm.id}`,
    `Title: ${sanitizeField(vm.title)}`,
    `Scope: ${scopeLabel(vm.scope)}`,
    `Project: ${vm.projectName ? sanitizeField(vm.projectName) : NONE}`,
    `Created: ${fmtTimestamp(vm.createdAt)}`,
    `Updated: ${fmtTimestamp(vm.updatedAt)}`,
    `Revision: ${vm.revision ?? '-'}`,
    `Mentioned tasks: ${vm.mentionedTasks.length ? vm.mentionedTasks.join(', ') : '-'}`,
  ]
  const header = lines.join('\n')
  if (!vm.bodyMarkdown) return header
  const full = `${header}\n\n${sanitizeField(vm.bodyMarkdown)}`
  // The *rendered* view is the only doc-show path with a budget (LUM-428): a
  // book-length doc would otherwise swallow the agent's context. The pointer
  // routes to the byte-faithful reads — `--section` for a just-in-time slice,
  // `--raw` for the whole source — which are NEVER capped (they are edit bases).
  return capRenderedOutput(full, {
    fetchHint:
      `read one section with: lumo doc show ${vm.id} --section "<heading>", ` +
      `or the full markdown source with: lumo doc show ${vm.id} --raw`,
    unitNoun: 'lines',
  }).text
}

export interface ShowDocOptions {
  /** Print the byte-identical markdown source of the last markdown upload (LUM-408). */
  raw?: boolean
  /** Print just one heading-addressed section of the markdown source (LUM-409). */
  section?: string
}

/** The document shape `GET /api/documents/:id` returns (defensively partial). */
export interface DocShowDocument {
  id: string
  title: string
  visibility?: 'PRIVATE' | 'WORKSPACE' | 'SHARED'
  content?: string | null
  contentMarkdown?: string | null
  sourceMarkdown?: string | null
  contentRevision?: number
  project?: { name?: string } | null
  createdAt?: string
  updatedAt?: string
  mentions?: {
    task?: {
      identifier?: string
      number?: number
      team?: { identifier?: string }
    }
  }[]
}

/**
 * What `doc show` will print, decided purely from the document data + flags —
 * no I/O. Splitting this out (SRP) makes the byte-faithful contract directly
 * unit-testable (LUM-428 criterion 3): `bytes` is the verbatim source / slice
 * and is NEVER routed through the output cap, whereas `rendered` is.
 */
export type DocShowOutput =
  | { kind: 'error'; message: string }
  | { kind: 'bytes'; text: string; revision: number | null }
  | { kind: 'rendered'; text: string }

export function selectDocShowOutput(
  d: DocShowDocument,
  opts: ShowDocOptions
): DocShowOutput {
  const revision =
    typeof d.contentRevision === 'number' ? d.contentRevision : null
  if (opts.raw) {
    // Byte-identical markdown source of the last markdown upload (LUM-408).
    // Written verbatim (no header, no sanitization, no added newline) so the
    // output is a legal edit base: `doc show --raw > base.md` round-trips.
    // No silent fallback to the lossy HTML→markdown reverse render — that
    // fallback is exactly what flattened tables in LUM-349.
    if (typeof d.sourceMarkdown !== 'string') {
      return {
        kind: 'error',
        message:
          `Error: ${d.id} has no stored markdown source (last edit was HTML-direct ` +
          `or predates markdown source storage). --raw refuses to fall back to the ` +
          `lossy HTML→markdown render. Rebuild a base instead: run \`lumo doc show ${d.id}\`, ` +
          `reconstruct the markdown faithfully, then \`lumo doc update ${d.id} --file <rebuilt.md>\` ` +
          `— from then on --raw works.`,
      }
    }
    return { kind: 'bytes', text: d.sourceMarkdown, revision }
  }
  if (opts.section !== undefined) {
    // Section reads slice the stored markdown source — same no-fallback rule
    // as --raw: a rendered-output slice would not be a legal edit base.
    if (typeof d.sourceMarkdown !== 'string') {
      return {
        kind: 'error',
        message:
          `Error: ${d.id} has no stored markdown source (last edit was HTML-direct ` +
          `or predates markdown source storage), so --section cannot slice it. ` +
          `Rebuild a base first: run \`lumo doc show ${d.id}\`, reconstruct the markdown ` +
          `faithfully, then \`lumo doc update ${d.id} --file <rebuilt.md>\`.`,
      }
    }
    const match = findSection(d.sourceMarkdown, opts.section)
    if (match.kind === 'not-found') {
      const list = match.available
        .slice(0, 30)
        .map(s => `  ${'#'.repeat(s.depth)} ${sanitizeField(s.heading)}`)
        .join('\n')
      return {
        kind: 'error',
        message: `Error: section not found: "${opts.section}". Available headings:\n${list || '  (none)'}`,
      }
    }
    if (match.kind === 'ambiguous') {
      const list = match.candidates
        .map(
          s =>
            `  ${'#'.repeat(s.depth)} ${sanitizeField(s.heading)} (line ${s.line + 1})`
        )
        .join('\n')
      return {
        kind: 'error',
        message:
          `Error: section "${opts.section}" is ambiguous — ${match.candidates.length} headings match:\n${list}\n` +
          `Disambiguate by depth, e.g. --section "${'#'.repeat(match.candidates[0]!.depth)} ${match.candidates[0]!.heading}"`,
      }
    }
    // Byte-faithful slice, verbatim (legal patch base).
    return {
      kind: 'bytes',
      text: extractSection(d.sourceMarkdown, match.section),
      revision,
    }
  }
  // Server returns `contentMarkdown` derived from the HTML body (LUM-83+).
  // Fall back to parsing the raw content as legacy Tiptap JSON for docs
  // written before the storage shape changed.
  let body = ''
  if (d.contentMarkdown) {
    body = d.contentMarkdown
  } else if (d.content) {
    try {
      body = tiptapToMarkdown(JSON.parse(d.content))
    } catch {
      body = ''
    }
  }
  // mentions may carry a flat identifier or a (team.identifier + number) shape.
  const mentionedTasks: string[] = (d.mentions ?? [])
    .map(m => {
      if (!m.task) return null
      if (m.task.identifier) return m.task.identifier
      if (m.task.team?.identifier && typeof m.task.number === 'number') {
        return `${m.task.team.identifier}-${m.task.number}`
      }
      return null
    })
    .filter((x): x is string => x !== null)

  return {
    kind: 'rendered',
    text: formatShowOutput({
      id: d.id,
      title: d.title,
      scope: d.visibility ?? 'PRIVATE',
      projectName: d.project?.name ?? null,
      createdAt: d.createdAt ?? '',
      updatedAt: d.updatedAt ?? '',
      revision,
      mentionedTasks,
      bodyMarkdown: body,
    }),
  }
}

export async function docShow(
  reference: string | undefined,
  opts: ShowDocOptions = {}
): Promise<number | void> {
  if (!reference) {
    console.error(
      'Error: missing <doc>. Usage: lumo doc show <doc> [--raw | --section <heading>]'
    )
    return 1
  }
  if (opts.raw && opts.section !== undefined) {
    console.error(
      'Error: --raw and --section are mutually exclusive (--raw prints the whole source)'
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

  const res = await fetch(`${trimTrailingSlash(apiUrl)}/api/documents/${id}`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(errHttp('doc show', res.status, text))
    return 1
  }
  // The exact shape of the GET response is not guaranteed; defensively unwrap.
  const data = (await res.json()) as { document?: DocShowDocument }
  const d = data.document
  if (!d) {
    console.error('Error: server returned an empty document response')
    return 1
  }

  const sel = selectDocShowOutput(d, opts)
  if (sel.kind === 'error') {
    console.error(sel.message)
    return 1
  }
  if (sel.kind === 'bytes') {
    // Byte-faithful read (--raw / --section): written verbatim, NEVER routed
    // through the output cap — it is a legal edit base for `doc patch`
    // (LUM-408/409/428). Revision goes to stderr so stdout stays byte-pure
    // while the agent still sees the number to pass back as --if-revision.
    process.stdout.write(sel.text)
    if (sel.revision !== null) {
      console.error(`Revision: ${sel.revision}`)
    }
    return
  }
  console.log(sel.text)
}
