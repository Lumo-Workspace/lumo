/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION = join(
  process.cwd(),
  'prisma/migrations/20261013090000_lum988_correctness_finding_kind/migration.sql'
)

describe('LUM-988 migration — CORRECTNESS finding kind', () => {
  it('only adds the enum value, and never uses it in the same migration', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    expect(sql).toMatch(
      /ALTER TYPE "PrSecurityFindingKind" ADD VALUE 'CORRECTNESS';/
    )
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DROP|TRUNCATE|DELETE)\b/i)
    const schema = readFileSync(
      join(process.cwd(), 'prisma/schema.prisma'),
      'utf8'
    )
    expect(schema).toMatch(
      /enum PrSecurityFindingKind \{[^}]*\bCORRECTNESS\b[^}]*\}/
    )
  })
})
