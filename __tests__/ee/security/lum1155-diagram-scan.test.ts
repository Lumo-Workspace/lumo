/**
 * @jest-environment node
 *
 * LUM-1155 — the call-flow diagram rides on the call the review already
 * makes: the AI review's own call on a full review, the whole-PR summary
 * call on an incremental one. It is asked for only when the repository
 * wants diagrams (default on) and the whole reviewable PR is not trivial;
 * the answer is cleaned before it is stored on the scan.
 */
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/ee/security/security-scan/workspace-switches')
      .resolveSecurityLayers({
        securityAiReviewEnabled: true,
        securityHuntEnabled: true,
      }),
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
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prReviewControlRepository } from '@/ee/security/repositories/pr-review-control.repository'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/ee/security/llm/security-judge-client'
import * as summaryClient from '@/ee/security/llm/pr-summary-client'
import {
  isValidSequenceDiagramSource,
  renderSequenceDiagram,
  parseSequenceDiagram,
} from '@/ee/security/security-scan/sequence-diagram'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const fetchPrDiff = gh.fetchPrDiff as jest.Mock
const judgeSecurity = judge.judgeSecurity as jest.Mock
const summarize = summaryClient.summarizeWholePr as jest.Mock

// Built from parts so the fixture itself is not a key-shaped literal.
const KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('')

function file(path: string, lines: number): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,0 +1,${lines} @@`,
    ...Array.from({ length: lines }, (_, i) => `+const v${i} = ${i}`),
  ].join('\n')
}

/** Two source files, 24 changed lines: a diagram is worth asking for. */
const FLOW_DIFF = [file('src/api.ts', 12), file('src/service.ts', 12)].join(
  '\n'
)
/** One source file: trivial. */
const TRIVIAL_DIFF = file('src/api.ts', 40)

const DIAGRAM = {
  participants: ['API route', 'Service', 'GitHub'],
  steps: [
    { from: 'API route', to: 'Service', message: 'review(pr)' },
    { from: 'Service', to: 'GitHub', message: `fetch diff ${KEY}` },
    { from: 'Service', to: 'API route', message: 'result', reply: true },
  ],
}

function incremental(): void {
  ;(prReviewControlRepository.baseline as jest.Mock).mockResolvedValueOnce({
    headSha: 'previous',
  })
  ;(gh.fetchReviewChangedPaths as jest.Mock).mockResolvedValueOnce([
    'src/api.ts',
  ])
}

function stored(): unknown {
  return (repo.persistResult.mock.calls[0]![2] as { sequenceDiagram?: unknown })
    .sequenceDiagram
}

function diagramsSetting(on: boolean): void {
  jest.spyOn(repoReviewSettingRepository, 'findReviewStyle').mockResolvedValue({
    pathInstructions: [],
    reviewProfile: 'chill',
    toneInstructions: null,
    highLevelSummary: 'description',
    sequenceDiagrams: on,
  })
}

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
  jest.restoreAllMocks()
  diagramsSetting(true)
  jest
    .spyOn(repoReviewSettingRepository, 'findPathFilters')
    .mockResolvedValue([])
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
  ;(repo.findPreviousPrSummary as jest.Mock).mockResolvedValue(null)
  fetchPrDiff.mockResolvedValue(FLOW_DIFF)
  judgeSecurity.mockResolvedValue({
    findings: [],
    prSummary: { intent: 'Adds a review route.', changes: [] },
    sequenceDiagram: DIAGRAM,
  })
  summarize.mockResolvedValue({
    intent: 'Adds a review route and its service.',
    changes: [],
    sequenceDiagram: DIAGRAM,
  })
})

test('a full review asks the AI review call for the diagram and stores it cleaned', async () => {
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(judgeSecurity).toHaveBeenCalledTimes(1)
  expect(judgeSecurity.mock.calls[0]![0].withSequenceDiagram).toBe(true)
  // No extra pass.
  expect(summarize).not.toHaveBeenCalled()
  const diagram = parseSequenceDiagram(stored())!
  expect(diagram.participants).toEqual(['API route', 'Service', 'GitHub'])
  expect(JSON.stringify(stored())).not.toContain(KEY)
  expect(isValidSequenceDiagramSource(renderSequenceDiagram(diagram))).toBe(
    true
  )
})

test('setting off: the diagram is never asked for and none is stored', async () => {
  diagramsSetting(false)
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(judgeSecurity).toHaveBeenCalledTimes(1)
  expect(judgeSecurity.mock.calls[0]![0].withSequenceDiagram).toBeUndefined()
  expect(stored()).toBeNull()
})

test('a trivial PR is skipped: not asked for, and a stray answer is not stored', async () => {
  fetchPrDiff.mockResolvedValue(TRIVIAL_DIFF)
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(judgeSecurity.mock.calls[0]![0].withSequenceDiagram).toBeUndefined()
  expect(stored()).toBeNull()
})

test('an incremental review gets the diagram from the whole-PR summary call, never the slice', async () => {
  incremental()
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(judgeSecurity.mock.calls[0]![0].withSequenceDiagram).toBeUndefined()
  expect(summarize).toHaveBeenCalledTimes(1)
  expect(summarize.mock.calls[0]![0].withSequenceDiagram).toBe(true)
  expect(summarize.mock.calls[0]![0].diff.text).toContain('src/service.ts')
  expect(parseSequenceDiagram(stored())).not.toBeNull()
})

test('an incremental review with diagrams off does not ask the summary call for one', async () => {
  diagramsSetting(false)
  incremental()
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(summarize.mock.calls[0]![0].withSequenceDiagram).toBeUndefined()
  expect(stored()).toBeNull()
})

test('a diagram that does not clean is not stored', async () => {
  judgeSecurity.mockResolvedValue({
    findings: [],
    prSummary: { intent: 'Adds a review route.', changes: [] },
    sequenceDiagram: { participants: ['Only one'], steps: [] },
  })
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  expect(stored()).toBeNull()
})
