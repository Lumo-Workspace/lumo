/**
 * @jest-environment node
 *
 * LUM-409 — heading-addressed section slicing. The splitter is the shared
 * contract between server-side patch/append and CLI `doc show --section`,
 * so its boundary semantics are pinned here byte-by-byte.
 */
import {
  listSections,
  findSection,
  extractSection,
  replaceSection,
  appendToSection,
  parseSectionQuery,
} from '@/lib/utils/markdown-sections'

const SRC = [
  '# Doc title',
  '',
  'intro paragraph',
  '',
  '## A',
  '',
  'a body',
  '',
  '## B',
  '',
  'b body',
  '',
  '### B.1',
  '',
  'b1 body',
  '',
  '## C',
  '',
  'c body',
  '',
].join('\n')

describe('listSections', () => {
  it('finds headings with offsets that slice the original source', () => {
    const sections = listSections(SRC)
    expect(sections.map(s => s.heading)).toEqual([
      'Doc title',
      'A',
      'B',
      'B.1',
      'C',
    ])
    for (const s of sections) {
      expect(SRC.slice(s.startOffset)).toMatch(
        new RegExp(`^#{${s.depth}} `)
      )
    }
  })

  it('a section runs until the next same-or-higher heading (subsections included)', () => {
    const sections = listSections(SRC)
    const b = sections.find(s => s.heading === 'B')!
    expect(extractSection(SRC, b)).toBe(
      ['## B', '', 'b body', '', '### B.1', '', 'b1 body', '', ''].join('\n')
    )
  })

  it('the last section runs to end of source', () => {
    const sections = listSections(SRC)
    const c = sections.find(s => s.heading === 'C')!
    expect(extractSection(SRC, c)).toBe('## C\n\nc body\n')
  })

  it('ignores # lines inside fenced code blocks', () => {
    const src = '## Real\n\n```md\n## Fake heading\n```\n\n## Next\n'
    expect(listSections(src).map(s => s.heading)).toEqual(['Real', 'Next'])
  })

  it('ignores headings nested in blockquotes', () => {
    const src = '## Real\n\n> ## Quoted\n\nbody\n'
    expect(listSections(src).map(s => s.heading)).toEqual(['Real'])
  })

  it('empty source has no sections', () => {
    expect(listSections('')).toEqual([])
  })
})

describe('parseSectionQuery / findSection', () => {
  it('plain text matches any depth', () => {
    const m = findSection(SRC, 'B.1')
    expect(m.kind).toBe('found')
    if (m.kind === 'found') expect(m.section.depth).toBe(3)
  })

  it('a leading #-run pins the depth', () => {
    expect(parseSectionQuery('## Status')).toEqual({
      text: 'Status',
      depth: 2,
    })
    const src = '# X\n\nbody\n\n## X\n\nnested\n'
    const m = findSection(src, '## X')
    expect(m.kind).toBe('found')
    if (m.kind === 'found') expect(m.section.depth).toBe(2)
  })

  it('exact match wins before the case-insensitive pass', () => {
    const src = '## status\n\na\n\n## Status\n\nb\n'
    const m = findSection(src, 'Status')
    expect(m.kind).toBe('found')
    if (m.kind === 'found') expect(m.section.heading).toBe('Status')
  })

  it('case-insensitive fallback finds a single differently-cased heading', () => {
    const m = findSection(SRC, 'doc title')
    expect(m.kind).toBe('found')
  })

  it('reports not-found with the available headings', () => {
    const m = findSection(SRC, 'Nope')
    expect(m.kind).toBe('not-found')
    if (m.kind === 'not-found') {
      expect(m.available.map(s => s.heading)).toContain('B.1')
    }
  })

  it('reports ambiguity instead of silently picking one', () => {
    const src = '## Dup\n\na\n\n## Dup\n\nb\n'
    const m = findSection(src, 'Dup')
    expect(m.kind).toBe('ambiguous')
    if (m.kind === 'ambiguous') expect(m.candidates).toHaveLength(2)
  })
})

describe('replaceSection', () => {
  it('replaces only the addressed section; outside bytes are identical', () => {
    const sections = listSections(SRC)
    const b = sections.find(s => s.heading === 'B')!
    const out = replaceSection(SRC, b, '## B\n\nnew b body\n')

    expect(out).toBe(
      SRC.slice(0, b.startOffset) + '## B\n\nnew b body\n\n' + SRC.slice(b.endOffset)
    )
    expect(out.startsWith(SRC.slice(0, b.startOffset))).toBe(true)
    expect(out.endsWith(SRC.slice(b.endOffset))).toBe(true)
    expect(out).not.toContain('### B.1') // subsection was part of the replaced span
  })

  it('pads the new block so the following heading keeps its own line', () => {
    const sections = listSections(SRC)
    const a = sections.find(s => s.heading === 'A')!
    const out = replaceSection(SRC, a, '## A\nno trailing newline')
    expect(out).toContain('no trailing newline\n\n## B')
  })

  it('replacing the last section needs no padding', () => {
    const sections = listSections(SRC)
    const c = sections.find(s => s.heading === 'C')!
    const out = replaceSection(SRC, c, '## C\n\nrewritten\n')
    expect(out).toBe(SRC.slice(0, c.startOffset) + '## C\n\nrewritten\n')
  })
})

describe('appendToSection', () => {
  it('inserts at section end without modifying any pre-existing byte', () => {
    const sections = listSections(SRC)
    const b = sections.find(s => s.heading === 'B')!
    const out = appendToSection(SRC, b, '- new log line\n')

    expect(out.startsWith(SRC.slice(0, b.endOffset))).toBe(true)
    expect(out.endsWith(SRC.slice(b.endOffset))).toBe(true)
    expect(out).toContain('b1 body\n\n- new log line\n\n## C')
  })

  it('null section appends at the document end', () => {
    const out = appendToSection(SRC, null, '## D\n\nd body')
    expect(out.startsWith(SRC)).toBe(true)
    // SRC ends with a single newline → one separator newline completes the
    // blank line before the appended block.
    expect(out).toBe(SRC + '\n## D\n\nd body\n')
  })

  it('adds separator newlines when the insertion point is not blank-line terminated', () => {
    const src = '## A\nbody' // no trailing newline at all
    const a = listSections(src)[0]!
    const out = appendToSection(src, a, 'tail')
    expect(out).toBe('## A\nbody\n\ntail\n')
  })

  it('appending empty content is a no-op', () => {
    expect(appendToSection(SRC, null, '\n\n')).toBe(SRC)
  })
})
