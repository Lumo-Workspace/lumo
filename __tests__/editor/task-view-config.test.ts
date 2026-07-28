import {
  DEFAULT_TASK_VIEW_CONFIG,
  parseTaskViewConfig,
} from '@/lib/editor/nodes/task-view-config'

describe('parseTaskViewConfig', () => {
  it('returns the default for null / empty / malformed input', () => {
    expect(parseTaskViewConfig(null)).toEqual(DEFAULT_TASK_VIEW_CONFIG)
    expect(parseTaskViewConfig('')).toEqual(DEFAULT_TASK_VIEW_CONFIG)
    expect(parseTaskViewConfig('{not json')).toEqual(DEFAULT_TASK_VIEW_CONFIG)
    expect(parseTaskViewConfig('42')).toEqual(DEFAULT_TASK_VIEW_CONFIG)
  })

  it('round-trips a fully-populated config', () => {
    const config = {
      version: 1 as const,
      view: 'kanban' as const,
      groupBy: 'status' as const,
      filters: { projectIds: ['p1'], statuses: ['TODO'] },
    }
    expect(parseTaskViewConfig(JSON.stringify(config))).toEqual(config)
  })

  it('coerces unknown view/groupBy back to defaults and keeps filters', () => {
    const parsed = parseTaskViewConfig(
      JSON.stringify({ view: 'x', groupBy: 'y', filters: { tagIds: ['t1'] } })
    )
    expect(parsed.view).toBe('list')
    expect(parsed.groupBy).toBe('none')
    expect(parsed.filters).toEqual({ tagIds: ['t1'] })
    expect(parsed.version).toBe(1)
  })

  it('defaults filters to {} when missing or non-object', () => {
    expect(parseTaskViewConfig(JSON.stringify({ filters: 5 })).filters).toEqual(
      {}
    )
    expect(parseTaskViewConfig(JSON.stringify({})).filters).toEqual({})
  })

  it('rejects an array as filters (not a plain object)', () => {
    expect(
      parseTaskViewConfig(JSON.stringify({ filters: ['a', 'b'] })).filters
    ).toEqual({})
  })
})
