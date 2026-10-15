/**
 * @jest-environment node
 *
 * LUM-1208 — when the reviewed lines start a server, the scan sends the
 * config files next to it that the PR does not change (read-only, capped,
 * masked by the loader) to the AI review, pays for them out of the context
 * budget first, and records them on the budget line. Otherwise nothing is
 * read and the review input is unchanged.
 */
jest.mock('@/ee/security/repositories/repo-review-setting.repository', () => ({
  repoReviewSettingRepository: {
    findPathFilters: jest.fn(),
    findReviewStyle: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/review-learnings.service', () => ({
  loadReviewLearnings: jest.fn(),
}))
jest.mock('@/ee/security/services/review-context.service', () => ({
  reviewContextService: { load: jest.fn(), loadServerConfig: jest.fn() },
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
  fetchPrBase: jest.fn(),
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
    setRepoConfig: jest.fn(),
    setReviewProfile: jest.fn(),
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
import { clearRepoConfigCache } from '@/ee/security/services/repo-config.service'

const findPathFilters = repoReviewSettingRepository.findPathFilters as jest.Mock
const findReviewStyle = repoReviewSettingRepository.findReviewStyle as jest.Mock

beforeEach(() => {
  ;(reviewContextService.load as jest.Mock).mockResolvedValue({
    text: '',
    included: [],
    error: null,
  })
  ;(loadReviewLearnings as jest.Mock).mockResolvedValue('')
  findPathFilters.mockResolvedValue([])
  findReviewStyle.mockResolvedValue(null)
})

import { reviewContextBudget } from '@/ee/security/security-scan/review-context'

const MAKEFILE = [
  'diff --git a/Makefile b/Makefile',
  '--- a/Makefile',
  '+++ b/Makefile',
  '@@ -1,1 +1,4 @@',
  ' all: build',
  '+.PHONY: serve-fe',
  '+serve-fe:',
  '+\t@cd $(PROJECT_DIR)/frontend && $(TRUNK) serve',
].join('\n')
const CONFIG =
  '=== frontend/Trunk.toml ===\n[serve]\naddresses = ["0.0.0.0"]\n\n'

const loadServerConfig = reviewContextService.loadServerConfig as jest.Mock
const loadContext = reviewContextService.load as jest.Mock

function judgeInput(): Record<string, unknown> {
  const call = (judge.judgeSecurity as jest.Mock).mock.calls[0]
  expect(call).toBeDefined()
  return call![0]
}

async function runScan(): Promise<Record<string, unknown>> {
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  const call = repo.persistResult.mock.calls[0]
  expect(call).toBeDefined()
  return call![2] as unknown as Record<string, unknown>
}

beforeEach(() => {
  clearRepoConfigCache()
  ;(gh.fetchPrBase as jest.Mock).mockResolvedValue({
    ref: 'main',
    sha: 'b'.repeat(40),
  })
})

describe('LUM-1208 server config context on the scan', () => {
  it('a Makefile that starts a dev server sends its config read-only, budgeted first, and records it', async () => {
    fetchPrDiff.mockResolvedValue(MAKEFILE)
    loadServerConfig.mockResolvedValue({
      text: CONFIG,
      included: ['frontend/Trunk.toml'],
      error: null,
    })
    const meta = await runScan()
    expect(loadServerConfig).toHaveBeenCalledTimes(1)
    const args = loadServerConfig.mock.calls[0]![0]
    expect(args).toMatchObject({
      workspaceId: 'w1',
      repo: 'o/r',
      headSha: 'sha-1',
      changedPaths: ['Makefile'],
      plan: { triggers: ['Makefile'], dirs: ['frontend', ''], refs: [] },
    })
    expect(args.maxChars).toBe(8_000)
    expect(judgeInput().serverConfig).toBe(CONFIG)
    // The file context gets what the config left.
    const diffText = (judgeInput().diff as string).length
    expect(loadContext.mock.calls[0]![0].maxChars).toBe(
      reviewContextBudget(diffText + CONFIG.length)
    )
    expect(meta.judgeBudget).toMatchObject({
      serverConfig: { paths: ['frontend/Trunk.toml'], chars: CONFIG.length },
    })
  })

  it('no server start in the diff: nothing is listed and the review input and budget are unchanged', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('lib/a.ts', 500)]))
    const meta = await runScan()
    expect(loadServerConfig).not.toHaveBeenCalled()
    expect(judgeInput()).not.toHaveProperty('serverConfig')
    expect(meta.judgeBudget).not.toHaveProperty('serverConfig')
  })

  it('a failed config read is logged and the review still runs without it', async () => {
    fetchPrDiff.mockResolvedValue(MAKEFILE)
    loadServerConfig.mockResolvedValue({
      text: '',
      included: [],
      error: 'GitHub API error 403',
    })
    const meta = await runScan()
    expect(judgeInput()).not.toHaveProperty('serverConfig')
    expect(meta.judgeBudget).not.toHaveProperty('serverConfig')
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
