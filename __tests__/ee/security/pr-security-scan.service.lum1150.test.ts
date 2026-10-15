/**
 * @jest-environment node
 *
 * LUM-1150 — stage A keeps the AI review's one-click fix only when its line
 * range is exactly this head's added lines around the finding; anything else
 * is dropped and the finding is stored (and commented) without it.
 */
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

import { reviewContextService } from '@/ee/security/services/review-context.service'
import { loadReviewLearnings } from '@/ee/security/services/review-learnings.service'

// The PR adds lines 1-4 of lib/auth.ts; line 10 is outside every hunk.
const DIFF = [
  'diff --git a/lib/auth.ts b/lib/auth.ts',
  '--- a/lib/auth.ts',
  '+++ b/lib/auth.ts',
  '@@ -0,0 +1,4 @@',
  '+export function canEdit(user: User): boolean {',
  "+  if (user.role === 'admin') return false",
  '+  return user.owner',
  '+}',
].join('\n')

function judged(suggestion: unknown, over: Record<string, unknown> = {}) {
  return {
    findings: [
      {
        kind: 'logic_error',
        severity: 'HIGH',
        filePath: 'lib/auth.ts',
        line: 2,
        title: 'Inverted admin check',
        detail: 'Admins are refused instead of allowed.',
        evidence: "if (user.role === 'admin') return false",
        suggestion,
        ...over,
      },
    ],
    prSummary: { intent: 'Adds an edit guard.', changes: [] },
  }
}

async function persistedRows(): Promise<Array<Record<string, unknown>>> {
  await prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
  const call = repo.persistResult.mock.calls[0]
  expect(call).toBeDefined()
  return (call![1] as unknown as Array<Record<string, unknown>>).filter(
    r => r.provenance === 'LLM_JUDGE'
  )
}

beforeEach(() => {
  ;(reviewContextService.load as jest.Mock).mockResolvedValue({
    text: '',
    included: [],
    error: null,
  })
  ;(loadReviewLearnings as jest.Mock).mockResolvedValue('')
  fetchPrDiff.mockResolvedValue(DIFF)
})

describe('LUM-1150 stage A stores only a suggestion anchored on added lines', () => {
  it('keeps a valid single-line fix on the row', async () => {
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue(
      judged({
        startLine: 2,
        endLine: 2,
        code: "  if (user.role !== 'admin') return false\n",
      })
    )
    const [row] = await persistedRows()
    expect(row!.codeSuggestion).toEqual({
      startLine: 2,
      endLine: 2,
      code: "  if (user.role !== 'admin') return false",
    })
  })

  it('keeps a valid multi-line fix', async () => {
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue(
      judged({
        startLine: 2,
        endLine: 3,
        code: "  if (user.role === 'admin') return true\n  return user.owner === true",
      })
    )
    const [row] = await persistedRows()
    expect(row!.codeSuggestion).toEqual(
      expect.objectContaining({ startLine: 2, endLine: 3 })
    )
  })

  it('drops a range reaching past the added lines, keeping the finding', async () => {
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue(
      judged({ startLine: 2, endLine: 10, code: 'x' })
    )
    const [row] = await persistedRows()
    expect(row).toBeDefined()
    expect(row!.title).toBe('Inverted admin check')
    expect('codeSuggestion' in row!).toBe(false)
  })

  it('stores nothing when the model proposed no fix', async () => {
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue(judged(null))
    const [row] = await persistedRows()
    expect('codeSuggestion' in row!).toBe(false)
  })

  it('never stores a fix on a LOW finding', async () => {
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue(
      judged(
        {
          startLine: 2,
          endLine: 2,
          code: "  if (user.role !== 'admin') return false",
        },
        { severity: 'LOW' }
      )
    )
    const [row] = await persistedRows()
    expect(row!.severity).toBe('LOW')
    expect('codeSuggestion' in row!).toBe(false)
  })
})

// LUM-1150 follow-up — production probe PR 41: a fix calling `execFile` in
// a file that imports only `exec` is dropped; a name imported outside the
// diff counts as in scope once the review has read the file at this head.
const RUN_FILE = [
  "import { exec, execFile } from 'child_process'",
  '',
  'export function listDir(dir: string): void {',
  "  exec('ls -la ' + dir)",
  '}',
]
const RUN_DIFF = [
  'diff --git a/src/run.ts b/src/run.ts',
  '--- a/src/run.ts',
  '+++ b/src/run.ts',
  '@@ -1,5 +1,5 @@',
  " import { exec, execFile } from 'child_process'",
  ' ',
  ' export function listDir(dir: string): void {',
  '-  listing(dir)',
  "+  exec('ls -la ' + dir)",
  ' }',
].join('\n')
const PROBE_DIFF = [
  'diff --git a/src/probe/suggest.ts b/src/probe/suggest.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/probe/suggest.ts',
  '@@ -0,0 +1,11 @@',
  '+// probe (do not merge)',
  '+export function parseCount(raw: string): number {',
  '+  const n = parseInt(raw)',
  '+  return n',
  '+}',
  '+',
  "+import { exec } from 'child_process'",
  '+',
  '+export function listDir(dir: string): void {',
  "+  exec('ls -la ' + dir)",
  '+}',
].join('\n')

function injection(filePath: string, line: number) {
  return {
    findings: [
      {
        kind: 'command_injection',
        severity: 'HIGH',
        filePath,
        line,
        title: 'Shell command built by concatenating unsanitized input',
        detail: 'Use execFile with an argument array.',
        evidence: "exec('ls -la ' + dir)",
        suggestion: {
          startLine: line,
          endLine: line,
          code: "  execFile('ls', ['-la', '--', dir])",
        },
      },
    ],
    prSummary: { intent: 'Lists a directory.', changes: [] },
  }
}

describe('LUM-1150 stage A drops a suggestion that would not compile', () => {
  it('drops execFile in a file importing only exec (production probe), keeping the finding', async () => {
    fetchPrDiff.mockResolvedValue(PROBE_DIFF)
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue(
      injection('src/probe/suggest.ts', 10)
    )
    const [row] = await persistedRows()
    expect(row!.severity).toBe('HIGH')
    expect('codeSuggestion' in row!).toBe(false)
  })

  it('drops it when the import sits outside the diff and the file was not read', async () => {
    fetchPrDiff.mockResolvedValue(RUN_DIFF)
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue(
      injection('src/run.ts', 4)
    )
    const [row] = await persistedRows()
    expect('codeSuggestion' in row!).toBe(false)
  })

  it('keeps it when the review read the file at head and it imports execFile', async () => {
    fetchPrDiff.mockResolvedValue(RUN_DIFF)
    ;(reviewContextService.load as jest.Mock).mockResolvedValue({
      text: `=== src/run.ts ===\n${RUN_FILE.join('\n')}\n`,
      included: ['src/run.ts'],
      bodies: { 'src/run.ts': RUN_FILE.join('\n') },
      error: null,
    })
    ;(judge.judgeSecurity as jest.Mock).mockResolvedValue(
      injection('src/run.ts', 4)
    )
    const [row] = await persistedRows()
    expect(row!.codeSuggestion).toEqual({
      startLine: 4,
      endLine: 4,
      code: "  execFile('ls', ['-la', '--', dir])",
    })
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
