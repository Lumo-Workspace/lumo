/**
 * LUM-674: the Stage-1 (聚类) trigger fired fail-soft after `POST /api/plan-runs`
 * creates a run in CLUSTERING. This is the regression guard for the end-to-end
 * break where `startRun` created the run but nothing ever ran clustering, so
 * every run sat stuck in CLUSTERING and gate A never opened.
 *
 * These drive the REAL trigger AND the real `planRunService` AND the real
 * `planRunRepository`, mocking only Prisma at the bottom (`@/lib/db/prisma`),
 * the idea read repository, and the cluster LLM. So the wiring under test —
 * trigger → recordStageOutput → upsertStageRecord + updateStage(CLUSTERS_READY)
 * — is exercised for real, not stubbed away (the isolated-component tests that
 * hid this bug all passed).
 */

// ── Mocks ───────────────────────────────────────────────────────────────────
jest.mock('@/lib/db/prisma', () => {
  const prisma = {
    planRun: { findUnique: jest.fn(), update: jest.fn() },
    planRunStageRecord: { upsert: jest.fn() },
  }
  return { prisma }
})
jest.mock('@/lib/repositories/idea.repository', () => ({
  ideaRepository: { findByIds: jest.fn() },
}))
jest.mock('@/lib/llm/plan-cluster-client', () => ({
  callPlanClusterLLM: jest.fn(),
}))
jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn() } }))

import { triggerClusterStage } from '@/lib/services/plan-cluster-runner'
import { prisma } from '@/lib/db/prisma'
import { ideaRepository } from '@/lib/repositories/idea.repository'
import { callPlanClusterLLM } from '@/lib/llm/plan-cluster-client'
import { GENERATION_MODEL } from '@/lib/ai/models'
import type { PlanRunStage } from '@prisma/client'

const prismaMock = prisma as unknown as {
  planRun: { findUnique: jest.Mock; update: jest.Mock }
  planRunStageRecord: { upsert: jest.Mock }
}
const findByIds = ideaRepository.findByIds as jest.Mock
const cluster = callPlanClusterLLM as jest.Mock

const run = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'run-1',
  teamId: 'team-1',
  workspaceId: 'w1',
  stage: 'CLUSTERING' as PlanRunStage,
  startedByMemberId: 'm1',
  inputIdeaIds: ['idea-a', 'idea-b', 'idea-c'],
  priorityId: null,
  prioritySnapshot: null,
  proseDocument: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
})

const CLUSTER_OUTPUT = {
  clusters: [
    { name: 'Alpha', thrust: 'ship it', ideaIds: ['idea-a', 'idea-c'] },
  ],
  orphans: ['idea-b'],
}

beforeEach(() => jest.clearAllMocks())

it('run reaches CLUSTERS_READY after the clustering trigger', async () => {
  // A run created in CLUSTERING; every prisma read returns it.
  prismaMock.planRun.findUnique.mockResolvedValue(run())
  prismaMock.planRunStageRecord.upsert.mockResolvedValue({ id: 'rec-1' })
  prismaMock.planRun.update.mockImplementation(async ({ data }) =>
    run({ stage: data.stage })
  )
  findByIds.mockResolvedValue([
    { id: 'idea-a', statement: 'Idea A', sourceContext: null },
    { id: 'idea-b', statement: 'Idea B', sourceContext: 'ctx' },
    { id: 'idea-c', statement: 'Idea C', sourceContext: null },
  ])
  cluster.mockResolvedValue(CLUSTER_OUTPUT)

  await triggerClusterStage('run-1')

  // Stage-1 runs on the frozen input ideas.
  expect(findByIds).toHaveBeenCalledWith(['idea-a', 'idea-b', 'idea-c'])
  // Evidence lookup is fail-soft (LUM-681): the evidence repos aren't mocked
  // here so the underlying reads throw against the mocked prisma, and each
  // idea's `evidence` gracefully falls back to null rather than failing the
  // stage — see idea-evidence-summary.test.ts / plan-cluster-runner coverage.
  expect(cluster).toHaveBeenCalledWith([
    { id: 'idea-a', statement: 'Idea A', sourceContext: null, evidence: null },
    { id: 'idea-b', statement: 'Idea B', sourceContext: 'ctx', evidence: null },
    { id: 'idea-c', statement: 'Idea C', sourceContext: null, evidence: null },
  ])

  // The CLUSTER stage record holds the Stage-1 output (clusters + orphans).
  expect(prismaMock.planRunStageRecord.upsert).toHaveBeenCalledTimes(1)
  const upsertArg = prismaMock.planRunStageRecord.upsert.mock.calls[0][0]
  expect(upsertArg.where).toEqual({
    planRunId_kind: { planRunId: 'run-1', kind: 'CLUSTER' },
  })
  expect(upsertArg.create).toMatchObject({
    planRunId: 'run-1',
    kind: 'CLUSTER',
    model: GENERATION_MODEL,
    llmRawOutput: CLUSTER_OUTPUT,
  })

  // The run advances to CLUSTERS_READY — not left stuck in CLUSTERING.
  expect(prismaMock.planRun.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'run-1' },
      data: { stage: 'CLUSTERS_READY' },
    })
  )
})

it('clustering trigger failure sets the run FAILED', async () => {
  prismaMock.planRun.findUnique.mockResolvedValue(run())
  prismaMock.planRun.update.mockImplementation(async ({ data }) =>
    run({ stage: data.stage })
  )
  findByIds.mockResolvedValue([
    { id: 'idea-a', statement: 'Idea A', sourceContext: null },
  ])
  cluster.mockRejectedValue(new Error('gateway 500'))

  // Never throws to the caller (the response already succeeded).
  await expect(triggerClusterStage('run-1')).resolves.toBeUndefined()

  // No stage output recorded, and the run is flipped to FAILED (retryable) —
  // not left in CLUSTERING.
  expect(prismaMock.planRunStageRecord.upsert).not.toHaveBeenCalled()
  expect(prismaMock.planRun.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'run-1' },
      data: { stage: 'FAILED' },
    })
  )
})

it('is a no-op when the run is not in CLUSTERING (stale / raced trigger)', async () => {
  prismaMock.planRun.findUnique.mockResolvedValue(
    run({ stage: 'CLUSTERS_READY' })
  )

  await triggerClusterStage('run-1')

  expect(cluster).not.toHaveBeenCalled()
  expect(prismaMock.planRunStageRecord.upsert).not.toHaveBeenCalled()
  expect(prismaMock.planRun.update).not.toHaveBeenCalled()
})
