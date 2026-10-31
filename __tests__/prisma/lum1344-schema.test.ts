/**
 * @jest-environment node
 *
 * LUM-1344: waitlist approval fields + platform-level admin audit table.
 * Pins the schema text (and the hand-written migration) the waitlist gate and
 * admin API build on.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const schema = readFileSync(
  join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8'
)
const migration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'migrations',
    '20261210120000_lum1344_waitlist_approval_admin_audit',
    'migration.sql'
  ),
  'utf8'
)

function block(kind: 'model' | 'enum', name: string): string {
  const m = new RegExp(`^${kind}\\s+${name}\\s*\\{([\\s\\S]*?)^\\}`, 'm').exec(
    schema
  )
  if (!m) throw new Error(`${kind} ${name} not found in schema.prisma`)
  return m[1]!
}

describe('LUM-1344 schema', () => {
  it('declares WaitlistStatus and WaitlistSource enums', () => {
    const status = block('enum', 'WaitlistStatus')
    expect(status).toMatch(/\bPENDING\b/)
    expect(status).toMatch(/\bAPPROVED\b/)
    const source = block('enum', 'WaitlistSource')
    expect(source).toMatch(/\bMARKETING_FORM\b/)
    expect(source).toMatch(/\bONBOARDING_BLOCKED\b/)
  })

  it('adds the six approval fields to WaitlistEntry', () => {
    const w = block('model', 'WaitlistEntry')
    expect(w).toMatch(/status\s+WaitlistStatus\s+@default\(PENDING\)/)
    expect(w).toMatch(/source\s+WaitlistSource\s+@default\(MARKETING_FORM\)/)
    expect(w).toMatch(/approvedAt\s+DateTime\?/)
    expect(w).toMatch(/approvedById\s+String\?/)
    expect(w).toMatch(/lastInvitedAt\s+DateTime\?/)
    expect(w).toMatch(/inviteCount\s+Int\s+@default\(0\)/)
    expect(w).toMatch(/@@index\(\[status,\s*createdAt\]\)/)
    // approvedById is a plain auth-user id, not a relation
    expect(w).not.toMatch(/@relation/)
  })

  it('defines PlatformAdminAuditEvent with no relations', () => {
    const e = block('model', 'PlatformAdminAuditEvent')
    expect(e).toMatch(/@@map\("platform_admin_audit_events"\)/)
    for (const f of [
      /adminUserId\s+String\b/,
      /action\s+String\b/,
      /targetType\s+String\b/,
      /targetId\s+String\b/,
      /workspaceId\s+String\?/,
      /metadata\s+Json\?/,
      /createdAt\s+DateTime\s+@default\(now\(\)\)/,
    ]) {
      expect(e).toMatch(f)
    }
    expect(e).toMatch(/@@index\(\[createdAt\]\)/)
    expect(e).toMatch(/@@index\(\[adminUserId,\s*createdAt\]\)/)
    expect(e).toMatch(/@@index\(\[targetType,\s*targetId\]\)/)
    // survives workspace deletion: no @relation line at all
    expect(e).not.toMatch(/@relation/)
  })

  it('migration is additive and uses physical table names', () => {
    expect(migration).toMatch(/CREATE TYPE "WaitlistStatus"/)
    expect(migration).toMatch(/CREATE TYPE "WaitlistSource"/)
    expect(migration).toMatch(/ALTER TABLE "waitlist_entries"/)
    expect(migration).toMatch(/CREATE TABLE "platform_admin_audit_events"/)
    expect(migration).not.toMatch(/\bDROP\b/i)
  })
})
