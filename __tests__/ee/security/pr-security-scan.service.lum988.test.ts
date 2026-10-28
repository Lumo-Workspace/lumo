/**
 * @jest-environment node
 *
 * LUM-988 — the AI review is a general code review: stage A hands it the
 * PR-head content of the changed files (redacted, through readRepoFile so an
 * unconfirmed repository is refused), maps bug kinds to CORRECTNESS /
 * `review:<kind>`, and keeps every LLM finding advisory. A context failure
 * never stops the review: it runs on the diff alone.
 */
// LUM-866: every workspace here has AI review and hunt on (off by default since LUM-1328); the
// platform env in each test still decides the ceiling.
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
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

import {
  positionalFingerprints,
  prSecurityScanService,
} from '@/ee/security/services/pr-security-scan.service'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { redactFindingText } from '@/lib/security-scan/scan-secrets'
import { judgeFindingFingerprint } from '@/lib/security-scan/redact'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { securityManagedScanOpsService } from '@/ee/security/services/security-managed-scan-ops.service'
import { securityPrReviewService } from '@/ee/security/services/security-pr-review.service'
import * as gh from '@/lib/integrations/github/contents'
import * as auth from '@/lib/integrations/github/auth'
import * as judge from '@/ee/security/llm/security-judge-client'
import { startReviewVerifier } from '@/ee/security/services/review-verifier-start'
import { startSecurityManagedScan } from '@/ee/security/services/security-managed-scan-start'
import { startSecurityHunt } from '@/ee/security/services/security-hunt-start'
import {
  DEFAULT_SECURITY_POLICY,
  isBlockingUnderPolicy,
} from '@/ee/security/security-scan/policy'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'

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
    expect(readRepoFileWithToken).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'tok',
        fullName: 'o/r',
        path: 'lib/search.ts',
        ref: 'sha-1',
        signal: expect.any(AbortSignal),
      })
    )
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

describe('LUM-988 positionalFingerprints', () => {
  const r = (fingerprint: string, line: number | null, title = 't') => ({
    fingerprint,
    line,
    title,
  })

  it('leaves a unique key alone', () => {
    expect(
      positionalFingerprints([
        r('aaaa000000000000', 3),
        r('bbbb000000000000', 3),
      ])
    ).toEqual(['aaaa000000000000', 'bbbb000000000000'])
  })

  it('keys repeats on the reported line, so emission order does not matter', () => {
    const first = positionalFingerprints([
      r('dup0000000000000', 10),
      r('dup0000000000000', 40),
    ])
    const flipped = positionalFingerprints([
      r('dup0000000000000', 40),
      r('dup0000000000000', 10),
    ])
    expect(new Set(first).size).toBe(2)
    expect(flipped).toEqual([first[1], first[0]])
    expect(first.every(k => /^[0-9a-f]{16}$/.test(k))).toBe(true)
  })

  it('never hands the key of a fixed row to the other one', () => {
    const before = positionalFingerprints([
      r('dup0000000000000', 10),
      r('dup0000000000000', 40),
    ])
    // The line-10 problem is fixed; the line-40 one is now unique.
    const after = positionalFingerprints([r('dup0000000000000', 40)])
    expect(after[0]).not.toBe(before[0])
  })

  it('two problems on one line: ordered by title, stable under emission order', () => {
    const a = positionalFingerprints([
      r('dup0000000000000', 5, 'Alpha'),
      r('dup0000000000000', 5, 'Beta'),
    ])
    const b = positionalFingerprints([
      r('dup0000000000000', 5, 'Beta'),
      r('dup0000000000000', 5, 'Alpha'),
    ])
    expect(new Set(a).size).toBe(2)
    expect(b).toEqual([a[1], a[0]])
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
  const MEDIUM_BUG = { ...BUG, severity: 'MEDIUM' }
  const start = startReviewVerifier as jest.Mock
  beforeEach(() => start.mockResolvedValue(true))
  afterEach(() => {
    delete process.env.LUMO_REVIEW_VERIFIER
  })

  it("marks the hold, then starts the verifier for the scan's AI-review findings", async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('app/search.rb', 1_000)]))
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [MEDIUM_BUG],
    })

    await runScan()

    expect(repo.markVerifierStarted).toHaveBeenCalledWith('s1')
    expect(start).toHaveBeenCalledWith({
      scanId: 's1',
      workspaceId: 'w1',
      repo: 'o/r',
      prNumber: 7,
      headSha: 'sha-1',
      managedScanStarted: false,
      stopAttachedWhenDone: false,
    })
    const markOrder = (repo.markVerifierStarted as jest.Mock).mock
      .invocationCallOrder[0]!
    expect(markOrder).toBeLessThan(start.mock.invocationCallOrder[0]!)
    expect(repo.completeVerification).not.toHaveBeenCalled()
  })

  it('releases the hold at once when the run cannot be queued', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('app/search.rb', 1_000)]))
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [MEDIUM_BUG],
    })
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
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [MEDIUM_BUG],
    })
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(start).not.toHaveBeenCalled()
    expect(repo.markVerifierStarted).not.toHaveBeenCalled()
  })

  it('LUM-1084: keeps no managed scan VM alive for the verifier, which boots its own at once', async () => {
    process.env.LUMO_MANAGED_SCAN = 'on'
    ;(startSecurityManagedScan as jest.Mock).mockResolvedValue('run-1')
    ;(
      securityColumnsRepository.findLastSarifIngestAt as jest.Mock
    ).mockResolvedValue(null)
    fetchPrDiff.mockResolvedValue(diffOf([section('app/search.rb', 1_000)]))
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [MEDIUM_BUG],
    })

    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })

    // Before LUM-1084 the VM was kept for the verifier, which then waited
    // 30 s + 90 s for the managed scan's hand-off and booted its own anyway.
    expect(
      (startSecurityManagedScan as jest.Mock).mock.calls[0]![0].huntWanted
    ).toBe(false)
    expect(start).toHaveBeenCalledTimes(1)
    expect(start.mock.calls[0]![0]).toMatchObject({
      managedScanStarted: false,
      stopAttachedWhenDone: false,
    })
    expect(start.mock.calls[0]![0].releaseOnly).toBeUndefined()
  })
})

describe('LUM-988 VM release and the verifier start condition', () => {
  const start = startReviewVerifier as jest.Mock
  const startHunt = startSecurityHunt as jest.Mock
  const HIGH_VULN = { ...VULN, severity: 'HIGH' }
  const MEDIUM_BUG = { ...BUG, severity: 'MEDIUM' }
  // LUM-1084: the VM is kept alive for the hunt only, so these cases need a
  // diff the hunt trigger fires on (a route handler) and a hunt that then
  // does not start — the only way a kept VM is left without a consumer.
  const ROUTE = [
    'diff --git a/app/api/x/route.ts b/app/api/x/route.ts',
    '--- a/app/api/x/route.ts',
    '+++ b/app/api/x/route.ts',
    '@@ -0,0 +1 @@',
    '+export async function POST(req: Request) {',
  ].join('\n')
  beforeEach(() => {
    start.mockResolvedValue(true)
    startHunt.mockResolvedValue(null)
    delete process.env.LUMO_SECURITY_HUNT
    process.env.LUMO_MANAGED_SCAN = 'on'
    ;(startSecurityManagedScan as jest.Mock).mockResolvedValue('run-1')
    ;(
      securityColumnsRepository.findLastSarifIngestAt as jest.Mock
    ).mockResolvedValue(null)
    fetchPrDiff.mockResolvedValue(ROUTE)
  })
  afterEach(() => {
    process.env.LUMO_SECURITY_HUNT = 'off'
  })
  const run = () =>
    prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  const releases = () => start.mock.calls.filter(c => c[0].releaseOnly)

  it('keeps the VM for the hunt it triggered', async () => {
    await run()
    expect(
      (startSecurityManagedScan as jest.Mock).mock.calls[0]![0].huntWanted
    ).toBe(true)
  })

  it('only security or HIGH findings: no verifier, and the kept VM is released', async () => {
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [HIGH_VULN, BUG],
    })
    await run()
    expect(repo.markVerifierStarted).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start.mock.calls[0]![0]).toMatchObject({
      scanId: 's1',
      releaseOnly: true,
      managedScanStarted: true,
    })
  })

  it('no findings at all, or a failed judge: the kept VM is released', async () => {
    await run()
    expect(start.mock.calls[0]![0]).toMatchObject({ releaseOnly: true })

    jest.clearAllMocks()
    start.mockResolvedValue(true)
    startHunt.mockResolvedValue(null)
    ;(startSecurityManagedScan as jest.Mock).mockResolvedValue('run-1')
    fetchPrDiff.mockResolvedValue(ROUTE)
    ;(judge.judgeSecurity as jest.Mock).mockRejectedValue(
      new Error('gateway down')
    )
    await run()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start.mock.calls[0]![0]).toMatchObject({ releaseOnly: true })
  })

  it('LUM-1084: a started verifier is not a consumer — the kept VM is still released', async () => {
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [MEDIUM_BUG, HIGH_VULN],
    })
    await run()
    expect(start).toHaveBeenCalledTimes(2)
    const verify = start.mock.calls.find(c => !c[0].releaseOnly)![0]
    expect(verify).toMatchObject({
      managedScanStarted: false,
      stopAttachedWhenDone: false,
    })
    expect(releases()).toHaveLength(1)
  })

  it('a started hunt consumes the kept VM: nothing is released', async () => {
    startHunt.mockResolvedValue('run_h1')
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [MEDIUM_BUG],
    })
    await run()
    expect(releases()).toHaveLength(0)
    expect(start.mock.calls[0]![0]).toMatchObject({ managedScanStarted: false })
  })

  it('no managed VM kept alive: nothing to release', async () => {
    process.env.LUMO_MANAGED_SCAN = 'off'
    await run()
    expect(start).not.toHaveBeenCalled()
  })

  it('a diff with no hunt trigger keeps no VM, so there is nothing to release', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('app/search.rb', 1_000)]))
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({ findings: [] })
    await run()
    expect(
      (startSecurityManagedScan as jest.Mock).mock.calls[0]![0].huntWanted
    ).toBe(false)
    expect(start).not.toHaveBeenCalled()
  })

  it('a stage A crash after the managed scan started still releases the kept VM', async () => {
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({ findings: [] })
    repo.persistResult.mockRejectedValueOnce(new Error('db down'))
    await run()
    expect(start.mock.calls.some(c => c[0].releaseOnly === true)).toBe(true)
  })
})

describe('LUM-1013 AI review — finding text keeps quoted prose', () => {
  const PROSE = {
    ...BUG,
    title:
      "The group heading would be labelled 'Verification' only via aria-label",
    detail:
      "The row's phase badge is rendered twice, so the list reads 'Passed Passed'.",
    evidence: "<div className='grid grid-cols-[1fr_auto] items-center gap-2'>",
  }

  it('stores title / detail / evidence verbatim when they hold no credential', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('lib/search.ts', 1_000)]))
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [PROSE],
    })
    await runScan()
    const row = repo.persistResult.mock.calls[0]![1][0]!
    expect(row.title).toBe(PROSE.title)
    expect(row.detail).toBe(PROSE.detail)
    expect(row.evidence).toBe(PROSE.evidence)
  })

  it('still redacts a credential the model echoes into any field', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('lib/search.ts', 1_000)]))
    const key = 'sk-live-abcDEF/ghiJKL+123'
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [
        {
          ...BUG,
          title: `Hardcodes 'AKIAABCDEFGHIJKLMNOP'`,
          detail: `The client sends '${key}' on boot.`,
          evidence: `const pw = 'correcthorsebattery'`,
        },
      ],
    })
    await runScan()
    const row = repo.persistResult.mock.calls[0]![1][0]!
    expect(row.title).not.toContain('AKIAABCDEFGHIJKLMNOP')
    expect(row.detail).not.toContain(key)
    expect(row.evidence).not.toContain('correcthorsebattery')
  })

  // Values computed with origin/main 8a444f1e9 (before LUM-1013) for the same
  // finding: the key a human's FALSE_POSITIVE was recorded under.
  it.each([
    [
      "// the row's badge isn't shown; label = 'Verification'",
      '65271f19f1815a80',
    ],
    [
      "<div className='grid grid-cols-[1fr_auto] items-center gap-2 rounded-md border px-3 py-2 text-sm'>",
      'fc73109e663e3743',
    ],
    [`const msg = "don't" + 'Passed Passed'`, '39e9238615602541'],
  ])(
    'keeps the pre-LUM-1013 fingerprint for evidence %s',
    async (evidence, fp) => {
      fetchPrDiff.mockResolvedValue(diffOf([section('lib/search.ts', 1_000)]))
      ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
        findings: [{ ...BUG, evidence }],
      })
      await runScan()
      const row = repo.persistResult.mock.calls[0]![1][0]!
      expect(row.fingerprint).toBe(fp)
    }
  )

  // LUM-1200 follow-up — production probe PR 60 (comment 4285358212): the
  // detail rendered "The condition `expi…(len 35)`" because it mentions a
  // token, so every quoted span in it was masked.
  it('stores inline code in a detail that talks about tokens verbatim', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('lib/search.ts', 1_000)]))
    const detail =
      'The condition `expiresAt > now || token.length > 0` is true for any session with a non-empty token, so expired sessions are always treated as valid.'
    const title = 'Session `token.length > 0` check keeps expired sessions'
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [{ ...BUG, title, detail }],
    })
    await runScan()
    const row = repo.persistResult.mock.calls[0]![1][0]!
    expect(row.detail).toBe(detail)
    expect(row.title).toBe(title)
  })

  it('keeps the title-keyed fingerprint for a finding with no evidence', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('lib/search.ts', 1_000)]))
    const title = 'Session `expiresAt > now || token.length > 0` stays valid'
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings: [{ ...BUG, title, evidence: '' }],
    })
    await runScan()
    const row = repo.persistResult.mock.calls[0]![1][0]!
    // Keyed on the strictly-masked title, as before this change.
    expect(row.fingerprint).toBe(
      judgeFindingFingerprint(
        `review:${BUG.kind}`,
        row.filePath,
        '',
        redactFindingText(title)
      )
    )
    expect(redactFindingText(title)).not.toBe(title)
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
