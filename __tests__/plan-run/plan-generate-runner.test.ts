/**
 * @jest-environment node
 *
 * LUM-689 — Stage-3 (成计划) runner. Gate B advanced a run to GENERATING and
 * then returned with nothing behind it: `callPlanGenerateLLM` had no caller
 * anywhere in the repo, so every confirmed run sat on "Working on the plan…"
 * forever. These tests pin the hop that closes it.
 *
 * The generate client statically imports `ai` / `@ai-sdk/gateway` (the jest
 * TransformStream trap), which is exactly why the runner dynamic-imports it —
 * mocking the module by path here is enough, no static import ever happens.
 */
jest.mock('@/lib/repositories/plan-run.repository', () => ({
  planRunRepository: {
    findById: jest.fn(),
    findStageRecord: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/idea.repository', () => ({
  ideaRepository: { findByIds: jest.fn() },
}))
jest.mock('@/lib/services/plan-run.service', () => ({
  planRunService: {
    recordStageOutput: jest.fn(),
    failStage: jest.fn(),
  },
}))
jest.mock('@/lib/llm/plan-generate-client', () => ({
  callPlanGenerateLLM: jest.fn(),
}))
jest.mock('@/lib/ai/models', () => ({ GENERATION_MODEL: 'test/model' }))
jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn() } }))

import { triggerGenerateStage } from '@/lib/services/plan-generate-runner'
import { planRunRepository } from '@/lib/repositories/plan-run.repository'
import { ideaRepository } from '@/lib/repositories/idea.repository'
import { planRunService } from '@/lib/services/plan-run.service'
import { callPlanGenerateLLM } from '@/lib/llm/plan-generate-client'

const mockRepo = planRunRepository as jest.Mocked<typeof planRunRepository>
const mockIdeas = ideaRepository as jest.Mocked<typeof ideaRepository>
const mockService = planRunService as jest.Mocked<typeof planRunService>
const mockLLM = callPlanGenerateLLM as jest.MockedFunction<
  typeof callPlanGenerateLLM
>

const RUN_ID = 'run_1'

/** A run parked mid-Stage-3 with a frozen priority. */
function run(stage: string) {
  return {
    id: RUN_ID,
    stage,
    prioritySnapshot: 'ship the converter',
  } as never
}

/**
 * Gate A's confirmed clustering — note the shape carries NO clusterId: cluster
 * identity is positional, which is what `clusterIndexFromId` resolves.
 */
const CLUSTER_RECORD = {
  humanConfirmedOutput: {
    clusters: [
      { name: 'Converter wiring', thrust: 'unblock', ideaIds: ['i1', 'i2'] },
      { name: 'Shelved stuff', thrust: 'later', ideaIds: ['i3'] },
    ],
    orphans: [],
  },
} as never

/**
 * Gate B's confirmed alignment. cluster-0 is starred + ALIGNED and the reviewer
 * dropped `i2` at gate B (LUM-688); cluster-1 is ALIGNED but unstarred.
 */
const ALIGN_RECORD = {
  humanConfirmedOutput: {
    clusters: [
      {
        clusterId: 'cluster-0',
        verdict: 'ALIGNED',
        starred: true,
        rationale: 'directly on priority',
        customizationTrap: false,
        ideaIds: ['i1'],
      },
      {
        clusterId: 'cluster-1',
        verdict: 'ALIGNED',
        starred: false,
        rationale: 'can wait',
        customizationTrap: false,
        ideaIds: ['i3'],
      },
    ],
  },
} as never

function stageRecords(align: unknown = ALIGN_RECORD) {
  mockRepo.findStageRecord.mockImplementation(async (_id, kind) =>
    kind === 'ALIGN' ? (align as never) : CLUSTER_RECORD
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockService.failStage.mockResolvedValue({} as never)
  mockService.recordStageOutput.mockResolvedValue({} as never)
  mockIdeas.findByIds.mockResolvedValue([
    { id: 'i1', statement: 'Wire stage 3' },
    { id: 'i2', statement: 'Dropped at gate B' },
    { id: 'i3', statement: 'Shelved idea' },
  ] as never)
  mockLLM.mockResolvedValue({
    drafts: [
      {
        clusterId: 'cluster-0',
        goalStatement: 'g',
        tasks: [],
        assumptionNote: 'a',
      },
    ],
    prose: 'do this first',
  })
})

it('advances a GENERATING run to DRAFT_READY', async () => {
  mockRepo.findById.mockResolvedValue(run('GENERATING'))
  stageRecords()

  await triggerGenerateStage(RUN_ID)

  expect(mockLLM).toHaveBeenCalledTimes(1)
  expect(mockService.failStage).not.toHaveBeenCalled()

  // Recording the GENERATE output is the edge that lands the run on
  // DRAFT_READY (SEGMENT_BY_KIND.GENERATE.ready) — gate C opens.
  expect(mockService.recordStageOutput).toHaveBeenCalledTimes(1)
  const recorded = mockService.recordStageOutput.mock.calls[0]![0]
  expect(recorded.kind).toBe('GENERATE')
  expect(recorded.planRunId).toBe(RUN_ID)
  expect(recorded.output.llmRawOutput).toEqual({
    drafts: [
      {
        clusterId: 'cluster-0',
        goalStatement: 'g',
        tasks: [],
        assumptionNote: 'a',
      },
    ],
    prose: 'do this first',
  })
})

it('passes only starred ALIGNED clusters with the gate-B kept ideas', async () => {
  mockRepo.findById.mockResolvedValue(run('GENERATING'))
  stageRecords()

  await triggerGenerateStage(RUN_ID)

  const input = mockLLM.mock.calls[0]![0]
  expect(input.priority).toBe('ship the converter')

  // cluster-1 is ALIGNED but unstarred — deliberately shelved at gate B.
  expect(input.clusters).toHaveLength(1)
  const [cluster] = input.clusters
  expect(cluster!.clusterId).toBe('cluster-0')
  expect(cluster!.label).toBe('ALIGNED')
  expect(cluster!.starred).toBe(true)

  // Theme is joined back from the CLUSTER record by positional id.
  expect(cluster!.theme).toBe('Converter wiring')

  // Only the ideas KEPT at gate B: `i2` was unchecked, so Stage 3 never sees
  // it even though gate A had clustered it here.
  expect(cluster!.ideas).toEqual(['Wire stage 3'])
})

it('caps the handoff at two starred ALIGNED clusters', async () => {
  mockRepo.findById.mockResolvedValue(run('GENERATING'))
  const many = {
    humanConfirmedOutput: {
      clusters: ['cluster-0', 'cluster-1', 'cluster-2'].map(clusterId => ({
        clusterId,
        verdict: 'ALIGNED',
        starred: true,
        rationale: 'r',
        customizationTrap: false,
        ideaIds: ['i1'],
      })),
    },
  }
  stageRecords(many)

  await triggerGenerateStage(RUN_ID)

  expect(mockLLM.mock.calls[0]![0].clusters.map(c => c.clusterId)).toEqual([
    'cluster-0',
    'cluster-1',
  ])
})

it('marks the run FAILED when the generate client throws', async () => {
  mockRepo.findById.mockResolvedValue(run('GENERATING'))
  stageRecords()
  mockLLM.mockRejectedValue(new Error('gateway exploded'))

  await triggerGenerateStage(RUN_ID)

  // FAILED is recoverable and retryable; GENERATING would be a silent wedge.
  expect(mockService.failStage).toHaveBeenCalledWith(RUN_ID)
  expect(mockService.recordStageOutput).not.toHaveBeenCalled()
})

it('marks the run FAILED when gate B left no confirmed alignment', async () => {
  mockRepo.findById.mockResolvedValue(run('GENERATING'))
  stageRecords({ humanConfirmedOutput: null })

  await triggerGenerateStage(RUN_ID)

  expect(mockService.failStage).toHaveBeenCalledWith(RUN_ID)
  expect(mockLLM).not.toHaveBeenCalled()
})

it.each(['ALIGNMENT_READY', 'DRAFT_READY', 'MATERIALIZED', 'FAILED'])(
  'is a no-op for a run at %s',
  async stage => {
    mockRepo.findById.mockResolvedValue(run(stage))

    await triggerGenerateStage(RUN_ID)

    expect(mockLLM).not.toHaveBeenCalled()
    expect(mockService.recordStageOutput).not.toHaveBeenCalled()
    expect(mockService.failStage).not.toHaveBeenCalled()
  }
)

it('is a no-op for a missing run', async () => {
  mockRepo.findById.mockResolvedValue(null)

  await triggerGenerateStage(RUN_ID)

  expect(mockLLM).not.toHaveBeenCalled()
  expect(mockService.failStage).not.toHaveBeenCalled()
})
