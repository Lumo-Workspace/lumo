import {
  TAB_SLUGS,
  tabFromSlug,
} from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/taskTabs'

describe('taskTabs slug mapping', () => {
  it('maps Comments to the empty (bare-URL) slug', () => {
    expect(TAB_SLUGS.comments).toBe('')
  })

  it('round-trips every non-default tab through its slug', () => {
    const nonDefault = (
      Object.entries(TAB_SLUGS) as [
        import('@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/taskTabs').TabValue,
        string,
      ][]
    )
      .filter(([, slug]) => slug !== '')
      .map(([tab]) => tab)
    expect(nonDefault.length).toBeGreaterThan(0)
    for (const tab of nonDefault) {
      expect(tabFromSlug(TAB_SLUGS[tab])).toBe(tab)
    }
  })

  it('treats a missing segment as Comments', () => {
    expect(tabFromSlug(undefined)).toBe('comments')
  })

  it('returns null for an unknown slug', () => {
    expect(tabFromSlug('does-not-exist')).toBeNull()
  })

  it('returns null for the literal "comments" slug (canonical URL is bare)', () => {
    expect(tabFromSlug('comments')).toBeNull()
  })

  it('uses the "delivery" slug for the agent (Delivery) tab', () => {
    expect(TAB_SLUGS.agent).toBe('delivery')
    expect(tabFromSlug('delivery')).toBe('agent')
  })

  it('no longer recognizes the old "agent" slug', () => {
    expect(tabFromSlug('agent')).toBeNull()
  })

  it('no longer recognizes the "acceptance" tab/slug', () => {
    // @ts-expect-error 'acceptance' is removed from TabValue
    expect(TAB_SLUGS.acceptance).toBeUndefined()
    expect(tabFromSlug('acceptance')).toBeNull()
  })
})
