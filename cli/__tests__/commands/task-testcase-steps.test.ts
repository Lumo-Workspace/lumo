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
  missingStepRefsLocal,
  formatMissingStepsError,
} from '../../src/lib/test-case-steps'
import { formatRunOutcome } from '../../src/lib/test-case-verdict'

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testCaseRun, testCaseShow } from '../../src/commands/testcase'

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
        {
          phase: 'STEPS',
          index: 0,
          status: 'PASS',
          reason: null,
          durationMs: null,
        },
        {
          phase: 'STEPS',
          index: 1,
          status: 'PASS',
          reason: null,
          durationMs: null,
        },
        {
          phase: 'VERIFICATION',
          index: 0,
          status: 'FAIL',
          reason: null,
          durationMs: 300,
        },
        {
          phase: 'STEPS',
          index: 2,
          status: 'PASS',
          reason: null,
          durationMs: 300,
        },
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

describe('skip (LUM-1211)', () => {
  it('parses s3=skip:<reason>', () => {
    expect(parseStepSpecs(['s3=skip:no real DB'])).toEqual({
      ok: true,
      value: [
        {
          phase: 'STEPS',
          index: 2,
          status: 'SKIP',
          reason: 'no real DB',
          durationMs: null,
        },
      ],
    })
  })
  it('applies one reason to a range', () => {
    const r = parseStepSpecs(['v1-2=skip:prod only'])
    expect(r.ok && r.value.map(s => [s.index, s.status, s.reason])).toEqual([
      [0, 'SKIP', 'prod only'],
      [1, 'SKIP', 'prod only'],
    ])
  })
  it('refuses a skip without a reason', () => {
    const r = parseStepSpecs(['s3=skip'])
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/skip needs a reason: s3=skip:"why"/)
  })
  it('refuses a reason longer than 200 characters', () => {
    expect(parseStepSpecs([`s1=skip:${'x'.repeat(201)}`]).ok).toBe(false)
  })
  it('refuses the same step as pass and skip', () => {
    expect(parseStepSpecs(['s1=pass', 's1=skip:x']).ok).toBe(false)
    expect(parseStepSpecs(['s1=skip:x', 's1=pass']).ok).toBe(false)
  })
  it('strips quotes around the reason', () => {
    const r = parseStepSpecs(['s1=skip:"no DB"'])
    expect(r.ok && r.value[0]?.reason).toBe('no DB')
  })
  it('sanitises the reason when printing', () => {
    const [line] = formatStepResultLines([
      { phase: 'STEPS', index: 0, status: 'SKIP', reason: 'a\u001b[31mb' },
    ])
    expect(line).toBe('    – step 1 (skipped: a[31mb)')
  })
  it('prints a skipped step with its reason', () => {
    expect(
      formatStepResultLines([
        {
          phase: 'STEPS',
          index: 2,
          text: 'call API',
          status: 'SKIP',
          reason: 'no DB',
        },
      ])
    ).toEqual(['    – step 3: call API (skipped: no DB)'])
  })
  it('sends the reason and summarises per status', async () => {
    respond({ run: { ...baseRun, result: 'PASS' }, ceiling: null })
    await testCaseRun('task', 'LUM-1/TC1', {
      result: 'pass',
      env: 'local',
      step: ['s1=pass', 's2=skip:no DB'],
    })
    expect(runBody().stepResults[1]).toMatchObject({
      status: 'SKIP',
      reason: 'no DB',
    })
    expect(runBody().stepResults[0]).not.toHaveProperty('reason')
    expect(printed()).toContain('Steps: 1 passed, 1 skipped of 2 reported')
  })
  it('relays the server rejection of a missing step', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'Missing per-step results: s2. Report each.',
      }),
    }) as never
    const code = await testCaseRun('task', 'LUM-1/TC1', {
      result: 'pass',
      env: 'local',
      step: ['s1=pass'],
    })
    expect(code).toBe(1)
    expect(errors()).toContain('Missing per-step results: s2')
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
    await testCaseRun('task', 'LUM-1/TC1', {
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
    expect(printed()).toContain('Steps: 3 passed, 1 failed of 4 reported')
  })

  it('sends neither field when no step flags are given (old servers stay happy)', async () => {
    await testCaseRun('task', 'LUM-1/TC1', { result: 'pass', env: 'local' })
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
    const code = await testCaseRun('task', 'LUM-1/TC1', {
      env: 'local',
      ...opts,
    })
    expect(code).toBe(2)
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

    await testCaseShow('task', 'LUM-1/TC1', {})

    expect(printed()).toContain('    ✓ step 1: open (1200ms)')
    expect(printed()).toContain('    ✗ verification 1: banner')
    expect(printed()).not.toContain('step 2: refund')
    expect(printed()).toContain('    actual: Issued as store credit')
  })

  it('prints nothing extra for a run from an older server', () => {
    expect(formatStepResultLines(undefined)).toEqual([])
  })
})

describe('formatRunOutcome skipped (LUM-1211)', () => {
  it('names the skipped steps 1-based with their reasons', () => {
    expect(
      formatRunOutcome({
        handle: 'LUM-1/TC1',
        reported: 'PASS',
        environment: 'LOCAL',
        ceiling: {
          effective: 'UNPROVEN',
          reason: 'skipped',
          skipped: [
            { phase: 'STEPS', index: 2, text: 'call API', reason: 'no DB' },
          ],
        },
      })
    ).toBe(
      'Recorded LUM-1/TC1: PASS on LOCAL → UNPROVEN (skipped: s3 call API — no DB)'
    )
  })

  it('strips control characters from the skipped text and reason', () => {
    const out = formatRunOutcome({
      handle: 'LUM-1/TC1',
      reported: 'PASS',
      environment: 'LOCAL',
      ceiling: {
        effective: 'UNPROVEN',
        reason: 'skipped',
        skipped: [
          {
            phase: 'STEPS',
            index: 0,
            text: 'call\u001b[31m API',
            reason: 'no\u001b[2J DB',
          },
        ],
      },
    })
    expect(out).not.toContain('\u001b')
  })
})

describe('missingStepRefsLocal (LUM-1211)', () => {
  const tc = { steps: ['a', 'b'], verification: ['x', 'y'] }
  const rep = (
    phase: 'STEPS' | 'VERIFICATION',
    index: number,
    status: 'PASS' | 'FAIL' | 'SKIP' = 'PASS'
  ) => ({ phase, index, status, reason: null, durationMs: null })

  it('PASS needs every step and verification', () => {
    expect(
      missingStepRefsLocal(tc, {
        result: 'PASS',
        steps: [rep('STEPS', 0)],
        failLocator: null,
        unprovenVerification: [],
      })
    ).toEqual(['s2', 'v1', 'v2'])
  })

  it('an unproven verification counts as reported', () => {
    expect(
      missingStepRefsLocal(tc, {
        result: 'PASS',
        steps: [rep('STEPS', 0), rep('STEPS', 1), rep('VERIFICATION', 0)],
        failLocator: null,
        unprovenVerification: [1],
      })
    ).toEqual([])
  })

  it('FAIL needs everything up to the break, taken from the fail step', () => {
    expect(
      missingStepRefsLocal(tc, {
        result: 'FAIL',
        steps: [rep('VERIFICATION', 0, 'FAIL')],
        failLocator: null,
        unprovenVerification: [],
      })
    ).toEqual(['s1', 's2'])
  })

  it('FAIL prefers the explicit locator and BLOCKED needs nothing', () => {
    expect(
      missingStepRefsLocal(tc, {
        result: 'FAIL',
        steps: [],
        failLocator: { phase: 'STEPS', index: 1 },
        unprovenVerification: [],
      })
    ).toEqual(['s1'])
    expect(
      missingStepRefsLocal(tc, {
        result: 'BLOCKED',
        steps: [],
        failLocator: null,
        unprovenVerification: [],
      })
    ).toEqual([])
  })

  it('FAIL with no break point is left to the server', () => {
    expect(
      missingStepRefsLocal(tc, {
        result: 'FAIL',
        steps: [],
        failLocator: null,
        unprovenVerification: [],
      })
    ).toEqual([])
  })

  it('formats the error like the server wording', () => {
    expect(formatMissingStepsError(['s2', 'v1'])).toMatch(
      /^Missing per-step results: s2, v1\. .*--step s2=pass --step v1=pass/
    )
  })
})

describe('testcase run pre-checks coverage before uploading (LUM-1211)', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'lumo-tc-')), 'out.log')
  writeFileSync(file, 'log')
  const showBody = {
    testCase: { number: 1, steps: ['a', 'b'], verification: ['x'] },
  }
  const urls = () =>
    (global.fetch as jest.Mock).mock.calls.map(([u]) => String(u))

  it('uploads nothing and exits 1 when steps are missing', async () => {
    respond(showBody)
    const code = await testCaseRun('task', 'LUM-1/TC1', {
      result: 'pass',
      env: 'local',
      step: ['s1=pass'],
      evidenceFile: [file],
    })
    expect(code).toBe(1)
    expect(errors()).toMatch(/Missing per-step results: s2, v1\./)
    expect(urls().some(u => u.endsWith('/evidence'))).toBe(false)
    expect(urls().some(u => u.endsWith('/runs'))).toBe(false)
  })

  it('uploads when coverage is complete', async () => {
    respond({
      ...showBody,
      files: [
        {
          url: 'https://b/o.log',
          filename: 'out.log',
          contentType: 'text/plain',
          size: 3,
        },
      ],
      run: { result: 'PASS', environment: 'LOCAL', failedStepText: null },
      ceiling: { effective: 'PASS' },
    })
    await testCaseRun('task', 'LUM-1/TC1', {
      result: 'pass',
      env: 'local',
      step: ['s1-2=pass', 'v1=pass'],
      evidenceFile: [file],
    })
    expect(urls().some(u => u.endsWith('/evidence'))).toBe(true)
    expect(urls().some(u => u.endsWith('/runs'))).toBe(true)
  })

  it('makes no extra request when there is no file to upload', async () => {
    respond({
      run: { result: 'PASS', environment: 'LOCAL', failedStepText: null },
      ceiling: { effective: 'PASS' },
    })
    await testCaseRun('task', 'LUM-1/TC1', {
      result: 'pass',
      env: 'local',
      step: ['s1=pass'],
    })
    expect(urls()).toHaveLength(1)
    expect(urls()[0]).toMatch(/\/runs$/)
  })
})
