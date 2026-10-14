/**
 * @jest-environment node
 *
 * LUM-1117 phase 1 — the backfill that merges `workspaces.summaryLocale` into
 * `defaultLocale`, against a REAL Postgres: replay every migration up to it,
 * seed one workspace per case, apply it, and read the rows back.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'
import { PUBLIC_LOCALES } from '@/lib/i18n/public-locale'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')

const MIGRATION = '20261101090000_lum1117_backfill_default_locale'
const harness = createPgliteHarness(PrismaClient, {
  stopBeforeMigration: MIGRATION,
})

jest.setTimeout(180_000)

/** [id, summaryLocale, defaultLocale before, defaultLocale after] */
const CASES: Array<[string, string, string, string]> = [
  ['ws_zh_default_en', 'zh', 'en', 'zh-CN'],
  ['ws_zhcn_default_en', 'zh-CN', 'en', 'zh-CN'],
  ['ws_zhtw_default_en', 'zh-TW', 'en', 'zh-TW'],
  ['ws_ja_default_en', 'ja', 'en', 'ja'],
  ['ws_en_default_en', 'en', 'en', 'en'],
  // Both set and in conflict: the newer defaultLocale wins.
  ['ws_zh_default_fr', 'zh', 'fr', 'fr'],
  ['ws_en_default_ko', 'en', 'ko', 'ko'],
  // A value that names no supported language leaves the default alone.
  ['ws_bogus_default_en', 'xx', 'en', 'en'],
]

beforeAll(async () => {
  await harness.start()
  for (const [id, summaryLocale, defaultLocale] of CASES) {
    await harness.insert('workspaces', {
      id,
      name: id,
      slug: id.replace(/_/g, '-'),
      summaryLocale,
      defaultLocale,
    })
  }
  await harness.applyMigration(MIGRATION)
})

afterAll(async () => {
  await harness.stop()
})

describe('LUM-1117 backfill defaultLocale from summaryLocale', () => {
  it.each(CASES)(
    '%s: summaryLocale=%p, defaultLocale=%p → %p',
    async (id, _summary, _before, after) => {
      const rows = await harness.query<{ defaultLocale: string }>(
        `select "defaultLocale" from workspaces where id = $1`,
        [id]
      )
      expect(rows).toEqual([{ defaultLocale: after }])
    }
  )

  it('keeps the summaryLocale column (dropped only in phase 2)', async () => {
    const rows = await harness.query<{ summaryLocale: string }>(
      `select "summaryLocale" from workspaces where id = 'ws_zh_default_en'`
    )
    expect(rows).toEqual([{ summaryLocale: 'zh' }])
  })

  it('only rewrites rows — no column or table is dropped', () => {
    const sql = readFileSync(
      path.join(
        __dirname,
        '../../prisma/migrations',
        MIGRATION,
        'migration.sql'
      ),
      'utf8'
    )
    expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i)
    expect(sql).toContain('UPDATE "workspaces"')
    // The SQL lists the supported languages by hand: keep it in step.
    for (const locale of PUBLIC_LOCALES.filter(
      l => l !== 'en' && !l.startsWith('zh')
    ))
      expect(sql).toContain(`'${locale}'`)
  })
})
