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
import { workspaceService } from '@/lib/services/workspace.service'
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

describe('LUM-933 cutoff: a setting change only governs data stored afterwards', () => {
  const at = (base: Date, days: number) => new Date(base.getTime() + days * DAY)

  async function change(
    ws: string,
    input: {
      hookEventRetentionMode: 'RETAIN' | 'USED_UP'
      hookEventRetentionDays: 30 | 90 | 180 | 365 | null
    }
  ) {
    await workspaceService.updateWorkspace(ws, 'OWNER', ws, input)
    return db().workspace.findUniqueOrThrow({
      where: { id: ws },
      select: {
        hookEventRetentionSince: true,
        hookEventRetentionLegacyDays: true,
      },
    })
  }

  const tick = () => new Promise(r => setTimeout(r, 5))

  it('tightening the session record setting never clears data stored before the change', async () => {
    // forever → 30 days
    const A = 'ws_cut_30'
    await seedWorkspace(A, {})
    const a = await change(A, {
      hookEventRetentionMode: 'RETAIN',
      hookEventRetentionDays: 30,
    })
    const sinceA = a.hookEventRetentionSince!
    expect(a.hookEventRetentionLegacyDays).toBeNull()
    await seedTask(A, `${A}_done`, 'DONE', at(sinceA, -100))
    await seedEvent(A, `${A}_old`, {
      taskId: `${A}_done`,
      createdAt: at(sinceA, -100),
    })
    await seedEvent(A, `${A}_new`, {
      taskId: `${A}_done`,
      createdAt: at(sinceA, 0.001),
    })

    // forever → used-up
    const B = 'ws_cut_used_up'
    await seedWorkspace(B, {})
    const b = await change(B, {
      hookEventRetentionMode: 'USED_UP',
      hookEventRetentionDays: null,
    })
    const sinceB = b.hookEventRetentionSince!
    await seedTask(B, `${B}_done`, 'DONE', at(sinceB, -100))
    await seedEvent(B, `${B}_old`, {
      taskId: `${B}_done`,
      createdAt: at(sinceB, -100),
    })
    await seedEvent(B, `${B}_new`, {
      taskId: `${B}_done`,
      createdAt: at(sinceB, 0.001),
    })

    // forever → 365 → 30: both earlier segments keep "forever".
    const D = 'ws_cut_multi'
    await seedWorkspace(D, {})
    const d1 = await change(D, {
      hookEventRetentionMode: 'RETAIN',
      hookEventRetentionDays: 365,
    })
    await tick()
    const d2 = await change(D, {
      hookEventRetentionMode: 'RETAIN',
      hookEventRetentionDays: 30,
    })
    const since1 = d1.hookEventRetentionSince!
    const since2 = d2.hookEventRetentionSince!
    expect(since2.getTime()).toBeGreaterThan(since1.getTime())
    expect(d2.hookEventRetentionLegacyDays).toBeNull()
    await seedTask(D, `${D}_done`, 'DONE', at(since1, -500))
    await seedEvent(D, `${D}_before_first`, {
      taskId: `${D}_done`,
      createdAt: at(since1, -400),
    })
    await seedEvent(D, `${D}_between`, {
      taskId: `${D}_done`,
      createdAt: new Date((since1.getTime() + since2.getTime()) / 2),
    })
    await seedEvent(D, `${D}_after`, {
      taskId: `${D}_done`,
      createdAt: at(since2, 0.001),
    })

    // 365 → 90 → 30: data stored before keeps the 365-day promise.
    const E = 'ws_cut_days'
    await seedWorkspace(E, {
      hookEventRetentionMode: 'RETAIN',
      hookEventRetentionDays: 365,
    })
    await change(E, {
      hookEventRetentionMode: 'RETAIN',
      hookEventRetentionDays: 90,
    })
    await tick()
    const e2 = await change(E, {
      hookEventRetentionMode: 'RETAIN',
      hookEventRetentionDays: 30,
    })
    const sinceE = e2.hookEventRetentionSince!
    expect(e2.hookEventRetentionLegacyDays).toBe(365)
    await seedTask(E, `${E}_done`, 'DONE', at(sinceE, -500))
    await seedEvent(E, `${E}_old_100`, {
      taskId: `${E}_done`,
      createdAt: at(sinceE, -100),
    })
    await seedEvent(E, `${E}_old_370`, {
      taskId: `${E}_done`,
      createdAt: at(sinceE, -370),
    })
    await seedEvent(E, `${E}_new`, {
      taskId: `${E}_done`,
      createdAt: at(sinceE, 0.001),
    })

    // Sweep well after every change.
    await hookEventRetentionService.pruneExpiredPayloads(at(since2, 40))

    expect(await pruned(`${A}_old`)).toBe(false)
    expect(await pruned(`${A}_new`)).toBe(true)
    expect(await pruned(`${B}_old`)).toBe(false)
    expect(await pruned(`${B}_new`)).toBe(true)
    expect(await pruned(`${D}_before_first`)).toBe(false)
    expect(await pruned(`${D}_between`)).toBe(false)
    expect(await pruned(`${D}_after`)).toBe(true)
    // Legacy 365: 140 days old stays, 410 days old was due under 365 anyway.
    expect(await pruned(`${E}_old_100`)).toBe(false)
    expect(await pruned(`${E}_old_370`)).toBe(true)
    expect(await pruned(`${E}_new`)).toBe(true)

    // Even a year later, data stored under "forever" is still there.
    await hookEventRetentionService.pruneExpiredPayloads(at(since2, 800))
    expect(await pruned(`${A}_old`)).toBe(false)
    expect(await pruned(`${B}_old`)).toBe(false)
    expect(await pruned(`${D}_between`)).toBe(false)
  })

  it('loosening the session record setting triggers no pruning', async () => {
    const C = 'ws_loosen'
    await seedWorkspace(C, {
      hookEventRetentionMode: 'RETAIN',
      hookEventRetentionDays: 30,
    })
    const now = new Date()
    await seedTask(C, `${C}_done`, 'DONE', at(now, -100))
    await seedEvent(C, `${C}_40d`, {
      taskId: `${C}_done`,
      createdAt: at(now, -40),
    })
    const c = await change(C, {
      hookEventRetentionMode: 'RETAIN',
      hookEventRetentionDays: 90,
    })
    expect(c.hookEventRetentionSince).toBeNull()
    expect(c.hookEventRetentionLegacyDays).toBeNull()
    const result = await hookEventRetentionService.pruneExpiredPayloads(now)
    expect(result.workspaces.find(w => w.workspaceId === C)!.pruned).toBe(0)
    expect(await pruned(`${C}_40d`)).toBe(false)
  })
})
