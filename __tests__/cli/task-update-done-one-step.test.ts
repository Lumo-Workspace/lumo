/**
 * @jest-environment node
 *
 * LUM-1106: `lumo task update <id> --status done` runs in one step — no
 * --confirm, no exit-4 envelope — when every linked PR is merged (at least
 * one) and the status digest read cleanly with nothing blocking DONE. Every
 * other case (no PR, unmerged PR, an older server without `pullRequests`, a
 * blocker, a failed read) still stops at the envelope with no PATCH.
 */
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
  resolveTagRefs: jest.fn(async () => ['tag-1']),
}))
jest.mock('../../cli/src/lib/session-id', () => ({
  resolveSessionId: async () => undefined,
  AmbiguousSessionError: class extends Error {},
}))

import {
  taskUpdate,
  qualifiesForOneStepDone,
  otherFlagsThanStatus,
  describeOtherChanges,
} from '@/cli/src/commands/task-update'

type Pr = {
  number: number
  title: string | null
  url: string | null
  state: string | null
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const mergedA: Pr = {
  number: 926,
  title: 'refactor: done',
  url: 'https://github.com/o/r/pull/926',
  state: 'merged',
}
const mergedB: Pr = {
  ...mergedA,
  number: 927,
  url: 'https://github.com/o/r/pull/927',
}
const openPr: Pr = { ...mergedA, number: 930, state: 'open' }
const closedPr: Pr = { ...mergedA, number: 931, state: 'closed' }

interface World {
  /** undefined → the field is absent (older server). */
  pullRequests?: Pr[] | undefined
  omitPullRequests?: boolean
  taskStatus?: string
  status?: { code: number; body?: unknown }
  crossings?: { code: number; body?: unknown }
}

const CLEAN_STATUS = {
  task: { identifier: 'LUM-1', title: 'My Task', status: 'IN_REVIEW' },
  nextActions: [],
  securityFindings: { open: 0, blocking: 0, unconfirmedPrs: [] },
}

let fetchMock: jest.Mock
let stdout: string[]
let stderr: string[]

function install(world: World) {
  fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/by-identifier/LUM-1')) {
      if (init?.method === 'PATCH')
        return jsonResponse(200, {
          task: {
            id: 'task-1',
            identifier: 'LUM-1',
            title: 'My Task',
            url: 'https://api.lumo.test/workspace/lumo/my-tasks/LUM-1',
            taskTags: [],
          },
        })
      const task: Record<string, unknown> = {
        id: 'task-1',
        identifier: 'LUM-1',
        title: 'My Task',
        url: 'https://api.lumo.test/workspace/lumo/my-tasks/LUM-1',
        status: world.taskStatus ?? 'IN_REVIEW',
      }
      if (!world.omitPullRequests) task.pullRequests = world.pullRequests ?? []
      return jsonResponse(200, { task })
    }
    if (url.endsWith('/status')) {
      const s = world.status ?? { code: 200, body: CLEAN_STATUS }
      return jsonResponse(s.code, s.body ?? {})
    }
    if (url.endsWith('/boundary-crossings')) {
      const c = world.crossings ?? { code: 200, body: { crossings: [] } }
      return jsonResponse(c.code, c.body ?? {})
    }
    throw new Error(`unexpected fetch ${url}`)
  })
  global.fetch = fetchMock as unknown as typeof fetch
}

const patchCalls = () =>
  fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH'
  )

const savedArgv = process.argv
const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

beforeEach(() => {
  jest.clearAllMocks()
  stdout = []
  stderr = []
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    stdout.push(String(s))
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((...a) => {
    stderr.push(a.join(' '))
  })
  Object.defineProperty(process.stdout, 'isTTY', {
    value: false,
    configurable: true,
    writable: true,
  })
  process.argv = ['node', 'lumo', 'task', 'update', 'LUM-1', '--status', 'done']
})

afterEach(() => {
  jest.restoreAllMocks()
  process.argv = savedArgv
  if (stdoutTTY) Object.defineProperty(process.stdout, 'isTTY', stdoutTTY)
  else delete (process.stdout as { isTTY?: boolean }).isTTY
})

function expectEnvelopeNoPatch(code: number | void) {
  expect(code).toBe(4)
  const parsed = JSON.parse(stdout.join('')) as { status: string }
  expect(parsed.status).toBe('confirmation_required')
  expect(patchCalls()).toHaveLength(0)
}

describe('qualifiesForOneStepDone (pure)', () => {
  it('needs ≥1 PR, all merged, and a clear digest', () => {
    expect(qualifiesForOneStepDone([mergedA], true)).toBe(true)
    expect(qualifiesForOneStepDone([mergedA, mergedB], true)).toBe(true)
    expect(qualifiesForOneStepDone([mergedA], false)).toBe(false)
    expect(qualifiesForOneStepDone([], true)).toBe(false)
    expect(qualifiesForOneStepDone(undefined, true)).toBe(false)
    expect(qualifiesForOneStepDone([mergedA, openPr], true)).toBe(false)
    expect(qualifiesForOneStepDone([closedPr], true)).toBe(false)
    expect(qualifiesForOneStepDone([{ ...mergedA, state: null }], true)).toBe(
      false
    )
  })
})

describe('otherFlagsThanStatus / describeOtherChanges (pure)', () => {
  it('lists every flag besides --status, tags and sprint included', () => {
    expect(otherFlagsThanStatus(['--status'], {})).toEqual([])
    expect(
      otherFlagsThanStatus(['--title', '--status', '--priority'], {
        addTag: ['a'],
        removeTagId: ['t'],
        sprint: '',
      })
    ).toEqual([
      '--title',
      '--priority',
      '--add-tag',
      '--remove-tag',
      '--sprint',
    ])
    expect(otherFlagsThanStatus(['--status'], { tag: [] })).toEqual([])
    expect(describeOtherChanges([])).toEqual([])
    expect(describeOtherChanges(['--title', '--due'])).toEqual([
      'Also updates: --title, --due (one-step DONE covers a status-only change)',
    ])
  })
})

describe('task update --status done, one step', () => {
  it('all PRs merged + nothing blocks: PATCH without --confirm, exit 0, Updated line first', async () => {
    install({ pullRequests: [mergedA, mergedB] })
    const code = await taskUpdate('LUM-1', { status: 'done' })
    expect(code).toBeUndefined()
    const patches = patchCalls()
    expect(patches).toHaveLength(1)
    expect(JSON.parse((patches[0][1] as RequestInit).body as string)).toEqual({
      status: 'DONE',
    })
    const out = stdout.join('')
    // Agent-parsing red line: the first line keeps its exact format.
    expect(out.split('\n')[0]).toBe(
      'Updated LUM-1 "My Task"  https://api.lumo.test/workspace/lumo/my-tasks/LUM-1'
    )
    // Then the changes summary: what moved, and every merged PR.
    expect(out).toMatch(/One-step DONE/)
    expect(out).toContain('Status: IN_REVIEW → DONE')
    expect(out).toMatch(/#926\s+merged/)
    expect(out).toMatch(/#927\s+merged/)
    expect(out).not.toContain('confirmation_required')
    expect(stderr).toEqual([])
  })

  it('no linked PR: envelope, no PATCH', async () => {
    install({ pullRequests: [] })
    expectEnvelopeNoPatch(await taskUpdate('LUM-1', { status: 'done' }))
  })

  it('an unmerged PR: envelope, no PATCH', async () => {
    install({ pullRequests: [mergedA, openPr] })
    expectEnvelopeNoPatch(await taskUpdate('LUM-1', { status: 'done' }))
  })

  it('a closed-unmerged PR: envelope, no PATCH', async () => {
    install({ pullRequests: [mergedA, closedPr] })
    expectEnvelopeNoPatch(await taskUpdate('LUM-1', { status: 'done' }))
  })

  it('older server without pullRequests: envelope, no PATCH', async () => {
    install({ omitPullRequests: true })
    expectEnvelopeNoPatch(await taskUpdate('LUM-1', { status: 'done' }))
  })

  it('an open blocking crossing: envelope, no PATCH', async () => {
    install({
      pullRequests: [mergedA],
      crossings: {
        code: 200,
        body: {
          crossings: [
            {
              id: 'c1',
              ref: 'LUM-X1',
              category: 'SECRET_WRITE',
              severity: 'HIGH',
              detail: 'x',
              disposition: null,
            },
          ],
        },
      },
    })
    expectEnvelopeNoPatch(await taskUpdate('LUM-1', { status: 'done' }))
  })

  it('a blocking security finding: envelope, no PATCH', async () => {
    install({
      pullRequests: [mergedA],
      status: {
        code: 200,
        body: {
          ...CLEAN_STATUS,
          nextActions: [
            {
              kind: 'SECURITY_FINDING',
              findingId: 'f-1',
              statement: 'AWS key committed',
              severity: 'HIGH',
              provenance: 'DETERMINISTIC',
              blocking: true,
              prNumber: 926,
              ruleId: 'secrets.aws-key',
              filePath: 'lib/x.ts',
              line: 12,
            },
          ],
        },
      },
    })
    expectEnvelopeNoPatch(await taskUpdate('LUM-1', { status: 'done' }))
  })

  it('a proven test-case defect: envelope, no PATCH', async () => {
    install({
      pullRequests: [mergedA],
      status: {
        code: 200,
        body: {
          ...CLEAN_STATUS,
          nextActions: [
            {
              kind: 'TEST_CASE_VERDICT',
              signal: 'PROVEN_DEFECT',
              number: 1,
              title: 't',
              advisory: true,
            },
          ],
        },
      },
    })
    expectEnvelopeNoPatch(await taskUpdate('LUM-1', { status: 'done' }))
  })

  it('status digest read fails: envelope, no PATCH', async () => {
    install({ pullRequests: [mergedA], status: { code: 500 } })
    expectEnvelopeNoPatch(await taskUpdate('LUM-1', { status: 'done' }))
  })

  it('crossings read fails: envelope, no PATCH', async () => {
    install({ pullRequests: [mergedA], crossings: { code: 503 } })
    expectEnvelopeNoPatch(await taskUpdate('LUM-1', { status: 'done' }))
  })

  it('security findings unconfirmed (null): envelope, no PATCH', async () => {
    install({
      pullRequests: [mergedA],
      status: { code: 200, body: { ...CLEAN_STATUS, securityFindings: null } },
    })
    expectEnvelopeNoPatch(await taskUpdate('LUM-1', { status: 'done' }))
  })

  it('task already DONE: envelope, no PATCH', async () => {
    install({ pullRequests: [mergedA], taskStatus: 'DONE' })
    expectEnvelopeNoPatch(await taskUpdate('LUM-1', { status: 'done' }))
  })

  // LUM-1116: one step covers a status-only change. Any other field rides
  // in the envelope so the user signs off on it too.
  it('--status done --title x in the one-step condition: still envelope, no PATCH, names the extra change', async () => {
    install({ pullRequests: [mergedA] })
    process.argv = [
      'node',
      'lumo',
      'task',
      'update',
      'LUM-1',
      '--status',
      'done',
      '--title',
      'x',
    ]
    const code = await taskUpdate('LUM-1', { status: 'done', title: 'x' })
    expectEnvelopeNoPatch(code)
    const parsed = JSON.parse(stdout.join('')) as {
      changes: string[]
      confirmCommand: string
    }
    expect(parsed.changes).toContain(
      'Also updates: --title (one-step DONE covers a status-only change)'
    )
    expect(parsed.confirmCommand).toContain('--title')
    expect(parsed.confirmCommand).toContain('--confirm')
  })

  it('--status done with tag or sprint flags in the one-step condition: envelope, no PATCH', async () => {
    install({ pullRequests: [mergedA] })
    expectEnvelopeNoPatch(
      await taskUpdate('LUM-1', { status: 'done', addTag: ['x'] })
    )
    stdout = []
    expectEnvelopeNoPatch(
      await taskUpdate('LUM-1', { status: 'done', sprint: 'S1' })
    )
  })

  it('--confirm still works when the one-step condition is not met', async () => {
    install({ pullRequests: [] })
    const code = await taskUpdate('LUM-1', { status: 'done', confirm: true })
    expect(code).toBeUndefined()
    expect(patchCalls()).toHaveLength(1)
    expect(stdout.join('').split('\n')[0]).toMatch(/^Updated LUM-1 "My Task"/)
    expect(stdout.join('')).not.toMatch(/One-step DONE/)
  })
})
