/**
 * Test-only real-Postgres harness: replays every migration into an in-memory
 * PGlite served over the wire protocol (pglite-server.mjs, a child process) and
 * gives the suite a real PrismaClient plus a seeding helper that fills every
 * required column the caller leaves out (information_schema-driven, so seeds
 * do not rot as models grow). Same approach as the LUM-861 deletion suite.
 *
 * Usage: the suite mocks `@/lib/db/prisma` to read `harness.prisma`, then
 * awaits `harness.start()` in beforeAll and `harness.stop()` in afterAll.
 */
import { spawn, type ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import path from 'path'
import type { PrismaClient as PrismaClientType } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

interface Column {
  column_name: string
  is_nullable: string
  column_default: string | null
  data_type: string
  udt_name: string
}

export interface PgliteHarness {
  prisma: PrismaClientType | null
  start(): Promise<void>
  stop(): Promise<void>
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]>
  insert(table: string, values: Record<string, unknown>): Promise<void>
}

export function createPgliteHarness(
  PrismaClient: typeof import('@prisma/client').PrismaClient
): PgliteHarness {
  let child: ChildProcess | null = null

  const harness: PgliteHarness = {
    prisma: null,

    async start() {
      child = spawn(
        process.execPath,
        [path.resolve(__dirname, 'pglite-server.mjs')],
        { stdio: ['pipe', 'pipe', 'inherit'] }
      )
      let conn: string | null = null
      for await (const line of createInterface({ input: child.stdout! })) {
        const msg = JSON.parse(line) as { conn?: string; error?: string }
        if (msg.error) throw new Error(`pglite-server: ${msg.error}`)
        if (msg.conn) {
          conn = msg.conn
          break
        }
      }
      if (!conn) throw new Error('pglite-server exited before it was ready')
      harness.prisma = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: `postgresql://postgres@${conn}/postgres`,
          max: 1,
        }),
      })
    },

    async stop() {
      await harness.prisma?.$disconnect()
      child?.stdin?.end()
      child?.kill()
    },

    async query<T>(sql: string, params: unknown[] = []) {
      return harness.prisma!.$queryRawUnsafe<T[]>(sql, ...params)
    },

    async insert(table, values) {
      const cols = await harness.query<Column>(
        `select column_name, is_nullable, column_default, data_type, udt_name
         from information_schema.columns where table_schema = 'public' and table_name = $1`,
        [table]
      )
      if (cols.length === 0) throw new Error(`no table ${table}`)
      const row: Record<string, unknown> = { ...values }
      for (const c of cols) {
        if (c.column_name in row || c.is_nullable === 'YES' || c.column_default)
          continue
        row[c.column_name] = await fillerFor(harness, c)
      }
      const keys = Object.keys(row)
      await harness.query(
        `insert into "${table}" (${keys.map(k => `"${k}"`).join(', ')})
         values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
        Object.values(row)
      )
    },
  }
  return harness
}

async function fillerFor(
  harness: PgliteHarness,
  col: Column
): Promise<unknown> {
  if (col.data_type === 'USER-DEFINED') {
    const r = await harness.query<{ enumlabel: string }>(
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = $1 order by e.enumsortorder limit 1`,
      [col.udt_name]
    )
    return r[0]?.enumlabel
  }
  if (col.data_type === 'ARRAY') return '{}'
  if (/int|numeric|double|real/.test(col.data_type)) return 1
  if (col.data_type === 'boolean') return false
  if (col.data_type === 'jsonb' || col.data_type === 'json') return '{}'
  if (col.data_type.startsWith('timestamp')) return new Date().toISOString()
  return `${col.column_name}-fill`
}
