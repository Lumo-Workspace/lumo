import { removeFigmaLink, listFigmaLinks } from '../lib/figma-api'
import { sanitizeField } from '../lib/sanitize'

export async function taskFigmaRm(args: {
  identifier: string
  linkIdOrUrl: string
}): Promise<number> {
  const { links } = await listFigmaLinks(args.identifier)
  const match = links.find(
    l => l.id === args.linkIdOrUrl || l.url === args.linkIdOrUrl
  )
  if (!match) {
    console.log(`Not linked: ${args.linkIdOrUrl}`)
    return 0
  }
  await removeFigmaLink(args.identifier, match.id)
  const label = sanitizeField(
    match.frameName
      ? `${match.fileName} · ${match.frameName}`
      : `${match.fileName} (file-level)`
  )
  console.log(`Removed Figma link from ${args.identifier}: "${label}"`)
  return 0
}
