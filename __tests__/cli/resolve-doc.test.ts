import { resolveDoc, isLikelyCuid } from '@/cli/src/lib/resolve-doc'

describe('isLikelyCuid', () => {
  it('matches cuid v1 format (c + 24 chars)', () => {
    expect(isLikelyCuid('cmd12345678901234567890ab')).toBe(true)
  })
  it('rejects short or non-c-prefixed strings', () => {
    expect(isLikelyCuid('RFC: doc CLI')).toBe(false)
    expect(isLikelyCuid('abc')).toBe(false)
  })
})

describe('resolveDoc', () => {
  const docs = [
    { id: 'c1aaaaaaaaaaaaaaaaaaaaaaa', title: 'RFC: doc CLI' },
    { id: 'c2bbbbbbbbbbbbbbbbbbbbbbb', title: 'Roadmap' },
    { id: 'c3ccccccccccccccccccccccc', title: 'roadmap' },
  ]

  it('returns the doc with matching cuid', () => {
    const result = resolveDoc('c2bbbbbbbbbbbbbbbbbbbbbbb', docs)
    expect(result.kind).toBe('found')
    if (result.kind === 'found') expect(result.doc.title).toBe('Roadmap')
  })

  it('returns case-insensitive title match (single hit)', () => {
    const result = resolveDoc('rfc: DOC cli', docs)
    expect(result.kind).toBe('found')
  })

  it('reports ambiguous on multiple title matches', () => {
    const result = resolveDoc('roadmap', docs)
    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') expect(result.candidates).toHaveLength(2)
  })

  it('returns not-found when nothing matches', () => {
    const result = resolveDoc('nothing here', docs)
    expect(result.kind).toBe('not-found')
  })
})
