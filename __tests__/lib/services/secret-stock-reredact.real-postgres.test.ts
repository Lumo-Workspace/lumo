/**
 * @jest-environment node
 *
 * LUM-898 re-redaction against a REAL Postgres (every migration replayed into
 * PGlite): jsonb equality guards, `@updatedAt` write-back and the table filter
 * on update are exactly what a mocked Prisma cannot show. Seeded and read
 * through Prisma only.
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

import {
  assertApplyHost,
  secretStockReredactService,
} from '@/lib/services/secret-stock-reredact.service'
import { secretStockRepository } from '@/lib/repositories/secret-stock.repository'
import { classifyRow } from '../../../scripts/analysis/lum887-secret-stock/classify'

jest.setTimeout(180_000)

// Built by concatenation so no credential-shaped literal sits in the repo.
const AWS_KEY = ['AKIA', 'ZXCVBNMLKJHGFDSA'].join('')
const ENV_LINE = 'DB_PASSWORD=' + 'Qm7Tz4Lw' + '9Kp2'
const OLD = new Date('2026-01-02T03:04:05.000Z')

const WORKSPACE = {
  label: 'Workspace',
  delegate: 'workspace',
  fields: ['name'],
} as const
const HOOK = {
  label: 'HookEvent (unpruned)',
  delegate: 'hookEvent',
  fields: ['payload', 'toolDetail'],
  where: { payloadPrunedAt: null },
}

const db = () => harness.prisma!

async function seedEvent(id: string, payload: object, extra = {}) {
  await db().hookEvent.create({
    data: {
      id,
      workspaceId: 'ws_a',
      workspaceMemberId: 'member',
      type: 'POST_TOOL_USE',
      payload,
      ...extra,
    },
  })
}

beforeAll(async () => {
  await harness.start()
  for (const [id, name] of [
    ['ws_a', `Acme ${AWS_KEY}`],
    ['ws_b', 'Clean Co'],
    ['ws_c', `Race ${AWS_KEY}`],
  ] as const) {
    await db().workspace.create({
      data: { id, name, slug: id, updatedAt: OLD },
    })
  }
  await db().workspaceMember.create({
    data: { id: 'member', workspaceId: 'ws_a', clerkId: 'clerk' },
  })
  await seedEvent('e1_raw', {
    tool_name: 'Bash',
    tool_input: { command: `export ${ENV_LINE}` },
  })
  await seedEvent('e2_clean', { tool_name: 'Read', b: 1, a: { y: 'x' } })
  await seedEvent(
    'e3_pruned',
    { tool_name: 'Bash', note: ENV_LINE },
    { payloadPrunedAt: new Date(), toolDetail: `run ${ENV_LINE}` }
  )
})

afterAll(async () => {
  await harness.stop()
})

describe('secret stock re-redaction on a real Postgres', () => {
  it('LUM-898 apply rewrites hit rows only and keeps updatedAt', async () => {
    // The script's --apply gate: only the host the operator named.
    expect(() =>
      assertApplyHost('postgres://u:p@prod.example.test/db', 'dev.local')
    ).toThrow(/confirm-host/)

    // A concurrent edit between read and write is not overwritten.
    const [race] = (
      await secretStockRepository.findPage(WORKSPACE, 'ws_b', 1)
    ).filter(r => r.id === 'ws_c')
    expect(race).toBeDefined()
    await db().workspace.update({
      where: { id: 'ws_c' },
      data: { name: 'Race renamed' },
    })
    const stale = await secretStockRepository.rewriteRows(WORKSPACE, [
      {
        id: 'ws_c',
        columns: [{ field: 'name', before: race!.name, after: 'Race x' }],
        updatedAt: OLD,
      },
    ])
    expect(stale).toBe(0)
    expect(
      (await db().workspace.findUnique({ where: { id: 'ws_c' } }))!.name
    ).toBe('Race renamed')

    // Dry run: counts, no writes.
    const dry = await secretStockReredactService.runTable(WORKSPACE, {
      dryRun: true,
      classify: classifyRow,
    })
    expect(dry).toMatchObject({ scanned: 3, hit: 1, toRewrite: 1, written: 0 })
    expect(dry.residual.size).toBe(0)

    // Apply (text column + @updatedAt model), page size 1.
    const applied = await secretStockReredactService.runTable(WORKSPACE, {
      dryRun: false,
      batchSize: 1,
    })
    expect(applied).toMatchObject({ toRewrite: 1, written: 1 })
    const a = (await db().workspace.findUnique({ where: { id: 'ws_a' } }))!
    expect(a.name).not.toContain(AWS_KEY)
    expect(a.name).toContain('Acme')
    expect(a.updatedAt.toISOString()).toBe(OLD.toISOString())
    const b = (await db().workspace.findUnique({ where: { id: 'ws_b' } }))!
    expect(b.updatedAt.toISOString()).toBe(OLD.toISOString())

    // JSON column behind the table filter: pruned rows are outside it.
    const cleanBefore = (await db().hookEvent.findUnique({
      where: { id: 'e2_clean' },
    }))!.payload
    const hook = await secretStockReredactService.runTable(HOOK, {
      dryRun: false,
      classify: classifyRow,
    })
    expect(hook).toMatchObject({ scanned: 2, hit: 1, toRewrite: 1, written: 1 })
    const e1 = (await db().hookEvent.findUnique({ where: { id: 'e1_raw' } }))!
    expect(JSON.stringify(e1.payload)).not.toContain(ENV_LINE)
    expect(classifyRow([e1.payload]).size).toBe(0)
    expect(
      (await db().hookEvent.findUnique({ where: { id: 'e2_clean' } }))!.payload
    ).toEqual(cleanBefore)
    const e3 = (await db().hookEvent.findUnique({
      where: { id: 'e3_pruned' },
    }))!
    expect(e3.toolDetail).toContain(ENV_LINE)

    // Second pass: nothing left to write.
    for (const t of [WORKSPACE, HOOK]) {
      const again = await secretStockReredactService.runTable(t, {
        dryRun: false,
      })
      expect(again).toMatchObject({ toRewrite: 0, written: 0 })
    }
  })
})
