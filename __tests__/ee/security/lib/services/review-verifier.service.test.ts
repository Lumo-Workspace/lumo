/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findJudgeFindingsForVerify: jest.fn(),
    completeVerification: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/security-hunt-sandbox', () => ({
  attachOrCreateHuntSandbox: jest.fn(),
  releaseManagedScanVm: jest.fn(),
  runVerifierShell: jest.fn(),
  stopHuntSandbox: jest.fn(),
}))
jest.mock('@/ee/security/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))
jest.mock('@/ee/security/llm/review-verifier-client', () => ({
  verifyFindings: jest.fn(),
}))
jest.mock('@/ee/security/llm/review-ranker-client', () => ({
  rankFindings: jest.fn(),
}))

import { fetchPrDiff } from '@/lib/integrations/github/contents'
import { logger } from '@/lib/logger'
import { prSecurityScanRepository as repo } from '@/ee/security/repositories/pr-security-scan.repository'
import * as sandbox from '@/ee/security/services/security-hunt-sandbox'
import { securityPrReviewService } from '@/ee/security/services/security-pr-review.service'
import { verifyFindings } from '@/ee/security/llm/review-verifier-client'
import { rankFindings } from '@/ee/security/llm/review-ranker-client'
import {
  citedDiff,
  reviewVerifierService,
} from '@/ee/security/services/review-verifier.service'

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
  delete process.env.LUMO_REVIEW_RANKER
  ;(rankFindings as jest.Mock).mockResolvedValue({
    ranking: [],
    inputTokens: 0,
    outputTokens: 0,
    error: null,
  })
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

  it('LUM-1226 logs how many verdicts defaulted and how the wrap-up went', async () => {
    ;(verifyFindings as jest.Mock).mockResolvedValue({
      results: [{ id: 'a', verdict: 'CONFIRMED', reason: '', defaulted: true }],
      steps: 18,
      commands: 15,
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      error: null,
      wrapUp: { attempts: 2, submitted: false },
    })
    await reviewVerifierService.run(job)
    const line = (logger.info as jest.Mock).mock.calls
      .map(c => String(c[0]))
      .find(l => l.startsWith('[review-verifier]'))
    expect(line).toContain(' defaulted=1 wrapUp=2/none ')
  })

  it('LUM-1226 logs defaulted=0 and no wrap-up when the search submitted', async () => {
    await reviewVerifierService.run(job)
    const line = (logger.info as jest.Mock).mock.calls
      .map(c => String(c[0]))
      .find(l => l.startsWith('[review-verifier]'))
    expect(line).toContain(' defaulted=0 steps=')
    expect(line).not.toContain('wrapUp=')
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

describe('LUM-988 ranker after the verifier', () => {
  const confirmA = (error: string | null = null) =>
    (verifyFindings as jest.Mock).mockResolvedValue({
      results: [
        {
          id: 'a',
          verdict: 'CONFIRMED',
          reason: 'confirmed at src/a.ts:3',
          defaulted: false,
        },
      ],
      steps: 2,
      commands: 1,
      inputTokens: 1,
      outputTokens: 1,
      error,
    })

  it('ranks what the verifier left (security rows as context) and its rejection replaces CONFIRMED', async () => {
    confirmA()
    ;(rankFindings as jest.Mock).mockResolvedValue({
      ranking: [
        { id: 'b', p: 0, reason: 'xss is noise' },
        { id: 'a', p: 5, reason: 'speculative' },
      ],
      inputTokens: 10,
      outputTokens: 2,
      error: null,
    })
    const out = await reviewVerifierService.run(job)
    const input = (rankFindings as jest.Mock).mock.calls[0]![0]
    expect(input.findings.map((f: { id: string }) => f.id)).toEqual(['a', 'b'])
    expect(input.findings[0]).toMatchObject({
      kind: 'logic_error',
      verifierReason: 'confirmed at src/a.ts:3',
    })
    expect(input.findings[1]).toMatchObject({ kind: 'xss', verifierReason: '' })
    expect(input.diff).toContain('+++ b/src/a.ts')
    // One verdict per row: the ranker's REJECTED, never the xss row.
    const verdicts = (repo.completeVerification as jest.Mock).mock.calls[0]![1]
    expect(verdicts).toEqual([
      {
        findingId: 'a',
        verdict: 'REJECTED',
        reason: 'Ranked low: speculative',
      },
    ])
    expect(out.rejected).toBe(1)
  })

  it('a row ranked at or above the threshold keeps the verifier verdict', async () => {
    confirmA()
    ;(rankFindings as jest.Mock).mockResolvedValue({
      ranking: [{ id: 'a', p: 18, reason: 'real' }],
      inputTokens: 1,
      outputTokens: 1,
      error: null,
    })
    await reviewVerifierService.run(job)
    expect(
      (repo.completeVerification as jest.Mock).mock.calls[0]![1]
    ).toMatchObject([{ findingId: 'a', verdict: 'CONFIRMED' }])
  })

  it('does not rank when the verifier ended with an error', async () => {
    confirmA('timeout')
    await reviewVerifierService.run(job)
    expect(rankFindings).not.toHaveBeenCalled()
  })

  it('LUMO_REVIEW_RANKER=off turns only the ranker off', async () => {
    process.env.LUMO_REVIEW_RANKER = 'off'
    confirmA()
    await reviewVerifierService.run(job)
    expect(rankFindings).not.toHaveBeenCalled()
    expect(
      (repo.completeVerification as jest.Mock).mock.calls[0]![1]
    ).toMatchObject([{ findingId: 'a', verdict: 'CONFIRMED' }])
  })

  it('a ranker failure keeps the verifier verdicts and still syncs', async () => {
    confirmA()
    ;(rankFindings as jest.Mock).mockRejectedValue(new Error('boom'))
    const out = await reviewVerifierService.run(job)
    expect(
      (repo.completeVerification as jest.Mock).mock.calls[0]![1]
    ).toMatchObject([{ findingId: 'a', verdict: 'CONFIRMED' }])
    expect(securityPrReviewService.sync).toHaveBeenCalledWith('s1')
    expect(out.error).toBeNull()
  })

  it('skips the call when the verifier left nothing the policy can reject', async () => {
    await reviewVerifierService.run(job)
    expect(rankFindings).not.toHaveBeenCalled()
  })

  it('LUM-1194: a confirmed test finding is never ranked away, and alone it skips the call', async () => {
    ;(repo.findJudgeFindingsForVerify as jest.Mock).mockResolvedValue([
      row('a', { ruleId: 'review:test_defect' }),
    ])
    confirmA()
    ;(rankFindings as jest.Mock).mockResolvedValue({
      ranking: [{ id: 'a', p: 0, reason: 'test tidiness' }],
      inputTokens: 1,
      outputTokens: 1,
      error: null,
    })
    await reviewVerifierService.run(job)
    expect(rankFindings).not.toHaveBeenCalled()
    expect(
      (repo.completeVerification as jest.Mock).mock.calls[0]![1]
    ).toMatchObject([{ findingId: 'a', verdict: 'CONFIRMED' }])
  })

  it('LUM-1194: next to a removable finding, a low-ranked test finding stays', async () => {
    ;(repo.findJudgeFindingsForVerify as jest.Mock).mockResolvedValue([
      row('a'),
      row('t', { ruleId: 'review:test_defect' }),
    ])
    confirmA()
    ;(rankFindings as jest.Mock).mockResolvedValue({
      ranking: [
        { id: 't', p: 0, reason: 'test tidiness' },
        { id: 'a', p: 5, reason: 'speculative' },
      ],
      inputTokens: 1,
      outputTokens: 1,
      error: null,
    })
    await reviewVerifierService.run(job)
    const input = (rankFindings as jest.Mock).mock.calls[0]![0]
    expect(input.findings.map((f: { id: string }) => f.id)).toEqual(['a', 't'])
    const verdicts = (repo.completeVerification as jest.Mock).mock.calls[0]![1]
    expect(verdicts.map((v: { findingId: string }) => v.findingId)).toEqual([
      'a',
    ])
    expect(verdicts[0]).toMatchObject({ verdict: 'REJECTED' })
  })
})

describe('LUM-1013 verifier reason keeps quoted prose', () => {
  it('stores a prose reason verbatim (credential redaction: the LUM-988 ghp_ case above)', async () => {
    const prose =
      "Each group's aria-labelledby points at the 'Verification' heading, so the claim is wrong."
    ;(verifyFindings as jest.Mock).mockResolvedValue({
      results: [
        { id: 'a', verdict: 'REJECTED', reason: prose, defaulted: false },
      ],
      steps: 1,
      commands: 0,
      inputTokens: 1,
      outputTokens: 1,
      error: null,
    })
    await reviewVerifierService.run(job)
    const verdicts = (repo.completeVerification as jest.Mock).mock.calls[0]![1]
    expect(verdicts[0].reason).toBe(prose)
  })
})

describe('LUM-1210 path-instruction findings skip the verifier', () => {
  it('a row the owners asked for (verified pathInstruction) is never sent to the verifier', async () => {
    ;(repo.findJudgeFindingsForVerify as jest.Mock).mockResolvedValue([
      row('asked', { severity: 'LOW', pathInstruction: 'scripts/**' }),
    ])
    await reviewVerifierService.run(job)
    expect(sandbox.attachOrCreateHuntSandbox).not.toHaveBeenCalled()
    expect(verifyFindings).not.toHaveBeenCalled()
    expect(repo.completeVerification).toHaveBeenCalledWith('s1', [])
  })
})
