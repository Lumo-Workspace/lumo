jest.mock('@/lib/team', () => ({ getDefaultTeam: jest.fn() }))
jest.mock('@/lib/repositories/plan-run.repository', () => ({
  planRunRepository: {
    findActiveByTeam: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    updateStage: jest.fn(),
    upsertStageRecord: jest.fn(),
    confirmStageRecord: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/idea.repository', () => ({
  ideaRepository: { listCapturedByTeam: jest.fn() },
}))
jest.mock('@/lib/repositories/priority.repository', () => ({
  priorityRepository: { findCurrent: jest.fn() },
}))

import { planRunService } from '@/lib/services/plan-run.service'
import { planRunRepository } from '@/lib/repositories/plan-run.repository'
import { ideaRepository } from '@/lib/repositories/idea.repository'
import { priorityRepository } from '@/lib/repositories/priority.repository'
import { getDefaultTeam } from '@/lib/team'
import type { PlanRunStage } from '@prisma/client'

const TEAM = { id: 'team-1', identifier: 'LUM', workspaceId: 'w1' }

const run = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'run-1',
  teamId: 'team-1',
  workspaceId: 'w1',
  stage: 'CLUSTERING' as PlanRunStage,
  startedByMemberId: 'm1',
  inputIdeaIds: [] as string[],
  priorityId: null,
  prioritySnapshot: null,
  proseDocument: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
})

beforeEach(() => jest.clearAllMocks())

describe('planRunService.startRun', () => {
  it('startRun freezes input snapshot and enters CLUSTERING', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(planRunRepository.findActiveByTeam as jest.Mock).mockResolvedValue(null)
    ;(ideaRepository.listCapturedByTeam as jest.Mock).mockResolvedValue([
      { id: 'idea-a' },
      { id: 'idea-b' },
    ])
    ;(priorityRepository.findCurrent as jest.Mock).mockResolvedValue({
      id: 'prio-1',
      statement: 'ship the converter',
    })
    ;(planRunRepository.create as jest.Mock).mockImplementation(async data =>
      run({ ...data, stage: 'CLUSTERING' })
    )

    const result = await planRunService.startRun({
      workspaceId: 'w1',
      memberId: 'm1',
    })

    // Snapshot is frozen from the team's current CAPTURED ideas + priority text.
    expect(ideaRepository.listCapturedByTeam).toHaveBeenCalledWith('team-1')
    expect(priorityRepository.findCurrent).toHaveBeenCalledWith('team-1')
    expect(planRunRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-1',
        workspaceId: 'w1',
        startedByMemberId: 'm1',
        inputIdeaIds: ['idea-a', 'idea-b'],
        priorityId: 'prio-1',
        prioritySnapshot: 'ship the converter',
      })
    )
    expect(result.stage).toBe('CLUSTERING')
  })

  it('freezes null priority snapshot when no priority is declared', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(planRunRepository.findActiveByTeam as jest.Mock).mockResolvedValue(null)
    ;(ideaRepository.listCapturedByTeam as jest.Mock).mockResolvedValue([])
    ;(priorityRepository.findCurrent as jest.Mock).mockResolvedValue(null)
    ;(planRunRepository.create as jest.Mock).mockResolvedValue(run())

    await planRunService.startRun({ workspaceId: 'w1', memberId: 'm1' })

    expect(planRunRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        inputIdeaIds: [],
        priorityId: null,
        prioritySnapshot: null,
      })
    )
  })

  it('throws 404 when the workspace has no default team', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(null)
    await expect(
      planRunService.startRun({ workspaceId: 'w1', memberId: 'm1' })
    ).rejects.toMatchObject({ status: 404 })
    expect(planRunRepository.create).not.toHaveBeenCalled()
  })

  it('one active run per team and abandonActive supersedes', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)

    // With an active (non-terminal) run present, a plain start is refused 409.
    ;(planRunRepository.findActiveByTeam as jest.Mock).mockResolvedValue(
      run({ id: 'run-old', stage: 'ALIGNING' })
    )
    await expect(
      planRunService.startRun({ workspaceId: 'w1', memberId: 'm1' })
    ).rejects.toMatchObject({ status: 409 })
    expect(planRunRepository.create).not.toHaveBeenCalled()
    expect(planRunRepository.updateStage).not.toHaveBeenCalled()

    // abandonActive first flips the prior run to ABANDONED, then creates the new one.
    ;(ideaRepository.listCapturedByTeam as jest.Mock).mockResolvedValue([])
    ;(priorityRepository.findCurrent as jest.Mock).mockResolvedValue(null)
    ;(planRunRepository.create as jest.Mock).mockResolvedValue(
      run({ id: 'run-new' })
    )

    const result = await planRunService.startRun({
      workspaceId: 'w1',
      memberId: 'm1',
      abandonActive: true,
    })

    expect(planRunRepository.updateStage).toHaveBeenCalledWith(
      'run-old',
      'ABANDONED'
    )
    // Abandon happens before the create (supersede ordering).
    const abandonOrder = (planRunRepository.updateStage as jest.Mock).mock
      .invocationCallOrder[0] as number
    const createOrder = (planRunRepository.create as jest.Mock).mock
      .invocationCallOrder[0] as number
    expect(abandonOrder).toBeLessThan(createOrder)
    expect(result.id).toBe('run-new')
  })
})

describe('planRunService.confirmGate', () => {
  it('gate confirm advances stage and records humanConfirmedOutput', async () => {
    // A run parked at the first gate: confirming persists humanConfirmedOutput
    // on the CLUSTER record and advances CLUSTERS_READY → ALIGNING.
    ;(planRunRepository.findById as jest.Mock).mockResolvedValue(
      run({ stage: 'CLUSTERS_READY' })
    )
    ;(planRunRepository.updateStage as jest.Mock).mockResolvedValue(
      run({ stage: 'ALIGNING' })
    )

    const result = await planRunService.confirmGate({
      planRunId: 'run-1',
      humanConfirmedOutput: { clusters: ['a', 'b'] },
      confirmedBy: 'm1',
    })

    expect(planRunRepository.confirmStageRecord).toHaveBeenCalledWith(
      'run-1',
      'CLUSTER',
      expect.objectContaining({
        humanConfirmedOutput: { clusters: ['a', 'b'] },
        confirmedBy: 'm1',
      })
    )
    expect(planRunRepository.updateStage).toHaveBeenCalledWith(
      'run-1',
      'ALIGNING'
    )
    expect(result.stage).toBe('ALIGNING')

    // An illegal transition — confirming when no gate is open (still CLUSTERING)
    // — is rejected and touches no stage record.
    jest.clearAllMocks()
    ;(planRunRepository.findById as jest.Mock).mockResolvedValue(
      run({ stage: 'CLUSTERING' })
    )
    await expect(
      planRunService.confirmGate({
        planRunId: 'run-1',
        humanConfirmedOutput: {},
        confirmedBy: 'm1',
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(planRunRepository.confirmStageRecord).not.toHaveBeenCalled()
    expect(planRunRepository.updateStage).not.toHaveBeenCalled()
  })
})

describe('planRunService.getActiveRun', () => {
  it('returns the team active run (non-terminal stages only)', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(planRunRepository.findActiveByTeam as jest.Mock).mockResolvedValue(
      run({ stage: 'ALIGNING' })
    )

    const result = await planRunService.getActiveRun({ workspaceId: 'w1' })

    expect(result?.stage).toBe('ALIGNING')
    // Terminal stages are excluded — an active run is one still in flight.
    expect(planRunRepository.findActiveByTeam).toHaveBeenCalledWith('team-1', [
      'MATERIALIZED',
      'ABANDONED',
    ])
  })

  it('returns null when the team has no active run', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
    ;(planRunRepository.findActiveByTeam as jest.Mock).mockResolvedValue(null)

    const result = await planRunService.getActiveRun({ workspaceId: 'w1' })

    expect(result).toBeNull()
  })

  it('throws 404 when the workspace has no default team', async () => {
    ;(getDefaultTeam as jest.Mock).mockResolvedValue(null)

    await expect(
      planRunService.getActiveRun({ workspaceId: 'w1' })
    ).rejects.toMatchObject({ status: 404 })
    expect(planRunRepository.findActiveByTeam).not.toHaveBeenCalled()
  })
})

describe('planRunService.recordStageOutput', () => {
  it('failed stage retry overwrites the stage record', async () => {
    // The CLUSTER segment failed; retrying re-runs it. recordStageOutput
    // upserts on (planRunId, kind) — the overwrite-capable path — so the run's
    // single CLUSTER record is replaced, never duplicated, and the run
    // re-enters CLUSTERS_READY.
    ;(planRunRepository.findById as jest.Mock).mockResolvedValue(
      run({ stage: 'FAILED' })
    )
    ;(planRunRepository.updateStage as jest.Mock).mockResolvedValue(
      run({ stage: 'CLUSTERS_READY' })
    )

    const output = {
      model: 'claude-sonnet-5',
      promptTokens: 10,
      outputTokens: 20,
      llmInput: 'ideas…',
      llmRawOutput: { clusters: [] },
    }
    const result = await planRunService.recordStageOutput({
      planRunId: 'run-1',
      kind: 'CLUSTER',
      output,
    })

    expect(planRunRepository.upsertStageRecord).toHaveBeenCalledWith(
      'run-1',
      'CLUSTER',
      output
    )
    // Not a create — the unique (planRunId, kind) upsert overwrites in place.
    expect(planRunRepository.upsertStageRecord).toHaveBeenCalledTimes(1)
    expect(planRunRepository.updateStage).toHaveBeenCalledWith(
      'run-1',
      'CLUSTERS_READY'
    )
    expect(result.stage).toBe('CLUSTERS_READY')
  })
})
