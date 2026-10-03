/**
 * @jest-environment node
 *
 * LUM-944 — deleting one session's raw record, against a REAL Postgres
 * (every migration replayed into PGlite): the session's member or a workspace
 * OWNER clears the raw hook payloads of the session and its subagent
 * sessions; event rows and derived columns stay; events an undispositioned
 * boundary crossing points at are skipped and counted; a repeat clears 0;
 * other sessions and workspaces are untouched.
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

jest.mock('@/lib/utils/clerk-helpers', () => ({
  enrichClerkUsers: jest.fn(async (ids: string[]) => {
    return new Map(
      ids.map(id => [id, { clerkId: id, name: `Name of ${id}`, imageUrl: '' }])
    )
  }),
}))

import {
  sessionRawRecordService,
  type SessionRawRecordViewer,
} from '@/lib/services/session-raw-record.service'
import {
  PRUNED_PAYLOAD_KEY,
  isUserDeletedPayload,
} from '@/lib/hook-event/retention'

jest.setTimeout(180_000)

const WS = 'ws_srr'
const WS_OTHER = 'ws_srr_other'
const SECRET = 'export const API_TOKEN_NOTE = "pasted by mistake"\n'
const NOW = new Date('2026-10-03T08:00:00Z')

let seq = 0

function db() {
  return harness.prisma!
}

function viewer(
  workspaceId: string,
  member: string,
  role: 'OWNER' | 'MEMBER' = 'MEMBER'
): SessionRawRecordViewer {
  return {
    workspaceId,
    workspaceMemberId: `${workspaceId}_${member}`,
    role,
  }
}

async function seedWorkspace(id: string) {
  await db().workspace.create({ data: { id, name: id, slug: id } })
  for (const [member, role] of [
    ['owner', 'OWNER'],
    ['alice', 'MEMBER'],
    ['bob', 'MEMBER'],
  ] as const) {
    await db().workspaceMember.create({
      data: {
        id: `${id}_${member}`,
        workspaceId: id,
        clerkId: `${id}_${member}_clerk`,
        role,
      },
    })
  }
}

async function seedSession(
  ws: string,
  id: string,
  member: string,
  parentSessionId: string | null = null
) {
  await db().session.create({
    data: {
      id,
      workspaceId: ws,
      workspaceMemberId: `${ws}_${member}`,
      parentSessionId,
      lastActivityAt: NOW,
    },
  })
}

async function seedEvents(
  ws: string,
  sessionId: string,
  member: string,
  count: number
): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < count; i++)
    ids.push(`${sessionId}_e${String(++seq).padStart(5, '0')}`)
  await db().hookEvent.createMany({
    data: ids.map(id => ({
      id,
      workspaceId: ws,
      workspaceMemberId: `${ws}_${member}`,
      sessionId,
      type: 'POST_TOOL_USE' as const,
      toolName: 'Write',
      toolDetail: 'test',
      toolVerb: 'jest',
      filePath: '/repo/lib/a.ts',
      turnSummary: 'wrote a.ts',
      usageByModel: { 'claude-x': { input: 10, output: 5 } },
      payload: {
        tool_name: 'Write',
        tool_input: { file_path: '/repo/lib/a.ts', content: SECRET },
      },
      createdAt: new Date('2026-10-01T00:00:00Z'),
    })),
  })
  return ids
}

async function seedCrossing(hookEventId: string, dispositioned: boolean) {
  await db().boundaryCrossing.create({
    data: {
      hookEventId,
      category: 'HARDCODED_SECRET',
      detail: 'secret-shaped literal',
      ...(dispositioned
        ? { disposition: 'FALSE_POSITIVE', dispositionedAt: NOW }
        : {}),
    },
  })
}

async function event(id: string) {
  return db().hookEvent.findUniqueOrThrow({ where: { id } })
}

async function isWhole(id: string): Promise<boolean> {
  const row = await event(id)
  return (
    row.payloadPrunedAt === null &&
    JSON.stringify(row.payload).includes('pasted')
  )
}

beforeAll(async () => {
  await harness.start()
  await seedWorkspace(WS)
  await seedWorkspace(WS_OTHER)
})

afterAll(async () => {
  await harness.stop()
})

describe('session raw record delete — permissions', () => {
  it('session member deletes own session raw record', async () => {
    await seedSession(WS, 's_own', 'alice')
    const ids = await seedEvents(WS, 's_own', 'alice', 3)

    const result = await sessionRawRecordService.deleteRawRecord(
      's_own',
      viewer(WS, 'alice'),
      { now: NOW }
    )
    expect(result).toEqual({
      deleted: 3,
      keptForCrossings: 0,
      done: true,
      cursor: null,
    })
    for (const id of ids) expect(await isWhole(id)).toBe(false)
  })

  it('workspace owner deletes another member session raw record', async () => {
    await seedSession(WS, 's_owner_del', 'bob')
    const ids = await seedEvents(WS, 's_owner_del', 'bob', 2)

    const result = await sessionRawRecordService.deleteRawRecord(
      's_owner_del',
      viewer(WS, 'owner', 'OWNER'),
      { now: NOW }
    )
    expect(result.deleted).toBe(2)
    const row = await event(ids[0]!)
    // The marker names the OWNER, not the session's member.
    expect(row.payload).toEqual({
      [PRUNED_PAYLOAD_KEY]: {
        at: NOW.toISOString(),
        reason: 'USER_DELETED',
        by: `${WS}_owner`,
      },
    })
  })

  it('other member gets 403 and nothing is cleared', async () => {
    await seedSession(WS, 's_forbidden', 'alice')
    const ids = await seedEvents(WS, 's_forbidden', 'alice', 2)

    await expect(
      sessionRawRecordService.deleteRawRecord('s_forbidden', viewer(WS, 'bob'))
    ).rejects.toMatchObject({ status: 403 })
    // An OWNER of a different workspace is not an OWNER here.
    await expect(
      sessionRawRecordService.deleteRawRecord(
        's_forbidden',
        viewer(WS_OTHER, 'owner', 'OWNER')
      )
    ).rejects.toMatchObject({ status: 403 })
    for (const id of ids) expect(await isWhole(id)).toBe(true)

    const status = await sessionRawRecordService.getStatus(
      's_forbidden',
      viewer(WS, 'bob')
    )
    expect(status.canDelete).toBe(false)
    expect(status.totalEvents).toBe(0)
  })

  it('unknown session is 404', async () => {
    await expect(
      sessionRawRecordService.deleteRawRecord('s_missing', viewer(WS, 'alice'))
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('session raw record delete — what is cleared and kept', () => {
  it('payload becomes the pruned marker and metadata is kept', async () => {
    await seedSession(WS, 's_meta', 'alice')
    const [id] = await seedEvents(WS, 's_meta', 'alice', 1)
    const before = await event(id!)

    await sessionRawRecordService.deleteRawRecord(
      's_meta',
      viewer(WS, 'alice'),
      {
        now: NOW,
      }
    )

    const after = await event(id!)
    expect(isUserDeletedPayload(after.payload)).toBe(true)
    expect(JSON.stringify(after.payload)).not.toContain('pasted')
    expect(after.payloadPrunedAt?.toISOString()).toBe(NOW.toISOString())
    // Row, type, time and every derived statistic stay.
    for (const key of [
      'type',
      'toolName',
      'toolDetail',
      'toolVerb',
      'filePath',
      'turnSummary',
      'usageByModel',
      'createdAt',
      'sessionId',
      'workspaceMemberId',
    ] as const) {
      expect(after[key]).toEqual(before[key])
    }
  })

  it('subagent session events are cleared with their parent', async () => {
    await seedSession(WS, 's_parent', 'alice')
    await seedSession(WS, 's_parent:agent1', 'alice', 's_parent')
    const parentIds = await seedEvents(WS, 's_parent', 'alice', 1)
    const childIds = await seedEvents(WS, 's_parent:agent1', 'alice', 2)

    const result = await sessionRawRecordService.deleteRawRecord(
      's_parent',
      viewer(WS, 'alice')
    )
    expect(result.deleted).toBe(3)
    for (const id of [...parentIds, ...childIds])
      expect(await isWhole(id)).toBe(false)
  })

  it('crossing-referenced events are skipped and counted', async () => {
    await seedSession(WS, 's_cross', 'alice')
    const ids = await seedEvents(WS, 's_cross', 'alice', 4)
    await seedCrossing(ids[0]!, false) // undispositioned: kept
    await seedCrossing(ids[1]!, true) // dispositioned: cleared

    const before = await sessionRawRecordService.getStatus(
      's_cross',
      viewer(WS, 'alice')
    )
    expect(before).toMatchObject({
      canDelete: true,
      totalEvents: 4,
      deletable: 3,
      keptForCrossings: 1,
      deleted: 0,
      lastDeletion: null,
    })

    const result = await sessionRawRecordService.deleteRawRecord(
      's_cross',
      viewer(WS, 'alice'),
      { now: NOW }
    )
    expect(result).toMatchObject({ deleted: 3, keptForCrossings: 1 })
    expect(await isWhole(ids[0]!)).toBe(true)
    for (const id of ids.slice(1)) expect(await isWhole(id)).toBe(false)

    const after = await sessionRawRecordService.getStatus(
      's_cross',
      viewer(WS, 'alice')
    )
    expect(after).toMatchObject({
      deletable: 0,
      keptForCrossings: 1,
      deleted: 3,
      lastDeletion: {
        at: NOW.toISOString(),
        byName: `Name of ${WS}_alice_clerk`,
      },
    })

    // Once the crossing is ruled on, a second delete clears the rest.
    await db().boundaryCrossing.updateMany({
      where: { hookEventId: ids[0]! },
      data: { disposition: 'CONFIRMED', dispositionedAt: NOW },
    })
    const again = await sessionRawRecordService.deleteRawRecord(
      's_cross',
      viewer(WS, 'alice')
    )
    expect(again).toMatchObject({ deleted: 1, keptForCrossings: 0 })
    expect(await isWhole(ids[0]!)).toBe(false)
  })
})

describe('session raw record delete — idempotent, batched, scoped', () => {
  it('repeat delete is idempotent and clears 0', async () => {
    await seedSession(WS, 's_twice', 'alice')
    const ids = await seedEvents(WS, 's_twice', 'alice', 2)
    await sessionRawRecordService.deleteRawRecord(
      's_twice',
      viewer(WS, 'alice'),
      {
        now: NOW,
      }
    )
    const first = await event(ids[0]!)

    const repeat = await sessionRawRecordService.deleteRawRecord(
      's_twice',
      viewer(WS, 'owner', 'OWNER'),
      { now: new Date('2026-10-04T00:00:00Z') }
    )
    expect(repeat).toEqual({
      deleted: 0,
      keptForCrossings: 0,
      done: true,
      cursor: null,
    })
    // The first marker (time and deleter) is not overwritten.
    expect((await event(ids[0]!)).payload).toEqual(first.payload)
  })

  it('batched delete resumes from the cursor until done', async () => {
    await seedSession(WS, 's_batch', 'alice')
    const ids = await seedEvents(WS, 's_batch', 'alice', 7)
    await seedCrossing(ids[2]!, false)
    const limits = { batchSize: 2, maxBatches: 2 }

    let cursor: string | null = null
    let deleted = 0
    let kept = 0
    let calls = 0
    for (;;) {
      calls++
      const pass = await sessionRawRecordService.deleteRawRecord(
        's_batch',
        viewer(WS, 'alice'),
        { after: cursor, limits }
      )
      deleted += pass.deleted
      kept += pass.keptForCrossings
      if (pass.done) break
      expect(pass.cursor).not.toBeNull()
      cursor = pass.cursor
    }
    expect(calls).toBe(2)
    expect(deleted).toBe(6)
    // The kept event is counted once across passes, not once per pass.
    expect(kept).toBe(1)
    expect(await isWhole(ids[2]!)).toBe(true)
  })

  it('other sessions and other workspaces are untouched', async () => {
    await seedSession(WS, 's_target', 'alice')
    await seedSession(WS, 's_neighbour', 'alice')
    await seedSession(WS_OTHER, 's_far', 'alice')
    await seedEvents(WS, 's_target', 'alice', 2)
    const neighbour = await seedEvents(WS, 's_neighbour', 'alice', 2)
    const far = await seedEvents(WS_OTHER, 's_far', 'alice', 2)
    // A sessionless event of the same member stays too.
    await db().hookEvent.create({
      data: {
        id: 'e_sessionless',
        workspaceId: WS,
        workspaceMemberId: `${WS}_alice`,
        type: 'POST_TOOL_USE',
        payload: { content: SECRET },
      },
    })

    await sessionRawRecordService.deleteRawRecord(
      's_target',
      viewer(WS, 'alice')
    )

    for (const id of [...neighbour, ...far])
      expect(await isWhole(id)).toBe(true)
    expect((await event('e_sessionless')).payloadPrunedAt).toBeNull()
  })
})
