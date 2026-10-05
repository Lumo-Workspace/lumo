/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('LUM-988 migration — verifier hold sweep index', () => {
  it('only creates the index the sweep query uses, and the schema declares it', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20261015090000_lum988_verifier_hold_index/migration.sql'
      ),
      'utf8'
    )
    expect(sql).toMatch(
      /CREATE INDEX "pr_security_scans_verifiedAt_verifierStartedAt_idx" ON "pr_security_scans"\("verifiedAt", "verifierStartedAt"\);/
    )
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DROP|TRUNCATE|DELETE|ALTER)\b/i)
    const schema = readFileSync(
      join(process.cwd(), 'prisma/schema.prisma'),
      'utf8'
    )
    const model = schema.slice(
      schema.indexOf('model PrSecurityScan {'),
      schema.indexOf('@@map("pr_security_scans")')
    )
    expect(model).toContain('@@index([verifiedAt, verifierStartedAt])')
  })
})
