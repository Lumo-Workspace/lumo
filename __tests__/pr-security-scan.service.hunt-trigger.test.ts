/**
 * @jest-environment node
 *
 * LUM-739 — stage A's L3 trigger and handoff to securityHuntWorkflow.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
  // LUM-785: stage A's graph rules read touched files; null = not found.
  readRepoFile: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/llm/security-judge-client', () => ({
  judgeSecurity: jest.fn(),
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
    mergeStages: jest.fn(),
  },
}))
// LUM-740: stage A reads the workspace policy to decide whether a finding is
// urgent enough to sync the PR before the runs land; null = the 732 default.
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findLastSarifIngestAt: jest.fn() },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { findUndispositionedByTask: jest.fn() },
}))
jest.mock('@/lib/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))
jest.mock('@/lib/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  recordHuntStartBestEffort: jest.fn(),
}))
// LUM-758: the VM-sharing cases below turn the managed scan ON, which drags
// in supersede / the hourly cap / the baseline request.
jest.mock('@/lib/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {
    supersedeOlderRuns: jest.fn().mockResolvedValue(undefined),
    enforceHourlyCap: jest.fn().mockResolvedValue({ capped: false }),
  },
}))
jest.mock('@/lib/services/security-baseline.service', () => ({
  securityBaselineService: { ensure: jest.fn().mockResolvedValue(undefined) },
}))
jest.mock('@/lib/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))

import { prSecurityScanService } from '@/lib/services/pr-security-scan.service'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { startSecurityManagedScan } from '@/lib/services/security-managed-scan-start'
import {
  recordHuntStartBestEffort,
  startSecurityHunt,
} from '@/lib/services/security-hunt-start'
import { securityPrReviewService } from '@/lib/services/security-pr-review.service'
import { waitUntil } from '@vercel/functions'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/lib/llm/security-judge-client'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const prRepo = pullRequestRepository as jest.Mocked<
  typeof pullRequestRepository
>
const crossings = boundaryCrossingRepository as jest.Mocked<
  typeof boundaryCrossingRepository
>
const fetchPrDiff = gh.fetchPrDiff as jest.Mock
const fetchPrHeadSha = gh.fetchPrHeadSha as jest.Mock
const judgeSecurity = judge.judgeSecurity as jest.Mock
const startManaged = startSecurityManagedScan as jest.Mock
const startHunt = startSecurityHunt as jest.Mock
const recordHuntStart = recordHuntStartBestEffort as jest.Mock
const syncReview = securityPrReviewService.sync as jest.Mock
const waitUntilMock = waitUntil as jest.Mock

const PR = {
  id: 'pr1',
  workspaceId: 'w1',
  taskId: 't1',
  repo: 'o/r',
  number: 7,
}
const diff = (path: string, line: string) =>
  ['--- a/' + path, '+++ b/' + path, '@@ -1,0 +1,1 @@', '+' + line].join('\n')
const ROUTE_DIFF = diff(
  'app/api/x/route.ts',
  'export async function POST(req: Request) {'
)
const PLAIN_DIFF = diff('src/a.ts', 'const x = 1')
// Built at runtime so the fixture is not itself a secret-shaped literal in
// the diff (the scanner must see it in the scanned text, not in this file).
const FAKE_AWS_KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('')
const SECRET_DIFF = diff('src/cfg.ts', `const k = "${FAKE_AWS_KEY}"`)

let order: string[]
beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.LUMO_SECURITY_HUNT
  process.env.LUMO_MANAGED_SCAN = 'off'
  order = []
  prRepo.findById.mockResolvedValue(PR as never)
  fetchPrHeadSha.mockResolvedValue('sha-1')
  repo.findByPrAndSha.mockResolvedValue(null)
  repo.create.mockResolvedValue({ id: 's1' })
  repo.findDispositionedByPullRequest.mockResolvedValue([])
  repo.countExternalFindings.mockResolvedValue(0)
  repo.persistResult.mockImplementation(async () => {
    order.push('persist')
  })
  repo.mergeStages.mockResolvedValue(undefined)
  repo.setManagedRunId = jest.fn().mockResolvedValue(undefined) as never
  judgeSecurity.mockResolvedValue({ findings: [] })
  crossings.findUndispositionedByTask.mockResolvedValue([] as never)
  startManaged.mockResolvedValue(null)
  startHunt.mockImplementation(async () => {
    order.push('start')
    return 'run_h1'
  })
  syncReview.mockResolvedValue({ posted: true, inline: 0, skipped: 0 })
})

afterEach(() => {
  delete process.env.LUMO_MANAGED_SCAN
})

const run = () =>
  prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
const persistedStages = () => repo.persistResult.mock.calls[0]![2].stages

describe('LUM-739 hunt trigger', () => {
  it('a diff touching a route handler: persists stages.hunt=PENDING, THEN starts the workflow with the job, and leaves the PR sync to the run', async () => {
    fetchPrDiff.mockResolvedValue(ROUTE_DIFF)
    await expect(run()).resolves.toMatchObject({
      scanId: 's1',
      status: 'CLEAN',
    })
    expect(persistedStages()).toMatchObject({ secrets: 'RAN', hunt: 'PENDING' })
    expect(order).toEqual(['persist', 'start'])
    expect(startHunt).toHaveBeenCalledWith({
      scanId: 's1',
      pullRequestId: 'pr1',
      taskId: 't1',
      workspaceId: 'w1',
      repo: 'o/r',
      prNumber: 7,
      headSha: 'sha-1',
      // LUM-758: the trigger's own reasons ride along — the planning step and
      // its deterministic fallback are both driven by them.
      reasons: ['diff:entry:next-route-handler'],
      // LUM-758 Task 10 review: the TS/TSX paths of the same `files` the
      // trigger read. `reasons` say which rules fired; these say where they
      // could have fired, which is what short circuit A and the planner
      // prompt both need and what nothing else in the job carries.
      touchedSourcePaths: ['app/api/x/route.ts'],
      // LUM-758 follow-up: the SAME walk's located hits. Dropped here, the
      // agent is back to `rg`-ing for a call site stage A already had in hand,
      // and nothing downstream can tell the difference — the prompt just
      // silently falls back to the rule-id list.
      signalSites: [
        {
          rule: 'entry:next-route-handler',
          path: 'app/api/x/route.ts',
          line: 1,
        },
      ],
      // LUM-758: LUMO_MANAGED_SCAN is off in this suite, so no VM is coming —
      // the hunt must not spend 30 s polling for one.
      managedScanStarted: false,
    })
    expect(repo.mergeStages).not.toHaveBeenCalled()
    expect(waitUntilMock).not.toHaveBeenCalled()
    expect(syncReview).not.toHaveBeenCalled()
  })

  it('a start that returns null repairs the row to hunt=FAILED and syncs the PR itself', async () => {
    fetchPrDiff.mockResolvedValue(ROUTE_DIFF)
    startHunt.mockResolvedValue(null)
    await run()
    expect(persistedStages().hunt).toBe('PENDING')
    expect(repo.mergeStages).toHaveBeenCalledWith('s1', { hunt: 'FAILED' })
    expect(waitUntilMock).toHaveBeenCalledTimes(1)
  })

  it('LUM-822: a started hunt records its job and run id for the stale-hunt sweep; a failed start records nothing', async () => {
    fetchPrDiff.mockResolvedValue(ROUTE_DIFF)
    await run()
    expect(recordHuntStart).toHaveBeenCalledTimes(1)
    const [scanId, job, runId] = recordHuntStart.mock.calls[0]!
    expect(scanId).toBe('s1')
    expect(runId).toBe('run_h1')
    // Exactly the job the run was started with — the retry's input.
    expect(job).toEqual(startHunt.mock.calls[0]![0])

    recordHuntStart.mockClear()
    startHunt.mockResolvedValue(null)
    await run()
    expect(recordHuntStart).not.toHaveBeenCalled()
  })

  it('a plain diff with no pattern, no HIGH finding and no crossing: hunt=SKIPPED, nothing started, PR synced', async () => {
    fetchPrDiff.mockResolvedValue(PLAIN_DIFF)
    await run()
    expect(persistedStages().hunt).toBe('SKIPPED')
    expect(startHunt).not.toHaveBeenCalled()
    expect(waitUntilMock).toHaveBeenCalledTimes(1)
  })

  it('a HIGH stage-A finding triggers the hunt on a pattern-free diff — and the blocking finding still syncs the PR', async () => {
    fetchPrDiff.mockResolvedValue(SECRET_DIFF)
    await run()
    expect(persistedStages().hunt).toBe('PENDING')
    expect(startHunt).toHaveBeenCalledTimes(1)
    // LUM-758 Task 10 review: this is the trigger condition that leaves NO
    // `diff:` reason. The job carries the touched source anyway, which is
    // what lets the workflow's short circuit A tell this PR (a HIGH beside
    // changed TypeScript) from one that only touched a README.
    expect(startHunt).toHaveBeenCalledWith(
      expect.objectContaining({
        reasons: ['stage-a:high'],
        touchedSourcePaths: ['src/cfg.ts'],
      })
    )
    // DETERMINISTIC HIGH blocks DONE: it must reach the PR even before the run lands.
    expect(waitUntilMock).toHaveBeenCalledTimes(1)
  })

  it('an OPEN L4 crossing on the task triggers the hunt; a crossing-read error does not', async () => {
    fetchPrDiff.mockResolvedValue(PLAIN_DIFF)
    crossings.findUndispositionedByTask.mockResolvedValueOnce([
      { category: 'HOOK_BYPASS' },
    ] as never)
    await run()
    expect(persistedStages().hunt).toBe('PENDING')
    expect(crossings.findUndispositionedByTask).toHaveBeenCalledWith('t1')

    jest.clearAllMocks()
    repo.persistResult.mockResolvedValue(undefined)
    prRepo.findById.mockResolvedValue(PR as never)
    fetchPrHeadSha.mockResolvedValue('sha-2')
    repo.findByPrAndSha.mockResolvedValue(null)
    repo.create.mockResolvedValue({ id: 's2' })
    repo.findDispositionedByPullRequest.mockResolvedValue([])
    repo.countExternalFindings.mockResolvedValue(0)
    judgeSecurity.mockResolvedValue({ findings: [] })
    fetchPrDiff.mockResolvedValue(PLAIN_DIFF)
    crossings.findUndispositionedByTask.mockRejectedValueOnce(new Error('db'))
    await expect(run()).resolves.toMatchObject({ status: 'CLEAN' })
    expect(persistedStages().hunt).toBe('SKIPPED')
    expect(startHunt).not.toHaveBeenCalled()
  })

  it('LUM-758 Task 10 review: touchedSourcePaths carries only TS/TSX, filtered exactly like the trigger filters', async () => {
    // The same `isGraphSourcePath` the trigger uses: a `.md`, a `.js` and a
    // `.d.ts` are not files the hunt can start from, so they must not make an
    // otherwise-empty diff look huntable to short circuit A.
    fetchPrDiff.mockResolvedValue(
      [
        ROUTE_DIFF,
        diff('README.md', 'docs'),
        diff('scripts/x.js', 'const y = 1'),
        diff('types/x.d.ts', 'export type A = 1'),
        diff('components/Card.tsx', 'export const Card = () => null'),
      ].join('\n')
    )

    await run()

    expect(startHunt).toHaveBeenCalledWith(
      expect.objectContaining({
        touchedSourcePaths: ['app/api/x/route.ts', 'components/Card.tsx'],
      })
    )
  })

  it('a non-L4 crossing does not trigger the hunt', async () => {
    fetchPrDiff.mockResolvedValue(PLAIN_DIFF)
    crossings.findUndispositionedByTask.mockResolvedValueOnce([
      { category: 'HARDCODED_SECRET' },
    ] as never)
    await run()
    expect(persistedStages().hunt).toBe('SKIPPED')
  })

  it('LUMO_SECURITY_HUNT=off stamps no hunt layer at all, even when a trigger fires', async () => {
    process.env.LUMO_SECURITY_HUNT = 'off'
    fetchPrDiff.mockResolvedValue(ROUTE_DIFF)
    await run()
    expect(persistedStages().hunt).toBeUndefined()
    expect(startHunt).not.toHaveBeenCalled()
  })

  it('LUM-758: tells the managed scan to keep its VM, and the hunt that one is coming', async () => {
    process.env.LUMO_MANAGED_SCAN = 'on'
    startManaged.mockResolvedValue('run_m1')
    fetchPrDiff.mockResolvedValue(ROUTE_DIFF)

    await run()

    // The decision has to be made BEFORE the managed run starts — that is why
    // the trigger is evaluated above the external branch now.
    expect(startManaged).toHaveBeenCalledWith(
      expect.objectContaining({ huntWanted: true })
    )
    expect(startHunt).toHaveBeenCalledWith(
      expect.objectContaining({ managedScanStarted: true })
    )
  })

  it('LUM-758: a managed scan that could not start means no VM to wait for', async () => {
    process.env.LUMO_MANAGED_SCAN = 'on'
    startManaged.mockResolvedValue(null)
    fetchPrDiff.mockResolvedValue(ROUTE_DIFF)

    await run()

    expect(startHunt).toHaveBeenCalledWith(
      expect.objectContaining({ managedScanStarted: false })
    )
  })

  it('LUM-758: a diff with no hunt trigger lets the managed scan stop its own VM', async () => {
    process.env.LUMO_MANAGED_SCAN = 'on'
    startManaged.mockResolvedValue('run_m1')
    fetchPrDiff.mockResolvedValue(PLAIN_DIFF)

    await run()

    expect(startManaged).toHaveBeenCalledWith(
      expect.objectContaining({ huntWanted: false })
    )
    expect(startHunt).not.toHaveBeenCalled()
  })

  it('a stage-A crash never finalizes with a PENDING hunt', async () => {
    fetchPrDiff.mockResolvedValue(ROUTE_DIFF)
    repo.persistResult.mockRejectedValueOnce(new Error('db down'))
    await expect(run()).resolves.toMatchObject({ status: 'FAILED' })
    const final = repo.finalize.mock.calls[0]![1]
    expect(final.stages.hunt).toBeUndefined()
    expect(startHunt).not.toHaveBeenCalled()
  })
})
