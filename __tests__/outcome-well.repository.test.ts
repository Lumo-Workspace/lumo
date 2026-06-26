/**
 * @jest-environment node
 *
 * LUM-598 — the outcome well store is insert-only and its migration is purely
 * additive. Two referent checks, no DB needed:
 *   1. The repository surface exposes no update/delete write path — a signal,
 *      once recorded, is a frozen historical fact.
 *   2. The migration SQL contains no destructive DDL on existing tables (the
 *      well is a new table + one nullable groundwork column).
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { outcomeSignalRepository } from '@/lib/repositories/outcome-signal.repository'

describe('outcome well — append-only store + additive migration', () => {
  it('OutcomeSignal store is append-only and migration is additive', () => {
    // (1) No mutation/removal write path on the repository.
    const keys = Object.keys(outcomeSignalRepository)
    const mutating = keys.filter(k =>
      /update|delete|remove|upsert|set|patch|destroy/i.test(k)
    )
    expect(mutating).toEqual([])
    expect(keys).toEqual(
      expect.arrayContaining(['insert', 'countForTask', 'listForTask'])
    )

    // (2) Migration is purely additive — no destructive DDL on existing tables.
    const migrationsDir = join(process.cwd(), 'prisma', 'migrations')
    const dir = readdirSync(migrationsDir).find(d =>
      d.includes('lum598_post_hoc_outcome_well')
    )
    expect(dir).toBeDefined()
    const sql = readFileSync(
      join(migrationsDir, dir as string, 'migration.sql'),
      'utf8'
    )

    expect(sql).not.toMatch(/DROP\s+TABLE/i)
    expect(sql).not.toMatch(/DROP\s+COLUMN/i)
    expect(sql).not.toMatch(/DROP\s+CONSTRAINT/i)
    expect(sql).not.toMatch(/DROP\s+INDEX/i)
    expect(sql).not.toMatch(/DROP\s+FOREIGN/i)
    expect(sql).not.toMatch(/\bTRUNCATE\b/i)

    // It IS additive: it creates the well table.
    expect(sql).toMatch(/CREATE TABLE "outcome_signals"/)
  })
})
