/**
 * @jest-environment node
 *
 * LUM-1151 (user ruling) — the high-level summary always describes the
 * WHOLE PR (base...head). On an incremental review the AI review reads only
 * the files changed since its last complete review, so its own summary is a
 * slice: it is replaced by a separate, budgeted summary-only call over the
 * whole reviewable PR diff (secrets masked before it is cut). Over budget,
 * the file list and the previous summary are summarised instead; if the
 * call fails, the previous whole-PR summary is kept and says which commit
 * it describes. A full review keeps the AI review's own summary (no call).
 */
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/ee/security/security-scan/workspace-switches')
      .resolveSecurityLayers(null),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
  fetchPrBody: jest.fn(),
  fetchReviewChangedPaths: jest.fn(),
  readRepoFile: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/ee/security/llm/security-judge-client', () => ({
  judgeSecurity: jest.fn(),
}))
jest.mock('@/ee/security/llm/pr-summary-client', () => ({
  summarizeWholePr: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findByPrAndSha: jest.fn(),
    create: jest.fn(),
    restart: jest.fn(),
    claimPending: jest.fn(),
    finalize: jest.fn(),
    createFindings: jest.fn(),
    persistResult: jest.fn(),
    countExternalFindings: jest.fn(),
    findDispositionedByPullRequest: jest.fn(),
    findLatestByPullRequestIds: jest.fn(),
    findPreviousOpenFingerprints: jest.fn().mockResolvedValue([]),
    findFindingWithScope: jest.fn(),
    updateDisposition: jest.fn(),
    mergeStages: jest.fn(),
    setManagedRunId: jest.fn(),
    findPreviousPrSummary: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {},
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findById: jest.fn(),
    findManyForSecurityByTaskId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {},
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findReviewAutoPauseAfter: jest.fn().mockResolvedValue(5),
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
    findLastSarifIngestAt: jest.fn().mockResolvedValue(undefined),
    findSecurityBaseline: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))
jest.mock('@/ee/security/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {
    supersedeOlderRuns: jest.fn().mockResolvedValue({
      superseded: 0,
      cancelled: 0,
      sandboxesStopped: 0,
    }),
    enforceHourlyCap: jest.fn().mockResolvedValue({ capped: false }),
  },
}))
jest.mock('@/ee/security/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  recordHuntStartBestEffort: jest.fn(),
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { findUndispositionedByTask: jest.fn() },
}))
jest.mock('@/ee/security/services/security-baseline.service', () => ({
  securityBaselineService: { ensure: jest.fn().mockResolvedValue('present') },
}))
jest.mock('@/ee/security/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))
jest.mock('@/ee/security/services/scan-code-retention.service', () => ({
  scrubScanIfRepositoryUnconfirmed: jest.fn(),
}))
jest.mock('@/ee/security/services/auto-review-admission.service', () =>
  require('@/test-utils/ee/auto-review-admission-mock').delegatingAdmission()
)
jest.mock('@/ee/security/repositories/pr-review-control.repository', () => ({
  prReviewControlRepository: {
    reserve: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
    baseline: jest.fn().mockResolvedValue(null),
    priorFindings: jest.fn().mockResolvedValue([]),
    findingsOnScan: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({ reviewPaused: false, reviewHeads: [] }),
  },
}))
jest.mock('@/ee/security/services/security-deferred-review-start', () => ({
  startDeferredManualReview: jest.fn().mockResolvedValue(true),
}))

import { prSecurityScanService } from '@/ee/security/services/pr-security-scan.service'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prReviewControlRepository } from '@/ee/security/repositories/pr-review-control.repository'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/ee/security/llm/security-judge-client'
import * as summaryClient from '@/ee/security/llm/pr-summary-client'
import {
  WHOLE_PR_SUMMARY_DIFF_MAX_CHARS,
  diffFileStats,
} from '@/ee/security/services/pr-whole-summary.service'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const fetchPrDiff = gh.fetchPrDiff as jest.Mock
const judgeSecurity = judge.judgeSecurity as jest.Mock
const summarize = summaryClient.summarizeWholePr as jest.Mock
const previous = repo.findPreviousPrSummary as jest.Mock

const PREV_SHA = 'feedface1234567890feedface1234567890feed'
// Built from parts so the fixture itself is not a key-shaped literal.
const KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('')

function file(path: string, line: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,0 +1,1 @@',
    `+${line}`,
  ].join('\n')
}

const WHOLE = [
  file('src/a.ts', 'const a = 1'),
  file('src/b.ts', `const k = "${KEY}"`),
].join('\n')

function incremental(): void {
  ;(prReviewControlRepository.baseline as jest.Mock).mockResolvedValueOnce({
    headSha: 'previous',
  })
  ;(gh.fetchReviewChangedPaths as jest.Mock).mockResolvedValueOnce(['src/a.ts'])
}

function storedSummary(): unknown {
  return (repo.persistResult.mock.calls[0]![2] as { prSummary: unknown })
    .prSummary
}

// Every variable set here is restored to exactly what it was.
const ENV_KEYS = [
  'LUMO_REVIEW_VERIFIER',
  'LUMO_SECURITY_HUNT',
  'LUMO_PRE_MERGE_CHECKS',
] as const
const SAVED_ENV = Object.fromEntries(
  ENV_KEYS.map(k => [k, process.env[k]])
) as Record<(typeof ENV_KEYS)[number], string | undefined>
beforeAll(() => {
  for (const k of ENV_KEYS) process.env[k] = 'off'
})
afterAll(() => {
  for (const k of ENV_KEYS) {
    const v = SAVED_ENV[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(pullRequestRepository.findById as jest.Mock).mockResolvedValue({
    id: 'pr1',
    workspaceId: 'w1',
    taskId: 't1',
    repo: 'o/r',
    number: 7,
  })
  ;(gh.fetchPrHeadSha as jest.Mock).mockResolvedValue('sha-2')
  repo.findByPrAndSha.mockResolvedValue(null)
  repo.create.mockResolvedValue({ id: 's2' } as never)
  repo.findDispositionedByPullRequest.mockResolvedValue([])
  repo.countExternalFindings.mockResolvedValue(0)
  fetchPrDiff.mockResolvedValue(WHOLE)
  judgeSecurity.mockResolvedValue({
    findings: [],
    prSummary: { intent: 'Changes a in the slice.', changes: [] },
  })
  summarize.mockResolvedValue({
    intent: 'Adds a and a config in b.',
    changes: ['New constant a'],
  })
  previous.mockResolvedValue({
    headSha: PREV_SHA,
    prSummary: { intent: 'Previously: adds a and b.', changes: [] },
  })
})

test('a full review keeps the AI review summary and makes no extra call', async () => {
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(summarize).not.toHaveBeenCalled()
  expect(storedSummary()).toMatchObject({ intent: 'Changes a in the slice.' })
})

test('an incremental review stores a whole-PR summary, never the slice', async () => {
  incremental()
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  // The AI review itself read only the slice …
  expect(judgeSecurity.mock.calls[0]![0].diff).not.toContain('src/b.ts')
  // … the summary call read the whole PR, with the secret masked.
  expect(summarize).toHaveBeenCalledTimes(1)
  const input = summarize.mock.calls[0]![0]
  expect(input.diff.text).toContain('src/a.ts')
  expect(input.diff.text).toContain('src/b.ts')
  expect(input.diff.text).not.toContain(KEY)
  expect(storedSummary()).toMatchObject({
    intent: 'Adds a and a config in b.',
  })
  expect(JSON.stringify(storedSummary())).not.toContain('slice')
})

test('over budget: the file list and the previous summary are summarised', async () => {
  incremental()
  const big = 'x'.repeat(200)
  const lines = Array.from(
    { length: Math.ceil(WHOLE_PR_SUMMARY_DIFF_MAX_CHARS / 200) + 10 },
    (_, i) => `+const v${i} = "${big}"`
  )
  fetchPrDiff.mockResolvedValue(
    [
      file('src/a.ts', 'const a = 1'),
      'diff --git a/src/big.ts b/src/big.ts',
      '--- a/src/big.ts',
      '+++ b/src/big.ts',
      `@@ -1,0 +1,${lines.length} @@`,
      ...lines,
    ].join('\n')
  )
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  const input = summarize.mock.calls[0]![0]
  expect(input.diff).toBeNull()
  expect(input.files.map((f: { path: string }) => f.path)).toEqual([
    'src/a.ts',
    'src/big.ts',
  ])
  expect(input.previous).toMatchObject({ intent: 'Previously: adds a and b.' })
  expect(storedSummary()).toMatchObject({
    intent: 'Adds a and a config in b.',
  })
})

test('the summary call fails: the previous whole-PR summary is kept and names its commit', async () => {
  incremental()
  summarize.mockRejectedValue(new Error('gateway down'))
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(storedSummary()).toMatchObject({
    intent: 'Previously: adds a and b.',
    describesSha: PREV_SHA,
  })
})

test('the call fails and there is no earlier summary: none is stored (the slice never is)', async () => {
  incremental()
  summarize.mockRejectedValue(new Error('gateway down'))
  previous.mockResolvedValue(null)
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(storedSummary()).toBeNull()
})

describe('diffFileStats', () => {
  it('counts each file, treats a deleted "-- x" line as content, and names deleted files', () => {
    const diff = [
      'diff --git a/q.sql b/q.sql',
      '--- a/q.sql',
      '+++ b/q.sql',
      '@@ -1,2 +1,1 @@',
      '--- old comment',
      '-select 1',
      '+select 2',
      'diff --git a/gone.ts b/gone.ts',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-x',
    ].join('\n')
    expect(diffFileStats(diff)).toEqual([
      { path: 'q.sql', additions: 1, deletions: 2 },
      { path: 'gone.ts', additions: 0, deletions: 1 },
    ])
  })
})
