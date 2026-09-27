/**
 * @jest-environment node
 *
 * LUM-832 — a diff with more source files than one hunt is sized for is no
 * longer hunted "in a corner". It is cut into risk-ordered batches, one run
 * each, and every run's findings land while the layer stays PENDING, until
 * every touched source file has been in a batch. The customer reads
 * "scanning (40/120 source files)" meanwhile — never "split your PR".
 */
jest.mock('@/lib/workflows/security-hunt.steps', () => ({
  buildVerifySubgraphStep: jest.fn(),
  planHuntStep: jest.fn(),
  huntTaskStep: jest.fn(),
  mechanicalVerifyStep: jest.fn(),
  falsifierStep: jest.fn(),
  persistHuntFindingsStep: jest.fn(),
  markHuntFailedStep: jest.fn(),
  requeueHuntStep: jest.fn(),
  continueHuntStep: jest.fn(),
  awaitManagedScanStep: jest.fn(),
}))
jest.mock('@/lib/workflows/security-sarif-ingest.steps', () => ({
  persistSarifFindingsStep: jest.fn(),
  markSarifExternalFailedStep: jest.fn(),
  deleteSarifBlobStep: jest.fn(),
}))
jest.mock('@/lib/workflows/security-suggest.steps', () => ({
  suggestDispositionsStep: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/workflows/security-pr-review.steps', () => ({
  syncPrReviewStep: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    claimHuntRetry: jest.fn(),
    setHuntRunId: jest.fn(),
    findStalePendingHunts: jest.fn(),
    hasNewerScan: jest.fn(),
    failStaleHunt: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/vercel-sandbox', () => ({
  stopRepoSandboxesByTag: jest.fn().mockResolvedValue(0),
}))
jest.mock('@/lib/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  cancelHuntRun: jest.fn(),
}))
jest.mock('@/lib/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))

import { securityHuntWorkflow } from '@/lib/workflows/security-hunt'
import {
  buildVerifySubgraphStep,
  planHuntStep,
  huntTaskStep,
  mechanicalVerifyStep,
  falsifierStep,
  persistHuntFindingsStep,
  requeueHuntStep,
  continueHuntStep,
} from '@/lib/workflows/security-hunt.steps'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { startSecurityHunt } from '@/lib/services/security-hunt-start'
import { securityHuntOpsService } from '@/lib/services/security-hunt-ops.service'
import {
  HUNT_MAX_ATTEMPTS,
  HUNT_OVERSIZED_SOURCE_FILES,
  type HuntJob,
  type HuntResult,
} from '@/lib/services/security-hunt.config'
import {
  huntBatchProgress,
  mergeBatchStage,
  planHuntBatches,
} from '@/lib/security-scan/hunt/batches'
import { formatScanLayerTail } from '@/cli/src/lib/scan-format'

const plan = planHuntStep as jest.Mock
const hunt = huntTaskStep as jest.Mock
const verifyGraph = buildVerifySubgraphStep as jest.Mock
const verify = mechanicalVerifyStep as jest.Mock
const falsify = falsifierStep as jest.Mock
const persist = persistHuntFindingsStep as jest.Mock
const requeue = requeueHuntStep as jest.Mock
const cont = continueHuntStep as jest.Mock
const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const startHunt = startSecurityHunt as jest.Mock

/** 120 source files; the sink-bearing ones sort last by name on purpose. */
const FILES = Array.from(
  { length: 120 },
  (_, i) => `lib/f${String(i).padStart(3, '0')}.ts`
)
/** Two sinks (tied on weight → by path), then the entry. */
const RISKY = ['lib/f118.ts', 'lib/f119.ts', 'lib/f090.ts']
const JOB: HuntJob = {
  scanId: 's1',
  pullRequestId: 'pr1',
  taskId: 't1',
  workspaceId: 'w1',
  repo: 'o/r',
  prNumber: 7,
  headSha: 'a'.repeat(40),
  reasons: ['diff:sink:prisma-raw'],
  touchedSourcePaths: FILES,
  signalSites: [
    { rule: 'sink:prisma-raw', path: 'lib/f119.ts', line: 3 },
    { rule: 'sink:exec', path: 'lib/f118.ts', line: 9 },
    { rule: 'entry:next-route-handler', path: 'lib/f090.ts', line: 1 },
  ],
  managedScanStarted: true,
}

const candidateIn = (file: string) => ({
  category: 'injection',
  cwe: 'CWE-89',
  severity: 'HIGH',
  sink: { symbol: 's', file, line: 2 },
  entry: { symbol: 'x', file, line: 1 },
  call_chain: [{ from: 'x', to: 's' }],
  precondition: 'p',
  claim: `c ${file}`,
  reachability: 'EXTERNAL',
  fingerprint: `fp-${file}`,
})

beforeEach(() => {
  jest.resetAllMocks()
  // One task per batch, starting at the batch's first file.
  plan.mockImplementation(async ({ job }: { job: HuntJob }) => ({
    tasks: [
      {
        id: 't1',
        objective: 'o',
        category: 'injection',
        startingPoints: [job.touchedSourcePaths[0]],
      },
    ],
    reason: 'r',
    by: 'model',
    tokens: 10,
  }))
  // Each batch's hunt finds one candidate in its own first file.
  hunt.mockImplementation(async ({ job }: { job: HuntJob }) => ({
    candidates: [candidateIn(job.touchedSourcePaths[0]!)],
    tokens: 100,
    elapsedMs: 1000,
    stopped: 'done',
  }))
  verifyGraph.mockResolvedValue({
    subgraph: { symbols: [], edges: [], files: [] },
    evidence: { sightings: [], fileSightings: [], missingFiles: [] },
  })
  verify.mockImplementation(async ({ candidates }) => ({
    accepted: candidates,
    rejected: [],
  }))
  falsify.mockResolvedValue({
    verdict: 'INCONCLUSIVE',
    reason: 'could not refute',
    tokens: 5,
  })
  cont.mockResolvedValue(true)
})

/** Run the job, then every continuation it starts, until the layer settles. */
async function runToTheEnd(first: HuntJob): Promise<{
  results: HuntResult[]
  jobs: HuntJob[]
}> {
  const results: HuntResult[] = []
  const jobs: HuntJob[] = [first]
  for (let job = first; ; ) {
    const calls = cont.mock.calls.length
    results.push(await securityHuntWorkflow(job))
    if (cont.mock.calls.length === calls) break
    job = cont.mock.calls[calls]![0].next
    jobs.push(job)
    if (jobs.length > 10) throw new Error('no end in sight')
  }
  return { results, jobs }
}

describe('oversized hunt covers every source file across continuation batches', () => {
  it('plans riskiest first, in batches of the per-run size, and only for a diff past it', () => {
    expect(
      planHuntBatches(FILES.slice(0, HUNT_OVERSIZED_SOURCE_FILES), [])
    ).toBeNull()
    const batches = planHuntBatches(FILES, JOB.signalSites!)!
    expect(batches.map(b => b.length)).toEqual([40, 40, 40])
    // Sinks before entries before the rest, whatever their names.
    expect(batches[0]!.slice(0, 3)).toEqual(RISKY)
    expect(new Set(batches.flat())).toEqual(new Set(FILES))
    // Pure: the same job yields the same plan (a retry recomputes it).
    expect(planHuntBatches([...FILES].reverse(), JOB.signalSites!)).toEqual(
      batches
    )
  })

  it('hunts all 120 files in three runs, keeps every batch’s findings, and ends RAN', async () => {
    const { results, jobs } = await runToTheEnd(JOB)
    expect(results.map(r => r.outcome)).toEqual([
      'CONTINUED',
      'CONTINUED',
      'RAN',
    ])
    // What each run planned with: disjoint batches that together are the diff.
    const seen = plan.mock.calls.map(
      ([input]) => (input as { job: HuntJob }).job.touchedSourcePaths
    )
    expect(seen.map(s => s.length)).toEqual([40, 40, 40])
    expect(seen.flat().sort()).toEqual([...FILES].sort())
    expect(seen[0]!.slice(0, 3)).toEqual(RISKY)
    // Each batch's signal sites travel with it, and only with it.
    const firstSites = (plan.mock.calls[0]![0] as { job: HuntJob }).job
      .signalSites!
    expect(firstSites.map(s => s.path).sort()).toEqual([...RISKY].sort())
    // Every run writes its own findings; only the last settles the layer.
    expect(persist.mock.calls.map(([p]) => p.stage)).toEqual([
      'PENDING',
      'PENDING',
      'RAN',
    ])
    expect(persist.mock.calls.map(([p]) => p.findings.length)).toEqual([
      1, 1, 1,
    ])
    // Writes are fenced by a rising attempt; each batch has a fresh try budget.
    expect(
      jobs.map(j => [j.attempt ?? 1, j.tries ?? 1, j.batchIndex ?? 0])
    ).toEqual([
      [1, 1, 0],
      [2, 1, 1],
      [3, 1, 2],
    ])
    // No cause is left over: the whole diff was hunted.
    expect(persist.mock.calls.flatMap(([p]) => p.partialCauses)).toEqual([])
  })

  it('the covered share is persisted on the running job and shown while batches are queued', async () => {
    // As stage A starts it: the plan rides on the job from the first run.
    const { jobs } = await runToTheEnd({
      ...JOB,
      batches: planHuntBatches(FILES, JOB.signalSites!)!,
      batchIndex: 0,
    })
    expect(jobs.map(j => huntBatchProgress(j, 'PENDING'))).toEqual([
      { coveredFiles: 0, totalFiles: 120 },
      { coveredFiles: 40, totalFiles: 120 },
      { coveredFiles: 80, totalFiles: 120 },
    ])
    expect(huntBatchProgress(jobs[2], 'RAN')).toEqual({
      coveredFiles: 120,
      totalFiles: 120,
    })
    // An un-batched hunt has no ratio to show.
    expect(huntBatchProgress({ ...JOB }, 'PENDING')).toBeNull()
    const line = formatScanLayerTail({
      status: 'CLEAN',
      stages: { secrets: 'RAN', hunt: 'PENDING' },
      partial: false,
      huntProgress: huntBatchProgress(jobs[1], 'PENDING'),
      externalFindings: 0,
      externalFailureReason: null,
    })
    expect(line).toContain('Exploit paths: scanning (40/120 source files)')
  })

  it('a batch that ended unfinished after its retries does not stop the rest, and the layer ends PARTIAL', async () => {
    hunt.mockImplementation(async ({ job }: { job: HuntJob }) => ({
      candidates: [],
      tokens: 100,
      elapsedMs: 1000,
      // The middle batch times out on every try.
      stopped: job.touchedSourcePaths.includes(FILES[40]!) ? 'timeout' : 'done',
    }))
    requeue.mockResolvedValue({ requeued: false, reason: 'exhausted' })
    const { results } = await runToTheEnd(JOB)
    expect(results.map(r => r.outcome)).toEqual([
      'CONTINUED',
      'CONTINUED',
      'PARTIAL',
    ])
    expect(persist.mock.calls[1]![0].partialCauses).toEqual(['HUNT_INCOMPLETE'])
    expect(mergeBatchStage('PARTIAL', 'RAN')).toBe('PARTIAL')
    expect(mergeBatchStage('RAN', 'SKIPPED')).toBe('RAN')
  })

  it('a batch retried on our fault is retried as THAT batch, with the plan on its job', async () => {
    hunt.mockResolvedValueOnce({
      candidates: [],
      tokens: 100,
      elapsedMs: 1000,
      stopped: 'timeout',
    })
    hunt.mockResolvedValueOnce({
      candidates: [],
      tokens: 100,
      elapsedMs: 1000,
      stopped: 'timeout',
    })
    requeue.mockResolvedValue({ requeued: true, attempt: 2 })
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'REQUEUED',
    })
    const handed = requeue.mock.calls[0]![0].job as HuntJob
    expect(handed.batchIndex).toBe(0)
    expect(handed.batches).toEqual(planHuntBatches(FILES, JOB.signalSites!))
    expect(persist).not.toHaveBeenCalled()
  })

  describe('continueBatchedHunt', () => {
    it('claims the next attempt with the next batch as the stored job, then starts it', async () => {
      repo.claimHuntRetry.mockResolvedValue(true)
      startHunt.mockResolvedValue('run_2')
      const next: HuntJob = {
        ...JOB,
        batches: planHuntBatches(FILES, JOB.signalSites!)!,
        batchIndex: 1,
        attempt: 2,
        tries: 1,
      }
      await expect(
        securityHuntOpsService.continueBatchedHunt({ job: JOB, next })
      ).resolves.toBe(true)
      expect(repo.claimHuntRetry).toHaveBeenCalledWith('s1', 1, {
        huntJob: next,
      })
      expect(startHunt).toHaveBeenCalledWith(next)
      expect(repo.setHuntRunId).toHaveBeenCalledWith('s1', 'run_2')
    })

    it('a continuation that did not start stays owed: the stale sweep retries that batch with a fresh try', async () => {
      repo.claimHuntRetry.mockResolvedValue(true)
      startHunt.mockResolvedValueOnce(null)
      const next: HuntJob = {
        ...JOB,
        batches: planHuntBatches(FILES, JOB.signalSites!)!,
        batchIndex: 1,
        attempt: 2,
        tries: 1,
      }
      await expect(
        securityHuntOpsService.continueBatchedHunt({ job: JOB, next })
      ).resolves.toBe(false)
      expect(repo.failStaleHunt).not.toHaveBeenCalled()
      // The sweep reads the row the claim left: PENDING, attempt 2, huntJob=next.
      repo.findStalePendingHunts.mockResolvedValue([
        {
          id: 's1',
          pullRequestId: 'pr1',
          startedAt: new Date(0),
          huntJob: next,
          huntRunId: null,
          huntAttempts: 2,
        },
      ])
      repo.hasNewerScan.mockResolvedValue(false)
      startHunt.mockResolvedValueOnce('run_3')
      await securityHuntOpsService.sweepStaleHunts()
      expect(startHunt).toHaveBeenLastCalledWith({
        ...next,
        attempt: 3,
        tries: 2,
        managedScanStarted: false,
      })
      // Tries are per batch: the row is at attempt 2, yet this batch still had
      // its retry. The same row with a legacy job (no `tries`) would be failed.
      expect(repo.failStaleHunt).not.toHaveBeenCalled()
      expect(HUNT_MAX_ATTEMPTS).toBe(2)
    })
  })
})
