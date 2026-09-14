/** @jest-environment node */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const MIGRATION = join(
  process.cwd(),
  'prisma/migrations/20260910000000_lum739_security_hunt/migration.sql'
)

describe('LUM-739 hunt migration', () => {
  it('creates two enums, six nullable columns and one index, nothing destructive', () => {
    expect(existsSync(MIGRATION)).toBe(true)
    const sql = readFileSync(MIGRATION, 'utf8')
    expect(sql).toMatch(
      /CREATE TYPE "PrSecurityReachability" AS ENUM \('EXTERNAL', 'INTERNAL', 'UNKNOWN'\);/
    )
    expect(sql).toMatch(
      /CREATE TYPE "PrSecurityFalsifierVerdict" AS ENUM \('REJECT', 'INCONCLUSIVE'\);/
    )
    expect(sql).toMatch(
      /ALTER TABLE "pr_security_scans" ADD COLUMN\s+"tokenSpent" INTEGER;/
    )
    expect(sql).toMatch(
      /ALTER TABLE "pr_security_scans" ADD COLUMN\s+"huntAudit" JSONB;/
    )
    expect(sql).toMatch(
      /ALTER TABLE "pr_security_findings" ADD COLUMN\s+"cwe" TEXT;/
    )
    expect(sql).toMatch(
      /ALTER TABLE "pr_security_findings" ADD COLUMN\s+"reachability" "PrSecurityReachability";/
    )
    expect(sql).toMatch(
      /ALTER TABLE "pr_security_findings" ADD COLUMN\s+"callChain" JSONB;/
    )
    expect(sql).toMatch(
      /ALTER TABLE "pr_security_findings" ADD COLUMN\s+"falsifierVerdict" "PrSecurityFalsifierVerdict";/
    )
    expect(sql).toMatch(
      /CREATE INDEX "pr_security_findings_scanId_provenance_severity_idx" ON "pr_security_findings"\("scanId", "provenance", "severity"\);/
    )
    expect(sql).not.toMatch(/\bDROP\b/i)
    expect(sql).not.toMatch(/(?<!ON )\bDELETE\b/i)
    expect(sql).not.toMatch(/\bTRUNCATE\b/i)
    expect(sql).not.toMatch(/NOT NULL/i)
  })

  it('deletes no file under prisma/migrations/ (vs origin/main)', () => {
    const out = execFileSync(
      'git',
      [
        'diff',
        '--diff-filter=D',
        '--name-only',
        'origin/main',
        '--',
        'prisma/migrations/',
      ],
      { encoding: 'utf8' }
    )
    expect(out.trim()).toBe('')
  })
})
