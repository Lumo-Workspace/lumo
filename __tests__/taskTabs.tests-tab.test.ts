/**
 * LUM-801: 新增的 Tests 顶层 tab。
 *
 * 它**不进** dossier（Record tab）：dossier 是「决策优先 + 事后证据」的验收面板，
 * 而 test case 是开工前/中写的执行剧本；且 AcceptanceTab.tsx 已 2400+ 行。
 *
 * 这组测试同时锁住既有 tab 的 slug 契约不被带坏（LUM-458 的深链约定）。
 */
import {
  TAB_SLUGS,
  tabFromSlug,
  resolveTab,
  taskBasePath,
} from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/taskTabs'

describe('tests tab', () => {
  it('has the slug "tests"', () => {
    expect(TAB_SLUGS.tests).toBe('tests')
  })

  it('resolves the slug to the tab', () => {
    expect(tabFromSlug('tests')).toBe('tests')
    expect(resolveTab('tests')).toEqual({ tab: 'tests', section: null })
  })

  it('strips the tests segment from a task base path', () => {
    expect(taskBasePath('/w/acme/my-tasks/LUM-1/tests')).toBe(
      '/w/acme/my-tasks/LUM-1'
    )
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
