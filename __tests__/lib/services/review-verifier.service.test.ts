/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findJudgeFindingsForVerify: jest.fn(),
    completeVerification: jest.fn(),
  },
}))
jest.mock('@/lib/services/security-hunt-sandbox', () => ({
  attachOrCreateHuntSandbox: jest.fn(),
  releaseManagedScanVm: jest.fn(),
  runVerifierShell: jest.fn(),
  stopHuntSandbox: jest.fn(),
}))
jest.mock('@/lib/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))
jest.mock('@/lib/llm/review-verifier-client', () => ({
  verifyFindings: jest.fn(),
}))

import { fetchPrDiff } from '@/lib/integrations/github/contents'
import { prSecurityScanRepository as repo } from '@/lib/repositories/pr-security-scan.repository'
import * as sandbox from '@/lib/services/security-hunt-sandbox'
import { securityPrReviewService } from '@/lib/services/security-pr-review.service'
import { verifyFindings } from '@/lib/llm/review-verifier-client'
import {
  citedDiff,
  reviewVerifierService,
} from '@/lib/services/review-verifier.service'

const job = {
  scanId: 's1',
  workspaceId: 'w1',
  repo: 'o/r',
  prNumber: 7,
  headSha: 'sha',
  managedScanStarted: true,
  stopAttachedWhenDone: true,
}
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'CORRECTNESS',
  ruleId: 'review:logic_error',
  severity: 'MEDIUM',
  filePath: 'src/a.ts',
  line: 3,
  title: `t ${id}`,
  detail: 'd',
  evidence: 'e',
  ...over,
})
const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,1 +1,1 @@',
  '-old',
  '+new',
  'diff --git a/src/b.ts b/src/b.ts',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -1,1 +1,1 @@',
  '-x',
  '+y',
].join('\n')
const handle = { origin: 'attached' }

beforeEach(() => {
  jest.resetAllMocks()
  ;(repo.findJudgeFindingsForVerify as jest.Mock).mockResolvedValue([
    row('a'),
    row('b', { kind: 'VULNERABILITY', ruleId: 'vuln:xss' }),
  ])
  ;(fetchPrDiff as jest.Mock).mockResolvedValue(DIFF)
  ;(sandbox.attachOrCreateHuntSandbox as jest.Mock).mockResolvedValue(handle)
  ;(sandbox.runVerifierShell as jest.Mock).mockResolvedValue('out')
  ;(verifyFindings as jest.Mock).mockResolvedValue({
    results: [
      {
        id: 'a',
        verdict: 'REJECTED',
        reason: 'guarded at src/a.ts:2 token ghp_' + 'A'.repeat(36),
        defaulted: false,
      },
      { id: 'b', verdict: 'REJECTED', reason: 'r', defaulted: false },
    ],
    steps: 3,
    commands: 2,
    inputTokens: 1,
    outputTokens: 1,
    error: null,
  })
})

describe('LUM-988 citedDiff', () => {
  it('keeps only the cited files, smallest first, under the cap', () => {
    const out = citedDiff(DIFF, new Set(['src/a.ts']), 10_000)
    expect(out).toContain('+++ b/src/a.ts')
    expect(out).not.toContain('src/b.ts')
    expect(citedDiff(DIFF, new Set(['src/a.ts', 'src/b.ts']), 10)).toBe('')
  })
})

describe('LUM-988 reviewVerifierService.run', () => {
  it('verifies in the VM, persists only policy-applied verdicts (redacted), stops the VM, syncs', async () => {
    const out = await reviewVerifierService.run(job)
    expect(sandbox.attachOrCreateHuntSandbox).toHaveBeenCalledWith({
      scanId: 's1',
      workspaceId: 'w1',
      repo: 'o/r',
      headSha: 'sha',
      managedScanStarted: true,
    })
    const input = (verifyFindings as jest.Mock).mock.calls[0]![0]
    // Only the rows the policy can reject are sent (the xss row is not).
    expect(input.findings.map((f: { kind: string }) => f.kind)).toEqual([
      'logic_error',
    ])
    expect(input.diff).toContain('+++ b/src/a.ts')
    await input.runShell('rg x')
    expect(sandbox.runVerifierShell).toHaveBeenCalledWith(handle, 'rg x')
    // A verdict for a row that was never sent is ignored.
    const verdicts = (repo.completeVerification as jest.Mock).mock.calls[0]![1]
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({ findingId: 'a', verdict: 'REJECTED' })
    expect(verdicts[0].reason).not.toContain('ghp_' + 'A'.repeat(36))
    expect(sandbox.stopHuntSandbox).toHaveBeenCalledWith(handle, {
      includeAttached: true,
    })
    expect(securityPrReviewService.sync).toHaveBeenCalledWith('s1')
    expect(out).toEqual({ findings: 1, rejected: 1, error: null })
  })

  it('on a failed VM attach records no verdict but still releases the hold and syncs', async () => {
    ;(sandbox.attachOrCreateHuntSandbox as jest.Mock).mockRejectedValue(
      new Error('no vm')
    )
    const out = await reviewVerifierService.run(job)
    expect(verifyFindings).not.toHaveBeenCalled()
    expect(repo.completeVerification).toHaveBeenCalledWith('s1', [])
    expect(securityPrReviewService.sync).toHaveBeenCalledWith('s1')
    expect(out.error).toBe('no vm')
  })

  it('still syncs when recording the verdicts fails', async () => {
    ;(repo.completeVerification as jest.Mock).mockRejectedValue(new Error('db'))
    await expect(reviewVerifierService.run(job)).resolves.toMatchObject({
      rejected: 1,
    })
    expect(securityPrReviewService.sync).toHaveBeenCalled()
  })

  it('with no LLM_JUDGE findings boots nothing and only releases the hold', async () => {
    ;(repo.findJudgeFindingsForVerify as jest.Mock).mockResolvedValue([])
    await reviewVerifierService.run({ ...job, stopAttachedWhenDone: false })
    expect(sandbox.attachOrCreateHuntSandbox).not.toHaveBeenCalled()
    expect(repo.completeVerification).toHaveBeenCalledWith('s1', [])
  })

  it('leaves an attached VM running when a hunt still needs it', async () => {
    await reviewVerifierService.run({ ...job, stopAttachedWhenDone: false })
    expect(sandbox.stopHuntSandbox).toHaveBeenCalledWith(handle, {
      includeAttached: false,
    })
  })
})

describe('LUM-988 release-only mode', () => {
  it('only releases the managed VM: no findings read, no model, no hold change, no sync', async () => {
    ;(sandbox.releaseManagedScanVm as jest.Mock).mockResolvedValue('stopped')
    const out = await reviewVerifierService.run({ ...job, releaseOnly: true })
    expect(sandbox.releaseManagedScanVm).toHaveBeenCalledWith({ scanId: 's1' })
    expect(repo.findJudgeFindingsForVerify).not.toHaveBeenCalled()
    expect(verifyFindings).not.toHaveBeenCalled()
    expect(repo.completeVerification).not.toHaveBeenCalled()
    expect(securityPrReviewService.sync).not.toHaveBeenCalled()
    expect(out).toEqual({ findings: 0, rejected: 0, error: null })
  })

  it('a scan with no verifiable row boots no VM and only releases the hold', async () => {
    ;(repo.findJudgeFindingsForVerify as jest.Mock).mockResolvedValue([
      row('h', { severity: 'HIGH' }),
      row('v', { kind: 'VULNERABILITY', ruleId: 'vuln:xss' }),
    ])
    await reviewVerifierService.run(job)
    expect(sandbox.attachOrCreateHuntSandbox).not.toHaveBeenCalled()
    expect(repo.completeVerification).toHaveBeenCalledWith('s1', [])
    expect(securityPrReviewService.sync).toHaveBeenCalledWith('s1')
  })
})
