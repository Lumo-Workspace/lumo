import { addFigmaLink } from '../lib/figma-api'
import { sanitizeField } from '../lib/sanitize'

interface Args {
  identifier: string
  url: string
}

export async function taskFigmaAdd(args: Args): Promise<number> {
  try {
    const { link } = await addFigmaLink(args.identifier, args.url)
    const label = sanitizeField(
      link.frameName
        ? `${link.fileName} · ${link.frameName}`
        : `${link.fileName}${link.nodeId === '' ? ' (file-level)' : ''}`
    )
    console.log(`Linked ${args.identifier} ↔ Figma "${label}"`)
    console.log(`  ${link.url}`)
    return 0
  } catch (e) {
    const err = e as { code?: string; message?: string }
    if (err.code === 'figma_not_connected') {
      console.error(`✗ You haven't connected Figma yet.`)
      console.error(`  Run: open https://www.uselumo.ai/settings/integrations`)
      return 1
    }
    if (err.code === 'figma_needs_reauth') {
      console.error(`✗ Your Figma token is no longer valid. Please reconnect.`)
      console.error(`  Run: open https://www.uselumo.ai/settings/integrations`)
      return 1
    }
    throw e // let wrap() in cli/src/index.ts log and exit 1
  }
}
