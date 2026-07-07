/**
 * LUM-669: the Stage-2 (对齐) trigger fired fail-soft after gate A. It builds
 * the align input from the confirmed clusters + the run's frozen priority, runs
 * the align client, and records the ALIGN stage output. A wrong stage is a
 * no-op; an align failure marks the segment FAILED (never throws to the caller).
 */
jest.mock('@/lib/repositories/plan-run.repository', () => ({
  planRunRepository: { findById: jest.fn(), findStageRecord: jest.fn() },
}))
jest.mock('@/lib/repositories/idea.repository', () => ({
  ideaRepository: { findByIds: jest.fn() },
}))
jest.mock('@/lib/services/plan-run.service', () => ({
  planRunService: { recordStageOutput: jest.fn(), failStage: jest.fn() },
}))
jest.mock('@/lib/llm/plan-align-client', () => ({ alignClusters: jest.fn() }))
jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn() } }))
jest.mock('@/lib/services/idea-evidence-summary', () => ({
  summariseIdeaEvidence: jest.fn(),
}))

import { triggerAlignStage } from '@/lib/services/plan-align-runner'
import { planRunRepository } from '@/lib/repositories/plan-run.repository'
import { ideaRepository } from '@/lib/repositories/idea.repository'
import { planRunService } from '@/lib/services/plan-run.service'
import { alignClusters } from '@/lib/llm/plan-align-client'
import { summariseIdeaEvidence } from '@/lib/services/idea-evidence-summary'
import { REASONING_MODEL } from '@/lib/ai/models'

const findById = planRunRepository.findById as jest.Mock
const findStageRecord = planRunRepository.findStageRecord as jest.Mock
const findByIds = ideaRepository.findByIds as jest.Mock
const recordStageOutput = planRunService.recordStageOutput as jest.Mock
const failStage = planRunService.failStage as jest.Mock
const align = alignClusters as jest.Mock
const summariseEvidence = summariseIdeaEvidence as jest.Mock

const confirmed = {
  clusters: [{ name: 'Alpha', thrust: 't1', ideaIds: ['idea-a', 'idea-c'] }],
  orphans: ['idea-b'],
}

beforeEach(() => {
  jest.clearAllMocks()
  // Default: no evidence attached (fail-soft null) unless a test overrides it.
  summariseEvidence.mockResolvedValue({
    slack: [],
    web: [],
    figma: [],
    sourceCount: 0,
    channels: [],
  })
})

it('builds the align input from confirmed clusters + priority and records ALIGN', async () => {
  findById.mockResolvedValue({
    id: 'run-1',
    stage: 'ALIGNING',
    prioritySnapshot: 'ship it',
  })
  findStageRecord.mockResolvedValue({ humanConfirmedOutput: confirmed })
  findByIds.mockResolvedValue([
    { id: 'idea-a', statement: 'Idea A' },
    { id: 'idea-c', statement: 'Idea C' },
  ])
  // idea-a has one slack source, idea-c has one web source — the cluster
  // aggregates to 2 distinct sources across both channels.
  summariseEvidence.mockImplementation((ideaId: string) =>
    Promise.resolve(
      ideaId === 'idea-a'
        ? {
            slack: ['slack: 1 msg(s) in #x'],
            web: [],
            figma: [],
            sourceCount: 1,
            channels: ['slack'],
          }
        : {
            slack: [],
            web: ['web: Title'],
            figma: [],
            sourceCount: 1,
            channels: ['web'],
          }
    )
  )
  align.mockResolvedValue({
    clusters: [
      {
        clusterId: 'cluster-0',
        verdict: 'ALIGNED',
        rationale: 'x',
        customizationTrap: false,
      },
    ],
    priorityDeclared: true,
  })

  await triggerAlignStage('run-1')

  // Only the clusters' ideas are fetched, labels come from names, items are
  // the resolved statements, evidenceSources is aggregated across the
  // cluster's ideas, and the frozen priority rides along.
  expect(findByIds).toHaveBeenCalledWith(['idea-a', 'idea-c'])
  expect(align).toHaveBeenCalledWith({
    clusters: [
      {
        clusterId: 'cluster-0',
        label: 'Alpha',
        items: ['Idea A', 'Idea C'],
        evidenceSources: { count: 2, channels: ['slack', 'web'] },
      },
    ],
    priority: 'ship it',
  })
  expect(recordStageOutput).toHaveBeenCalledWith(
    expect.objectContaining({
      planRunId: 'run-1',
      kind: 'ALIGN',
      output: expect.objectContaining({ model: REASONING_MODEL }),
    })
  )
  expect(failStage).not.toHaveBeenCalled()
})

it('is a no-op when the run is not in ALIGNING', async () => {
  findById.mockResolvedValue({ id: 'run-1', stage: 'CLUSTERS_READY' })

  await triggerAlignStage('run-1')

  expect(align).not.toHaveBeenCalled()
  expect(recordStageOutput).not.toHaveBeenCalled()
  expect(failStage).not.toHaveBeenCalled()
})

it('marks the segment FAILED (never throws) when the align client errors', async () => {
  findById.mockResolvedValue({
    id: 'run-1',
    stage: 'ALIGNING',
    prioritySnapshot: null,
  })
  findStageRecord.mockResolvedValue({ humanConfirmedOutput: confirmed })
  findByIds.mockResolvedValue([{ id: 'idea-a', statement: 'Idea A' }])
  align.mockRejectedValue(new Error('gateway 500'))
  failStage.mockResolvedValue(undefined)

  await expect(triggerAlignStage('run-1')).resolves.toBeUndefined()
  expect(failStage).toHaveBeenCalledWith('run-1')
  expect(recordStageOutput).not.toHaveBeenCalled()
})

it('fails soft on evidence lookup errors: omits evidenceSources (null) instead of failing the stage', async () => {
  findById.mockResolvedValue({
    id: 'run-1',
    stage: 'ALIGNING',
    prioritySnapshot: 'ship it',
  })
  findStageRecord.mockResolvedValue({ humanConfirmedOutput: confirmed })
  findByIds.mockResolvedValue([
    { id: 'idea-a', statement: 'Idea A' },
    { id: 'idea-c', statement: 'Idea C' },
  ])
  summariseEvidence.mockRejectedValue(new Error('db unavailable'))
  align.mockResolvedValue({ clusters: [], priorityDeclared: true })

  await triggerAlignStage('run-1')

  expect(align).toHaveBeenCalledWith({
    clusters: [
      {
        clusterId: 'cluster-0',
        label: 'Alpha',
        items: ['Idea A', 'Idea C'],
        evidenceSources: null,
      },
    ],
    priority: 'ship it',
  })
  expect(failStage).not.toHaveBeenCalled()
  expect(recordStageOutput).toHaveBeenCalled()
})
