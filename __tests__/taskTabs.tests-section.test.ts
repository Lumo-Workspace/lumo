/**
 * LUM-801 → LUM-1011: test case 曾是独立的 Tests 顶层 tab；LUM-1011 起它是
 * Record（dossier）tab 的「测试用例」区段。旧的 `/tests` 地址（含
 * `#run-<id>` 深链）必须仍然落到用例上。
 *
 * 这组测试同时锁住既有 tab 的 slug 契约不被带坏（LUM-458 的深链约定）。
 */
import {
  TAB_SLUGS,
  TEST_CASES_ANCHOR,
  tabFromSlug,
  resolveTab,
  runAnchorId,
} from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/taskTabs'

describe('test cases live in the Record tab', () => {
  it('has no Tests tab any more', () => {
    expect(Object.keys(TAB_SLUGS)).not.toContain('tests')
    expect(tabFromSlug('tests')).toBeNull()
  })

  it('maps the old /tests slug onto the Record tab test cases section', () => {
    expect(resolveTab('tests')).toEqual({ tab: 'dossier', section: 'tests' })
    // TaskDossier scrolls to `dossier-<section>`.
    expect(TEST_CASES_ANCHOR).toBe('dossier-tests')
  })

  it('gives each run a stable `run-<id>` anchor', () => {
    expect(runAnchorId('r1')).toBe('run-r1')
  })
})

describe('existing tab contract is untouched', () => {
  it('keeps the bare-URL default and the record slug', () => {
    expect(TAB_SLUGS.comments).toBe('')
    expect(TAB_SLUGS.dossier).toBe('record')
    expect(resolveTab(undefined)).toEqual({ tab: 'comments', section: null })
  })

  it('still maps the legacy delivery/lineage/memory deep links into the dossier', () => {
    expect(resolveTab('delivery')).toEqual({ tab: 'dossier', section: 'runs' })
    expect(resolveTab('lineage')).toEqual({
      tab: 'dossier',
      section: 'lineage',
    })
    expect(resolveTab('memory')).toEqual({ tab: 'dossier', section: 'memory' })
  })

  it('still returns null for an unknown slug so the caller normalizes', () => {
    expect(resolveTab('nope')).toBeNull()
  })
})
