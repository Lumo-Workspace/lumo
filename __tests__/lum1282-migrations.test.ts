/**
 * @jest-environment node
 *
 * LUM-1282 migration shape. Postgres cannot use a freshly added enum value in
 * the transaction that added it, so the two ADD VALUEs ship alone, ahead of
 * the additive columns + completedAt backfill. Everything is additive (no
 * DROP / RENAME / TRUNCATE), and the backfill only fills DONE rows still
 * NULL, from the latest STATUS_CHANGED → DONE activity, else updatedAt.
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const dir = join(__dirname, '..', 'prisma', 'migrations')
const read = (name: string) =>
  readFileSync(join(dir, name, 'migration.sql'), 'utf8')
const ENUMS = '20261130090000_lum1282_canceled_status_enums'
const COLUMNS = '20261130090100_lum1282_task_terminal_timestamps'

/** SQL with `--` comments removed, whitespace collapsed. */
const code = (sql: string) =>
  sql
    .split('\n')
    .map(l => l.replace(/--.*$/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

describe('LUM-1282 migrations', () => {
  it('the enum migration sorts first and only adds the two values', () => {
    const names = readdirSync(dir).filter(n => n.includes('lum1282'))
    expect(names.sort()).toEqual([ENUMS, COLUMNS])
    const stmts = code(read(ENUMS))
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)
    expect(stmts).toEqual([
      `ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'CANCELED'`,
      `ALTER TYPE "DependencyKind" ADD VALUE IF NOT EXISTS 'DUPLICATES'`,
    ])
  })

  it('the column migration is additive and never uses the new enum values', () => {
    const sql = code(read(COLUMNS))
    expect(sql).toContain(
      'ALTER TABLE "tasks" ADD COLUMN "completedAt" TIMESTAMP(3);'
    )
    expect(sql).toContain(
      'ALTER TABLE "tasks" ADD COLUMN "canceledAt" TIMESTAMP(3);'
    )
    expect(sql).not.toMatch(/\bDROP\b|\bRENAME\b|\bTRUNCATE\b|\bDELETE\b/i)
    expect(sql).not.toContain("'CANCELED'")
    expect(sql).not.toContain("'DUPLICATES'")
  })

  it('backfills completedAt for DONE rows from the latest → DONE activity, else updatedAt', () => {
    const sql = code(read(COLUMNS))
    expect(sql).toMatch(/UPDATE "tasks" AS t SET "completedAt" = COALESCE\(/)
    expect(sql).toMatch(/SELECT MAX\(a\."createdAt"\) FROM "task_activities"/)
    expect(sql).toContain(`a."type" = 'STATUS_CHANGED'`)
    expect(sql).toContain(`a."payload"->>'to' = 'DONE'`)
    expect(sql).toMatch(/\), t\."updatedAt" \)/)
    expect(sql).toContain(
      `WHERE t."status" = 'DONE' AND t."completedAt" IS NULL`
    )
  })
})
