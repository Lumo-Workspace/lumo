/**
 * @jest-environment node
 *
 * LUM-1185 — `lumo task testcase show / list` 展示与 web Test cases 区段一致的
 * 判定：UNPROVEN 封顶及原因、failure cause、required env、完整逐步
 * 报告（not reached / unrecorded / 进度计数），以及 list 末尾的 N/M passing。
 *
 * 响应夹具用**服务端同一组纯函数**生成（deriveStoredRunCeiling /
 * deriveStepReport / summarizeTestCases），CLI 侧只断言渲染——同源同数。
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(),
}))

import { readCredentials } from '@/cli/src/lib/config'
import { testCaseList, testCaseShow } from '@/cli/src/commands/testcase'
import { formatListRow } from '@/cli/src/commands/task-testcase-list'
import {
  formatCauseTag,
  formatCeilingShort,
  formatCeilingSuffix,
} from '@/cli/src/lib/test-case-verdict'
import {
  formatRequiredEnvironment,
  formatStepDuration,
  formatStepProgress,
  formatStepReportLines,
  formatTestCasesSummary,
} from '@/cli/src/lib/test-case-report'
import {
  deriveStoredRunCeiling,
  type CeilingEnvironment,
} from '@/lib/test-cases/provability'
import { deriveStepReport } from '@/lib/test-cases/step-report'
import { summarizeTestCases } from '@/lib/test-cases/case-summary'

const ESC = String.fromCharCode(27)

const tc = {
  number: 3,
  title: 'Refund to card',
  setup: null,
  steps: ['open the invoice', 'click Refund'],
  verification: ['banner says Refunded'],
  expected: 'Refund lands on the card.',
}

type StoredRun = {
  id: string
  result: 'PASS' | 'FAIL' | 'BLOCKED'
  environment: CeilingEnvironment
  failedPhase: 'STEPS' | 'VERIFICATION' | null
  failedIndex: number | null
  failedStepText: string | null
  failureAttribution: string | null
  unprovenVerification: unknown
  evidence: unknown
  stepResults: unknown
  disposition: unknown
}

type WireRun = StoredRun & {
  note: string | null
  actual: string | null
  pullRequestId: string | null
  commitSha: string | null
  commitDirty: boolean | null
  createdAt: string
  executedBy: string | null
  sourceSessionId: string | null
}

const baseRun: WireRun = {
  id: 'r1',
  result: 'PASS',
  environment: 'LOCAL',
  failedPhase: null,
  failedIndex: null,
  failedStepText: null,
  failureAttribution: null,
  unprovenVerification: [],
  evidence: [],
  stepResults: [],
  disposition: null,
  note: null,
  actual: null,
  pullRequestId: null,
  commitSha: null,
  commitDirty: null,
  createdAt: '2026-10-06T08:00:00.000Z',
  executedBy: 'Ada',
  sourceSessionId: null,
}

/** 与服务端 runVerdictOf 一样：同一组纯函数推导。 */
function served(
  run: WireRun,
  requiredEnvironment: CeilingEnvironment | null = null,
  extra: Record<string, unknown> = {}
) {
  return {
    ...run,
    ceiling: deriveStoredRunCeiling(run, requiredEnvironment),
    stepReport: deriveStepReport(tc, run),
    review: null,
    ...extra,
  }
}

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

describe('testcase show — the full verdict', () => {
  it('shows the UNPROVEN cap and why, plus the required environment', async () => {
    respond({
      testCase: { ...tc, requiredEnvironment: 'PRODUCTION' },
      runs: [
        served(
          {
            ...baseRun,
            evidence: [{ kind: 'url', url: 'https://example.com/log' }],
          },
          'PRODUCTION'
        ),
      ],
      pullRequests: [],
    })

    await testCaseShow('task', 'LUM-42/TC3', {})

    const out = printed()
    expect(out).toContain('Only proves on PRODUCTION')
    expect(out).toContain(
      'PASS on LOCAL → UNPROVEN (this case only proves anything on PRODUCTION)'
    )
  })

  it('shows the cause on a FAIL and the full step report with not-reached rows and progress', async () => {
    const run = {
      ...baseRun,
      result: 'FAIL' as const,
      failureAttribution: 'IMPLEMENTATION_DEFECT',
      failedPhase: 'STEPS' as const,
      failedIndex: 1,
      failedStepText: 'click Refund',
      actual: 'store credit issued',
      stepResults: [
        {
          phase: 'STEPS',
          index: 0,
          text: 'open the invoice',
          status: 'PASS',
          reason: null,
          durationMs: 1200,
          evidence: [],
        },
        {
          phase: 'STEPS',
          index: 1,
          text: 'click Refund',
          status: 'FAIL',
          reason: null,
          durationMs: 300,
          evidence: [],
        },
      ],
    }
    respond({ testCase: tc, runs: [served(run)], pullRequests: [] })

    await testCaseShow('task', 'LUM-42/TC3', {})

    const out = printed()
    expect(out).toContain('FAIL on LOCAL  [cause: defect]')
    expect(out).toContain('    failed at step 2')
    expect(out).toContain('    ✓ step 1: open the invoice (1.2s)')
    expect(out).toContain('    ✗ step 2: click Refund (300ms)')
    expect(out).toContain(
      '    ○ verification 1: banner says Refunded (not reached)'
    )
    expect(out).toContain('    actual: store credit issued')
  })

  it('marks unrecorded steps and says no per-step results were recorded', async () => {
    respond({
      testCase: tc,
      runs: [
        served({
          ...baseRun,
          evidence: [{ kind: 'url', url: 'https://example.com/a' }],
        }),
      ],
      pullRequests: [],
    })

    await testCaseShow('task', 'LUM-42/TC3', {})

    const out = printed()
    expect(out).toContain('    no per-step results were recorded for this run')
    expect(out).toContain('    - step 1: open the invoice (no per-step result)')
  })

  it('prints no spot-check review line, even when a server still sends one (LUM-1231)', async () => {
    respond({
      testCase: tc,
      runs: [
        served(baseRun, null, {
          review: {
            accepted: false,
            note: 'wrong page',
            reviewer: 'Bo',
            reviewedAt: '2026-10-07T00:00:00.000Z',
          },
        }),
      ],
      pullRequests: [],
    })

    await testCaseShow('task', 'LUM-42/TC3', {})

    const out = printed()
    expect(out).toContain('PASS on LOCAL')
    expect(out).not.toMatch(/spot-check/i)
    expect(out).not.toContain('wrong page')
  })

  it('falls back to the old rendering when an old server sends no verdict fields', async () => {
    respond({
      testCase: tc,
      runs: [
        {
          ...baseRun,
          result: 'FAIL',
          failedPhase: 'STEPS',
          failedIndex: 1,
          failedStepText: 'click Refund',
        },
      ],
      pullRequests: [],
    })

    await testCaseShow('task', 'LUM-42/TC3', {})

    const out = printed()
    expect(out).toContain('FAIL on LOCAL  by Ada  step 2: click Refund')
    expect(out).not.toContain('UNPROVEN')
    expect(out).not.toContain('steps passed')
  })
})

describe('testcase list — capped verdicts and the N/M passing summary', () => {
  it('shows the cap on the latest run and ends with the Record-row summary', async () => {
    const cases = [
      { ...tc, number: 1, requiredEnvironment: null, runs: [baseRun] },
      {
        ...tc,
        number: 2,
        requiredEnvironment: null,
        runs: [
          {
            ...baseRun,
            id: 'r2',
            evidence: [{ kind: 'url', url: 'https://example.com/a' }],
            stepResults: [
              { phase: 'STEPS', index: 0, text: 'a', status: 'PASS' },
              { phase: 'STEPS', index: 1, text: 'b', status: 'PASS' },
              { phase: 'VERIFICATION', index: 0, text: 'c', status: 'PASS' },
            ],
          },
        ],
      },
      {
        ...tc,
        number: 3,
        requiredEnvironment: null,
        runs: [
          {
            ...baseRun,
            id: 'r3',
            result: 'FAIL' as const,
            failureAttribution: 'IMPLEMENTATION_DEFECT',
            failedPhase: 'STEPS' as const,
            failedIndex: 0,
          },
        ],
      },
      { ...tc, number: 4, requiredEnvironment: 'PREVIEW' as const, runs: [] },
    ]
    respond({
      testCases: cases.map(c => ({
        ...c,
        runs: c.runs.map(r => served(r, c.requiredEnvironment)),
      })),
      summary: summarizeTestCases(cases),
    })

    await testCaseList('task', 'LUM-42', {})

    const lines = printed().split('\n')
    expect(lines[0]).toContain('PASS on LOCAL → UNPROVEN (no evidence)')
    expect(lines[1]).toContain('PASS on LOCAL 2026-10-06T08:00:00Z by Ada')
    expect(lines[1]).toContain('3 of 3 steps passed')
    expect(lines[1]).not.toContain('UNPROVEN')
    expect(lines[2]).toContain('cause: defect')
    expect(lines[2]).toContain('failed at step 1')
    expect(lines[3]).toContain('Only proves on PREVIEW')
    expect(lines[3]).toContain('never run')
    expect(lines[lines.length - 1]).toBe(
      '1/4 passing · 1 failing · 1 unproven/blocked · 1 never run · 1 proven defect awaiting a ruling (blocks DONE)'
    )
  })

  it('prints no summary line against an old server', async () => {
    respond({
      testCases: [{ ...tc, runs: [baseRun] }],
    })
    await testCaseList('task', 'LUM-42', {})
    expect(printed().split('\n')).toHaveLength(1)
  })
})

describe('pure formatters', () => {
  it('formatCeilingSuffix names every reason and stays empty when not capped', () => {
    expect(formatCeilingSuffix({ effective: 'PASS' })).toBe('')
    expect(formatCeilingSuffix(undefined)).toBe('')
    expect(
      formatCeilingSuffix({ effective: 'UNPROVEN', reason: 'no-evidence' })
    ).toContain('no evidence attached')
    expect(
      formatCeilingSuffix({
        effective: 'UNPROVEN',
        reason: 'unobserved',
        unobserved: [{ index: 0, text: `x${ESC}[31m` }],
      })
    ).not.toContain(ESC)
    expect(formatCeilingSuffix({ effective: 'UNPROVEN', reason: 'new' })).toBe(
      ' → UNPROVEN'
    )
  })

  it('formatCeilingShort gives a one-cell reason', () => {
    expect(
      formatCeilingShort({
        effective: 'UNPROVEN',
        reason: 'skipped',
        skipped: [{ phase: 'STEPS', index: 0, text: 'a', reason: 'r' }],
      })
    ).toBe(' → UNPROVEN (1 skipped)')
    expect(formatCeilingShort({ effective: 'FAIL' })).toBe('')
  })

  it('formatCauseTag maps the stored enum back to the --cause word', () => {
    expect(formatCauseTag('CASE_OUTDATED')).toBe('cause: outdated')
    expect(formatCauseTag('EXTERNAL_BLOCK')).toBe('cause: external')
    expect(formatCauseTag(null)).toBeNull()
    expect(formatCauseTag('WHATEVER')).toBeNull()
  })

  it('formatStepReportLines renders skipped / unobserved rows and ignores an old server', () => {
    expect(formatStepReportLines(undefined)).toBeNull()
    expect(
      formatStepReportLines({
        rows: [
          {
            phase: 'STEPS',
            index: 0,
            text: 'a',
            state: 'skipped',
            reason: 'no db',
            durationMs: null,
          },
          {
            phase: 'VERIFICATION',
            index: 0,
            text: 'b',
            state: 'unobserved',
            reason: null,
            durationMs: null,
          },
        ],
        brokeAt: null,
        passed: 0,
        total: 2,
        hasStepResults: true,
      })
    ).toEqual([
      '    » step 1: a (skipped: no db)',
      '    ? verification 1: b (not observed)',
    ])
  })

  it('formatStepProgress says nothing for a BLOCKED run without step results', () => {
    const report = {
      rows: [],
      brokeAt: null,
      passed: 0,
      total: 2,
      hasStepResults: false,
    }
    expect(formatStepProgress(report, 'BLOCKED')).toBeNull()
    expect(
      formatStepProgress({ ...report, hasStepResults: true }, 'PASS')
    ).toBe('0 of 2 steps passed')
  })

  it('formatStepDuration matches the web report', () => {
    expect(formatStepDuration(300)).toBe('300ms')
    expect(formatStepDuration(1200)).toBe('1.2s')
  })

  it('formatRequiredEnvironment ignores unknown values', () => {
    expect(formatRequiredEnvironment('LOCAL')).toBe('Only proves on LOCAL')
    expect(formatRequiredEnvironment(null)).toBeNull()
  })

  it('formatTestCasesSummary leaves the DONE-gate count out for a milestone', () => {
    const summary = {
      total: 2,
      passing: 2,
      failing: 0,
      notRun: 0,
      inconclusive: 0,
      blocking: [{ caseNumber: 1, title: 't', runId: 'r' }],
    }
    expect(formatTestCasesSummary(summary, 'milestone')).toBe('2/2 passing')
    expect(formatTestCasesSummary(undefined, 'task')).toBeNull()
  })

  it('formatListRow keeps one tab-separated row even with a ruling', () => {
    const row = formatListRow({
      number: 7,
      title: 'a\tb',
      steps: ['x'],
      verification: [],
      runs: [
        {
          ...baseRun,
          result: 'FAIL',
          failureAttribution: 'IMPLEMENTATION_DEFECT',
          disposition: { disposition: 'KNOWN_DEFECT' },
        },
      ],
    })
    expect(row.split('\t')).toHaveLength(4)
    expect(row).toContain('cause: defect · ruled KNOWN_DEFECT')
  })
})

describe('deriveStoredRunCeiling', () => {
  it('reads the Json columns the same way the Record row does', () => {
    expect(
      deriveStoredRunCeiling(
        {
          result: 'PASS',
          environment: 'LOCAL',
          unprovenVerification: [{ index: 0, text: 'v' }],
          evidence: [{}],
          stepResults: [],
        },
        null
      )
    ).toEqual({
      effective: 'UNPROVEN',
      reason: 'unobserved',
      unobserved: [{ index: 0, text: 'v' }],
    })
    expect(
      deriveStoredRunCeiling(
        {
          result: 'PASS',
          environment: 'LOCAL',
          unprovenVerification: 'garbage',
          evidence: [{}],
          stepResults: null,
        },
        null
      )
    ).toEqual({ effective: 'PASS' })
  })
})
