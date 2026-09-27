/**
 * @jest-environment node
 *
 * LUM-855 backfill against a REAL Postgres (every migration replayed into
 * PGlite): jsonb key reordering, the crossing-referenced skip and the
 * pruned-row guard are exactly what a mocked Prisma cannot show.
 */
import { createPgliteHarness } from '../../../scripts/test-support/pglite-harness'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))

import { hookEventCodeBackfillService } from '@/lib/services/hook-event-code-backfill.service'
import { stripCodeFromHookPayload } from '@/lib/hook-payload/redact'
import { WRITE_CHUNK } from '@/lib/repositories/hook-event-code-backfill.repository'

jest.setTimeout(180_000)

const CODE = 'export const total = items.reduce(sum, 0)\n'
const write = (file: string) => ({
  tool_name: 'Write',
  tool_input: { file_path: file, content: CODE },
  tool_response: { type: 'create', filePath: file, content: CODE },
})

async function seedEvent(id: string, payload: object, extra = {}) {
  await harness.insert('hook_events', {
    id,
    workspaceId: 'ws',
    workspaceMemberId: 'member',
    type: 'POST_TOOL_USE',
    payload: JSON.stringify(payload),
    ...extra,
  })
}

async function payloadOf(id: string): Promise<string> {
  const [row] = await harness.query<{ payload: unknown }>(
    `select payload from hook_events where id = $1`,
    [id]
  )
  return JSON.stringify(row?.payload)
}

beforeAll(async () => {
  await harness.start()
  await harness.insert('workspaces', { id: 'ws', name: 'ws', slug: 'ws' })
  await harness.insert('workspace_members', {
    id: 'member',
    workspaceId: 'ws',
    clerkId: 'clerk',
  })
  await seedEvent('e1_raw', write('/repo/lib/a.ts'))
  await seedEvent(
    'e2_clean',
    stripCodeFromHookPayload('POST_TOOL_USE', write('/repo/lib/b.ts'))
  )
  await seedEvent('e3_crossing', write('/repo/lib/c.ts'))
  await harness.insert('boundary_crossings', {
    id: 'bc1',
    hookEventId: 'e3_crossing',
  })
  await seedEvent('e4_pruned', write('/repo/lib/d.ts'), {
    payloadPrunedAt: new Date().toISOString(),
  })
})

afterAll(async () => {
  await harness.stop()
})

describe('hook event code backfill on a real Postgres', () => {
  it('backfill strips raw rows only, skipping crossing-referenced and pruned rows, and is idempotent', async () => {
    const cleanBefore = await payloadOf('e2_clean')

    const dry = await hookEventCodeBackfillService.run({ dryRun: true })
    expect(dry).toMatchObject({
      scanned: 3,
      toRewrite: 1,
      written: 0,
      skippedCrossing: 1,
    })
    expect(await payloadOf('e1_raw')).toContain('items.reduce')

    const applied = await hookEventCodeBackfillService.run({
      dryRun: false,
      batchSize: 1,
    })
    expect(applied).toMatchObject({
      toRewrite: 1,
      written: 1,
      skippedCrossing: 1,
    })

    const raw = JSON.parse(await payloadOf('e1_raw'))
    expect(JSON.stringify(raw)).not.toContain('items.reduce')
    expect(raw.tool_input).toEqual({ file_path: '/repo/lib/a.ts' })
    expect(raw._lumo_redacted['tool_input.content'].lines).toBe(2)

    // Already-clean row: jsonb handed it back reordered, still not rewritten.
    expect(await payloadOf('e2_clean')).toBe(cleanBefore)
    // Crossing evidence and pruned rows keep what they had.
    expect(await payloadOf('e3_crossing')).toContain('items.reduce')
    expect(await payloadOf('e4_pruned')).toContain('items.reduce')

    const again = await hookEventCodeBackfillService.run({ dryRun: false })
    expect(again).toMatchObject({ toRewrite: 0, written: 0 })
  })

  it('backfill writes a page larger than one write transaction in full', async () => {
    const n = WRITE_CHUNK * 2 + 3
    for (let i = 0; i < n; i++) {
      await seedEvent(
        `f${String(i).padStart(3, '0')}`,
        write(`/repo/lib/f${i}.ts`)
      )
    }
    const applied = await hookEventCodeBackfillService.run({
      dryRun: false,
      batchSize: 200,
    })
    expect(applied).toMatchObject({ toRewrite: n, written: n })
    const [left] = await harness.query<{ n: number }>(
      `select count(*)::int as n from hook_events where id like 'f%' and payload::text like '%items.reduce%'`
    )
    expect(left?.n).toBe(0)
  })
})
