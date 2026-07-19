/**
 * @jest-environment node
 *
 * LUM-689 — plan-run retry: the way out of a wedged run.
 *
 * Two wedge shapes, both recovered by re-running exactly one segment:
 *  - a working stage whose runner never ran (every gate-B-confirmed run sat in
 *    GENERATING until Stage 3 was wired), and
 *  - FAILED, where the stage no longer names the segment so it is recovered
 *    from which stage records exist.
 *
 * A run parked at an open gate or in a terminal stage has nothing to re-run and
 * must be refused — re-running there would discard a pending human review.
 */
jest.mock('@/lib/repositories/plan-run.repository', () => ({
  planRunRepository: {
    findById: jest.fn(),
    findStageRecordSummaries: jest.fn(),
    updateStage: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/idea.repository', () => ({
  ideaRepository: {},
}))
jest.mock('@/lib/repositories/priority.repository', () => ({
  priorityRepository: {},
}))
jest.mock('@/lib/team', () => ({ getDefaultTeam: jest.fn() }))

import { planRunService } from '@/lib/services/plan-run.service'
import { planRunRepository } from '@/lib/repositories/plan-run.repository'
import { retryableKind } from '@/lib/plan-run/state-machine'

const mockRepo = planRunRepository as jest.Mocked<typeof planRunRepository>

const RUN_ID = 'run_1'
const WORKSPACE_ID = 'ws_1'

function run(stage: string, workspaceId = WORKSPACE_ID) {
  return { id: RUN_ID, stage, workspaceId } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRepo.findStageRecordSummaries.mockResolvedValue([])
  mockRepo.updateStage.mockImplementation(
    async (id, stage) => ({ id, stage, workspaceId: WORKSPACE_ID }) as never
  )
})

describe('retryableKind (pure resolver)', () => {
  it.each([
    ['CLUSTERING', 'CLUSTER'],
    ['ALIGNING', 'ALIGN'],
    ['GENERATING', 'GENERATE'],
  ])('resolves the working stage %s to %s', (stage, kind) => {
    expect(retryableKind({ stage: stage as never, records: [] })).toBe(kind)
  })

  it('recovers the failed segment from the stage records', () => {
    // CLUSTER + ALIGN both confirmed → the run died in Stage 3.
    expect(
      retryableKind({
        stage: 'FAILED',
        records: [
          { kind: 'CLUSTER', confirmed: true },
          { kind: 'ALIGN', confirmed: true },
        ],
      })
    ).toBe('GENERATE')

    // Nothing recorded at all → it never got through Stage 1.
    expect(retryableKind({ stage: 'FAILED', records: [] })).toBe('CLUSTER')
  })

  it('will not re-run a segment whose gate is awaiting a human', () => {
    // CLUSTER recorded but unconfirmed → the run failed sitting at gate A.
    // Re-running Stage 1 would throw away the board a human is reviewing.
    expect(
      retryableKind({
        stage: 'FAILED',
        records: [{ kind: 'CLUSTER', confirmed: false }],
      })
    ).toBeNull()
  })

  it.each(['CLUSTERS_READY', 'ALIGNMENT_READY', 'DRAFT_READY', 'MATERIALIZED'])(
    'has nothing to retry at %s',
    stage => {
      expect(retryableKind({ stage: stage as never, records: [] })).toBeNull()
    }
  )
})

describe('plan-run retry service', () => {
  it('re-arms a run wedged in GENERATING without changing its stage', async () => {
    mockRepo.findById.mockResolvedValue(run('GENERATING'))

    const result = await planRunService.retryStage({
      planRunId: RUN_ID,
      workspaceId: WORKSPACE_ID,
    })

    expect(result.kind).toBe('GENERATE')
    expect(result.run.stage).toBe('GENERATING')
    // Already on the working stage — no pointless write.
    expect(mockRepo.updateStage).not.toHaveBeenCalled()
  })

  it('parks a FAILED run back on the working stage so the runner can proceed', async () => {
    mockRepo.findById.mockResolvedValue(run('FAILED'))
    mockRepo.findStageRecordSummaries.mockResolvedValue([
      { kind: 'CLUSTER', confirmed: true },
      { kind: 'ALIGN', confirmed: true },
    ])

    const result = await planRunService.retryStage({
      planRunId: RUN_ID,
      workspaceId: WORKSPACE_ID,
    })

    expect(result.kind).toBe('GENERATE')
    // The runners no-op unless the run is on their working stage.
    expect(mockRepo.updateStage).toHaveBeenCalledWith(RUN_ID, 'GENERATING')
    expect(result.run.stage).toBe('GENERATING')
  })

  it('refuses with 409 when the run is parked at an open gate', async () => {
    mockRepo.findById.mockResolvedValue(run('ALIGNMENT_READY'))

    await expect(
      planRunService.retryStage({
        planRunId: RUN_ID,
        workspaceId: WORKSPACE_ID,
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(mockRepo.updateStage).not.toHaveBeenCalled()
  })

  it('refuses with 409 when the run is terminal', async () => {
    mockRepo.findById.mockResolvedValue(run('MATERIALIZED'))

    await expect(
      planRunService.retryStage({
        planRunId: RUN_ID,
        workspaceId: WORKSPACE_ID,
      })
    ).rejects.toMatchObject({ status: 409 })
  })

  it('404s a run from another workspace rather than leaking it', async () => {
    mockRepo.findById.mockResolvedValue(run('GENERATING', 'ws_other'))

    await expect(
      planRunService.retryStage({
        planRunId: RUN_ID,
        workspaceId: WORKSPACE_ID,
      })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('404s a missing run', async () => {
    mockRepo.findById.mockResolvedValue(null)

    await expect(
      planRunService.retryStage({
        planRunId: RUN_ID,
        workspaceId: WORKSPACE_ID,
      })
    ).rejects.toMatchObject({ status: 404 })
  })
})
