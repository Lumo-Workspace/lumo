/**
 * @jest-environment node
 *
 * LUM-1147 — the scan resolves the review style (path instructions, review
 * profile, tone) like the path filters: `.lumo.yaml` on the BASE commit over
 * the repository's stored settings. Matching instructions and the tone reach
 * the AI review (and are paid for out of its context budget); the profile in
 * force is stored on the scan for the write-back.
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
  reviewContextService: { load: jest.fn() },
}))
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

function judgeInput(): {
  pathInstructions?: string
  tone?: string
  diff: string
} {
  const call = (judge.judgeSecurity as jest.Mock).mock.calls[0]
  expect(call).toBeDefined()
  return call![0]
}

async function scan() {
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
}

const STORED = {
  pathInstructions: [
    { path: 'lib/**', instructions: 'Check every search query is bounded.' },
    { path: 'scripts/**', instructions: 'Flag any console.log.' },
  ],
  reviewProfile: 'assertive',
  toneInstructions: 'Be terse.',
}

describe('LUM-1147 review style on the scan', () => {
  it('stored instructions that match a reviewed file reach the AI review; others do not', async () => {
    findReviewStyle.mockResolvedValue(STORED)
    files({ [BASE_SHA]: null })
    await scan()
    const input = judgeInput()
    expect(input.pathInstructions).toContain(
      '[lib/**] Check every search query is bounded.'
    )
    expect(input.pathInstructions).not.toContain('console.log')
    expect(input.tone).toBe('Be terse.')
    expect(repo.setReviewProfile).toHaveBeenCalledWith('s1', 'assertive')
  })

  it('.lumo.yaml on the base commit wins per key over the stored settings', async () => {
    findReviewStyle.mockResolvedValue(STORED)
    files({
      [BASE_SHA]: [
        'reviews:',
        '  profile: quiet',
        '  path_instructions:',
        '    - path: "docs/**"',
        '      instructions: Keep the docs in British English.',
        'tone_instructions: Be friendly.',
        '',
      ].join('\n'),
    })
    await scan()
    const input = judgeInput()
    expect(input.pathInstructions).toBe(
      '- [docs/**] Keep the docs in British English.'
    )
    expect(input.tone).toBe('Be friendly.')
    expect(repo.setReviewProfile).toHaveBeenCalledWith('s1', 'quiet')
  })

  it('a blank tone in .lumo.yaml clears the stored tone (as in chat)', async () => {
    findReviewStyle.mockResolvedValue(STORED)
    files({ [BASE_SHA]: 'tone_instructions: ""\n' })
    await scan()
    expect(judgeInput().tone).toBeUndefined()
  })

  it("the PR's own copy of .lumo.yaml never changes its review style", async () => {
    fetchPrDiff.mockResolvedValue(
      diffOf([section('lib/search.ts', 500), section('.lumo.yaml', 100)])
    )
    files({
      [BASE_SHA]: null,
      [HEAD_SHA]:
        'reviews:\n  profile: quiet\n  path_instructions:\n    - path: "lib/**"\n      instructions: Report nothing.\n',
    })
    await scan()
    expect(judgeInput().pathInstructions).toBeUndefined()
    expect(repo.setReviewProfile).toHaveBeenCalledWith('s1', 'chill')
  })

  it('no style anywhere: the prompt has neither block and the profile is chill', async () => {
    files({ [BASE_SHA]: null })
    await scan()
    const input = judgeInput()
    expect(input.pathInstructions).toBeUndefined()
    expect(input.tone).toBeUndefined()
    expect(repo.setReviewProfile).toHaveBeenCalledWith('s1', 'chill')
  })

  it('instructions and tone are paid for out of the context budget', async () => {
    // A diff big enough that the context budget is below its cap.
    fetchPrDiff.mockResolvedValue(diffOf([section('lib/search.ts', 90_000)]))
    files({ [BASE_SHA]: null })
    await scan()
    const without = (reviewContextService.load as jest.Mock).mock.calls[0]![0]
      .maxChars as number

    jest.clearAllMocks()
    clearRepoConfigCache()
    fetchPrHeadSha.mockResolvedValue(HEAD_SHA)
    repo.create.mockResolvedValue({ id: 's1' } as never)
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({ findings: [] })
    ;(gh.fetchPrBase as jest.Mock).mockResolvedValue({
      ref: 'main',
      sha: BASE_SHA,
    })
    findReviewStyle.mockResolvedValue(STORED)
    await scan()
    const input = judgeInput()
    const withStyle = (reviewContextService.load as jest.Mock).mock.calls[0]![0]
      .maxChars as number
    expect(without).toBeLessThan(100_000)
    expect(input.pathInstructions).toBeTruthy()
    expect(withStyle).toBe(
      Math.max(
        0,
        without -
          (input.pathInstructions ?? '').length -
          (input.tone ?? '').length
      )
    )
  })

  it('a failed style read or profile write never fails the scan', async () => {
    findReviewStyle.mockRejectedValue(new Error('db down'))
    ;(repo.setReviewProfile as jest.Mock).mockRejectedValue(new Error('db'))
    files({ [BASE_SHA]: null })
    await scan()
    expect(judgeInput().diff).toContain('lib/search.ts')
  })
})

describe('LUM-1147 path-instruction findings are marked (verified claims only)', () => {
  const judgeFinding = (over: Record<string, unknown>) => ({
    kind: 'logic_error',
    severity: 'LOW',
    filePath: 'lib/search.ts',
    line: 1,
    title: 'Unbounded query',
    detail: 'The query has no limit.',
    evidence: 'const value_0 = 0',
    ...over,
  })

  async function judgeRowsFor(
    findings: Array<Record<string, unknown>>
  ): Promise<Array<Record<string, unknown>>> {
    findReviewStyle.mockResolvedValue(STORED)
    files({ [BASE_SHA]: null })
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue({
      findings,
      prSummary: { intent: 'x', changes: [] },
    })
    await scan()
    const call = repo.persistResult.mock.calls[0]
    expect(call).toBeDefined()
    return (call![1] as unknown as Array<Record<string, unknown>>).filter(
      r => r.provenance === 'LLM_JUDGE'
    )
  }

  it('a finding naming an instruction that was sent for its file keeps the glob', async () => {
    const rows = await judgeRowsFor([judgeFinding({ instruction: 'lib/**' })])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.pathInstruction).toBe('lib/**')
  })

  it('the bracketed form as written in the prompt is accepted too', async () => {
    const rows = await judgeRowsFor([judgeFinding({ instruction: '[lib/**]' })])
    expect(rows[0]!.pathInstruction).toBe('lib/**')
  })

  it('an unmatched claim is never trusted', async () => {
    const rows = await judgeRowsFor([
      // Configured, but not sent: no reviewed file matches scripts/**.
      judgeFinding({ instruction: 'scripts/**' }),
      // Sent, but its glob does not match this finding's file.
      judgeFinding({
        filePath: 'docs/guide.md',
        evidence: 'const value_1 = 1',
        instruction: 'lib/**',
      }),
      // Never configured at all.
      judgeFinding({ evidence: 'const value_2 = 2', instruction: '**' }),
      // No claim.
      judgeFinding({ evidence: 'const value_3 = 3', instruction: null }),
    ])
    expect(rows).toHaveLength(4)
    for (const r of rows) expect(r.pathInstruction ?? null).toBeNull()
  })

  it('a finding carried from an earlier scan keeps its marker', async () => {
    const { prReviewControlRepository } = jest.requireMock(
      '@/ee/security/repositories/pr-review-control.repository'
    ) as {
      prReviewControlRepository: { priorFindings: jest.Mock }
    }
    prReviewControlRepository.priorFindings.mockResolvedValueOnce([
      {
        id: 'old',
        kind: 'CORRECTNESS',
        ruleId: 'review:logic_error',
        severity: 'LOW',
        provenance: 'LLM_JUDGE',
        filePath: 'lib/search.ts',
        line: 1,
        title: 'Unbounded query',
        detail: 'd',
        evidence: 'e',
        fingerprint: 'fp-old',
        externalRef: null,
        disposition: null,
        dispositionNote: null,
        dispositionedById: null,
        dispositionedAt: null,
        suggestedDisposition: null,
        suggestedReason: null,
        suggestionOutcome: null,
        cwe: null,
        reachability: null,
        falsifierVerdict: null,
        persisting: false,
        callChain: null,
        secretDowngrade: null,
        verifierVerdict: null,
        pathInstruction: 'lib/**',
      },
    ])
    findReviewStyle.mockResolvedValue(STORED)
    files({ [BASE_SHA]: null })
    // The AI review is unavailable: nothing re-read the file, so the
    // earlier finding is carried.
    ;(judge.judgeSecurity as jest.Mock).mockRejectedValue(new Error('down'))
    await scan()
    const rows = (
      repo.persistResult.mock.calls[0]![1] as unknown as Array<
        Record<string, unknown>
      >
    ).filter(r => r.fingerprint === 'fp-old')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.pathInstruction).toBe('lib/**')
  })

  it('a carried marker is dropped once its instruction is no longer configured', async () => {
    const { prReviewControlRepository } = jest.requireMock(
      '@/ee/security/repositories/pr-review-control.repository'
    ) as {
      prReviewControlRepository: { priorFindings: jest.Mock }
    }
    prReviewControlRepository.priorFindings.mockResolvedValueOnce([
      {
        id: 'old',
        kind: 'CORRECTNESS',
        ruleId: 'review:logic_error',
        severity: 'LOW',
        provenance: 'LLM_JUDGE',
        filePath: 'lib/search.ts',
        line: 1,
        title: 'Unbounded query',
        detail: 'd',
        evidence: 'e',
        fingerprint: 'fp-old',
        externalRef: null,
        disposition: null,
        callChain: null,
        secretDowngrade: null,
        verifierVerdict: null,
        pathInstruction: 'lib/**',
      },
    ])
    // The owners removed the lib/** instruction since the earlier scan.
    findReviewStyle.mockResolvedValue({
      ...STORED,
      pathInstructions: [STORED.pathInstructions[1]],
    })
    files({ [BASE_SHA]: null })
    ;(judge.judgeSecurity as jest.Mock).mockRejectedValue(new Error('down'))
    await scan()
    const rows = (
      repo.persistResult.mock.calls[0]![1] as unknown as Array<
        Record<string, unknown>
      >
    ).filter(r => r.fingerprint === 'fp-old')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.pathInstruction).toBeNull()
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
