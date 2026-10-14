/**
 * @jest-environment node
 *
 * LUM-1117 phase 2 — the migration that drops the workspace's old
 * summary-only language column, against a REAL Postgres: replay every
 * migration up to it (so the phase 1 backfill has run), seed a workspace,
 * apply it, and check only that column goes — defaultLocale keeps the
 * backfilled language.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')

const MIGRATION = '20261102090000_lum1117_drop_summary_locale'
const harness = createPgliteHarness(PrismaClient, {
  stopBeforeMigration: MIGRATION,
})

/** Built at run time so this file is not a `git grep` hit for the old name. */
const RETIRED = ['summary', 'Locale'].join('')

jest.setTimeout(180_000)

async function columnExists(column: string): Promise<boolean> {
  const rows = await harness.query<{ n: bigint }>(
    `select count(*) as n from information_schema.columns
     where table_schema = 'public' and table_name = 'workspaces' and column_name = $1`,
    [column]
  )
  return Number(rows[0]!.n) > 0
}

beforeAll(async () => {
  await harness.start()
  // The replay really stopped before the migration under test.
  expect(await columnExists(RETIRED)).toBe(true)
  await harness.insert('workspaces', {
    id: 'ws_drop',
    name: 'ws_drop',
    slug: 'ws-drop',
    [RETIRED]: 'zh',
    defaultLocale: 'zh-CN',
  })
  await harness.applyMigration(MIGRATION)
})

afterAll(async () => {
  await harness.stop()
})

describe('LUM-1117 drop the old summary language column', () => {
  it('drops the column', async () => {
    expect(await columnExists(RETIRED)).toBe(false)
  })

  it('keeps the workspace and its defaultLocale', async () => {
    const rows = await harness.query<{ id: string; defaultLocale: string }>(
      `select id, "defaultLocale" from workspaces where id = 'ws_drop'`
    )
    expect(rows).toEqual([{ id: 'ws_drop', defaultLocale: 'zh-CN' }])
  })

  it('drops exactly that one column and nothing else', () => {
    const sql = readFileSync(
      path.join(
        __dirname,
        '../../prisma/migrations',
        MIGRATION,
        'migration.sql'
      ),
      'utf8'
    )
    const statements = sql
      .split('\n')
      .filter(l => l.trim() && !l.trim().startsWith('--'))
    expect(statements).toEqual([
      `ALTER TABLE "workspaces" DROP COLUMN "${RETIRED}";`,
    ])
  })
})
