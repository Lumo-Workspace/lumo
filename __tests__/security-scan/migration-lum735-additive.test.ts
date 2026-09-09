/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION = join(
  process.cwd(),
  'prisma/migrations/20260909000000_lum735_scan_stages/migration.sql'
)

describe('LUM-735 migration', () => {
  it('only adds two nullable/defaulted columns to pr_security_scans', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    expect(sql).toMatch(
      /ALTER TABLE "pr_security_scans" ADD COLUMN\s+"stages" JSONB/
    )
    expect(sql).toMatch(/ADD COLUMN\s+"partial" BOOLEAN NOT NULL DEFAULT false/)
    expect(sql).not.toMatch(/\bDROP\b/i)
    expect(sql).not.toMatch(/(?<!ON )\bDELETE\b/i)
    expect(sql).not.toMatch(/\bTRUNCATE\b/i)
    expect(sql).not.toMatch(/CREATE TYPE/i)
  })
})
