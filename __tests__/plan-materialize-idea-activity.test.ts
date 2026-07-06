/** @jest-environment node */
// LUM-680: plan-run materialisation records a STATUS_CHANGED(->PLANNED) idea
// activity for each consumed idea, INSIDE the materialise transaction — so a
// mid-write failure rolls the activity back with the status flip. Drives the
// real repository with only prisma mocked (same style as the materialise
// service test).
jest.mock('@/lib/db/prisma', () => {
  const tx = {
    initiative: { aggregate: jest.fn(), create: jest.fn() },
    team: { update: jest.fn() },
    task: { create: jest.fn() },
    idea: { updateMany: jest.fn() },
    ideaActivity: { createMany: jest.fn() },
    planRunStageRecord: { update: jest.fn() },
    planRun: { update: jest.fn() },
  }
  const prisma = {
    __tx: tx,
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  }
  return { prisma }
})

import { planMaterializeRepository } from '@/lib/repositories/plan-materialize.repository'
import { prisma } from '@/lib/db/prisma'

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

const PLAN = {
  planRunId: 'run-1',
  teamId: 'team-1',
  workspaceId: 'w1',
  projectId: 'proj-1',
  proseDocument: 'the plan',
  confirmedBy: 'm1',
  humanConfirmedOutput: {},
  initiatives: [
    {
      goalStatement: 'Ship idea comments',
      assumptionNote: null,
      ideaIds: ['idea-a', 'idea-b'],
      tasks: [],
    },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  tx.initiative.aggregate.mockResolvedValue({ _max: { number: 0 } })
  tx.initiative.create.mockResolvedValue({
    id: 'init-1',
    number: 1,
    name: 'Ship idea comments',
  })
  tx.idea.updateMany.mockResolvedValue({ count: 2 })
  tx.ideaActivity.createMany.mockResolvedValue({ count: 2 })
  tx.planRunStageRecord.update.mockResolvedValue({})
  tx.planRun.update.mockResolvedValue({})
})

describe('materialization records idea activity atomically', () => {
  it('writes a STATUS_CHANGED(->PLANNED) activity per consumed idea, carrying the run + initiative', async () => {
    await planMaterializeRepository.materialize(PLAN)

    expect(tx.ideaActivity.createMany).toHaveBeenCalledTimes(1)
    expect(tx.ideaActivity.createMany).toHaveBeenCalledWith({
      data: [
        {
          ideaId: 'idea-a',
          actorId: null,
          type: 'STATUS_CHANGED',
          payload: {
            to: 'PLANNED',
            planRunId: 'run-1',
            initiativeId: 'init-1',
          },
        },
        {
          ideaId: 'idea-b',
          actorId: null,
          type: 'STATUS_CHANGED',
          payload: {
            to: 'PLANNED',
            planRunId: 'run-1',
            initiativeId: 'init-1',
          },
        },
      ],
    })
  })

  it('is written inside the same transaction — a later failure rejects the whole materialisation', async () => {
    // The idea status flip + its activity both run before this throws.
    tx.planRun.update.mockRejectedValue(new Error('db down'))

    await expect(planMaterializeRepository.materialize(PLAN)).rejects.toThrow(
      'db down'
    )

    // The activity write happened within the transaction callback that then
    // threw — in Postgres the whole tx (status flip + activity) rolls back.
    expect(tx.ideaActivity.createMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
  })

  it('records no idea activity when an initiative consumes no ideas', async () => {
    await planMaterializeRepository.materialize({
      ...PLAN,
      initiatives: [
        {
          goalStatement: 'Empty',
          assumptionNote: null,
          ideaIds: [],
          tasks: [],
        },
      ],
    })
    expect(tx.ideaActivity.createMany).not.toHaveBeenCalled()
  })
})
