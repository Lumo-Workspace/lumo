/**
 * @jest-environment node
 *
 * LUM-1144 — a PR over the AI review's size cap gets a partial review of
 * the files that fit (lockfiles / generated files filtered out first), the
 * skipped files recorded by name; only when more than a quarter of the
 * reviewable files would be dropped is the review skipped (JUDGE_OVER_CAP).
 * A finding on a skipped file is never closed by the partial pass.
 */
jest.mock('@/ee/security/repositories/repo-review-setting.repository', () => ({
  repoReviewSettingRepository: { findPathFilters: jest.fn() },
}))
jest.mock('@/ee/security/services/review-learnings.service', () => ({
  loadReviewLearnings: jest.fn(),
}))
jest.mock('@/ee/security/services/review-context.service', () => ({
  reviewContextService: { load: jest.fn() },
}))
// LUM-866: every workspace here has the default switches (all on); the
// platform env in each test still decides the ceiling.
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/ee/security/security-scan/workspace-switches')
      .resolveSecurityLayers(null),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
  revokeInstallationToken: jest.fn().mockResolvedValue(true),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
  readRepoFile: jest.fn(),
  readRepoFileWithToken: jest.fn(),
  withRepoReadToken: jest.fn(),
}))
jest.mock('@/ee/security/llm/security-judge-client', () => ({
  judgeSecurity: jest.fn(),
}))
jest.mock('@/ee/security/llm/security-falsifier-client', () => ({
  falsifyCandidate: jest.fn(),
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
    markVerifierStarted: jest.fn(),
    completeVerification: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/review-verifier-start', () => ({
  startReviewVerifier: jest.fn(),
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
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
    findLastSarifIngestAt: jest.fn(),
    findSecurityBaseline: jest.fn(),
  },
}))

jest.mock('@/ee/security/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))
jest.mock('@/ee/security/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {
    supersedeOlderRuns: jest.fn(),
    enforceHourlyCap: jest.fn(),
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
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

import { prSecurityScanService } from '@/ee/security/services/pr-security-scan.service'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { securityManagedScanOpsService } from '@/ee/security/services/security-managed-scan-ops.service'
import { securityPrReviewService } from '@/ee/security/services/security-pr-review.service'
import * as gh from '@/lib/integrations/github/contents'
import * as auth from '@/lib/integrations/github/auth'
import * as judge from '@/ee/security/llm/security-judge-client'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const fetchPrDiff = gh.fetchPrDiff as jest.Mock
const fetchPrHeadSha = gh.fetchPrHeadSha as jest.Mock
const readRepoFile = gh.readRepoFile as jest.Mock
const readRepoFileWithToken = gh.readRepoFileWithToken as jest.Mock
const getRepoToken = auth.getRepoToken as jest.Mock
const revokeInstallationToken = auth.revokeInstallationToken as jest.Mock

const PR = {
  id: 'pr1',
  workspaceId: 'w1',
  taskId: 't1',
  repo: 'o/r',
  number: 7,
}

/**
 * A benign file section of roughly `approxChars` characters, built from
 * NORMAL-LENGTH lines. One giant line would be the same character count and
 * take the per-line scanners two orders of magnitude longer — the trap
 * LUM-811 hit when it resized these fixtures.
 */
function section(path: string, approxChars: number): string {
  const head = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
  ].join('\n')
  const body: string[] = []
  let size = head.length
  let i = 0
  while (size < approxChars) {
    const line = `+const value_${i} = ${i}`
    body.push(line)
    size += line.length + 1
    i++
  }
  return `${head}\n@@ -0,0 +1,${body.length} @@\n${body.join('\n')}`
}

function diffOf(sections: string[]): string {
  return sections.join('\n')
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.LUMO_SECURITY_HUNT = 'off'
  process.env.LUMO_MANAGED_SCAN = 'off'
  ;(pullRequestRepository.findById as jest.Mock).mockResolvedValue(PR)
  fetchPrHeadSha.mockResolvedValue('sha-1')
  readRepoFile.mockResolvedValue(null)
  readRepoFileWithToken.mockResolvedValue(null)
  getRepoToken.mockResolvedValue('tok')
  revokeInstallationToken.mockResolvedValue(true)
  // The real helper's contract, over the mocked auth: mint once, run, revoke.
  ;(gh.withRepoReadToken as jest.Mock).mockImplementation(
    async (
      o: { workspaceId: string; fullName: string },
      fn: (t: string) => Promise<unknown>
    ) => {
      const t = await getRepoToken(o.workspaceId, o.fullName, {
        contents: 'read',
      })
      try {
        return await fn(t)
      } finally {
        await revokeInstallationToken(t)
      }
    }
  )
  repo.findByPrAndSha.mockResolvedValue(null)
  repo.create.mockResolvedValue({ id: 's1' } as never)
  repo.findDispositionedByPullRequest.mockResolvedValue([])
  repo.countExternalFindings.mockResolvedValue(0)
  ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({ findings: [] })
  ;(securityPrReviewService.sync as jest.Mock).mockResolvedValue({
    posted: true,
    inline: 0,
    skipped: 0,
  })
  ;(
    securityManagedScanOpsService.supersedeOlderRuns as jest.Mock
  ).mockResolvedValue({ superseded: 0, cancelled: 0, sandboxesStopped: 0 })
  ;(
    securityManagedScanOpsService.enforceHourlyCap as jest.Mock
  ).mockResolvedValue({ capped: false })
})

afterEach(() => {
  delete process.env.LUMO_MANAGED_SCAN
})

import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'
import { reviewContextService } from '@/ee/security/services/review-context.service'
import { loadReviewLearnings } from '@/ee/security/services/review-learnings.service'

const findPathFilters = repoReviewSettingRepository.findPathFilters as jest.Mock

beforeEach(() => {
  ;(reviewContextService.load as jest.Mock).mockResolvedValue({
    text: '',
    included: [],
    error: null,
  })
  ;(loadReviewLearnings as jest.Mock).mockResolvedValue('')
  findPathFilters.mockResolvedValue([])
})

import { prReviewControlRepository } from '@/ee/security/repositories/pr-review-control.repository'
import {
  filterReviewableDiff,
  isReviewablePath,
} from '@/ee/security/security-scan/reviewable-path'

interface Persisted {
  judgeBudget: {
    diffChars: number
    tierChars: number
    coveredFiles: number
    droppedFiles: number
    overCap?: {
      files: number
      capFiles: number
      capChars: number
      skippedPaths: string[]
    }
  } | null
  judgeReviewScope: string[] | null
  stages: Record<string, string>
  partialCauses: string[]
  truncated: boolean
}

async function run(): Promise<{ persisted: Persisted; rows: unknown[] }> {
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  const call = repo.persistResult.mock.calls[0]!
  return {
    rows: call[1] as unknown[],
    persisted: call[2] as unknown as Persisted,
  }
}

/** 9 source files of ~20k chars: ~186k chars, one over the 180k tier. */
function largeSourcePr(): string[] {
  return Array.from({ length: 9 }, (_, i) => section(`lib/mod${i}.ts`, 20_700))
}

describe('LUM-1144 partial AI review over the size cap', () => {
  it('a ~186k-char PR gets a partial review of the files that fit', async () => {
    const sections = largeSourcePr()
    fetchPrDiff.mockResolvedValue(diffOf(sections))
    expect(diffOf(sections).length).toBeGreaterThan(180_000)
    const { persisted } = await run()
    expect(judge.judgeSecurity).toHaveBeenCalledTimes(1)
    const judged = (judge.judgeSecurity as jest.Mock).mock.calls[0]![0]
      .diff as string
    expect(judged.length).toBeLessThanOrEqual(180_000)
    expect(persisted.stages.judge).toBe('PARTIAL')
    expect(persisted.partialCauses).toContain('JUDGE_PARTIAL_OVER_CAP')
    expect(persisted.partialCauses).not.toContain('JUDGE_OVER_CAP')
    const skipped = persisted.judgeBudget!.overCap!.skippedPaths
    expect(skipped).toHaveLength(1)
    expect(judged).not.toContain(`b/${skipped[0]}`)
    expect(persisted.judgeBudget!.overCap!.files).toBe(9)
    expect(persisted.judgeBudget!.coveredFiles).toBe(8)
    expect(persisted.judgeBudget!.droppedFiles).toBe(1)
    // Only the files read may close a finding.
    expect(persisted.judgeReviewScope).toHaveLength(8)
    expect(persisted.judgeReviewScope).not.toContain(skipped[0])
  })

  it('more than a quarter dropped: skipped whole with JUDGE_OVER_CAP, as before', async () => {
    fetchPrDiff.mockResolvedValue(
      diffOf([
        section('lib/a.ts', 95_000),
        section('lib/b.ts', 95_000),
        section('lib/c.ts', 95_000),
      ])
    )
    const { persisted } = await run()
    expect(judge.judgeSecurity).not.toHaveBeenCalled()
    expect(persisted.stages.judge).toBe('SKIPPED')
    expect(persisted.partialCauses).toContain('JUDGE_OVER_CAP')
    expect(persisted.partialCauses).not.toContain('JUDGE_PARTIAL_OVER_CAP')
    expect(persisted.judgeBudget!.overCap!.skippedPaths).toHaveLength(2)
  })

  it('lockfiles are excluded before counting: a big lockfile does not trip the cap', async () => {
    const source = section('lib/search.ts', 2_000)
    const full = diffOf([source, section('package-lock.json', 190_000)])
    fetchPrDiff.mockResolvedValue(full)
    const { persisted } = await run()
    expect(judge.judgeSecurity).toHaveBeenCalledTimes(1)
    expect(persisted.stages.judge).toBe('RAN')
    expect(persisted.partialCauses).not.toContain('JUDGE_OVER_CAP')
    expect(persisted.partialCauses).not.toContain('JUDGE_PARTIAL_OVER_CAP')
    // The budget is the reviewed input, not the raw PR diff.
    const filtered = filterReviewableDiff(full, isReviewablePath).diff
    expect(filtered.length).toBeLessThan(3_000)
    expect(persisted.judgeBudget!.diffChars).toBe(filtered.length)
    expect(persisted.judgeBudget!.overCap).toBeUndefined()
  })

  it('a carried finding on a skipped file is kept; one on a reviewed file is closed', async () => {
    fetchPrDiff.mockResolvedValue(diffOf(largeSourcePr()))
    // Learn which file the plan skips, then re-run with findings on both.
    const first = await run()
    const skipped = first.persisted.judgeBudget!.overCap!.skippedPaths[0]!
    const reviewed = first.persisted.judgeReviewScope![0]!
    jest.clearAllMocks()
    fetchPrHeadSha.mockResolvedValue('sha-1')
    repo.create.mockResolvedValue({ id: 's1' } as never)
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({ findings: [] })
    const prior = (path: string, fp: string) => ({
      id: `f-${fp}`,
      kind: 'CORRECTNESS',
      ruleId: 'review:logic',
      severity: 'MEDIUM',
      provenance: 'LLM_JUDGE',
      filePath: path,
      line: 3,
      title: 't',
      detail: 'd',
      evidence: 'e',
      fingerprint: fp,
      externalRef: null,
      disposition: null,
      dispositionNote: null,
      dispositionedById: null,
      dispositionedAt: null,
      verifierVerdict: null,
      persisting: false,
    })
    ;(prReviewControlRepository.priorFindings as jest.Mock).mockResolvedValue([
      prior(skipped, 'fp-skipped'),
      prior(reviewed, 'fp-reviewed'),
    ])
    const { rows } = await run()
    const fps = (rows as Array<{ fingerprint: string }>).map(r => r.fingerprint)
    expect(fps).toContain('fp-skipped')
    expect(fps).not.toContain('fp-reviewed')
  })
})

jest.mock('@/ee/security/services/auto-review-admission.service', () =>
  require('@/test-utils/ee/auto-review-admission-mock').delegatingAdmission()
)
jest.mock('@/ee/security/repositories/pr-review-control.repository', () => ({
  prReviewControlRepository: {
    reserve: jest.fn().mockResolvedValue(true),
    baseline: jest.fn().mockResolvedValue(null),
    priorFindings: jest.fn().mockResolvedValue([]),
    findingsOnScan: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({
      reviewPaused: false,
      reviewHeads: [],
    }),
  },
}))
