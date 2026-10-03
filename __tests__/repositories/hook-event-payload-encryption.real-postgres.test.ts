/**
 * @jest-environment node
 *
 * LUM-863: HookEvent.payload envelope encryption against a REAL Postgres
 * (every migration replayed into PGlite) — what is actually stored, the
 * lookups that used to filter inside the payload JSON, crypto-shredding on
 * workspace deletion and the plaintext → ciphertext backfill.
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
// No blob store in tests: the deletion's post-commit blob sweep is a no-op.
jest.mock('@/lib/services/workspace-deletion-blob', () => ({
  deleteBlobsByPrefixInBothStores: jest.fn(async () => 0),
}))

import type { Prisma } from '@prisma/client'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { attributionRepository } from '@/lib/repositories/attribution.repository'
import { workspaceDeletionService } from '@/lib/services/workspace-deletion.service'
import { hookEventPayloadEncryptionBackfillService } from '@/lib/services/hook-event-payload-encryption-backfill.service'
import { workspaceKeyring } from '@/lib/envelope-crypto/workspace-keyring'
import { openHookPayloads } from '@/lib/hook-event/payload-cipher'
import { TASK_NOTIFICATION_MARKER } from '@/lib/attribution/signals'

jest.setTimeout(180_000)

const db = () => harness.prisma!
const SESSION = 'sess-root'
const CODE = 'export const total = items.reduce(sum, 0)\n'
const since = new Date(Date.UTC(2020, 0, 1))

async function seedWorkspace(ws: string, member: string) {
  await db().workspace.create({ data: { id: ws, name: ws, slug: ws } })
  await db().workspaceMember.create({
    data: { id: member, workspaceId: ws, clerkId: `clerk-${member}` },
  })
}

function record(
  ws: string,
  member: string,
  type: 'PRE_TOOL_USE' | 'POST_TOOL_USE' | 'USER_PROMPT_SUBMIT',
  payload: Record<string, unknown>,
  extra: { sessionId?: string; taskId?: string; toolUseId?: string } = {}
) {
  return hookEventRepository.createHookEvent({
    workspaceId: ws,
    workspaceMemberId: member,
    type,
    toolName: (payload.tool_name as string | undefined) ?? null,
    payload: payload as Prisma.InputJsonValue,
    sessionId: extra.sessionId ?? null,
    taskId: extra.taskId ?? null,
    toolUseId: extra.toolUseId ?? null,
    attributionSignals: [],
  })
}

/** A row as it was stored before LUM-863: plaintext payload, no ciphertext. */
async function seedLegacy(
  id: string,
  type: 'PRE_TOOL_USE' | 'POST_TOOL_USE' | 'USER_PROMPT_SUBMIT',
  payload: Record<string, unknown>,
  extra: Partial<Prisma.HookEventUncheckedCreateInput> = {}
) {
  await db().hookEvent.create({
    data: {
      id,
      workspaceId: 'ws',
      workspaceMemberId: 'member',
      type,
      payload: payload as Prisma.InputJsonValue,
      attributionSignals: [],
      ...extra,
    },
  })
}

async function stored(id: string) {
  return db().hookEvent.findUniqueOrThrow({
    where: { id },
    select: {
      workspaceId: true,
      payload: true,
      payloadEncrypted: true,
      toolUseId: true,
    },
  })
}

beforeAll(async () => {
  process.env.WORKSPACE_KEKS = 'k1:' + '7'.repeat(64)
  workspaceKeyring.resetForTests()
  await harness.start()
  await seedWorkspace('ws', 'member')
  await seedWorkspace('ws-del', 'member-del')
  await db().team.create({
    data: { id: 'team', workspaceId: 'ws', name: 'Lumo', identifier: 'LUM' },
  })
  await db().project.create({
    data: {
      id: 'project',
      workspaceId: 'ws',
      teamId: 'team',
      createdByMemberId: 'member',
      name: 'P',
    },
  })
  await db().task.create({
    data: {
      id: 'task_1',
      projectId: 'project',
      teamId: 'team',
      number: 1,
      title: 'T',
    },
  })
  await db().session.create({
    data: {
      id: SESSION,
      workspaceId: 'ws',
      workspaceMemberId: 'member',
      startedAt: since,
      lastActivityAt: since,
    },
  })
})

afterAll(async () => {
  await harness.stop()
  delete process.env.WORKSPACE_KEKS
  workspaceKeyring.resetForTests()
})

describe('HookEvent payload encryption on a real Postgres', () => {
  it('new hook events are stored as ciphertext and read back transparently', async () => {
    const payload = {
      tool_name: 'Write',
      tool_input: { file_path: '/repo/a.ts', content: CODE },
    }
    const { id } = await record('ws', 'member', 'POST_TOOL_USE', payload, {
      sessionId: SESSION,
      taskId: 'task_1',
    })

    const row = await stored(id)
    const [key] = await db().workspaceDataKey.findMany({
      where: { workspaceId: 'ws' },
    })
    expect(row.payload).toBeNull()
    expect(row.payloadEncrypted!.startsWith(`lenc:v1:${key!.id}:`)).toBe(true)
    expect(row.payloadEncrypted).not.toContain('items.reduce')
    expect(key).toMatchObject({ workspaceId: 'ws', version: 1, kekId: 'k1' })

    // The repository reads behind the timeline and the session page.
    const timeline = await hookEventRepository.findByTaskId('task_1')
    expect(timeline.find(e => e.id === id)!.payload).toEqual(payload)
    expect(timeline[0]).not.toHaveProperty('payloadEncrypted')
    const sessionEvents = await sessionRepository.listEventsForSession(SESSION)
    expect(sessionEvents.find(e => e.id === id)!.payload).toEqual(payload)

    // The session-start read-modify-write re-seals the replacement.
    await hookEventRepository.setContextInjectionMetrics(id, 'ws', {
      ...payload,
      _lumo_context_metrics: { tokens: 3 },
    })
    const after = await stored(id)
    expect(after.payload).toBeNull()
    expect(after.payloadEncrypted).not.toBe(row.payloadEncrypted)
    const [reread] = await hookEventRepository.findManyByIdsForEditChange([id])
    expect(reread!.payload).toEqual({
      ...payload,
      _lumo_context_metrics: { tokens: 3 },
    })
  })

  it('payload lookups work for both encrypted and legacy plaintext rows', async () => {
    // PRE → POST pairing by tool_use_id: lifted column vs legacy JSON.
    await seedLegacy(
      'legacy_pre',
      'PRE_TOOL_USE',
      {
        tool_name: 'Bash',
        tool_use_id: 'tu_old',
        tool_input: { command: 'ls' },
      },
      { sessionId: SESSION, taskId: 'task_1' }
    )
    const enc = await record(
      'ws',
      'member',
      'PRE_TOOL_USE',
      {
        tool_name: 'Bash',
        tool_use_id: 'tu_new',
        tool_input: { command: 'pwd' },
      },
      { sessionId: SESSION, taskId: 'task_1', toolUseId: 'tu_new' }
    )
    expect((await stored(enc.id)).toolUseId).toBe('tu_new')
    const pre = (toolUseId: string) =>
      attributionRepository.findPreToolUseTask('ws', SESSION, toolUseId, since)
    expect(await pre('tu_old')).toBe('task_1')
    expect(await pre('tu_new')).toBe('task_1')
    expect(await pre('tu_missing')).toBeNull()

    // Task-notification prompts: matched in SQL (plaintext) or after
    // decryption (ciphertext); a non-matching encrypted prompt stays unloaded.
    const marked = `${TASK_NOTIFICATION_MARKER} done`
    await seedLegacy(
      'legacy_prompt',
      'USER_PROMPT_SUBMIT',
      { prompt: marked },
      { sessionId: SESSION }
    )
    const encMarked = await record(
      'ws',
      'member',
      'USER_PROMPT_SUBMIT',
      { prompt: marked },
      { sessionId: SESSION }
    )
    const encPlain = await record(
      'ws',
      'member',
      'USER_PROMPT_SUBMIT',
      { prompt: 'just a question' },
      { sessionId: SESSION }
    )
    const family = await attributionRepository.loadFamily(SESSION)
    const byId = new Map(family!.events.map(e => [e.id, e.payload]))
    expect(byId.get('legacy_prompt')).toEqual({ prompt: marked })
    expect(byId.get(encMarked.id)).toEqual({ prompt: marked })
    expect(byId.get(encPlain.id)).toBeNull()

    // Legacy and encrypted rows read side by side through the repository.
    const timeline = await hookEventRepository.findByTaskId('task_1')
    expect(timeline.find(e => e.id === 'legacy_pre')!.payload).toMatchObject({
      tool_use_id: 'tu_old',
    })
    expect(timeline.find(e => e.id === enc.id)!.payload).toMatchObject({
      tool_use_id: 'tu_new',
    })
    const commands = await hookEventRepository.findCommandsByIds([
      'legacy_pre',
      enc.id,
    ])
    expect(Object.fromEntries(commands)).toEqual({
      legacy_pre: 'ls',
      [enc.id]: 'pwd',
    })
  })

  it('workspace deletion crypto-shreds its hook event payloads', async () => {
    // A row in the surviving workspace, to show its key is left alone.
    const kept = await record('ws', 'member', 'POST_TOOL_USE', { kept: true })
    const { id } = await record('ws-del', 'member-del', 'POST_TOOL_USE', {
      tool_name: 'Write',
      tool_input: { content: CODE },
    })
    // What a backup / PITR copy of the row would still hold.
    const copy = await stored(id)
    const [key] = await db().workspaceDataKey.findMany({
      where: { workspaceId: 'ws-del' },
    })
    const [before] = await openHookPayloads([{ id, ...copy }])
    expect(before!.payload).toMatchObject({ tool_input: { content: CODE } })

    const result = await workspaceDeletionService.deleteWorkspace(
      'ws-del',
      'clerk-owner'
    )
    expect(result!.rowCounts.WorkspaceDataKey).toBe(1)
    const receipt = await db().workspaceDeletionReceipt.findUniqueOrThrow({
      where: { id: result!.receiptId },
    })
    expect((receipt.rowCounts as Record<string, number>).WorkspaceDataKey).toBe(
      1
    )
    expect(
      await db().workspaceDataKey.count({ where: { workspaceId: 'ws-del' } })
    ).toBe(0)

    // The surviving ciphertext no longer opens: its data key is gone.
    expect((await workspaceKeyring.getKeysByIds([key!.id])).size).toBe(0)
    const [after] = await openHookPayloads([{ id, ...copy }])
    expect(after!.payload).toBeNull()
    // The other workspace's key is untouched and still reads its rows.
    workspaceKeyring.resetForTests()
    const [keptRow] = await openHookPayloads([
      { id: kept.id, ...(await stored(kept.id)) },
    ])
    expect(keptRow!.payload).toEqual({ kept: true })
  })

  it('payload encryption backfill is dry-run by default and lossless when applied', async () => {
    const legacy = {
      tool_name: 'Edit',
      tool_input: {
        file_path: '/repo/b.ts',
        old_string: 'a',
        new_string: CODE,
      },
    }
    await seedLegacy('bf_1', 'POST_TOOL_USE', legacy, { taskId: 'task_1' })
    await seedLegacy(
      'bf_2',
      'POST_TOOL_USE',
      { tool_name: 'Read' },
      { taskId: 'task_1' }
    )
    await seedLegacy(
      'bf_pruned',
      'POST_TOOL_USE',
      { _lumo_pruned: true },
      { taskId: 'task_1', payloadPrunedAt: new Date() }
    )
    const plaintextCount = () =>
      db().hookEvent.count({
        where: { payloadEncrypted: null, payloadPrunedAt: null },
      })
    const before = await hookEventRepository.findByTaskId('task_1')
    const plaintextBefore = await plaintextCount()
    expect(plaintextBefore).toBeGreaterThanOrEqual(2)

    const dry = await hookEventPayloadEncryptionBackfillService.run()
    expect(dry.scanned).toBe(plaintextBefore)
    expect(dry.written).toBe(0)
    expect(await plaintextCount()).toBe(plaintextBefore)
    expect((await stored('bf_1')).payloadEncrypted).toBeNull()

    const applied = await hookEventPayloadEncryptionBackfillService.run({
      apply: true,
      batchSize: 2,
    })
    expect(applied.written).toBe(plaintextBefore)
    expect(await plaintextCount()).toBe(0)
    const row = await stored('bf_1')
    expect(row.payload).toBeNull()
    expect(row.payloadEncrypted).toMatch(/^lenc:v1:/)
    // The pruned marker row is left as it was.
    expect(await stored('bf_pruned')).toMatchObject({
      payload: { _lumo_pruned: true },
      payloadEncrypted: null,
    })
    // Every row reads back exactly as before the backfill.
    const after = await hookEventRepository.findByTaskId('task_1')
    expect(after).toEqual(before)
  })

  it('a ciphertext copied onto another workspace row never reads as plaintext', async () => {
    await seedWorkspace('ws-b', 'member-b')
    const secret = { tool_name: 'Write', tool_input: { content: CODE } }
    const source = await record('ws', 'member', 'POST_TOOL_USE', secret)
    const target = await record('ws-b', 'member-b', 'POST_TOOL_USE', {
      tool_name: 'Read',
    })
    // Move workspace A's ciphertext onto workspace B's row.
    const { payloadEncrypted } = await stored(source.id)
    await db().hookEvent.update({
      where: { id: target.id },
      data: { payloadEncrypted },
    })

    const rows = await hookEventRepository.findManyByIdsForEditChange([
      source.id,
      target.id,
    ])
    const byId = new Map(rows.map(r => [r.id, r]))
    expect(byId.get(source.id)!.payload).toEqual(secret)
    expect(byId.get(target.id)!.payload).toBeNull()
    expect(JSON.stringify(byId.get(target.id))).not.toContain('items.reduce')
  })
})
