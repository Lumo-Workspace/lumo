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
      [
        '--assignee',
        '--description',
        '--priority',
        '--status',
        '--title',
      ].sort()
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

  it('includes Tags line when tags present', () => {
    const line = formatUpdatedTaskLine({
      id: 'task_3',
      identifier: 'LUM-1',
      title: 't',
      url: 'https://x',
      tags: ['urgent'],
    })
    expect(line).toBe(`Updated LUM-1 "t"  https://x\nTags: urgent`)
  })

  it('includes multiple tags joined by comma', () => {
    const line = formatUpdatedTaskLine({
      id: 'task_4',
      identifier: 'LUM-1',
      title: 't',
      url: 'https://x',
      tags: ['urgent', 'rfc'],
    })
    expect(line).toBe(`Updated LUM-1 "t"  https://x\nTags: urgent, rfc`)
  })

  it('omits Tags line when tags is empty', () => {
    const line = formatUpdatedTaskLine({
      id: 'task_5',
      identifier: 'LUM-1',
      title: 't',
      url: 'https://x',
      tags: [],
    })
    expect(line).toBe(`Updated LUM-1 "t"  https://x`)
  })

  it('omits Tags line when tags is undefined', () => {
    const line = formatUpdatedTaskLine({
      id: 'task_6',
      identifier: 'LUM-1',
      title: 't',
      url: 'https://x',
    })
    expect(line).toBe(`Updated LUM-1 "t"  https://x`)
  })
})

// ---------------------------------------------------------------------------
// Mutex guard tests
// These test the CLI-side mutex check in taskUpdate() directly.
// We mock away all I/O: readCredentials, resolveTagRefs, fetch.
// The mutex check must fire BEFORE any network call (no lookupTaskId needed).
// ---------------------------------------------------------------------------
// LUM-825: DONE also cleans up the task's local git worktrees; these suites
// test the API flow, so never let it touch the real checkout's worktrees.
jest.mock('@/cli/src/lib/worktree-cleanup', () => ({
  ...jest.requireActual('@/cli/src/lib/worktree-cleanup'),
  planTaskWorktreeCleanup: jest.fn(() => null),
}))
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))

jest.mock('@/cli/src/lib/tag-resolver', () => ({
  resolveTagRefs: jest.fn(async () => ['resolved_id']),
}))

describe('task update tag flag mutex', () => {
  let taskUpdate: typeof import('@/cli/src/commands/task-update').taskUpdate
  let consoleSpy: jest.SpyInstance

  beforeAll(async () => {
    const mod = await import('@/cli/src/commands/task-update')
    taskUpdate = mod.taskUpdate
  })

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('returns 2 (usage error) when --tag and --add-tag both set', async () => {
    const exitCode = await taskUpdate('LUM-1', {
      tag: ['a'],
      addTag: ['b'],
      title: 'something',
    })
    expect(exitCode).toBe(2)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('mutually exclusive')
    )
  })

  it('returns 2 (usage error) when --tag and --remove-tag both set', async () => {
    const exitCode = await taskUpdate('LUM-1', {
      tag: ['a'],
      removeTag: ['b'],
      title: 'something',
    })
    expect(exitCode).toBe(2)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('mutually exclusive')
    )
  })

  it('returns 2 (usage error) when --tag-id and --add-tag-id both set', async () => {
    const exitCode = await taskUpdate('LUM-1', {
      tagId: ['cuid_a'],
      addTagId: ['cuid_b'],
      title: 'something',
    })
    expect(exitCode).toBe(2)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('mutually exclusive')
    )
  })

  it('allows --add-tag with --remove-tag (no mutex violation)', async () => {
    // fetch mock: succeed
    const fetchMock = jest.fn(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          task: {
            id: 'task_x',
            identifier: 'LUM-1',
            title: 'My Task',
            url: 'https://api.lumo.test/task/LUM-1',
            taskTags: [{ name: 'urgent' }],
          },
        }),
      })
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const exitCode = await taskUpdate('LUM-1', {
      addTag: ['urgent'],
      removeTag: ['old'],
      title: 'something',
    })
    // Should not fail due to mutex
    expect(exitCode).not.toBe(1)
    // No "mutually exclusive" error logged
    for (const call of consoleSpy.mock.calls) {
      expect(call[0] as string).not.toContain('mutually exclusive')
    }
  })
})
