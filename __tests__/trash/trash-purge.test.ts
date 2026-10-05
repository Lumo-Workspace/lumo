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

const sweep = jest.fn(async (_prefix: string) => 1)
jest.mock('@/lib/services/workspace-deletion-blob', () => ({
  deleteBlobsByPrefixInBothStores: (prefix: string) => sweep(prefix),
}))

import {
  PURGE_PAGE_SIZE,
  trashService,
  TRASH_RETENTION_DAYS,
} from '@/lib/services/trash.service'
import { trashRepository } from '@/lib/repositories/trash.repository'
import { privateFileRepository } from '@/lib/repositories/private-file.repository'

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

async function task(id: string) {
  await harness.prisma!.task.create({
    data: {
      id,
      number: ++nextNumber,
      title: id,
      projectId: 'proj_purge',
      workspaceId: WS,
      teamId: 'team_purge',
    },
  })
  await harness.prisma!.comment.create({ data: { taskId: id, body: 'c' } })
}

/**
 * Stamp `id` as a member of `rootId`'s trash group — the shape a subtask got
 * when its parent was trashed before LUM-959 removed subtasks. Such groups
 * can still sit in the trash, and must still purge as a whole.
 */
async function joinLegacyTrashGroup(id: string, rootId: string, at: Date) {
  await harness.prisma!.task.update({
    where: { id },
    data: {
      deletedAt: at,
      deletedByClerkId: 'clerk_purge',
      trashRootId: rootId,
    },
  })
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

async function testCase(taskId: string) {
  await harness.prisma!.testCase.create({
    data: {
      taskId,
      number: 1,
      title: 'tc',
      steps: ['s'],
      verification: [],
      expected: 'e',
    },
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
  await task('old_child')
  await task('young')
  await doc('old_doc')
  await doc('old_doc_child', 'old_doc')
  await doc('old_doc_grandchild', 'old_doc_child')
  await doc('young_doc')

  await trashService.trashTask('old_parent', 'clerk_purge', daysAgo(31))
  await joinLegacyTrashGroup('old_child', 'old_parent', daysAgo(31))
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

  it('trash audit: delete permanently writes one audit event per item; the cron purge and a refusal write none', async () => {
    const db = harness.prisma!
    const audited = () =>
      db.auditEvent.count({
        where: { workspaceId: WS, action: 'trash.deleted_permanently' },
      })
    const before = await audited()
    await task('au_task')
    await trashService.trashTask('au_task', 'clerk_purge', NOW)
    await task('au_live')
    await expect(
      trashService.deletePermanently('task', 'au_live', WS, MEMBER)
    ).rejects.toMatchObject({ status: 404 })
    await trashService.purgeExpired(NOW)
    expect(await audited()).toBe(before)

    await trashService.deletePermanently('task', 'au_task', WS, MEMBER, {
      actor: { type: 'MEMBER', clerkId: 'clerk_purge', memberId: MEMBER },
      source: 'WEB',
    })
    expect(await audited()).toBe(before + 1)
    const rows = await db.auditEvent.findMany({
      where: { workspaceId: WS, targetId: 'au_task' },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actorType: 'MEMBER',
      actorId: 'clerk_purge',
      actorMemberId: MEMBER,
      targetType: 'task',
      targetId: 'au_task',
      source: 'WEB',
      metadata: { kind: 'task', rowsDeleted: 1 },
    })
  })
})

describe('evidence blobs (LUM-916) follow the hard delete, not the trash', () => {
  it('moving a task to the trash keeps its evidence; the purge sweeps every task of the group that had test cases', async () => {
    await task('ev_parent')
    await task('ev_child')
    await testCase('ev_child')
    sweep.mockClear()

    await trashService.trashTask('ev_parent', 'clerk_purge', NOW)
    await joinLegacyTrashGroup('ev_child', 'ev_parent', NOW)
    expect(sweep).not.toHaveBeenCalled()

    await trashService.deletePermanently('task', 'ev_parent', WS, MEMBER)
    expect(await taskExists('ev_child')).toBe(false)
    expect(sweep.mock.calls.map(c => c[0])).toEqual(['test-evidence/ev_child/'])
  })

  it('deleting a project still finds the evidence of its trashed tasks', async () => {
    await task('pj_live')
    await testCase('pj_live')
    await task('pj_trashed')
    await testCase('pj_trashed')
    await trashService.trashTask('pj_trashed', 'clerk_purge', NOW)

    const ids =
      await privateFileRepository.findTaskIdsWithTestCasesInProject(
        'proj_purge'
      )
    expect(ids.sort()).toEqual(['pj_live', 'pj_trashed'])
  })
})

describe('LUM-923 trash purge: robust daily cron', () => {
  it('LUM-923 trash purge: both group purges run in a transaction with an explicit long timeout', async () => {
    await task('tx_task')
    await doc('tx_doc')
    await doc('tx_doc_child', 'tx_doc')
    await trashService.trashTask('tx_task', 'clerk_purge', NOW)
    await trashService.trashDocument('tx_doc', 'clerk_purge', NOW)
    const client = holder.client!
    const spy = jest.spyOn(client, '$transaction')

    await trashService.deletePermanently('task', 'tx_task', WS, MEMBER)
    await trashService.deletePermanently('document', 'tx_doc', WS, MEMBER)

    const timeouts = spy.mock.calls.map(
      c => (c[1] as { timeout?: number } | undefined)?.timeout ?? 0
    )
    spy.mockRestore()
    expect(timeouts).toHaveLength(2)
    expect(timeouts.every(t => t >= 60_000)).toBe(true)
    expect(await docExists('tx_doc_child')).toBe(false)
  })

  it('LUM-923 trash purge: expired roots are walked in pages, never loaded all at once', async () => {
    const db = harness.prisma!
    const ids = Array.from(
      { length: PURGE_PAGE_SIZE + 1 },
      (_, i) => `page_doc_${String(i).padStart(3, '0')}`
    )
    await db.document.createMany({
      data: ids.map(id => ({
        id,
        number: ++nextNumber,
        slug: id,
        title: id,
        workspaceId: WS,
        createdById: MEMBER,
        deletedAt: daysAgo(40),
      })),
    })
    const pages = jest.spyOn(trashRepository, 'findExpiredRootPage')

    const out = await trashService.purgeExpired(NOW)

    const docPages = pages.mock.calls
      .map((call, i) => ({ call, result: pages.mock.results[i]!.value }))
      .filter(p => p.call[0] === 'document')
    const firstPage = (await docPages[0]!.result) as string[]
    pages.mockRestore()
    expect(out.failed).toBe(0)
    expect(docPages.length).toBeGreaterThanOrEqual(2)
    expect(docPages.every(p => p.call[2] === PURGE_PAGE_SIZE)).toBe(true)
    // Page one is full; page two resumes after its last id.
    expect(firstPage).toHaveLength(PURGE_PAGE_SIZE)
    expect(docPages[0]!.call[3]).toBeNull()
    expect(docPages[1]!.call[3]).toBe(firstPage[PURGE_PAGE_SIZE - 1])
    expect(await db.document.count({ where: { id: { in: ids } } })).toBe(0)
  })

  it('LUM-923 trash purge: a root restored or re-trashed after the scan is left alone', async () => {
    await task('race_restored')
    await testCase('race_restored')
    await task('race_retrashed')
    await doc('race_doc')
    await trashService.trashTask('race_restored', 'clerk_purge', daysAgo(40))
    await trashService.trashTask('race_retrashed', 'clerk_purge', daysAgo(40))
    await trashService.trashDocument('race_doc', 'clerk_purge', daysAgo(40))

    const original = trashRepository.findExpiredRootPage.bind(trashRepository)
    const pages = jest
      .spyOn(trashRepository, 'findExpiredRootPage')
      .mockImplementation(async (...args) => {
        const page = await original(...args)
        // Between the cron's scan and each purge: the user restores one
        // task and the document, and another task is restored then trashed
        // again (a fresh 30 days).
        if (args[0] === 'task' && page.includes('race_restored')) {
          await trashService.restore('task', 'race_restored', WS, MEMBER)
          await trashService.restore('task', 'race_retrashed', WS, MEMBER)
          await trashService.trashTask('race_retrashed', 'clerk_purge', NOW)
        }
        if (args[0] === 'document' && page.includes('race_doc')) {
          await trashService.restore('document', 'race_doc', WS, MEMBER)
        }
        return page
      })
    sweep.mockClear()

    await trashService.purgeExpired(NOW)
    pages.mockRestore()

    expect(await taskExists('race_restored')).toBe(true)
    expect(await taskExists('race_retrashed')).toBe(true)
    expect(await docExists('race_doc')).toBe(true)
    expect(sweep).not.toHaveBeenCalledWith('test-evidence/race_restored/')
  })
})
