/**
 * @jest-environment node
 *
 * LUM-988 — the AI review is a general code review: stage A hands it the
 * PR-head content of the changed files (redacted, through readRepoFile so an
 * unconfirmed repository is refused), maps bug kinds to CORRECTNESS /
 * `review:<kind>`, and keeps every LLM finding advisory. A context failure
 * never stops the review: it runs on the diff alone.
 */
// LUM-866: every workspace here has the default switches (all on); the
// platform env in each test still decides the ceiling.
jest.mock('@/lib/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/lib/security-scan/workspace-switches')
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
jest.mock('@/lib/llm/security-judge-client', () => ({
  judgeSecurity: jest.fn(),
}))
jest.mock('@/lib/llm/security-falsifier-client', () => ({
  falsifyCandidate: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
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
jest.mock('@/lib/services/review-verifier-start', () => ({
  startReviewVerifier: jest.fn(),
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findById: jest.fn(),
    findManyForSecurityByTaskId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findLastSarifIngestAt: jest.fn(),
    findSecurityBaseline: jest.fn(),
  },
}))
jest.mock('@/lib/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))
jest.mock('@/lib/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {
    supersedeOlderRuns: jest.fn(),
    enforceHourlyCap: jest.fn(),
  },
}))
jest.mock('@/lib/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  recordHuntStartBestEffort: jest.fn(),
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { findUndispositionedByTask: jest.fn() },
}))
jest.mock('@/lib/services/security-baseline.service', () => ({
  securityBaselineService: { ensure: jest.fn().mockResolvedValue('present') },
}))
jest.mock('@/lib/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

import {
  distinctFingerprint,
  prSecurityScanService,
} from '@/lib/services/pr-security-scan.service'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { securityManagedScanOpsService } from '@/lib/services/security-managed-scan-ops.service'
import { securityPrReviewService } from '@/lib/services/security-pr-review.service'
import * as gh from '@/lib/integrations/github/contents'
import * as auth from '@/lib/integrations/github/auth'
import * as judge from '@/lib/llm/security-judge-client'
import { startReviewVerifier } from '@/lib/services/review-verifier-start'
import { projectRepository } from '@/lib/repositories/project.repository'
import { startSecurityManagedScan } from '@/lib/services/security-managed-scan-start'
import {
  DEFAULT_SECURITY_POLICY,
  isBlockingUnderPolicy,
} from '@/lib/security-scan/policy'

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

async function runScan2(): Promise<void> {
  await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })
}

async function runScan(): Promise<Record<string, unknown>> {
  await prSecurityScanService.run({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
  })
  const call = repo.persistResult.mock.calls[0]
  expect(call).toBeDefined()
  return call![2] as unknown as Record<string, unknown>
}

const BUG = {
  kind: 'logic_error',
  severity: 'HIGH',
  filePath: 'lib/search.ts',
  line: 2,
  title: 'Inverted check',
  detail: 'The guard is negated.',
  evidence: 'const value_1 = 1',
}
const VULN = { ...BUG, kind: 'xss', title: 'Unescaped HTML' }

describe('LUM-988 AI review — findings', () => {
  it('maps bug kinds to CORRECTNESS / review:<kind> and security kinds to VULNERABILITY', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('lib/search.ts', 1_000)]))
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [BUG, VULN],
    })

    await runScan()

    const rows = repo.persistResult.mock.calls[0]![1]
    expect(rows.map(r => [r.kind, r.ruleId, r.provenance])).toEqual([
      ['CORRECTNESS', 'review:logic_error', 'LLM_JUDGE'],
      ['VULNERABILITY', 'vuln:xss', 'LLM_JUDGE'],
    ])
  })

  it('never lets a stored CORRECTNESS row block DONE, even at HIGH severity', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('lib/search.ts', 1_000)]))
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({ findings: [BUG] })

    await runScan()

    const row = repo.persistResult.mock.calls[0]![1][0]!
    expect([row.kind, row.severity]).toEqual(['CORRECTNESS', 'HIGH'])
    expect(
      isBlockingUnderPolicy(
        { ...row, disposition: row.disposition ?? null },
        DEFAULT_SECURITY_POLICY
      )
    ).toBe(false)
  })
})

describe('LUM-988 AI review — fingerprints survive re-wording', () => {
  it('gives the same problem the same fingerprint when only the title changes', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('lib/search.ts', 1_000)]))
    ;(judge.judgeSecurity as jest.Mock)
      .mockResolvedValueOnce({ findings: [BUG] })
      .mockResolvedValueOnce({
        findings: [{ ...BUG, title: 'Guard is inverted', detail: 'Reworded.' }],
      })

    await runScan()
    fetchPrHeadSha.mockResolvedValue('sha-2')
    await runScan2()

    const first = repo.persistResult.mock.calls[0]![1][0]!
    const second = repo.persistResult.mock.calls[1]![1][0]!
    expect(second.title).not.toBe(first.title)
    expect(second.fingerprint).toBe(first.fingerprint)
  })
})

describe('LUM-988 AI review — changed-file context', () => {
  it('mints one token, reads the covered files at the head sha with it, revokes it, and passes the context redacted', async () => {
    fetchPrDiff.mockResolvedValue(
      diffOf([section('lib/search.ts', 1_000), section('lib/other.ts', 500)])
    )
    readRepoFileWithToken.mockResolvedValue(
      'const k = "ghp_' + 'A'.repeat(36) + '"\nexport const search = 1\n'
    )

    await runScan()

    const contextMints = getRepoToken.mock.calls.filter(
      c => (c[2] as Record<string, string>).contents === 'read'
    )
    expect(contextMints.length).toBeGreaterThanOrEqual(1)
    expect(readRepoFileWithToken).toHaveBeenCalledWith({
      token: 'tok',
      fullName: 'o/r',
      path: 'lib/search.ts',
      ref: 'sha-1',
    })
    expect(readRepoFileWithToken).toHaveBeenCalledTimes(2)
    expect(revokeInstallationToken).toHaveBeenCalledWith('tok')
    const input = (judge.judgeSecurity as jest.Mock).mock.calls[0]![0]
    expect(input.context).toContain('=== lib/search.ts ===')
    expect(input.context).toContain('export const search = 1')
    expect(input.context).not.toContain('ghp_' + 'A'.repeat(36))
  })

  it('reviews the diff alone when the repository is not confirmed (no token)', async () => {
    // Ruby, so the graph rules mint nothing: the only mint is the context's.
    fetchPrDiff.mockResolvedValue(diffOf([section('app/search.rb', 1_000)]))
    getRepoToken.mockRejectedValue(
      Object.assign(new Error('repo_not_confirmed'), { status: 403 })
    )

    const meta = await runScan()

    expect(readRepoFileWithToken).not.toHaveBeenCalled()
    expect((judge.judgeSecurity as jest.Mock).mock.calls[0]![0].context).toBe(
      ''
    )
    expect(meta.judgeStatus).toBe('RAN')
  })

  it('reviews the diff alone when a file read fails, and still revokes the token', async () => {
    fetchPrDiff.mockResolvedValue(
      diffOf([section('lib/a.ts', 500), section('lib/b.ts', 500)])
    )
    readRepoFileWithToken.mockImplementation(
      async ({ path }: { path: string }) => {
        if (path === 'lib/b.ts') throw new Error('GitHub API error 502')
        return 'export const a = 1\n'
      }
    )

    const meta = await runScan()

    expect((judge.judgeSecurity as jest.Mock).mock.calls[0]![0].context).toBe(
      ''
    )
    expect(revokeInstallationToken).toHaveBeenCalledWith('tok')
    expect(meta.judgeStatus).toBe('RAN')
  })

  it('does not read files when the AI review does not run', async () => {
    // Ruby, so the TS-only graph rules do not read it either.
    fetchPrDiff.mockResolvedValue(
      diffOf([section('app/models/search.rb', 200_000)])
    )

    const meta = await runScan()

    expect(judge.judgeSecurity).not.toHaveBeenCalled()
    expect(meta.judgeStatus).toBe('SKIPPED')
    expect(readRepoFile).not.toHaveBeenCalled()
    expect(readRepoFileWithToken).not.toHaveBeenCalled()
  })
})

describe('LUM-988 distinctFingerprint', () => {
  it('keeps the first key stable and gives each repeat in a scan its own key', () => {
    const seen = new Map<string, number>()
    const a = distinctFingerprint('abcdef0123456789', seen)
    const b = distinctFingerprint('abcdef0123456789', seen)
    const c = distinctFingerprint('abcdef0123456789', seen)
    const other = distinctFingerprint('0000000000000000', seen)
    expect(a).toBe('abcdef0123456789')
    expect(new Set([a, b, c]).size).toBe(3)
    expect(b).toMatch(/^[0-9a-f]{16}$/)
    expect(other).toBe('0000000000000000')
    // Deterministic: the same repeat gets the same key on the next push.
    const again = new Map<string, number>()
    distinctFingerprint('abcdef0123456789', again)
    expect(distinctFingerprint('abcdef0123456789', again)).toBe(b)
  })

  it('stores two problems of one rule on one quoted line under different fingerprints', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('lib/search.ts', 1_000)]))
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [BUG, { ...BUG, title: 'Off-by-one on the same line' }],
    })

    await runScan()

    const rows = repo.persistResult.mock.calls[0]![1]
    expect(rows).toHaveLength(2)
    expect(rows[0]!.fingerprint).not.toBe(rows[1]!.fingerprint)
  })
})

describe('LUM-988 stage A starts the agentic verifier', () => {
  const start = startReviewVerifier as jest.Mock
  beforeEach(() => start.mockResolvedValue(true))
  afterEach(() => {
    delete process.env.LUMO_REVIEW_VERIFIER
  })

  it("marks the hold, then starts the verifier for the scan's AI-review findings", async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('app/search.rb', 1_000)]))
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({ findings: [BUG] })

    await runScan()

    expect(repo.markVerifierStarted).toHaveBeenCalledWith('s1')
    expect(start).toHaveBeenCalledWith({
      scanId: 's1',
      workspaceId: 'w1',
      repo: 'o/r',
      prNumber: 7,
      headSha: 'sha-1',
      managedScanStarted: false,
      stopAttachedWhenDone: true,
    })
    const markOrder = (repo.markVerifierStarted as jest.Mock).mock
      .invocationCallOrder[0]!
    expect(markOrder).toBeLessThan(start.mock.invocationCallOrder[0]!)
    expect(repo.completeVerification).not.toHaveBeenCalled()
  })

  it('releases the hold at once when the run cannot be queued', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('app/search.rb', 1_000)]))
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({ findings: [BUG] })
    start.mockResolvedValue(false)

    await runScan()

    expect(repo.completeVerification).toHaveBeenCalledWith('s1', [])
  })

  it('starts nothing without AI-review findings, or with the kill switch', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('app/search.rb', 1_000)]))
    await runScan()
    expect(start).not.toHaveBeenCalled()

    jest.clearAllMocks()
    process.env.LUMO_REVIEW_VERIFIER = 'off'
    fetchPrDiff.mockResolvedValue(diffOf([section('app/search.rb', 1_000)]))
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({ findings: [BUG] })
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(start).not.toHaveBeenCalled()
    expect(repo.markVerifierStarted).not.toHaveBeenCalled()
  })

  it('keeps the managed scan VM alive for the verifier while the AI review is on', async () => {
    process.env.LUMO_MANAGED_SCAN = 'on'
    ;(startSecurityManagedScan as jest.Mock).mockResolvedValue('run-1')
    ;(projectRepository.findLastSarifIngestAt as jest.Mock).mockResolvedValue(
      null
    )
    fetchPrDiff.mockResolvedValue(diffOf([section('app/search.rb', 1_000)]))
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({ findings: [BUG] })

    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })

    expect(
      (startSecurityManagedScan as jest.Mock).mock.calls[0]![0].huntWanted
    ).toBe(true)
    expect(start.mock.calls[0]![0]).toMatchObject({
      managedScanStarted: true,
      stopAttachedWhenDone: true,
    })
  })
})
