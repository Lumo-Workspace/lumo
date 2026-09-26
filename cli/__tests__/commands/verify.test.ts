/**
 * @jest-environment node
 *
 * Tests for `lumo verify` — the machine half of the acceptance loop.
 * Covers the bindingAdvisory advisory printed after the round is recorded.
 */
jest.mock('../../src/lib/config', () => ({
  readCredentials: jest.fn(),
}))
jest.mock('child_process', () => ({
  spawnSync: jest.fn(),
}))

import { spawnSync } from 'child_process'
import { readCredentials } from '../../src/lib/config'
import { verify } from '../../src/commands/verify'

const mockReadCredentials = readCredentials as jest.Mock
const mockSpawnSync = spawnSync as jest.Mock

const CREDS = { token: 'tok', apiUrl: 'https://lumo.test', workspaceSlug: 'ws' }

/** A minimal MACHINE criterion fixture. */
const CRITERION = {
  id: 'c-abc123',
  statement: 'Tests pass',
  verifierType: 'MACHINE' as const,
  checkpointer: 'npm test',
  source: 'DRAFT' as const,
  identifier: 'c-abc123',
}

/** LUM-842: the post-round status digest reads GET /status. */
const STATUS_RESPONSE = {
  version: 1,
  task: { id: 't1', identifier: 'LUM-491', title: 'T', status: 'IN_REVIEW' },
  currentRound: 1,
  maxRounds: 3,
  escalated: false,
  criteria: [],
  nextActions: [],
  securityFindings: { open: 0, blocking: 0, unconfirmedPrs: [] },
}

/** Build a stubbed global.fetch that routes by URL. */
function stubFetch(criteriaResponse: object, verifyResponse: object) {
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    const body = url.endsWith('/criteria')
      ? criteriaResponse
      : url.endsWith('/status')
        ? STATUS_RESPONSE
        : url.endsWith('/boundary-crossings')
          ? { crossings: [] }
          : verifyResponse // POST /verify
    return { ok: true, status: 200, json: async () => body }
  }) as unknown as typeof fetch
}

let stdoutSpy: jest.SpyInstance
let stderrSpy: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  mockReadCredentials.mockReturnValue(CREDS)
  // Default spawnSync: checkpointer exits 0 (PASS)
  mockSpawnSync.mockReturnValue({
    status: 0,
    stdout: '',
    stderr: '',
    error: undefined,
  })
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  stderrSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  stdoutSpy.mockRestore()
  stderrSpy.mockRestore()
})

/** Collect all process.stdout.write calls as one string. */
function capturedOutput(): string {
  return stdoutSpy.mock.calls.map(c => c[0] as string).join('')
}

describe('bindingAdvisory', () => {
  it('prints a Working-unbound warning when bindingAdvisory is "unbound"', async () => {
    stubFetch(
      { criteria: [CRITERION] },
      {
        round: 1,
        maxRounds: 3,
        allPassed: true,
        escalated: false,
        taskStatus: 'IN_REVIEW',
        bindingAdvisory: 'unbound',
        results: [
          {
            criterionId: CRITERION.id,
            statement: CRITERION.statement,
            verdict: 'PASS',
          },
        ],
        nextActions: [],
      }
    )

    const exit = await verify('LUM-491', {
      note: 'implemented the change; tests pass',
    })

    expect(exit).toBeUndefined() // allPassed path exits with no code
    const out = capturedOutput()
    expect(out).toContain('Working unbound')
    expect(out).toContain('lumo session attach')
  })

  it('prints a could-not-confirm warning when bindingAdvisory is "unconfirmed"', async () => {
    stubFetch(
      { criteria: [CRITERION] },
      {
        round: 1,
        maxRounds: 3,
        allPassed: true,
        escalated: false,
        taskStatus: 'IN_REVIEW',
        bindingAdvisory: 'unconfirmed',
        results: [
          {
            criterionId: CRITERION.id,
            statement: CRITERION.statement,
            verdict: 'PASS',
          },
        ],
        nextActions: [],
      }
    )

    const exit = await verify('LUM-491', {
      note: 'implemented the change; tests pass',
    })

    expect(exit).toBeUndefined()
    const out = capturedOutput()
    expect(out).toContain('Could not confirm this session is attached')
    expect(out).toContain('lumo session attach')
  })

  it('prints no advisory when bindingAdvisory is null', async () => {
    stubFetch(
      { criteria: [CRITERION] },
      {
        round: 1,
        maxRounds: 3,
        allPassed: true,
        escalated: false,
        taskStatus: 'IN_REVIEW',
        bindingAdvisory: null,
        results: [
          {
            criterionId: CRITERION.id,
            statement: CRITERION.statement,
            verdict: 'PASS',
          },
        ],
        nextActions: [],
      }
    )

    const exit = await verify('LUM-491', {
      note: 'implemented the change; tests pass',
    })

    expect(exit).toBeUndefined()
    const out = capturedOutput()
    expect(out).not.toContain('⚠')
  })

  it('prints no advisory when bindingAdvisory is absent', async () => {
    stubFetch(
      { criteria: [CRITERION] },
      {
        round: 1,
        maxRounds: 3,
        allPassed: true,
        escalated: false,
        taskStatus: 'IN_REVIEW',
        results: [
          {
            criterionId: CRITERION.id,
            statement: CRITERION.statement,
            verdict: 'PASS',
          },
        ],
        nextActions: [],
      }
    )

    const exit = await verify('LUM-491', {
      note: 'implemented the change; tests pass',
    })

    expect(exit).toBeUndefined()
    const out = capturedOutput()
    expect(out).not.toContain('⚠')
  })
})
