/**
 * @jest-environment node
 *
 * LUM-918 — the 48-hour undo window for workspace deletion, driven through
 * the real service and repository against a REAL Postgres (every migration
 * replayed into PGlite). Only the edges leave the process and are mocked:
 * the owner email (Resend + Clerk) and the blob store.
 *
 * The service reads through the same soft-delete extension the production
 * client carries (LUM-923): a bare client would see trashed rows by default
 * and hide exactly the filter bug that left trashed tasks' evidence behind.
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
jest.mock('@/lib/services/workspace-deletion-notice', () => ({
  sendDeletionNotice: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
}))
jest.mock('@/lib/services/workspace-deletion-blob', () => ({
  deleteBlobsByPrefixInBothStores: jest.fn().mockResolvedValue(0),
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import { workspaceDeletionRepository } from '@/lib/repositories/workspace-deletion.repository'
import { workspaceExportRepository } from '@/lib/repositories/workspace-export.repository'
import {
  workspaceDeletionService,
  WORKSPACE_DELETION_GRACE_MS,
} from '@/lib/services/workspace-deletion.service'
import { sendDeletionNotice } from '@/lib/services/workspace-deletion-notice'
import { deleteBlobsByPrefixInBothStores } from '@/lib/services/workspace-deletion-blob'

jest.setTimeout(180_000)

const mockNotice = sendDeletionNotice as jest.Mock
const HOUR = 60 * 60 * 1000
const T0 = new Date('2026-10-01T00:00:00.000Z')

async function seedWorkspace(id: string) {
  const db = harness.prisma!
  await db.workspace.create({ data: { id, name: `WS ${id}`, slug: id } })
  await db.workspaceMember.createMany({
    data: [
      {
        id: `${id}_o1`,
        workspaceId: id,
        clerkId: `${id}_owner1`,
        role: 'OWNER',
      },
      {
        id: `${id}_o2`,
        workspaceId: id,
        clerkId: `${id}_owner2`,
        role: 'OWNER',
      },
      {
        id: `${id}_m1`,
        workspaceId: id,
        clerkId: `${id}_member`,
        role: 'MEMBER',
      },
    ],
  })
  return { id, name: `WS ${id}`, slug: id }
}

async function exists(id: string) {
  return (await harness.prisma!.workspace.count({ where: { id } })) === 1
}

async function receipts(id: string) {
  return harness.prisma!.workspaceDeletionReceipt.count({
    where: { workspaceId: id },
  })
}

beforeAll(async () => {
  await harness.start()
  holder.client = withSoftDelete(harness.prisma!)
})

afterAll(async () => {
  await harness.stop()
})

beforeEach(() => {
  mockNotice.mockClear()
})

describe('workspace deletion 48-hour undo window', () => {
  it('an owner delete schedules it 48h out, deletes nothing and emails every owner', async () => {
    const ws = await seedWorkspace('sched1')
    const pending = await workspaceDeletionService.scheduleDeletion(
      ws,
      'OWNER',
      'sched1_owner1',
      T0
    )

    expect(pending.executeAt.getTime() - T0.getTime()).toBe(
      WORKSPACE_DELETION_GRACE_MS
    )
    expect(WORKSPACE_DELETION_GRACE_MS).toBe(48 * HOUR)
    expect(await exists('sched1')).toBe(true)
    expect(await workspaceDeletionService.getPending('sched1')).toMatchObject({
      requestedByClerkId: 'sched1_owner1',
      executeAt: pending.executeAt,
    })

    expect(mockNotice).toHaveBeenCalledTimes(1)
    const notice = mockNotice.mock.calls[0][0]
    expect(notice).toMatchObject({ kind: 'scheduled', workspaceId: 'sched1' })
    expect([...notice.ownerClerkIds].sort()).toEqual([
      'sched1_owner1',
      'sched1_owner2',
    ])
  })

  it('a second request while one is pending is refused with 409', async () => {
    const ws = await seedWorkspace('sched2')
    await workspaceDeletionService.scheduleDeletion(
      ws,
      'OWNER',
      'sched2_owner1',
      T0
    )
    await expect(
      workspaceDeletionService.scheduleDeletion(
        ws,
        'OWNER',
        'sched2_owner2',
        T0
      )
    ).rejects.toMatchObject({ status: 409 })
  })

  it('the cron leaves a workspace alone before its 48 hours are up', async () => {
    await seedWorkspace('early')
    await workspaceDeletionService.scheduleDeletion(
      { id: 'early', name: 'WS early', slug: 'early' },
      'OWNER',
      'early_owner1',
      T0
    )
    await workspaceDeletionService.runDueDeletions(
      new Date(T0.getTime() + 47 * HOUR)
    )
    expect(await exists('early')).toBe(true)
    expect(await receipts('early')).toBe(0)
  })

  it('once due, the cron runs the full purge and leaves a deletion receipt', async () => {
    const ws = await seedWorkspace('due1')
    await workspaceDeletionService.scheduleDeletion(
      ws,
      'OWNER',
      'due1_owner1',
      T0
    )

    const out = await workspaceDeletionService.runDueDeletions(
      new Date(T0.getTime() + 48 * HOUR + 1)
    )
    expect(out.deleted).toBeGreaterThanOrEqual(1)
    expect(await exists('due1')).toBe(false)
    expect(
      await harness.prisma!.workspaceMember.count({
        where: { workspaceId: 'due1' },
      })
    ).toBe(0)
    const receipt = await harness.prisma!.workspaceDeletionReceipt.findFirst({
      where: { workspaceId: 'due1' },
    })
    expect(receipt?.requestedByClerkId).toBe('due1_owner1')
  })

  it('any owner can cancel; the cron then deletes nothing and every owner is told', async () => {
    const ws = await seedWorkspace('cancel1')
    await workspaceDeletionService.scheduleDeletion(
      ws,
      'OWNER',
      'cancel1_owner1',
      T0
    )
    mockNotice.mockClear()

    await workspaceDeletionService.cancelDeletion(ws, 'OWNER', 'cancel1_owner2')
    expect(await workspaceDeletionService.getPending('cancel1')).toBeNull()
    expect(mockNotice.mock.calls[0][0]).toMatchObject({ kind: 'cancelled' })

    await workspaceDeletionService.runDueDeletions(
      new Date(T0.getTime() + 100 * HOUR)
    )
    expect(await exists('cancel1')).toBe(true)
    expect(await receipts('cancel1')).toBe(0)
  })

  it('a cancel that lands after the cron picked the workspace up still wins', async () => {
    const ws = await seedWorkspace('race1')
    await workspaceDeletionService.scheduleDeletion(
      ws,
      'OWNER',
      'race1_owner1',
      T0
    )
    await workspaceDeletionService.cancelDeletion(ws, 'OWNER', 'race1_owner1')

    // The cron's scan saw it due; the purge re-checks inside its transaction.
    const out = await workspaceDeletionService.deleteWorkspace(
      'race1',
      'race1_owner1',
      { dueBy: new Date(T0.getTime() + 49 * HOUR) }
    )
    expect(out).toBeNull()
    expect(await exists('race1')).toBe(true)
  })

  it('an owner can run a pending deletion now after re-typing the name', async () => {
    const ws = await seedWorkspace('now1')
    await expect(
      workspaceDeletionService.deleteNow(ws, 'OWNER', 'now1_owner1', ws.name)
    ).rejects.toMatchObject({ status: 409 })

    await workspaceDeletionService.scheduleDeletion(
      ws,
      'OWNER',
      'now1_owner1',
      T0
    )
    await expect(
      workspaceDeletionService.deleteNow(
        ws,
        'OWNER',
        'now1_owner1',
        'wrong name'
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(await exists('now1')).toBe(true)

    const out = await workspaceDeletionService.deleteNow(
      ws,
      'OWNER',
      'now1_owner2',
      ws.name
    )
    expect(out?.receiptId).toBeTruthy()
    expect(await exists('now1')).toBe(false)
    expect(await receipts('now1')).toBe(1)
  })

  it('a member cannot schedule, cancel or run a deletion now', async () => {
    const ws = await seedWorkspace('member1')
    await expect(
      workspaceDeletionService.scheduleDeletion(
        ws,
        'MEMBER',
        'member1_member',
        T0
      )
    ).rejects.toMatchObject({ status: 403 })

    await workspaceDeletionService.scheduleDeletion(
      ws,
      'OWNER',
      'member1_owner1',
      T0
    )
    await expect(
      workspaceDeletionService.cancelDeletion(ws, 'MEMBER', 'member1_member')
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      workspaceDeletionService.deleteNow(
        ws,
        'MEMBER',
        'member1_member',
        ws.name
      )
    ).rejects.toMatchObject({ status: 403 })

    expect(await workspaceDeletionService.getPending('member1')).not.toBeNull()
    expect(await exists('member1')).toBe(true)
  })
})

/** A project with one live and one trashed task (each with a test case) and
 *  one live and one trashed document. */
async function seedTrash(id: string) {
  const db = harness.prisma!
  const trashedAt = new Date('2026-09-30T00:00:00.000Z')
  await db.team.create({
    data: { id: `${id}_team`, workspaceId: id, name: 'Eng', identifier: 'EN' },
  })
  await db.project.create({
    data: {
      id: `${id}_proj`,
      workspaceId: id,
      teamId: `${id}_team`,
      createdByMemberId: `${id}_o1`,
      name: 'P',
    },
  })
  const task = (suffix: string, number: number, deletedAt: Date | null) =>
    db.task.create({
      data: {
        id: `${id}_${suffix}`,
        number,
        title: suffix,
        projectId: `${id}_proj`,
        teamId: `${id}_team`,
        deletedAt,
        testCases: {
          create: { number: 1, title: 'tc', steps: ['s'], expected: 'e' },
        },
      },
    })
  await task('live', 1, null)
  await task('trashed', 2, trashedAt)
  const doc = (suffix: string, number: number, deletedAt: Date | null) =>
    db.document.create({
      data: {
        id: `${id}_${suffix}`,
        number,
        slug: `${id}-${suffix}`,
        title: suffix,
        content: '<p>x</p>',
        workspaceId: id,
        createdById: `${id}_o1`,
        visibility: 'WORKSPACE',
        deletedAt,
      },
    })
  await doc('doc_live', 1, null)
  await doc('doc_trashed', 2, trashedAt)
}

describe('LUM-923 purge covers the trash', () => {
  const mockBlobs = deleteBlobsByPrefixInBothStores as jest.Mock

  beforeEach(() => mockBlobs.mockClear())

  it('LUM-923 purge: deleteNow sweeps the evidence of trashed tasks and counts trashed documents', async () => {
    const ws = await seedWorkspace('trash1')
    await seedTrash('trash1')
    await workspaceDeletionService.scheduleDeletion(
      ws,
      'OWNER',
      'trash1_owner1',
      T0
    )

    const out = await workspaceDeletionService.deleteNow(
      ws,
      'OWNER',
      'trash1_owner1',
      ws.name
    )

    const swept = mockBlobs.mock.calls.map(c => c[0])
    expect(swept).toEqual(
      expect.arrayContaining([
        'workspaces/trash1/',
        'test-evidence/trash1_live/',
        'test-evidence/trash1_trashed/',
      ])
    )
    expect(out?.rowCounts.Document).toBe(2)
    const receipt = await harness.prisma!.workspaceDeletionReceipt.findFirst({
      where: { workspaceId: 'trash1' },
    })
    expect((receipt?.rowCounts as Record<string, number>).Document).toBe(2)
    expect(
      await harness.prisma!.task.count({
        where: { projectId: 'trash1_proj' },
      })
    ).toBe(0)
  })

  it('LUM-923 purge: the due cron sweeps the evidence of trashed tasks too', async () => {
    const ws = await seedWorkspace('trash2')
    await seedTrash('trash2')
    await workspaceDeletionService.scheduleDeletion(
      ws,
      'OWNER',
      'trash2_owner1',
      T0
    )

    await workspaceDeletionService.runDueDeletions(
      new Date(T0.getTime() + 49 * HOUR)
    )

    const swept = mockBlobs.mock.calls.map(c => c[0])
    expect(swept).toContain('test-evidence/trash2_trashed/')
    expect(await exists('trash2')).toBe(false)
  })
})

describe('LUM-923 export race: deletion invalidates in-flight exports first', () => {
  async function seedExports(id: string) {
    const db = harness.prisma!
    for (const status of ['PENDING', 'RUNNING', 'READY'] as const) {
      await db.workspaceExport.create({
        data: {
          id: `${id}_${status}`,
          workspaceId: id,
          requestedByClerkId: `${id}_owner1`,
          status,
        },
      })
    }
  }

  /** Export statuses as the purge transaction is about to start. */
  function captureStatusesAtPurge(id: string) {
    const seen: Record<string, string>[] = []
    const purge = workspaceDeletionRepository.purge.bind(
      workspaceDeletionRepository
    )
    const spy = jest
      .spyOn(workspaceDeletionRepository, 'purge')
      .mockImplementation(async (...args) => {
        const rows = await harness.prisma!.workspaceExport.findMany({
          where: { workspaceId: id },
          select: { id: true, status: true },
        })
        seen.push(Object.fromEntries(rows.map(r => [r.id, r.status])))
        return purge(...args)
      })
    return { seen, spy }
  }

  it('LUM-923 export race: deleteNow fails PENDING and RUNNING exports before purging', async () => {
    const ws = await seedWorkspace('exrace1')
    await seedExports('exrace1')
    await workspaceDeletionService.scheduleDeletion(
      ws,
      'OWNER',
      'exrace1_owner1',
      T0
    )
    const { seen, spy } = captureStatusesAtPurge('exrace1')

    await workspaceDeletionService.deleteNow(
      ws,
      'OWNER',
      'exrace1_owner1',
      ws.name
    )
    spy.mockRestore()

    expect(seen[0]).toEqual({
      exrace1_PENDING: 'FAILED',
      exrace1_RUNNING: 'FAILED',
      exrace1_READY: 'READY',
    })
    expect(await exists('exrace1')).toBe(false)
  })

  it('LUM-923 export race: the due purge fails in-flight exports before purging', async () => {
    const ws = await seedWorkspace('exrace2')
    await seedExports('exrace2')
    await workspaceDeletionService.scheduleDeletion(
      ws,
      'OWNER',
      'exrace2_owner1',
      T0
    )
    const { seen, spy } = captureStatusesAtPurge('exrace2')

    await workspaceDeletionService.runDueDeletions(
      new Date(T0.getTime() + 49 * HOUR)
    )
    spy.mockRestore()

    expect(seen.find(s => 'exrace2_RUNNING' in s)).toMatchObject({
      exrace2_PENDING: 'FAILED',
      exrace2_RUNNING: 'FAILED',
    })
  })

  it('LUM-923 export race: an invalidated export can neither restart nor turn READY', async () => {
    await seedWorkspace('exrace3')
    await seedExports('exrace3')
    expect(
      (
        await workspaceExportRepository.invalidateActive(
          'exrace3',
          'workspace is being deleted'
        )
      ).sort()
    ).toEqual(['exrace3_PENDING', 'exrace3_RUNNING'])

    expect(await workspaceExportRepository.markRunning('exrace3_PENDING')).toBe(
      false
    )
    const ready = await workspaceExportRepository.markReady('exrace3_RUNNING', {
      blobUrl: 'https://blob.test/x.zip',
      sizeBytes: 1,
      rowCounts: {},
      completedAt: T0,
      expiresAt: T0,
    })
    expect(ready).toBe(false)
    expect(
      await workspaceExportRepository.markReady('no_such_export', {
        blobUrl: 'https://blob.test/x.zip',
        sizeBytes: 1,
        rowCounts: {},
        completedAt: T0,
        expiresAt: T0,
      })
    ).toBe(false)
    const rows = await harness.prisma!.workspaceExport.findMany({
      where: { workspaceId: 'exrace3' },
      select: { id: true, status: true, blobUrl: true },
    })
    expect(rows.find(r => r.id === 'exrace3_RUNNING')).toMatchObject({
      status: 'FAILED',
      blobUrl: null,
    })
  })
})
