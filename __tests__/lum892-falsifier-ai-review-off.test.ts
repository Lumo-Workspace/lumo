/**
 * @jest-environment node
 *
 * LUM-892 — the workspace switches, end to end through both writers of
 * scanner findings (the managed scan and the SARIF ingest):
 *
 * - AI review off: the false-positive falsifier sends no diff to a model,
 *   yet the scan is still stamped as suggested so the PR write-back does not
 *   hold the external rows forever.
 * - Scanning turned off while a managed run was in flight: its report lands
 *   nothing, runs no falsifier and posts no findings; the layers read as off
 *   in settings and the PR summary says scanning is off.
 *
 * Real: the workflow bodies, the suggestion steps and service, the switch
 * loader/resolver, the scanning-off step and the PR summary rewrite. Mocked:
 * the database rows, GitHub and the model client.
 */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
jest.mock('workflow', () => ({ sleep: jest.fn() }))
jest.mock('@/lib/services/security-sarif-blob', () => ({
  fetchPrivateBlob: jest.fn(),
  deleteBlob: jest.fn(),
  listSarifBlobs: jest.fn(),
}))
jest.mock('@/lib/workflows/security-managed-scan.steps', () => ({
  ...jest.requireActual('@/lib/workflows/security-managed-scan.steps'),
  scanRepositoryInSandboxStep: jest.fn(),
}))
jest.mock('@/lib/workflows/security-sarif-ingest.steps', () => ({
  resolveSarifScanStep: jest.fn(),
  fetchAndNormalizeSarifStep: jest.fn(),
  persistSarifFindingsStep: jest.fn(),
  markSarifExternalFailedStep: jest.fn(),
  markSarifStagesStep: jest.fn(),
  deleteSarifBlobStep: jest.fn(),
}))
jest.mock('@/lib/workflows/security-pr-review.steps', () => ({
  syncPrReviewStep: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findScanForSuggestion: jest.fn(),
    markSuggested: jest.fn(),
    addSuggestionTokens: jest.fn(),
    setSuggestedDisposition: jest.fn(),
    mergeStages: jest.fn(),
    findSummaryCommentIdByPullRequest: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findSecuritySwitches: jest.fn() },
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/lib/integrations/github/pr-comment-client', () => ({
  ...jest.requireActual('@/lib/integrations/github/pr-comment-client'),
  prCommentClient: {
    createIssueComment: jest.fn(),
    updateIssueComment: jest.fn(),
    listIssueComments: jest.fn(),
    listReviewComments: jest.fn(),
  },
}))
jest.mock('@/lib/llm/security-disposition-falsifier-client', () => ({
  falsifyExternalFinding: jest.fn(),
}))

import { securityManagedScanWorkflow } from '@/lib/workflows/security-managed-scan'
import { securitySarifIngestWorkflow } from '@/lib/workflows/security-sarif-ingest'
import { scanRepositoryInSandboxStep } from '@/lib/workflows/security-managed-scan.steps'
import * as sarifSteps from '@/lib/workflows/security-sarif-ingest.steps'
import { syncPrReviewStep } from '@/lib/workflows/security-pr-review.steps'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { falsifyExternalFinding } from '@/lib/llm/security-disposition-falsifier-client'
import { SCANNING_OFF_NOTE } from '@/shared/src/security-scan'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const switchesRow = workspaceRepository.findSecuritySwitches as jest.Mock
const sandbox = scanRepositoryInSandboxStep as jest.Mock
const resolve = sarifSteps.resolveSarifScanStep as jest.Mock
const fetchNorm = sarifSteps.fetchAndNormalizeSarifStep as jest.Mock
const persist = sarifSteps.persistSarifFindingsStep as jest.Mock
const sync = syncPrReviewStep as jest.Mock
const diffFetch = fetchPrDiff as jest.Mock
const falsify = falsifyExternalFinding as jest.Mock
const updateComment = prCommentClient.updateIssueComment as jest.Mock
const createComment = prCommentClient.createIssueComment as jest.Mock

const PR = { id: 'pr1', workspaceId: 'w1', repo: 'o/r', number: 7 }
const MANAGED_JOB = {
  scanId: 's1',
  pr: PR,
  headSha: 'a'.repeat(40),
  huntWanted: false,
}
const SARIF_JOB = {
  url: 'https://blob.vercel-storage.com/security-sarif/o--r/sha1/semgrep-abc.sarif.gz',
  pathname: 'security-sarif/o--r/sha1/semgrep-abc.sarif.gz',
  repository: 'o/r',
  headSha: 'sha1',
  prNumber: 7,
  tool: 'semgrep',
}
const ok = (tool: string, n: number) => ({
  kind: 'ok',
  tool,
  tools: [tool],
  findings: Array.from({ length: n }, (_, i) => ({ ruleId: `${tool}-${i}` })),
  truncated: false,
  dropped: { notInDiff: 0, noLocation: 0, duplicate: 0 },
})
const skipped = () => ({ kind: 'skipped', reason: 'nothing to scan' })
const MANAGED_OUTCOME = {
  gitleaks: ok('gitleaks', 0),
  semgrep: ok('semgrep', 1),
  'osv-scanner': skipped(),
  zizmor: skipped(),
  trivy: skipped(),
}
const DIFF = [
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,0 +1,1 @@',
  '+eval(req.body)',
].join('\n')
const CANDIDATE_ROW = {
  id: 'f1',
  ruleId: 'semgrep:eval',
  severity: 'HIGH',
  filePath: 'src/a.ts',
  line: 1,
  title: 'eval of request input',
  detail: 'user input reaches eval',
  externalRef: null,
}

const ALL_ON = {
  securityScanEnabled: true,
  securityAiReviewEnabled: true,
  securityHuntEnabled: true,
}
const switches = (patch: Partial<typeof ALL_ON>) =>
  switchesRow.mockResolvedValue({ ...ALL_ON, ...patch })

beforeEach(() => {
  jest.clearAllMocks()
  switches({})
  sandbox.mockResolvedValue(MANAGED_OUTCOME)
  resolve.mockResolvedValue({ kind: 'ok', scanId: 's1', pr: PR })
  fetchNorm.mockResolvedValue(ok('semgrep', 1))
  persist.mockImplementation(async (input: { findings: unknown[] }) => ({
    written: input.findings.length,
    partial: false,
  }))
  repo.findScanForSuggestion.mockResolvedValue({
    findings: [CANDIDATE_ROW],
    pullRequest: { workspaceId: 'w1', repo: 'o/r', number: 7 },
  } as never)
  repo.findSummaryCommentIdByPullRequest.mockResolvedValue('c-42')
  diffFetch.mockResolvedValue(DIFF)
  falsify.mockResolvedValue({ verdict: 'INCONCLUSIVE', tokens: 5 })
  ;(getRepoToken as jest.Mock).mockResolvedValue('tok')
  updateComment.mockResolvedValue(undefined)
})

describe('LUM-892 falsifier with AI review off', () => {
  beforeEach(() => switches({ securityAiReviewEnabled: false }))

  it('LUM-892 falsifier: managed scan sends no diff to the model and still stamps the scan', async () => {
    await expect(
      securityManagedScanWorkflow(MANAGED_JOB)
    ).resolves.toMatchObject({ outcome: 'INGESTED', findings: 1 })
    expect(falsify).not.toHaveBeenCalled()
    expect(diffFetch).not.toHaveBeenCalled()
    // Stamped, so the write-back posts the external rows instead of waiting.
    expect(repo.markSuggested).toHaveBeenCalledWith('s1')
    expect(sync).toHaveBeenCalledWith('s1')
  })

  it('LUM-892 falsifier: SARIF ingest sends no diff to the model and still stamps the scan', async () => {
    await expect(securitySarifIngestWorkflow(SARIF_JOB)).resolves.toMatchObject(
      { outcome: 'INGESTED', findings: 1 }
    )
    expect(falsify).not.toHaveBeenCalled()
    expect(diffFetch).not.toHaveBeenCalled()
    expect(repo.markSuggested).toHaveBeenCalledWith('s1')
    expect(sync).toHaveBeenCalledWith('s1')
  })

  it('LUM-892 falsifier control: with AI review on, both paths judge the finding', async () => {
    switches({})
    await securityManagedScanWorkflow(MANAGED_JOB)
    await securitySarifIngestWorkflow(SARIF_JOB)
    expect(falsify).toHaveBeenCalledTimes(2)
    expect(falsify.mock.calls[0]![0]).toMatchObject({
      finding: { filePath: 'src/a.ts' },
    })
    expect(repo.markSuggested).toHaveBeenCalledTimes(2)
  })
})

describe('LUM-892 in-flight managed run after scanning was turned off', () => {
  beforeEach(() => switches({ securityScanEnabled: false }))

  it('LUM-892 in-flight managed run lands no findings, runs no falsifier and reads as off in settings', async () => {
    await expect(securityManagedScanWorkflow(MANAGED_JOB)).resolves.toEqual({
      outcome: 'DISCARDED',
      reason: 'workspace_scan_disabled',
    })
    expect(persist).not.toHaveBeenCalled()
    expect(repo.findScanForSuggestion).not.toHaveBeenCalled()
    expect(falsify).not.toHaveBeenCalled()
    // No findings go to the PR: the review sync never runs.
    expect(sync).not.toHaveBeenCalled()
    expect(repo.mergeStages).toHaveBeenCalledWith('s1', {
      external: 'DISABLED',
      supplyChain: 'DISABLED',
    })
    // The summary an earlier scan left is rewritten to say scanning is off.
    expect(updateComment).toHaveBeenCalledTimes(1)
    expect(updateComment.mock.calls[0]![0]).toMatchObject({
      externalId: 'c-42',
    })
    expect(updateComment.mock.calls[0]![0].body).toContain(SCANNING_OFF_NOTE)
    expect(createComment).not.toHaveBeenCalled()
  })

  it('LUM-892 in-flight managed run on a PR Lumo never commented on posts nothing', async () => {
    repo.findSummaryCommentIdByPullRequest.mockResolvedValue(null)
    await securityManagedScanWorkflow(MANAGED_JOB)
    expect(updateComment).not.toHaveBeenCalled()
    expect(createComment).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })

  it('LUM-892 in-flight managed run control: with scanning on the report lands', async () => {
    switches({})
    await expect(
      securityManagedScanWorkflow(MANAGED_JOB)
    ).resolves.toMatchObject({ outcome: 'INGESTED' })
    expect(persist).toHaveBeenCalled()
    expect(repo.mergeStages).not.toHaveBeenCalled()
  })
})
