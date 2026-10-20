/**
 * @jest-environment node
 *
 * LUM-1282: `lumo task update <id> --status canceled [--duplicate-of <LUM-N>]`
 * is the user's ruling. Without --confirm it always exits 4 with the
 * confirmation_required envelope (no one-step path, even when DONE's
 * merged-PR condition would hold) and sends no PATCH; with --confirm the
 * PATCH carries the status and the duplicate target. --duplicate-of is
 * validated before any network call, and a missing target fails before the
 * envelope.
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
jest.mock('../../cli/src/lib/session-id', () => ({
  resolveSessionId: async () => undefined,
  AmbiguousSessionError: class extends Error {},
}))

import {
  taskUpdate,
  buildUpdatePayload,
  describeCancelTransition,
  duplicateOfUsageError,
  normalizeStatus,
} from '@/cli/src/commands/task-update'
import { EXIT_USAGE } from '@/cli/src/lib/exit-codes'

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const TASKS: Record<string, { title: string; status: string }> = {
  'LUM-1': { title: 'My Task', status: 'TODO' },
  'LUM-2': { title: 'Canonical', status: 'IN_PROGRESS' },
}

let fetchMock: jest.Mock
let stdout: string[]
let stderr: string[]
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
  fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    const m = /\/api\/tasks\/by-identifier\/([^/?]+)$/.exec(url)
    if (m) {
      const id = decodeURIComponent(m[1]!)
      if (init?.method === 'PATCH') {
        return jsonResponse(200, {
          task: {
            id: 'task-1',
            identifier: id,
            title: TASKS[id]?.title ?? 'x',
            url: `https://api.lumo.test/workspace/lumo/my-tasks/${id}`,
            taskTags: [],
          },
        })
      }
      const t = TASKS[id]
      if (!t) return jsonResponse(404, { error: `Task ${id} not found` })
      return jsonResponse(200, {
        task: {
          id: `id-${id}`,
          identifier: id,
          title: t.title,
          status: t.status,
          // Would qualify DONE for one step — CANCELED must ignore it.
          pullRequests: [{ number: 9, title: 'x', url: null, state: 'merged' }],
        },
      })
    }
    if (url.endsWith('/status'))
      return jsonResponse(200, {
        task: { identifier: 'LUM-1', title: 'My Task', status: 'CANCELED' },
        nextActions: [],
        securityFindings: { open: 0, blocking: 0, unconfirmedPrs: [] },
      })
    if (url.endsWith('/boundary-crossings'))
      return jsonResponse(200, { crossings: [] })
    return jsonResponse(404, {})
  })
  global.fetch = fetchMock as unknown as typeof fetch
  Object.defineProperty(process.stdout, 'isTTY', {
    value: false,
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  jest.restoreAllMocks()
  process.argv = savedArgv
  if (stdoutTTY) Object.defineProperty(process.stdout, 'isTTY', stdoutTTY)
  else delete (process.stdout as { isTTY?: boolean }).isTTY
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

describe('task update --status canceled', () => {
  it('normalizes canceled as a status', () => {
    expect(normalizeStatus('canceled')).toBe('CANCELED')
    expect(normalizeStatus('CANCELED')).toBe('CANCELED')
  })

  it('without --confirm: exit 4 with the envelope and no PATCH, even when one-step DONE would apply', async () => {
    process.argv = [
      'node',
      'lumo',
      'task',
      'update',
      'LUM-1',
      '--status',
      'canceled',
    ]
    const code = await taskUpdate('LUM-1', { status: 'canceled' })
    expect(code).toBe(4)
    const env = envelope()
    expect(env.changes[0]).toBe('Will move LUM-1 "My Task" to CANCELED')
    expect(env.changes).toContain('Status: TODO → CANCELED')
    expect(env.changes.some(c => /only the user rules it/.test(c))).toBe(true)
    expect(env.confirmCommand).toBe(
      'lumo task update LUM-1 --status canceled --confirm'
    )
    expect(patchCalls()).toHaveLength(0)
  })

  it('with --duplicate-of: the envelope names the canonical task and the confirm command keeps the flag', async () => {
    process.argv = [
      'node',
      'lumo',
      'task',
      'update',
      'LUM-1',
      '--status',
      'canceled',
      '--duplicate-of',
      'LUM-2',
    ]
    const code = await taskUpdate('LUM-1', {
      status: 'canceled',
      duplicateOf: 'LUM-2',
    })
    expect(code).toBe(4)
    const env = envelope()
    expect(env.changes).toContain(
      'Duplicate of: LUM-2 "Canonical" (records a DUPLICATES dependency)'
    )
    expect(env.confirmCommand).toBe(
      'lumo task update LUM-1 --status canceled --duplicate-of LUM-2 --confirm'
    )
    expect(patchCalls()).toHaveLength(0)
  })

  it('with --confirm: PATCHes status CANCELED and the duplicate target', async () => {
    const code = await taskUpdate('LUM-1', {
      status: 'canceled',
      duplicateOf: 'lum-2',
      confirm: true,
      hints: false,
    })
    expect(code).toBeUndefined()
    const [call] = patchCalls()
    expect(call).toBeDefined()
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      status: 'CANCELED',
      duplicateOfRef: 'LUM-2',
    })
    expect(stdout.join('')).toContain('Updated LUM-1')
  })

  it('a missing --duplicate-of target fails before the envelope (exit 1)', async () => {
    const code = await taskUpdate('LUM-1', {
      status: 'canceled',
      duplicateOf: 'LUM-404',
    })
    expect(code).toBe(1)
    expect(stdout.join('')).toBe('')
    expect(stderr.join('\n')).toContain('Duplicate target LUM-404 not found')
    expect(patchCalls()).toHaveLength(0)
  })

  it('a self-reference is a usage error before any network call', async () => {
    const code = await taskUpdate('LUM-1', {
      status: 'canceled',
      duplicateOf: 'lum-1',
    })
    expect(code).toBe(EXIT_USAGE)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stderr.join('\n')).toContain('cannot point at LUM-1 itself')
  })

  it('--duplicate-of without --status canceled is a usage error', async () => {
    const code = await taskUpdate('LUM-1', {
      status: 'done',
      duplicateOf: 'LUM-2',
    })
    expect(code).toBe(EXIT_USAGE)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('pure helpers', () => {
  it('duplicateOfUsageError', () => {
    expect(duplicateOfUsageError('LUM-1', 'CANCELED', undefined)).toBeNull()
    expect(duplicateOfUsageError('LUM-1', 'CANCELED', 'LUM-2')).toBeNull()
    expect(duplicateOfUsageError('LUM-1', 'CANCELED', 'nope')).toMatch(
      /task identifier like LUM-12/
    )
    expect(duplicateOfUsageError('LUM-1', undefined, 'LUM-2')).toMatch(
      /needs --status canceled/
    )
  })

  it('buildUpdatePayload upper-cases the duplicate target', () => {
    expect(
      buildUpdatePayload({ status: 'CANCELED', duplicateOf: ' lum-7 ' })
    ).toEqual({
      payload: { status: 'CANCELED', duplicateOfRef: 'LUM-7' },
      flagsGiven: ['--status', '--duplicate-of'],
    })
  })

  it('describeCancelTransition without a duplicate', () => {
    const lines = describeCancelTransition(
      { identifier: 'LUM-1', title: 'A "quoted" one', status: 'IN_REVIEW' },
      null
    )
    expect(lines[0]).toBe('Will move LUM-1 "A \\"quoted\\" one" to CANCELED')
    expect(lines.some(l => l.startsWith('Duplicate of'))).toBe(false)
  })
})
