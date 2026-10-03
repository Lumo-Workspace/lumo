/**
 * @jest-environment node
 *
 * LUM-932 `lumo usage resync` against a REAL Postgres (every migration
 * replayed into PGlite): the service + repository correct an eligible session
 * family exactly — columns replaced together, per-turn rows scaled per model
 * and kind, one audit row per corrected session, the resynced flag set — and
 * every skip path leaves the database untouched.
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

import { usageResyncRepository } from '@/lib/repositories/usage-resync.repository'
import { usageResyncService } from '@/lib/services/usage-resync.service'
import type { ResyncSessionInput } from '@/lib/validation/usage-resync'

jest.setTimeout(180_000)

const u = (
  input: number,
  output: number,
  cacheRead: number,
  cacheCreation: number
) => ({ input, output, cacheRead, cacheCreation })
const flat = (i: number, o: number, r: number, c: number) => ({
  inputTokens: i,
  outputTokens: o,
  cacheReadTokens: r,
  cacheCreationTokens: c,
})

const identity = {
  user: { id: 'clerk-ws' },
  workspace: { id: 'ws', slug: 'ws', name: 'ws' },
  apiKey: { id: 'k', name: 'k', prefix: 'lum_k' },
}
const PRE = '2026-10-02T10:00:00.000Z'
const POST = '2026-10-03T08:00:00.000Z'
const ROOT = 'root-1'
const CHILD = `${ROOT}:a1`

const ROOT_OLD = u(200, 100, 1000, 40)
const CHILD_OLD = u(20, 10, 100, 0)
const ROW_OLD = {
  e1: { opus: u(120, 60, 600, 40) },
  e2: { opus: u(40, 20, 200, 0) },
  e3: { opus: u(81, 41, 401, 0) },
}

async function session(id: string, extra: Record<string, unknown> = {}) {
  await harness.insert('sessions', {
    id,
    workspaceId: 'ws',
    workspaceMemberId: 'member',
    startedAt: '2026-10-01T00:00:00.000Z',
    lastActivityAt: PRE,
    ...extra,
  })
}

const stored = (m: Record<string, ReturnType<typeof u>>) => {
  const t = Object.values(m).reduce(
    (a, v) =>
      u(
        a.input + v.input,
        a.output + v.output,
        a.cacheRead + v.cacheRead,
        a.cacheCreation + v.cacheCreation
      ),
    u(0, 0, 0, 0)
  )
  return {
    ...flat(t.input, t.output, t.cacheRead, t.cacheCreation),
    usageByModel: JSON.stringify(m),
  }
}

async function event(
  id: string,
  sessionId: string,
  type: string,
  usageByModel: unknown
) {
  await harness.insert('hook_events', {
    id,
    workspaceId: 'ws',
    workspaceMemberId: 'member',
    sessionId,
    type,
    payload: JSON.stringify({}),
    usageByModel: usageByModel === null ? null : JSON.stringify(usageByModel),
  })
}

/** The family request: root own opus 100/50/400/40, subagent a1 haiku 10/5/50/0. */
const familyInput: ResyncSessionInput = {
  sessionId: ROOT,
  total: flat(110, 55, 450, 40),
  byModel: { opus: u(100, 50, 400, 40), haiku: u(10, 5, 50, 0) },
  bySubagent: {
    a1: { total: flat(10, 5, 50, 0), byModel: { haiku: u(10, 5, 50, 0) } },
    // A subagent with no child row (it ran before child sessions existed):
    // its usage is still inside the root's stored figures, so it is NOT
    // subtracted from the root.
    ghost: { total: flat(10, 0, 0, 0), byModel: { opus: u(10, 0, 0, 0) } },
  },
}

const simple = (sessionId: string, t: ReturnType<typeof u>) => ({
  sessionId,
  total: flat(t.input, t.output, t.cacheRead, t.cacheCreation),
  byModel: { opus: t },
})

beforeAll(async () => {
  await harness.start()
  for (const [ws, member] of [
    ['ws', 'member'],
    ['ws-b', 'member-b'],
  ] as const) {
    await harness.insert('workspaces', { id: ws, name: ws, slug: ws })
    await harness.insert('workspace_members', {
      id: member,
      workspaceId: ws,
      clerkId: `clerk-${ws}`,
    })
  }
  await session(ROOT, {
    ...stored({ opus: ROOT_OLD }),
    liveUsageByModel: JSON.stringify({ opus: u(250, 120, 1100, 40) }),
    loopCount: 3,
  })
  await session(CHILD, {
    parentSessionId: ROOT,
    agentId: 'a1',
    ...stored({ haiku: CHILD_OLD }),
  })
  await event('e1', ROOT, 'STOP', ROW_OLD.e1)
  await event('e2', ROOT, 'POST_TOOL_BATCH', ROW_OLD.e2)
  await event('e3', ROOT, 'STOP_FAILURE', ROW_OLD.e3)
  await event('e4', ROOT, 'PRE_TOOL_USE', null)
  await event('e5', ROOT, 'STOP', null)
  await event('e6', CHILD, 'SUBAGENT_STOP', { haiku: CHILD_OLD })

  await harness.insert('sessions', {
    id: 'foreign',
    workspaceId: 'ws-b',
    workspaceMemberId: 'member-b',
    startedAt: '2026-10-01T00:00:00.000Z',
    lastActivityAt: PRE,
    ...stored({ opus: u(100, 100, 100, 100) }),
  })
  await session('active', {
    lastActivityAt: POST,
    ...stored({ opus: u(100, 100, 100, 100) }),
  })
  await session('already', {
    usageResyncedAt: PRE,
    ...stored({ opus: u(100, 100, 100, 100) }),
  })
  await session('nousage')
  await session('flat', stored({ opus: u(25, 25, 25, 25) }))
  await session('dry', stored({ opus: u(100, 100, 100, 100) }))
  await event('d1', 'dry', 'STOP', { opus: u(100, 100, 100, 100) })

  // Child-only inflation: the root's figures are already exact.
  await session('conly', stored({ opus: u(10, 10, 10, 10) }))
  await session('conly:a1', {
    parentSessionId: 'conly',
    agentId: 'a1',
    ...stored({ haiku: u(40, 40, 40, 40) }),
  })
  await event('c1', 'conly', 'STOP', { opus: u(10, 10, 10, 10) })
  await event('c2', 'conly:a1', 'SUBAGENT_STOP', { haiku: u(40, 40, 40, 40) })
  // Nothing inflated anywhere in the family.
  await session('none', stored({ opus: u(10, 10, 10, 10) }))
  await session('none:a1', {
    parentSessionId: 'none',
    agentId: 'a1',
    ...stored({ haiku: u(10, 10, 10, 10) }),
  })
  // A child row with NO stored usage: no split ever happened, so the
  // subagent's usage is still inside the root's stored figure.
  await session('nulc', stored({ opus: u(50, 50, 50, 50) }))
  await session('nulc:a1', { parentSessionId: 'nulc', agentId: 'a1' })
  await event('n1', 'nulc', 'STOP', { opus: u(50, 50, 50, 50) })
  // Row-count guard target.
  await session('guard', stored({ opus: u(10, 10, 10, 10) }))
})

afterAll(async () => {
  await harness.stop()
})

const db = () => harness.prisma!
const snapshot = async () => ({
  sessions: await db().session.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheCreationTokens: true,
      usageByModel: true,
      liveUsageByModel: true,
      usageResyncedAt: true,
    },
  }),
  events: await db().hookEvent.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, usageByModel: true },
  }),
  audits: await db().usageResyncAudit.count(),
})

describe('usage resync corrects historical sessions from deduped transcripts', () => {
  it('skips foreign, child, active, already-resynced, usage-less and not-inflated sessions and a dry run writes nothing', async () => {
    const before = await snapshot()
    const res = await usageResyncService.resync({
      identity,
      dryRun: true,
      sessions: [
        simple('foreign', u(1, 1, 1, 1)),
        simple(CHILD, u(1, 1, 1, 1)),
        simple('missing', u(1, 1, 1, 1)),
        simple('active', u(1, 1, 1, 1)),
        simple('already', u(1, 1, 1, 1)),
        simple('nousage', u(1, 1, 1, 1)),
        simple('flat', u(25, 25, 25, 25)),
        simple('dry', u(50, 50, 50, 50)),
        familyInput,
      ],
    })
    expect(res.dryRun).toBe(true)
    expect(res.results).toEqual([
      { sessionId: 'foreign', status: 'skipped', reason: 'not_found' },
      { sessionId: CHILD, status: 'skipped', reason: 'not_found' },
      { sessionId: 'missing', status: 'skipped', reason: 'not_found' },
      { sessionId: 'active', status: 'skipped', reason: 'active_after_cutoff' },
      { sessionId: 'already', status: 'skipped', reason: 'already_resynced' },
      { sessionId: 'nousage', status: 'skipped', reason: 'no_usage' },
      {
        sessionId: 'flat',
        status: 'skipped',
        reason: 'not_inflated',
        before: 100,
        after: 100,
      },
      {
        sessionId: 'dry',
        status: 'would_resync',
        before: 400,
        after: 200,
        sessionsCorrected: 1,
        rowsScaled: 1,
      },
      {
        sessionId: ROOT,
        status: 'would_resync',
        before: 1470,
        after: 655,
        sessionsCorrected: 2,
        rowsScaled: 4,
      },
    ])
    expect(await snapshot()).toEqual(before)
  })

  it('corrects an eligible family exactly: columns, live map, rows per model and kind, audit and flag', async () => {
    const res = await usageResyncService.resync({
      identity,
      dryRun: false,
      sessions: [familyInput],
    })
    expect(res.results).toEqual([
      {
        sessionId: ROOT,
        status: 'resynced',
        before: 1470,
        after: 655,
        sessionsCorrected: 2,
        rowsScaled: 4,
      },
    ])

    const root = await db().session.findUniqueOrThrow({ where: { id: ROOT } })
    const rootNew = { opus: u(100, 50, 400, 40), haiku: u(0, 0, 0, 0) }
    expect(root).toMatchObject({
      ...flat(100, 50, 400, 40),
      usageByModel: rootNew,
      liveUsageByModel: rootNew,
      loopCount: 3,
    })
    expect(root.usageResyncedAt).toBeInstanceOf(Date)
    const child = await db().session.findUniqueOrThrow({ where: { id: CHILD } })
    expect(child).toMatchObject({
      ...flat(10, 5, 50, 0),
      usageByModel: { haiku: u(10, 5, 50, 0) },
      liveUsageByModel: { haiku: u(10, 5, 50, 0) },
    })
    expect(child.usageResyncedAt).toBeInstanceOf(Date)

    const rows = Object.fromEntries(
      (
        await db().hookEvent.findMany({
          select: { id: true, usageByModel: true },
        })
      ).map(r => [r.id, r.usageByModel])
    )
    // Root factors opus = 0.5 / 0.5 / 0.4 / 1, rounded half up.
    expect(rows.e1).toEqual({ opus: u(60, 30, 240, 40) })
    expect(rows.e2).toEqual({ opus: u(20, 10, 80, 0) })
    expect(rows.e3).toEqual({ opus: u(41, 21, 160, 0) })
    expect(rows.e4).toBeNull()
    expect(rows.e5).toBeNull()
    // Child factors haiku = 0.5 / 0.5 / 0.5 / 0 (stored 0 -> factor 0).
    expect(rows.e6).toEqual({ haiku: u(10, 5, 50, 0) })
    expect(rows.d1).toEqual({ opus: u(100, 100, 100, 100) })

    const audits = await db().usageResyncAudit.findMany({
      orderBy: { sessionId: 'asc' },
    })
    expect(audits).toHaveLength(2)
    expect(audits[0]).toMatchObject({
      workspaceId: 'ws',
      sessionId: ROOT,
      workspaceMemberId: 'member',
      before: {
        ...flat(200, 100, 1000, 40),
        usageByModel: { opus: ROOT_OLD },
        liveUsageByModel: { opus: u(250, 120, 1100, 40) },
      },
      after: {
        ...flat(100, 50, 400, 40),
        usageByModel: rootNew,
        liveUsageByModel: rootNew,
      },
      factors: { opus: u(0.5, 0.5, 0.4, 1) },
      rows: ROW_OLD,
    })
    expect(audits[1]).toMatchObject({
      sessionId: CHILD,
      before: { ...flat(20, 10, 100, 0), usageByModel: { haiku: CHILD_OLD } },
      after: {
        ...flat(10, 5, 50, 0),
        usageByModel: { haiku: u(10, 5, 50, 0) },
        liveUsageByModel: { haiku: u(10, 5, 50, 0) },
      },
      factors: { haiku: u(0.5, 0.5, 0.5, 0) },
      rows: { e6: { haiku: CHILD_OLD } },
    })
  })

  it('is idempotent: a second run reports already_resynced and writes nothing', async () => {
    const before = await snapshot()
    const res = await usageResyncService.resync({
      identity,
      dryRun: false,
      sessions: [familyInput],
    })
    expect(res.results).toEqual([
      { sessionId: ROOT, status: 'skipped', reason: 'already_resynced' },
    ])
    expect(await snapshot()).toEqual(before)
  })
  const childOnly = {
    sessionId: 'conly',
    total: flat(30, 30, 30, 30),
    byModel: { opus: u(10, 10, 10, 10), haiku: u(20, 20, 20, 20) },
    bySubagent: {
      a1: {
        total: flat(20, 20, 20, 20),
        byModel: { haiku: u(20, 20, 20, 20) },
      },
    },
  }

  it('child-only inflation corrects the child and flags the unchanged root, and a repeat run reports already_resynced', async () => {
    const res = await usageResyncService.resync({
      identity,
      dryRun: false,
      sessions: [childOnly],
    })
    expect(res.results).toEqual([
      {
        sessionId: 'conly',
        status: 'resynced',
        before: 200,
        after: 120,
        sessionsCorrected: 1,
        rowsScaled: 1,
      },
    ])
    const root = await db().session.findUniqueOrThrow({
      where: { id: 'conly' },
    })
    expect(root).toMatchObject({
      ...flat(10, 10, 10, 10),
      usageByModel: { opus: u(10, 10, 10, 10) },
      liveUsageByModel: null,
    })
    expect(root.usageResyncedAt).toBeInstanceOf(Date)
    const child = await db().session.findUniqueOrThrow({
      where: { id: 'conly:a1' },
    })
    expect(child).toMatchObject({
      ...flat(20, 20, 20, 20),
      usageByModel: { haiku: u(20, 20, 20, 20) },
    })
    expect(child.usageResyncedAt).toBeInstanceOf(Date)
    const rows = await db().hookEvent.findMany({
      where: { id: { in: ['c1', 'c2'] } },
      orderBy: { id: 'asc' },
      select: { usageByModel: true },
    })
    expect(rows.map(r => r.usageByModel)).toEqual([
      { opus: u(10, 10, 10, 10) },
      { haiku: u(20, 20, 20, 20) },
    ])
    // The root's audit row is a "verified, unchanged" marker: after equals
    // before, factors all 1, no rows touched.
    const rootAudit = await db().usageResyncAudit.findMany({
      where: { sessionId: 'conly' },
    })
    expect(rootAudit).toHaveLength(1)
    expect(rootAudit[0]!.after).toEqual(rootAudit[0]!.before)
    expect(rootAudit[0]).toMatchObject({
      before: {
        ...flat(10, 10, 10, 10),
        usageByModel: { opus: u(10, 10, 10, 10) },
        liveUsageByModel: null,
      },
      factors: { opus: u(1, 1, 1, 1) },
      rows: {},
    })
    expect(
      await db().usageResyncAudit.count({ where: { sessionId: 'conly:a1' } })
    ).toBe(1)

    const snap = await snapshot()
    const again = await usageResyncService.resync({
      identity,
      dryRun: false,
      sessions: [childOnly],
    })
    expect(again.results).toEqual([
      { sessionId: 'conly', status: 'skipped', reason: 'already_resynced' },
    ])
    expect(await snapshot()).toEqual(snap)
  })

  it('a family with nothing inflated is reported not_inflated and left unflagged with no writes', async () => {
    const snap = await snapshot()
    const res = await usageResyncService.resync({
      identity,
      dryRun: false,
      sessions: [
        {
          sessionId: 'none',
          total: flat(20, 20, 20, 20),
          byModel: { opus: u(10, 10, 10, 10), haiku: u(10, 10, 10, 10) },
          bySubagent: {
            a1: {
              total: flat(10, 10, 10, 10),
              byModel: { haiku: u(10, 10, 10, 10) },
            },
          },
        },
      ],
    })
    expect(res.results).toEqual([
      {
        sessionId: 'none',
        status: 'skipped',
        reason: 'not_inflated',
        before: 80,
        after: 80,
      },
    ])
    expect(await snapshot()).toEqual(snap)
  })

  it('does not subtract a subagent whose child row has no stored usage from the root share', async () => {
    const res = await usageResyncService.resync({
      identity,
      dryRun: false,
      sessions: [
        {
          sessionId: 'nulc',
          total: flat(30, 30, 30, 30),
          byModel: { opus: u(30, 30, 30, 30) },
          bySubagent: {
            a1: {
              total: flat(10, 10, 10, 10),
              byModel: { opus: u(10, 10, 10, 10) },
            },
          },
        },
      ],
    })
    expect(res.results).toEqual([
      {
        sessionId: 'nulc',
        status: 'resynced',
        before: 200,
        after: 120,
        sessionsCorrected: 1,
        rowsScaled: 1,
      },
    ])
    const root = await db().session.findUniqueOrThrow({ where: { id: 'nulc' } })
    expect(root).toMatchObject({
      ...flat(30, 30, 30, 30),
      usageByModel: { opus: u(30, 30, 30, 30) },
    })
    const audit = await db().usageResyncAudit.findFirstOrThrow({
      where: { sessionId: 'nulc' },
    })
    expect(audit.factors).toEqual({ opus: u(0.6, 0.6, 0.6, 0.6) })
    const n1 = await db().hookEvent.findUniqueOrThrow({ where: { id: 'n1' } })
    expect(n1.usageByModel).toEqual({ opus: u(30, 30, 30, 30) })
    const child = await db().session.findUniqueOrThrow({
      where: { id: 'nulc:a1' },
    })
    expect(child.inputTokens).toBeNull()
    expect(child.usageResyncedAt).toBeNull()
  })

  it('rolls the family back when a scaled row no longer matches', async () => {
    const snap = await snapshot()
    await expect(
      usageResyncRepository.applyFamilyResync({
        workspaceId: 'ws',
        workspaceMemberId: 'member',
        activeBefore: new Date('2026-10-03T07:13:35Z'),
        now: new Date(),
        sessions: [
          {
            sessionId: 'guard',
            usage: {
              ...flat(5, 5, 5, 5),
              usageByModel: { opus: u(5, 5, 5, 5) },
            },
            rows: [
              { id: 'no-such-event', usageByModel: { opus: u(1, 1, 1, 1) } },
            ],
            audit: { before: {}, after: {}, factors: {}, rows: {} },
          },
        ],
      })
    ).rejects.toThrow(/row/)
    expect(await snapshot()).toEqual(snap)
  })
})
