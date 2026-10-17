/**
 * @jest-environment node
 *
 * LUM-1008 — `testcase show` / `testcase list` print who ran each run and, when
 * it came from an agent session, that session's short id. A null runner reads
 * "runner not recorded"; an old server that sends no `executedBy` prints
 * nothing extra.
 */
jest.mock('../../src/lib/config', () => ({
  readCredentials: jest.fn(),
}))
jest.mock('../../src/lib/session-id', () => ({
  resolveSessionId: jest.fn(),
}))
jest.mock('../../src/lib/status-digest', () => ({
  printStatusDigest: jest.fn(),
}))

import { readCredentials } from '../../src/lib/config'
import { formatExecutor } from '../../src/lib/test-case-executor'
import { taskTestCaseList } from '../../src/commands/task-testcase-list'
import { taskTestCaseShow } from '../../src/commands/task-testcase-show'
import { taskTestCaseRun } from '../../src/commands/task-testcase-run'
import { resolveSessionId } from '../../src/lib/session-id'

const SESSION = '86dce765-abe3-4254-89c8-7a788200194a'

let logSpy: jest.SpyInstance
let errorSpy: jest.SpyInstance
const printed = () => logSpy.mock.calls.map(c => String(c[0])).join('\n')

const respond = (body: unknown) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  }) as never
}

const baseRun = {
  id: 'r1',
  result: 'PASS',
  environment: 'LOCAL',
  failedPhase: null,
  failedIndex: null,
  failedStepText: null,
  note: null,
  evidence: [],
  pullRequestId: null,
  commitSha: null,
  commitDirty: null,
  createdAt: '2026-10-06T08:00:00.000Z',
  disposition: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(readCredentials as jest.Mock).mockReturnValue({
    token: 't',
    apiUrl: 'https://x',
    workspaceSlug: 'lumo',
  })
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
  errorSpy.mockRestore()
})

describe('formatExecutor', () => {
  it('names the runner and the agent session it came from', () => {
    expect(
      formatExecutor({ executedBy: 'Ada Lovelace', sourceSessionId: SESSION })
    ).toBe('by Ada Lovelace via session 86dce765')
  })

  it('omits the session when the run carries none', () => {
    expect(formatExecutor({ executedBy: 'Bo', sourceSessionId: null })).toBe(
      'by Bo'
    )
  })

  it('reads a null runner as not recorded', () => {
    expect(formatExecutor({ executedBy: null, sourceSessionId: null })).toBe(
      'runner not recorded'
    )
  })

  it('prints nothing for an old server that sends no executedBy', () => {
    expect(formatExecutor({ sourceSessionId: SESSION })).toBe('')
  })

  it('strips terminal control sequences from a member-supplied name', () => {
    expect(
      formatExecutor({ executedBy: 'Eve\u001b[31m', sourceSessionId: null })
    ).not.toContain('\u001b')
  })
})

describe('testcase list', () => {
  it('appends the runner to the latest-run summary', async () => {
    respond({
      testCases: [
        {
          number: 1,
          title: 'Footer disclosure',
          steps: ['a'],
          verification: [],
          runs: [
            {
              ...baseRun,
              executedBy: 'Ada Lovelace',
              sourceSessionId: SESSION,
            },
          ],
        },
      ],
    })

    await taskTestCaseList('LUM-1')

    expect(printed()).toContain(
      'PASS on LOCAL 2026-10-06T08:00:00Z by Ada Lovelace via session 86dce765'
    )
  })
})

describe('testcase show', () => {
  it('prints the runner on every run line', async () => {
    respond({
      testCase: {
        number: 1,
        title: 'Footer disclosure',
        setup: null,
        steps: ['a'],
        verification: [],
        expected: 'visible',
        requiredEnvironment: null,
      },
      runs: [
        { ...baseRun, id: 'r2', executedBy: 'Bo', sourceSessionId: null },
        { ...baseRun, id: 'r1', executedBy: null, sourceSessionId: null },
      ],
      pullRequests: [],
    })

    await taskTestCaseShow('LUM-1/TC1')

    expect(printed()).toContain('2026-10-06T08:00:00Z  PASS on LOCAL  by Bo')
    expect(printed()).toContain(
      '2026-10-06T08:00:00Z  PASS on LOCAL  runner not recorded'
    )
  })
})

// The run's member is the token owner, so "an agent ran it" is only legible if
// the run carries its source session. Before LUM-1008 `testcase run` never sent
// the header and every CLI run landed with sourceSessionId = null.
describe('testcase run', () => {
  const runHeaders = () => {
    const call = (global.fetch as jest.Mock).mock.calls.find(([url]) =>
      String(url).endsWith('/runs')
    )
    return (call?.[1] as RequestInit).headers as Record<string, string>
  }

  beforeEach(() => {
    respond({ run: { ...baseRun, executedByMemberId: 'm-1' }, ceiling: null })
  })

  it('sends the Claude Code session as X-Lumo-Session-Id', async () => {
    ;(resolveSessionId as jest.Mock).mockResolvedValue(SESSION)

    await taskTestCaseRun('LUM-1/TC1', { result: 'pass', env: 'local' })

    expect(runHeaders()['X-Lumo-Session-Id']).toBe(SESSION)
  })

  it('sends no session header outside a Claude Code session', async () => {
    ;(resolveSessionId as jest.Mock).mockResolvedValue(undefined)

    await taskTestCaseRun('LUM-1/TC1', { result: 'pass', env: 'local' })

    expect(runHeaders()).not.toHaveProperty('X-Lumo-Session-Id')
  })
})
