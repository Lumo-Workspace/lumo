/**
 * @jest-environment node
 *
 * LUM-861: deleting a workspace against a REAL Postgres. FK behaviour
 * (RESTRICT vs CASCADE, cascade ordering) is exactly what a mocked Prisma
 * cannot show — the Document RESTRICT that made every workspace with a
 * document undeletable passed every mocked test. So this suite replays every
 * migration into an in-memory PGlite, serves it over the Postgres wire
 * protocol (a child process — see scripts/test-support/pglite-server.mjs),
 * and drives the real repository through a real PrismaClient.
 *
 * Seeding is test-only raw SQL through that same PrismaClient (the PGlite
 * socket accepts a single connection), with an information_schema-driven
 * filler so the seed does not rot as models grow required columns. Every row of the doomed workspace carries an id prefixed
 * `w1_`; after the purge no text column in any table may still hold one.
 */
import { spawn, type ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import path from 'path'
import type { PrismaClient as PrismaClientType } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')

const holder: { prisma: PrismaClientType | null } = { prisma: null }
jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return holder.prisma
  },
}))

import { workspaceDeletionRepository } from '@/lib/repositories/workspace-deletion.repository'

jest.setTimeout(180_000)

const RECEIPTS = 'workspace_deletion_receipts'

let child: ChildProcess

/** Raw SQL over the test's single connection (seeding and assertions only). */
const db = {
  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<{ rows: T[] }> {
    const rows = await holder.prisma!.$queryRawUnsafe<T[]>(sql, ...params)
    return { rows }
  },
}

/** Start the PGlite child and resolve its host:port once migrations applied. */
async function startPglite(): Promise<string> {
  child = spawn(
    process.execPath,
    [path.resolve(__dirname, '../../scripts/test-support/pglite-server.mjs')],
    {
      stdio: ['pipe', 'pipe', 'inherit'],
    }
  )
  const lines = createInterface({ input: child.stdout! })
  for await (const line of lines) {
    const msg = JSON.parse(line) as { conn?: string; error?: string }
    if (msg.error) throw new Error(`pglite-server: ${msg.error}`)
    if (msg.conn) return msg.conn
  }
  throw new Error('pglite-server exited before it was ready')
}

interface Column {
  column_name: string
  is_nullable: string
  column_default: string | null
  data_type: string
  udt_name: string
}

async function fillerFor(col: Column): Promise<unknown> {
  if (col.data_type === 'USER-DEFINED') {
    const r = await db.query<{ enumlabel: string }>(
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = $1 order by e.enumsortorder limit 1`,
      [col.udt_name]
    )
    return r.rows[0]?.enumlabel
  }
  if (col.data_type === 'ARRAY') return '{}'
  if (/int|numeric|double|real/.test(col.data_type)) return 1
  if (col.data_type === 'boolean') return false
  if (col.data_type === 'jsonb' || col.data_type === 'json') return '{}'
  if (col.data_type.startsWith('timestamp')) return new Date().toISOString()
  return `${col.column_name}-fill`
}

/** Insert a row, filling every required column the caller did not give. */
async function insert(table: string, values: Record<string, unknown>) {
  const cols = await db.query<Column>(
    `select column_name, is_nullable, column_default, data_type, udt_name
     from information_schema.columns where table_schema = 'public' and table_name = $1`,
    [table]
  )
  if (cols.rows.length === 0) throw new Error(`no table ${table}`)
  const row: Record<string, unknown> = { ...values }
  for (const c of cols.rows) {
    if (c.column_name in row || c.is_nullable === 'YES' || c.column_default)
      continue
    row[c.column_name] = await fillerFor(c)
  }
  const keys = Object.keys(row)
  await db.query(
    `insert into "${table}" (${keys.map(k => `"${k}"`).join(', ')})
     values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(row)
  )
}

/** Seed one workspace with rows in every kind of table the purge must reach. */
async function seedWorkspace(p: string) {
  const ws = `${p}ws`
  const m = `${p}member`
  await insert('workspaces', { id: ws, name: p, slug: `${p}slug` })
  await insert('workspace_members', {
    id: m,
    workspaceId: ws,
    clerkId: `${p}clerk`,
  })
  await insert('actors', { id: `${p}actor`, workspaceId: ws, memberId: m })
  await insert('teams', { id: `${p}team`, workspaceId: ws })
  await insert('projects', {
    id: `${p}project`,
    workspaceId: ws,
    teamId: `${p}team`,
    createdByMemberId: m,
  })
  await insert('sprints', { id: `${p}sprint`, teamId: `${p}team` })
  await insert('milestones', { id: `${p}milestone`, projectId: `${p}project` })
  await insert('tasks', {
    id: `${p}task`,
    projectId: `${p}project`,
    workspaceId: ws,
    teamId: `${p}team`,
  })
  await insert('test_cases', { id: `${p}testcase`, taskId: `${p}task` })
  await insert('comments', {
    id: `${p}comment`,
    taskId: `${p}task`,
    authorActorId: `${p}actor`,
  })
  // The RESTRICT that blocked deletion before LUM-861.
  await insert('Document', {
    id: `${p}doc`,
    workspaceId: ws,
    createdById: m,
    number: 1,
  })
  await insert('DocumentRevision', {
    id: `${p}rev`,
    documentId: `${p}doc`,
    workspaceId: ws,
    authorId: m,
  })
  await insert('sessions', {
    id: `${p}session`,
    workspaceId: ws,
    workspaceMemberId: m,
  })
  await insert('hook_events', {
    id: `${p}hook`,
    workspaceId: ws,
    workspaceMemberId: m,
    sessionId: `${p}session`,
  })
  await insert('memories', {
    id: `${p}mem1`,
    workspaceId: ws,
    projectId: `${p}project`,
  })
  await insert('memories', {
    id: `${p}mem2`,
    workspaceId: ws,
    projectId: `${p}project`,
  })
  // FK-less tables the cascade cannot reach.
  await insert('memory_provenance', {
    id: `${p}prov`,
    childMemoryId: `${p}mem2`,
    parentMemoryId: `${p}mem1`,
  })
  await insert('memory_stale_anchor_reports', {
    id: `${p}stale`,
    memoryId: `${p}mem1`,
    projectId: `${p}project`,
    workspaceId: ws,
  })
  await insert('McpAuditLog', { id: `${p}mcp`, workspaceId: ws })
  await insert('GenerationJob', { id: `${p}gen_ws`, targetId: ws })
  await insert('GenerationJob', { id: `${p}gen_p`, targetId: `${p}project` })
  await insert('GenerationJob', { id: `${p}gen_s`, targetId: `${p}sprint` })
  await insert('GenerationJob', { id: `${p}gen_m`, targetId: `${p}milestone` })
}

/** Every `table.column` (outside the receipts table) holding a value with `prefix`. */
async function rowsWithPrefix(prefix: string): Promise<string[]> {
  const cols = await db.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
     where table_schema = 'public' and table_name <> $1
       and data_type in ('text', 'character varying')`,
    [RECEIPTS]
  )
  const hits: string[] = []
  for (const { table_name, column_name } of cols.rows) {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from "${table_name}" where "${column_name}" like $1`,
      [`${prefix}%`]
    )
    if ((r.rows[0]?.n ?? 0) > 0) hits.push(`${table_name}.${column_name}`)
  }
  return hits
}

beforeAll(async () => {
  const connectionString = `postgresql://postgres@${await startPglite()}/postgres`
  holder.prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: 1 }),
  })

  await seedWorkspace('w1_')
  await seedWorkspace('w2_')
})

afterAll(async () => {
  await holder.prisma?.$disconnect()
  child?.stdin?.end()
  child?.kill()
})

describe('workspace purge on a real Postgres (all migrations replayed)', () => {
  it('a delete that fails leaves no receipt behind', async () => {
    await expect(
      workspaceDeletionRepository.purge('w9_missing', 'user_1')
    ).rejects.toThrow()
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from "${RECEIPTS}"`
    )
    expect(r.rows[0]?.n).toBe(0)
  })

  it('deletes a workspace holding documents and leaves no row of it in any table', async () => {
    expect(await rowsWithPrefix('w1_')).not.toEqual([])

    const { receiptId, rowCounts } = (await workspaceDeletionRepository.purge(
      'w1_ws',
      'user_1'
    ))!

    expect(await rowsWithPrefix('w1_')).toEqual([])
    expect(rowCounts).toMatchObject({
      Workspace: 1,
      Document: 1,
      DocumentRevision: 1,
      McpAuditLog: 1,
      MemoryStaleAnchorReport: 1,
      MemoryProvenance: 1,
      GenerationJob: 4,
    })

    const receipt = await db.query<Record<string, unknown>>(
      `select * from "${RECEIPTS}" where id = $1`,
      [receiptId]
    )
    expect(receipt.rows[0]).toMatchObject({
      workspaceId: 'w1_ws',
      requestedByClerkId: 'user_1',
      blobCleanup: { status: 'PENDING', deleted: 0 },
    })
    // No content: only ids, the requester, counts, blob outcome and a time.
    expect(Object.keys(receipt.rows[0] ?? {}).sort()).toEqual([
      'blobCleanup',
      'deletedAt',
      'id',
      'requestedByClerkId',
      'rowCounts',
      'workspaceId',
    ])
  })

  it('leaves every other workspace untouched', async () => {
    const hits = await rowsWithPrefix('w2_')
    for (const t of [
      'workspaces.id',
      'Document.id',
      'DocumentRevision.id',
      'memory_provenance.id',
      'memory_stale_anchor_reports.id',
      'McpAuditLog.id',
      'GenerationJob.id',
      'tasks.id',
    ])
      expect(hits).toContain(t)
  })
})
