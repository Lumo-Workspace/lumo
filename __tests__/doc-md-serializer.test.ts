/**
 * @jest-environment node
 */
import {
  docStructureToMarkdown,
  rebuildSourceMarkdown,
} from '@/lib/utils/doc-structure-to-markdown'
// Reparse through the production renderer (markdown-it via markdown-tiptap) the
// document service actually stores through — the round-trip must hold for the
// real write path, not a second renderer.
import { markdownToHtml } from '@/lib/utils/markdown-tiptap'
import { htmlToMarkdown } from '@/lib/utils/html-to-markdown'
import { countPattern } from '@/lib/utils/html-structure'

const TABLE_PAT = /<table/g
const TR_PAT = /<tr/g
const HEADING_PAT = /<h[1-6][\s>]/g

/**
 * Tiptap-shaped stored body: headings + a multi-row table whose cells are
 * `<p>`-wrapped (Tiptap's serialization), plus a second table to stress a
 * multi-table registry — the LUM-349 / LUM-446 worst case. One cell contains a
 * literal pipe to exercise escaping.
 */
const REGISTRY_HTML = [
  '<h1>Ledger</h1>',
  '<p>Intro paragraph.</p>',
  '<h2>Entries</h2>',
  '<table><tbody>',
  '<tr><th><p>ID</p></th><th><p>Title</p></th><th><p>Status</p></th></tr>',
  '<tr><td><p>LUM-1</p></td><td><p>First</p></td><td><p>DONE</p></td></tr>',
  '<tr><td><p>LUM-2</p></td><td><p>Second | piped</p></td><td><p>OPEN</p></td></tr>',
  '</tbody></table>',
  '<h2>Appendix</h2>',
  '<table><tbody>',
  '<tr><th><p>Key</p></th><th><p>Value</p></th></tr>',
  '<tr><td><p>a</p></td><td><p>1</p></td></tr>',
  '</tbody></table>',
  '<p>Closing.</p>',
].join('\n')

describe('doc-md-serializer LUM-446', () => {
  test('doc-model to markdown serializer round-trips tables and headings', () => {
    const markdown = docStructureToMarkdown(REGISTRY_HTML)

    // The serializer must emit real GFM table syntax, not flattened prose.
    expect(markdown).toMatch(/\|\s*ID\s*\|/)
    expect(markdown).toMatch(/\|\s*-{3,}\s*\|/) // header separator row

    // Reparse through the SAME renderer the storage path uses, then assert the
    // guarded structure counts survived the round-trip with zero loss.
    const reparsed = markdownToHtml(markdown)

    const originalTables = countPattern(REGISTRY_HTML, TABLE_PAT)
    const originalTr = countPattern(REGISTRY_HTML, TR_PAT)
    const originalHeadings = countPattern(REGISTRY_HTML, HEADING_PAT)

    // Sanity: the fixture genuinely has the structure we claim to protect.
    expect(originalTables).toBe(2)
    expect(originalTr).toBe(5)
    expect(originalHeadings).toBe(3)

    expect(countPattern(reparsed, TABLE_PAT)).toBe(originalTables)
    expect(countPattern(reparsed, TR_PAT)).toBe(originalTr)
    expect(countPattern(reparsed, HEADING_PAT)).toBe(originalHeadings)

    // Cell content (including the escaped pipe) survives.
    expect(reparsed).toContain('Second')
    expect(reparsed).toContain('piped')
  })

  test('doc rebuild-source restores source and refuses on any structure shrink', () => {
    // Restores: the lossless serializer yields a valid markdown source that the
    // structure guard accepts (no throw), and it carries the table structure.
    const rebuilt = rebuildSourceMarkdown(REGISTRY_HTML)
    expect(typeof rebuilt).toBe('string')
    expect(rebuilt.length).toBeGreaterThan(0)
    expect(rebuilt).toMatch(/\|\s*-{3,}\s*\|/)
    expect(countPattern(markdownToHtml(rebuilt), TABLE_PAT)).toBe(2)

    // Refuses: plug in the legacy lossy serializer (plain turndown flattens
    // tables — LUM-349). The rebuild must NOT silently commit a flattened
    // source; the structure guard catches the table loss and throws 422.
    expect(() =>
      rebuildSourceMarkdown(REGISTRY_HTML, { serialize: htmlToMarkdown })
    ).toThrow(/structure/i)

    let status: number | undefined
    try {
      rebuildSourceMarkdown(REGISTRY_HTML, { serialize: htmlToMarkdown })
    } catch (err) {
      status = (err as { status?: number }).status
    }
    expect(status).toBe(422)

    // The shrink can still be forced through explicitly (allowShrink), mirroring
    // the LUM-410 --allow-shrink escape hatch.
    expect(() =>
      rebuildSourceMarkdown(REGISTRY_HTML, {
        serialize: htmlToMarkdown,
        allowShrink: true,
      })
    ).not.toThrow()
  })
})
