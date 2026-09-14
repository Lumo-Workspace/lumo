/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION = join(
  process.cwd(),
  'prisma/migrations/20260910000000_lum738_dependency_findings/migration.sql'
)

describe('LUM-738 migration — dependency findings + repository baseline', () => {
  it('adds the DEPENDENCY enum value in its own statement, a defaulted column and a nullable column, nothing destructive', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    expect(sql).toMatch(
      /ALTER TYPE "PrSecurityFindingKind" ADD VALUE 'DEPENDENCY';/
    )
    expect(sql).toMatch(
      /ALTER TABLE "pr_security_findings" ADD COLUMN\s+"persisting" BOOLEAN NOT NULL DEFAULT false;/
    )
    expect(sql).toMatch(
      /ALTER TABLE "project_repositories" ADD COLUMN\s+"securityBaseline" JSONB;/
    )
    // The new enum value must not be USED by this migration (LUM-678 lesson:
    // a value added and referenced in the same transaction fails on PG).
    expect(sql).not.toMatch(/'DEPENDENCY'.*\n.*(INSERT|UPDATE)/i)
    expect(sql).not.toMatch(/\b(INSERT|UPDATE)\b/i)
    expect(sql).not.toMatch(/\bDROP\b/i)
    expect(sql).not.toMatch(/(?<!ON )\bDELETE\b/i)
    expect(sql).not.toMatch(/\bTRUNCATE\b/i)
  })
})
