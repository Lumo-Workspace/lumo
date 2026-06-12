// @ts-ignore — turndown is CJS; bundler interop may wrap as { default }
import TurndownModule from 'turndown'
import { isHtml, htmlToMarkdown } from './html-to-markdown'
// Use the SAME markdown→HTML renderer the document service writes through
// (markdown-it via markdown-tiptap) so the rebuild guard's round-trip mirrors
// what `doc patch`/`append`/`update` will actually render the rebuilt source
// back to — not a second renderer that could diverge.
import { markdownToHtml } from './markdown-tiptap'
import { assertNoStructureShrink } from '@/lib/services/document-structure-guard'

/**
 * Lossless document-structure-model → markdown serializer (LUM-446).
 *
 * The default `doc show` markdown render (and the legacy `htmlToMarkdown`) is
 * best-effort: plain turndown has no table support, so a `<table>` is FLATTENED
 * to its mashed-together cell text (LUM-349). `doc show --raw` correctly refuses
 * to fall back to that lossy render — so once a doc's stored `sourceMarkdown` is
 * gone there is no safe rebuild path, and a table-heavy registry becomes
 * unrecoverable.
 *
 * This serializer closes that gap: it emits GFM pipe tables from the stored
 * HTML structure model so table / tr / heading round-trip through
 * `markdownToHtml` with zero structural loss. It is the engine behind
 * `lumo doc rebuild-source`.
 */

type TurndownNode = {
  nodeName: string
  parentNode: TurndownNode
  childNodes: ArrayLike<TurndownNode>
  firstChild: TurndownNode | null
  previousSibling: TurndownNode | null
  textContent: string
}
type TurndownInstance = {
  turndown(html: string): string
  addRule(
    key: string,
    rule: {
      filter: string | string[]
      replacement: (content: string, node: TurndownNode) => string
    }
  ): TurndownInstance
}
type TurndownCtor = new (options?: object) => TurndownInstance

const TurndownService: TurndownCtor =
  typeof TurndownModule === 'function'
    ? (TurndownModule as unknown as TurndownCtor)
    : (TurndownModule as unknown as { default: TurndownCtor }).default

/** The `th`/`td` element children of a row, skipping whitespace text nodes. */
function elementCells(row: TurndownNode): TurndownNode[] {
  return Array.prototype.filter.call(
    row.childNodes,
    (n: TurndownNode) => n.nodeName === 'TH' || n.nodeName === 'TD'
  ) as TurndownNode[]
}

/**
 * Collapse a cell's rendered markdown to a single table-safe line: GFM cells
 * are single-line, so block content (Tiptap wraps every cell in `<p>`) must be
 * flattened, and literal pipes escaped so they don't split the row.
 */
function cellMarkdown(content: string): string {
  return content
    .replace(/\\\n/g, ' ') // turndown hard-break backslashes
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
}

function createSerializer(): TurndownInstance {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })

  // Each cell carries its own pipe delimiters so the row rule can concatenate
  // them without losing cell boundaries (the row's `content` is the cells
  // joined with no separator).
  turndown.addRule('lumoTableCell', {
    filter: ['th', 'td'],
    replacement(content, node) {
      const cells = elementCells(node.parentNode)
      const isFirst = cells.indexOf(node) === 0
      return (isFirst ? '| ' : ' ') + cellMarkdown(content) + ' |'
    },
  })

  turndown.addRule('lumoTableRow', {
    filter: 'tr',
    replacement(content) {
      return '\n' + content.trim()
    },
  })

  turndown.addRule('lumoTableSection', {
    filter: ['thead', 'tbody', 'tfoot'],
    replacement: content => content,
  })

  // The table rule synthesizes the GFM header-separator row after the first
  // row. Treating the first row as the header is correct for Tiptap (which
  // always emits a header row) and is required regardless: a GFM table without
  // a separator is not parsed as a table, so the separator is what keeps
  // tables from collapsing on re-parse.
  turndown.addRule('lumoTable', {
    filter: 'table',
    replacement(content) {
      const rows = content
        .split('\n')
        .map(r => r.trimEnd())
        .filter(r => r.trim().length > 0)
      const headerRow = rows[0]
      if (headerRow === undefined) return ''
      // Count unescaped pipes in the header row → column count.
      const colCount = Math.max(
        (headerRow.match(/(?<!\\)\|/g)?.length ?? 2) - 1,
        1
      )
      const separator = '|' + ' --- |'.repeat(colCount)
      const withSeparator = [headerRow, separator, ...rows.slice(1)]
      return '\n\n' + withSeparator.join('\n') + '\n\n'
    },
  })

  return turndown
}

/**
 * Serialize a stored document body (HTML structure model) to markdown,
 * losslessly for tables / rows / headings. Non-HTML input is returned as-is
 * (it is already markdown), mirroring `htmlToMarkdown`'s short-circuit.
 */
export function docStructureToMarkdown(html: string): string {
  if (!isHtml(html)) return html
  const out = createSerializer().turndown(html)
  // Normalize the trailing whitespace to a single newline; structural fidelity
  // (not byte fidelity) is the contract, and a clean trailing newline keeps the
  // rebuilt source diff-friendly.
  return out.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n'
}

/**
 * Rebuild a document's markdown source from its stored HTML body, guarded by
 * the LUM-410 structure guard: the serialized markdown is re-rendered and
 * compared against the original body — if any table / tr / heading count shrank
 * (i.e. the serializer flattened something), the rebuild throws 422 instead of
 * silently committing a lossy source. `allowShrink` is the explicit escape
 * hatch; `serialize` is injectable so the guard itself can be exercised with a
 * deliberately lossy serializer.
 *
 * Pure (no I/O): the service method wraps this with the repository write.
 */
export function rebuildSourceMarkdown(
  contentHtml: string,
  opts: {
    allowShrink?: boolean | undefined
    serialize?: ((html: string) => string) | undefined
  } = {}
): string {
  const serialize = opts.serialize ?? docStructureToMarkdown
  const markdown = serialize(contentHtml)
  const reRendered = markdownToHtml(markdown)
  assertNoStructureShrink({
    oldHtml: contentHtml,
    newHtml: reRendered,
    scope: 'document',
    allowShrink: opts.allowShrink,
  })
  return markdown
}

// Re-exported so callers that already depend on the lossless serializer can
// reach the legacy lossy path (e.g. for comparison/guard tests) from one place.
export { htmlToMarkdown }
