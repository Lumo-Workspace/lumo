/**
 * @jest-environment node
 *
 * LUM-821 P1: `--due` on task create/update, and `task show` rendering due.
 * `--parent` and the Parent / Subtasks lines were removed in LUM-959.
 */
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
    email: 'me@x.com',
  })),
}))

jest.mock('../../cli/src/lib/session-id', () => ({
  resolveSessionId: async () => process.env.CLAUDE_CODE_SESSION_ID,
  AmbiguousSessionError: class extends Error {},
}))

import { buildUpdatePayload, taskUpdate } from '@/cli/src/commands/task-update'
import { taskCreate } from '@/cli/src/commands/task-create'
import { formatTaskShow } from '@/cli/src/commands/task-show'
import { localDayStart } from '@/cli/src/lib/local-day'

let fetchMock: jest.Mock
beforeEach(() => {
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  jest.spyOn(console, 'error').mockImplementation(() => {})
  fetchMock = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          task: {
            id: 't',
            identifier: 'LUM-9',
            title: 'x',
            url: 'u',
            taskTags: [],
          },
          nextSteps: [],
        }),
        { status: 201 }
      )
  )
  global.fetch = fetchMock as unknown as typeof fetch
})
afterEach(() => jest.restoreAllMocks())

const sentBody = () => JSON.parse(String(fetchMock.mock.calls[0][1].body))

describe('buildUpdatePayload', () => {
  it('--due day → local-midnight instant; "" clears', () => {
    expect(buildUpdatePayload({ due: '2026-09-30' }).payload).toEqual({
      dueDate: localDayStart('2026-09-30'),
    })
    expect(buildUpdatePayload({ due: '' }).payload).toEqual({ dueDate: null })
  })
})

describe('task create --due', () => {
  it('sends dueDate and never a parentRef', async () => {
    await taskCreate('Sub', { due: '2026-09-30', hints: false })
    expect(sentBody()).toMatchObject({ dueDate: localDayStart('2026-09-30') })
    expect(sentBody()).not.toHaveProperty('parentRef')
  })
  it('rejects an impossible due date before any network call', async () => {
    expect(await taskCreate('Sub', { due: '2026-02-30' })).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('task update --due validation', () => {
  it('rejects a malformed day before any network call', async () => {
    expect(await taskUpdate('LUM-9', { due: 'tomorrow' })).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('task show', () => {
  it('prints due (local day) and no Parent / Subtasks lines', () => {
    const out = formatTaskShow({
      id: 't',
      identifier: 'LUM-48',
      title: 'Child',
      status: 'TODO',
      priority: 'LOW',
      description: null,
      url: 'https://x',
      project: { id: 'p', name: 'lumo' },
      assignee: null,
      dueDate: localDayStart('2026-09-30'),
    })
    expect(out).toContain('Due:       2026-09-30')
    expect(out).not.toMatch(/Parent:|Subtasks/)
  })
  it('omits the new lines for an older server payload', () => {
    const out = formatTaskShow({
      id: 't',
      identifier: 'LUM-1',
      title: 'x',
      status: 'TODO',
      priority: 'LOW',
      description: null,
      url: 'u',
      project: { id: 'p', name: 'lumo' },
      assignee: null,
    })
    expect(out).not.toMatch(/Due:|Parent:|Subtasks/)
  })
})
