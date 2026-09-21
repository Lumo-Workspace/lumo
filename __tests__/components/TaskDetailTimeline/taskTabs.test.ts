import {
  TAB_SLUGS,
  BOUNDARY_CROSSINGS_ANCHOR,
  tabFromSlug,
  resolveTab,
  taskBasePath,
  boundaryCrossingsHref,
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

  it('uses the "record" slug for the dossier tab', () => {
    expect(TAB_SLUGS.dossier).toBe('record')
    expect(tabFromSlug('record')).toBe('dossier')
  })

  it('does not recognize the never-shipped "dossier" slug', () => {
    expect(tabFromSlug('dossier')).toBeNull()
    expect(resolveTab('dossier')).toBeNull()
  })

  it('no longer recognizes the old "delivery"/"agent" slug as its own tab', () => {
    expect(tabFromSlug('delivery')).toBeNull()
    expect(tabFromSlug('agent')).toBeNull()
  })

  it('no longer recognizes the "memory"/"lineage"/"acceptance" tab slugs', () => {
    expect(tabFromSlug('memory')).toBeNull()
    expect(tabFromSlug('lineage')).toBeNull()
    expect(tabFromSlug('acceptance')).toBeNull()
  })
})

describe('taskTabs single dossier tab replaces the merged trio', () => {
  it('has exactly one tab in place of Delivery/Memory/Lineage and it is the dossier', () => {
    // The merged trio is gone as top-level tabs…
    expect(tabFromSlug('delivery')).toBeNull()
    expect(tabFromSlug('memory')).toBeNull()
    expect(tabFromSlug('lineage')).toBeNull()
    // …replaced by a single dossier tab whose URL segment is `record`.
    expect(TAB_SLUGS.dossier).toBe('record')
    expect(tabFromSlug('record')).toBe('dossier')
    // The surviving top-level tabs are exactly comments/activity/context/dossier.
    // LUM-801 后多了一个独立的 `tests` tab；LUM-567 的断言意图是「三合一」——
    // trio 不复存在、只剩一个 dossier——上面四行已逐条锁住，这里只需确认
    // tab 集合没有偷偷把 trio 加回来。
    expect(Object.keys(TAB_SLUGS).sort()).toEqual([
      'activity',
      'comments',
      'context',
      'dossier',
      'tests',
    ])
  })
})

describe('taskTabs resolveTab legacy slug mapping', () => {
  it('maps delivery → dossier runs section', () => {
    expect(resolveTab('delivery')).toEqual({ tab: 'dossier', section: 'runs' })
  })

  it('maps lineage → dossier lineage section', () => {
    expect(resolveTab('lineage')).toEqual({
      tab: 'dossier',
      section: 'lineage',
    })
  })

  it('maps memory → dossier memory section', () => {
    expect(resolveTab('memory')).toEqual({ tab: 'dossier', section: 'memory' })
  })

  it('resolves the record slug itself with no target section', () => {
    expect(resolveTab('record')).toEqual({ tab: 'dossier', section: null })
  })

  it('resolves a missing segment to Comments with no section', () => {
    expect(resolveTab(undefined)).toEqual({ tab: 'comments', section: null })
  })

  it('returns null for an unknown slug so the caller normalizes the URL', () => {
    expect(resolveTab('does-not-exist')).toBeNull()
  })
})

// The verdict bar's "Review the crossings below" link lives ABOVE the tabs, so
// it must be able to route to the Record tab from any tab. taskBasePath strips
// the current tab segment (if any) off the pathname so the target is built
// from the bare task URL; boundaryCrossingsHref appends the record slug + the
// panel's anchor.
describe('taskBasePath / boundaryCrossingsHref', () => {
  it('returns a bare task path unchanged', () => {
    expect(taskBasePath('/workspace/w/projects/p/tasks/LUM-1')).toBe(
      '/workspace/w/projects/p/tasks/LUM-1'
    )
    expect(taskBasePath('/my-tasks/LUM-1')).toBe('/my-tasks/LUM-1')
  })

  it('strips a current tab segment', () => {
    expect(taskBasePath('/my-tasks/LUM-1/activity')).toBe('/my-tasks/LUM-1')
    expect(taskBasePath('/my-tasks/LUM-1/context')).toBe('/my-tasks/LUM-1')
    expect(taskBasePath('/my-tasks/LUM-1/record')).toBe('/my-tasks/LUM-1')
  })

  it('strips a legacy section segment', () => {
    expect(taskBasePath('/my-tasks/LUM-1/delivery')).toBe('/my-tasks/LUM-1')
    expect(taskBasePath('/my-tasks/LUM-1/lineage')).toBe('/my-tasks/LUM-1')
    expect(taskBasePath('/my-tasks/LUM-1/memory')).toBe('/my-tasks/LUM-1')
  })

  it('tolerates a trailing slash', () => {
    expect(taskBasePath('/my-tasks/LUM-1/')).toBe('/my-tasks/LUM-1')
    expect(taskBasePath('/my-tasks/LUM-1/record/')).toBe('/my-tasks/LUM-1')
  })

  it('builds the record-tab deep link to the crossings panel', () => {
    expect(boundaryCrossingsHref('/my-tasks/LUM-1/activity')).toBe(
      `/my-tasks/LUM-1/record#${BOUNDARY_CROSSINGS_ANCHOR}`
    )
    expect(BOUNDARY_CROSSINGS_ANCHOR).toBe('boundary-crossings')
  })
})
