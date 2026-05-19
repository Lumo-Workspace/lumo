/**
 * @jest-environment node
 */
import {
  buildUpdatePayload,
  formatUpdatedTaskLine,
  normalizeStatus,
} from '@/cli/src/commands/task-update'

describe('normalizeStatus', () => {
  it('uppercases canonical values', () => {
    expect(normalizeStatus('todo')).toBe('TODO')
    expect(normalizeStatus('IN_PROGRESS')).toBe('IN_PROGRESS')
    expect(normalizeStatus('in_progress')).toBe('IN_PROGRESS')
    expect(normalizeStatus('In_Review')).toBe('IN_REVIEW')
    expect(normalizeStatus('done')).toBe('DONE')
  })

  it('accepts hyphenated alias for ergonomics', () => {
    expect(normalizeStatus('in-progress')).toBe('IN_PROGRESS')
    expect(normalizeStatus('in-review')).toBe('IN_REVIEW')
  })

  it('returns null on unknown', () => {
    expect(normalizeStatus('deferred')).toBeNull()
    expect(normalizeStatus('')).toBeNull()
  })
})

describe('buildUpdatePayload', () => {
  it('omits absent flags', () => {
    const { payload, flagsGiven } = buildUpdatePayload({})
    expect(payload).toEqual({})
    expect(flagsGiven).toEqual([])
  })

  it('passes provided flags through (uppercase status/priority already normalized upstream)', () => {
    const { payload, flagsGiven } = buildUpdatePayload({
      title: 'New',
      description: 'Body',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assignee: 'me',
    })
    expect(payload).toEqual({
      title: 'New',
      description: 'Body',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assigneeRef: 'me',
    })
    expect(flagsGiven.sort()).toEqual(
      ['--assignee', '--description', '--priority', '--status', '--title'].sort()
    )
  })

  it('treats empty-string description as null (clear)', () => {
    const { payload } = buildUpdatePayload({ description: '' })
    expect(payload).toEqual({ description: null })
  })

  it('treats empty-string assignee as null (clear)', () => {
    const { payload } = buildUpdatePayload({ assignee: '' })
    expect(payload).toEqual({ assigneeRef: null })
  })

  it('preserves --title containing whitespace but not pure-empty', () => {
    const { payload } = buildUpdatePayload({ title: '   ' })
    // The schema will reject this server-side; we don't pre-trim.
    expect(payload.title).toBe('   ')
  })
})

describe('formatUpdatedTaskLine', () => {
  it('matches task-create style', () => {
    expect(
      formatUpdatedTaskLine({
        id: 'task_1',
        identifier: 'LUM-48',
        title: 'New title',
        url: 'https://www.uselumo.ai/workspace/ws/my-tasks/LUM-48',
      })
    ).toBe(
      'Updated LUM-48 "New title"  https://www.uselumo.ai/workspace/ws/my-tasks/LUM-48'
    )
  })

  it('escapes embedded quotes', () => {
    const line = formatUpdatedTaskLine({
      id: 'task_2',
      identifier: 'LUM-49',
      title: 'Has "quotes"',
      url: 'https://x/y',
    })
    expect(line).toContain('"Has \\"quotes\\""')
  })
})
