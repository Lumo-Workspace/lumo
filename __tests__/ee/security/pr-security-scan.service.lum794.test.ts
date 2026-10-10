/**
 * @jest-environment node
 *
 * LUM-794 — stage A runs the "agent loop with no budget" graph rule in
 * process, on the same read as LUM-785's llm-output rule: an unbounded model
 * loop in the PR's touched files lands as a DETERMINISTIC / MEDIUM finding
 * (ruleId `agent-loop-unbounded:<shape>`, no falsifier verdict), the
 * falsifier is never asked, and MEDIUM keeps it advisory — it does not block
 * DONE under the default policy.
 */
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
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
  readRepoFile: jest.fn(),
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
  },
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
import { isBlockingFinding } from '@/ee/security/services/pr-security-scan-gate'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/ee/security/llm/security-judge-client'
import * as falsifier from '@/ee/security/llm/security-falsifier-client'
import { agentLoopFingerprint } from '@/ee/security/services/security-graph-rules.service'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const fetchPrDiff = gh.fetchPrDiff as jest.Mock
const fetchPrHeadSha = gh.fetchPrHeadSha as jest.Mock
const readRepoFile = gh.readRepoFile as jest.Mock
const falsify = falsifier.falsifyCandidate as jest.Mock

const PR = {
  id: 'pr1',
  workspaceId: 'w1',
  taskId: 't1',
  repo: 'o/r',
  number: 7,
}
const ROUTE = 'app/api/agent/route.ts'

/** A hand-written tool loop: nothing but the model can end it. */
const UNBOUNDED_SOURCE = `import { generateText } from 'ai'

export async function POST(req: Request) {
  const transcript = []
  while (true) {
    const step = await generateText({ model: m, prompt: 'keep going' })
    transcript.push(step.text)
  }
}
`

/** The same loop with the counter it was missing. */
const BOUNDED_SOURCE = `import { generateText } from 'ai'

export async function POST(req: Request) {
  const transcript = []
  let steps = 0
  while (true) {
    const step = await generateText({ model: m, prompt: 'keep going' })
    transcript.push(step.text)
    steps += 1
    if (steps >= 20) break
  }
  return transcript
}
`

const DIFF = [
  `--- a/${ROUTE}`,
  `+++ b/${ROUTE}`,
  '@@ -1,0 +1,2 @@',
  '+  while (true) {',
  '+    const step = await generateText({ model: m, prompt: "keep going" })',
].join('\n')

function filesAtHead(files: Record<string, string>) {
  readRepoFile.mockImplementation(async ({ path }: { path: string }) =>
    Object.prototype.hasOwnProperty.call(files, path) ? files[path] : null
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.LUMO_SECURITY_HUNT = 'off'
  process.env.LUMO_MANAGED_SCAN = 'off'
  ;(pullRequestRepository.findById as jest.Mock).mockResolvedValue(PR)
  fetchPrHeadSha.mockResolvedValue('sha-1')
  fetchPrDiff.mockResolvedValue(DIFF)
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

describe('LUM-794 agent-loop finding', () => {
  it('persists an unbounded model loop as a DETERMINISTIC MEDIUM finding without a falsifier verdict, and the falsifier is never called', async () => {
    filesAtHead({ [ROUTE]: UNBOUNDED_SOURCE })
    const out = await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(out).toEqual({
      deduped: false,
      scanId: 's1',
      status: 'FINDINGS',
      findings: 1,
    })
    const [, rows, meta] = repo.persistResult.mock.calls[0]!
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row).toMatchObject({
      scanId: 's1',
      kind: 'VULNERABILITY',
      ruleId: 'agent-loop-unbounded:while-true',
      severity: 'MEDIUM',
      provenance: 'DETERMINISTIC',
      filePath: ROUTE,
      line: 5,
      cwe: 'CWE-770',
      reachability: 'EXTERNAL',
      disposition: null,
      externalRef: null,
      fingerprint: agentLoopFingerprint(
        'while-true',
        `${ROUTE}#POST`,
        'generateText'
      ),
    })
    expect(row.title).toBe(
      'Model call generateText runs inside a while (true) loop with no exit path'
    )
    expect(row.detail).toMatch(/no step counter, no break/)
    expect(row.evidence).toBe(`${ROUTE}#POST → ${ROUTE}#generateText@6`)
    // Never falsified: no verdict on the row, and the falsifier client was
    // not consulted (the row bypasses the hunt pipeline entirely).
    expect(row.falsifierVerdict).toBeUndefined()
    expect(falsify).not.toHaveBeenCalled()
    expect(meta).toMatchObject({ status: 'FINDINGS', partialCauses: [] })
  })

  it('is advisory: MEDIUM does not block DONE under the default policy, where the same row at HIGH would', async () => {
    filesAtHead({ [ROUTE]: UNBOUNDED_SOURCE })
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    const row = repo.persistResult.mock.calls[0]![1][0]!
    expect(
      isBlockingFinding({
        provenance: row.provenance,
        severity: row.severity,
        disposition: null,
      })
    ).toBe(false)
    // The assertion above is about the SEVERITY, not about DETERMINISTIC
    // rows being harmless: the same provenance at HIGH does block.
    expect(
      isBlockingFinding({
        provenance: row.provenance,
        severity: 'HIGH',
        disposition: null,
      })
    ).toBe(true)
  })

  it('stays CLEAN once the loop carries a counter it checks', async () => {
    filesAtHead({ [ROUTE]: BOUNDED_SOURCE })
    const out = await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(out).toMatchObject({ status: 'CLEAN', findings: 0 })
    expect(repo.persistResult.mock.calls[0]![1]).toEqual([])
    expect(falsify).not.toHaveBeenCalled()
  })
})
jest.mock('@/ee/security/repositories/pr-review-control.repository', () => ({
  prReviewControlRepository: {
    reserve: jest.fn().mockResolvedValue(true),
    baseline: jest.fn().mockResolvedValue(null),
    priorFindings: jest.fn().mockResolvedValue([]),
    findingsOnScan: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({
      reviewPaused: false,
      reviewRoundLimit: 2,
      reviewHeads: [],
    }),
  },
}))
