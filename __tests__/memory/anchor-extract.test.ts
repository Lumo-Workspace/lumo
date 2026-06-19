import { extractAnchors } from '../../shared/src/code-anchor'

describe('extractAnchors — high-precision (宁缺毋滥)', () => {
  describe('file-path anchors', () => {
    it('extracts a path-shaped token with a known extension', () => {
      const anchors = extractAnchors(
        'See lib/services/memory/retire.service.ts for the loop.'
      )
      expect(anchors).toContainEqual({
        kind: 'file',
        value: 'lib/services/memory/retire.service.ts',
      })
    })

    it('extracts a backtick-wrapped path as a file anchor', () => {
      const anchors = extractAnchors(
        'the guard lives in `prisma/schema.prisma`'
      )
      expect(anchors).toContainEqual({
        kind: 'file',
        value: 'prisma/schema.prisma',
      })
    })

    it('does NOT extract URLs', () => {
      const anchors = extractAnchors(
        'docs at https://example.com/a/b/c.ts here'
      )
      expect(anchors.filter(a => a.kind === 'file')).toEqual([])
    })

    it('does NOT extract bare directory names without an extension', () => {
      const anchors = extractAnchors('everything under lib/ is layered')
      expect(anchors.filter(a => a.kind === 'file')).toEqual([])
    })

    it('does NOT extract external package specifiers', () => {
      const anchors = extractAnchors(
        'import from `@vercel/functions` and node_modules/x'
      )
      expect(anchors.filter(a => a.kind === 'file')).toEqual([])
    })
  })

  describe('symbol anchors (backtick-guarded only)', () => {
    it('extracts a backtick-wrapped compound identifier', () => {
      const anchors = extractAnchors('call `archiveMemories` to retire')
      expect(anchors).toContainEqual({
        kind: 'symbol',
        value: 'archiveMemories',
      })
    })

    it('extracts a backtick-wrapped snake_case identifier', () => {
      const anchors = extractAnchors('the `select_retire_candidates` helper')
      expect(anchors).toContainEqual({
        kind: 'symbol',
        value: 'select_retire_candidates',
      })
    })

    it('does NOT extract a symbol mentioned in prose without backticks', () => {
      const anchors = extractAnchors('we call archiveMemories somewhere')
      expect(anchors.filter(a => a.kind === 'symbol')).toEqual([])
    })

    it('does NOT extract a single plain English word even in backticks', () => {
      const anchors = extractAnchors('the `status` field and `name` column')
      expect(anchors.filter(a => a.kind === 'symbol')).toEqual([])
    })

    it('does NOT extract short stop-word identifiers in backticks', () => {
      const anchors = extractAnchors('`id` and `type` and `data`')
      expect(anchors.filter(a => a.kind === 'symbol')).toEqual([])
    })
  })

  describe('flag / constant anchors (backtick-guarded SCREAMING_SNAKE)', () => {
    it('extracts a backtick-wrapped SCREAMING_SNAKE constant', () => {
      const anchors = extractAnchors('tune `EMBEDDING_SCORE_FLOOR` carefully')
      expect(anchors).toContainEqual({
        kind: 'flag',
        value: 'EMBEDDING_SCORE_FLOOR',
      })
    })

    it('does NOT extract a SCREAMING_SNAKE token without backticks', () => {
      const anchors = extractAnchors('the EMBEDDING_SCORE_FLOOR value')
      expect(anchors.filter(a => a.kind === 'flag')).toEqual([])
    })
  })

  it('de-duplicates repeated anchors', () => {
    const anchors = extractAnchors(
      '`archiveMemories` then `archiveMemories` again'
    )
    expect(anchors.filter(a => a.value === 'archiveMemories')).toHaveLength(1)
  })
})
