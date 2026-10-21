/**
 * @jest-environment node
 *
 * LUM-1290 — sprint start/close must be all-or-nothing.
 *
 * `startAtomically` / `closeAtomically` lock the sprint row (`FOR UPDATE`) in
 * an interactive transaction. Any statement inside the callback that goes
 * through the global client instead of `tx` runs on another connection: it
 * waits on the transaction's own row lock until the timeout rolls the
 * transaction back, then autocommits. The result was a 500 with the sprint
 * flipped but its spillover, activities and retro job lost.
 *
 * Runs the real repositories against a real Postgres (PGlite). The harness
 * pool has one connection, so a stray global-client statement blocks on the
 * pool instead of the row lock — same outcome, same fix.
 */
import { createPgliteHarness } from '../scripts/test-support/pglite-harness'
import { withSoftDelete } from '@/lib/db/soft-delete'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)
const holder: { client: import('@prisma/client').PrismaClient | null } = {
  client: null,
}

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return holder.client
  },
}))

import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'

jest.setTimeout(180_000)

const fx = {
  teamId: '',
  projectId: '',
  workspaceId: '',
  actorId: '',
  taskSeq: 0,
  sprintSeq: 0,
}

beforeAll(async () => {
  await harness.start()
  holder.client = withSoftDelete(harness.prisma!)
  const db = harness.prisma!
  const ws = await db.workspace.create({
    data: { name: 'Sprint atomicity', slug: 'sprint-atomicity' },
  })
  const owner = await db.workspaceMember.create({
    data: { workspaceId: ws.id, clerkId: 'user_sprint_owner', role: 'OWNER' },
  })
  const actor = await db.actor.create({
    data: { workspaceId: ws.id, type: 'HUMAN', memberId: owner.id },
  })
  const team = await db.team.create({
    data: {
      workspaceId: ws.id,
      name: 'Core',
      identifier: 'SPR',
      isDefault: true,
      sprintsEnabled: true,
    },
  })
  const project = await db.project.create({
    data: {
      workspaceId: ws.id,
      teamId: team.id,
      createdByMemberId: owner.id,
      name: 'Core project',
    },
  })
  Object.assign(fx, {
    teamId: team.id,
    projectId: project.id,
    workspaceId: ws.id,
    actorId: actor.id,
  })
})

afterAll(async () => {
  await harness.stop()
})

afterEach(async () => {
  jest.restoreAllMocks()
  // Each case starts from a team with no ACTIVE / DRAFT sprint.
  await harness.prisma!.sprint.updateMany({
    where: { teamId: fx.teamId, status: { in: ['ACTIVE', 'DRAFT'] } },
    data: { status: 'CLOSED' },
  })
})

async function seedSprint(status: 'DRAFT' | 'ACTIVE') {
  fx.sprintSeq += 1
  return harness.prisma!.sprint.create({
    data: {
      teamId: fx.teamId,
      number: fx.sprintSeq,
      name: `Sprint ${fx.sprintSeq}`,
      status,
      startedAt: status === 'ACTIVE' ? new Date('2030-01-06') : null,
      startDate: new Date('2030-01-06T00:00:00.000Z'),
      endDate: new Date('2030-01-20T00:00:00.000Z'),
    },
  })
}

async function seedTask(sprintId: string) {
  fx.taskSeq += 1
  return harness.prisma!.task.create({
    data: {
      projectId: fx.projectId,
      workspaceId: fx.workspaceId,
      teamId: fx.teamId,
      number: fx.taskSeq,
      title: `Task ${fx.taskSeq}`,
      status: 'TODO',
      sprintId,
    },
  })
}

async function snapshot(sprintId: string, taskIds: string[]) {
  const db = harness.prisma!
  const [sprint, tasks, activities, jobs] = await Promise.all([
    db.sprint.findUniqueOrThrow({ where: { id: sprintId } }),
    db.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, sprintId: true },
      orderBy: { number: 'asc' },
    }),
    db.taskActivity.count({
      where: { taskId: { in: taskIds }, type: 'SPRINT_CHANGED' },
    }),
    db.generationJob.count({ where: { type: 'sprint', targetId: sprintId } }),
  ])
  return { status: sprint.status, tasks, activities, jobs }
}

describe('closeAtomically', () => {
  it('commits status, spillover, activities and the retro job together', async () => {
    const active = await seedSprint('ACTIVE')
    const next = await seedSprint('DRAFT')
    const toNext = await seedTask(active.id)
    const toBacklog = await seedTask(active.id)

    const closed = await sprintRepository.closeAtomically(
      active.id,
      { [toNext.id]: 'moveToNext', [toBacklog.id]: 'backToBacklog' },
      fx.actorId
    )

    expect(closed.status).toBe('CLOSED')
    expect(await snapshot(active.id, [toNext.id, toBacklog.id])).toEqual({
      status: 'CLOSED',
      tasks: [
        { id: toNext.id, sprintId: next.id },
        { id: toBacklog.id, sprintId: null },
      ],
      activities: 2,
      jobs: 1,
    })
  })

  it('leaves nothing behind when a later statement fails', async () => {
    const active = await seedSprint('ACTIVE')
    const task = await seedTask(active.id)
    jest
      .spyOn(generationJobRepository, 'createSprintPending')
      .mockRejectedValueOnce(new Error('retro job insert failed'))

    await expect(
      sprintRepository.closeAtomically(
        active.id,
        { [task.id]: 'backToBacklog' },
        fx.actorId
      )
    ).rejects.toThrow('retro job insert failed')

    expect(await snapshot(active.id, [task.id])).toEqual({
      status: 'ACTIVE',
      tasks: [{ id: task.id, sprintId: active.id }],
      activities: 0,
      jobs: 0,
    })
  })
})

describe('startAtomically', () => {
  it('flips a DRAFT sprint to ACTIVE inside the transaction', async () => {
    const draft = await seedSprint('DRAFT')

    const started = await sprintRepository.startAtomically(draft.id)

    expect(started.status).toBe('ACTIVE')
    expect(started.startedAt).toBeInstanceOf(Date)
    const row = await harness.prisma!.sprint.findUniqueOrThrow({
      where: { id: draft.id },
    })
    expect(row.status).toBe('ACTIVE')
  })

  it('refuses a second ACTIVE sprint on the team and changes nothing', async () => {
    await seedSprint('ACTIVE')
    const draft = await seedSprint('DRAFT')

    await expect(sprintRepository.startAtomically(draft.id)).rejects.toThrow(
      /already has ACTIVE sprint/
    )
    const row = await harness.prisma!.sprint.findUniqueOrThrow({
      where: { id: draft.id },
    })
    expect(row.status).toBe('DRAFT')
  })
})
