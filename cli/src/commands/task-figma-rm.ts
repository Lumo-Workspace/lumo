import { removeFigmaLink, listFigmaLinks } from '../lib/figma-api'
import { sanitizeField } from '../lib/sanitize'
import { matchRef, refMatchError } from '../../../shared/src/short-ref'

export async function taskFigmaRm(args: {
  identifier: string
  linkIdOrUrl: string
}): Promise<number> {
  const { links } = await listFigmaLinks(args.identifier)
  // LUM-1230: the URL, the 8-char short ref `figma list` prints, a unique id
  // prefix or the full id. An ambiguous ref removes nothing.
  const byUrl = links.find(l => l.url === args.linkIdOrUrl)
  const picked = byUrl
    ? ({ kind: 'found', item: byUrl } as const)
    : matchRef(args.linkIdOrUrl, links, l => l.id)
  if (picked.kind === 'ambiguous' || picked.kind === 'too-short') {
    console.error(
      `Error: ${sanitizeField(refMatchError('Figma link', args.linkIdOrUrl, picked, l => l.id))}`
    )
    return 1
  }
  if (picked.kind === 'not-found') {
    console.log(`Not linked: ${sanitizeField(args.linkIdOrUrl)}`)
    return 0
  }
  const match = picked.item
  await removeFigmaLink(args.identifier, match.id)
  const label = sanitizeField(
    match.frameName
      ? `${match.fileName} · ${match.frameName}`
      : `${match.fileName} (file-level)`
  )
  console.log(`Removed Figma link from ${args.identifier}: "${label}"`)
  return 0
}
