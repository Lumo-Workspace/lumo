/**
 * @jest-environment node
 *
 * LUM-1146 — the scan reads `.lumo.yaml` at the PR's BASE commit: its
 * `reviews.path_filters` win over the repository's stored filters, the PR's
 * own copy is only checked (never applied), and how the file was read is
 * stored on the scan row for the PR summary. A file that cannot be read or
 * validated never fails the scan.
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

beforeEach(() => {
  ;(reviewContextService.load as jest.Mock).mockResolvedValue({
    text: '',
    included: [],
    error: null,
  })
  ;(loadReviewLearnings as jest.Mock).mockResolvedValue('')
  findPathFilters.mockResolvedValue([])
})

async function judgedDiff(): Promise<string> {
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  const call = (judge.judgeSecurity as jest.Mock).mock.calls[0]
  expect(call).toBeDefined()
  return call![0].diff as string
}

const BASE_SHA = 'b'.repeat(40)
const HEAD_SHA = 'c'.repeat(40)

function files(byRef: Record<string, string | null | Error>) {
  readRepoFile.mockImplementation(async (o: { path: string; ref?: string }) => {
    if (o.path !== '.lumo.yaml') return null
    const v = byRef[o.ref ?? '']
    if (v instanceof Error) throw v
    return v ?? null
  })
}

function storedNotice(): Record<string, unknown> {
  const call = (repo.setRepoConfig as jest.Mock).mock.calls[0]
  expect(call?.[0]).toBe('s1')
  return call![1] as Record<string, unknown>
}

beforeEach(() => {
  clearRepoConfigCache()
  fetchPrHeadSha.mockResolvedValue(HEAD_SHA)
  ;(gh.fetchPrBase as jest.Mock).mockResolvedValue({
    ref: 'main',
    sha: BASE_SHA,
  })
  fetchPrDiff.mockResolvedValue(
    diffOf([section('lib/search.ts', 500), section('docs/guide.md', 500)])
  )
})

describe('LUM-1146 .lumo.yaml on the scan', () => {
  it('path_filters from the base commit win over the stored filters', async () => {
    findPathFilters.mockResolvedValue(['!lib/**'])
    files({ [BASE_SHA]: 'reviews:\n  path_filters: ["!docs/**"]\n' })
    const diff = await judgedDiff()
    expect(diff).toContain('lib/search.ts')
    expect(diff).not.toContain('docs/guide.md')
    expect(readRepoFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: '.lumo.yaml', ref: BASE_SHA })
    )
    expect(storedNotice()).toEqual({
      baseRef: 'main',
      base: { status: 'loaded', sha: BASE_SHA, problems: [], unknownKeys: [] },
      prBranch: null,
    })
  })

  it("the PR's own copy is checked but never applied (it cannot loosen the review)", async () => {
    fetchPrDiff.mockResolvedValue(
      diffOf([
        section('lib/search.ts', 500),
        section('docs/guide.md', 500),
        section('.lumo.yaml', 100),
      ])
    )
    files({
      [BASE_SHA]: null,
      [HEAD_SHA]: 'reviews:\n  path_filters: ["!lib/**", "!docs/**"]\n',
    })
    const diff = await judgedDiff()
    // The head copy would have excluded everything; the base has no file.
    expect(diff).toContain('lib/search.ts')
    expect(diff).toContain('docs/guide.md')
    const notice = storedNotice()
    expect(notice.base).toEqual(expect.objectContaining({ status: 'absent' }))
    expect(notice.prBranch).toEqual(
      expect.objectContaining({ status: 'loaded', sha: HEAD_SHA })
    )
  })

  it('the head copy is not read when the PR does not touch .lumo.yaml', async () => {
    files({ [BASE_SHA]: null })
    await judgedDiff()
    const refs = readRepoFile.mock.calls
      .filter(c => (c[0] as { path: string }).path === '.lumo.yaml')
      .map(c => (c[0] as { ref?: string }).ref)
    expect(refs).toEqual([BASE_SHA])
  })

  it('an invalid base file falls back to the stored filters and is recorded', async () => {
    findPathFilters.mockResolvedValue(['!docs/**'])
    files({ [BASE_SHA]: 'reviews:\n  path_filters: "!lib/**"\n' })
    const diff = await judgedDiff()
    expect(diff).toContain('lib/search.ts')
    expect(diff).not.toContain('docs/guide.md')
    const notice = storedNotice() as {
      base: { status: string; problems: string[] }
    }
    expect(notice.base.status).toBe('invalid')
    expect(notice.base.problems[0]).toMatch(/reviews\.path_filters/)
  })

  it('an unreadable file or base never fails the scan', async () => {
    files({ [BASE_SHA]: new Error('GitHub API error 500') })
    await expect(judgedDiff()).resolves.toContain('docs/guide.md')
    expect(storedNotice().base).toEqual(
      expect.objectContaining({ status: 'unreadable' })
    )

    jest.clearAllMocks()
    clearRepoConfigCache()
    fetchPrHeadSha.mockResolvedValue(HEAD_SHA)
    repo.create.mockResolvedValue({ id: 's1' } as never)
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({ findings: [] })
    ;(gh.fetchPrBase as jest.Mock).mockRejectedValue(new Error('404'))
    ;(repo.setRepoConfig as jest.Mock).mockRejectedValue(new Error('db'))
    await expect(judgedDiff()).resolves.toContain('docs/guide.md')
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
