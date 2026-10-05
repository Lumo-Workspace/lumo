/**
 * @jest-environment node
 *
 * LUM-992 — Task under data-layer workspace scoping, against a REAL Postgres
 * (every migration replayed into PGlite) read through the production
 * soft-delete extension, the way `scopedPrisma` runs in production:
 *
 *  - an unscoped Task query on `scopedPrisma` is rejected before it reaches
 *    the database;
 *  - the migrated `taskRepository` by-id methods read/write another
 *    workspace's task as missing;
 *  - every task create path writes the project's workspaceId;
 *  - a task cannot be moved into another workspace's project.
 */
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'
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
// Outbound side effects only (never on the asserted data path).
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: unknown) => {
    void Promise.resolve(p).catch(() => {})
  },
}))
jest.mock('@octokit/auth-app', () => ({ createAppAuth: jest.fn() }))

import { scopedPrisma } from '@/lib/db/workspace-scope'
import { taskRepository } from '@/lib/repositories/task.repository'
import { planMaterializeRepository } from '@/lib/repositories/plan-materialize.repository'
import { updateTask } from '@/lib/services/task-state.service'

jest.setTimeout(180_000)

const A = 'ws_task_a'
const B = 'ws_task_b'
const taskA = `task_${A}`
const taskB = `task_${B}`

async function seedWorkspace(ws: string) {
  const db = harness.prisma!
  await db.workspace.create({ data: { id: ws, name: ws, slug: ws } })
  await db.workspaceMember.create({
    data: { id: `m_${ws}`, workspaceId: ws, clerkId: `c_${ws}`, role: 'OWNER' },
  })
  await db.team.create({
    // taskSeq 1: the seeded task below already holds number 1.
    data: {
      id: `t_${ws}`,
      workspaceId: ws,
      name: 'Eng',
      identifier: 'TS',
      taskSeq: 1,
    },
  })
  for (const p of ['1', '2']) {
    await db.project.create({
      data: {
        id: `p${p}_${ws}`,
        workspaceId: ws,
        teamId: `t_${ws}`,
        createdByMemberId: `m_${ws}`,
        name: `Project ${p} ${ws}`,
      },
    })
  }
  await db.task.create({
    data: {
      id: `task_${ws}`,
      projectId: `p1_${ws}`,
      workspaceId: ws,
      teamId: `t_${ws}`,
      number: 1,
      title: `Task ${ws}`,
      description: `desc ${ws}`,
    },
  })
}

async function rawTask(id: string) {
  return harness.prisma!.task.findUnique({
    where: { id },
    select: { title: true, status: true, projectId: true, workspaceId: true },
  })
}

beforeAll(async () => {
  await harness.start()
  holder.client = withSoftDelete(harness.prisma!)
  await seedWorkspace(A)
  await seedWorkspace(B)
})

afterAll(async () => {
  await harness.stop()
})

describe('scopedPrisma checks Task', () => {
  it('rejects a deliberately unscoped Task query', async () => {
    await expect(
      scopedPrisma.task.findUnique({ where: { id: taskB } })
    ).rejects.toMatchObject({ code: 'WORKSPACE_SCOPE_MISSING' })
    await expect(scopedPrisma.task.findMany({})).rejects.toMatchObject({
      code: 'WORKSPACE_SCOPE_MISSING',
    })
    await expect(
      scopedPrisma.task.update({ where: { id: taskB }, data: { title: 'x' } })
    ).rejects.toMatchObject({ code: 'WORKSPACE_SCOPE_MISSING' })
    expect((await rawTask(taskB))?.title).toBe(`Task ${B}`)
  })

  it('a scoped by-id findUnique reads a foreign id as missing', async () => {
    await expect(
      scopedPrisma.task.findUnique({ where: { id: taskB, workspaceId: A } })
    ).resolves.toBeNull()
    await expect(
      scopedPrisma.task.findUnique({
        where: { id: taskA, workspaceId: A },
        select: { id: true },
      })
    ).resolves.toEqual({ id: taskA })
  })
})

describe('migrated taskRepository by-id methods', () => {
  it('reads a foreign task id as missing', async () => {
    await expect(taskRepository.findForUpdate(taskB, A)).resolves.toBeNull()
    await expect(taskRepository.findStatus(taskB, A)).resolves.toBeNull()
    await expect(taskRepository.findForAgent(taskB, A)).resolves.toBeNull()
    await expect(taskRepository.findDescription(taskB, A)).resolves.toBeNull()
    await expect(
      taskRepository.findManyForUpdate([taskA, taskB], A)
    ).resolves.toEqual(
      new Map([[taskA, expect.objectContaining({ id: taskA })]])
    )
    await expect(
      taskRepository.findByIdForMention(taskB, A)
    ).resolves.toBeNull()
    // The owning workspace still reads it.
    expect((await taskRepository.findForUpdate(taskB, B))?.id).toBe(taskB)
    expect(await taskRepository.findStatus(taskB, B)).toEqual({
      status: 'TODO',
    })
  })

  it('cannot write or delete a foreign task', async () => {
    await expect(
      taskRepository.update(taskB, A, { title: 'hijacked' })
    ).rejects.toMatchObject({ code: 'P2025' })
    await expect(
      taskRepository.updateSpec(taskB, A, 'hijacked')
    ).rejects.toMatchObject({ code: 'P2025' })
    await expect(
      taskRepository.clearAgentError(taskB, A)
    ).rejects.toMatchObject({ code: 'P2025' })
    await expect(
      taskRepository.updateSprint(taskB, A, null)
    ).rejects.toMatchObject({ code: 'P2025' })
    await expect(taskRepository.delete(taskB, A)).rejects.toMatchObject({
      code: 'P2025',
    })
    expect(await rawTask(taskB)).toMatchObject({ title: `Task ${B}` })
  })

  it('identifier and workspace list reads stay inside the workspace', async () => {
    // Both workspaces share the team identifier `TS`.
    const own = await taskRepository.findByWorkspaceIdentifier(A, 'TS', 1)
    expect(own?.id).toBe(taskA)
    const list = await taskRepository.findByWorkspaceWithFilters(A)
    expect(list.map(t => t.id)).toEqual([taskA])
    const mentions = await taskRepository.findManyForMentionStatus(A, [
      { prefix: 'TS', number: 1 },
    ])
    expect(mentions).toHaveLength(1)
  })
})

describe('task create paths write the project workspaceId', () => {
  it('createWithSequence (web, CLI/API, MCP, Slack, quick dispatch)', async () => {
    const created = await taskRepository.createWithSequence({
      workspaceId: A,
      projectId: `p2_${A}`,
      teamId: `t_${A}`,
      title: 'created through createWithSequence',
      description: null,
      status: 'TODO',
      priority: 'LOW',
      assigneeActorId: null,
      agentStatus: null,
      order: undefined,
      dueDate: null,
    })
    expect(created.workspaceId).toBe(A)
    expect((await rawTask(created.id))?.workspaceId).toBe(A)
  })

  it('plan-run materialize (gate C)', async () => {
    await harness.insert('plan_runs', {
      id: 'run_a',
      teamId: `t_${A}`,
      workspaceId: A,
      startedByMemberId: `m_${A}`,
      stage: 'DRAFT_READY',
    })
    await harness.insert('plan_run_stage_records', {
      id: 'stage_a',
      planRunId: 'run_a',
      kind: 'GENERATE',
    })
    const result = await planMaterializeRepository.materialize({
      planRunId: 'run_a',
      teamId: `t_${A}`,
      workspaceId: A,
      projectId: `p1_${A}`,
      proseDocument: 'plan',
      confirmedBy: `m_${A}`,
      humanConfirmedOutput: {},
      initiatives: [
        {
          goalStatement: 'goal',
          assumptionNote: null,
          ideaIds: [],
          tasks: [
            { title: 'materialized 1', description: 'why 1', sizeHint: 'S' },
            { title: 'materialized 2', description: 'why 2', sizeHint: 'M' },
          ],
        },
      ],
    })
    const ids = result.initiatives[0]!.taskIds
    expect(ids).toHaveLength(2)
    for (const id of ids) expect((await rawTask(id))?.workspaceId).toBe(A)
  })
})

describe('moving a task between projects', () => {
  it('updateTask refuses another workspace project and leaves the task', async () => {
    await expect(
      updateTask(taskA, A, { projectId: `p1_${B}` })
    ).rejects.toMatchObject({ status: 400 })
    expect(await rawTask(taskA)).toMatchObject({
      projectId: `p1_${A}`,
      workspaceId: A,
    })
  })

  it('updateTask moves within the workspace and keeps workspaceId', async () => {
    await updateTask(taskA, A, { projectId: `p2_${A}` })
    expect(await rawTask(taskA)).toMatchObject({
      projectId: `p2_${A}`,
      workspaceId: A,
    })
  })

  it('updateTask on another workspace task reads as missing', async () => {
    await expect(
      updateTask(taskB, A, { title: 'hijacked' })
    ).rejects.toMatchObject({ status: 404 })
    expect((await rawTask(taskB))?.title).toBe(`Task ${B}`)
  })

  // Last on purpose: a statement the database rejects drops the pooled
  // connection, which the single-session PGlite server is slow to notice.
  // (The guard trigger itself is covered in task-workspace-id-migration.)
  it('the database refuses a cross-workspace move even without the app checks', async () => {
    await expect(
      harness.query(`update tasks set "projectId" = $1 where id = $2`, [
        `p1_${A}`,
        taskB,
      ])
    ).rejects.toThrow(/does not match its project/)
  })
})
