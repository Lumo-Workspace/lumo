/**
 * @jest-environment node
 *
 * LUM-785 — stage A runs the deterministic graph rule in process: an
 * llm-output → sink flow in the PR's touched files lands as a DETERMINISTIC
 * finding (ruleId `llm-output-to-sink:<sink>`, no falsifier verdict) in the
 * same `persistResult` as the secret rows, and the falsifier is never asked.
 */
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
import { logger } from '@/lib/logger'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/lib/llm/security-judge-client'
import * as falsifier from '@/lib/llm/security-falsifier-client'
import { graphRuleFingerprint } from '@/lib/services/security-graph-rules.service'

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
const ROUTE = 'app/api/sql/route.ts'
const SERVICE = 'lib/services/sql.service.ts'

const ROUTE_SOURCE = `import { generateText } from 'ai'
import { sqlService } from '@/lib/services/sql.service'

export async function POST(req: Request) {
  const result = await generateText({ model: m, prompt: 'write sql' })
  return sqlService.run(result.text)
}
`
const SERVICE_SOURCE = `import { prisma } from '@/lib/db/prisma'

export const sqlService = {
  async run(statement: string) {
    return prisma.$queryRawUnsafe(statement)
  },
}
`
const SERVICE_SOURCE_PARSED = `import { prisma } from '@/lib/db/prisma'
import { StatementSchema } from '@/lib/validation/sql'

export const sqlService = {
  async run(statement: string) {
    const checked = StatementSchema.parse(statement)
    return prisma.$queryRawUnsafe(checked)
  },
}
`
/** The PR added the route (only the touched file is in the diff; the service is one import hop away). */
const DIFF = [
  `--- a/${ROUTE}`,
  `+++ b/${ROUTE}`,
  '@@ -1,0 +1,2 @@',
  '+  const result = await generateText({ model: m, prompt: "write sql" })',
  '+  return sqlService.run(result.text)',
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

describe('LUM-785 stage A graph rule', () => {
  it('persists an llm-output-to-sink flow as a DETERMINISTIC finding without a falsifier verdict, and the falsifier is never called', async () => {
    filesAtHead({ [ROUTE]: ROUTE_SOURCE, [SERVICE]: SERVICE_SOURCE })
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
    expect(repo.persistResult).toHaveBeenCalledTimes(1)
    const [, rows, meta] = repo.persistResult.mock.calls[0]!
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row).toMatchObject({
      scanId: 's1',
      kind: 'VULNERABILITY',
      ruleId: 'llm-output-to-sink:prisma-raw',
      severity: 'HIGH',
      provenance: 'DETERMINISTIC',
      filePath: SERVICE,
      line: 5,
      cwe: 'CWE-89',
      reachability: 'EXTERNAL',
      disposition: null,
      externalRef: null,
      callChain: [
        { from: `${ROUTE}#POST`, to: `${SERVICE}#sqlService.run` },
        {
          from: `${SERVICE}#sqlService.run`,
          to: `${SERVICE}#prisma.$queryRawUnsafe@5`,
        },
      ],
      fingerprint: graphRuleFingerprint(
        `${SERVICE}#prisma.$queryRawUnsafe@5`,
        `${ROUTE}#POST`
      ),
    })
    // Never falsified: no verdict on the row, and the falsifier client was
    // not consulted for it (the row bypasses the hunt pipeline entirely).
    expect(row.falsifierVerdict).toBeUndefined()
    expect(falsify).not.toHaveBeenCalled()
    expect(row.title).toMatch(/Model output reaches a raw SQL query/)
    expect(row.evidence).toBe(
      `${ROUTE}#POST → ${SERVICE}#sqlService.run → ${SERVICE}#prisma.$queryRawUnsafe@5`
    )
    // Stage A read the touched file and its one-hop import at the head sha.
    expect(readRepoFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: ROUTE, ref: 'sha-1', fullName: 'o/r' })
    )
    expect(readRepoFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: SERVICE, ref: 'sha-1' })
    )
    expect(meta).toMatchObject({ status: 'FINDINGS', partialCauses: [] })
    expect(meta.stages).toMatchObject({ secrets: 'RAN', judge: 'RAN' })
  })

  it('stays CLEAN when the callee parses the model output with zod before the sink', async () => {
    filesAtHead({ [ROUTE]: ROUTE_SOURCE, [SERVICE]: SERVICE_SOURCE_PARSED })
    const out = await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(out).toMatchObject({ status: 'CLEAN', findings: 0 })
    expect(repo.persistResult.mock.calls[0]![1]).toEqual([])
    expect(falsify).not.toHaveBeenCalled()
  })

  it('is fail-soft: a GitHub read that throws marks the scan partial with the reason logged, and stage A still lands', async () => {
    readRepoFile.mockRejectedValue(new Error('GitHub 502'))
    const out = await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(out).toMatchObject({ status: 'CLEAN', findings: 0 })
    const [, rows, meta] = repo.persistResult.mock.calls[0]!
    expect(rows).toEqual([])
    expect(meta.partialCauses).toEqual(['GRAPH_READ_FAILED'])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('graph rules partial')
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('GitHub 502')
    )
    expect(repo.finalize).not.toHaveBeenCalled()
  })

  it('skips the read entirely when the diff touched no TS/TSX source', async () => {
    fetchPrDiff.mockResolvedValue(
      ['--- a/README.md', '+++ b/README.md', '@@ -1,0 +1,1 @@', '+hello'].join(
        '\n'
      )
    )
    await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(readRepoFile).not.toHaveBeenCalled()
    expect(repo.persistResult.mock.calls[0]![2].partialCauses).toEqual([])
  })
})
