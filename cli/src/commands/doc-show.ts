import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { tiptapToMarkdown } from '../lib/markdown-tiptap'
import { lookupDocId } from '../lib/resolve-doc-id'
import { sanitizeField } from '../lib/sanitize'

export interface ShowDocViewModel {
  id: string
  title: string
  scope: 'PRIVATE' | 'WORKSPACE' | 'SHARED'
  projectName: string | null
  createdAt: string
  updatedAt: string
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
    `Project: ${vm.projectName ? sanitizeField(vm.projectName) : '-'}`,
    `Created: ${vm.createdAt}`,
    `Updated: ${vm.updatedAt}`,
    `Mentioned tasks: ${vm.mentionedTasks.length ? vm.mentionedTasks.join(', ') : '-'}`,
  ]
  const header = lines.join('\n')
  return vm.bodyMarkdown ? `${header}\n\n${sanitizeField(vm.bodyMarkdown)}` : header
}

export interface ShowDocOptions {
  /** Print the byte-identical markdown source of the last markdown upload (LUM-408). */
  raw?: boolean
}

export async function docShow(
  reference: string | undefined,
  opts: ShowDocOptions = {}
): Promise<number | void> {
  if (!reference) {
    console.error('Error: missing <doc>. Usage: lumo doc show <doc> [--raw]')
    return 1
  }
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
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
    console.error(`Error: ${res.status} ${res.statusText}: ${sanitizeField(text)}`)
    return 1
  }
  // The exact shape of the GET response is not guaranteed; defensively unwrap.
  const data = (await res.json()) as {
    document?: {
      id: string
      title: string
      visibility?: 'PRIVATE' | 'WORKSPACE' | 'SHARED'
      content?: string | null
      contentMarkdown?: string | null
      sourceMarkdown?: string | null
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
  }
  const d = data.document
  if (!d) {
    console.error('Error: server returned an empty document response')
    return 1
  }
  if (opts.raw) {
    // Byte-identical markdown source of the last markdown upload (LUM-408).
    // Written verbatim (no header, no sanitization, no added newline) so the
    // output is a legal edit base: `doc show --raw > base.md` round-trips.
    // No silent fallback to the lossy HTML→markdown reverse render — that
    // fallback is exactly what flattened tables in LUM-349.
    if (typeof d.sourceMarkdown !== 'string') {
      console.error(
        `Error: ${d.id} has no stored markdown source (last edit was HTML-direct ` +
          `or predates markdown source storage). --raw refuses to fall back to the ` +
          `lossy HTML→markdown render. Rebuild a base instead: run \`lumo doc show ${d.id}\`, ` +
          `reconstruct the markdown faithfully, then \`lumo doc update ${d.id} --file <rebuilt.md>\` ` +
          `— from then on --raw works.`
      )
      return 1
    }
    process.stdout.write(d.sourceMarkdown)
    return
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

  console.log(
    formatShowOutput({
      id: d.id,
      title: d.title,
      scope: d.visibility ?? 'PRIVATE',
      projectName: d.project?.name ?? null,
      createdAt: d.createdAt ?? '',
      updatedAt: d.updatedAt ?? '',
      mentionedTasks,
      bodyMarkdown: body,
    })
  )
}
