import { readCredentials } from '../lib/config'
import {
  extractErrorMessage,
  resolveAuthedApiUrl,
  trimTrailingSlash,
} from '../lib/api'
import { lookupDocId } from '../lib/resolve-doc-id'
import { sanitizeField } from '../lib/sanitize'
import { emitConfirmation, type ConfirmFlags } from '../lib/confirmation'

export interface DocRebuildSourceOptions extends ConfirmFlags {
  allowShrink?: boolean
  force?: boolean
  ifRevision?: string
}

/**
 * `lumo doc rebuild-source <doc>` (LUM-446).
 *
 * Recovery path for a source-less doc: regenerates `Document.sourceMarkdown`
 * from the stored HTML body using the lossless serializer (tables round-trip),
 * re-enabling `doc show --raw` / `diff` / `patch` / `append`. The rebuilt source
 * is structure-guarded server-side: any table/tr/heading shrink is rejected 422
 * (zero silent flattening — LUM-410 口径) unless --allow-shrink is passed. A doc
 * that already has a source is refused 409 unless --force re-derives it —
 * that refusal is surfaced as a confirmation envelope (LUM-755): exit 4 with
 * the server's reason and a confirmCommand carrying `--force --confirm`.
 */
export async function docRebuildSource(
  reference: string | undefined,
  opts: DocRebuildSourceOptions
): Promise<number | void> {
  if (!reference) {
    console.error(
      'Error: missing <doc>. Usage: lumo doc rebuild-source <doc> [--allow-shrink] [--force] [--if-revision <n>]'
    )
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

  const body: Record<string, unknown> = {}
  if (opts.allowShrink) body.allowShrink = true
  if (opts.force) body.force = true
  if (ifRevision !== undefined) body.ifRevision = ifRevision

  const res = await fetch(
    `${trimTrailingSlash(apiUrl)}/api/documents/${id}/rebuild-source`,
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
    if (res.status === 409 && !opts.force) {
      // The --force gate: nothing was written. Hand back the protocol
      // envelope so the agent shows the user what --force would replace.
      return emitConfirmation({
        command: 'doc rebuild-source',
        changes: [
          sanitizeField(message),
          `Will replace the existing (byte-faithful) markdown source of ${id} with a freshly serialized one — inspect it first with \`lumo doc show ${reference} --raw\``,
        ],
        extraFlags: ['--force'],
      })
    }
    if (res.status === 409) {
      console.error(`Error: ${sanitizeField(message)}`)
      return 1
    }
    if (res.status === 422) {
      // Structure guard rejection (LUM-410): the serializer would drop
      // structure the stored body has — refuse rather than commit a flattened
      // source.
      console.error(`Error: ${sanitizeField(message)}`)
      console.error(
        'Hint: this means the rebuild could not reproduce the stored structure ' +
          'losslessly. Re-run with --allow-shrink only if the loss is acceptable.'
      )
      return 1
    }
    console.error(
      `Error: ${res.status} ${res.statusText}: ${sanitizeField(message)}`
    )
    return 1
  }

  const { document } = (await res.json()) as {
    document: {
      id: string
      title: string
      contentRevision?: number
      sourceBytes?: number
    }
  }
  const escaped = sanitizeField(document.title).replace(/"/g, '\\"')
  const bytes =
    typeof document.sourceBytes === 'number'
      ? ` (${document.sourceBytes} bytes)`
      : ''
  console.log(
    `Rebuilt markdown source for ${document.id} "${escaped}"${bytes}. ` +
      `\`lumo doc show ${document.id} --raw\` now works.`
  )
}
