/**
 * @jest-environment node
 *
 * LUM-1318 — a scan layer the PR's Git platform cannot run (a capability its
 * `GitProvider` adapter does not declare) is recorded as unsupported on that
 * platform — NOT_CONFIGURED, never started, never an error — with no
 * branch on the platform's name. A fake provider stands in for "a platform
 * without a sandbox clone"; GitHub (every capability) is the control.
 */
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
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
  // LUM-785: stage A's graph rules read touched files; null = not found.
  readRepoFile: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/ee/security/llm/security-judge-client', () => ({
  judgeSecurity: jest.fn(),
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
    mergeStages: jest.fn(),
  },
}))
// LUM-740: stage A reads the workspace policy to decide whether a finding is
// urgent enough to sync the PR before the runs land; null = the 732 default.
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {},
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {},
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
    findLastSarifIngestAt: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { findUndispositionedByTask: jest.fn() },
}))
jest.mock('@/ee/security/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))
jest.mock('@/ee/security/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  recordHuntStartBestEffort: jest.fn(),
}))
// LUM-758: the VM-sharing cases below turn the managed scan ON, which drags
// in supersede / the hourly cap / the baseline request.
jest.mock('@/ee/security/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {
    supersedeOlderRuns: jest.fn().mockResolvedValue(undefined),
    enforceHourlyCap: jest.fn().mockResolvedValue({ capped: false }),
  },
}))
jest.mock('@/ee/security/services/security-baseline.service', () => ({
  securityBaselineService: { ensure: jest.fn().mockResolvedValue(undefined) },
}))
jest.mock('@/ee/security/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))

// LUM-1318: the resolver hands stage A the provider under test.
jest.mock('@/lib/integrations/git-provider/resolve', () => {
  const actual = jest.requireActual('@/lib/integrations/git-provider/resolve')
  return { ...actual, gitProviderFor: jest.fn(actual.gitProviderFor) }
})

import { prSecurityScanService } from '@/ee/security/services/pr-security-scan.service'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { startSecurityManagedScan } from '@/ee/security/services/security-managed-scan-start'
import { startSecurityHunt } from '@/ee/security/services/security-hunt-start'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/ee/security/llm/security-judge-client'
import { gitProviderFor } from '@/lib/integrations/git-provider/resolve'
import { githubGitProvider } from '@/lib/integrations/git-provider/github'
import {
  allCapabilities,
  type GitProvider,
  type GitProviderCapability,
} from '@/lib/integrations/git-provider'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const prRepo = pullRequestRepository as jest.Mocked<
  typeof pullRequestRepository
>
const crossings = boundaryCrossingRepository as jest.Mocked<
  typeof boundaryCrossingRepository
>
const resolver = gitProviderFor as jest.Mock
const startManaged = startSecurityManagedScan as jest.Mock
const startHunt = startSecurityHunt as jest.Mock

/** GitHub's reads, minus the capabilities a platform lacks. */
function fakeProvider(missing: GitProviderCapability[]): GitProvider {
  const capabilities = { ...allCapabilities() }
  for (const c of missing) capabilities[c] = false
  return { ...githubGitProvider, id: 'codeup', capabilities }
}

const PR = {
  id: 'pr1',
  workspaceId: 'w1',
  taskId: 't1',
  repo: 'o/r',
  number: 7,
  provider: 'github',
}
const ROUTE_DIFF = [
  '--- a/app/api/x/route.ts',
  '+++ b/app/api/x/route.ts',
  '@@ -1,0 +1,1 @@',
  '+export async function POST(req: Request) {',
].join('\n')

beforeAll(() => {
  process.env.LUMO_REVIEW_VERIFIER = 'off'
})
afterAll(() => {
  delete process.env.LUMO_REVIEW_VERIFIER
  delete process.env.LUMO_MANAGED_SCAN
})

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.LUMO_SECURITY_HUNT
  process.env.LUMO_MANAGED_SCAN = 'on'
  resolver.mockImplementation(
    jest.requireActual('@/lib/integrations/git-provider/resolve').gitProviderFor
  )
  prRepo.findById.mockResolvedValue(PR as never)
  ;(gh.fetchPrHeadSha as jest.Mock).mockResolvedValue('sha-1')
  ;(gh.fetchPrDiff as jest.Mock).mockResolvedValue(ROUTE_DIFF)
  repo.findByPrAndSha.mockResolvedValue(null)
  repo.create.mockResolvedValue({ id: 's1' })
  repo.findDispositionedByPullRequest.mockResolvedValue([])
  repo.countExternalFindings.mockResolvedValue(0)
  repo.persistResult.mockResolvedValue({ managedLayerLanded: false } as never)
  repo.mergeStages.mockResolvedValue(undefined as never)
  repo.setManagedRunId = jest.fn().mockResolvedValue(undefined) as never
  ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({ findings: [] })
  crossings.findUndispositionedByTask.mockResolvedValue([] as never)
  startManaged.mockResolvedValue('run_m1')
  startHunt.mockResolvedValue('run_h1')
})

const run = () =>
  prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
const persistedStages = () => repo.persistResult.mock.calls[0]![2].stages

describe('LUM-1318 platform capabilities gate the scan layers', () => {
  it('resolves the provider from the PR row', async () => {
    await run()
    expect(resolver).toHaveBeenCalledWith(PR)
  })

  it('control — GitHub (every capability): the managed scan and the hunt start', async () => {
    await expect(run()).resolves.toMatchObject({ status: 'CLEAN' })
    expect(startManaged).toHaveBeenCalledTimes(1)
    expect(startHunt).toHaveBeenCalledTimes(1)
    expect(persistedStages()).toMatchObject({
      secrets: 'RAN',
      external: 'PENDING',
      supplyChain: 'PENDING',
      hunt: 'PENDING',
    })
  })

  it('no sandbox clone: managed scan and hunt are recorded unsupported, never started, and the scan still finishes', async () => {
    resolver.mockReturnValue(fakeProvider(['repoClone']))
    await expect(run()).resolves.toMatchObject({
      scanId: 's1',
      status: 'CLEAN',
    })
    expect(startManaged).not.toHaveBeenCalled()
    expect(startHunt).not.toHaveBeenCalled()
    const stages = persistedStages()
    expect(stages).toMatchObject({
      secrets: 'RAN',
      external: 'NOT_CONFIGURED',
      supplyChain: 'NOT_CONFIGURED',
      hunt: 'NOT_CONFIGURED',
    })
    // The layers the platform can run ran as before.
    expect(stages.judge).not.toBe('NOT_CONFIGURED')
    expect(repo.finalize).not.toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ status: 'FAILED' })
    )
  })

  it('a capability no layer needs changes nothing', async () => {
    resolver.mockReturnValue(fakeProvider(['reviewThreads']))
    await run()
    expect(startManaged).toHaveBeenCalledTimes(1)
    expect(startHunt).toHaveBeenCalledTimes(1)
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
