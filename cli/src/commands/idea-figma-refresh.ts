import {
  refreshIdeaFigmaLinks,
  listIdeaFigmaLinks,
} from '../lib/idea-figma-api'
import { sanitizeField } from '../lib/sanitize'

export async function ideaFigmaRefresh(args: {
  identifier: string
}): Promise<number> {
  try {
    const { links } = await listIdeaFigmaLinks(args.identifier)
    const byId = new Map(links.map(l => [l.id, l]))

    const { results } = await refreshIdeaFigmaLinks(args.identifier)
    if (results.length === 0) {
      console.log(`No Figma links attached to ${args.identifier}.`)
      return 0
    }
    console.log(`Refreshed ${results.length} Figma links on ${args.identifier}`)
    for (const r of results) {
      const link = byId.get(r.id)
      const label = link
        ? sanitizeField(
            link.frameName
              ? `${link.fileName} · ${link.frameName}`
              : `${link.fileName} (file-level)`
          )
        : r.id
      if (r.ok) console.log(`  ✓ ${label}`)
      else console.log(`  ✗ ${label} (${sanitizeField(r.error ?? '')})`)
    }
    return 0
  } catch (e) {
    const err = e as { code?: string }
    if (
      err.code === 'figma_not_connected' ||
      err.code === 'figma_needs_reauth'
    ) {
      console.error(`✗ Figma is not connected (or token expired). Reconnect:`)
      console.error(`  open https://www.uselumo.ai/settings/integrations`)
      return 1
    }
    throw e
  }
}
