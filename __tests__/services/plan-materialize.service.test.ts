/**
 * Gate-C materialisation (LUM-671, Spec2-9). These drive the real service AND
 * the real materialisation repository, mocking only Prisma at the bottom
 * (`@/lib/db/prisma`) plus the two read repositories. So the transaction
 * structure — one `$transaction`, stage advanced INSIDE it, atomic rollback on
 * a mid-write failure — is exercised for real, not stubbed away.
 */

// ── Mocks ───────────────────────────────────────────────────────────────────
// Built inside the factory (jest.mock is hoisted above the file), then read
// back through the mocked module.
jest.mock('@/lib/db/prisma', () => {
  const tx = {
    initiative: { aggregate: jest.fn(), create: jest.fn() },
    team: { update: jest.fn() },
    task: { create: jest.fn() },
    idea: { updateMany: jest.fn() },
    ideaActivity: { createMany: jest.fn() }, // LUM-680: materialisation timeline
    planRunStageRecord: { update: jest.fn() },
    planRun: { update: jest.fn() },
  }
  const prisma = {
    __tx: tx,
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  }
  return { prisma }
})
jest.mock('@/lib/repositories/plan-run.repository', () => ({
  planRunRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findByIdSimple: jest.fn() },
}))

import { planMaterializeService } from '@/lib/services/plan-materialize.service'
import { planRunRepository } from '@/lib/repositories/plan-run.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { prisma } from '@/lib/db/prisma'
import type { MaterializePlanInput } from '@/lib/validation/plan-run'

const prismaMock = prisma as unknown as {
  __tx: {
    initiative: { aggregate: jest.Mock; create: jest.Mock }
    team: { update: jest.Mock }
    task: { create: jest.Mock }
    idea: { updateMany: jest.Mock }
    ideaActivity: { createMany: jest.Mock }
    planRunStageRecord: { update: jest.Mock }
    planRun: { update: jest.Mock }
  }
  $transaction: jest.Mock
}
const tx = prismaMock.__tx

// ── Fixtures ────────────────────────────────────────────────────────────────
const DRAFT_READY_RUN = {
  id: 'run-1',
  teamId: 'team-1',
  workspaceId: 'w1',
  stage: 'DRAFT_READY' as const,
  startedByMemberId: 'm1',
  inputIdeaIds: ['idea-a', 'idea-b', 'idea-c'],
  priorityId: null,
  prioritySnapshot: null,
  proseDocument: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

function input(over: Partial<MaterializePlanInput> = {}): MaterializePlanInput {
  return {
    projectId: 'proj-1',
    proseDocument: 'edited prose',
    drafts: [
      {
        clusterId: 'c1',
        goalStatement: 'Goal one',
        assumptionNote: 'the bet',
        ideaIds: ['idea-a', 'idea-b'],
        tasks: [
          { title: 'T1', why: 'unblocks A', size: 'S', keep: true },
          { title: 'T2', why: 'unblocks B', size: 'M', keep: true },
        ],
      },
    ],
    ...over,
  }
}

function callMaterialize(over?: Partial<MaterializePlanInput>) {
  return planMaterializeService.materialize({
    planRunId: 'run-1',
    workspaceId: 'w1',
    memberId: 'm1',
    input: input(over),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(planRunRepository.findById as jest.Mock).mockResolvedValue(DRAFT_READY_RUN)
  ;(projectRepository.findByIdSimple as jest.Mock).mockResolvedValue({
    id: 'proj-1',
    workspaceId: 'w1',
  })
  prismaMock.$transaction.mockImplementation(async cb => cb(tx))

  tx.initiative.aggregate.mockResolvedValue({ _max: { number: 4 } })
  let initSeq = 0
  tx.initiative.create.mockImplementation(async ({ data }) => ({
    id: `init-${++initSeq}`,
    number: data.number,
    name: data.name,
  }))
  let teamSeq = 100
  tx.team.update.mockImplementation(async ({ data }) => {
    teamSeq += data.taskSeq.increment
    return { taskSeq: teamSeq }
  })
  let taskSeq = 0
  tx.task.create.mockImplementation(async () => ({ id: `task-${++taskSeq}` }))
  tx.idea.updateMany.mockResolvedValue({ count: 2 })
  tx.planRunStageRecord.update.mockResolvedValue({})
  tx.planRun.update.mockResolvedValue({})
})

describe('planMaterializeService.materialize', () => {
  it('accepting a plan materializes initiative tasks and consumed ideas', async () => {
    const result = await callMaterialize()

    // One Initiative created from the accepted draft, numbered max+1.
    expect(tx.initiative.create).toHaveBeenCalledTimes(1)
    // LUM-678: the drafted goal becomes the Linear `name`, and a materialised
    // initiative starts PLANNED.
    expect(tx.initiative.create).toHaveBeenCalledWith({
      data: {
        teamId: 'team-1',
        workspaceId: 'w1',
        number: 5,
        planRunId: 'run-1',
        name: 'Goal one',
        assumptionNote: 'the bet',
        status: 'PLANNED',
      },
      select: { id: true, number: true, name: true },
    })

    // One Task per kept item, carrying initiativeId + projectId + sizeHint + why.
    expect(tx.task.create).toHaveBeenCalledTimes(2)
    expect(tx.task.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        projectId: 'proj-1',
        teamId: 'team-1',
        title: 'T1',
        description: 'unblocks A',
        status: 'TODO',
        priority: 'MEDIUM',
        initiativeId: 'init-1',
        sizeHint: 'S',
      }),
      select: { id: true },
    })
    expect(tx.task.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        title: 'T2',
        description: 'unblocks B',
        initiativeId: 'init-1',
        sizeHint: 'M',
      }),
      select: { id: true },
    })

    // Consumed ideas → PLANNED, linked to run + initiative.
    expect(tx.idea.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['idea-a', 'idea-b'] }, teamId: 'team-1' },
      data: { status: 'PLANNED', planRunId: 'run-1', initiativeId: 'init-1' },
    })

    // Human confirmation frozen onto the GENERATE stage record.
    expect(tx.planRunStageRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { planRunId_kind: { planRunId: 'run-1', kind: 'GENERATE' } },
        data: expect.objectContaining({
          confirmedBy: 'm1',
          humanConfirmedOutput: expect.objectContaining({
            prose: 'edited prose',
          }),
        }),
      })
    )

    // PlanRun advanced to MATERIALIZED with the edited prose.
    expect(tx.planRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { proseDocument: 'edited prose', stage: 'MATERIALIZED' },
    })

    expect(result.taskCount).toBe(2)
    expect(result.initiatives).toEqual([
      expect.objectContaining({
        id: 'init-1',
        number: 5,
        taskIds: ['task-1', 'task-2'],
      }),
    ])
  })

  it('materialization rolls back atomically on failure', async () => {
    // Fail partway: the second Task insert throws (not a P2002 → no retry).
    tx.task.create
      .mockImplementationOnce(async () => ({ id: 'task-1' }))
      .mockImplementationOnce(async () => {
        throw new Error('DB write failed mid-transaction')
      })

    await expect(callMaterialize()).rejects.toThrow(
      'DB write failed mid-transaction'
    )

    // Everything ran in a single transaction…
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    // …we got partway (Initiative + first Task created inside the tx)…
    expect(tx.initiative.create).toHaveBeenCalledTimes(1)
    // …but the run was NOT advanced: the stage flip is inside the same
    // transaction, so a rollback leaves the run at DRAFT_READY.
    expect(tx.planRun.update).not.toHaveBeenCalled()
    expect(tx.planRunStageRecord.update).not.toHaveBeenCalled()
  })

  it('materialized lineage links and struck tasks skipped', async () => {
    const result = await callMaterialize({
      drafts: [
        {
          clusterId: 'c1',
          goalStatement: 'Goal one',
          assumptionNote: null,
          ideaIds: ['idea-a'],
          tasks: [
            { title: 'Keep-1', why: 'w', size: 'S', keep: true },
            { title: 'Struck-1', why: 'w', size: 'M', keep: false },
          ],
        },
        {
          clusterId: 'c2',
          goalStatement: 'Goal two',
          assumptionNote: null,
          ideaIds: ['idea-b'],
          tasks: [{ title: 'Keep-2', why: 'w', size: 'L', keep: true }],
        },
        {
          // A draft with every task struck must NOT become an Initiative.
          clusterId: 'c3',
          goalStatement: 'Goal three',
          assumptionNote: null,
          ideaIds: ['idea-c'],
          tasks: [{ title: 'Struck-2', why: 'w', size: 'S', keep: false }],
        },
      ],
    })

    // Only the two drafts with a kept task materialise into Initiatives.
    expect(tx.initiative.create).toHaveBeenCalledTimes(2)

    // Struck tasks are never created — exactly the two kept ones are.
    expect(tx.task.create).toHaveBeenCalledTimes(2)
    const createdTitles = tx.task.create.mock.calls.map(
      (c: [{ data: { title: string } }]) => c[0].data.title
    )
    expect(createdTitles).toEqual(['Keep-1', 'Keep-2'])

    // Every created Task carries the initiativeId of ITS draft's initiative.
    expect(tx.task.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Keep-1',
          initiativeId: 'init-1',
        }),
      })
    )
    expect(tx.task.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Keep-2',
          initiativeId: 'init-2',
        }),
      })
    )

    // Every consumed Idea links back to its own draft's Initiative.
    expect(tx.idea.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['idea-a'] }, teamId: 'team-1' },
        data: expect.objectContaining({ initiativeId: 'init-1' }),
      })
    )
    expect(tx.idea.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['idea-b'] }, teamId: 'team-1' },
        data: expect.objectContaining({ initiativeId: 'init-2' }),
      })
    )
    // The all-struck draft's idea (idea-c) is never consumed.
    expect(tx.idea.updateMany).toHaveBeenCalledTimes(2)

    expect(result.taskCount).toBe(2)
  })

  it('rejects a run that is not DRAFT_READY with 409', async () => {
    ;(planRunRepository.findById as jest.Mock).mockResolvedValue({
      ...DRAFT_READY_RUN,
      stage: 'GENERATING',
    })
    await expect(callMaterialize()).rejects.toMatchObject({ status: 409 })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects an idea id outside the run input snapshot with 400', async () => {
    await expect(
      callMaterialize({
        drafts: [
          {
            clusterId: 'c1',
            goalStatement: 'g',
            assumptionNote: null,
            ideaIds: ['idea-a', 'idea-foreign'],
            tasks: [{ title: 'T', why: 'w', size: 'S', keep: true }],
          },
        ],
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects when no task is kept with 400', async () => {
    await expect(
      callMaterialize({
        drafts: [
          {
            clusterId: 'c1',
            goalStatement: 'g',
            assumptionNote: null,
            ideaIds: ['idea-a'],
            tasks: [{ title: 'T', why: 'w', size: 'S', keep: false }],
          },
        ],
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects a run in another workspace with 404', async () => {
    ;(planRunRepository.findById as jest.Mock).mockResolvedValue({
      ...DRAFT_READY_RUN,
      workspaceId: 'other-ws',
    })
    await expect(callMaterialize()).rejects.toMatchObject({ status: 404 })
  })
})
