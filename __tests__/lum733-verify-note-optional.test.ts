/** @jest-environment node */
/**
 * LUM-733: `--note` is optional on `lumo verify`. A round posts without it
 * (the claim degrades to the synthesized run summary server-side); when given,
 * the note still rides with the round body.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('child_process', () => ({ spawnSync: jest.fn() }))

import { spawnSync } from 'child_process'
import { verify } from '@/cli/src/commands/verify'

const mockSpawn = spawnSync as jest.Mock

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
const PASS_OUTCOME = {
  round: 1,
  maxRounds: 3,
  allPassed: true,
  escalated: false,
  taskStatus: 'IN_REVIEW',
  results: [{ criterionId: 'c-1', statement: 's', verdict: 'PASS' }],
  nextActions: [],
}

function routedFetch() {
  return jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
    const u = String(url)
    if (u.endsWith('/criteria'))
      return jsonResponse(200, { criteria: [MACHINE_CRITERION] })
    if (u.endsWith('/verify')) {
      expect((init as RequestInit).method).toBe('POST')
      return jsonResponse(200, PASS_OUTCOME)
    }
    throw new Error(`unexpected fetch ${u}`)
  })
}

let writeSpy: jest.SpyInstance
let errSpy: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  mockSpawn.mockReturnValue({
    status: 0,
    signal: null,
    error: undefined,
    stdout: 'ok',
    stderr: '',
  })
})
afterEach(() => {
  writeSpy.mockRestore()
  errSpy.mockRestore()
})

function postedBody(fetchSpy: jest.SpyInstance): Record<string, unknown> {
  const post = fetchSpy.mock.calls.find(c => String(c[0]).endsWith('/verify'))!
  return JSON.parse(String((post[1] as RequestInit).body))
}

describe('LUM-733 verify --note is optional', () => {
  it('LUM-733 verify posts a round without --note', async () => {
    const fetchSpy = routedFetch()
    expect(await verify('LUM-9')).toBeUndefined()
    // The checkpointer ran and the round was posted.
    expect(mockSpawn).toHaveBeenCalledTimes(1)
    const body = postedBody(fetchSpy)
    expect(body.results).toHaveLength(1)
    expect(body).not.toHaveProperty('note')
    expect(errSpy.mock.calls.flat().join('\n')).not.toContain(
      '--note is required'
    )
  })

  it('a blank note is treated as absent, a real note still rides with the round', async () => {
    let fetchSpy = routedFetch()
    expect(await verify('LUM-9', { note: '   ' })).toBeUndefined()
    expect(postedBody(fetchSpy)).not.toHaveProperty('note')

    jest.restoreAllMocks()
    writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockSpawn.mockReturnValue({
      status: 0,
      signal: null,
      error: undefined,
      stdout: 'ok',
      stderr: '',
    })
    fetchSpy = routedFetch()
    expect(
      await verify('LUM-9', { note: 'implemented X because Y' })
    ).toBeUndefined()
    expect(postedBody(fetchSpy).note).toBe('implemented X because Y')
  })
})
