/**
 * @jest-environment node
 *
 * LUM-447 — section heading addressing gains a third match tier after
 * exact + case-insensitive: full-width↔half-width punctuation folding plus
 * whitespace collapsing. CJK headings carry full-width punctuation (（），)
 * that forced agents to grep the raw bytes and copy them verbatim; the
 * normalization tier lets a half-width `--section` query land on a
 * full-width stored heading (and the reverse) without weakening the
 * ambiguity guard.
 */
import { findSection } from '@/lib/utils/markdown-sections'

describe('section heading normalization (LUM-447)', () => {
  it('section addressing normalizes full and half width punctuation and whitespace', () => {
    // Stored heading uses full-width parens + comma; a half-width query lands on it.
    const fullWidthDoc = '# 问题（P4），细节\n\nbody\n'
    const halfWidthQuery = findSection(fullWidthDoc, '问题(P4),细节')
    expect(halfWidthQuery.kind).toBe('found')
    if (halfWidthQuery.kind === 'found') {
      expect(halfWidthQuery.section.heading).toBe('问题（P4），细节')
    }

    // Reverse: stored heading is half-width, a full-width query lands on it.
    const halfWidthDoc = '# 问题(P4),细节\n\nbody\n'
    const fullWidthQuery = findSection(halfWidthDoc, '问题（P4），细节')
    expect(fullWidthQuery.kind).toBe('found')
    if (fullWidthQuery.kind === 'found') {
      expect(fullWidthQuery.section.heading).toBe('问题(P4),细节')
    }

    // Whitespace folding: runs of spaces (incl. the full-width ideographic
    // space U+3000) collapse so a single-space query matches.
    const spacedDoc = '# A　 　B\n\nbody\n'
    const collapsedQuery = findSection(spacedDoc, 'A B')
    expect(collapsedQuery.kind).toBe('found')
    if (collapsedQuery.kind === 'found') {
      expect(collapsedQuery.section.heading).toBe('A　 　B')
    }
  })

  it('ambiguous normalized heading match still errors with candidates', () => {
    // Two headings differ only by punctuation width — both normalize to the
    // same form. A fully full-width query matches neither exactly nor
    // case-insensitively, yet must still report ambiguity rather than
    // silently picking one.
    const doc = '## A（x）\n\nfirst\n\n## A(x)\n\nsecond\n'
    const m = findSection(doc, 'Ａ（ｘ）')
    expect(m.kind).toBe('ambiguous')
    if (m.kind === 'ambiguous') {
      expect(m.candidates).toHaveLength(2)
      expect(m.candidates.map(s => s.heading)).toEqual(['A（x）', 'A(x)'])
    }
  })

  it('exact and case-insensitive matches still win before normalization', () => {
    // An exact match must not be shadowed by the normalization tier even when
    // a normalized-equivalent heading also exists.
    const doc = '## A(x)\n\nhalf\n\n## A（x）\n\nfull\n'
    const exact = findSection(doc, 'A(x)')
    expect(exact.kind).toBe('found')
    if (exact.kind === 'found') expect(exact.section.heading).toBe('A(x)')
  })
})
