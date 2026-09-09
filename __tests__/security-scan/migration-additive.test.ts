/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION = join(
  process.cwd(),
  'prisma/migrations/20260903000000_lum732_pr_security_scan/migration.sql'
)

describe('LUM-732 migration', () => {
  it('is purely additive: creates the two tables and never drops anything', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    expect(sql).toMatch(/CREATE TABLE "pr_security_scans"/)
    expect(sql).toMatch(/CREATE TABLE "pr_security_findings"/)
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "pr_security_scans_pullRequestId_headSha_key"/
    )
    expect(sql).not.toMatch(/\bDROP\b/i)
    // Excludes legitimate FK action clauses ("ON DELETE CASCADE" / "ON DELETE
    // SET NULL"), which are required by this migration's foreign keys — only
    // a real DML DELETE statement should fail this assertion.
    expect(sql).not.toMatch(/(?<!ON )\bDELETE\b/i)
    expect(sql).not.toMatch(/\bTRUNCATE\b/i)
  })
})
