/**
 * @jest-environment node
 *
 * LUM-821 P1: `--due` / `--parent` on task create/update, and `task show`
 * rendering due / parent / subtasks.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    email: 'me@x.com',
  })),
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
  it('--parent ref passes through; "" detaches', () => {
    expect(buildUpdatePayload({ parent: 'LUM-10' }).payload).toEqual({
      parentRef: 'LUM-10',
    })
    expect(buildUpdatePayload({ parent: '' }).payload).toEqual({
      parentRef: null,
    })
  })
})

describe('task create --due --parent', () => {
  it('sends dueDate + parentRef', async () => {
    await taskCreate('Sub', {
      due: '2026-09-30',
      parent: 'LUM-10',
      hints: false,
    })
    expect(sentBody()).toMatchObject({
      dueDate: localDayStart('2026-09-30'),
      parentRef: 'LUM-10',
    })
  })
  it('rejects an impossible due date before any network call', async () => {
    expect(await taskCreate('Sub', { due: '2026-02-30' })).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('task update --due validation', () => {
  it('rejects a malformed day before any network call', async () => {
    expect(await taskUpdate('LUM-9', { due: 'tomorrow' })).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('task show', () => {
  it('prints due (local day), parent and subtasks', () => {
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
      parent: { identifier: 'LUM-10', title: 'Epic' },
      subtasks: [
        { identifier: 'LUM-50', title: 'Leaf', status: 'IN_PROGRESS' },
        { identifier: 'LUM-51', title: 'Leaf 2', status: 'TODO' },
      ],
    })
    expect(out).toContain('Due:       2026-09-30')
    expect(out).toContain('Parent:    LUM-10  Epic')
    expect(out).toContain('Subtasks (2):')
    expect(out).toMatch(/ {2}LUM-50 {2}IN_PROGRESS {2}Leaf/)
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
