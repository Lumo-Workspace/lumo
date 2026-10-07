/**
 * @jest-environment node
 *
 * LUM-755 (supersedes LUM-731's interactive prompt): `lumo task update <id>
 * --status done` walks the confirmation protocol. Without --confirm it looks
 * the task up, prints an envelope (status transition, every linked PR, a ⚠
 * line when one is unmerged) and exits 4 without a PATCH. With --confirm the
 * PATCH goes out and the server's own DONE gates still apply.
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
  })),
}))
jest.mock('@/cli/src/lib/tag-resolver', () => ({
  resolveTagRefs: jest.fn(async () => ['tag-1']),
}))

jest.mock('../../cli/src/lib/session-id', () => ({
  resolveSessionId: async () => process.env.CLAUDE_CODE_SESSION_ID,
  AmbiguousSessionError: class extends Error {},
}))

import { resolveTagRefs } from '@/cli/src/lib/tag-resolver'
import {
  taskUpdate,
  partitionLinkedPrs,
  describeDoneTransition,
} from '@/cli/src/commands/task-update'

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

type Pr = {
  number: number
  title: string | null
  url: string | null
  state: string | null
}

function showOk(opts: { status?: string; pullRequests?: Pr[] } = {}) {
  return jsonResponse(200, {
    task: {
      id: 'task-1',
      identifier: 'LUM-1',
      title: 'My Task',
      url: 'https://api.lumo.test/workspace/lumo/my-tasks/LUM-1',
      status: opts.status ?? 'IN_REVIEW',
      priority: 'LOW',
      description: null,
      sprintId: null,
      teamId: 'team-1',
      project: { id: 'proj-1', name: 'Lumo' },
      assignee: null,
      pullRequests: opts.pullRequests ?? [],
    },
  })
}

function patchOk() {
  return jsonResponse(200, {
    task: {
      id: 'task-1',
      identifier: 'LUM-1',
      title: 'My Task',
      url: 'https://api.lumo.test/workspace/lumo/my-tasks/LUM-1',
      taskTags: [],
    },
  })
}

const openPr: Pr = {
  number: 930,
  title: 'feat: wip',
  url: 'https://github.com/o/r/pull/930',
  state: 'open',
}
const mergedPr: Pr = {
  number: 926,
  title: 'refactor: done',
  url: 'https://github.com/o/r/pull/926',
  state: 'merged',
}

let fetchMock: jest.Mock
let stdout: string[]
let stderr: string[]
const savedArgv = process.argv
const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

function setTTY(
  stream: NodeJS.WriteStream | NodeJS.ReadStream,
  value: boolean
) {
  Object.defineProperty(stream, 'isTTY', {
    value,
    configurable: true,
    writable: true,
  })
}

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
  // LUM-842: reads nobody queued a response for — the status digest's
  // GET /status and /boundary-crossings — get a minimal valid body.
  fetchMock = jest.fn(async (url: string) =>
    url.endsWith('/status')
      ? jsonResponse(200, {
          task: { identifier: 'LUM-1', title: 'My Task', status: 'IN_REVIEW' },
          nextActions: [],
          securityFindings: { open: 0, blocking: 0, unconfirmedPrs: [] },
        })
      : url.endsWith('/boundary-crossings')
        ? jsonResponse(200, { crossings: [] })
        : undefined
  )
  global.fetch = fetchMock as unknown as typeof fetch
  // The agent path: nothing is a TTY. LUM-731 used to exit 1 here.
  setTTY(process.stdin, false)
  setTTY(process.stdout, false)
  process.argv = ['node', 'lumo', 'task', 'update', 'LUM-1', '--status', 'done']
})

afterEach(() => {
  jest.restoreAllMocks()
  process.argv = savedArgv
  for (const [stream, desc] of [
    [process.stdin, stdinTTY],
    [process.stdout, stdoutTTY],
  ] as const) {
    if (desc) Object.defineProperty(stream, 'isTTY', desc)
    else delete (stream as { isTTY?: boolean }).isTTY
  }
})

const patchCalls = () =>
  fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH'
  )

function envelope() {
  const parsed = JSON.parse(stdout.join('')) as {
    status: string
    command: string
    changes: string[]
    confirmCommand: string
  }
  expect(parsed.status).toBe('confirmation_required')
  expect(parsed.command).toBe('task update')
  return parsed
}

describe('task update done envelope', () => {
  it('pure helpers: partitionLinkedPrs and describeDoneTransition', () => {
    const closed: Pr = { ...openPr, number: 1, state: 'closed' }
    const unknown: Pr = { ...openPr, number: 2, state: null }
    const { merged, unmerged } = partitionLinkedPrs([
      mergedPr,
      openPr,
      closed,
      unknown,
    ])
    expect(merged.map(p => p.number)).toEqual([926])
    expect(unmerged.map(p => p.number)).toEqual([930, 1, 2])

    const changes = describeDoneTransition(
      { identifier: 'LUM-1', title: 'My "quoted" Task', status: 'IN_REVIEW' },
      [mergedPr, openPr]
    )
    expect(changes[0]).toContain('LUM-1')
    expect(changes[0]).toContain('My \\"quoted\\" Task')
    expect(changes).toContain('Status: IN_REVIEW → DONE')
    expect(changes.find(c => c.startsWith('#926'))).toMatch(
      /^#926\s+merged\s+refactor: done\s+https:\/\/github\.com\/o\/r\/pull\/926$/
    )
    expect(changes.find(c => c.startsWith('#930'))).toMatch(/^#930\s+open/)
    const last = changes[changes.length - 1]
    expect(last).toMatch(/^⚠ 1 linked pull request not merged: #930 open/)

    const none = describeDoneTransition(
      { identifier: 'LUM-1', title: 'T', status: 'TODO' },
      []
    )
    expect(none).toContain('Pull requests: none linked')
    expect(none.some(c => c.startsWith('⚠'))).toBe(false)
  })

  it('no --confirm, non-TTY: exit 4 with the envelope, no PATCH', async () => {
    fetchMock.mockResolvedValueOnce(showOk({ pullRequests: [mergedPr] }))
    const code = await taskUpdate('LUM-1', { status: 'done' })
    expect(code).toBe(4)
    const env = envelope()
    expect(env.changes).toContain('Status: IN_REVIEW → DONE')
    expect(
      env.changes.some(c => c.startsWith('#926') && /merged/.test(c))
    ).toBe(true)
    expect(env.changes.some(c => c.startsWith('⚠'))).toBe(false)
    expect(env.confirmCommand).toBe(
      'lumo task update LUM-1 --status done --confirm'
    )
    expect(patchCalls()).toHaveLength(0)
    expect(stderr).toEqual([])
  })

  it('no --confirm with an unmerged PR: the ⚠ line closes changes[] (no second gate)', async () => {
    fetchMock.mockResolvedValueOnce(
      showOk({ pullRequests: [mergedPr, openPr] })
    )
    const code = await taskUpdate('LUM-1', { status: 'done' })
    expect(code).toBe(4)
    const env = envelope()
    const last = env.changes[env.changes.length - 1]
    expect(last).toMatch(/^⚠ 1 linked pull request not merged: #930 open/)
    expect(last).not.toContain('#926')
    expect(patchCalls()).toHaveLength(0)
  })

  it('no --confirm: other flags on the same call are preserved in confirmCommand, and tags are not resolved before the gate', async () => {
    process.argv = [
      'node',
      'lumo',
      'task',
      'update',
      'LUM-1',
      '--status',
      'done',
      '--add-tag',
      'shipped',
    ]
    fetchMock.mockResolvedValueOnce(showOk())
    const code = await taskUpdate('LUM-1', {
      status: 'done',
      addTag: ['shipped'],
    })
    expect(code).toBe(4)
    expect(envelope().confirmCommand).toBe(
      'lumo task update LUM-1 --status done --add-tag shipped --confirm'
    )
    expect(resolveTagRefs).not.toHaveBeenCalled()
    expect(patchCalls()).toHaveLength(0)
  })

  it('no --confirm on a TTY: the same envelope as text, still exit 4, no prompt', async () => {
    setTTY(process.stdin, true)
    setTTY(process.stdout, true)
    fetchMock.mockResolvedValueOnce(showOk({ pullRequests: [openPr] }))
    const code = await taskUpdate('LUM-1', { status: 'done' })
    expect(code).toBe(4)
    const out = stdout.join('')
    expect(() => JSON.parse(out)).toThrow()
    expect(out).toContain('Status: IN_REVIEW → DONE')
    expect(out).toContain('#930')
    expect(out).not.toMatch(/\[y\/N\]/)
    expect(
      out.trimEnd().endsWith('lumo task update LUM-1 --status done --confirm')
    ).toBe(true)
    expect(patchCalls()).toHaveLength(0)
  })

  it('--confirm: the DONE PATCH is sent straight away', async () => {
    fetchMock.mockResolvedValueOnce(patchOk())
    const code = await taskUpdate('LUM-1', { status: 'done', confirm: true })
    expect(code).toBeUndefined()
    const patches = patchCalls()
    expect(patches).toHaveLength(1)
    expect(JSON.parse((patches[0][1] as RequestInit).body as string)).toEqual({
      status: 'DONE',
    })
    expect(stdout.join('')).toContain('Updated LUM-1')
  })

  it('--confirm but the server gate refuses: structured DONE_BLOCKED on stdout with the 409 message verbatim, exit 5', async () => {
    const gateMsg =
      'Cannot move this task to DONE — 1 undispositioned HIGH security finding (secrets.aws-key ×1).'
    fetchMock
      .mockResolvedValueOnce(jsonResponse(409, { error: gateMsg }))
      // enrichment reads: task status, then boundary crossings
      .mockResolvedValueOnce(
        jsonResponse(200, {
          nextActions: [
            {
              kind: 'SECURITY_FINDING',
              findingId: 'f-1',
              statement: 'AWS key committed',
              severity: 'HIGH',
              provenance: 'DETERMINISTIC',
              blocking: true,
              prNumber: 958,
              ruleId: 'secrets.aws-key',
              filePath: 'lib/x.ts',
              line: 12,
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { crossings: [] }))
    const code = await taskUpdate('LUM-1', { status: 'done', confirm: true })
    expect(code).toBe(5)
    const parsed = JSON.parse(stdout.join('')) as {
      code: string
      message: string
      blockers: Array<{ kind: string; findingId?: string }>
    }
    expect(parsed.code).toBe('DONE_BLOCKED')
    expect(parsed.message).toBe(gateMsg)
    expect(parsed.blockers).toEqual([
      expect.objectContaining({ kind: 'SECURITY_FINDING', findingId: 'f-1' }),
    ])
    expect(stderr).toEqual([])
  })

  it('task lookup failure (404) exits 1 before any envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, { error: 'Task LUM-1 not found' })
    )
    const code = await taskUpdate('LUM-1', { status: 'done' })
    expect(code).toBe(1)
    expect(stdout.join('')).toBe('')
    expect(stderr.join('\n')).toContain('Task LUM-1 not found')
  })

  it('other statuses never see the gate: no lookup, PATCH straight away, --confirm ignored', async () => {
    fetchMock.mockResolvedValueOnce(patchOk())
    let code = await taskUpdate('LUM-1', { status: 'in_progress' })
    expect(code).toBeUndefined()
    // No by-identifier lookup: the PATCH goes first; the only other reads are
    // the LUM-842 status digest's GET /status and /boundary-crossings.
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('PATCH')
    expect(
      fetchMock.mock.calls
        .slice(1)
        .map(c => String(c[0]).replace(/^.*\/LUM-1/, ''))
        .sort()
    ).toEqual(['/boundary-crossings', '/status'])

    jest.clearAllMocks()
    fetchMock.mockResolvedValueOnce(patchOk())
    code = await taskUpdate('LUM-1', { status: 'in_review', confirm: true })
    expect(code).toBeUndefined()
    expect(patchCalls()).toHaveLength(1)
  })
})
