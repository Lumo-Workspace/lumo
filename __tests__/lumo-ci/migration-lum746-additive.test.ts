/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION = join(
  process.cwd(),
  'prisma/migrations/20260911100000_lum746_lumo_ci_runs/migration.sql'
)

describe('LUM-746 migration', () => {
  it('only creates lumo_ci_runs (unique pr+sha, workspace+startedAt index, FKs) — no destructive DDL', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    expect(sql).toMatch(/CREATE TABLE "lumo_ci_runs"/)
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "lumo_ci_runs_pullRequestId_headSha_key" ON "lumo_ci_runs"\("pullRequestId", "headSha"\)/
    )
    expect(sql).toMatch(
      /CREATE INDEX "lumo_ci_runs_workspaceId_startedAt_idx" ON "lumo_ci_runs"\("workspaceId", "startedAt"\)/
    )
    expect(sql).toMatch(/ADD CONSTRAINT "lumo_ci_runs_pullRequestId_fkey"/)
    expect(sql).toMatch(/ADD CONSTRAINT "lumo_ci_runs_taskId_fkey"/)
    expect(sql).toMatch(/ADD CONSTRAINT "lumo_ci_runs_workspaceId_fkey"/)
    expect(sql).not.toMatch(/\bDROP\b/i)
    expect(sql).not.toMatch(/(?<!ON )\bDELETE\b/i)
    expect(sql).not.toMatch(/\bTRUNCATE\b/i)
    expect(sql).not.toMatch(/CREATE TYPE/i)
    // Only the new table is altered (its own FK constraints).
    const altered = [...sql.matchAll(/ALTER TABLE "([^"]+)"/g)].map(m => m[1])
    expect(new Set(altered)).toEqual(new Set(['lumo_ci_runs']))
  })
})
