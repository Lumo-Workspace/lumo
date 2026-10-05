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
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
  readRepoFile: jest.fn(),
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
  },
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

import { prSecurityScanService } from '@/lib/services/pr-security-scan.service'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { securityManagedScanOpsService } from '@/lib/services/security-managed-scan-ops.service'
import { securityPrReviewService } from '@/lib/services/security-pr-review.service'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/lib/llm/security-judge-client'
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

describe('LUM-988 AI review — changed-file context', () => {
  it('reads the covered files at the head sha and passes them redacted', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('lib/search.ts', 1_000)]))
    readRepoFile.mockResolvedValue(
      'const k = "ghp_' + 'A'.repeat(36) + '"\nexport const search = 1\n'
    )

    await runScan()

    expect(readRepoFile).toHaveBeenCalledWith({
      workspaceId: 'w1',
      fullName: 'o/r',
      path: 'lib/search.ts',
      ref: 'sha-1',
    })
    const input = (judge.judgeSecurity as jest.Mock).mock.calls[0]![0]
    expect(input.context).toContain('=== lib/search.ts ===')
    expect(input.context).toContain('export const search = 1')
    expect(input.context).not.toContain('ghp_' + 'A'.repeat(36))
  })

  it('reviews the diff alone when the repository is not confirmed', async () => {
    fetchPrDiff.mockResolvedValue(diffOf([section('lib/search.ts', 1_000)]))
    readRepoFile.mockRejectedValue(
      Object.assign(new Error('repo_not_confirmed'), { status: 403 })
    )

    const meta = await runScan()

    expect(judge.judgeSecurity).toHaveBeenCalledTimes(1)
    expect((judge.judgeSecurity as jest.Mock).mock.calls[0]![0].context).toBe(
      ''
    )
    expect(meta.judgeStatus).toBe('RAN')
  })

  it('reviews the diff alone when a file read fails', async () => {
    fetchPrDiff.mockResolvedValue(
      diffOf([section('lib/a.ts', 500), section('lib/b.ts', 500)])
    )
    readRepoFile.mockImplementation(async ({ path }: { path: string }) => {
      if (path === 'lib/b.ts') throw new Error('GitHub API error 502')
      return 'export const a = 1\n'
    })

    const meta = await runScan()

    expect((judge.judgeSecurity as jest.Mock).mock.calls[0]![0].context).toBe(
      ''
    )
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
  })
})
