/**
 * @jest-environment node
 *
 * LUM-1302 — HookEvent payload encryption against a REAL Postgres (every
 * migration replayed into PGlite), through the same client extensions the
 * production client carries (lib/db/extend-client.ts). New payloads must be
 * ciphertext in the row itself; every reader must see plain JSON for both
 * sealed rows and plaintext rows written before encryption shipped.
 */
import { randomBytes } from 'crypto'
import { createPgliteHarness } from '../scripts/test-support/pglite-harness'
import { extendPrismaClient } from '@/lib/db/extend-client'

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

import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { attributionRepository } from '@/lib/repositories/attribution.repository'
import { sessionRawRecordRepository } from '@/lib/repositories/session-raw-record.repository'
import { hookEventRetentionRepository } from '@/lib/repositories/hook-event-retention.repository'
import { secretStockRepository } from '@/lib/repositories/secret-stock.repository'
import { STOCK_TABLES } from '@/lib/security-scan/secret-stock/tables'
import { hookEventEncryptionBackfillService } from '@/lib/services/hook-event-encryption-backfill.service'
import {
  buildPrunedPayload,
  buildUserDeletedPayload,
  PRUNE_REASON_RETENTION,
  PRUNE_REASON_USER_DELETED,
} from '@/lib/hook-event/retention'

jest.setTimeout(180_000)

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY
const WS_A = 'ws_enc_a'
const WS_B = 'ws_enc_b'
const MEMBER_A = 'm_enc_a'
const MEMBER_B = 'm_enc_b'
const SESSION_A = '11111111-1111-4111-8111-111111111111'
const SESSION_B = '22222222-2222-4222-8222-222222222222'
const TASK_ID = 'task_enc'

const SECRET_CODE = 'export const recipe = "secret-sauce-1302"'

interface RawRow {
  id: string
  payload: unknown
  payloadKeyId: string | null
  payloadPrunedReason: string | null
  toolUseId: string | null
  promptTaskNotification: boolean
}

async function rawRow(id: string): Promise<RawRow> {
  const [row] = await harness.query<RawRow>(
    `select id, payload, "payloadKeyId", "payloadPrunedReason", "toolUseId", "promptTaskNotification"
     from hook_events where id = $1`,
    [id]
  )
  return row!
}

const db = () => harness.prisma!

async function seed() {
  for (const [ws, member, session] of [
    [WS_A, MEMBER_A, SESSION_A],
    [WS_B, MEMBER_B, SESSION_B],
  ] as const) {
    await db().workspace.create({ data: { id: ws, name: ws, slug: ws } })
    await db().workspaceMember.create({
      data: {
        id: member,
        workspaceId: ws,
        clerkId: `clerk_${member}`,
        role: 'OWNER',
      },
    })
    await db().session.create({
      data: {
        id: session,
        workspaceId: ws,
        workspaceMemberId: member,
        lastActivityAt: new Date(),
      },
    })
  }
}

/** A row written before encryption shipped: plaintext, no key, via the plain client. */
async function insertLegacyRow(id: string, payload: object, extra = {}) {
  await db().hookEvent.create({
    data: {
      id,
      workspaceId: WS_A,
      workspaceMemberId: MEMBER_A,
      sessionId: SESSION_A,
      taskId: TASK_ID,
      type: 'POST_TOOL_USE',
      toolName: 'Read',
      payload,
      ...extra,
    },
  })
}

async function recordSealed(
  payload: Record<string, unknown>,
  opts: {
    workspaceId?: string
    memberId?: string
    sessionId?: string
    type?: 'PRE_TOOL_USE' | 'POST_TOOL_USE' | 'USER_PROMPT_SUBMIT'
    toolUseId?: string | null
    toolName?: string
  } = {}
) {
  const created = await hookEventRepository.createHookEvent({
    workspaceId: opts.workspaceId ?? WS_A,
    workspaceMemberId: opts.memberId ?? MEMBER_A,
    sessionId: opts.sessionId ?? SESSION_A,
    taskId: TASK_ID,
    type: opts.type ?? 'POST_TOOL_USE',
    toolName: opts.toolName ?? 'Read',
    payload: payload as never,
    toolUseId: opts.toolUseId ?? null,
  })
  return created.id
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex')
  await harness.start()
  holder.client = extendPrismaClient(harness.prisma!)
  await seed()
})

afterAll(async () => {
  process.env.ENCRYPTION_KEY = ORIGINAL_KEY
  await harness.stop()
})

describe('writes', () => {
  it('stores a new payload as ciphertext under its workspace key', async () => {
    const id = await recordSealed({
      tool_name: 'Read',
      tool_response: { file: { content: SECRET_CODE } },
    })
    const row = await rawRow(id)
    expect(JSON.stringify(row.payload)).not.toContain('secret-sauce-1302')
    expect(Object.keys(row.payload as object)).toEqual(['_enc'])
    expect(row.payloadKeyId).toEqual(expect.any(String))

    const keys = await harness.query<{
      id: string
      workspaceId: string
      wrappedKey: string
    }>(
      `select id, "workspaceId", "wrappedKey" from workspace_data_keys where id = $1`,
      [row.payloadKeyId]
    )
    expect(keys).toEqual([
      expect.objectContaining({ id: row.payloadKeyId, workspaceId: WS_A }),
    ])
  })

  it('gives each workspace its own key', async () => {
    const a = await rawRow(await recordSealed({ n: 1 }))
    const b = await rawRow(
      await recordSealed(
        { n: 2 },
        {
          workspaceId: WS_B,
          memberId: MEMBER_B,
          sessionId: SESSION_B,
        }
      )
    )
    expect(a.payloadKeyId).not.toBe(b.payloadKeyId)
  })

  it('stores plaintext when ENCRYPTION_KEY is not configured', async () => {
    const key = process.env.ENCRYPTION_KEY
    delete process.env.ENCRYPTION_KEY
    try {
      const row = await rawRow(await recordSealed({ plain: SECRET_CODE }))
      expect(row.payload).toEqual({ plain: SECRET_CODE })
      expect(row.payloadKeyId).toBeNull()
    } finally {
      process.env.ENCRYPTION_KEY = key
    }
  })
})

describe('reads see plain JSON for sealed and legacy plaintext rows', () => {
  const legacyId = 'he_legacy_read'
  let sealedId: string
  const payload = {
    tool_name: 'Edit',
    tool_input: {
      file_path: '/repo/a.ts',
      old_string: 'a',
      new_string: SECRET_CODE,
    },
  }

  beforeAll(async () => {
    await insertLegacyRow(legacyId, payload, { toolName: 'Edit' })
    sealedId = await recordSealed(payload, { toolName: 'Edit' })
    expect((await rawRow(legacyId)).payloadKeyId).toBeNull()
    expect((await rawRow(sealedId)).payloadKeyId).not.toBeNull()
  })

  // The one reader behind the session page, turn summaries, memory curation
  // (curation + layer 1) and the run summary.
  it('session page / turn summary / memory curation / run summary: listEventsForSession', async () => {
    const events = await sessionRepository.listEventsForSession(SESSION_A)
    const byId = new Map(events.map(e => [e.id, e.payload]))
    expect(byId.get(legacyId)).toEqual(payload)
    expect(byId.get(sealedId)).toEqual(payload)
  })

  it('Agent Run timeline: findByTaskId', async () => {
    const events = await hookEventRepository.findByTaskId(TASK_ID)
    const byId = new Map(events.map(e => [e.id, e.payload]))
    expect(byId.get(legacyId)).toEqual(payload)
    expect(byId.get(sealedId)).toEqual(payload)
  })

  it('crossing panel: findManyByIdsForEditChange', async () => {
    const rows = await hookEventRepository.findManyByIdsForEditChange([
      legacyId,
      sealedId,
    ])
    expect(rows.map(r => r.payload)).toEqual([payload, payload])
  })

  it('a sealed row whose key is gone reads as an empty payload, not ciphertext', async () => {
    const id = await recordSealed({ secret: SECRET_CODE })
    const { payloadKeyId } = await rawRow(id)
    // A fresh client (empty key cache) whose key row has been dropped.
    await harness.query(
      `update hook_events set "payloadKeyId" = $2, payload = jsonb_set(payload, '{_enc}', to_jsonb(replace(payload->>'_enc', $3, 'dk_missing'))) where id = $1`,
      [id, 'dk_missing', payloadKeyId]
    )
    const [row] = await hookEventRepository.findManyByIdsForEditChange([id])
    expect(row!.payload).toEqual({})
  })
})

describe('columns lifted out of the payload', () => {
  it('Pre→Post tool-use match uses toolUseId', async () => {
    const id = await recordSealed(
      { tool_use_id: 'toolu_1302' },
      { type: 'PRE_TOOL_USE', toolUseId: 'toolu_1302' }
    )
    expect((await rawRow(id)).toolUseId).toBe('toolu_1302')
    await expect(
      attributionRepository.findPreToolUseTask(
        WS_A,
        SESSION_A,
        'toolu_1302',
        new Date(Date.now() - 60_000)
      )
    ).resolves.toBe(TASK_ID)
  })

  it('a database-side JSON filter on the encrypted payload throws', async () => {
    await expect(
      holder.client!.hookEvent.findMany({
        where: { payload: { path: ['tool_use_id'], equals: 'x' } },
      })
    ).rejects.toThrow(/encrypted at rest/)
    await expect(
      holder.client!.hookEvent.findMany({
        where: { OR: [{ payload: { string_contains: 'x' } }] },
      })
    ).rejects.toThrow(/encrypted at rest/)
    await expect(
      holder.client!.hookEvent.updateMany({
        where: { workspaceId: WS_A, payload: { equals: { x: 1 } } },
        data: { toolName: 'x' },
      })
    ).rejects.toThrow(/encrypted at rest/)
  })
})

describe('pruning across workspaces', () => {
  it('seals each workspace with its own key and records the reason', async () => {
    const a = await recordSealed({ code: SECRET_CODE })
    const b = await recordSealed(
      { code: SECRET_CODE },
      {
        workspaceId: WS_B,
        memberId: MEMBER_B,
        sessionId: SESSION_B,
      }
    )
    const legacy = 'he_legacy_prune'
    await insertLegacyRow(legacy, { code: SECRET_CODE })
    const at = new Date()
    const marker = buildPrunedPayload(at, 30)
    const n =
      (await hookEventRetentionRepository.prunePayloads(
        WS_A,
        [a, b, legacy],
        marker,
        at
      )) +
      (await hookEventRetentionRepository.prunePayloads(
        WS_B,
        [a, b, legacy],
        marker,
        at
      ))
    expect(n).toBe(3)
    const rows = await Promise.all([a, b, legacy].map(rawRow))
    for (const row of rows) {
      expect(row.payloadPrunedReason).toBe(PRUNE_REASON_RETENTION)
      expect(Object.keys(row.payload as object)).toEqual(['_enc'])
    }
    expect(rows[0]!.payloadKeyId).not.toBe(rows[1]!.payloadKeyId)
    const [opened] = await hookEventRepository.findManyByIdsForEditChange([b])
    expect(opened!.payload).toEqual(buildPrunedPayload(at, 30))
  })

  it('a member delete is counted through payloadPrunedReason', async () => {
    const ids = [await recordSealed({ x: 1 }), await recordSealed({ x: 2 })]
    const at = new Date()
    const cleared = await sessionRawRecordRepository.clearRawRecord(
      WS_A,
      ids,
      buildUserDeletedPayload(at, MEMBER_A) as never,
      at
    )
    expect(cleared).toBe(2)
    expect((await rawRow(ids[0]!)).payloadPrunedReason).toBe(
      PRUNE_REASON_USER_DELETED
    )
    const counts = await sessionRawRecordRepository.countEvents({
      workspaceId: WS_A,
      sessionIds: [SESSION_A],
    })
    expect(counts.userDeleted).toBeGreaterThanOrEqual(2)
    const latest = await sessionRawRecordRepository.findLatestUserDeletion({
      workspaceId: WS_A,
      sessionIds: [SESSION_A],
    })
    expect(latest?.payload).toEqual(buildUserDeletedPayload(at, MEMBER_A))
  })
})

describe('secret re-redaction of an encrypted payload', () => {
  const table = STOCK_TABLES[0]!

  it('rewrites a sealed row, and leaves one pruned in the meantime alone', async () => {
    const before = { tool_input: { command: 'echo sk_live_secret' } }
    const after = { tool_input: { command: 'echo [REDACTED]' } }
    const live = await recordSealed(before)
    const pruned = await recordSealed(before)
    const at = new Date()
    await hookEventRetentionRepository.prunePayloads(
      WS_A,
      [pruned],
      buildPrunedPayload(at, 30),
      at
    )
    const page = await secretStockRepository.findPage(table, null, 10_000)
    const read = page.find(r => r.id === live)!
    expect(read.payload).toEqual(before)
    expect(read.workspaceId).toBe(WS_A)
    const written = await secretStockRepository.rewriteRows(
      table,
      [live, pruned].map(id => ({
        id,
        workspaceId: WS_A,
        columns: [{ field: 'payload', before, after }],
      }))
    )
    expect(written).toBe(1)
    expect((await rawRow(live)).payloadKeyId).not.toBeNull()
    const [opened, untouched] =
      await hookEventRepository.findManyByIdsForEditChange([live, pruned])
    expect(opened!.payload).toEqual(after)
    expect(untouched!.payload).toEqual(buildPrunedPayload(at, 30))
  })
})

describe('guards', () => {
  it('a payload update without where.workspaceId throws', async () => {
    const id = await recordSealed({ x: 1 })
    await expect(
      holder.client!.hookEvent.update({
        where: { id },
        data: { payload: { x: 2 } },
      })
    ).rejects.toThrow(/where.workspaceId/)
    await expect(
      holder.client!.hookEvent.updateMany({
        where: { id: { in: [id] } },
        data: { payload: { x: 2 } },
      })
    ).rejects.toThrow(/where.workspaceId/)
  })

  it('a payload update naming another workspace touches nothing', async () => {
    const id = await recordSealed({ x: 1 })
    const { count } = await holder.client!.hookEvent.updateMany({
      where: { id, workspaceId: WS_B },
      data: { payload: { x: 2 } },
    })
    expect(count).toBe(0)
  })
})

describe('stock encryption backfill', () => {
  it('dry-run counts, apply seals, a re-run writes 0', async () => {
    const legacy = ['he_bf_1', 'he_bf_2', 'he_bf_3']
    for (const id of legacy)
      await insertLegacyRow(id, { stock: SECRET_CODE, id })

    const dry = await hookEventEncryptionBackfillService.run({ dryRun: true })
    expect(dry.scanned).toBeGreaterThanOrEqual(legacy.length)
    expect(dry.written).toBe(0)
    expect((await rawRow(legacy[0]!)).payloadKeyId).toBeNull()

    const applied = await hookEventEncryptionBackfillService.run({
      dryRun: false,
    })
    expect(applied.written).toBe(dry.scanned)
    for (const id of legacy) {
      const row = await rawRow(id)
      expect(row.payloadKeyId).not.toBeNull()
      expect(JSON.stringify(row.payload)).not.toContain('secret-sauce-1302')
    }
    const events = await sessionRepository.listEventsForSession(SESSION_A)
    expect(events.find(e => e.id === 'he_bf_2')?.payload).toEqual({
      stock: SECRET_CODE,
      id: 'he_bf_2',
    })

    const rerun = await hookEventEncryptionBackfillService.run({
      dryRun: false,
    })
    expect(rerun.written).toBe(0)
    const dryAfter = await hookEventEncryptionBackfillService.run({
      dryRun: true,
    })
    expect(dryAfter.scanned).toBe(0)
  })
})
