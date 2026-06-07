import { toLineageFragmentType } from '@/lib/lineage/fragment-type'

describe('toLineageFragmentType', () => {
  it('maps tracked fragment types to the LineageFragmentType enum', () => {
    expect(toLineageFragmentType('MEMORY')).toBe('MEMORY')
    expect(toLineageFragmentType('SLACK_CONTEXT')).toBe('SLACK_CONTEXT')
    expect(toLineageFragmentType('WEB_LINK')).toBe('WEB_LINK')
    expect(toLineageFragmentType('FIGMA_LINK')).toBe('FIGMA')
    expect(toLineageFragmentType('PULL_REQUEST')).toBe('PR')
    expect(toLineageFragmentType('PR_REVIEW_TODO')).toBe('PR_REVIEW_TODO')
    expect(toLineageFragmentType('SESSION')).toBe('SESSION')
  })

  it('returns null for fragment types with no lineage edge counterpart', () => {
    expect(toLineageFragmentType('ARTIFACT')).toBeNull()
    expect(toLineageFragmentType('DOCUMENT')).toBeNull()
    expect(toLineageFragmentType('COMMENT')).toBeNull()
  })
})
