/**
 * @jest-environment node
 *
 * LUM-918 — the trash purge against a REAL Postgres (FK cascades and the
 * document tree's non-cascading parent FK are the database's answer): the
 * daily cron hard-deletes only what has been in the trash for 30 days, and
 * "delete permanently" hard-deletes one item at once.
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
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import {
  trashService,
  TRASH_RETENTION_DAYS,
} from '@/lib/services/trash.service'

jest.setTimeout(180_000)

const WS = 'ws_purge'
const MEMBER = 'm_purge'
const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-01T00:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY)

let nextNumber = 0

async function seedBase() {
  const db = harness.prisma!
  await db.workspace.create({ data: { id: WS, name: 'Purge WS', slug: WS } })
  await db.workspaceMember.create({
    data: {
      id: MEMBER,
      workspaceId: WS,
      clerkId: 'clerk_purge',
      role: 'OWNER',
    },
  })
  await db.team.create({
    data: { id: 'team_purge', workspaceId: WS, name: 'Eng', identifier: 'PG' },
  })
  await db.project.create({
    data: {
      id: 'proj_purge',
      workspaceId: WS,
      teamId: 'team_purge',
      createdByMemberId: MEMBER,
      name: 'Purge project',
    },
  })
}

async function task(id: string, parentTaskId?: string) {
  await harness.prisma!.task.create({
    data: {
      id,
      number: ++nextNumber,
      title: id,
      projectId: 'proj_purge',
      teamId: 'team_purge',
      ...(parentTaskId ? { parentTaskId } : {}),
    },
  })
  await harness.prisma!.comment.create({ data: { taskId: id, body: 'c' } })
}

async function doc(id: string, parentId?: string) {
  await harness.prisma!.document.create({
    data: {
      id,
      number: ++nextNumber,
      slug: id,
      title: id,
      workspaceId: WS,
      createdById: MEMBER,
      ...(parentId ? { parentId } : {}),
    },
  })
  await harness.prisma!.documentShare.create({
    data: { documentId: id, memberId: MEMBER, role: 'EDITOR' },
  })
}

const taskExists = async (id: string) =>
  (await harness.prisma!.task.count({ where: { id } })) === 1
const docExists = async (id: string) =>
  (await harness.prisma!.document.count({ where: { id } })) === 1

beforeAll(async () => {
  await harness.start()
  holder.client = withSoftDelete(harness.prisma!)
  await seedBase()

  await task('old_parent')
  await task('old_child', 'old_parent')
  await task('young')
  await doc('old_doc')
  await doc('old_doc_child', 'old_doc')
  await doc('old_doc_grandchild', 'old_doc_child')
  await doc('young_doc')

  await trashService.trashTask('old_parent', 'clerk_purge', daysAgo(31))
  await trashService.trashTask('young', 'clerk_purge', daysAgo(29))
  await trashService.trashDocument('old_doc', 'clerk_purge', daysAgo(30))
  await trashService.trashDocument('young_doc', 'clerk_purge', daysAgo(1))
})

afterAll(async () => {
  await harness.stop()
})

describe('trash purge (30-day retention)', () => {
  it('the retention window is 30 days', () => {
    expect(TRASH_RETENTION_DAYS).toBe(30)
  })

  it('the cron hard-deletes groups 30+ days in the trash and leaves younger ones restorable', async () => {
    const out = await trashService.purgeExpired(NOW)
    expect(out.failed).toBe(0)

    expect(await taskExists('old_parent')).toBe(false)
    expect(await taskExists('old_child')).toBe(false)
    expect(
      await harness.prisma!.comment.count({
        where: { taskId: { in: ['old_parent', 'old_child'] } },
      })
    ).toBe(0)
    expect(await docExists('old_doc')).toBe(false)
    expect(await docExists('old_doc_child')).toBe(false)
    expect(await docExists('old_doc_grandchild')).toBe(false)

    expect(await taskExists('young')).toBe(true)
    expect(await docExists('young_doc')).toBe(true)
    const trash = await trashService.list(WS, MEMBER)
    expect(trash.map(i => i.id).sort()).toEqual(['young', 'young_doc'])
    expect(trash.find(i => i.id === 'young')?.purgeAt).toBe(
      new Date(daysAgo(29).getTime() + 30 * DAY).toISOString()
    )
  })

  it('"delete permanently" hard-deletes one trashed item immediately', async () => {
    await trashService.deletePermanently('task', 'young', WS, MEMBER)
    await trashService.deletePermanently('document', 'young_doc', WS, MEMBER)
    expect(await taskExists('young')).toBe(false)
    expect(await docExists('young_doc')).toBe(false)
    expect(await trashService.list(WS, MEMBER)).toEqual([])
  })

  it('"delete permanently" refuses a live task (only trashed items qualify)', async () => {
    await task('live')
    await expect(
      trashService.deletePermanently('task', 'live', WS, MEMBER)
    ).rejects.toMatchObject({ status: 404 })
    expect(await taskExists('live')).toBe(true)
  })
})
