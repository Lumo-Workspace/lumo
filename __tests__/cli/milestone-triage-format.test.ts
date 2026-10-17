/** @jest-environment node */
/**
 * LUM-646: `lumo milestone triage` — steward batch agent-claimable annotation.
 * Covers the batch-mark PATCH flow (in-milestone tasks marked, absent skipped)
 * and the summary formatting for both claimable directions.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('@/cli/src/lib/resolve', () => ({
  resolveMilestoneId: jest.fn(async () => ({ id: 'm1', name: 'M1' })),
}))

import { milestoneTriage } from '@/cli/src/commands/milestone-triage'
import { formatBatchSummary } from '@/cli/src/lib/milestone-batch'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

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

// Milestone M1 contains LUM-1 and LUM-2 (not LUM-9).
const MILESTONE_TASKS = {
  tasks: [
    { id: 't1', number: 1, teamIdentifier: 'LUM' },
    { id: 't2', number: 2, teamIdentifier: 'LUM' },
  ],
}

function wireFetch(patchStatus = 200): void {
  fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
    if (url.includes('/tasks') && (!init || init.method !== 'PATCH')) {
      return Promise.resolve(jsonResponse(200, MILESTONE_TASKS))
    }
    // PATCH by-identifier
    return Promise.resolve(
      jsonResponse(patchStatus, { task: { id: 'x', identifier: 'LUM-1' } })
    )
  })
}

describe('LUM-646 milestone triage', () => {
  it('requires a direction (rejects when neither flag is set)', async () => {
    const code = await milestoneTriage('M1', ['LUM-1'], {})
    expect(code).toBe(2)
    expect(stderr.join('\n')).toMatch(/--claimable or --not-claimable/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects both --claimable and --not-claimable together', async () => {
    const code = await milestoneTriage('M1', ['LUM-1'], {
      claimable: true,
      notClaimable: true,
    })
    expect(code).toBe(2)
    expect(stderr.join('\n')).toMatch(/mutually exclusive/)
  })

  it('batch-marks in-milestone tasks claimable and PATCHes { claimable: true }', async () => {
    wireFetch()
    const code = await milestoneTriage('M1', ['LUM-1', 'LUM-2'], {
      claimable: true,
    })
    expect(code).toBeUndefined()
    const patches = fetchMock.mock.calls.filter(c => c[1]?.method === 'PATCH')
    expect(patches).toHaveLength(2)
    for (const [, init] of patches) {
      expect(JSON.parse(init.body)).toEqual({ claimable: true })
    }
    expect(stdout.join('')).toMatch(/M1: 2 marked claimable/)
  })

  it('PATCHes { claimable: false } for --not-claimable', async () => {
    wireFetch()
    await milestoneTriage('M1', ['LUM-1'], { notClaimable: true })
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')
    expect(JSON.parse(patch![1].body)).toEqual({ claimable: false })
    expect(stdout.join('')).toMatch(/marked not-claimable/)
  })

  it('skips tasks not in the milestone with a not-in-milestone note', async () => {
    wireFetch()
    const code = await milestoneTriage('M1', ['LUM-1', 'LUM-9'], {
      claimable: true,
    })
    expect(code).toBeUndefined()
    const patches = fetchMock.mock.calls.filter(c => c[1]?.method === 'PATCH')
    // Only LUM-1 is in the milestone; LUM-9 is skipped (no PATCH).
    expect(patches).toHaveLength(1)
    const out = stdout.join('')
    expect(out).toMatch(/1 marked claimable, 1 skipped/)
    expect(out).toMatch(/LUM-9.*not in this milestone/)
  })

  it('reports a non-zero code and per-task failure detail on a PATCH error', async () => {
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.includes('/tasks') && (!init || init.method !== 'PATCH')) {
        return Promise.resolve(jsonResponse(200, MILESTONE_TASKS))
      }
      return Promise.resolve(jsonResponse(403, { error: 'nope' }))
    })
    const code = await milestoneTriage('M1', ['LUM-1'], { claimable: true })
    expect(code).toBe(1)
    expect(stdout.join('')).toMatch(/1 failed/)
  })

  it('summary header names the direction verb', () => {
    const claimable = formatBatchSummary({
      milestoneName: 'M1',
      verb: 'marked claimable',
      outcomes: [{ task: 'LUM-1', status: 'ok' }],
    })
    expect(claimable).toMatch(/M1: 1 marked claimable/)
    const notClaimable = formatBatchSummary({
      milestoneName: 'M1',
      verb: 'marked not-claimable',
      outcomes: [{ task: 'LUM-1', status: 'ok' }],
    })
    expect(notClaimable).toMatch(/M1: 1 marked not-claimable/)
  })
})
