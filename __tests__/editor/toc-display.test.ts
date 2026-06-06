import {
  TOC_ROOT_ID,
  tocLevelTier,
  withTitleRoot,
} from '@/lib/editor/toc-display'
import type { TocItem } from '@/app/workspace/[workspaceUrl]/hooks/useTocSync'

const heading = (over: Partial<TocItem> = {}): TocItem => ({
  id: over.id ?? 'h1',
  level: over.level ?? 2,
  textContent: over.textContent ?? 'File Structure',
  isActive: over.isActive ?? false,
  itemIndex: over.itemIndex ?? 0,
})

describe('withTitleRoot', () => {
  it('prepends the document title as a level-1 root node', () => {
    const items = [heading({ id: 'a', itemIndex: 0 })]
    const result = withTitleRoot(items, 'My Doc')

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      id: TOC_ROOT_ID,
      level: 1,
      textContent: 'My Doc',
      isActive: false,
      itemIndex: -1,
    })
    // original items preserved after the root, in order
    expect(result[1]).toBe(items[0])
  })

  it('trims surrounding whitespace from the title', () => {
    const result = withTitleRoot([], '  Spaced Title  ')
    expect(result[0]?.textContent).toBe('Spaced Title')
  })

  it('returns items unchanged when the title is blank', () => {
    const items = [heading()]
    expect(withTitleRoot(items, '')).toBe(items)
    expect(withTitleRoot(items, '   ')).toBe(items)
  })

  it('does not mark the root active even when a heading is active', () => {
    const result = withTitleRoot([heading({ isActive: true })], 'Doc')
    expect(result[0]?.isActive).toBe(false)
  })
})

describe('tocLevelTier', () => {
  it('maps level 1 (and the title root) to root', () => {
    expect(tocLevelTier(1)).toBe('root')
    expect(tocLevelTier(0)).toBe('root')
  })

  it('maps H2 to section', () => {
    expect(tocLevelTier(2)).toBe('section')
  })

  it('maps H3 and deeper to sub', () => {
    expect(tocLevelTier(3)).toBe('sub')
    expect(tocLevelTier(4)).toBe('sub')
  })
})
