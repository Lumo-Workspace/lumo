/**
 * @jest-environment node
 *
 * LUM-918 — the task / document trash against a REAL Postgres (every
 * migration replayed into PGlite), through the same soft-delete extension the
 * production client uses. A trashed task or document (with its subtasks /
 * sub-pages) must drop out of every read that lists, searches, resolves or
 * feeds it to AI context — and come back whole on restore.
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

import { taskRepository } from '@/lib/repositories/task.repository'
import { documentRepository } from '@/lib/repositories/document.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { taskDependencyRepository } from '@/lib/repositories/task-dependency.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { trashService } from '@/lib/services/trash.service'

jest.setTimeout(180_000)

const WS = 'ws_trash'
const MEMBER = 'm_trash'
const ACTOR = 'a_trash'

async function seed() {
  const db = harness.prisma!
  await db.workspace.create({ data: { id: WS, name: 'Trash WS', slug: WS } })
  await db.workspaceMember.create({
    data: {
      id: MEMBER,
      workspaceId: WS,
      clerkId: 'clerk_trash',
      role: 'OWNER',
    },
  })
  await db.actor.create({
    data: { id: ACTOR, workspaceId: WS, type: 'HUMAN', memberId: MEMBER },
  })
  await db.team.create({
    data: { id: 'team_trash', workspaceId: WS, name: 'Eng', identifier: 'TR' },
  })
  await db.project.create({
    data: {
      id: 'proj_trash',
      workspaceId: WS,
      teamId: 'team_trash',
      createdByMemberId: MEMBER,
      name: 'Trash project',
    },
  })
  const task = (
    id: string,
    number: number,
    title: string,
    parentTaskId?: string
  ) =>
    db.task.create({
      data: {
        id,
        number,
        title,
        projectId: 'proj_trash',
        teamId: 'team_trash',
        assigneeActorId: ACTOR,
        ...(parentTaskId ? { parentTaskId } : {}),
      },
    })
  await task('t_parent', 1, 'Zebra parent task')
  await task('t_child', 2, 'Zebra child subtask', 't_parent')
  await task('t_grandchild', 3, 'Zebra grandchild', 't_child')
  await task('t_other', 4, 'Unrelated live task')
  await db.comment.create({
    data: { taskId: 't_parent', body: '<p>keep me</p>' },
  })
  await db.taskDependency.create({
    data: {
      workspaceId: WS,
      blockedTaskId: 't_other',
      blockingTaskId: 't_parent',
      status: 'CONFIRMED',
      kind: 'BLOCKS',
      source: 'MANUAL',
    },
  })

  const doc = (id: string, number: number, title: string, parentId?: string) =>
    db.document.create({
      data: {
        id,
        number,
        slug: `${id}-slug`,
        title,
        content: `<p>${title} body</p>`,
        workspaceId: WS,
        createdById: MEMBER,
        visibility: 'WORKSPACE',
        ...(parentId ? { parentId } : {}),
      },
    })
  await doc('d_parent', 1, 'Quokka parent doc')
  await doc('d_child', 2, 'Quokka child page', 'd_parent')
  await doc('d_other', 3, 'Unrelated live doc')
  await db.documentMention.create({
    data: { documentId: 'd_parent', taskId: 't_other' },
  })
}

const ids = (rows: { id: string }[]) => rows.map(r => r.id).sort()

async function visibleTaskReads() {
  const byWorkspace = await taskRepository.findByWorkspaceWithFilters(WS)
  const search = await taskRepository.findByWorkspaceWithFilters(WS, {
    q: 'zebra',
  })
  const assigned = await taskRepository.findAssignedTasks(ACTOR)
  const byIdentifier = await taskRepository.findByWorkspaceIdentifier(
    WS,
    'TR',
    1
  )
  const byId = await taskRepository.findById('t_parent')
  const memoryContext = await taskRepository.findForMemoryContext('t_child')
  const other = assigned.find(t => t.id === 't_other')
  const deps = await taskDependencyRepository.findEdgesForTask('t_other')
  const nextEdges =
    await taskDependencyRepository.findConfirmedBlocksEdgesTouching(['t_other'])
  const projects = await projectRepository.findByWorkspace(WS, MEMBER)
  return {
    byWorkspace: ids(byWorkspace),
    search: ids(search),
    assigned: ids(assigned),
    byIdentifier: byIdentifier?.id ?? null,
    byId: byId?.id ?? null,
    memoryContext: memoryContext ? 'found' : null,
    otherChildren: other?._count.children ?? 0,
    deps: deps.length,
    nextEdges: nextEdges.length,
    projectTaskCount: projects[0]?._count.tasks ?? -1,
  }
}

async function visibleDocReads() {
  const list = await documentRepository.findByWorkspace(WS, MEMBER)
  const tree = await documentRepository.findTreeNodes({ workspaceId: WS })
  const byId = await documentRepository.findById('d_parent', WS)
  const bySlug = await documentRepository.findWithPermission(
    'd_child-slug',
    MEMBER,
    WS
  )
  // AI context: documents mentioning a task are rendered into task context.
  const aiContext = await miscRepository.findDocumentsForContext(
    't_other',
    WS,
    MEMBER
  )
  return {
    list: ids(list),
    tree: ids(tree),
    byId: byId?.id ?? null,
    bySlug: bySlug?.id ?? null,
    aiContext: aiContext.length,
  }
}

beforeAll(async () => {
  await harness.start()
  holder.client = withSoftDelete(harness.prisma!)
  await seed()
})

afterAll(async () => {
  await harness.stop()
})

describe('task trash on a real Postgres', () => {
  it('a deleted task and its subtasks vanish from lists, search, lookups, next and context', async () => {
    const before = await visibleTaskReads()
    expect(before.byWorkspace).toEqual([
      't_child',
      't_grandchild',
      't_other',
      't_parent',
    ])
    expect(before.search).toEqual(['t_child', 't_grandchild', 't_parent'])
    expect(before.deps).toBe(1)
    expect(before.nextEdges).toBe(1)
    expect(before.projectTaskCount).toBe(4)

    const moved = await trashService.trashTask('t_parent', 'clerk_trash')
    expect(moved).toBe(2) // child + grandchild went with it

    const after = await visibleTaskReads()
    expect(after).toEqual({
      byWorkspace: ['t_other'],
      search: [],
      assigned: ['t_other'],
      byIdentifier: null,
      byId: null,
      memoryContext: null,
      otherChildren: 0,
      deps: 0,
      nextEdges: 0,
      projectTaskCount: 1,
    })

    const trash = await trashService.list(WS, MEMBER)
    const entry = trash.find(i => i.id === 't_parent')
    expect(entry).toMatchObject({
      kind: 'task',
      label: 'TR-1',
      descendantCount: 2,
    })
    expect(trash.some(i => i.id === 't_child')).toBe(false)
  })

  it('restore brings the whole group back with its comments', async () => {
    await trashService.restore('task', 't_parent', WS, MEMBER)

    const after = await visibleTaskReads()
    expect(after.byWorkspace).toEqual([
      't_child',
      't_grandchild',
      't_other',
      't_parent',
    ])
    expect(after.byIdentifier).toBe('t_parent')
    expect(after.deps).toBe(1)

    const db = harness.prisma!
    expect(await db.comment.count({ where: { taskId: 't_parent' } })).toBe(1)
    const child = await db.task.findUnique({ where: { id: 't_child' } })
    expect(child).toMatchObject({
      parentTaskId: 't_parent',
      deletedAt: null,
      trashRootId: null,
    })
    expect(await trashService.list(WS, MEMBER)).toEqual([])
  })

  it('restoring a subtask whose parent is still in the trash brings it back top-level', async () => {
    await trashService.trashTask('t_child', 'clerk_trash')
    await trashService.trashTask('t_parent', 'clerk_trash')
    await trashService.restore('task', 't_child', WS, MEMBER)

    const child = await harness.prisma!.task.findUnique({
      where: { id: 't_child' },
    })
    expect(child).toMatchObject({ deletedAt: null, parentTaskId: null })
    const grandchild = await taskRepository.findById('t_grandchild')
    expect(grandchild?.id).toBe('t_grandchild')

    await trashService.restore('task', 't_parent', WS, MEMBER)
  })
})

describe('document trash on a real Postgres', () => {
  it('a deleted document and its sub-pages vanish from lists, tree, lookups and AI context', async () => {
    const before = await visibleDocReads()
    expect(before.list).toEqual(expect.arrayContaining(['d_parent', 'd_other']))
    expect(before.tree).toEqual(['d_child', 'd_other', 'd_parent'])
    expect(before.aiContext).toBe(1)

    await trashService.trashDocument('d_parent', 'clerk_trash')

    const after = await visibleDocReads()
    expect(after).toEqual({
      list: ['d_other'],
      tree: ['d_other'],
      byId: null,
      bySlug: null,
      aiContext: 0,
    })
  })

  it('restore brings the document and its sub-pages back', async () => {
    await trashService.restore('document', 'd_parent', WS, MEMBER)
    const after = await visibleDocReads()
    expect(after.tree).toEqual(['d_child', 'd_other', 'd_parent'])
    expect(after.byId).toBe('d_parent')
    expect(after.bySlug).toBe('d_child')
    expect(after.aiContext).toBe(1)
  })

  it("another member cannot see or restore someone else's trashed document", async () => {
    await trashService.trashDocument('d_other', 'clerk_trash')
    expect(
      (await trashService.list(WS, 'someone_else')).some(
        i => i.id === 'd_other'
      )
    ).toBe(false)
    await expect(
      trashService.restore('document', 'd_other', WS, 'someone_else')
    ).rejects.toMatchObject({ status: 404 })
    await trashService.restore('document', 'd_other', WS, MEMBER)
  })
})

describe('trash is scoped to its workspace', () => {
  const WS2 = 'ws_trash_other'
  const MEMBER2 = 'm_trash_other'

  beforeAll(async () => {
    const db = harness.prisma!
    await db.workspace.create({
      data: { id: WS2, name: 'Other WS', slug: WS2 },
    })
    await db.workspaceMember.create({
      data: {
        id: MEMBER2,
        workspaceId: WS2,
        clerkId: 'clerk_other',
        role: 'OWNER',
      },
    })
  })

  const stillTrashed = async (kind: 'task' | 'document', id: string) => {
    const db = harness.prisma!
    const row =
      kind === 'task'
        ? await db.task.findUnique({ where: { id } })
        : await db.document.findUnique({ where: { id } })
    return row !== null && row.deletedAt !== null
  }

  it('another workspace cannot list, restore or permanently delete a trashed task', async () => {
    await trashService.trashTask('t_other', 'clerk_trash')

    expect(
      (await trashService.list(WS2, MEMBER2)).some(i => i.id === 't_other')
    ).toBe(false)
    await expect(
      trashService.restore('task', 't_other', WS2, MEMBER2)
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      trashService.deletePermanently('task', 't_other', WS2, MEMBER2)
    ).rejects.toMatchObject({ status: 404 })
    expect(await stillTrashed('task', 't_other')).toBe(true)

    await trashService.restore('task', 't_other', WS, MEMBER)
  })

  it('another workspace cannot restore or permanently delete a trashed document, even with the owner member id', async () => {
    await trashService.trashDocument('d_other', 'clerk_trash')

    // Same memberId as the owner, only the workspace differs — so the
    // workspace predicate alone must refuse it.
    expect(
      (await trashService.list(WS2, MEMBER)).some(i => i.id === 'd_other')
    ).toBe(false)
    await expect(
      trashService.restore('document', 'd_other', WS2, MEMBER)
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      trashService.deletePermanently('document', 'd_other', WS2, MEMBER)
    ).rejects.toMatchObject({ status: 404 })
    expect(await stillTrashed('document', 'd_other')).toBe(true)

    await trashService.restore('document', 'd_other', WS, MEMBER)
  })
})
