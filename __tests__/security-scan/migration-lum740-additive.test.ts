/** @jest-environment node */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const MIGRATION = join(
  process.cwd(),
  'prisma/migrations/20260912000000_lum740_l5_remainder/migration.sql'
)

describe('LUM-740 migration', () => {
  it('creates one enum and seven nullable columns, nothing destructive', () => {
    expect(existsSync(MIGRATION)).toBe(true)
    const sql = readFileSync(MIGRATION, 'utf8')
    expect(sql).toMatch(
      /CREATE TYPE "PrSecuritySuggestionOutcome" AS ENUM \('CONFIRMED', 'OVERRULED'\);/
    )
    expect(sql).toMatch(
      /ALTER TABLE "workspaces" ADD COLUMN\s+"securityPolicy" JSONB;/
    )
    expect(sql).toMatch(
      /ALTER TABLE "pr_security_scans" ADD COLUMN\s+"summaryCommentId" TEXT;/
    )
    expect(sql).toMatch(
      /ALTER TABLE "pr_security_scans" ADD COLUMN\s+"suggestedAt" TIMESTAMP\(3\);/
    )
    expect(sql).toMatch(
      /ALTER TABLE "pr_security_scans" ADD COLUMN\s+"suggestionTokens" INTEGER;/
    )
    expect(sql).toMatch(
      /ALTER TABLE "pr_security_findings" ADD COLUMN\s+"suggestedDisposition" "PrSecurityFindingDisposition";/
    )
    expect(sql).toMatch(
      /ALTER TABLE "pr_security_findings" ADD COLUMN\s+"suggestedReason" TEXT;/
    )
    expect(sql).toMatch(
      /ALTER TABLE "pr_security_findings" ADD COLUMN\s+"suggestionOutcome" "PrSecuritySuggestionOutcome";/
    )
    expect(sql).not.toMatch(/\bDROP\b/i)
    expect(sql).not.toMatch(/(?<!ON )\bDELETE\b/i)
    expect(sql).not.toMatch(/\bTRUNCATE\b/i)
    expect(sql).not.toMatch(/\bUPDATE\b/i)
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
