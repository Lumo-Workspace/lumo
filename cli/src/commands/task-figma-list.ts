import { emptyState, fmtDay } from '../lib/format'
import { listFigmaLinks, type FigmaLinkJson } from '../lib/figma-api'
import { sanitizeField } from '../lib/sanitize'
import { shortRef } from '../../../shared/src/short-ref'
import { renderListTable, type ListRenderOptions } from '../lib/list-table'
import { emitJson, listEnvelope, stripInternalFields } from '../lib/json-output'

const STALE_MS = 25 * 24 * 3600 * 1000

type FigmaListLink = Pick<
  FigmaLinkJson,
  | 'id'
  | 'fileName'
  | 'frameName'
  | 'lastSyncedAt'
  | 'thumbnailUrl'
  | 'thumbnailFetchedAt'
>

/**
 * LUM-1089: `<id>  <file>  <frame>  <synced>  [⚠ thumbnail stale]` as a table
 * (header on a TTY only; the frame name is cut to the terminal width there).
 */
export function formatFigmaList(
  links: FigmaListLink[],
  now: number,
  opts: ListRenderOptions = {}
): string {
  const rows = links.map(link => {
    const stale =
      link.thumbnailFetchedAt === null ||
      now - new Date(link.thumbnailFetchedAt).getTime() > STALE_MS
    return [
      // LUM-1230: the 8-char short ref `figma show` / `figma remove` take.
      shortRef(link.id),
      sanitizeField(link.fileName),
      sanitizeField(link.frameName ?? '(file-level)'),
      fmtDay(link.lastSyncedAt),
      stale && !!link.thumbnailUrl ? '⚠ thumbnail stale' : '',
    ]
  })
  const header = ['REF', 'FILE', 'FRAME', 'SYNCED']
  if (rows.some(r => r[4])) header.push('NOTE')
  return renderListTable(rows, { header, flex: 2, ...opts })
}

export async function taskFigmaList(args: {
  identifier: string
  json?: boolean | undefined
}): Promise<number> {
  const { links } = await listFigmaLinks(args.identifier)
  if (args.json) {
    emitJson(listEnvelope('figmaLinks', stripInternalFields(links)))
    return 0
  }
  if (links.length === 0) {
    console.log(emptyState('Figma links', args.identifier))
    return 0
  }
  console.log(formatFigmaList(links, Date.now()))
  return 0
}
