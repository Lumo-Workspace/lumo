import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { lookupDocId } from '../lib/resolve-doc-id'
import { sanitizeField } from '../lib/sanitize'
import { readFileUtf8, unreadableFileMessage } from '../lib/doc-input'
import { checkArtifactFilePath } from '../lib/path-guard'
import { formatUnifiedDiff } from '../lib/unified-diff'
import { errHttp, errNotLoggedIn } from '../lib/errors'
import { docHandle } from '../lib/doc-handle'

export interface DocDiffOptions {
  file?: string
}

/**
 * `lumo doc diff <doc> --file <local.md>` (LUM-408).
 *
 * Compares the server-side markdown source (Document.sourceMarkdown — the
 * byte-identical last markdown upload) against a local file, so a
 * remote/local split-brain is visible on demand instead of discovered from
 * memory after a stale upload clobbers someone's edit.
 *
 * Exit codes: 0 = sources byte-identical, 1 = divergent (or error).
 */
export async function docDiff(
  reference: string | undefined,
  opts: DocDiffOptions
): Promise<number | void> {
  if (!reference) {
    console.error(
      'Error: missing <doc>. Usage: lumo doc diff <doc> --file <local.md>'
    )
    return EXIT_USAGE
  }
  if (!opts.file) {
    console.error('Error: --file <local.md> is required for doc diff')
    return EXIT_USAGE
  }
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)

  // Same sandbox as doc create/update --file: project-local, non-sensitive.
  const check = checkArtifactFilePath(opts.file)
  if (!check.ok) {
    console.error(
      check.reason === 'unreadable'
        ? `Error: ${unreadableFileMessage(opts.file)}`
        : `Error: refusing to read ${opts.file} — ${check.detail}. ` +
            `--file must be a non-sensitive path inside the project directory.`
    )
    return 1
  }
  const localText = await readFileUtf8(check.resolved)

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
    console.error(errHttp('doc fetch', res.status, text))
    return 1
  }
  const data = (await res.json()) as {
    document?: {
      id: string
      slug?: string | null
      sourceMarkdown?: string | null
    }
  }
  const d = data.document
  if (!d) {
    console.error('Error: server returned an empty document response')
    return 1
  }
  if (typeof d.sourceMarkdown !== 'string') {
    console.error(
      `Error: ${docHandle(d.id, d.slug)} has no stored markdown source to diff against (last edit ` +
        `was HTML-direct or predates markdown source storage). Upload a markdown ` +
        `base once (\`lumo doc update ${docHandle(d.id, d.slug)} --file <base.md>\`) and diff from then on.`
    )
    return 1
  }

  if (d.sourceMarkdown === localText) {
    console.log(
      `Clean: remote markdown source of ${docHandle(d.id, d.slug)} matches ${opts.file} (${Buffer.byteLength(localText, 'utf8')} bytes)`
    )
    return
  }

  const diff = formatUnifiedDiff(
    d.sourceMarkdown,
    localText,
    `remote/${docHandle(d.id, d.slug)} (sourceMarkdown)`,
    `local/${opts.file}`
  )
  // Byte-level divergence with identical line sequences (e.g. trailing
  // newline only) still counts as divergent — say so explicitly.
  console.log(
    diff !== ''
      ? sanitizeField(diff)
      : `Divergent: byte-level difference only (e.g. trailing newline) between remote ${docHandle(d.id, d.slug)} and ${opts.file}`
  )
  return 1
}
