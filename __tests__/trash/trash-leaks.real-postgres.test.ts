/**
 * @jest-environment node
 *
 * LUM-923 — reads the LUM-918 soft-delete extension does not cover (relation
 * reads, `_count`, relation filters, the legacy stdio MCP's own client) must
 * still leave trashed tasks out. Real Postgres (every migration replayed into
 * PGlite), read through the same extension the production client carries.
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

import { sessionRepository } from '@/lib/repositories/session.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { trashTask } from '@/mcp/trash'

jest.setTimeout(180_000)

const WS = 'ws_leak'
const MEMBER = 'm_leak'
const TRASHED_AT = new Date('2026-09-30T00:00:00.000Z')

async function seed() {
  const db = harness.prisma!
  await db.workspace.create({ data: { id: WS, name: 'Leak', slug: WS } })
  await db.workspaceMember.create({
    data: { id: MEMBER, workspaceId: WS, clerkId: 'clerk_leak', role: 'OWNER' },
  })
  await db.team.create({
    data: { id: 'team_leak', workspaceId: WS, name: 'Eng', identifier: 'LK' },
  })
  await db.project.create({
    data: {
      id: 'proj_leak',
      workspaceId: WS,
      teamId: 'team_leak',
      createdByMemberId: MEMBER,
      name: 'P',
    },
  })
  await db.milestone.create({
    data: { id: 'ms_leak', projectId: 'proj_leak', name: 'M1', slug: 'm1' },
  })
  const task = (id: string, number: number, deletedAt: Date | null) =>
    db.task.create({
      data: {
        id,
        number,
        title: `Task ${id}`,
        projectId: 'proj_leak',
        teamId: 'team_leak',
        milestoneId: 'ms_leak',
        deletedAt,
      },
    })
  await task('t_live', 1, null)
  await task('t_trashed', 2, TRASHED_AT)
  await task('t_mcp_root', 3, null)
  await task('t_mcp_other', 4, null)

  await db.tag.create({
    data: { id: 'tag_leak', name: 'bug', workspaceId: WS },
  })
  await db.taskTag.createMany({
    data: [
      { taskId: 't_live', tagId: 'tag_leak' },
      { taskId: 't_trashed', tagId: 'tag_leak' },
    ],
  })

  const pr = (taskId: string, number: number) =>
    db.pullRequest.create({
      data: {
        workspaceId: WS,
        taskId,
        repo: 'o/r',
        number,
        title: `PR ${number}`,
        url: `https://github.com/o/r/pull/${number}`,
        state: 'merged',
        authorLogin: 'dev',
        headBranch: `b${number}`,
        baseBranch: 'main',
      },
    })
  await pr('t_live', 1)
  await pr('t_trashed', 2)

  const session = (id: string, taskId: string) =>
    db.session.create({
      data: {
        id,
        workspaceId: WS,
        workspaceMemberId: MEMBER,
        taskId,
        lastActivityAt: TRASHED_AT,
      },
    })
  await session('s_live', 't_live')
  await session('s_trashed', 't_trashed')
}

beforeAll(async () => {
  await harness.start()
  holder.client = withSoftDelete(harness.prisma!)
  await seed()
})

afterAll(async () => {
  await harness.stop()
})

describe('LUM-923 trash leak: relation reads skip trashed tasks', () => {
  it('LUM-923 trash leak: a session bound to a trashed task reads as unbound at session start', async () => {
    expect(await sessionRepository.findTaskBinding('s_live')).toMatchObject({
      bound: true,
      taskIdentifier: 'LK-1',
    })
    expect(await sessionRepository.findTaskBinding('s_trashed')).toEqual({
      bound: false,
    })
  })

  it('LUM-923 trash leak: the crossing gate knows a trashed task, and only a trashed one', async () => {
    expect(await taskRepository.isTrashed('t_trashed')).toBe(true)
    expect(await taskRepository.isTrashed('t_live')).toBe(false)
    expect(await taskRepository.isTrashed('no_such_task')).toBe(false)
  })

  it('LUM-923 trash leak: tag usage counts leave out trashed tasks', async () => {
    const tags = await tagRepository.findByWorkspace(WS)
    expect(tags.find(t => t.id === 'tag_leak')?._count.taskTags).toBe(1)
  })

  it('LUM-923 trash leak: the milestone merged-PR baseline leaves out trashed tasks', async () => {
    expect(
      await pullRequestRepository.countMergedByMilestones(['ms_leak'])
    ).toEqual([{ milestoneId: 'ms_leak', count: 1 }])
  })

  it('LUM-923 trash leak: the legacy MCP delete moves the task — alone (LUM-959) — to the trash', async () => {
    const db = holder.client!
    await trashTask(db, 't_mcp_root', 'clerk_leak')

    const rows = await harness.prisma!.task.findMany({
      where: { id: { in: ['t_mcp_root', 't_mcp_other'] } },
      select: {
        id: true,
        deletedAt: true,
        trashRootId: true,
        deletedByClerkId: true,
      },
      orderBy: { id: 'asc' },
    })
    expect(rows).toHaveLength(2)
    const root = rows.find(r => r.id === 't_mcp_root')
    expect(root).toMatchObject({
      deletedByClerkId: 'clerk_leak',
      trashRootId: null,
    })
    expect(root?.deletedAt).not.toBeNull()
    expect(rows.find(r => r.id === 't_mcp_other')?.deletedAt).toBeNull()

    // The legacy MCP lists through the soft-delete client: gone from lists.
    const listed = await db.task.findMany({
      where: { team: { workspaceId: WS } },
      select: { id: true },
    })
    expect(listed.map(t => t.id).sort()).toEqual(['t_live', 't_mcp_other'])
  })
})
