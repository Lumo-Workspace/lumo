/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('child_process', () => ({ spawnSync: jest.fn() }))

import { spawnSync } from 'child_process'
import { verify, runCheckpointer } from '@/cli/src/commands/verify'
import { readCredentials } from '@/cli/src/lib/config'

const mockSpawn = spawnSync as jest.Mock
const mockCreds = readCredentials as jest.Mock

function spawnResult(over: Record<string, unknown> = {}) {
  return {
    status: 0,
    signal: null,
    error: undefined,
    stdout: 'ok',
    stderr: '',
    ...over,
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const MACHINE_CRITERION = {
  id: 'c-1',
  statement: 'route rejects bad input',
  verifierType: 'MACHINE',
  checkpointer: 'npx jest x.test.ts',
  evidenceRequired: false,
  source: 'AGENT_DRAFT',
  addedAtRound: 0,
}
const HUMAN_CRITERION = {
  id: 'c-h',
  statement: 'copy reads well',
  verifierType: 'HUMAN',
  checkpointer: null,
  evidenceRequired: false,
  source: 'AGENT_DRAFT',
  addedAtRound: 0,
}

const PASS_OUTCOME = {
  round: 1,
  maxRounds: 3,
  allPassed: true,
  escalated: false,
  taskStatus: 'IN_REVIEW',
  results: [{ criterionId: 'c-1', statement: 's', verdict: 'PASS' }],
  nextActions: [],
}

// LUM-597/LUM-733: the agent's optional self-report, sent with the round when given.
const NOTE = 'implemented X in foo.ts because Y; tests + tsc pass'

let writeSpy: jest.SpyInstance
let errSpy: jest.SpyInstance
const OLD_SESSION = process.env.CLAUDE_CODE_SESSION_ID

beforeEach(() => {
  jest.clearAllMocks()
  mockCreds.mockReturnValue({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })
  delete process.env.CLAUDE_CODE_SESSION_ID
  writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  mockSpawn.mockReturnValue(spawnResult())
})

afterEach(() => {
  writeSpy.mockRestore()
  errSpy.mockRestore()
  if (OLD_SESSION === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
  else process.env.CLAUDE_CODE_SESSION_ID = OLD_SESSION
})

function stdout(): string {
  return writeSpy.mock.calls.map(c => c[0]).join('')
}
function stderr(): string {
  return errSpy.mock.calls.map(c => c.join(' ')).join('\n')
}

describe('runCheckpointer', () => {
  it('does not leak the CLI-only LUMO_NO_HINTS mute into the checkpointer env', () => {
    // `lumo verify --no-hints` folds the flag into process.env; a checkpointer
    // that inherits it (e.g. a jest suite covering the hints block) would fail
    // for a reason unrelated to the criterion.
    const old = process.env.LUMO_NO_HINTS
    process.env.LUMO_NO_HINTS = '1'
    try {
      runCheckpointer('c-1', 'npx jest x.test.ts', 1000)
    } finally {
      if (old === undefined) delete process.env.LUMO_NO_HINTS
      else process.env.LUMO_NO_HINTS = old
    }
    const opts = mockSpawn.mock.calls[0]![1] as { env?: NodeJS.ProcessEnv }
    expect(opts.env).toBeDefined()
    expect(opts.env!.LUMO_NO_HINTS).toBeUndefined()
    // The rest of the environment still reaches the check.
    expect(opts.env!.PATH).toBe(process.env.PATH)
  })

  it('exit 0 → PASS with a cmd evidence pointer', () => {
    mockSpawn.mockReturnValue(spawnResult({ status: 0 }))
    const v = runCheckpointer('c-1', 'npx jest', 1000)
    expect(v).toEqual({
      criterionId: 'c-1',
      verdict: 'PASS',
      evidencePointer: 'cmd:npx jest#exit=0',
    })
  })

  it('non-zero exit → FAIL CRITERION_UNMET with output tail and exit pointer', () => {
    mockSpawn.mockReturnValue(
      spawnResult({ status: 2, stdout: 'some output', stderr: '3 failed' })
    )
    const v = runCheckpointer('c-1', 'npx jest', 1000)
    expect(v.verdict).toBe('FAIL')
    expect(v.rejectionReasonEnum).toBe('CRITERION_UNMET')
    expect(v.evidencePointer).toBe('cmd:npx jest#exit=2')
    expect(v.rejectionReason).toContain('3 failed')
  })

  it('spawn error → FAIL CHECK_EXECUTION_ERROR', () => {
    mockSpawn.mockReturnValue(
      spawnResult({ status: null, error: new Error('ENOENT') })
    )
    const v = runCheckpointer('c-1', 'nope', 1000)
    expect(v.verdict).toBe('FAIL')
    expect(v.rejectionReasonEnum).toBe('CHECK_EXECUTION_ERROR')
    expect(v.rejectionReason).toContain('failed to execute')
  })

  it('timeout → FAIL CHECK_EXECUTION_ERROR mentioning the timeout', () => {
    const err = Object.assign(new Error('spawnSync ETIMEDOUT'), {
      code: 'ETIMEDOUT',
    })
    mockSpawn.mockReturnValue(
      spawnResult({ status: null, error: err, signal: 'SIGTERM' })
    )
    const v = runCheckpointer('c-1', 'npx jest', 5000)
    expect(v.rejectionReasonEnum).toBe('CHECK_EXECUTION_ERROR')
    expect(v.rejectionReason).toContain('timed out after 5s')
  })
})

describe('verify — task resolution', () => {
  it('errors when not logged in', async () => {
    mockCreds.mockReturnValue(null)
    expect(await verify('LUM-9')).toBe(1)
    expect(stderr()).toContain('not logged in')
  })

  it('errors when no task given and no session env', async () => {
    expect(await verify(undefined)).toBe(1)
    expect(stderr()).toContain('lumo verify <LUM-N>')
  })

  it('resolves the session-bound task when no identifier is given', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'sess-1'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async url => {
        const u = String(url)
        if (u.includes('/api/sessions/'))
          return jsonResponse(200, { taskIdentifier: 'LUM-9' })
        if (u.endsWith('/criteria'))
          return jsonResponse(200, { criteria: [MACHINE_CRITERION] })
        return jsonResponse(200, PASS_OUTCOME)
      })
    expect(await verify(undefined, { note: NOTE })).toBeUndefined()
    expect(
      fetchSpy.mock.calls.some(c =>
        String(c[0]).includes('/api/tasks/LUM-9/criteria')
      )
    ).toBe(true)
  })

  it('errors when the session is unbound', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'sess-1'
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, { taskIdentifier: null }))
    expect(await verify(undefined)).toBe(1)
    expect(stderr()).toContain('not bound to a task')
  })
})

describe('verify — contract edge cases', () => {
  it('no contract yet → exit 1 pointing at criteria set, no round posted', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, { criteria: [] }))
    expect(await verify('LUM-9')).toBe(1)
    expect(stdout()).toContain('criteria set')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('HUMAN-only contract → nothing to run, no server write, exit 0', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, { criteria: [HUMAN_CRITERION] }))
    expect(await verify('LUM-9')).toBeUndefined()
    expect(stdout()).toContain('no MACHINE criteria')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('LUM-789: HUMAN-only contract points at in_review, not a hand-off obligation', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, { criteria: [HUMAN_CRITERION] }))
    expect(await verify('LUM-9')).toBeUndefined()
    const out = stdout()
    expect(out).toContain('tacit')
    expect(out).toContain('sent back')
    expect(out).toContain('lumo task update LUM-9 --status in_review')
    expect(out).not.toContain('hand off for human review')
  })
})

describe('verify — the loop', () => {
  function routedFetch(outcome: unknown) {
    return jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url)
      if (u.endsWith('/criteria'))
        return jsonResponse(200, {
          criteria: [MACHINE_CRITERION, HUMAN_CRITERION],
        })
      if (u.endsWith('/verify')) {
        expect((init as RequestInit).method).toBe('POST')
        return jsonResponse(200, outcome)
      }
      throw new Error(`unexpected fetch ${u}`)
    })
  }

  it('runs every MACHINE checkpointer and POSTs one structured verdict per criterion', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'sess-1'
    const fetchSpy = routedFetch(PASS_OUTCOME)
    mockSpawn.mockReturnValue(spawnResult({ status: 0 }))

    expect(await verify('LUM-9', { note: NOTE })).toBeUndefined()

    expect(mockSpawn).toHaveBeenCalledTimes(1)
    expect(mockSpawn.mock.calls[0]![0]).toBe('npx jest x.test.ts')

    const post = fetchSpy.mock.calls.find(c =>
      String(c[0]).endsWith('/verify')
    )!
    const init = post[1] as RequestInit
    expect((init.headers as Record<string, string>)['X-Lumo-Session-Id']).toBe(
      'sess-1'
    )
    const body = JSON.parse(String(init.body))
    expect(body.results).toEqual([
      {
        criterionId: 'c-1',
        verdict: 'PASS',
        evidencePointer: 'cmd:npx jest x.test.ts#exit=0',
      },
    ])
    // LUM-597: the self-report is sent with the round.
    expect(body.note).toBe(NOTE)
    expect(stdout()).toContain('IN_REVIEW')
    expect(stdout()).toContain('Round 1/3')
  })

  it('prints nextActions and exits 1 on a failing round', async () => {
    routedFetch({
      ...PASS_OUTCOME,
      allPassed: false,
      taskStatus: 'IN_PROGRESS',
      nextActions: [
        {
          criterionId: 'c-1',
          statement: 'route rejects bad input',
          checkpointer: 'npx jest x.test.ts',
          rejectionReason: '3 tests failed',
        },
      ],
    })
    mockSpawn.mockReturnValue(spawnResult({ status: 1, stderr: 'failures' }))

    expect(await verify('LUM-9', { note: NOTE })).toBe(1)
    const out = stdout()
    expect(out).toContain('Next actions')
    expect(out).toContain('route rejects bad input')
    expect(out).toContain('3 tests failed')
    expect(out).toContain('re-run')
  })

  it('prints the stop message and exits 1 on escalation', async () => {
    routedFetch({
      ...PASS_OUTCOME,
      round: 3,
      allPassed: false,
      escalated: true,
      taskStatus: 'IN_PROGRESS',
      nextActions: [],
    })
    mockSpawn.mockReturnValue(spawnResult({ status: 1 }))

    expect(await verify('LUM-9', { note: NOTE })).toBe(1)
    expect(stdout()).toContain('STOP retrying')
  })

  it('surfaces a server rejection (409 cap) with the sanitized message', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async url => {
      const u = String(url)
      if (u.endsWith('/criteria'))
        return jsonResponse(200, { criteria: [MACHINE_CRITERION] })
      return jsonResponse(409, { error: 'capped \x1b[31m— escalated' })
    })
    expect(await verify('LUM-9', { note: NOTE })).toBe(1)
    expect(stderr()).toContain('HTTP 409')
    expect(stderr()).toContain('capped')
    expect(stderr()).not.toContain('\x1b')
  })
})
