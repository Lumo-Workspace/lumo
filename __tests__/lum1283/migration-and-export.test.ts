/**
 * @jest-environment node
 *
 * LUM-1283: the createdByActorId migration is additive, keeps the FK
 * SET NULL, and backfills from the earliest TASK_CREATED activity actor
 * (same workspace only); the workspace export carries the column.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(__dirname, '..', '..')
const sql = readFileSync(
  join(
    root,
    'prisma/migrations/20261130090000_lum1283_task_created_by/migration.sql'
  ),
  'utf8'
)
// Strip SQL comments so prose never satisfies an assertion.
const code = sql
  .split('\n')
  .filter(l => !l.trim().startsWith('--'))
  .join('\n')

describe('LUM-1283 migration', () => {
  it('adds a nullable column with an index and a SET NULL foreign key', () => {
    expect(code).toMatch(
      /ALTER TABLE "tasks" ADD COLUMN "createdByActorId" TEXT;/
    )
    expect(code).toMatch(
      /CREATE INDEX "tasks_createdByActorId_idx" ON "tasks"\("createdByActorId"\);/
    )
    expect(code).toMatch(
      /FOREIGN KEY \("createdByActorId"\) REFERENCES "actors"\("id"\) ON DELETE SET NULL/
    )
  })

  it('is additive: no DROP or DELETE', () => {
    expect(code).not.toMatch(/\bDROP\b/i)
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(code).not.toMatch(/\bTRUNCATE\b/i)
  })

  it('backfills from the earliest TASK_CREATED activity actor in the same workspace', () => {
    expect(code).toMatch(/UPDATE "tasks"/)
    expect(code).toMatch(/ta\."type" = 'TASK_CREATED'/)
    expect(code).toMatch(/ta\."actorId" IS NOT NULL/)
    expect(code).toMatch(/DISTINCT ON \(ta\."taskId"\)/)
    expect(code).toMatch(/ORDER BY ta\."taskId", ta\."createdAt" ASC/)
    expect(code).toMatch(/a\."workspaceId" = t\."workspaceId"/)
    expect(code).toMatch(/t\."createdByActorId" IS NULL/)
  })

  it('matches the Prisma schema relation', () => {
    const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')
    expect(schema).toMatch(/createdByActorId\s+String\?/)
    expect(schema).toMatch(
      /createdBy\s+Actor\?\s+@relation\("TaskCreator", fields: \[createdByActorId\], references: \[id\], onDelete: SetNull\)/
    )
    expect(schema).toMatch(/@@index\(\[createdByActorId\]\)/)
  })
})

describe('workspace export (LUM-1283)', () => {
  it('selects createdByActorId on the tasks table', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    jest.doMock('@/lib/db/prisma', () => ({
      prisma: { task: { findMany } },
    }))
    const { workspaceExportRepository } =
      await import('@/lib/repositories/workspace-export.repository')
    await workspaceExportRepository.pageRows('tasks', 'ws-1', null, 10)
    expect(findMany.mock.calls[0][0].select).toMatchObject({
      assigneeActorId: true,
      createdByActorId: true,
    })
  })
})
