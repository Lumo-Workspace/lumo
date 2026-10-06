/**
 * @jest-environment node
 *
 * LUM-1011 — `testcase run --step / --step-evidence / --actual` and the
 * per-step lines in `testcase show`. The CLI surface is 1-based; storage is
 * 0-based. Steps nobody reported are never sent (or printed) as passes.
 */
jest.mock('../../src/lib/config', () => ({
  readCredentials: jest.fn(),
}))
jest.mock('../../src/lib/session-id', () => ({
  resolveSessionId: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../src/lib/status-digest', () => ({
  printStatusDigest: jest.fn(),
}))

import { readCredentials } from '../../src/lib/config'
import {
  parseStepSpecs,
  parseStepEvidence,
  formatStepResultLines,
} from '../../src/lib/test-case-steps'
import { taskTestCaseRun } from '../../src/commands/task-testcase-run'
import { taskTestCaseShow } from '../../src/commands/task-testcase-show'

let logSpy: jest.SpyInstance
let errorSpy: jest.SpyInstance
const printed = () => logSpy.mock.calls.map(c => String(c[0])).join('\n')
const errors = () => errorSpy.mock.calls.map(c => String(c[0])).join('\n')

const baseRun = {
  id: 'r1',
  result: 'FAIL',
  environment: 'LOCAL',
  failedPhase: 'VERIFICATION',
  failedIndex: 0,
  failedStepText: 'banner says Refunded to Visa',
  note: null,
  evidence: [],
  pullRequestId: null,
  commitSha: null,
  commitDirty: null,
  createdAt: '2026-10-06T08:00:00.000Z',
  disposition: null,
}

const respond = (body: unknown) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  }) as never
}

const runBody = () => {
  const call = (global.fetch as jest.Mock).mock.calls.find(([url]) =>
    String(url).endsWith('/runs')
  )
  return JSON.parse(String((call?.[1] as RequestInit).body))
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

describe('parseStepSpecs', () => {
  it('expands a range, converts to 0-based and reads durations', () => {
    const r = parseStepSpecs(['s1-2=pass', 'v1=fail@0.3s', 's3=PASS@300ms'])
    expect(r).toEqual({
      ok: true,
      value: [
        { phase: 'STEPS', index: 0, status: 'PASS', durationMs: null },
        { phase: 'STEPS', index: 1, status: 'PASS', durationMs: null },
        { phase: 'VERIFICATION', index: 0, status: 'FAIL', durationMs: 300 },
        { phase: 'STEPS', index: 2, status: 'PASS', durationMs: 300 },
      ],
    })
  })

  it.each([
    ['no result', ['s1']],
    ['0 is not a step (1-based)', ['s0=pass']],
    ['unknown phase', ['x1=pass']],
    ['unknown result', ['s1=ok']],
    ['bad duration', ['s1=pass@soon']],
    ['a failing range', ['s1-2=fail']],
    ['the same step twice', ['s1=pass', 's1-2=pass']],
    ['two failing steps', ['s1=fail', 's2=fail']],
  ])('rejects %s', (_label, specs) => {
    expect(parseStepSpecs(specs).ok).toBe(false)
  })
})

describe('parseStepEvidence', () => {
  it('parses a file and a url, and refuses a range', () => {
    expect(parseStepEvidence(['s3=shot.png', 'v1=https://x/y'])).toEqual({
      ok: true,
      value: [
        { phase: 'STEPS', index: 2, target: 'shot.png' },
        { phase: 'VERIFICATION', index: 0, target: 'https://x/y' },
      ],
    })
    expect(parseStepEvidence(['s1-2=shot.png']).ok).toBe(false)
    expect(parseStepEvidence(['s1=']).ok).toBe(false)
  })
})

describe('testcase run with steps', () => {
  beforeEach(() => respond({ run: baseRun, ceiling: null }))

  it('sends stepResults (0-based), actual, and attaches step evidence by index', async () => {
    await taskTestCaseRun('LUM-1/TC1', {
      result: 'fail',
      env: 'local',
      cause: 'unknown',
      evidence: ['https://ci/log'],
      step: ['s1-3=pass', 'v1=fail@0.3s'],
      stepEvidence: ['v1=https://shots/v1.png'],
      actual: 'Issued as store credit',
    })

    const body = runBody()
    expect(body.actual).toBe('Issued as store credit')
    expect(body.evidence).toEqual([
      { type: 'link', url: 'https://ci/log' },
      { type: 'link', url: 'https://shots/v1.png' },
    ])
    expect(body.stepResults).toEqual([
      {
        phase: 'STEPS',
        index: 0,
        status: 'PASS',
        durationMs: null,
        evidence: [],
      },
      {
        phase: 'STEPS',
        index: 1,
        status: 'PASS',
        durationMs: null,
        evidence: [],
      },
      {
        phase: 'STEPS',
        index: 2,
        status: 'PASS',
        durationMs: null,
        evidence: [],
      },
      {
        phase: 'VERIFICATION',
        index: 0,
        status: 'FAIL',
        durationMs: 300,
        evidence: [1],
      },
    ])
    expect(printed()).toContain('actual: Issued as store credit')
    expect(printed()).toContain('Steps: 3 passed of 4 reported')
  })

  it('sends neither field when no step flags are given (old servers stay happy)', async () => {
    await taskTestCaseRun('LUM-1/TC1', { result: 'pass', env: 'local' })
    const body = runBody()
    expect(body).not.toHaveProperty('stepResults')
    expect(body).not.toHaveProperty('actual')
  })

  it.each([
    ['--actual on a pass', { result: 'pass', actual: 'x' }],
    ['a failing step on a pass', { result: 'pass', step: ['s1=fail'] }],
    ['steps on a blocked run', { result: 'blocked', step: ['s1=pass'] }],
    [
      'step evidence for an unreported step',
      { result: 'fail', cause: 'unknown', stepEvidence: ['s2=https://x'] },
    ],
  ])('refuses %s before any request', async (_label, opts) => {
    const code = await taskTestCaseRun('LUM-1/TC1', { env: 'local', ...opts })
    expect(code).toBe(1)
    expect(errors()).toMatch(/Error:/)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('testcase show with steps', () => {
  it('prints only the reported steps, then the actual result', async () => {
    respond({
      testCase: {
        number: 1,
        title: 'Refund',
        setup: null,
        steps: ['open', 'refund'],
        verification: ['banner'],
        expected: 'Refunded to Visa',
      },
      runs: [
        {
          ...baseRun,
          stepResults: [
            {
              phase: 'STEPS',
              index: 0,
              text: 'open',
              status: 'PASS',
              durationMs: 1200,
              evidence: [],
            },
            {
              phase: 'VERIFICATION',
              index: 0,
              text: 'banner',
              status: 'FAIL',
              durationMs: null,
              evidence: [],
            },
          ],
          actual: 'Issued as store credit',
        },
      ],
      pullRequests: [],
    })

    await taskTestCaseShow('LUM-1/TC1')

    expect(printed()).toContain('    ✓ step 1: open (1200ms)')
    expect(printed()).toContain('    ✗ verification 1: banner')
    expect(printed()).not.toContain('step 2: refund')
    expect(printed()).toContain('    actual: Issued as store credit')
  })

  it('prints nothing extra for a run from an older server', () => {
    expect(formatStepResultLines(undefined)).toEqual([])
  })
})
