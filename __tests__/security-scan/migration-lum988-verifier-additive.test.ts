/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION = join(
  process.cwd(),
  'prisma/migrations/20261014090000_lum988_review_verifier/migration.sql'
)

describe('LUM-988 migration — agentic verifier columns', () => {
  it('only creates the enum and adds nullable columns; nothing destructive, no data change', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    expect(sql).toMatch(
      /CREATE TYPE "PrSecurityVerifierVerdict" AS ENUM \('CONFIRMED', 'REJECTED'\);/
    )
    expect(sql).toMatch(
      /ALTER TABLE "pr_security_scans" ADD COLUMN "verifierStartedAt" TIMESTAMP\(3\),\s*ADD COLUMN "verifiedAt" TIMESTAMP\(3\);/
    )
    expect(sql).toMatch(
      /ALTER TABLE "pr_security_findings" ADD COLUMN "verifierVerdict" "PrSecurityVerifierVerdict",\s*ADD COLUMN "verifierReason" TEXT;/
    )
    expect(sql).not.toMatch(/NOT NULL/)
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DROP|TRUNCATE|DELETE)\b/i)
  })
})
