/**
 * @jest-environment node
 *
 * LUM-912 — a dispositioned boundary crossing gives up its raw text (detail,
 * target, explanations, timeline copies) the workspace's retention window
 * after the disposition, against a REAL Postgres (every migration replayed
 * into PGlite). Open, recent and pre-rollout crossings are left whole, and a
 * purged crossing that is reopened degrades instead of re-reading code.
 */
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))

import { crossingRawRetentionService } from '@/lib/services/crossing-raw-retention.service'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { workspaceService } from '@/lib/services/workspace.service'

jest.setTimeout(180_000)

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-20T03:45:00Z')
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)

const WS = 'ws_crossing_raw'
const TASK = 'task_crossing_raw'
const COMMAND = "psql $DATABASE_URL -c 'drop table invoices cascade'"
const DIFF_LINE =
  '+  const rows = await db.$queryRawUnsafe(`select * from ${t}`)'

function db() {
  return harness.prisma!
}

async function seedCrossing(
  id: string,
  opts: {
    dispositionedAt: Date | null
    target?: string
    category?: 'DESTRUCTIVE_DB_COMMAND' | 'TEST_FILE_DELETED'
  }
) {
  await db().boundaryCrossing.create({
    data: {
      id,
      taskId: TASK,
      category: opts.category ?? 'DESTRUCTIVE_DB_COMMAND',
      detail: `Ran ${COMMAND} — ${DIFF_LINE}`,
      target: opts.target ?? COMMAND,
      systemExplanation: `The agent dropped a table: ${COMMAND}`,
      ...(opts.dispositionedAt
        ? { disposition: 'CONFIRMED', dispositionedAt: opts.dispositionedAt }
        : {}),
      explanations: {
        create: [{ note: `I needed ${DIFF_LINE} to reset the fixture` }],
      },
    },
  })
  await db().taskActivity.createMany({
    data: [
      {
        taskId: TASK,
        type: 'BOUNDARY_CROSSING_DETECTED',
        payload: {
          boundaryCrossingId: id,
          category: 'DESTRUCTIVE_DB_COMMAND',
          detail: `Ran ${COMMAND}`,
          severity: 'HIGH',
        },
      },
      {
        taskId: TASK,
        type: 'BOUNDARY_CROSSING_DISPOSITIONED',
        payload: {
          boundaryCrossingId: id,
          category: 'DESTRUCTIVE_DB_COMMAND',
          detail: `Ran ${COMMAND}`,
          from: null,
          to: 'CONFIRMED',
          disposition: 'CONFIRMED',
          note: 'Real incident, reverted by hand',
        },
      },
      {
        taskId: TASK,
        type: 'BOUNDARY_CROSSING_REJUDGED',
        payload: {
          boundaryCrossingId: id,
          category: 'DESTRUCTIVE_DB_COMMAND',
          reason: 'STILL_HOLDS',
          evidence: DIFF_LINE,
        },
      },
    ],
  })
}

async function crossing(id: string) {
  return db().boundaryCrossing.findUniqueOrThrow({
    where: { id },
    include: { explanations: true },
  })
}

async function activitiesText(id: string): Promise<string> {
  const rows = await db().taskActivity.findMany({
    where: {
      taskId: TASK,
      payload: { path: ['boundaryCrossingId'], equals: id },
    },
  })
  return JSON.stringify(rows.map(r => r.payload))
}

beforeAll(async () => {
  await harness.start()
  await db().workspace.create({
    data: {
      id: WS,
      name: WS,
      slug: WS,
      // Rolled out 60 days before NOW: anything ruled earlier is history.
      crossingRawRetentionSince: ago(60),
    },
  })
  await db().workspaceMember.create({
    data: { id: 'm_raw', workspaceId: WS, clerkId: 'clerk_raw' },
  })
  await db().team.create({
    data: { id: 'team_raw', workspaceId: WS, name: WS, identifier: 'CR' },
  })
  await db().project.create({
    data: {
      id: 'proj_raw',
      workspaceId: WS,
      teamId: 'team_raw',
      createdByMemberId: 'm_raw',
      name: WS,
    },
  })
  await db().task.create({
    data: {
      id: TASK,
      projectId: 'proj_raw',
      workspaceId: WS,
      teamId: 'team_raw',
      number: 1,
      title: 'crossing raw retention',
    },
  })
  await seedCrossing('bc_due', { dispositionedAt: ago(8) })
  await seedCrossing('bc_path', {
    dispositionedAt: ago(9),
    category: 'TEST_FILE_DELETED',
    target: '__tests__/billing.test.ts',
  })
  await seedCrossing('bc_open', { dispositionedAt: null })
  await seedCrossing('bc_recent', { dispositionedAt: ago(6) })
  await seedCrossing('bc_history', { dispositionedAt: ago(90) })
})

afterAll(async () => {
  await harness.stop()
})

describe('crossing raw retention', () => {
  it('crossing raw purge replaces code with a description after the retention window', async () => {
    const first = await crossingRawRetentionService.purgeExpired(NOW)
    expect(first).toEqual({ purged: 2, capped: false })

    const due = await crossing('bc_due')
    expect(due.rawPurgedAt?.getTime()).toBe(NOW.getTime())
    expect(due.detail).toBe('DESTRUCTIVE_DB_COMMAND · $ psql …')
    expect(due.target).toMatch(/^sha256:[0-9a-f]{32}$/)
    expect(due.systemExplanation).toBeNull()
    expect(due.explanations.map(e => e.note)).toEqual([''])
    // Category, severity and the human's ruling survive.
    expect(due.category).toBe('DESTRUCTIVE_DB_COMMAND')
    expect(due.disposition).toBe('CONFIRMED')
    const dueActivities = await activitiesText('bc_due')
    expect(dueActivities).not.toContain('drop table')
    expect(dueActivities).not.toContain('queryRawUnsafe')
    expect(dueActivities).toContain('Real incident, reverted by hand')
    expect(dueActivities).toContain('"rawPurged":true')

    // A path target keeps the path, never any content.
    const path = await crossing('bc_path')
    expect(path.detail).toBe('TEST_FILE_DELETED · __tests__/billing.test.ts')

    // Idempotent: a second run finds nothing to do and changes nothing.
    const second = await crossingRawRetentionService.purgeExpired(NOW)
    expect(second).toEqual({ purged: 0, capped: false })
    expect((await crossing('bc_due')).target).toBe(due.target)
  })

  it('crossing raw purge skips open, recent and pre-rollout crossings', async () => {
    await crossingRawRetentionService.purgeExpired(NOW)
    for (const id of ['bc_open', 'bc_recent', 'bc_history']) {
      const row = await crossing(id)
      expect(row.rawPurgedAt).toBeNull()
      expect(row.detail).toContain('drop table')
      expect(row.target).toBe(COMMAND)
      expect(row.explanations[0]!.note).toContain('queryRawUnsafe')
      expect(await activitiesText(id)).toContain('drop table')
    }

    // A longer workspace window holds a crossing that 7 days would release.
    await db().workspace.update({
      where: { id: WS },
      data: { crossingRawRetentionDays: 30 },
    })
    try {
      await crossingRawRetentionService.purgeExpired(
        new Date(NOW.getTime() + 2 * DAY)
      )
      expect((await crossing('bc_recent')).rawPurgedAt).toBeNull()
    } finally {
      await db().workspace.update({
        where: { id: WS },
        data: { crossingRawRetentionDays: 7 },
      })
    }
  })

  it('a raw-purged crossing degrades in the panel, explain and rejudge', async () => {
    await crossingRawRetentionService.purgeExpired(NOW)
    // Reopened after its raw text was dropped (e.g. a rule revoked).
    await db().boundaryCrossing.update({
      where: { id: 'bc_due' },
      data: { disposition: null, dispositionedAt: null },
    })

    const views = await boundaryCrossingService.listAll(TASK)
    const view = views.find(v => v.id === 'bc_due')!
    expect(view.rawPurged).toBe(true)
    expect(view.suppressible).toBe(false)
    expect(view.systemExplanation).toBeNull()
    expect(views.find(v => v.id === 'bc_open')!.rawPurged).toBe(false)

    await expect(
      boundaryCrossingService.explainCrossing(TASK, 'bc_due')
    ).rejects.toMatchObject({ status: 409 })

    const preview = await boundaryCrossingService.previewSuppressionScope(
      TASK,
      'bc_due'
    )
    expect(preview.suppressible).toBe(false)

    const rejudgeable =
      await boundaryCrossingRepository.findOpenBlockingRejudgeable({
        categories: ['DESTRUCTIVE_DB_COMMAND'],
        taskId: TASK,
        take: 50,
      })
    const ids = rejudgeable.map(r => r.id)
    expect(ids).toContain('bc_open')
    expect(ids).not.toContain('bc_due')

    // A reopened crossing is not dispositioned: the sweep leaves it alone.
    const again = await crossingRawRetentionService.purgeExpired(NOW)
    expect(again.purged).toBe(0)
  })
})

describe('LUM-933 cutoff for crossing originals', () => {
  it('shortening the crossing window never purges crossings ruled before the change', async () => {
    const W = 'ws_cross_cut'
    const T = 'task_cross_cut'
    const real = Date.now()
    await db().workspace.create({
      data: {
        id: W,
        name: W,
        slug: W,
        crossingRawRetentionDays: 30,
        crossingRawRetentionSince: new Date(real - 100 * DAY),
      },
    })
    await db().workspaceMember.create({
      data: { id: 'm_cut', workspaceId: W, clerkId: 'clerk_cut' },
    })
    await db().team.create({
      data: { id: 'team_cut', workspaceId: W, name: W, identifier: 'CC' },
    })
    await db().project.create({
      data: {
        id: 'proj_cut',
        workspaceId: W,
        teamId: 'team_cut',
        createdByMemberId: 'm_cut',
        name: W,
      },
    })
    await db().task.create({
      data: {
        id: T,
        projectId: 'proj_cut',
        workspaceId: W,
        teamId: 'team_cut',
        number: 1,
        title: W,
      },
    })
    const ruled = (id: string, at: Date) =>
      db().boundaryCrossing.create({
        data: {
          id,
          taskId: T,
          category: 'DESTRUCTIVE_DB_COMMAND',
          detail: `Ran ${COMMAND}`,
          target: COMMAND,
          disposition: 'CONFIRMED',
          dispositionedAt: at,
        },
      })
    await ruled('cut_before', new Date(real - 10 * DAY))

    // 30 → 7: the cutoff moves to the change.
    await workspaceService.updateWorkspace(W, 'OWNER', W, {
      crossingRawRetentionDays: 7,
    })
    const { crossingRawRetentionSince: since } =
      await db().workspace.findUniqueOrThrow({ where: { id: W } })
    expect(since.getTime()).toBeGreaterThanOrEqual(real)
    await ruled('cut_after', new Date(since.getTime() + 60_000))

    await crossingRawRetentionService.purgeExpired(
      new Date(since.getTime() + 8 * DAY)
    )
    // Ruled 18 days before this sweep under the 30-day promise: kept.
    expect((await crossing('cut_before')).rawPurgedAt).toBeNull()
    expect((await crossing('cut_after')).rawPurgedAt).not.toBeNull()

    // 7 → 90 is longer: the cutoff stays put.
    await workspaceService.updateWorkspace(W, 'OWNER', W, {
      crossingRawRetentionDays: 90,
    })
    const after = await db().workspace.findUniqueOrThrow({ where: { id: W } })
    expect(after.crossingRawRetentionSince).toEqual(since)
  })
})
