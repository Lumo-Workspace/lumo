/**
 * @jest-environment node
 *
 * LUM-910 — "discard when used up" mode for the session record, against a
 * REAL Postgres (every migration replayed into PGlite): the raw payload of
 * hook events is dropped 7 days after their work is used up — task DONE,
 * 30 days without agent activity, or the crossing they back dispositioned —
 * and never earlier. RETAIN workspaces (the default, keep forever) are never
 * touched; a RETAIN day tier keeps its LUM-859 semantics.
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

import { hookEventRetentionService } from '@/lib/services/hook-event-retention.service'
import { isPrunedPayload } from '@/lib/hook-event/retention'

jest.setTimeout(180_000)

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-20T03:45:00Z')
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)

const WS = 'ws_used_up'
const CODE = 'export const total = items.reduce(sum, 0)\n'

let taskSeq = 0

function db() {
  return harness.prisma!
}

async function seedWorkspace(
  id: string,
  data: {
    hookEventRetentionMode?: 'RETAIN' | 'USED_UP'
    hookEventRetentionDays?: number | null
  }
) {
  await db().workspace.create({ data: { id, name: id, slug: id, ...data } })
  await db().workspaceMember.create({
    data: { id: `${id}_member`, workspaceId: id, clerkId: `${id}_clerk` },
  })
  await db().team.create({
    data: { id: `${id}_team`, workspaceId: id, name: id, identifier: 'UU' },
  })
  await db().project.create({
    data: {
      id: `${id}_project`,
      workspaceId: id,
      teamId: `${id}_team`,
      createdByMemberId: `${id}_member`,
      name: id,
    },
  })
}

async function seedTask(
  ws: string,
  id: string,
  status: 'DONE' | 'IN_PROGRESS',
  updatedAt: Date
) {
  await db().task.create({
    data: {
      id,
      projectId: `${ws}_project`,
      teamId: `${ws}_team`,
      number: ++taskSeq,
      title: id,
      status,
      updatedAt,
    },
  })
}

async function seedSession(
  ws: string,
  id: string,
  taskId: string | null,
  lastActivityAt: Date
) {
  await db().session.create({
    data: {
      id,
      workspaceId: ws,
      workspaceMemberId: `${ws}_member`,
      taskId,
      lastActivityAt,
    },
  })
}

async function seedEvent(
  ws: string,
  id: string,
  opts: { taskId?: string; sessionId?: string; createdAt: Date }
) {
  await db().hookEvent.create({
    data: {
      id,
      workspaceId: ws,
      workspaceMemberId: `${ws}_member`,
      type: 'POST_TOOL_USE',
      payload: {
        tool_name: 'Write',
        tool_input: { file_path: '/repo/lib/a.ts', content: CODE },
      },
      taskId: opts.taskId ?? null,
      sessionId: opts.sessionId ?? null,
      createdAt: opts.createdAt,
    },
  })
}

async function pruned(id: string): Promise<boolean> {
  const row = await db().hookEvent.findUniqueOrThrow({ where: { id } })
  const isPruned = isPrunedPayload(row.payload)
  // The marker and the column always move together.
  expect(row.payloadPrunedAt != null).toBe(isPruned)
  if (isPruned) expect(JSON.stringify(row.payload)).not.toContain('reduce')
  return isPruned
}

beforeAll(async () => {
  await harness.start()
  await seedWorkspace(WS, { hookEventRetentionMode: 'USED_UP' })
})

afterAll(async () => {
  await harness.stop()
})

describe('used-up mode', () => {
  it('used-up sweep prunes a task done for 7 days and keeps a recent one', async () => {
    await seedTask(WS, 't_done_8d', 'DONE', ago(8))
    await seedEvent(WS, 'e_done_8d', { taskId: 't_done_8d', createdAt: ago(9) })
    await seedTask(WS, 't_done_6d', 'DONE', ago(6))
    await seedEvent(WS, 'e_done_6d', { taskId: 't_done_6d', createdAt: ago(9) })
    // Done 10 days ago but its fragment-usage vote is still outstanding: wait.
    await seedTask(WS, 't_done_vote', 'DONE', ago(10))
    await seedSession(WS, 's_vote', 't_done_vote', ago(10))
    await seedEvent(WS, 'e_done_vote', {
      sessionId: 's_vote',
      createdAt: ago(11),
    })
    await db().lineageEdge.create({
      data: {
        workspaceId: WS,
        taskId: 't_done_vote',
        sessionId: 's_vote',
        fragmentType: 'MEMORY',
        fragmentId: 'mem_1',
      },
    })
    // ... but not forever: 31 days after DONE the outstanding vote stops holding it.
    await seedTask(WS, 't_done_vote_31d', 'DONE', ago(31))
    await seedSession(WS, 's_vote_31d', 't_done_vote_31d', ago(31))
    await seedEvent(WS, 'e_done_vote_31d', {
      sessionId: 's_vote_31d',
      createdAt: ago(32),
    })
    await db().lineageEdge.create({
      data: {
        workspaceId: WS,
        taskId: 't_done_vote_31d',
        sessionId: 's_vote_31d',
        fragmentType: 'MEMORY',
        fragmentId: 'mem_2',
      },
    })

    await hookEventRetentionService.pruneExpiredPayloads(NOW)

    expect(await pruned('e_done_8d')).toBe(true)
    expect(await pruned('e_done_6d')).toBe(false)
    expect(await pruned('e_done_vote')).toBe(false)
    expect(await pruned('e_done_vote_31d')).toBe(true)
    const marker = (
      await db().hookEvent.findUniqueOrThrow({ where: { id: 'e_done_8d' } })
    ).payload as Record<string, Record<string, unknown>>
    expect(marker._lumo_pruned).toMatchObject({
      reason: 'USED_UP',
      graceDays: 7,
    })
  })

  it('used-up sweep prunes events idle for 37 days and keeps active ones', async () => {
    // Open task idle 38 days (30 idle + 7 grace + 1): used up.
    await seedTask(WS, 't_idle', 'IN_PROGRESS', ago(60))
    await seedEvent(WS, 'e_idle', { taskId: 't_idle', createdAt: ago(38) })
    // Open task with old events but recent activity on its session: kept.
    await seedTask(WS, 't_active', 'IN_PROGRESS', ago(60))
    await seedSession(WS, 's_active', 't_active', ago(2))
    await seedEvent(WS, 'e_active_old', {
      taskId: 't_active',
      createdAt: ago(50),
    })
    // Open task idle 35 days: inside the grace period.
    await seedTask(WS, 't_idle_35', 'IN_PROGRESS', ago(60))
    await seedEvent(WS, 'e_idle_35', {
      taskId: 't_idle_35',
      createdAt: ago(35),
    })
    // Taskless sessions go by the session's own last activity.
    await seedSession(WS, 's_loose_idle', null, ago(40))
    await seedEvent(WS, 'e_loose_idle', {
      sessionId: 's_loose_idle',
      createdAt: ago(41),
    })
    await seedSession(WS, 's_loose_active', null, ago(1))
    await seedEvent(WS, 'e_loose_active', {
      sessionId: 's_loose_active',
      createdAt: ago(41),
    })
    // Neither task nor session: the event's own age.
    await seedEvent(WS, 'e_orphan_old', { createdAt: ago(40) })
    await seedEvent(WS, 'e_orphan_new', { createdAt: ago(3) })

    await hookEventRetentionService.pruneExpiredPayloads(NOW)

    expect(await pruned('e_idle')).toBe(true)
    expect(await pruned('e_active_old')).toBe(false)
    expect(await pruned('e_idle_35')).toBe(false)
    expect(await pruned('e_loose_idle')).toBe(true)
    expect(await pruned('e_loose_active')).toBe(false)
    expect(await pruned('e_orphan_old')).toBe(true)
    expect(await pruned('e_orphan_new')).toBe(false)
  })

  it('used-up sweep keeps crossing evidence until the crossing is dispositioned for 7 days', async () => {
    await seedTask(WS, 't_crossing', 'DONE', ago(20))
    for (const id of ['e_bc_open', 'e_bc_recent', 'e_bc_old', 'e_bc_mixed'])
      await seedEvent(WS, id, { taskId: 't_crossing', createdAt: ago(21) })
    const crossing = (id: string, hookEventId: string, at: Date | null) =>
      db().boundaryCrossing.create({
        data: {
          id,
          taskId: 't_crossing',
          hookEventId,
          category: 'DESTRUCTIVE_DB_COMMAND',
          detail: 'psql -c drop table',
          ...(at ? { disposition: 'CONFIRMED', dispositionedAt: at } : {}),
        },
      })
    await crossing('bc_open', 'e_bc_open', null)
    await crossing('bc_recent', 'e_bc_recent', ago(3))
    await crossing('bc_old', 'e_bc_old', ago(8))
    // One of two crossings on the event still open: the evidence stays.
    await crossing('bc_mixed_a', 'e_bc_mixed', ago(9))
    await crossing('bc_mixed_b', 'e_bc_mixed', null)

    const result = await hookEventRetentionService.pruneExpiredPayloads(NOW)

    expect(await pruned('e_bc_open')).toBe(false)
    expect(await pruned('e_bc_recent')).toBe(false)
    expect(await pruned('e_bc_old')).toBe(true)
    expect(await pruned('e_bc_mixed')).toBe(false)
    expect(
      result.workspaces.find(w => w.workspaceId === WS)!.keptForCrossings
    ).toBeGreaterThanOrEqual(3)

    // Reopening a crossing holds its evidence again (nothing left to prune
    // here since e_bc_old is gone, but a reopened one never releases).
    await db().boundaryCrossing.update({
      where: { id: 'bc_recent' },
      data: { disposition: null, dispositionedAt: null },
    })
    await hookEventRetentionService.pruneExpiredPayloads(
      new Date(NOW.getTime() + 30 * DAY)
    )
    expect(await pruned('e_bc_recent')).toBe(false)
  })
})

describe('other modes', () => {
  it('retain-forever workspaces are never pruned and day tiers keep their semantics', async () => {
    const FOREVER = 'ws_forever'
    const TIER = 'ws_tier_30'
    await seedWorkspace(FOREVER, {})
    await seedWorkspace(TIER, {
      hookEventRetentionMode: 'RETAIN',
      hookEventRetentionDays: 30,
    })
    // Same shapes in both: a long-DONE task and an idle open one.
    for (const ws of [FOREVER, TIER]) {
      await seedTask(ws, `${ws}_done`, 'DONE', ago(100))
      await seedEvent(ws, `${ws}_e_done_old`, {
        taskId: `${ws}_done`,
        createdAt: ago(100),
      })
      await seedEvent(ws, `${ws}_e_done_new`, {
        taskId: `${ws}_done`,
        createdAt: ago(10),
      })
      await seedTask(ws, `${ws}_open`, 'IN_PROGRESS', ago(100))
      await seedEvent(ws, `${ws}_e_open_old`, {
        taskId: `${ws}_open`,
        createdAt: ago(100),
      })
    }

    const result = await hookEventRetentionService.pruneExpiredPayloads(NOW)

    // Keep forever: listed nowhere, nothing touched.
    expect(result.workspaces.map(w => w.workspaceId)).not.toContain(FOREVER)
    for (const id of ['e_done_old', 'e_done_new', 'e_open_old'])
      expect(await pruned(`${FOREVER}_${id}`)).toBe(false)

    // 30-day tier (LUM-859): older than 30 days AND task DONE; open tasks exempt.
    expect(await pruned(`${TIER}_e_done_old`)).toBe(true)
    expect(await pruned(`${TIER}_e_done_new`)).toBe(false)
    expect(await pruned(`${TIER}_e_open_old`)).toBe(false)
    const marker = (
      await db().hookEvent.findUniqueOrThrow({
        where: { id: `${TIER}_e_done_old` },
      })
    ).payload as Record<string, Record<string, unknown>>
    expect(marker._lumo_pruned).toMatchObject({
      reason: 'RETENTION_POLICY',
      retentionDays: 30,
    })
  })
})
