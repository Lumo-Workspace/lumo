/**
 * @jest-environment node
 *
 * LUM-1186 follow-up — `lumo task status --full` lists each test case's latest
 * run: the same row `lumo task testcase list` prints (same read, same
 * formatter), the server's `N/M passing` summary, only under `--full`, and a
 * fail-closed `⚠ could not read test cases` line when that read fails.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))

import {
  formatTaskStatus,
  pushTestCases,
  taskStatus,
  type TaskStatusResponse,
} from '@/cli/src/commands/task-status'
import { taskTestCaseList } from '@/cli/src/commands/task-testcase-list'
import { fetchTaskTestCases } from '@/cli/src/lib/task-test-cases-read'

const ESC = String.fromCharCode(27)

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const STATUS: TaskStatusResponse = {
  version: 2,
  task: { id: 't-1', identifier: 'LUM-9', title: 'thing', status: 'IN_REVIEW' },
  cost: { tokenCost: 1200, activeTimeSec: 90 },
  struggleTrail: { pullRequests: [], reopens: [] },
  trend: { cost: [], rework: { reopens: 0, extraPrCycles: 0, total: 0 } },
  nextActions: [],
  securityFindings: { open: 0, blocking: 0, unconfirmedPrs: [] },
} as TaskStatusResponse

const TEST_CASES = {
  testCases: [
    {
      number: 1,
      title: 'Refund to card',
      steps: ['open invoice', 'click Refund'],
      verification: ['banner says Refunded'],
      requiredEnvironment: null,
      runs: [
        {
          result: 'PASS',
          environment: 'LOCAL',
          createdAt: '2026-10-16T10:00:00.000Z',
          commitSha: 'abcdef1234567',
          commitDirty: false,
          failureAttribution: null,
          ceiling: { effective: 'UNPROVEN', reason: 'no-evidence' },
          stepReport: {
            rows: [],
            brokeAt: null,
            passed: 3,
            total: 3,
            hasStepResults: true,
          },
        },
      ],
    },
    {
      number: 2,
      // member-authored: an ANSI escape + a tab must not reach the terminal
      title: `Login ${ESC}[31mredirect\tforged`,
      steps: ['sign in'],
      verification: ['lands on /home'],
      requiredEnvironment: 'PREVIEW',
      runs: [
        {
          result: 'FAIL',
          environment: 'PREVIEW',
          createdAt: '2026-10-15T10:00:00.000Z',
          commitSha: null,
          commitDirty: null,
          failureAttribution: 'IMPLEMENTATION_DEFECT',
          ceiling: { effective: 'FAIL' },
          stepReport: {
            rows: [],
            brokeAt: { phase: 'STEPS', index: 0, text: 'sign in' },
            passed: 0,
            total: 2,
            hasStepResults: true,
          },
        },
      ],
    },
    {
      number: 3,
      title: 'Export CSV',
      steps: ['click export'],
      verification: ['file downloads'],
      runs: [],
    },
  ],
  summary: {
    total: 3,
    passing: 0,
    failing: 1,
    inconclusive: 1,
    notRun: 1,
    blocking: [{ number: 2 }],
  },
}

/** Route fetch by URL; `testCases` = the test-cases response (or a throw). */
function routedFetch(testCases: () => Response) {
  return jest.spyOn(global, 'fetch').mockImplementation(async url => {
    const u = String(url)
    if (u.includes('/boundary-crossings'))
      return jsonResponse(200, { crossings: [] })
    if (u.includes('/test-cases')) return testCases()
    return jsonResponse(200, STATUS)
  })
}

let writeSpy: jest.SpyInstance
let logSpy: jest.SpyInstance
let errSpy: jest.SpyInstance

beforeEach(() => {
  writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

const stdout = () => writeSpy.mock.calls.map(c => String(c[0])).join('')

describe('task status --full — Test cases section (LUM-1186)', () => {
  it('prints exactly the `testcase list` rows and the N/M passing summary', async () => {
    routedFetch(() => jsonResponse(200, TEST_CASES))
    expect(await taskStatus('LUM-9', { full: true })).toBeUndefined()
    const out = stdout()

    // Same read, same formatter: every list line appears in the section.
    expect(await taskTestCaseList('LUM-9')).toBeUndefined()
    const listLines = logSpy.mock.calls
      .map(c => String(c[0]))
      .join('\n')
      .split('\n')
      .filter(l => l.trim() !== '')
    expect(listLines).toHaveLength(4) // 3 rows + summary
    const section = out.slice(out.indexOf('Test cases'))
    for (const l of listLines) expect(section).toContain(`  ${l}`)

    expect(section).toContain(
      'PASS on LOCAL → UNPROVEN (no evidence) @abcdef1 (2026-10-16)'
    )
    expect(section).toContain('3 of 3 steps passed')
    expect(section).toContain('cause: defect')
    expect(section).toContain('failed at step 1')
    expect(section).toContain('TC3\tExport CSV')
    expect(section).toContain('never run')
    expect(section).toContain(
      '0/3 passing · 1 failing · 1 unproven/blocked · 1 never run · 1 proven defect awaiting a ruling (blocks DONE)'
    )
    // Untrusted title is sanitized: no raw escape, no forged column.
    expect(out).not.toContain(ESC)
    expect(section).not.toContain('redirect\tforged')
  })

  it('the default report has no Test cases section and makes no test-case request', async () => {
    const fetchSpy = routedFetch(() => jsonResponse(200, TEST_CASES))
    expect(await taskStatus('LUM-9')).toBeUndefined()
    expect(stdout()).not.toContain('Test cases')
    expect(
      fetchSpy.mock.calls.some(c => String(c[0]).includes('/test-cases'))
    ).toBe(false)
  })

  it('a failed test-case read prints the ⚠ line and the status still succeeds', async () => {
    routedFetch(() => jsonResponse(500, { error: 'boom' }))
    expect(await taskStatus('LUM-9', { full: true })).toBeUndefined()
    const out = stdout()
    expect(out).toContain('Test cases')
    expect(out).toContain('⚠ could not read test cases (HTTP 500)')
    expect(out).toContain('lumo task testcase list LUM-9')
    // The rest of the report still renders.
    expect(out).toContain('LUM-9  thing')
    expect(out).toContain('Cost')
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('--full --json is unchanged: no testCases field, no extra request', async () => {
    const fetchSpy = routedFetch(() => jsonResponse(200, TEST_CASES))
    expect(
      await taskStatus('LUM-9', { full: true, json: true })
    ).toBeUndefined()
    const payload = JSON.parse(stdout()) as Record<string, unknown>
    expect(payload).not.toHaveProperty('testCases')
    expect(
      fetchSpy.mock.calls.some(c => String(c[0]).includes('/test-cases'))
    ).toBe(false)
  })
})

describe('fetchTaskTestCases', () => {
  it('returns the cases and summary on success', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, TEST_CASES))
    const r = await fetchTaskTestCases('https://api.test/', 'lum_x', 'LUM-9')
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.testCases).toHaveLength(3)
      expect(r.summary).toEqual(TEST_CASES.summary)
    }
  })

  it('fails closed on a network error, a non-ok status and a malformed body', async () => {
    const f = jest.spyOn(global, 'fetch')
    f.mockRejectedValueOnce(new Error('offline'))
    expect(await fetchTaskTestCases('https://api.test', 't', 'LUM-9')).toEqual({
      status: 'error',
      reason: 'offline',
    })
    f.mockResolvedValueOnce(jsonResponse(404, {}))
    expect(await fetchTaskTestCases('https://api.test', 't', 'LUM-9')).toEqual({
      status: 'error',
      reason: 'HTTP 404',
    })
    f.mockResolvedValueOnce(jsonResponse(200, { testCases: 'nope' }))
    expect(await fetchTaskTestCases('https://api.test', 't', 'LUM-9')).toEqual({
      status: 'error',
      reason: 'invalid response body',
    })
  })
})

describe('pushTestCases', () => {
  it('skips the section when nothing was read, and says None recorded for an empty list', () => {
    const skipped: string[] = []
    pushTestCases(skipped, undefined, 'LUM-9')
    expect(skipped).toEqual([])

    const empty: string[] = []
    pushTestCases(
      empty,
      { status: 'ok', testCases: [], summary: { total: 0, passing: 0 } },
      'LUM-9'
    )
    expect(empty.join('\n')).toContain('Test cases')
    expect(empty.join('\n')).toContain('  None recorded.')
    expect(empty.join('\n')).not.toContain('0/0 passing')
  })

  it('formatTaskStatus only renders the section with full', () => {
    const read = {
      status: 'ok' as const,
      testCases: TEST_CASES.testCases,
      summary: TEST_CASES.summary,
    }
    expect(formatTaskStatus(STATUS, { testCases: read })).not.toContain(
      'Test cases'
    )
    expect(formatTaskStatus(STATUS, { full: true, testCases: read })).toContain(
      'Test cases'
    )
  })
})
