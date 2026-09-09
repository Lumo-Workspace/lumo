/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION = join(
  process.cwd(),
  'prisma/migrations/20260909120000_lum735_sarif_ingest/migration.sql'
)

describe('LUM-735 SARIF ingest migration', () => {
  it('adds two nullable columns and one enum value, nothing destructive', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    expect(sql).toMatch(/ALTER TABLE "api_keys" ADD COLUMN\s+"scope" TEXT;/)
    expect(sql).toMatch(
      /ALTER TABLE "project_repositories" ADD COLUMN\s+"lastSarifIngestAt" TIMESTAMP\(3\);/
    )
    expect(sql).toMatch(
      /ALTER TYPE "PrSecurityScanTrigger" ADD VALUE 'SARIF_PUSH';/
    )
    expect(sql).not.toMatch(/\bDROP\b/i)
    expect(sql).not.toMatch(/(?<!ON )\bDELETE\b/i)
    expect(sql).not.toMatch(/\bTRUNCATE\b/i)
  })
})
