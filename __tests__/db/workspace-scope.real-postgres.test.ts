/**
 * @jest-environment node
 *
 * LUM-979 — the workspace-scope extension against a REAL Postgres (every
 * migration replayed into PGlite), layered over the production soft-delete
 * extension exactly as `scopedPrisma` is in production. A query on a
 * directly-scoped model that does not pin a workspace must be rejected before
 * it reaches the database; a scoped by-id lookup must stay one `findUnique`
 * that reads another workspace's id as missing.
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

import { scopedPrisma, unscoped } from '@/lib/db/workspace-scope'
import { projectRepository } from '@/lib/repositories/project.repository'
import { documentRepository } from '@/lib/repositories/document.repository'
import { taskRepository } from '@/lib/repositories/task.repository'

jest.setTimeout(180_000)

const A = 'ws_scope_a'
const B = 'ws_scope_b'

async function seedWorkspace(ws: string) {
  const db = harness.prisma!
  await db.workspace.create({ data: { id: ws, name: ws, slug: ws } })
  await db.workspaceMember.create({
    data: { id: `m_${ws}`, workspaceId: ws, clerkId: `c_${ws}`, role: 'OWNER' },
  })
  await db.actor.create({
    data: {
      id: `a_${ws}`,
      workspaceId: ws,
      type: 'HUMAN',
      memberId: `m_${ws}`,
    },
  })
  await db.team.create({
    data: { id: `t_${ws}`, workspaceId: ws, name: 'Eng', identifier: 'SC' },
  })
  await db.project.create({
    data: {
      id: `p_${ws}`,
      workspaceId: ws,
      teamId: `t_${ws}`,
      createdByMemberId: `m_${ws}`,
      name: `Project ${ws}`,
    },
  })
  await db.document.create({
    data: {
      id: `d_${ws}`,
      workspaceId: ws,
      createdById: `m_${ws}`,
      title: `Doc ${ws}`,
      number: 1,
      slug: `doc-${ws}-1`,
    },
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

describe('scopedPrisma against a real database', () => {
  it('rejects an unscoped query on a directly-scoped model', async () => {
    await expect(scopedPrisma.project.findMany({})).rejects.toMatchObject({
      code: 'WORKSPACE_SCOPE_MISSING',
    })
    await expect(
      scopedPrisma.document.findUnique({ where: { id: `d_${A}` } })
    ).rejects.toMatchObject({ code: 'WORKSPACE_SCOPE_MISSING' })
    // `undefined` is dropped by Prisma, so it would read every tenant.
    await expect(
      scopedPrisma.project.findMany({
        where: { workspaceId: undefined } as unknown as { workspaceId: string },
      })
    ).rejects.toMatchObject({ code: 'WORKSPACE_SCOPE_MISSING' })
  })

  it('rejects an unscoped write and leaves the row untouched', async () => {
    await expect(
      scopedPrisma.project.update({
        where: { id: `p_${B}` },
        data: { name: 'hijacked' },
      })
    ).rejects.toMatchObject({ code: 'WORKSPACE_SCOPE_MISSING' })
    const row = await harness.prisma!.project.findUnique({
      where: { id: `p_${B}` },
    })
    expect(row?.name).toBe(`Project ${B}`)
  })

  it('a scoped query runs and returns only that workspace', async () => {
    const rows = await scopedPrisma.project.findMany({
      where: { workspaceId: A },
      select: { id: true },
    })
    expect(rows).toEqual([{ id: `p_${A}` }])
  })

  it('a scoped findUnique by id (extra non-unique filter) reads a foreign id as missing', async () => {
    await expect(
      scopedPrisma.project.findUnique({
        where: { id: `p_${B}`, workspaceId: A },
      })
    ).resolves.toBeNull()
    await expect(
      scopedPrisma.project.findUnique({
        where: { id: `p_${A}`, workspaceId: A },
        select: { id: true },
      })
    ).resolves.toEqual({ id: `p_${A}` })
  })

  it('an interactive transaction opened on scopedPrisma inherits the check', async () => {
    await expect(
      scopedPrisma.$transaction(async tx => tx.project.findMany({}))
    ).rejects.toMatchObject({ code: 'WORKSPACE_SCOPE_MISSING' })
    const n = await scopedPrisma.$transaction(async tx =>
      tx.project.count({ where: { workspaceId: B } })
    )
    expect(n).toBe(1)
  })

  it('models scoped only through a relation are not checked (v1)', async () => {
    await expect(scopedPrisma.comment.findMany({})).resolves.toEqual([])
  })

  it('Task is checked directly (LUM-992)', async () => {
    await expect(scopedPrisma.task.findMany({})).rejects.toMatchObject({
      code: 'WORKSPACE_SCOPE_MISSING',
    })
  })

  it('unscoped(reason) reaches across workspaces', async () => {
    const rows = await unscoped(
      'test: cross-tenant read through the escape hatch'
    ).project.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
    expect(rows.map(r => r.id)).toEqual([`p_${A}`, `p_${B}`])
  })

  it('stays layered over the soft-delete extension', async () => {
    await harness.prisma!.document.update({
      where: { id: `d_${A}` },
      data: { deletedAt: new Date() },
    })
    try {
      await expect(
        scopedPrisma.document.findMany({ where: { workspaceId: A } })
      ).resolves.toEqual([])
    } finally {
      await harness.prisma!.document.update({
        where: { id: `d_${A}` },
        data: { deletedAt: null },
      })
    }
  })
})

describe('migrated repositories', () => {
  it('projectRepository.findById reads another workspace as missing', async () => {
    await expect(projectRepository.findById(`p_${B}`, A)).resolves.toBeNull()
    const own = await projectRepository.findById(`p_${A}`, A)
    expect(own?.id).toBe(`p_${A}`)
    expect(own?._count).toEqual({ tasks: 0, views: 0 })
  })

  it('projectRepository.update / delete cannot touch another workspace', async () => {
    await expect(
      projectRepository.update(`p_${B}`, A, { name: 'x' })
    ).rejects.toMatchObject({ code: 'P2025' })
    await expect(projectRepository.delete(`p_${B}`, A)).rejects.toMatchObject({
      code: 'P2025',
    })
    const row = await harness.prisma!.project.findUnique({
      where: { id: `p_${B}` },
    })
    expect(row?.name).toBe(`Project ${B}`)
  })

  it('projectRepository tenant-resolution lookups still resolve by id', async () => {
    await expect(projectRepository.findWorkspaceId(`p_${B}`)).resolves.toEqual({
      workspaceId: B,
    })
  })

  it('documentRepository writes are pinned to the caller workspace', async () => {
    await expect(
      documentRepository.update(`d_${B}`, A, { title: 'x' })
    ).rejects.toMatchObject({ code: 'P2025' })
    await expect(
      documentRepository.findParentId(`d_${B}`, A)
    ).resolves.toBeNull()
    await expect(documentRepository.findParentId(`d_${B}`, B)).resolves.toEqual(
      { id: `d_${B}`, parentId: null }
    )
  })

  it('taskRepository.findActorById reads another workspace actor as missing', async () => {
    await expect(taskRepository.findActorById(`a_${B}`, A)).resolves.toBeNull()
    await expect(taskRepository.findActorById(`a_${A}`, A)).resolves.toEqual({
      type: 'HUMAN',
      workspaceId: A,
    })
  })

  it('taskRepository.createWithSequence refuses a team from another workspace', async () => {
    await expect(
      taskRepository.createWithSequence({
        workspaceId: A,
        projectId: `p_${A}`,
        teamId: `t_${B}`,
        title: 'cross-tenant team',
        description: null,
        status: 'TODO',
        priority: 'LOW',
        assigneeActorId: null,
        createdByMemberId: null,
        agentStatus: null,
        order: undefined,
        dueDate: null,
      })
    ).rejects.toMatchObject({ code: 'P2025' })
    const created = await taskRepository.createWithSequence({
      workspaceId: A,
      projectId: `p_${A}`,
      teamId: `t_${A}`,
      title: 'own team',
      description: null,
      status: 'TODO',
      priority: 'LOW',
      assigneeActorId: null,
      createdByMemberId: null,
      agentStatus: null,
      order: undefined,
      dueDate: null,
    })
    expect(created.number).toBe(1)
  })
})
