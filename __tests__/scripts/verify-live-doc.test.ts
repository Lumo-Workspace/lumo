import { markdownToHtml } from '@/shared/src/markdown-tiptap'
import {
  compareStructure,
  countPattern,
  hardMismatches,
  softMismatches,
} from '@/scripts/verify-live-doc'

const TWO_TABLE_MARKDOWN = `# Doc

| 任务 | 状态 |
| --- | --- |
| [LUM-1](https://example.com/LUM-1) | **DONE** |
| LUM-2 | TODO |

Prose between tables.

| A | B | C |
| --- | --- | --- |
| 1 | \`code\` | 2 |
`

describe('countPattern', () => {
  it('counts tag occurrences', () => {
    expect(countPattern('<table><tr></tr><tr></tr></table>', /<tr/g)).toBe(2)
    expect(countPattern('no tables here', /<table/g)).toBe(0)
  })
})

describe('markdownToHtml table round-trip (forward path)', () => {
  // The whole LUM-349 prevention scheme rests on the forward path
  // (markdown → HTML) preserving GFM pipe tables. Guard it.
  it('renders GFM pipe tables to <table> structure', () => {
    const html = markdownToHtml(TWO_TABLE_MARKDOWN)
    expect(countPattern(html, /<table/g)).toBe(2)
    // table 1: header + 2 rows; table 2: header + 1 row
    expect(countPattern(html, /<tr/g)).toBe(5)
  })

  it('preserves inline marks inside cells', () => {
    const html = markdownToHtml(TWO_TABLE_MARKDOWN)
    expect(html).toContain('<strong>DONE</strong>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('href="https://example.com/LUM-1"')
  })
})

describe('compareStructure', () => {
  const rendered = markdownToHtml(TWO_TABLE_MARKDOWN)

  it('reports all-equal when stored matches the rendered source', () => {
    const checks = compareStructure(rendered, rendered)
    expect(hardMismatches(checks)).toEqual([])
    expect(softMismatches(checks)).toEqual([])
  })

  it('flags flattened tables as hard mismatches', () => {
    // Simulate the doc-show round-trip accident: tables degraded to
    // one-cell-per-paragraph plain text.
    const flattened = rendered.replace(
      /<table[\s\S]*?<\/table>/g,
      '<p>cell</p>'
    )
    const checks = compareStructure(rendered, flattened)
    const hard = hardMismatches(checks)
    expect(hard.map(c => c.tag).sort()).toEqual(['table', 'tr'])
    const table = hard.find(c => c.tag === 'table')
    expect(table).toMatchObject({ rendered: 2, stored: 0 })
  })

  it('reports prose drift as soft, not hard', () => {
    const editedProse = rendered + '<h2>web-ui addition</h2>'
    const checks = compareStructure(rendered, editedProse)
    expect(hardMismatches(checks)).toEqual([])
    expect(softMismatches(checks).map(c => c.tag)).toEqual(['h2'])
  })
})
