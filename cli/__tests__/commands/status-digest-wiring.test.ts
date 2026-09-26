/**
 * @jest-environment node
 *
 * LUM-842: every command that changes a task's acceptance state ends its
 * output with the status digest (the `task status` read, shortened), and the
 * `task update` DONE envelopes carry it as an additive `statusSummary` field
 * so their JSON stays parseable.
 */
jest.mock('../../src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('child_process', () => ({
  spawnSync: jest.fn(() => ({ status: 0, stdout: '', stderr: '' })),
}))
// DONE also plans local worktree cleanup; keep it off the real checkout.
jest.mock('../../src/lib/worktree-cleanup', () => ({
  ...jest.requireActual('../../src/lib/worktree-cleanup'),
  planTaskWorktreeCleanup: jest.fn(() => null),
}))

import { verify } from '../../src/commands/verify'
import { taskUpdate } from '../../src/commands/task-update'
import { crossingDisposition } from '../../src/commands/crossing-disposition'
import { crossingExplain } from '../../src/commands/crossing-explain'
import { taskTestCaseRun } from '../../src/commands/task-testcase-run'
import { taskTestCaseDisposition } from '../../src/commands/task-testcase-disposition'

function json(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const DIGEST_HEAD = 'Status now (same read as `lumo task status LUM-5`'
const DIGEST_STATE = '  LUM-5 IN_REVIEW · round 1/3 · criteria 1/1 met'
const DIGEST_BLOCKS =
  '  Blocks DONE: 1 boundary crossing (cx-1) — the user rules'

const CROSSING = {
  id: 'cx-1',
  category: 'TEST_FILE_DELETED',
  severity: 'MEDIUM',
  detail: 'deleted a test',
  advisory: false,
  disposition: null,
}

const STATUS = {
  version: 1,
  task: { id: 't', identifier: 'LUM-5', title: 'T', status: 'IN_REVIEW' },
  currentRound: 1,
  maxRounds: 3,
  escalated: false,
  criteria: [
    {
      id: 'c1',
      statement: 'Tests pass',
      verifierType: 'MACHINE',
      checkpointer: 'npm test',
      latestVerdict: { round: 1, verdict: 'PASS' },
      confirmedAt: '2026-09-25T00:00:00.000Z',
    },
  ],
  nextActions: [],
  securityFindings: { open: 0, blocking: 0, unconfirmedPrs: [] },
}

const GATE_MSG =
  'Cannot move this task to DONE: 1 boundary crossing needs a disposition'

let fetchMock: jest.Mock
let out: string[]
let patchStatus = 200
const savedSession = process.env.CLAUDE_CODE_SESSION_ID
const savedArgv = process.argv
const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

function route(url: string, init?: { method?: string }) {
  const method = init?.method ?? 'GET'
  if (url.includes('/api/sessions/'))
    return json(200, { taskIdentifier: 'LUM-5' })
  if (url.endsWith('/LUM-5/status')) return json(200, STATUS)
  if (url.endsWith('/boundary-crossings') && method === 'GET')
    return json(200, { crossings: [CROSSING] })
  if (url.endsWith('/LUM-5/criteria'))
    return json(200, {
      criteria: [
        {
          id: 'c1',
          statement: 'Tests pass',
          verifierType: 'MACHINE',
          checkpointer: 'npm test',
          confirmedAt: '2026-09-25T00:00:00.000Z',
        },
      ],
    })
  if (url.endsWith('/LUM-5/verify'))
    return json(200, {
      round: 1,
      maxRounds: 3,
      allPassed: true,
      escalated: false,
      taskStatus: 'IN_REVIEW',
      nextActions: [],
    })
  if (url.endsWith('/by-identifier/LUM-5') && method === 'PATCH')
    return patchStatus === 200
      ? json(200, {
          task: {
            id: 't',
            identifier: 'LUM-5',
            title: 'T',
            url: 'https://api.lumo.test/t/LUM-5',
          },
        })
      : json(patchStatus, { error: GATE_MSG })
  if (url.endsWith('/by-identifier/LUM-5'))
    return json(200, {
      task: {
        identifier: 'LUM-5',
        title: 'T',
        status: 'IN_REVIEW',
        pullRequests: [],
      },
    })
  if (url.endsWith('/boundary-crossings/cx-1/disposition'))
    return json(200, { crossingId: 'cx-1', disposition: 'FALSE_POSITIVE' })
  if (url.endsWith('/boundary-crossings/cx-1/explain'))
    return json(200, { crossingId: 'cx-1' })
  if (url.endsWith('/test-cases/TC1/runs'))
    return json(200, {
      run: { result: 'PASS', environment: 'PREVIEW', failedStepText: null },
      ceiling: { effective: 'PASS' },
    })
  if (url.endsWith('/test-cases/TC1'))
    return json(200, {
      testCase: { number: 1, title: 'case' },
      runs: [
        {
          id: 'run-1',
          result: 'FAIL',
          failureAttribution: 'IMPLEMENTATION_DEFECT',
          evidence: [],
          createdAt: '2026-09-25T00:00:00.000Z',
          disposition: null,
        },
      ],
    })
  if (url.endsWith('/test-case-runs/run-1/disposition'))
    return json(200, { disposition: 'KNOWN_DEFECT' })
  throw new Error(`unexpected fetch ${method} ${url}`)
}

beforeEach(() => {
  out = []
  patchStatus = 200
  process.env.CLAUDE_CODE_SESSION_ID = 'sess-1'
  fetchMock = jest.fn(async (url: string, init?: { method?: string }) =>
    route(url, init)
  )
  global.fetch = fetchMock as unknown as typeof fetch
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out.push(String(s))
    return true
  })
  jest.spyOn(console, 'log').mockImplementation((...a) => {
    out.push(a.join(' ') + '\n')
  })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  Object.defineProperty(process.stdout, 'isTTY', {
    value: false,
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  jest.restoreAllMocks()
  process.argv = savedArgv
  if (savedSession === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
  else process.env.CLAUDE_CODE_SESSION_ID = savedSession
  if (stdoutTTY) Object.defineProperty(process.stdout, 'isTTY', stdoutTTY)
  else delete (process.stdout as { isTTY?: boolean }).isTTY
})

/** The digest is the last thing the command printed. */
function expectEndsWithDigest(): void {
  const lines = out.join('').trimEnd().split('\n')
  expect(lines.slice(-3)).toEqual([
    expect.stringContaining(DIGEST_HEAD),
    DIGEST_STATE,
    DIGEST_BLOCKS,
  ])
  const statusReads = fetchMock.mock.calls.filter(c =>
    String(c[0]).endsWith('/LUM-5/status')
  )
  expect(statusReads).toHaveLength(1)
}

describe('mutating commands append the status digest', () => {
  it('mutating commands append the status digest: verify', async () => {
    await verify('LUM-5', { note: 'n' })
    expect(out.join('')).toContain('Round 1/3 recorded.')
    expectEndsWithDigest()
  })

  it('mutating commands append the status digest: task update --status', async () => {
    const code = await taskUpdate('LUM-5', { status: 'in_review' })
    expect(code).toBeUndefined()
    expect(out.join('')).toContain('Updated LUM-5')
    expectEndsWithDigest()
  })

  it('mutating commands append the status digest: crossing disposition', async () => {
    await crossingDisposition('cx-1', {
      falsePositive: true,
      confirm: true,
      receipt: 'r2.1.2.3.sig',
    })
    expect(out.join('')).toContain('Dispositioned crossing cx-1')
    expectEndsWithDigest()
  })

  it('mutating commands append the status digest: crossing explain', async () => {
    await crossingExplain('cx-1', { note: 'why' })
    expect(out.join('')).toContain('Recorded an explanation on crossing cx-1')
    expectEndsWithDigest()
  })

  it('mutating commands append the status digest: testcase run', async () => {
    const code = await taskTestCaseRun('LUM-5/TC1', {
      result: 'pass',
      env: 'preview',
    })
    expect(code).toBeUndefined()
    expectEndsWithDigest()
  })

  it('mutating commands append the status digest: testcase disposition', async () => {
    await taskTestCaseDisposition('LUM-5/TC1', {
      knownDefect: true,
      confirm: true,
      receipt: 'r2.1.2.3.sig',
    })
    expect(out.join('')).toContain('Dispositioned LUM-5/TC1 run run-1')
    expectEndsWithDigest()
  })

  it('mutating commands append the status digest: not on a non-status task update', async () => {
    await taskUpdate('LUM-5', { title: 'renamed' })
    expect(out.join('')).not.toContain(DIGEST_HEAD)
  })
})

describe('task update envelopes carry statusSummary', () => {
  it('task update envelopes carry statusSummary: exit 4 confirmation envelope', async () => {
    process.argv = [
      'node',
      'lumo',
      'task',
      'update',
      'LUM-5',
      '--status',
      'done',
    ]
    const code = await taskUpdate('LUM-5', { status: 'done' })
    expect(code).toBe(4)
    const envelope = JSON.parse(out.join('')) as {
      status: string
      confirmCommand: string
      statusSummary: string[]
    }
    expect(envelope.status).toBe('confirmation_required')
    expect(envelope.confirmCommand).toBe(
      'lumo task update LUM-5 --status done --confirm'
    )
    expect(envelope.statusSummary.slice(1)).toEqual([
      DIGEST_STATE,
      DIGEST_BLOCKS,
    ])
    // Nothing was written.
    expect(
      fetchMock.mock.calls.filter(c => (c[1] as RequestInit)?.method)
    ).toHaveLength(0)
  })

  it('task update envelopes carry statusSummary: exit 5 DONE_BLOCKED error', async () => {
    patchStatus = 409
    const code = await taskUpdate('LUM-5', { status: 'done', confirm: true })
    expect(code).toBe(5)
    const err = JSON.parse(out.join('')) as {
      code: string
      blockers: unknown[]
      statusSummary: string[]
    }
    expect(err.code).toBe('DONE_BLOCKED')
    expect(err.blockers).toHaveLength(1)
    expect(err.statusSummary.slice(1)).toEqual([DIGEST_STATE, DIGEST_BLOCKS])
  })
})
