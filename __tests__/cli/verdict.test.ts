/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('@/cli/src/lib/browser', () => ({ openBrowser: jest.fn() }))

import { verdict, collectCriterion } from '@/cli/src/commands/verdict'
import { openBrowser } from '@/cli/src/lib/browser'

const mockOpen = openBrowser as jest.Mock

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const TASK_URL = 'https://api.test/workspace/lumo/projects/p/tasks/LUM-42'

let fetchMock: jest.Mock
let stdout: string[]
let stderr: string[]

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.CLAUDE_CODE_SESSION_ID
  stdout = []
  stderr = []
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    stdout.push(String(s))
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((...a) => {
    stderr.push(a.join(' '))
  })
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('mode validation', () => {
  it('errors when no mode is given', async () => {
    const code = await verdict('LUM-42', {})
    expect(code).toBe(1)
    expect(stderr.join('\n')).toMatch(
      /choose a verdict mode — --pass or --fail/
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('errors when more than one mode is given', async () => {
    const code = await verdict('LUM-42', { pass: true, fail: true })
    expect(code).toBe(1)
    expect(stderr.join('\n')).toMatch(/exactly one verdict mode/)
  })

  it('no longer recognizes a pass-with-followup mode (retired LUM-492)', async () => {
    // `passWithFollowup` was removed from VerdictOptions; an old caller passing
    // it is an unknown property, so no mode is selected and verdict errors.
    const code = await verdict('LUM-42', {
      passWithFollowup: true,
    } as unknown as Parameters<typeof verdict>[1])
    expect(code).toBe(1)
    expect(stderr.join('\n')).toMatch(
      /choose a verdict mode — --pass or --fail/
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('--pass deep link (writes nothing)', () => {
  it('opens the task page with ?verdict=pass and never POSTs', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { task: { url: TASK_URL } })
    )
    await verdict('LUM-42', { pass: true })

    // The only network call is the GET to resolve the task URL.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/api/tasks/by-identifier/LUM-42')
    expect(init?.method ?? 'GET').toBe('GET')

    expect(mockOpen).toHaveBeenCalledTimes(1)
    expect(mockOpen.mock.calls[0]![0]).toBe(`${TASK_URL}?verdict=pass`)
  })

  it('errors (no open) when the server returns no task url', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { task: {} }))
    const code = await verdict('LUM-42', { pass: true })
    expect(code).toBe(1)
    expect(mockOpen).not.toHaveBeenCalled()
  })
})

describe('--fail (AGENT send-back)', () => {
  it('requires --reason', async () => {
    const code = await verdict('LUM-42', { fail: true })
    expect(code).toBe(1)
    expect(stderr.join('\n')).toMatch(/--reason/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid reason', async () => {
    const code = await verdict('LUM-42', { fail: true, reason: 'NOPE' })
    expect(code).toBe(1)
    expect(stderr.join('\n')).toMatch(/invalid --reason/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs the agent-verdict with the required enum and optional note/criteria', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        round: 2,
        verdict: 'FAIL',
        taskStatus: 'IN_PROGRESS',
        criterionIds: ['c-1'],
        commentId: 'cmt-1',
      })
    )
    await verdict('LUM-42', {
      fail: true,
      reason: 'CRITERION_UNMET',
      note: 'redo the retry path',
      criterion: ['c-1'],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/api/tasks/LUM-42/agent-verdict')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init!.body as string)).toEqual({
      rejectionReasonEnum: 'CRITERION_UNMET',
      note: 'redo the retry path',
      criterionIds: ['c-1'],
    })
    expect(stdout.join('')).toMatch(/Sent LUM-42 back/)
  })

  it('surfaces a server rejection (e.g. 409 from the round cap)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: 'capped' }))
    const code = await verdict('LUM-42', { fail: true, reason: 'OTHER' })
    expect(code).toBe(1)
    expect(stderr.join('\n')).toMatch(/capped/)
  })
})

describe('collectCriterion', () => {
  it('accumulates repeatable --criterion flags', () => {
    expect(collectCriterion('c-2', collectCriterion('c-1'))).toEqual([
      'c-1',
      'c-2',
    ])
  })
})
